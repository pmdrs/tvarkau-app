// An LLM reads the photos: licence plate, vehicle, which violations are visible.
// Providers: Claude API, Claude Code CLI in headless mode (`claude -p`, works with a
// subscription token), OpenAI, Google Gemini and any OpenAI-compatible endpoint.
import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyFor } from './secrets.mjs';
import { loadSettings } from './settings.mjs';
import { VIOLATIONS } from './violations.mjs';

const MAX_PHOTOS = 4;

const SCHEMA = {
  type: 'object',
  properties: {
    plate: { type: 'string', description: 'Lithuanian plate without spaces, e.g. ABC123 or EV3518; empty if unreadable' },
    plate_certain: { type: 'boolean' },
    vehicle: { type: 'string', description: 'Colour, make, model in Lithuanian, e.g. "baltas VW Scirocco"' },
    violations: { type: 'array', items: { type: 'string', enum: Object.keys(VIOLATIONS) } },
    extra: { type: 'string', description: 'Short Lithuanian clause with a visible relevant fact, e.g. "pėstieji priversti apeiti automobilį"; empty if none' },
    doubts: { type: 'string', description: 'Lithuanian note on anything uncertain (private plot? sign not visible?); empty if none' },
  },
  required: ['plate', 'plate_certain', 'vehicle', 'violations', 'extra', 'doubts'],
  additionalProperties: false,
};

const SYSTEM = `You review photos a resident took of a parked car in Vilnius, to prepare a report for tvarkaumiesta.lt.
Identify the licence plate and which of these parking violations the photos actually show:
${Object.entries(VIOLATIONS).map(([k, v]) => `- ${k}: ${v.label} (KET ${v.ket})`).join('\n')}
Only list a violation the photos support. "blocking" means pedestrians cannot pass freely on the footway or traffic is obstructed.
If the car may be on a private plot or in a marked parking space, say so in "doubts". Faces and people are irrelevant — never describe them.
Write vehicle, extra and doubts in Lithuanian.`;

// For providers without schema enforcement the schema goes into the prompt.
const JSON_HINT = `\nAnswer with a single JSON object and nothing else, matching this JSON Schema:\n${JSON.stringify(SCHEMA)}`;

export const PROVIDERS = {
  anthropic: { label: 'Claude API', secret: 'anthropic_api_key', model: 'claude-opus-5-5', keyRe: /^sk-ant-api/, keyHelp: 'console.anthropic.com → API keys (sk-ant-api…)' },
  'claude-code': { label: 'Claude Code (headless)', secret: 'claude_code_oauth_token', model: 'claude-opus-5-5', keyRe: /^sk-ant-/, keyHelp: 'Claude prenumeratos tokenas: kompiuteryje paleiskite `claude setup-token` (sk-ant-oat…), arba API raktas' },
  openai: { label: 'OpenAI', secret: 'openai_api_key', model: 'gpt-5', baseUrl: 'https://api.openai.com/v1', keyRe: /^sk-/, keyHelp: 'platform.openai.com → API keys' },
  gemini: { label: 'Google Gemini', secret: 'gemini_api_key', model: 'gemini-2.5-flash', keyRe: /^[A-Za-z0-9_-]{30,}$/, keyHelp: 'aistudio.google.com → Get API key' },
  custom: { label: 'OpenAI-suderinamas', secret: 'custom_api_key', model: '', keyOptional: true, needsBaseUrl: true, keyHelp: 'Ollama, OpenRouter, LM Studio… (raktas – jei reikia)' },
};

// Old installs only had an Anthropic key and no settings file.
export function activeProvider() {
  const s = loadSettings();
  if (s.provider) return s.provider;
  return keyFor('anthropic_api_key').value ? 'anthropic' : 'none';
}

export function providerConfig(id = activeProvider()) {
  const p = PROVIDERS[id];
  if (!p) return null;
  const s = loadSettings();
  const key = keyFor(p.secret);
  return {
    id,
    label: p.label,
    model: s.models[id] || p.model,
    baseUrl: id === 'custom' ? s.baseUrl : p.baseUrl,
    key: key.value,
    keySource: key.source,
    keyHint: key.value ? `…${key.value.slice(-4)}` : null,
  };
}

// What still has to be set for the provider to work (empty list = ready).
export function providerMissing(id = activeProvider()) {
  const p = PROVIDERS[id];
  if (!p) return [];
  const c = providerConfig(id);
  const missing = [];
  if (!c.key && !p.keyOptional) missing.push('raktas');
  if (p.needsBaseUrl && !c.baseUrl) missing.push('adresas (base URL)');
  if (!c.model) missing.push('modelis');
  return missing;
}

export const aiReady = () => activeProvider() !== 'none' && !providerMissing().length;

