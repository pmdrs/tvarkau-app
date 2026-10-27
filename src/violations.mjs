// The KET 150 sub-points this tool reports. `text` is the phrase used in the description.
// Write "Kelių eismo taisyklių 150.5 p.", never "KET 150.5 p.": the site's public
// anonymiser mistakes "KET 150" (3 letters + 3 digits) for a licence plate and hides it.
export const VIOLATIONS = {
  sidewalk: { ket: '150.5', label: 'Ant šaligatvio', text: 'stovi ant šaligatvio' },
  lawn: { ket: '150.5', label: 'Ant vejos / žaliosios zonos', text: 'stovi ant vejos (žaliosios zonos)' },
  blocking: { ket: '150.10', label: 'Trukdo pėstiesiems ar kitam eismui', text: 'trukdo pėsčiųjų ir kitų eismo dalyvių eismui' },
  disabled: { ket: '150.16', label: 'Neįgaliųjų vieta be kortelės', text: 'stovi neįgaliesiems skirtoje vietoje be neįgaliojo kortelės' },
  crossing: { ket: '150.4', label: 'Perėjoje arba < 5 m iki jos', text: 'stovi pėsčiųjų perėjoje arba arčiau kaip 5 m iki jos' },
  bikepath: { ket: '150.6', label: 'Ant dviračių / pėsčiųjų tako', text: 'stovi ant dviračių ar pėsčiųjų tako' },
};

export function buildDescription({ time, address, plate, violations = [], extra = '', photoCount }) {
  const [date, hm] = (time || '').split(' ');
  const keys = violations.filter(k => VIOLATIONS[k]);
  const first = keys[0] ? VIOLATIONS[keys[0]] : null;
  const rest = keys.slice(1).map(k => VIOLATIONS[k]);
  let s = `${date || '????-??-??'} apie ${hm || '??:??'} adresu ${address || '…'}, transporto priemonė ${plate || '…'}`;
  s += first ? ` ${first.text}` : ' pastatyta pažeidžiant stovėjimo tvarką';
  if (extra) s += `, ${extra.replace(/\.$/, '')}`;
  s += '.';
  if (first) s += ` Pažeistas Kelių eismo taisyklių ${first.ket} p.`;
  for (const v of rest) {
    if (v.ket === first?.ket) continue;
    s += ` Taip pat ${v.text}, Kelių eismo taisyklių ${v.ket} p.`;
  }
  s += ` ${photosPhrase(photoCount)}.`;
  return s.slice(0, 1000);
}

// 1 nuotrauka, 2–9 nuotraukos, 10–20 nuotraukų, 21 nuotrauka …
function photosPhrase(n) {
  const last = n % 10, lastTwo = n % 100;
  if (last === 1 && lastTwo !== 11) return `Pridedama ${n} nuotrauka`;
  if (last >= 2 && (lastTwo < 10 || lastTwo > 20)) return `Pridedamos ${n} nuotraukos`;
  return `Pridedama ${n} nuotraukų`;
}
