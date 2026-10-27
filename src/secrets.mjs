// Secrets live outside the image: Docker secrets mounted at /run/secrets/<name>
// (see compose.yaml). Values are never logged and never sent to the browser.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.SECRETS_DIR || '/run/secrets';

function read(name) {
  try {
    return readFileSync(join(DIR, name), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export const secrets = {
  vilniusUser: () => read('vilnius_username'),
  vilniusPassword: () => read('vilnius_password'),
  anthropicKey: () => read('anthropic_api_key'),
  // Optional fallback for the applicant step if the account profile lacks a field.
  applicant: () => {
    const raw = read('applicant.json');
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  },
};

export function secretStatus() {
  return {
    vilnius: !!(secrets.vilniusUser() && secrets.vilniusPassword()),
    anthropic: !!secrets.anthropicKey(),
  };
}
