#!/usr/bin/env node
/** Lit un rapport JSON sur stdin et vérifie qu'il est cohérent de bout en bout. */
import { readFileSync } from 'node:fs';

const r = JSON.parse(readFileSync(0, 'utf8'));
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

ok(r.totals.sessions > 0, 'aucune session collectée');
ok(r.meta.files > 0, 'aucun fichier lu');
ok(r.days.first && r.days.last, 'bornes temporelles absentes');
ok(r.days.active > 0 && r.days.active <= r.days.span, 'jours actifs incohérents');
ok(r.days.best >= r.days.current, 'la plus longue série est inférieure à la série en cours');

const k = r.tokens;
ok(k.total === k.input + k.output + k.cacheWrite + k.cacheRead, 'total ≠ somme des composantes');
ok(k.fresh === k.input + k.output + k.cacheWrite, 'périmètre « hors relectures » incohérent');
ok(k.io === k.input + k.output, 'périmètre « input + output » incohérent');
ok(k.fresh <= k.total && k.io <= k.fresh, 'les périmètres ne sont pas emboîtés');
ok(k.cacheWrite1h <= k.cacheWrite, 'le cache 1 h dépasse l’écriture de cache totale');

const surfTotal = r.surfaces.reduce((a, s) => a + s.total, 0);
ok(Math.abs(surfTotal - k.total) < 1, `somme des surfaces (${surfTotal}) ≠ total (${k.total})`);
const surfSessions = r.surfaces.reduce((a, s) => a + s.sessions, 0);
ok(surfSessions === r.totals.sessions, 'somme des sessions par surface ≠ total');

ok(r.timeline.series.length === r.timeline.sessions.length, 'séries et valeurs désaccordées');
for (const row of r.timeline.sessions) {
  ok(row.length === r.timeline.weeks.length, 'longueur de série ≠ nombre de semaines');
}
for (const key of ['total', 'fresh', 'io']) {
  ok(r.timeline.tokens[key].length === r.timeline.weeks.length, `timeline.${key} mal dimensionnée`);
}
ok(r.hours.localHuman.length === 24 && r.hours.utcHuman.length === 24, 'histogramme horaire ≠ 24');
ok(r.models.every((m) => m.tokens >= 0), 'tokens négatifs sur un modèle');

if (fails.length) {
  console.error('✖ rapport incohérent :');
  for (const f of fails) console.error(`   · ${f}`);
  process.exit(1);
}
console.log(`✔ rapport cohérent — ${r.totals.sessions.toLocaleString('fr-FR')} sessions, `
  + `${(k.total / 1e9).toFixed(1)} Md tokens, ${r.meta.files.toLocaleString('fr-FR')} fichiers`);
