#!/usr/bin/env node
/**
 * Confronte les totaux de tokens d'aiusage à ceux de ccusage, sur le périmètre
 * commun (Claude Code + Codex — ccusage ne lit pas Roo Code / Cline).
 * ccusage est la référence : tout écart au-delà du bruit est un bug chez nous.
 */
import { execFileSync } from 'node:child_process';
import { buildReport } from '../src/index.js';

const TOL = 0.5; // %, marge pour l'activité survenue entre les deux collectes

let cc;
try {
  cc = JSON.parse(execFileSync('npx', ['-y', 'ccusage@latest', 'daily', '--json'], {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  })).totals;
} catch (e) {
  console.error(`ccusage injoignable : ${e.message}`);
  process.exit(2);
}

const r = await buildReport({});
const scope = r.surfaces.filter((s) => /^(Claude|Codex)/.test(s.label));
const mine = ['input', 'output', 'cacheWrite', 'cacheRead']
  .map((k) => [k, scope.reduce((a, s) => a + s.tokens[k], 0)]);
const theirs = {
  input: cc.inputTokens, output: cc.outputTokens,
  cacheWrite: cc.cacheCreationTokens, cacheRead: cc.cacheReadTokens,
};

const f = (v) => v.toLocaleString('fr-FR').padStart(17);
let bad = 0;
console.log('  champ            aiusage          ccusage      écart');
for (const [k, v] of mine) {
  const d = theirs[k] ? ((v - theirs[k]) / theirs[k]) * 100 : 0;
  if (Math.abs(d) > TOL) bad++;
  console.log(`  ${k.padEnd(12)}${f(v)}${f(theirs[k])}   ${d >= 0 ? '+' : ''}${d.toFixed(2)} %`
    + (Math.abs(d) > TOL ? '  ✖' : ''));
}
const tm = mine.reduce((a, [, v]) => a + v, 0);
const tt = Object.values(theirs).reduce((a, v) => a + v, 0);
console.log(`  ${'TOTAL'.padEnd(12)}${f(tm)}${f(tt)}   ${((tm - tt) / tt * 100).toFixed(2)} %`);
process.exit(bad ? 1 : 0);
