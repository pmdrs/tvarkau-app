// Thin client for the Express API. Long operations stream NDJSON events (one JSON per line).

export const getJson = async url => (await fetch(url)).json();

export const postJson = (url, body, method = 'POST') =>
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const isJson = res => (res.headers.get('content-type') || '').includes('application/json');

// Reads an NDJSON response body, calling onEvent for every line.
export async function readNdjson(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf));
}

// POST JSON whose answer is either a JSON error (validation) or an NDJSON event stream.
export async function postStream(url, body, onEvent) {
  const res = await postJson(url, body);
  if (isJson(res)) {
    const j = await res.json();
    onEvent({ type: 'error', ...j, status: res.status });
    return;
  }
  await readNdjson(res, onEvent);
}

// Multipart upload via XHR so upload progress is visible; the response is NDJSON
// and is parsed incrementally while it streams in.
export function uploadStream(url, formData, { onUpload, onEvent }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let seen = 0;
    const drain = final => {
      const text = xhr.responseText;
      const end = final ? text.length : text.lastIndexOf('\n') + 1;
      if (end <= seen) return;
      const chunk = text.slice(seen, end);
      seen = end;
      for (const line of chunk.split('\n')) if (line.trim()) onEvent(JSON.parse(line));
    };
    xhr.open('POST', url);
    xhr.upload.onprogress = e => e.lengthComputable && onUpload(e.loaded / e.total);
    xhr.upload.onload = () => onUpload(1);
    xhr.onprogress = () => { if (!xhr.getResponseHeader('content-type')?.includes('application/json')) drain(false); };
    xhr.onload = () => {
      if (xhr.getResponseHeader('content-type')?.includes('application/json')) {
        try { onEvent({ type: 'error', ...JSON.parse(xhr.responseText), status: xhr.status }); } catch { onEvent({ type: 'error', error: `HTTP ${xhr.status}` }); }
      } else drain(true);
      resolve();
    };
    xhr.onerror = () => reject(new Error('Nepavyko susisiekti su serveriu'));
    xhr.send(formData);
  });
}
