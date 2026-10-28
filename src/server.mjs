import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeProvider, aiReady, aiStatus, analyzeIncident, checkKeyFormat, PROVIDERS, providerConfig, verifyProvider } from './ai.mjs';
import { reverseGeocode } from './geo.mjs';
import { groupIncidents, processPhoto, summarize } from './photos.mjs';
import { log } from './log.mjs';
import { deleteAppKey, saveAppKey, vilniusCredsSaved } from './secrets.mjs';
import { APPLICANT_FIELDS, loadAppApplicant, loadSettings, saveAppApplicant, saveSettings } from './settings.mjs';
import { archiveCase, ensureDirs, journalAdd, journalRows } from './store.mjs';
import { buildDescription, VIOLATIONS } from './violations.mjs';
import { applicantFrom, currentUser, getUser, importSession, loginWith, logout, sessionInfo, submitReport } from './vilnius.mjs';

// Municipal rule: reports about violations older than 30 days are not handled by VMSA.
const MAX_AGE_DAYS = 30;
const PLATE_RE = /^[A-Z0-9]{2,8}$/;

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25e6, files: 30 } });
const batches = new Map(); // batchId → { created, photos, cases }

ensureDirs();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(here, '..', 'public')));

const ageDays = time => (time ? (Date.now() - new Date(time.replace(' ', 'T'))) / 864e5 : null);

app.get('/api/config', (_req, res) => {
  res.json({ maxAgeDays: MAX_AGE_DAYS, violations: VIOLATIONS, applicantFields: APPLICANT_FIELDS });
});

// Everything the header chips and the "missing settings" bar need. Never triggers a login.
app.get('/api/status', async (_req, res) => {
  const user = await currentUser();
  const session = await sessionInfo();
  const applicant = applicantFrom(user);
  const appValues = loadAppApplicant();
  const applicantMissing = Object.entries(APPLICANT_FIELDS).filter(([k]) => !applicant[`reporter_${k}`]).map(([, label]) => label);
  const ai = aiStatus();
  const missing = [];
  if (!session.loggedIn && !vilniusCredsSaved()) missing.push({ area: 'vilnius', text: 'Neprisijungta prie Vilnius Login – pateikti pranešimų nepavyks' });
  if (applicantMissing.length) missing.push({ area: 'applicant', text: `Pareiškėjo duomenys: ${applicantMissing.join(', ')}${user ? '' : ' (dalį gali užpildyti Vilnius Login profilis prisijungus)'}` });
  if (ai.provider !== 'none' && ai.missing.length) missing.push({ area: 'ai', text: `AI atpažinimas (${ai.providers[ai.provider].label}): trūksta ${ai.missing.join(', ')}` });
  res.json({
    session: { ...session, credsSaved: vilniusCredsSaved() },
    applicant: { values: Object.fromEntries(Object.keys(APPLICANT_FIELDS).map(k => [k, applicant[`reporter_${k}`]])), app: appValues, missing: applicantMissing, fromProfile: !!user },
    ai,
    missing,
  });
});

app.post('/api/settings/applicant', (req, res) => {
  saveAppApplicant(req.body || {});
  log.info('config', 'applicant details saved in /data');
  res.json({ ok: true });
});

