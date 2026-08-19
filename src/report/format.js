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

export const money = (v) => {
  const x = Math.abs(v || 0);
  // sous 10 $, l'arrondi à l'entier afficherait « $0 » pour un coût réel
  if (x && x < 10) return `$${v.toFixed(2).replace('.', ',')}`;
  return `$${NF.format(Math.round(v || 0))}`;
};

export const plural = (v, one, many) => `${n(v)} ${v > 1 ? many : one}`;

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août',
  'sept.', 'oct.', 'nov.', 'déc.'];

export function frDate(day) {
  if (!day) return '—';
  const [y, m, d] = day.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// Marques combinantes (dont sélecteurs de variante) et caractères de format
// (dont ZWJ) : rendus sans colonne propre.
const ZERO_W = /[\p{Mn}\p{Me}\p{Cf}]/u;
// Emojis + plages East Asian Wide/Fullwidth (CJK, Hangul, formes pleine chasse).
const WIDE = new RegExp('[\\p{Emoji_Presentation}'
  + '\\u1100-\\u115f\\u2e80-\\u303e\\u3041-\\u33ff\\u3400-\\u4dbf\\u4e00-\\u9fff'
  + '\\ua000-\\ua4cf\\uac00-\\ud7a3\\uf900-\\ufaff\\ufe30-\\ufe4f'
  + '\\uff00-\\uff60\\uffe0-\\uffe6]', 'u');

/** Largeur d'un caractère en colonnes de terminal : 0, 1 ou 2. */
function charWidth(ch) {
  if (ZERO_W.test(ch)) return 0;
  return ch.codePointAt(0) > 0xffff || WIDE.test(ch) ? 2 : 1;
}

/** Largeur affichée, codes ANSI ignorés. */
export function width(s) {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch);
  return w;
}

/** Tronque à `w` colonnes affichées en préservant les codes ANSI. */
export function clip(s, w) {
  if (width(s) <= w) return s;
  const hasAnsi = s.includes('\x1b');
  let out = '';
  let used = 0;
  for (const part of s.split(/(\x1b\[[0-9;]*m)/)) {
    if (/^\x1b\[[0-9;]*m$/.test(part)) { out += part; continue; }
    for (const ch of part) {
      const cw = charWidth(ch);
      if (used + cw > w - 1) return `${out}…${hasAnsi ? '\x1b[0m' : ''}`;
      out += ch;
      used += cw;
    }
  }
  return out;
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
  if (!Number.isFinite(max) || max <= 0 || value <= 0) return '';
  const units = Math.round((value / max) * cells * 8);
  return '█'.repeat(Math.floor(units / 8)) + BLOCKS[units % 8];
}

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

export function spark(values) {
  const max = Math.max(...values, 0);
  if (!Number.isFinite(max) || max <= 0) return ' '.repeat(values.length);
  return values.map((v) => (v <= 0 ? ' ' : SPARK[Math.min(7, Math.floor((v / max) * 7.999))])).join('');
}

/** Rampes 256 couleurs, du creux vers le pic. */
export const RAMPS = {
  cool: [24, 31, 38, 45, 51],           // bleu nuit → cyan
  heat: [24, 31, 38, 214, 208, 202],    // bleu nuit → orange vif
};

/** Couleur de rampe pour une intensité 0..1. */
export function ramp(t, palette = RAMPS.cool) {
  const i = Math.min(palette.length - 1, Math.max(0, Math.floor(t * palette.length)));
  return palette[i];
}

/** Sparkline où chaque cellule est teintée selon son intensité. */
export function sparkColored(values, palette = RAMPS.cool) {
  const max = Math.max(...values, 0);
  return [...spark(values)].map((g, i) =>
    (g === ' ' ? g : `\x1b[38;5;${ramp(values[i] / max, palette)}m${g}\x1b[0m`)).join('');
}

/** Barre dont chaque cellule est teintée selon sa position dans la rampe. */
export function barColored(value, max, cells, palette = RAMPS.cool) {
  return [...bar(value, max, cells)].map((ch, i) =>
    `\x1b[38;5;${ramp(i / cells, palette)}m${ch}\x1b[0m`).join('');
}
