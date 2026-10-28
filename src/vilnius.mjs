// tvarkaumiesta.lt over plain HTTP, mirroring what the site's own JS does:
//   POST api/v2/login → login.vilnius.lt (username/password) → /authorized#accessCode
//   → POST tvarkaumiesta.lt/api/login/user → user object with user_token
//   → POST api/v2/problems/register (JSON, header user_token)
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log, maskUser, shortUrl } from './log.mjs';
import { secrets } from './secrets.mjs';
import { loadAppApplicant } from './settings.mjs';

const API = 'https://api-tvarkau.vilnius.lt/api/v2/';
const SITE = 'https://tvarkaumiesta.lt';
const CLIENT_KEY = 'VCA4NAON9BWXDUGE2BVNBXNAP2VXC7QKIFHES7A6G4EH8VN9I05N8SH0WEHNYJBPWHVAD2H2RI'; // public, from the site bundle
export const PARKING_TYPE = 20; // "Transporto priemonių stovėjimo tvarkos pažeidimai"
const CITY_VILNIUS = 1;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const sessionFile = () => join(process.env.DATA_DIR || '/data', 'session.json');

class Jar {
  cookies = [];
  store(url, res) {
    const host = new URL(url).hostname;
    for (const line of res.headers.getSetCookie?.() || []) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const dom = attrs.map(a => a.trim()).find(a => /^domain=/i.test(a));
      const domain = dom ? dom.slice(7).replace(/^\./, '').toLowerCase() : host;
      this.cookies = this.cookies.filter(c => !(c.name === name && c.domain === domain));
      this.cookies.push({ name, value, domain });
    }
  }
  header(url) {
    const host = new URL(url).hostname;
    return this.cookies.filter(c => host === c.domain || host.endsWith('.' + c.domain)).map(c => `${c.name}=${c.value}`).join('; ');
  }
}

async function go(jar, url, init = {}) {
  const headers = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'lt,en;q=0.8', ...(init.headers || {}) };
  const cookie = jar.header(url);
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, { ...init, headers, redirect: 'manual' });
  jar.store(url, res);
  const loc = res.headers.get('location');
  log.info('login', `${init.method || 'GET'} ${shortUrl(url)} → ${res.status}${loc ? ' → ' + shortUrl(new URL(loc, url).toString()) : ''}`);
  return res;
}

