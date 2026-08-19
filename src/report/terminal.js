import {
  n, compact, pct, money, frDate, padEnd, padStart, clip, stripAnsi,
  sparkColored, barColored, ramp, RAMPS, width,
} from './format.js';

const mk = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const c = { b: mk(1), grey: mk(90), accent: mk('38;5;39') };

/** Dégradé de couleur caractère par caractère, en gras. */
function gradient(s, palette = RAMPS.cool) {
  const chars = [...s];
  return chars.map((ch, i) =>
    `\x1b[1m\x1b[38;5;${ramp(i / chars.length, palette)}m${ch}`).join('') + '\x1b[0m';
}

// Les chaînes issues des transcripts (noms d'outils MCP, de projets, de modèles)
// peuvent porter des caractères de contrôle qui casseraient le cadre.
const sanitize = (s) => String(s).replace(/\p{Cc}/gu, ' ');

export function renderTerminal(r, {
  width: termWidth = process.stdout.columns || 100,
  color = Boolean(process.stdout.isTTY && !process.env.NO_COLOR),
} = {}) {
  const colorOn = color;
  const W = Math.max(56, Math.min(termWidth - 2, 108));
  const inner = W - 6; // place utile entre les bords « │  …  │ »
  const L = [];
  // Tout passe par ici : les couleurs se posent librement en amont,
  // et tombent d'un seul coup quand le terminal n'en veut pas.
  const out = (s = '') => L.push(colorOn ? s : stripAnsi(s));

  /** Encadre un bloc : ╭─ TITRE ─…─╮ │ … │ ╰─…─╯ */
  const box = (title, lines) => {
    const t = ` ${title.toUpperCase()} `;
    out('');
    out(c.grey('╭─') + c.b(c.accent(t)) + c.grey('─'.repeat(Math.max(0, W - 3 - width(t))) + '╮'));
    for (const line of lines) {
      out(`${c.grey('│')}  ${padEnd(clip(line, inner), inner)}  ${c.grey('│')}`);
    }
    out(c.grey(`╰${'─'.repeat(W - 2)}╯`));
  };
  const kv = (k, v, note) => `${padEnd(k, 32)}${padStart(c.b(v), 16)}${note ? `  ${c.grey(note)}` : ''}`;

  // ── en-tête ──────────────────────────────────────────────────────────────
  const d = r.days;
  out('');
  out(clip(`  ✨ ${gradient('ai-agent-stats')}${c.grey('  ·  agents de codage sur cette machine')}`, W));
  out(clip(c.grey(`     ${frDate(d.first)} → ${frDate(d.last)}  ·  ${n(d.active)} jours actifs sur ${n(d.span)}`
    + `  ·  🔥 série de ${n(d.best)} j  ·  fuseau ${r.meta.tz}`), W));

  // ── vue d'ensemble ───────────────────────────────────────────────────────
  const t = r.totals;
  const aiPerHuman = t.human ? Math.round(t.ai / t.human) : 0;
  const overview = [
    kv('Conversations', n(t.sessions),
      t.sessionsDerived ? `+ ${n(t.sessionsDerived)} transcripts de sous-agents` : ''),
    kv('Messages tapés par un humain', n(t.human),
      t.humanByTool.map(([k, v]) => `${k} ${n(v)}`).join(' · ')),
    kv('Messages produits par l’IA', compact(t.ai),
      aiPerHuman ? `${aiPerHuman} pour 1 message humain` : ''),
    kv('Tokens vus par un modèle', compact(r.tokens.total), 'cache compris'),
    kv('… hors relectures de cache', compact(r.tokens.fresh),
      r.tokens.total ? `${pct(r.tokens.fresh / r.tokens.total)} du total` : ''),
  ];
  if (r.tokens.cost) {
    overview.push(kv('Coût au tarif API public', money(r.tokens.cost),
      r.tokens.costPartial ? 'partiel : modèles non tarifés' : `tarifs ${r.meta.pricing}`));
  }
  overview.push(kv('Appels d’outil', compact(t.toolCalls),
    t.thinking ? `${compact(t.thinking)} blocs de réflexion` : ''));
  box('Vue d’ensemble', overview);

  // ── surfaces ─────────────────────────────────────────────────────────────
  const maxS = Math.max(...r.surfaces.map((s) => s.sessions), 1);
  const labelW = Math.min(34, Math.max(...r.surfaces.map((s) => width(s.label)), 7) + 1, inner - 38);
  const barW = inner - labelW - 40; // < 6 : pas la place, la barre saute
  const surfaces = [`${padEnd(c.grey('surface'), labelW)}${padStart(c.grey('sessions'), 9)} `
    + `${padStart(c.grey('humain'), 8)} ${padStart(c.grey('IA'), 8)} ${padStart(c.grey('tokens'), 9)}`];
  for (const s of r.surfaces) {
    if (!s.sessions && !s.total) continue;
    surfaces.push(`${padEnd(clip(sanitize(s.label), labelW - 1), labelW)}`
      + `${padStart(n(s.sessions), 9)} ${padStart(n(s.human), 8)} `
      + `${padStart(compact(s.ai), 8)} ${padStart(compact(s.total), 9)}`
      + (barW >= 6 ? `  ${barColored(s.sessions, maxS, barW)}` : ''));
  }
  if (r.meta.unknownSurface) {
    surfaces.push(c.grey(`${n(r.meta.unknownSurface)} session(s) d’une version trop ancienne pour porter la surface.`));
  }
  box('Sessions par surface', surfaces);

  // ── messages ─────────────────────────────────────────────────────────────
  const messages = [
    kv('Tapés par un humain', n(t.human),
      `dont ${n(t.humanAnswer)} réponses à une question, ${n(t.humanCmd)} commandes /`),
  ];
  if (t.programmatic) {
    messages.push(kv('Prompts émis par du code (SDK)', n(t.programmatic),
      t.programmaticFlagged ? `dont ${n(t.programmaticFlagged)} marqués promptSource=sdk` : ''));
  }
  if (t.agentPrompts) messages.push(kv('Prompts d’orchestration IA→sous-agent', n(t.agentPrompts)));
  messages.push(kv('Réponses de l’IA', n(t.ai)));
  messages.push(kv('Résultats d’outil', n(t.toolResults)));
  messages.push(kv('Caractères tapés', compact(t.humanChars), `l’IA en a rendu ${compact(t.aiChars)}`));
  box('Messages', messages);

  // ── tokens ───────────────────────────────────────────────────────────────
  const k = r.tokens;
  const tokens = [];
  for (const [label, v] of [
    ['input', k.input], ['output', k.output],
    ['écriture de cache', k.cacheWrite], ['relecture de cache', k.cacheRead],
  ]) {
    tokens.push(`${padEnd(label, 32)}${padStart(n(v), 18)}  `
      + `${padStart(k.total ? pct(v / k.total) : '—', 7)}  ${barColored(v, k.total, 20)}`);
  }
  tokens.push(`${padEnd(c.b('total'), 32)}${padStart(c.b(n(k.total)), 18)}  ${padStart(compact(k.total), 7)}`);
  tokens.push('');
  tokens.push(kv('Hors relectures de cache', compact(k.fresh), 'input + output + écriture de cache'));
  tokens.push(kv('Input + output seuls', compact(k.io), 'cache entièrement retiré'));
  tokens.push(kv('Compteur naïf, non dédoublonné', compact(k.naive),
    'ce qu’affiche un panneau qui ignore le cache'));
  tokens.push(c.grey(`${n(r.meta.dedup.dropped)} entrées en double écartées sur `
    + `${n(r.meta.dedup.kept + r.meta.dedup.dropped)} (reprises de session).`));

  if (r.models.length) {
    const nameW = Math.max(24, inner - 41);
    tokens.push('');
    tokens.push(`${padEnd(c.grey('modèle'), nameW)}${padStart(c.grey('tokens'), 10)} `
      + `${padStart(c.grey('part'), 7)} ${padStart(c.grey('requêtes'), 9)} ${padStart(c.grey('coût'), 9)}`);
    for (const m of r.models.slice(0, 10)) {
      if (!m.tokens) continue;
      tokens.push(`${padEnd(clip(sanitize(m.name), nameW - 1), nameW)}${padStart(compact(m.tokens), 10)} `
        + `${padStart(k.total ? pct(m.tokens / k.total) : '—', 7)} ${padStart(n(m.requests), 9)} `
        + `${padStart(m.cost === null ? c.grey('—') : money(m.cost), 9)}`);
    }
  }
  box('Tokens', tokens);

  // ── rythme ───────────────────────────────────────────────────────────────
  const hh = r.hours.localHuman;
  const peakHour = Math.max(...hh);
  const rhythm = [];
  if (peakHour > 0) {
    rhythm.push(c.grey('messages humains par heure locale'));
    rhythm.push(sparkColored(hh, RAMPS.heat));
    rhythm.push(c.grey('0h'.padEnd(6) + '6h'.padEnd(6) + '12h'.padEnd(6) + '18h'.padEnd(5) + '23h'));
    rhythm.push(kv('🕐 Heure de pointe', `${r.hours.peakLocal} h`,
      `${r.hours.peakUtc} h UTC · ${n(peakHour)} messages`));
  }
  const all = r.timeline.tokens.total;
  const from = all.findIndex((v) => v > 0);
  if (from !== -1) {
    const tw = all.slice(from).slice(-(inner - 2));
    const w0 = r.timeline.weeks[r.timeline.weeks.length - tw.length];
    const w1 = r.timeline.weeks[r.timeline.weeks.length - 1];
    if (rhythm.length) rhythm.push('');
    rhythm.push(c.grey(`tokens par semaine — ${frDate(w0)} → ${frDate(w1)}, `
      + `pic ${compact(Math.max(...tw))}`));
    rhythm.push(sparkColored(tw));
  }
  if (rhythm.length) box('Rythme', rhythm);

  // ── pour situer ──────────────────────────────────────────────────────────
  const facts = [];
  if (aiPerHuman) {
    facts.push(`🤖 L’IA écrit ${n(aiPerHuman)} messages pour chacun des tiens`);
  }
  if (t.aiChars > 500_000) {
    facts.push(`📚 ${compact(t.aiChars)} caractères rendus par l’IA — `
      + `l’équivalent de ~${n(t.aiChars / 500_000)} romans`);
  }
  if (d.active && k.fresh) {
    facts.push(`⚡ ${compact(k.fresh / d.active)} tokens par jour actif, hors relectures de cache`);
  }
  const peakWeek = Math.max(...all, 0);
  if (peakWeek) {
    facts.push(`🚀 Semaine record : ${compact(peakWeek)} tokens `
      + `(${frDate(r.timeline.weeks[all.indexOf(peakWeek)])})`);
  }
  if (r.tokens.cost && d.active) {
    facts.push(`💸 Soit ${money(r.tokens.cost / d.active)} par jour actif au tarif API public`
      + (r.tokens.costPartial ? c.grey(' (partiel)') : ''));
  }
  if (facts.length) box('Pour situer', facts);

  // ── contexte ─────────────────────────────────────────────────────────────
  if (r.projects.length > 1) {
    const maxP = r.projects[0].sessions;
    box('Où', r.projects.slice(0, 8).map((p) =>
      `${padStart(n(p.sessions), 6)}  ${padEnd(barColored(p.sessions, maxP, 14), 14)}  ${c.grey(sanitize(p.name))}`));
  }
  if (r.topTools.length) {
    const maxT = r.topTools[0].n;
    box('Outils appelés par l’IA', r.topTools.slice(0, 8).map((x) =>
      `${padEnd(clip(sanitize(x.name), 26), 27)}${padStart(compact(x.n), 9)}  ${barColored(x.n, maxT, 24)}`));
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
  if (notes.length) box('Notes', notes.map((x) => c.grey(`· ${x}`)));

  out('');
  out(c.grey(`  ${n(r.meta.files)} fichiers lus en ${(r.meta.durationMs / 1000).toFixed(1)} s`
    + `  ·  tarifs : ${r.meta.pricing}`));
  out('');

  return L.join('\n');
}
