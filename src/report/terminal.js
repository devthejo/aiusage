import { n, compact, pct, money, frDate, padEnd, padStart, bar, spark, width } from './format.js';

const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const mk = (code) => (s) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = {
  b: mk(1), dim: mk(2), blue: mk(38, 5), cyan: mk(36), grey: mk(90),
  accent: mk('38;5;39'), warn: mk('38;5;214'), ok: mk('38;5;35'),
};

export function renderTerminal(r, { width: termWidth = process.stdout.columns || 100 } = {}) {
  const W = Math.max(72, Math.min(termWidth - 2, 108));
  const L = [];
  const out = (s = '') => L.push(s);

  const rule = (ch = '─') => c.grey(ch.repeat(W));
  const title = (t) => {
    out('');
    out(c.b(t.toUpperCase()));
    out(rule('━'));
  };
  const kv = (k, v, note) => out(
    `  ${padEnd(k, 34)}${padStart(c.b(v), 16)}${note ? `  ${c.grey(note)}` : ''}`,
  );

  // ── en-tête ──────────────────────────────────────────────────────────────
  out('');
  out(c.b(c.accent('  ai-agent-stats')) + c.grey(`  ·  agents de codage sur cette machine`));
  out('');
  const d = r.days;
  out(c.grey(`  ${frDate(d.first)} → ${frDate(d.last)}  ·  ${n(d.active)} jours actifs sur ${n(d.span)}`
    + `  ·  plus longue série ${n(d.best)} j  ·  fuseau ${r.meta.tz}`));

  // ── chiffres de tête ─────────────────────────────────────────────────────
  title('Vue d’ensemble');
  kv('Conversations', n(r.totals.sessions),
    r.totals.sessionsDerived ? `+ ${n(r.totals.sessionsDerived)} transcripts de sous-agents` : '');
  kv('Messages tapés par un humain', n(r.totals.human),
    r.totals.humanByTool.map(([k, v]) => `${k} ${n(v)}`).join(' · '));
  kv('Messages produits par l’IA', compact(r.totals.ai),
    r.totals.human ? `${Math.round(r.totals.ai / r.totals.human)} pour 1 message humain` : '');
  kv('Tokens vus par un modèle', compact(r.tokens.total), 'cache compris');
  kv('… hors relectures de cache', compact(r.tokens.fresh),
    r.tokens.total ? pct(r.tokens.fresh / r.tokens.total) + ' du total' : '');
  if (r.tokens.cost) {
    kv('Coût au tarif API public', money(r.tokens.cost),
      r.tokens.costPartial ? 'partiel : modèles non tarifés' : `tarifs ${r.meta.pricing}`);
  }
  kv('Appels d’outil', compact(r.totals.toolCalls),
    r.totals.thinking ? `${compact(r.totals.thinking)} blocs de réflexion` : '');

  // ── surfaces ─────────────────────────────────────────────────────────────
  title('Sessions par surface');
  const maxS = Math.max(...r.surfaces.map((s) => s.sessions), 1);
  const labelW = Math.min(34, Math.max(...r.surfaces.map((s) => width(s.label))) + 1);
  const barW = Math.max(8, W - labelW - 40);
  out(`  ${padEnd(c.grey('surface'), labelW)}${padStart(c.grey('sessions'), 9)} `
    + `${padStart(c.grey('humain'), 8)} ${padStart(c.grey('IA'), 8)} ${padStart(c.grey('tokens'), 9)}`);
  for (const s of r.surfaces) {
    if (!s.sessions && !s.total) continue;
    out(`  ${padEnd(s.label.slice(0, labelW - 1), labelW)}`
      + `${padStart(n(s.sessions), 9)} ${padStart(n(s.human), 8)} `
      + `${padStart(compact(s.ai), 8)} ${padStart(compact(s.total), 9)}`
      + `  ${c.accent(bar(s.sessions, maxS, Math.max(6, barW - 6)))}`);
  }
  if (r.meta.unknownSurface) {
    out(c.grey(`  ${n(r.meta.unknownSurface)} session(s) d’une version trop ancienne pour porter la surface.`));
  }

  // ── messages ─────────────────────────────────────────────────────────────
  title('Messages');
  const t = r.totals;
  kv('Tapés par un humain', n(t.human),
    `dont ${n(t.humanAnswer)} réponses à une question, ${n(t.humanCmd)} commandes /`);
  if (t.programmatic) {
    kv('Prompts émis par du code (SDK)', n(t.programmatic),
      t.programmaticFlagged ? `dont ${n(t.programmaticFlagged)} marqués promptSource=sdk` : '');
  }
  if (t.agentPrompts) kv('Prompts d’orchestration IA→sous-agent', n(t.agentPrompts));
  kv('Réponses de l’IA', n(t.ai));
  kv('Résultats d’outil', n(t.toolResults));
  kv('Caractères tapés', compact(t.humanChars), `l’IA en a rendu ${compact(t.aiChars)}`);

  // ── tokens ───────────────────────────────────────────────────────────────
  title('Tokens');
  const k = r.tokens;
  const rows = [
    ['input', k.input], ['output', k.output],
    ['écriture de cache', k.cacheWrite], ['relecture de cache', k.cacheRead],
  ];
  for (const [label, v] of rows) {
    out(`  ${padEnd(label, 34)}${padStart(n(v), 18)}  `
      + `${padStart(k.total ? pct(v / k.total) : '—', 7)}  ${c.accent(bar(v, k.total, 20))}`);
  }
  out(`  ${padEnd(c.b('total'), 34)}${padStart(c.b(n(k.total)), 18)}  ${padStart(compact(k.total), 7)}`);
  out('');
  kv('Hors relectures de cache', compact(k.fresh), 'input + output + écriture de cache');
  kv('Input + output seuls', compact(k.io), 'cache entièrement retiré');
  kv('Compteur naïf, non dédoublonné', compact(k.naive),
    'ce qu’affiche un panneau qui ignore le cache');
  out(c.grey(`  ${n(r.meta.dedup.dropped)} entrées en double écartées sur `
    + `${n(r.meta.dedup.kept + r.meta.dedup.dropped)} (reprises de session).`));

  if (r.models.length) {
    out('');
    out(`  ${padEnd(c.grey('modèle'), 32)}${padStart(c.grey('tokens'), 10)} `
      + `${padStart(c.grey('part'), 7)} ${padStart(c.grey('requêtes'), 9)} ${padStart(c.grey('coût'), 9)}`);
    for (const m of r.models.slice(0, 10)) {
      if (!m.tokens) continue;
      out(`  ${padEnd(m.name.slice(0, 31), 32)}${padStart(compact(m.tokens), 10)} `
        + `${padStart(pct(m.share), 7)} ${padStart(n(m.requests), 9)} `
        + `${padStart(m.cost === null ? c.grey('—') : money(m.cost), 9)}`);
    }
  }

  // ── rythme ───────────────────────────────────────────────────────────────
  const hh = r.hours.localHuman;
  if (Math.max(...hh) > 0) {
    title('Rythme');
    out(`  ${c.grey('messages humains par heure locale')}`);
    out(`  ${c.accent(spark(hh))}`);
    out(`  ${c.grey('0h'.padEnd(6) + '6h'.padEnd(6) + '12h'.padEnd(6) + '18h'.padEnd(5) + '23h')}`);
    kv('Heure de pointe', `${r.hours.peakLocal} h`,
      `${r.hours.peakUtc} h UTC · ${n(Math.max(...hh))} messages`);
  }
  const all = r.timeline.tokens.total;
  const from = all.findIndex((v) => v > 0);
  if (from !== -1) {
    const tw = all.slice(from);
    const w0 = r.timeline.weeks[from];
    const w1 = r.timeline.weeks[r.timeline.weeks.length - 1];
    out('');
    out(`  ${c.grey(`tokens par semaine — ${frDate(w0)} → ${frDate(w1)}, `
      + `pic ${compact(Math.max(...tw))}`)}`);
    out(`  ${c.accent(spark(tw))}`);
  }

  // ── contexte ─────────────────────────────────────────────────────────────
  if (r.projects.length > 1) {
    title('Où');
    const maxP = r.projects[0].sessions;
    for (const p of r.projects.slice(0, 8)) {
      out(`  ${padStart(n(p.sessions), 7)}  ${c.accent(bar(p.sessions, maxP, 14))} `
        + c.grey(' ') + p.name.slice(0, W - 30));
    }
  }
  if (r.topTools.length) {
    title('Outils appelés par l’IA');
    const maxT = r.topTools[0].n;
    for (const x of r.topTools.slice(0, 8)) {
      out(`  ${padEnd(x.name.slice(0, 26), 27)}${padStart(compact(x.n), 9)}  `
        + c.accent(bar(x.n, maxT, 24)));
    }
  }

  // ── notes ────────────────────────────────────────────────────────────────
  const notes = [];
  if (r.meta.pricingPartial) {
    notes.push(`Coût partiel : ${r.meta.unknownModels.slice(0, 4).join(', ')} sans tarif connu.`);
  }
  if (r.tokens.clineCost) {
    notes.push(`Roo Code / Cline déclarent eux-mêmes ${money(r.tokens.clineCost)} — repris tel quel.`);
  }
  if (r.meta.hints.length) {
    notes.push(`Repérés sans collecteur : ${r.meta.hints.join(', ')}.`);
  }
  for (const e of r.meta.errors) notes.push(`Lecture partielle : ${e.error} (${e.files} fichiers).`);
  if (notes.length) {
    title('Notes');
    for (const x of notes) out(c.grey(`  · ${x}`));
  }
  out('');
  out(c.grey(`  ${n(r.meta.files)} fichiers lus en ${(r.meta.durationMs / 1000).toFixed(1)} s`
    + `  ·  tarifs : ${r.meta.pricing}`));
  out('');

  return L.join('\n');
}
