// Reverse geocoding via OpenStreetMap Nominatim (1 req/s policy, identifying User-Agent).
let last = 0;

export async function reverseGeocode(lat, lon) {
  if (lat == null || lon == null) return null;
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=lt&lat=${lat}&lon=${lon}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'tvarkau-app/1.0 (self-hosted)' } });
    const a = (await r.json()).address || {};
    const street = a.road || a.pedestrian || a.footway || a.residential || '';
    const city = a.city || a.town || a.village || '';
    return [street && a.house_number ? `${street} ${a.house_number}` : street, city].filter(Boolean).join(', ') || null;
  } catch {
    return null;
  }
}
