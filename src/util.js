import { statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Hash 53 bits (cyrb53). -1 est réservé : « pas de clé de dédoublonnage ». */
export function hash53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Parcours physique d'une arborescence : les symlinks de répertoire sont ignorés
 * et les inodes déjà vus écartés, sinon un alias fait compter deux fois la même
 * session (Claude Code en pose pour les chemins de devcontainer).
 */
export function walkFiles(root, { ext = '.jsonl', maxDepth = 12 } = {}) {
  const out = [];
  const seen = new Set();
  const stack = [[root, 0]];
  while (stack.length) {
    const [dir, depth] = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        stack.push([p, depth + 1]);
      } else if (e.isFile() && (ext === null || e.name.endsWith(ext))) {
        let st;
        try {
          st = statSync(p);
        } catch {
          continue;
        }
        const key = `${st.dev}:${st.ino}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(p);
      }
    }
  }
  return out.sort();
}

export function listDirs(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(root, e.name))
      .sort();
  } catch {
    return [];
  }
}

export function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** 'YYYY-MM-DD' et heure, dans le fuseau demandé. */
export function localParts(ms, tz) {
  const d = new Date(ms);
  if (!tz) {
    return [
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      d.getHours(),
    ];
  }
  const f = localParts._f ??= new Map();
  let fmt = f.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hour12: false,
    });
    f.set(tz, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return [`${p.year}-${p.month}-${p.day}`, Number(p.hour) % 24];
}

export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isoWeekStart(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd);
  return d.toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** Plus longue suite de jours consécutifs, et suite en cours. */
export function streaks(days) {
  const s = [...days].sort();
  if (!s.length) return { best: 0, current: 0 };
  let best = 1, cur = 1;
  for (let i = 1; i < s.length; i++) {
    cur = daysBetween(s[i - 1], s[i]) === 1 ? cur + 1 : 1;
    if (cur > best) best = cur;
  }
  return { best, current: cur };
}
