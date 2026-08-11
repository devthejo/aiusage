import { collectClaude } from './collect/claude.js';
import { collectClineLike } from './collect/cline.js';
import { collectCodex } from './collect/codex.js';
import { unsupportedHints } from './paths.js';
import { makePricer } from './pricing.js';
import { aggregate } from './aggregate.js';

/**
 * Collecte les transcripts des agents de codage présents sur la machine et
 * renvoie le rapport agrégé. Point d'entrée programmatique de la lib.
 */
export async function buildReport({ tz, offline = false, refreshPricing = false, onProgress } = {}) {
  const startedAt = Date.now();
  const zone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [pricer, claude, clineGroups] = await Promise.all([
    makePricer({ offline, refresh: refreshPricing }),
    collectClaude({ tz: zone, onProgress }),
    collectClineLike({ onProgress }),
  ]);
  const codex = collectCodex();

  return aggregate({
    claude, clineGroups, codex, pricer, tz: zone, hints: unsupportedHints(), startedAt,
  });
}

export { aggregate } from './aggregate.js';
export { renderTerminal } from './report/terminal.js';
export { renderHtml } from './report/html.js';