// Public view for the browser: never includes key values.
export function aiStatus() {
  const id = activeProvider();
  return {
    provider: id,
    ready: aiReady(),
    missing: providerMissing(id),
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([pid, p]) => {
      const c = providerConfig(pid);
      return [pid, { label: p.label, model: c.model, defaultModel: p.model, baseUrl: c.baseUrl || '', keySource: c.keySource, keyHint: c.keyHint, keyOptional: !!p.keyOptional, needsBaseUrl: !!p.needsBaseUrl, keyHelp: p.keyHelp }];
    })),
  };
}

export function checkKeyFormat(id, key) {
  const p = PROVIDERS[id];
  if (!key || !p?.keyRe || p.keyRe.test(key)) return null;
  return `Tai nepanašu į ${p.label} raktą (${p.keyHelp}).`;
}

const userText = ({ time, address }) => `Photo time: ${time || 'unknown'}. Approximate address from GPS: ${address || 'unknown'}.`;

// Keeps only what the UI expects, whatever the model returned.
function normalize(obj) {
  if (!obj || typeof obj !== 'object') return { error: 'Modelio atsakymas nėra JSON objektas – užpildykite laukus ranka.' };
  return {
    plate: String(obj.plate || ''),
    plate_certain: !!obj.plate_certain,
    vehicle: String(obj.vehicle || ''),
    violations: (Array.isArray(obj.violations) ? obj.violations : []).filter(v => VIOLATIONS[v]),
    extra: String(obj.extra || ''),
    doubts: String(obj.doubts || ''),
  };
}

// First {...} block of a text answer (models sometimes wrap JSON in prose or fences).
function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

async function httpJson(url, init, what) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(180_000) });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = body?.error?.message || body?.message || '';
    const e = new Error(`${what} klaida ${r.status}${msg ? `: ${String(msg).slice(0, 160)}` : ''}`);
    e.status = r.status;
    throw e;
  }
  return body;
}

// ---- providers ----

async function viaAnthropic(jpegs, ctx, c) {
  const client = new Anthropic({ apiKey: c.key });
  const content = [
    ...jpegs.map(b => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } })),
    { type: 'text', text: userText(ctx) },
  ];
  try {
    const res = await client.beta.messages.create({
      model: c.model,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
    if (res.stop_reason === 'refusal') return { error: 'Claude atsisakė analizuoti nuotraukas – užpildykite laukus ranka.' };
    return normalize(parseJson(res.content.find(b => b.type === 'text')?.text));
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: 'Neteisingas Anthropic API raktas.' };
    if (e instanceof Anthropic.RateLimitError) return { error: 'Claude API limitas – bandykite po minutės.' };
    if (e instanceof Anthropic.APIError) return { error: `Claude API klaida ${e.status ?? ''}`.trim() };
    throw e;
  }
}

// Claude Code CLI, headless. The photos are written to a temp dir and read with the Read
// tool (the only tool allowed); --json-schema enforces the answer shape.
function claudeEnv(key) {
  const home = join(process.env.DATA_DIR || '/data', '.claude-home');
  mkdirSync(home, { recursive: true });
  return {
    PATH: process.env.PATH,
    TZ: process.env.TZ || 'Europe/Vilnius',
    HOME: home,
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    // Subscription tokens (claude setup-token) are sk-ant-oat…, API keys sk-ant-api….
    ...(key.startsWith('sk-ant-oat') ? { CLAUDE_CODE_OAUTH_TOKEN: key } : { ANTHROPIC_API_KEY: key }),
  };
}

function runClaude(args, { cwd, key, timeout }) {
  return new Promise(resolve => {
    execFile('claude', args, { cwd, env: claudeEnv(key), timeout, maxBuffer: 10e6 }, (err, stdout, stderr) => {
      let out = null;
      try { out = JSON.parse(stdout); } catch { /* not JSON */ }
      if (out) return resolve(out);
      const why = err?.killed ? 'per ilgai užtruko' : err?.code === 'ENOENT' ? 'programa `claude` nerasta konteineryje' : (stderr || err?.message || 'nežinoma klaida').trim().split('\n').pop();
      resolve({ is_error: true, result: why });
    });
  });
}

