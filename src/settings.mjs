// Settings changed in the app: /data/settings.json (AI provider, model, base URL) and
// /data/applicant.json (reporter details typed in the app). No secrets here — API keys
// are handled by secrets.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA = process.env.DATA_DIR || '/data';
const SETTINGS_FILE = join(DATA, 'settings.json');
const APPLICANT_FILE = join(DATA, 'applicant.json');

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) || {}; } catch { return {}; }
}

export const APPLICANT_FIELDS = {
  name: 'Vardas, pavardė',
  email: 'El. paštas',
  address: 'Gyvenamoji vieta',
  phone: 'Telefonas',
};

export function loadSettings() {
  const s = readJson(SETTINGS_FILE);
  return { provider: s.provider ?? null, models: s.models || {}, baseUrl: s.baseUrl || '' };
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

export function loadAppApplicant() {
  const a = readJson(APPLICANT_FILE);
  return Object.fromEntries(Object.keys(APPLICANT_FIELDS).map(k => [k, String(a[k] || '').trim()]));
}

export function saveAppApplicant(values) {
  const clean = Object.fromEntries(Object.keys(APPLICANT_FIELDS).map(k => [k, String(values?.[k] || '').trim().slice(0, 200)]));
  writeFileSync(APPLICANT_FILE, JSON.stringify(clean, null, 2), { mode: 0o600 });
  return clean;
}
