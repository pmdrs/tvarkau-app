// Secrets live outside the image: Docker secrets mounted at /run/secrets/<name>
// (see compose.yaml). AI keys can also be entered in the app; those copies are kept in
// /data/keys/<name> (mode 600). Values are never logged and never sent to the browser.
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.SECRETS_DIR || '/run/secrets';
const DATA = process.env.DATA_DIR || '/data';
const KEYS = join(DATA, 'keys');
const LEGACY_ANTHROPIC = join(DATA, 'anthropic_api_key'); // pre-provider versions

function readFrom(file) {
  try {
    return readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}
const read = name => readFrom(join(DIR, name));

// Docker secret wins over the key entered in the app.
export function keyFor(name) {
  const docker = read(name);
  if (docker) return { value: docker, source: 'docker' };
  const app = readFrom(join(KEYS, name)) || (name === 'anthropic_api_key' ? readFrom(LEGACY_ANTHROPIC) : null);
  return app ? { value: app, source: 'app' } : { value: null, source: null };
}

export function saveAppKey(name, value) {
  mkdirSync(KEYS, { recursive: true, mode: 0o700 });
  const file = join(KEYS, name);
  writeFileSync(file, value, { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function deleteAppKey(name) {
  for (const f of [join(KEYS, name), ...(name === 'anthropic_api_key' ? [LEGACY_ANTHROPIC] : [])]) {
    try { unlinkSync(f); } catch { /* none */ }
  }
}

export const secrets = {
  vilniusUser: () => read('vilnius_username'),
  vilniusPassword: () => read('vilnius_password'),
  // Reporter details from the applicant.json Docker secret (lowest priority, see applicantFrom).
  applicant: () => {
    const raw = read('applicant.json');
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; } catch { return {}; }
  },
};

export const vilniusCredsSaved = () => !!(secrets.vilniusUser() && secrets.vilniusPassword());
