// tvarkaumiesta.lt over plain HTTP, mirroring what the site's own JS does:
//   POST api/v2/login → login.vilnius.lt (username/password) → /authorized#accessCode
//   → POST tvarkaumiesta.lt/api/login/user → user object with user_token
//   → POST api/v2/problems/register (JSON, header user_token)
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { secrets } from './secrets.mjs';

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
  const headers = { 'User-Agent': UA, ...(init.headers || {}) };
  const cookie = jar.header(url);
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, { ...init, headers, redirect: 'manual' });
  jar.store(url, res);
  return res;
}

// Follows HTTP redirects and the site's JS/meta redirects until `stop(url)` is true.
async function follow(jar, url, init, stop, hops = 15) {
  let res = await go(jar, url, init);
  for (let i = 0; i < hops; i++) {
    if (stop(url)) return { url, res };
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

  const done = await follow(jar, 'https://login.vilnius.lt/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://login.vilnius.lt/login' },
    body: new URLSearchParams({ _token: csrf, username, password }),
  }, u => u.startsWith(`${SITE}/authorized`) || /login\.vilnius\.lt\/login\b/.test(u));

  if (!done.url.startsWith(`${SITE}/authorized`)) throw new Error('Vilnius Login atmetė prisijungimą (neteisingas vartotojas ar slaptažodis?)');
  const accessCode = new URLSearchParams(done.url.split('#')[1] || '').get('accessCode');
  if (!accessCode) throw new Error('Negautas accessCode po prisijungimo');

  const fd = new FormData();
  fd.append('accessCode', accessCode);
  fd.append('loginVerifier', verifier);
  const r = await fetch(`${SITE}/api/login/user`, { method: 'POST', body: fd, headers: { 'User-Agent': UA } });
  const user = (await r.json().catch(() => null))?.data;
  if (!r.ok || !user?.user_token) throw new Error(`Token gauti nepavyko (HTTP ${r.status})`);
  memorySession = user;
  if (remember) writeFileSync(sessionFile(), JSON.stringify(user), { mode: 0o600 });
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

// Non-throwing status for the UI; never triggers a login.
export async function sessionInfo() {
  for (const user of [memorySession, (() => { try { return JSON.parse(readFileSync(sessionFile(), 'utf8')); } catch { return null; } })()]) {
    if (user && (await tokenValid(user))) return { loggedIn: true, name: user.name || null, remembered: user === memorySession ? existsSync(sessionFile()) : true };
  }
  return { loggedIn: false };
}

// What the profile gives for the applicant step; applicant.json fills any gaps.
export function applicantFrom(user) {
  const fb = secrets.applicant();
  return {
    reporter_name: user.name || fb.name || '',
    reporter_email: user.email || fb.email || '',
    reporter_address: user.address || fb.address || '',
    reporter_phone: user.phone_number || fb.phone || '',
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
