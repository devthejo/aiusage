import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const URL_LITELLM =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'aiusage');
const CACHE = join(CACHE_DIR, 'model_prices.json');
const MAX_AGE_MS = 24 * 3600 * 1000;

async function load({ offline, refresh } = {}) {
  if (!refresh) {
    try {
      if (Date.now() - statSync(CACHE).mtimeMs < MAX_AGE_MS || offline) {
        return { table: JSON.parse(readFileSync(CACHE, 'utf8')), source: 'LiteLLM (cache local)' };
      }
    } catch { /* pas de cache : on tentera le réseau */ }
  }
  if (offline) return { table: null, source: 'hors ligne, sans tarifs' };
  try {
    const res = await fetch(URL_LITELLM, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const table = await res.json();
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE, JSON.stringify(table));
    return { table, source: 'LiteLLM (à jour)' };
  } catch (e) {
    try {
      return { table: JSON.parse(readFileSync(CACHE, 'utf8')), source: 'LiteLLM (cache périmé)' };
    } catch {
      return { table: null, source: `indisponible (${e.message})` };
    }
  }
}

const base = (k) => k.slice(k.lastIndexOf('/') + 1);

/** Résout un nom de modèle de transcript vers une entrée LiteLLM. */
function resolve(model, table, index) {
  if (table[model]) return table[model];
  for (const pref of ['anthropic/', 'openai/']) {
    if (table[pref + model]) return table[pref + model];
  }
  const exact = index.get(model);
  if (exact) return table[exact];
  // le transcript porte parfois un suffixe de date que LiteLLM n'a pas, ou l'inverse
  let best = null;
  for (const key of index.keys()) {
    if (model.startsWith(key) || key.startsWith(model)) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best ? table[index.get(best)] : null;
}

export async function makePricer(opts = {}) {
  const { table, source } = await load(opts);
  const index = new Map();
  if (table) {
    for (const k of Object.keys(table)) {
      const b = base(k);
      // à nom de base égal, on garde la clé la plus courte : la variante canonique
      if (!index.has(b) || k.length < index.get(b).length) index.set(b, k);
    }
  }
  const memo = new Map();
  const unknown = new Set();

  function cost(model, { input = 0, output = 0, cacheWrite = 0, cacheWrite1h = 0, cacheRead = 0 }) {
    if (!table) return null;
    let p = memo.get(model);
    if (p === undefined) {
      p = resolve(model, table, index);
      memo.set(model, p);
      if (!p) unknown.add(model);
    }
    if (!p) return null;
    const cwRate = p.cache_creation_input_token_cost ?? (p.input_cost_per_token ?? 0) * 1.25;
    const cw1hRate = p.cache_creation_input_token_cost_above_1hr ?? cwRate;
    const crRate = p.cache_read_input_token_cost ?? (p.input_cost_per_token ?? 0) * 0.1;
    const w1 = Math.min(cacheWrite1h, cacheWrite);
    return input * (p.input_cost_per_token || 0)
      + output * (p.output_cost_per_token || 0)
      + (cacheWrite - w1) * cwRate
      + w1 * cw1hRate
      + cacheRead * crRate;
  }

  return { cost, source, available: Boolean(table), unknown };
}