// Follows HTTP redirects and the site's JS/meta redirects until a *new* URL satisfies
// `stop(url)`. The starting URL is never tested: after POST /login the start URL is the
// login page itself, and testing it made every login look like a rejection.
async function follow(jar, url, init, stop, hops = 15) {
  let res = await go(jar, url, init);
  for (let i = 0; i < hops; i++) {
    let next = null;
    if (res.status >= 300 && res.status < 400) next = res.headers.get('location');
    else if (res.status === 200 && (res.headers.get('content-type') || '').includes('html')) {
      const html = await res.clone().text();
      next = (html.match(/location\.href\s*=\s*['"]([^'"]+)/) || html.match(/http-equiv=["']refresh["'][^>]*url=([^"'>]+)/i) || [])[1];
    }
    if (!next) return { url, res };
    url = new URL(next.replace(/&amp;/g, '&'), url).toString();
    if (stop(url)) return { url, res };
    res = await go(jar, url);
  }
  throw new Error('Per daug nukreipimų prisijungiant');
}

// First visible error/alert text on a Vilnius Login page (Laravel validation, flash messages).
function pageError(html) {
  const m = html.match(/class="[^"]*\b(invalid-feedback|alert(?:-danger|-warning)?|text-danger|help-block|error)\b[^"]*"[^>]*>([\s\S]{0,400}?)<\/(?:div|span|p|strong|li)>/i);
  return m ? m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

// Builds the query of the "stay logged in?" form, or null if the page is something else.
function stayLoggedForm(html, stayLogged) {
  const m = html.match(/<form[^>]*action="https:\/\/login\.vilnius\.lt\/oauth\/authorize"[^>]*>([\s\S]*?)<\/form>/i);
  if (!m || !/name="loggedin_choice"/.test(m[1])) return null;
  const params = new URLSearchParams();
  const attr = (tag, a) => (tag.match(new RegExp(`\\b${a}="([^"]*)"`, 'i')) || [])[1];
  const radios = new Map();
  for (const [tag] of m[1].matchAll(/<input\b[^>]*>/gi)) {
    const name = attr(tag, 'name');
    if (!name) continue;
    const type = (attr(tag, 'type') || 'text').toLowerCase();
    const value = (attr(tag, 'value') ?? '').replace(/&amp;/g, '&');
    if (name === 'stay_logged') { if (stayLogged) params.set(name, value || 'on'); continue; }
    if (type === 'checkbox') { if (/\bchecked\b/i.test(tag)) params.append(name, value || 'on'); continue; }
    if (type === 'radio') { if (!radios.has(name) || /\bchecked\b/i.test(tag)) radios.set(name, value); continue; }
    params.append(name, value);
  }
  for (const [name, value] of radios) params.set(name, value);
  return params;
}

// Structure of an unexpected page for the log: no field values, only names and labels.
function pageShape(html) {
  const text = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return {
    title: text((html.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1]),
    headings: [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map(m => text(m[1])).filter(Boolean).slice(0, 5).join(' | '),
    forms: [...html.matchAll(/<form[^>]*>/gi)].map(m => `${(m[0].match(/method="([^"]+)"/i) || [, 'GET'])[1]} ${shortUrl((m[0].match(/action="([^"]+)"/i) || [, ''])[1])}`).join(' | '),
    inputs: [...new Set([...html.matchAll(/<input[^>]*name="([^"]+)"/gi)].map(m => m[1]))].join(','),
    buttons: [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)].map(m => text(m[1])).filter(Boolean).slice(0, 6).join(' | '),
  };
}

export class NeedsLogin extends Error {
  constructor() { super('Reikia prisijungti per Vilnius Login'); this.code = 'NEEDS_LOGIN'; }
}

// The password is only used for this one request chain; it is never stored.
// What can be kept is the resulting session (user_token): in memory, or in
// /data/session.json when `remember` is set.
let memorySession = null;

async function login(username, password, { remember = true } = {}) {
  if (!username || !password) throw new NeedsLogin();
  const jar = new Jar();
  const verifier = randomBytes(32).toString('hex');

  const start = await go(jar, API + 'login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ redirectUrl: `${SITE}/authorized`, clientKey: CLIENT_KEY, loginVerifier: verifier }),
  });
  const authUrl = (await start.text()).match(/https:\/\/login\.vilnius\.lt\/oauth\/authorize[^'"]+/)?.[0];
  if (!authUrl) throw new Error(`Prisijungimo pradžia nepavyko (HTTP ${start.status})`);

  const atForm = await follow(jar, authUrl.replace(/&amp;/g, '&'), {}, u => /login\.vilnius\.lt\/login\b/.test(u));
  const formRes = atForm.res.status === 200 ? atForm.res : await go(jar, atForm.url);
  const csrf = (await formRes.text()).match(/name="_token"\s+value="([^"]+)"/)?.[1];
  if (!csrf) throw new Error('Nerasta Vilnius Login forma');

  log.info('login', 'submitting Vilnius Login form', { user: maskUser(username) });
  const stopAt = u => u.startsWith(`${SITE}/authorized`) || /login\.vilnius\.lt\/login(\?|$)/.test(u);
  let done = await follow(jar, 'https://login.vilnius.lt/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://login.vilnius.lt/login', Origin: 'https://login.vilnius.lt' },
    body: new URLSearchParams({ _token: csrf, username, password }),
  }, stopAt);

  // Interstitial "stay logged in?" page: a GET form back to /oauth/authorize with the
  // OAuth params, a `loggedin_choice` field and a `stay_logged` checkbox. Submit it like
  // the "Tęsti" button would, ticking stay_logged only when the user chose "Likti prisijungus".
  if (/login\.vilnius\.lt\/oauth\/authorize/.test(done.url) && done.res.status === 200) {
    const html = await done.res.clone().text();
    const form = stayLoggedForm(html, remember);
    if (form) {
      log.info('login', 'answering stay-logged-in choice', { stayLogged: remember, fields: [...form.keys()].join(',') });
      done = await follow(jar, `https://login.vilnius.lt/oauth/authorize?${form}`, { headers: { Referer: done.url } }, stopAt);
    }
  }

  if (!done.url.startsWith(`${SITE}/authorized`)) {
    const at = shortUrl(done.url);
    const page = done.res.status >= 300 && done.res.status < 400 ? await (await go(jar, done.url)).text() : await done.res.text().catch(() => '');
    const msg = pageError(page);
    log.warn('login', 'Vilnius Login did not return to tvarkaumiesta', { at, status: done.res.status, message: msg || '-' });
    log.warn('login', 'page shape', pageShape(page));
    log.warn('login', 'cookies held', { names: jar.cookies.map(c => `${c.name}@${c.domain}`).join(',') });
    if (/login\.vilnius\.lt\/login$/.test(at)) {
      throw new Error(`Vilnius Login atmetė prisijungimą${msg ? `: „${msg}“` : ' – patikrinkite vartotojo vardą (ne el. paštą, jei jie skiriasi) ir slaptažodį'}.`);
    }
    if (/\/oauth\/authorize$/.test(at)) {
      throw new Error('Vilnius Login po prisijungimo parodė netikėtą puslapį – jo struktūra įrašyta į programos logą.');
    }
    throw new Error(`Prisijungimas sustojo ties ${at} (HTTP ${done.res.status})${msg ? `: „${msg}“` : ''}.`);
  }
  // The site reads it from the query string (?accessCode=…); accept a fragment too.
  const back = new URL(done.url);
  const accessCode = back.searchParams.get('accessCode') || new URLSearchParams(back.hash.slice(1)).get('accessCode');
  if (!accessCode) {
    log.error('login', 'no accessCode on return URL', { params: [...back.searchParams.keys(), ...new URLSearchParams(back.hash.slice(1)).keys()].join(',') || '-' });
    throw new Error('Negautas accessCode po prisijungimo');
  }
  log.info('login', 'got accessCode, exchanging for user token');

  const fd = new FormData();
  fd.append('accessCode', accessCode);
  fd.append('loginVerifier', verifier);
  const r = await fetch(`${SITE}/api/login/user`, { method: 'POST', body: fd, headers: { 'User-Agent': UA } });
  const user = (await r.json().catch(() => null))?.data;
  if (!r.ok || !user?.user_token) {
    log.error('login', 'token exchange failed', { status: r.status });
    throw new Error(`Token gauti nepavyko (HTTP ${r.status})`);
  }
  log.info('login', 'logged in', { userId: user.id, remember });
  memorySession = user;
  if (remember) writeFileSync(sessionFile(), JSON.stringify(user), { mode: 0o600 });
  return user;
}

// Session handed over from the user's own browser (tvarkaumiesta.lt localStorage "user"),
// so the login itself — consent pages, e-valdžios vartai — happens in their browser.
export async function importSession(user, remember) {
  if (!user?.id || !user?.user_token) throw new Error('Netinkami sesijos duomenys');
  if (!(await tokenValid(user))) throw new Error('tvarkaumiesta.lt sesija nebegalioja – prisijunkite svetainėje iš naujo');
  logout();
  memorySession = user;
  if (remember) writeFileSync(sessionFile(), JSON.stringify(user), { mode: 0o600 });
  log.info('login', 'session imported from browser', { userId: user.id, remember });
  return user;
}

export async function loginWith(username, password, remember) {
  logout();
  return login(username, password, { remember });
}

export function logout() {
  memorySession = null;
  try { unlinkSync(sessionFile()); } catch { /* none */ }
}

async function tokenValid(user) {
  try {
    const r = await fetch(`${API}token/check?user_id=${user.id}`, { headers: { user_token: user.user_token } });
    const exp = (await r.json())?.data?.expires;
    return r.ok && exp && exp * 1000 > Date.now() + 5 * 60_000;
  } catch {
    return false;
  }
}

// Session order: memory → /data/session.json → saved credentials (Docker secrets, optional).
export async function getUser() {
  if (memorySession && (await tokenValid(memorySession))) return memorySession;
  try {
    const user = JSON.parse(readFileSync(sessionFile(), 'utf8'));
    if (await tokenValid(user)) return (memorySession = user);
  } catch { /* no cached session */ }
  return login(secrets.vilniusUser(), secrets.vilniusPassword());
}

// Valid session user (memory or /data/session.json) or null; never triggers a login.
export async function currentUser() {
  for (const user of [memorySession, (() => { try { return JSON.parse(readFileSync(sessionFile(), 'utf8')); } catch { return null; } })()]) {
    if (user && (await tokenValid(user))) return user;
  }
  return null;
}

// Non-throwing status for the UI; never triggers a login.
export async function sessionInfo() {
  const user = await currentUser();
  if (!user) return { loggedIn: false };
  return { loggedIn: true, name: user.name || null, remembered: user === memorySession ? existsSync(sessionFile()) : true };
}

// Applicant step: values typed in the app → Vilnius Login profile → applicant.json secret.
export function applicantFrom(user) {
  const app = loadAppApplicant();
  const fb = secrets.applicant();
  const pick = (key, profile) => app[key] || profile || fb[key] || '';
  return {
    reporter_name: pick('name', user?.name),
    reporter_email: pick('email', user?.email),
    reporter_address: pick('address', user?.address),
    reporter_phone: pick('phone', user?.phone_number),
  };
}

export async function submitReport({ time, address, lat, lon, plate, description, jpegs }) {
  const user = await getUser();
  const body = {
    type: PARKING_TYPE,
    city_id: CITY_VILNIUS,
    violation_date_time: time,
    user_id: user.id,
    address,
    description,
    latitude: lat ?? 0,
    longitude: lon ?? 0,
    car_plate_no: plate,
    delete_files: [],
    ...applicantFrom(user),
    files: jpegs.map(b => b.toString('base64')),
    serial_number: Math.floor(Date.now() / 1000),
  };
  const r = await fetch(`${API}problems/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', user_token: user.user_token, 'User-Agent': UA },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`tvarkaumiesta.lt atmetė pranešimą (HTTP ${r.status}): ${txt.slice(0, 300)}`);
  const data = (() => { try { return JSON.parse(txt)?.data; } catch { return null; } })();
  return { id: data?.id ?? (await latestReportId(user)), message: data?.successMessage || null };
}

async function latestReportId(user) {
  try {
    const r = await fetch(`${API}problems?user_id=${user.id}`, { headers: { user_token: user.user_token } });
    const list = (await r.json())?.data || [];
    const ids = list.map(p => p.id ?? p.problemId ?? p.problemData?.id).filter(Number.isFinite);
    return ids.length ? Math.max(...ids) : null;
  } catch {
    return null;
  }
}
