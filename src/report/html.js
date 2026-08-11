import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compact, money, n } from './format.js';

const TEMPLATE = fileURLToPath(new URL('../../assets/template.html', import.meta.url));
const MAX_SERIES = 7; // la palette validée tient 8 teintes ; la 8ᵉ sert au repli « Autres »

/** `claude-opus-4-8` → `Opus 4.8`. Les modèles d'autres fournisseurs restent tels quels. */
function prettyModel(m) {
  if (!m.startsWith('claude-')) return m;
  return m.slice(7)
    .replace(/-\d{8}$/, '')
    .replace(/^([a-z]+)-(.*)$/, (_, fam, ver) =>
      `${fam[0].toUpperCase()}${fam.slice(1)} ${ver.replace(/-/g, '.')}`);
}

/** Replie la traîne d'une liste triée en une entrée « Autres ». */
function fold(items, max, key = 'v') {
  if (items.length <= max) return { head: items, folded: null };
  const head = items.slice(0, max);
  const tail = items.slice(max);
  return {
    head,
    folded: { name: 'Autres', [key]: tail.reduce((a, x) => a + x[key], 0), count: tail.length },
  };
}

export function buildPayload(r) {
  const t = r.totals;
  const k = r.tokens;

  const tiles = [
    ['Messages tapés par un humain', n(t.human),
      t.humanByTool.map(([tool, v]) => `${n(v)} ${tool}`).join(' · ')],
    ['Messages produits par l’IA', compact(t.ai),
      t.human ? `${Math.round(t.ai / t.human)} réponses pour 1 message humain` : ''],
    ['Tokens vus par un modèle', compact(k.total),
      `hors relectures de cache : ${compact(k.fresh)}`],
  ];
  if (k.cost) {
    tiles.push(['Coût au tarif API public', money(k.cost),
      k.costPartial ? 'partiel — modèles sans tarif connu' : `tarifs ${r.meta.pricing}`]);
  }
  tiles.push(['Appels d’outil', compact(t.toolCalls),
    t.thinking ? `${compact(t.thinking)} blocs de réflexion` : `${n(t.toolResults)} résultats`]);
  tiles.push(['Texte tapé', `${compact(t.humanChars)} car.`,
    `l’IA en a rendu ${compact(t.aiChars)}`]);

  // séries de la timeline : on garde les plus fournies, le reste est replié
  const totals = r.timeline.series.map((_, i) =>
    r.timeline.sessions[i].reduce((a, b) => a + b, 0));
  const order = r.timeline.series
    .map((name, i) => ({ name, i, v: totals[i] }))
    .sort((a, b) => b.v - a.v);
  const { head, folded } = fold(order, MAX_SERIES);
  const series = head.map((x) => x.name);
  const values = head.map((x) => r.timeline.sessions[x.i]);
  if (folded) {
    series.push('Autres');
    values.push(r.timeline.weeks.map((_, w) =>
      order.slice(MAX_SERIES).reduce((a, x) => a + r.timeline.sessions[x.i][w], 0)));
  }

  const modelItems = r.models.filter((m) => m.tokens > 0)
    .map((m) => ({ name: prettyModel(m.name), v: m.tokens }));
  const mf = fold(modelItems, 5);
  const models = [...mf.head, ...(mf.folded ? [mf.folded] : [])];

  const notes = [];
  if (r.meta.dedup.dropped) {
    notes.push(`${n(r.meta.dedup.dropped)} entrées d’usage en double écartées sur `
      + `${n(r.meta.dedup.kept + r.meta.dedup.dropped)} — les reprises de session recopient `
      + `l’historique dans un nouveau fichier.`);
  }
  if (r.meta.unknownSurface) {
    notes.push(`${n(r.meta.unknownSurface)} session(s) d’une version trop ancienne pour porter `
      + `l’information de surface.`);
  }
  if (k.clineCost) {
    notes.push(`Roo Code / Cline déclarent eux-mêmes leur coût (${money(k.clineCost)}) — repris tel quel.`);
  }
  if (r.meta.pricingPartial) {
    notes.push(`Coût partiel : ${r.meta.unknownModels.slice(0, 5).join(', ')} sans tarif connu.`);
  }
  if (r.meta.hints.length) {
    notes.push(`Repérés sur la machine sans collecteur dédié : ${r.meta.hints.join(', ')}.`);
  }
  for (const e of r.meta.errors) {
    notes.push(`Lecture partielle : ${e.error} — ${e.files} fichiers non lus.`);
  }

  return {
    meta: {
      tz: r.meta.tz,
      generatedAt: r.meta.generatedAt,
      files: r.meta.files,
      durationMs: r.meta.durationMs,
      pricing: r.meta.pricing,
      roots: Object.entries(r.meta.roots).filter(([, v]) => v.length),
    },
    days: r.days,
    hours: r.hours,
    tiles,
    hero: { value: n(t.sessions), derived: t.sessionsDerived },
    surfaces: r.surfaces.filter((s) => s.sessions > 0)
      .map((s) => ({ name: s.label, v: s.sessions, human: s.human, ai: s.ai, tokens: s.total })),
    timeline: { weeks: r.timeline.weeks, series, values },
    tokensWeekly: { weeks: r.timeline.weeks, ...r.timeline.tokens },
    breakdown: {
      input: k.input, output: k.output, cacheWrite: k.cacheWrite, cacheRead: k.cacheRead,
      total: k.total, fresh: k.fresh, io: k.io, naive: k.naive, requests: k.requests,
    },
    models,
    tools: r.topTools.map((x) => ({ name: x.name, v: x.n })),
    projects: r.projects.map((p) => ({ name: p.name, v: p.sessions })),
    notes,
  };
}

export function renderHtml(report) {
  const payload = buildPayload(report);
  const tpl = readFileSync(TEMPLATE, 'utf8');
  // </script> dans les données casserait la balise : on neutralise la séquence
  const json = JSON.stringify(payload).replace(/<\//g, '<\\/');
  return tpl.replace('/*__DATA__*/null', json);
}