async function viaClaudeCode(jpegs, ctx, c) {
  const dir = mkdtempSync(join(tmpdir(), 'tvarkau-'));
  try {
    const files = jpegs.map((b, i) => { const f = join(dir, `${i + 1}.jpg`); writeFileSync(f, b); return f; });
    const prompt = `${userText(ctx)}\nThe photos are these files – open each one with the Read tool:\n${files.join('\n')}`;
    const out = await runClaude([
      '-p', prompt,
      '--output-format', 'json',
      '--model', c.model,
      '--append-system-prompt', SYSTEM,
      '--json-schema', JSON.stringify(SCHEMA),
      '--tools', 'Read',
      '--allowedTools', 'Read',
      '--add-dir', dir,
    ], { cwd: dir, key: c.key, timeout: 240_000 });
    if (out.is_error) return { error: `Claude Code: ${String(out.result || 'klaida').slice(0, 200)}` };
    return normalize(out.structured_output ?? parseJson(out.result));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function viaOpenAI(jpegs, ctx, c, { strict }) {
  const body = {
    model: c.model,
    messages: [
      { role: 'system', content: strict ? SYSTEM : SYSTEM + JSON_HINT },
      { role: 'user', content: [
        { type: 'text', text: userText(ctx) },
        ...jpegs.map(b => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b.toString('base64')}` } })),
      ] },
    ],
    response_format: strict
      ? { type: 'json_schema', json_schema: { name: 'parking_report', strict: true, schema: SCHEMA } }
      : { type: 'json_object' },
  };
  const headers = { 'Content-Type': 'application/json', ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}) };
  const res = await httpJson(`${c.baseUrl.replace(/\/+$/, '')}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) }, c.label);
  const msg = res?.choices?.[0]?.message;
  if (msg?.refusal) return { error: `${c.label} atsisakė analizuoti nuotraukas – užpildykite laukus ranka.` };
  return normalize(parseJson(msg?.content));
}

async function viaGemini(jpegs, ctx, c) {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM + JSON_HINT }] },
    contents: [{ role: 'user', parts: [
      ...jpegs.map(b => ({ inline_data: { mime_type: 'image/jpeg', data: b.toString('base64') } })),
      { text: userText(ctx) },
    ] }],
    generationConfig: { responseMimeType: 'application/json' },
  };
  const res = await httpJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.key }, body: JSON.stringify(body) }, c.label);
  const text = res?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
  if (!text) return { error: `${c.label} grąžino tuščią atsakymą (${res?.candidates?.[0]?.finishReason || res?.promptFeedback?.blockReason || '?'}).` };
  return normalize(parseJson(text));
}

export async function analyzeIncident(jpegs, ctx) {
  const id = activeProvider();
  const missing = providerMissing(id);
  if (id === 'none' || missing.length) return { error: `AI nesukonfigūruotas${missing.length ? ` (${PROVIDERS[id].label}: trūksta ${missing.join(', ')})` : ''} – užpildykite laukus ranka.` };
  const c = providerConfig(id);
  const photos = jpegs.slice(0, MAX_PHOTOS);
  try {
    if (id === 'anthropic') return await viaAnthropic(photos, ctx, c);
    if (id === 'claude-code') return await viaClaudeCode(photos, ctx, c);
    if (id === 'gemini') return await viaGemini(photos, ctx, c);
    return await viaOpenAI(photos, ctx, c, { strict: id === 'openai' });
  } catch (e) {
    if (e.status === 401 || e.status === 403) return { error: `Neteisingas ${c.label} raktas arba nėra prieigos.` };
    if (e.status === 429) return { error: `${c.label} limitas – bandykite po minutės.` };
    return { error: `Analizė nepavyko: ${e.message}` };
  }
}

// ---- verification (Settings → "Patikrinti ir išsaugoti") ----

// Returns null when the provider answers with this key/model, else a Lithuanian message.
export async function verifyProvider(id, { key, model, baseUrl }) {
  const label = PROVIDERS[id]?.label || id;
  try {
    if (id === 'anthropic') {
      await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15_000 }).models.retrieve(model);
      return null;
    }
    if (id === 'claude-code') {
      const out = await runClaude(['-p', 'Reply with exactly: OK', '--output-format', 'json', '--model', model], { cwd: tmpdir(), key, timeout: 90_000 });
      return out.is_error ? `Claude Code: ${String(out.result || 'klaida').slice(0, 200)}` : null;
    }
    if (id === 'gemini') {
      await httpJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, { headers: { 'x-goog-api-key': key } }, label);
      return null;
    }
    // OpenAI and compatible: the model must be in /models.
    const res = await httpJson(`${baseUrl.replace(/\/+$/, '')}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} }, label);
    const ids = (res?.data || res?.models || []).map(m => m.id || m.name).filter(Boolean);
    if (ids.length && !ids.includes(model)) return `Modelio „${model}“ nėra (${label} siūlo: ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? '…' : ''}).`;
    return null;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e.status === 401 || (e.status === 400 && /api key/i.test(e.message))) return `${label}: raktas neteisingas arba atšauktas.`;
    if (e instanceof Anthropic.NotFoundError || e.status === 404) return `${label}: modelis „${model}“ nerastas.`;
    if (e instanceof Anthropic.PermissionDeniedError || e.status === 403) return `${label}: raktas neturi prieigos prie „${model}“.`;
    if (e instanceof Anthropic.APIError) return `${label} klaida ${e.status ?? ''}`.trim();
    return `Nepavyko pasiekti ${label}: ${e.message}`;
  }
}