// Provider choice + optional new key. A new key or model is verified before saving.
app.post('/api/settings/ai', async (req, res) => {
  const { provider, model, baseUrl } = req.body || {};
  const key = String(req.body?.key || '').trim();
  if (provider === 'none') { saveSettings({ provider: 'none' }); log.info('config', 'ai provider: none'); return res.json({ ok: true, ai: aiStatus() }); }
  const p = PROVIDERS[provider];
  if (!p) return res.status(400).json({ error: 'Nežinomas tiekėjas' });
  const formatProblem = checkKeyFormat(provider, key);
  if (formatProblem) return res.status(400).json({ error: formatProblem });
  const cur = providerConfig(provider);
  const next = {
    key: key || cur.key,
    model: String(model || '').trim() || cur.model,
    baseUrl: provider === 'custom' ? String(baseUrl || '').trim().replace(/\/+$/, '') : cur.baseUrl,
  };
  if (!next.key && !p.keyOptional) return res.status(400).json({ error: `Įveskite ${p.label} raktą (${p.keyHelp}).` });
  if (p.needsBaseUrl && !/^https?:\/\/\S+$/.test(next.baseUrl)) return res.status(400).json({ error: 'Įveskite adresą, pvz. http://localhost:11434/v1' });
  if (!next.model) return res.status(400).json({ error: 'Įveskite modelio pavadinimą' });
  const problem = await verifyProvider(provider, next);
  if (problem) { log.warn('config', 'ai settings rejected', { provider, reason: problem }); return res.status(400).json({ error: problem }); }
  if (key) saveAppKey(p.secret, key);
  const models = { ...loadSettings().models, [provider]: next.model };
  saveSettings({ provider, models, ...(provider === 'custom' ? { baseUrl: next.baseUrl } : {}) });
  log.info('config', 'ai provider saved', { provider, model: next.model, keySaved: !!key });
  res.json({ ok: true, ai: aiStatus() });
});

app.delete('/api/settings/ai-key/:provider', (req, res) => {
  const p = PROVIDERS[req.params.provider];
  if (!p) return res.status(400).json({ error: 'Nežinomas tiekėjas' });
  deleteAppKey(p.secret);
  log.info('config', 'ai key removed from /data', { provider: req.params.provider });
  res.json({ ok: true, ai: aiStatus() });
});

app.post('/api/analyze', upload.array('photos', 30), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'Nėra nuotraukų' });
    const photos = [];
    for (const f of req.files) photos.push(await processPhoto(Buffer.from(f.originalname, 'latin1').toString('utf8'), f.buffer));
    const batchId = randomUUID();
    const cases = [];
    for (const group of groupIncidents(photos)) {
      const { time, lat, lon } = summarize(group);
      const address = await reverseGeocode(lat, lon);
      // Manual mode: no AI configured, or the user unticked "Atpažinti".
      const useAi = req.body?.ai !== '0' && aiReady();
      const ai = useAi ? await analyzeIncident(group.map(p => p.jpeg), { time, address }) : { manual: true };
      const violations = ai.violations || [];
      const plate = (ai.plate || '').toUpperCase().replace(/\s+/g, '');
      cases.push({
        id: cases.length,
        photoIdx: group.map(p => photos.indexOf(p)),
        time, lat, lon, address, plate,
        plateCertain: !!ai.plate_certain,
        vehicle: ai.vehicle || '',
        violations, extra: ai.extra || '', doubts: ai.doubts || '', aiError: ai.error || null, manual: !!ai.manual,
        noExif: !time,
        description: buildDescription({ time, address, plate, violations, extra: ai.extra, photoCount: group.length }),
      });
    }
    batches.set(batchId, { created: Date.now(), photos, cases });
    log.info('analyze', `${photos.length} photos → ${cases.length} cases`, { ai: cases.some(c => !c.manual), noExif: cases.filter(c => c.noExif).length, aiErrors: cases.filter(c => c.aiError).length });
    for (const [id, b] of batches) if (Date.now() - b.created > 864e5) batches.delete(id);
    res.json({ batchId, cases, maxAgeDays: MAX_AGE_DAYS });
  } catch (e) {
    log.error('analyze', e.message, { stack: e.stack?.split('\n')[1]?.trim() });
    res.status(500).json({ error: `Nuotraukų apdorojimas nepavyko: ${e.message}` });
  }
});

app.get('/api/photo/:batch/:idx', (req, res) => {
  const p = batches.get(req.params.batch)?.photos[+req.params.idx];
  if (!p) return res.sendStatus(404);
  res.type('jpeg').send(p.jpeg);
});

app.post('/api/describe', (req, res) => res.json({ description: buildDescription(req.body || {}) }));

app.get('/api/session', async (_req, res) => res.json(await sessionInfo()));

