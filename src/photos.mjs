// Photo intake: HEIC/JPG → upright JPEG, EXIF time + GPS, grouping into incidents.
import exifr from 'exifr';
import heicConvert from 'heic-convert';
import sharp from 'sharp';

const isHeic = (name, buf) =>
  /\.hei[cf]$/i.test(name) || buf.subarray(4, 12).toString('latin1').match(/ftyp(heic|heix|mif1|msf1)/);

async function readExif(buf) {
  try {
    const raw = (await exifr.parse(buf, { gps: true, reviveValues: false })) || {};
    const gps = await exifr.gps(buf).catch(() => null);
    const dt = raw.DateTimeOriginal || raw.CreateDate || raw.ModifyDate;
    // "2026:10:21 13:45:02" is camera-local time (iPhone in LT = Europe/Vilnius)
    const m = dt && String(dt).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/);
    return {
      time: m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : null,
      lat: gps && Number.isFinite(gps.latitude) ? +gps.latitude.toFixed(6) : null,
      lon: gps && Number.isFinite(gps.longitude) ? +gps.longitude.toFixed(6) : null,
    };
  } catch {
    return { time: null, lat: null, lon: null };
  }
}

// Returns { name, original, jpeg, exif } — jpeg is upright, long edge ≤ 1600 px.
export async function processPhoto(name, buf) {
  let exif = await readExif(buf);
  let jpegSrc = buf;
  if (isHeic(name, buf)) {
    jpegSrc = Buffer.from(await heicConvert({ buffer: buf, format: 'JPEG', quality: 0.9 }));
  }
  if (!exif.time && !exif.lat && jpegSrc !== buf) exif = await readExif(jpegSrc);
  const jpeg = await sharp(jpegSrc).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 }).toBuffer();
  return { name, original: buf, jpeg, exif };
}

const minutes = (a, b) => Math.abs(new Date(a.replace(' ', 'T')) - new Date(b.replace(' ', 'T'))) / 60000;
const meters = (a, b) => Math.hypot((a.lat - b.lat) * 111_000, (a.lon - b.lon) * 64_000);

// Same incident = taken ≤ 30 min apart and < 150 m apart. Photos without EXIF form their own group.
export function groupIncidents(photos) {
  const dated = photos.filter(p => p.exif.time).sort((a, b) => (a.exif.time < b.exif.time ? -1 : 1));
  const groups = [];
  for (const p of dated) {
    const g = groups.at(-1);
    const last = g?.at(-1);
    const near = last && (p.exif.lat == null || last.exif.lat == null || meters(p.exif, last.exif) < 150);
    if (last && minutes(p.exif.time, last.exif.time) <= 30 && near) g.push(p);
    else groups.push([p]);
  }
  const undated = photos.filter(p => !p.exif.time);
  if (undated.length) groups.push(undated);
  return groups;
}

export function summarize(group) {
  const withGps = group.filter(p => p.exif.lat != null);
  const times = group.map(p => p.exif.time).filter(Boolean).sort();
  return {
    time: times[0] || null,
    lat: withGps.length ? +(withGps.reduce((s, p) => s + p.exif.lat, 0) / withGps.length).toFixed(6) : null,
    lon: withGps.length ? +(withGps.reduce((s, p) => s + p.exif.lon, 0) / withGps.length).toFixed(6) : null,
  };
}
