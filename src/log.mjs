// Minimal structured logging to stdout (docker logs). Never pass credentials, tokens,
// query strings or URL fragments here — use shortUrl() for URLs.
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export const log = {
  info: (scope, msg, extra) => console.log(`${ts()} INFO  [${scope}] ${msg}${fmt(extra)}`),
  warn: (scope, msg, extra) => console.warn(`${ts()} WARN  [${scope}] ${msg}${fmt(extra)}`),
  error: (scope, msg, extra) => console.error(`${ts()} ERROR [${scope}] ${msg}${fmt(extra)}`),
};

function fmt(extra) {
  if (extra == null) return '';
  return ' ' + Object.entries(extra).map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : v}`).join(' ');
}

// host + path only: OAuth state/code/accessCode live in the query and fragment.
export function shortUrl(u) {
  try { const x = new URL(u); return x.host + x.pathname; } catch { return '?'; }
}

// "jonas.jonaitis@x.lt" → "jo***@x.lt", "jonasj" → "jo***"
export function maskUser(u) {
  const s = String(u || '');
  const [name, domain] = s.split('@');
  return `${name.slice(0, 2)}***${domain ? '@' + domain : ''}`;
}
