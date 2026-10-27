// Secrets live outside the image: Docker secrets mounted at /run/secrets/<name>
// (see compose.yaml). The Anthropic key can also be entered in the app; that copy is
// kept in /data/anthropic_api_key (mode 600). Values are never logged and never sent
// to the browser.
import { chmodSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.SECRETS_DIR || '/run/secrets';
const DATA = process.env.DATA_DIR || '/data';
const APP_KEY_FILE = join(DATA, 'anthropic_api_key');

function readFrom(file) {
  try {
    return readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}
const read = name => readFrom(join(DIR, name));

export const secrets = {
  vilniusUser: () => read('vilnius_username'),
  vilniusPassword: () => read('vilnius_password'),
  // Docker secret wins over the key entered in the app.
  anthropicKey: () => read('anthropic_api_key') || readFrom(APP_KEY_FILE),
  // Optional fallback for the applicant step if the account profile lacks a field.
  applicant: () => {
    const raw = read('applicant.json');
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  },
};

export function saveAppAnthropicKey(key) {
  writeFileSync(APP_KEY_FILE, key, { mode: 0o600 });
  chmodSync(APP_KEY_FILE, 0o600);
}

export function deleteAppAnthropicKey() {
  try { unlinkSync(APP_KEY_FILE); } catch { /* none */ }
}

export function secretStatus() {
  const docker = read('anthropic_api_key');
  const key = secrets.anthropicKey();
  return {
    vilnius: !!(secrets.vilniusUser() && secrets.vilniusPassword()),
    anthropic: !!key,
    anthropicSource: docker ? 'docker' : key ? 'app' : null,
    anthropicHint: key ? `…${key.slice(-4)}` : null,
  };
}
