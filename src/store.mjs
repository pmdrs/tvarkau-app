// /data layout: zurnalas.csv (journal), pranesimai/<case>/ (originals, upload JPGs, report.json).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA = process.env.DATA_DIR || '/data';
const JOURNAL = join(DATA, 'zurnalas.csv');
const HEADER = 'data_laikas;adresas;nr;ket;pranesimo_nr;aplankas\n';

export function ensureDirs() {
  mkdirSync(join(DATA, 'pranesimai'), { recursive: true });
  if (!existsSync(JOURNAL)) writeFileSync(JOURNAL, HEADER);
}

const safe = s => String(s || '').replace(/[^\p{L}\p{N}._-]+/gu, '_');

export function archiveCase({ time, plate, photos, report }) {
  // "2026-10-05 19:02" + "MIG438" → "2026-10-05_1902_MIG438"
  const name = `${(time || 'be-laiko').replace(' ', '_').replace(':', '')}_${safe(plate)}`;
  const dir = join(DATA, 'pranesimai', name);
  mkdirSync(join(dir, 'originalai'), { recursive: true });
  photos.forEach((p, i) => {
    writeFileSync(join(dir, 'originalai', safe(p.name)), p.original);
    writeFileSync(join(dir, `${String(i + 1).padStart(2, '0')}.jpg`), p.jpeg);
  });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  return name;
}

export function journalAdd({ time, address, plate, kets, id, folder }) {
  const cell = v => String(v ?? '').replace(/[;\n]/g, ',');
  appendFileSync(JOURNAL, [time, address, plate, kets.join(', '), id, folder].map(cell).join(';') + '\n');
}

export function journalRows() {
  if (!existsSync(JOURNAL)) return [];
  const [head, ...lines] = readFileSync(JOURNAL, 'utf8').trim().split('\n');
  const cols = head.split(';');
  return lines.filter(Boolean).map(l => Object.fromEntries(l.split(';').map((v, i) => [cols[i], v]))).reverse();
}