// Credentials typed in the app: used once to get a session token, never stored.
app.post('/api/login', async (req, res) => {
  const { username, password, remember } = req.body || {};
  try {
    const user = await loginWith(String(username || '').trim(), String(password || ''), !!remember);
    res.json({ ok: true, name: user.name || null, applicant: applicantFrom(user) });
  } catch (e) {
    log.warn('login', 'login failed', { reason: e.message });
    res.status(401).json({ ok: false, error: e.message });
  }
});

app.post('/api/session/import', async (req, res) => {
  const { user, remember } = req.body || {};
  try {
    const u = await importSession(user, !!remember);
    res.json({ ok: true, name: u.name || null });
  } catch (e) {
    log.warn('login', 'session import failed', { reason: e.message });
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/logout', (_req, res) => { logout(); res.json({ ok: true }); });

// Uses an existing session or the optional saved credentials.
app.get('/api/me', async (_req, res) => {
  try {
    const user = await getUser();
    res.json({ ok: true, name: user.name || null, applicant: applicantFrom(user) });
  } catch (e) {
    res.json({ ok: false, needsLogin: e.code === 'NEEDS_LOGIN', error: e.message });
  }
});

app.post('/api/submit', async (req, res) => {
  const { batchId, caseId, time, address, lat, lon, plate, description, photoIdx, violations = [], ackOld } = req.body || {};
  const batch = batches.get(batchId);
  if (!batch) return res.status(410).json({ error: 'Sesija pasibaigė – įkelkite nuotraukas iš naujo.' });
  const p = String(plate || '').toUpperCase().replace(/\s+/g, '');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(time || '')) return res.status(400).json({ error: 'Neteisinga data ar laikas' });
  if (!PLATE_RE.test(p)) return res.status(400).json({ error: 'Neteisingas valstybinis numeris' });
  if (!address?.trim()) return res.status(400).json({ error: 'Nenurodytas adresas' });
  if (!description?.trim() || description.length > 1000) return res.status(400).json({ error: 'Aprašymas tuščias arba ilgesnis nei 1000 simbolių' });
  if (ageDays(time) > MAX_AGE_DAYS && !ackOld) {
    return res.status(409).json({ error: `Pažeidimas senesnis nei ${MAX_AGE_DAYS} d. – VMSA tokio pranešimo nenagrinės. Patvirtinkite, jei vis tiek teikiate.` });
  }
  const photos = (photoIdx || []).map(i => batch.photos[i]).filter(Boolean);
  if (!photos.length) return res.status(400).json({ error: 'Nepasirinkta nė viena nuotrauka' });
  try {
    const result = await submitReport({ time, address: address.trim(), lat, lon, plate: p, description: description.trim(), jpegs: photos.map(x => x.jpeg) });
    log.info('submit', 'registered', { id: result.id, plate: p, kets: violations.join('+') });
    const kets = [...new Set(violations.map(v => VIOLATIONS[v]?.ket).filter(Boolean))];
    const folder = archiveCase({ time, plate: p, photos, report: { time, address, lat, lon, plate: p, description, kets, ...result, submittedAt: new Date().toISOString() } });
    journalAdd({ time, address, plate: p, kets, id: result.id, folder });
    const c = batch.cases.find(x => x.id === caseId);
    if (c) c.submitted = result.id;
    res.json({ ...result, url: result.id ? `https://tvarkaumiesta.lt/pranesimai/${result.id}` : null, folder });
  } catch (e) {
    if (e.code === 'NEEDS_LOGIN') return res.status(401).json({ needsLogin: true, error: 'Prisijunkite per Vilnius Login ir pateikite dar kartą.' });
    log.error('submit', e.message);
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/journal', (_req, res) => res.json(journalRows()));

const port = +(process.env.PORT || 3000);
app.listen(port, () => log.info('server', `listening on :${port}`, { ai: activeProvider(), aiReady: aiReady(), vilniusCreds: vilniusCredsSaved() }));
