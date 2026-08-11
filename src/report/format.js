const NF = new Intl.NumberFormat('fr-FR');

export const n = (v) => NF.format(Math.round(v || 0));

/** Échelle courte française : k · M (million) · Md (milliard). */
export function compact(v) {
  const x = Math.abs(v || 0);
  if (x >= 1e9) return `${(v / 1e9).toFixed(1).replace('.', ',')} Md`;
  if (x >= 1e6) return `${(v / 1e6).toFixed(x >= 1e8 ? 0 : 1).replace('.', ',')} M`;
  if (x >= 1e4) return `${Math.round(v / 1e3)} k`;
  return n(v);
}

export const pct = (v, digits = 1) =>
  `${(v * 100).toFixed(digits).replace('.', ',')} %`;

export const money = (v) => `$${NF.format(Math.round(v || 0))}`;

export const plural = (v, one, many) => `${n(v)} ${v > 1 ? many : one}`;

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août',
  'sept.', 'oct.', 'nov.', 'déc.'];

export function frDate(day) {
  if (!day) return '—';
  const [y, m, d] = day.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** Largeur affichée : les caractères hors plan multilingue de base comptent double. */
export function width(s) {
  return [...s.replace(/\[[0-9;]*m/g, '')].length;
}

export function padEnd(s, w) {
  return s + ' '.repeat(Math.max(0, w - width(s)));
}

export function padStart(s, w) {
  return ' '.repeat(Math.max(0, w - width(s))) + s;
}

const BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

/** Barre horizontale au huitième de caractère près. */
export function bar(value, max, cells) {
  if (!max || value <= 0) return '';
  const units = Math.round((value / max) * cells * 8);
  return '█'.repeat(Math.floor(units / 8)) + BLOCKS[units % 8];
}

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

export function spark(values) {
  const max = Math.max(...values, 0);
  if (!max) return ' '.repeat(values.length);
  return values.map((v) => (v <= 0 ? ' ' : SPARK[Math.min(7, Math.floor((v / max) * 7.999))])).join('');
}
