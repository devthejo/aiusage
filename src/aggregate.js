import { sep } from 'node:path';
import { surfaceOf } from './collect/claude.js';
import { codexSurface } from './collect/codex.js';
import { localParts, utcDay, isoWeekStart, streaks, daysBetween, addDays } from './util.js';

const z4 = () => ({ input: 0, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, requests: 0 });
const addOne = (t, i, o, w5, w1, r) => {
  t.input += i; t.output += o;
  t.cacheWrite += w5 + w1; t.cacheWrite1h += w1; t.cacheRead += r; t.requests++;
};
const addAll = (t, u) => {
  t.input += u.input; t.output += u.output;
  t.cacheWrite += u.cacheWrite; t.cacheWrite1h += u.cacheWrite1h || 0;
  t.cacheRead += u.cacheRead; t.requests += u.requests;
};
const totalOf = (t) => t.input + t.output + t.cacheWrite + t.cacheRead;
const freshOf = (t) => t.input + t.output + t.cacheWrite;   // hors relectures de cache
const ioOf = (t) => t.input + t.output;                     // cache entièrement retiré
const bump = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

/** `<projet>/<idSession>/subagents/…` : la session mère porte la surface du transcript dérivé. */
function parentSessionId(rel) {
  const parts = rel.split(sep);
  const i = parts.indexOf('subagents');
  return i > 0 ? parts[i - 1] : null;
}

/** Assemble les collectes brutes en un rapport unique, rendu par le terminal ou le HTML. */
export function aggregate({ claude, clineGroups, codex, pricer, tz, hints, startedAt }) {
  const sessions = claude.sessions;
  const main = sessions.filter((s) => s.kind === 'main');
  const derived = sessions.filter((s) => s.kind !== 'main');

  // ── tokens Claude Code : dédoublonnage global, puis ventilation ───────────
  // Règle reprise de ccusage : sur doublon, on garde l'entrée au plus gros total
  // (et on préfère la non-sidechain). Garder la première sous-compterait l'output,
  // car une reprise de session peut recopier une entrée dont le flux avait été coupé.
  const S = 11;
  const byExact = new Map();
  const byMsg = new Map();
  const rowChunk = [];
  const rowOff = [];
  const rowTotal = [];
  const rowSide = [];
  let dropped = 0;
  let rawRows = 0;

  const totalAt = (a, i) => a[i + 4] + a[i + 5] + a[i + 6] + a[i + 7] + a[i + 8];
  const replaces = (a, i, k) => {
    const candSide = a[i + 9] === 1;
    const exSide = rowSide[k] === 1;
    if (candSide !== exSide) return exSide;
    return totalAt(a, i) > rowTotal[k];
  };

  claude.usage.forEach((arr, chunk) => {
    for (let i = 0; i < arr.length; i += S) {
      rawRows++;
      const hExact = arr[i];
      let k;
      if (hExact !== -1) {
        k = byExact.get(hExact);
        if (k === undefined) {
          const j = byMsg.get(arr[i + 1]);
          if (j !== undefined && (arr[i + 9] === 1 || rowSide[j] === 1)) k = j;
        }
      }
      if (k !== undefined) {
        dropped++;
        if (replaces(arr, i, k)) {
          rowChunk[k] = chunk; rowOff[k] = i;
          rowTotal[k] = totalAt(arr, i); rowSide[k] = arr[i + 9];
        }
        continue;
      }
      const idx = rowChunk.length;
      rowChunk.push(chunk); rowOff.push(i);
      rowTotal.push(totalAt(arr, i)); rowSide.push(arr[i + 9]);
      if (hExact !== -1) {
        byExact.set(hExact, idx);
        if (!byMsg.has(arr[i + 1])) byMsg.set(arr[i + 1], idx);
      }
    }
  });

  const perSession = sessions.map(() => z4());
  const perModel = new Map();
  const perDay = new Map();
  for (let k = 0; k < rowChunk.length; k++) {
    const arr = claude.usage[rowChunk[k]];
    const i = rowOff[k];
    const inp = arr[i + 4], out = arr[i + 5];
    const w5 = arr[i + 6], w1 = arr[i + 7], cr = arr[i + 8];
    addOne(perSession[arr[i + 10] | 0], inp, out, w5, w1, cr);
    const model = claude.models[arr[i + 3] | 0] || 'inconnu';
    let mt = perModel.get(model);
    if (!mt) perModel.set(model, mt = z4());
    addOne(mt, inp, out, w5, w1, cr);
    const ms = arr[i + 2];
    if (ms) {
      const day = localParts(ms, tz)[0];
      let dt = perDay.get(day);
      if (!dt) perDay.set(day, dt = z4());
      addOne(dt, inp, out, w5, w1, cr);
    }
  }

  // ── surfaces ─────────────────────────────────────────────────────────────
  const surfaces = new Map();
  const surf = (label, tool, interactive) => {
    let s = surfaces.get(label);
    if (!s) {
      s = { label, tool, interactive, sessions: 0, piloted: 0, human: 0, ai: 0, tokens: z4(), cost: 0 };
      surfaces.set(label, s);
    }
    return s;
  };

  const projects = new Map();
  const byId = new Map();
  for (const s of main) if (s.sessionId) byId.set(s.sessionId, s);
  let unknownSurface = 0;

  sessions.forEach((s, i) => {
    let ep = s.entrypoint;
    if (s.kind !== 'main') ep = byId.get(parentSessionId(s.file))?.entrypoint ?? ep;
    const meta = surfaceOf(ep);
    const row = surf(meta.label, 'Claude Code', meta.interactive);
    if (s.kind === 'main') {
      if (!s.entrypoint) unknownSurface++;
      row.sessions++;
      if (s.nHuman > 0) row.piloted++;
      row.human += s.nHuman;
      bump(projects, s.project);
    }
    row.ai += s.nAssistant + s.nAssistantSide;
    addAll(row.tokens, perSession[i]);
  });

  // ── Roo Code / Cline / Kilo Code ─────────────────────────────────────────
  const clineTasks = [];
  for (const g of clineGroups) {
    const row = surf(`${g.tool} — ${g.editor}`, g.tool, true);
    for (const t of g.tasks) {
      clineTasks.push(t);
      row.sessions++;
      row.piloted++;
      row.human += t.nHuman;
      row.ai += t.nAi;
      addAll(row.tokens, {
        input: t.tokensIn, output: t.tokensOut, cacheWrite: t.cacheWrites,
        cacheWrite1h: 0, cacheRead: t.cacheReads, requests: t.nAi,
      });
      row.cost += t.cost;
    }
  }

  // ── Codex ────────────────────────────────────────────────────────────────
  for (const s of codex.sessions) {
    const row = surf(codexSurface(s.originator), 'Codex', s.originator !== 'codex_exec');
    row.sessions++;
    if (s.nHuman > 0) row.piloted++;
    row.human += s.nHuman;
    row.ai += s.nAi;
    addAll(row.tokens, {
      input: s.input, output: s.output, cacheWrite: 0, cacheWrite1h: 0,
      cacheRead: s.cached, requests: s.nTurns,
    });
  }

  // ── coûts ────────────────────────────────────────────────────────────────
  let cost = 0;
  const unpriced = new Set();
  const charge = (model, t) => {
    const c = pricer.cost(model, t);
    // un modèle sans tarif ne rend le total partiel que s'il a réellement consommé
    if (c === null) { if (totalOf({ ...z4(), ...t }) > 0) unpriced.add(model); }
    else cost += c;
  };
  for (const [model, t] of perModel) charge(model, t);
  for (const s of codex.sessions) {
    if (s.input || s.output || s.cached) {
      charge(s.model || 'gpt-5', { input: s.input, output: s.output, cacheRead: s.cached });
    }
  }
  const clineCost = sum(clineTasks, (t) => t.cost);
  cost += clineCost;

  // ── messages ─────────────────────────────────────────────────────────────
  const interactive = main.filter((s) => surfaceOf(s.entrypoint).interactive);
  const sdk = main.filter((s) => s.entrypoint && !surfaceOf(s.entrypoint).interactive);
  const humanClaude = sum(interactive, (s) => s.nHuman);
  const humanCline = sum(clineTasks, (t) => t.nHuman);
  const humanCodex = sum(codex.sessions, (s) => s.nHuman);

  const totals = {
    sessions: main.length + clineTasks.length + codex.sessions.length,
    sessionsDerived: derived.length,
    human: humanClaude + humanCline + humanCodex,
    humanByTool: [
      ['Claude Code', humanClaude],
      ['Roo Code / Cline', humanCline],
      ['Codex', humanCodex],
    ].filter(([, n]) => n > 0),
    humanCmd: sum(interactive, (s) => s.nHumanCmd),
    humanAnswer: sum(interactive, (s) => s.nAnswer) + sum(clineTasks, (t) => t.nAnswer),
    programmatic: sum(sdk, (s) => s.nHuman),
    programmaticFlagged: sum(sdk, (s) => s.nSdkPrompt),
    agentPrompts: sum(sessions, (s) => s.nHumanSide),
    ai: sum(sessions, (s) => s.nAssistant + s.nAssistantSide)
      + sum(clineTasks, (t) => t.nAi) + sum(codex.sessions, (s) => s.nAi),
    toolResults: sum(sessions, (s) => s.nToolResult),
    toolCalls: sum(sessions, (s) => s.nToolUse) + sum(clineTasks, (t) => t.nTool)
      + sum(codex.sessions, (s) => s.nTool),
    thinking: sum(sessions, (s) => s.nThinking) + sum(codex.sessions, (s) => s.nReasoning),
    attachments: sum(sessions, (s) => s.nAttachment),
    humanChars: sum(sessions, (s) => s.humanChars),
    aiChars: sum(sessions, (s) => s.aiChars),
    questionsAsked: sum(clineTasks, (t) => t.nFollowup),
  };

  // ── tokens consolidés, tous outils ───────────────────────────────────────
  const tokens = z4();
  for (const row of surfaces.values()) addAll(tokens, row.tokens);
  const naive = sum(main, (s) => s.usageRaw[0] + s.usageRaw[1]);

  // ── temps ────────────────────────────────────────────────────────────────
  const daysLocal = new Set();
  const daysUtc = new Set();
  const startDay = new Map();
  const startedOn = (day, label) => {
    daysLocal.add(day);
    let m = startDay.get(day);
    if (!m) startDay.set(day, m = new Map());
    bump(m, label);
  };
  for (const s of sessions) {
    for (const d of s.daysLocal) daysLocal.add(d);
    for (const d of s.daysUtc) daysUtc.add(d);
  }
  for (const s of main) {
    if (s.daysLocal.length) startedOn(s.daysLocal[0], surfaceOf(s.entrypoint).label);
  }
  for (const t of clineTasks) {
    if (!t.ts) continue;
    daysUtc.add(utcDay(t.ts));
    startedOn(localParts(t.ts, tz)[0], `${t.tool} — ${t.editor}`);
  }
  for (const s of codex.sessions) {
    if (!s.firstTs) continue;
    daysUtc.add(utcDay(s.firstTs));
    startedOn(localParts(s.firstTs, tz)[0], codexSurface(s.originator));
  }

  const allDays = [...daysLocal].sort();
  const first = allDays[0] ?? null;
  const last = allDays[allDays.length - 1] ?? null;
  const { best, current } = streaks(daysLocal);

  // ── timeline hebdomadaire ────────────────────────────────────────────────
  const weeks = [];
  if (first) {
    for (let d = isoWeekStart(first); daysBetween(d, last) >= 0; d = addDays(d, 7)) weeks.push(d);
  }
  const weekIdx = new Map(weeks.map((w, i) => [w, i]));
  const used = new Set();
  for (const m of startDay.values()) for (const k of m.keys()) used.add(k);
  const series = [...surfaces.keys()].filter((k) => used.has(k));
  const seriesIdx = new Map(series.map((s, i) => [s, i]));
  const tlSessions = series.map(() => new Array(weeks.length).fill(0));
  for (const [day, m] of startDay) {
    const wi = weekIdx.get(isoWeekStart(day));
    if (wi === undefined) continue;
    for (const [name, n] of m) {
      const si = seriesIdx.get(name);
      if (si !== undefined) tlSessions[si][wi] += n;
    }
  }
  const tlTokens = {
    total: new Array(weeks.length).fill(0),
    fresh: new Array(weeks.length).fill(0),
    io: new Array(weeks.length).fill(0),
  };
  for (const [day, t] of perDay) {
    const wi = weekIdx.get(isoWeekStart(day));
    if (wi === undefined) continue;
    tlTokens.total[wi] += totalOf(t);
    tlTokens.fresh[wi] += freshOf(t);
    tlTokens.io[wi] += ioOf(t);
  }

  // ── modèles ──────────────────────────────────────────────────────────────
  const claudeTotal = [...perModel.values()].reduce((a, t) => a + totalOf(t), 0);
  const models = [...perModel.entries()]
    .map(([name, t]) => ({
      name,
      tokens: totalOf(t),
      fresh: freshOf(t),
      requests: t.requests,
      share: claudeTotal ? totalOf(t) / claudeTotal : 0,
      cost: pricer.cost(name, t),
    }))
    .sort((a, b) => b.tokens - a.tokens);

  const peak = (h) => (Math.max(...h) > 0 ? h.indexOf(Math.max(...h)) : null);

  return {
    meta: {
      generatedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      tz,
      roots: {
        'Claude Code': claude.roots,
        'Roo Code / Cline': clineGroups.map((g) => g.dir),
        Codex: codex.roots,
      },
      files: claude.files + codex.sessions.length,
      errors: [...claude.errors, ...clineGroups.flatMap((g) => g.errors)],
      pricing: pricer.source,
      pricingPartial: unpriced.size > 0,
      unknownModels: [...unpriced],
      hints,
      unknownSurface,
      dedup: { kept: rawRows - dropped, dropped },
    },
    totals,
    tokens: {
      ...tokens,
      total: totalOf(tokens),
      fresh: freshOf(tokens),
      io: ioOf(tokens),
      naive,
      cost,
      costPartial: unpriced.size > 0,
      clineCost,
    },
    surfaces: [...surfaces.values()]
      .map((s) => ({ ...s, total: totalOf(s.tokens), fresh: freshOf(s.tokens) }))
      .sort((a, b) => b.sessions - a.sessions || b.total - a.total),
    timeline: { weeks, series, sessions: tlSessions, tokens: tlTokens },
    hours: {
      localHuman: claude.hours.localHuman,
      localAll: claude.hours.localAll,
      utcHuman: claude.hours.utcHuman,
      peakLocal: peak(claude.hours.localHuman),
      peakUtc: peak(claude.hours.utcHuman),
    },
    days: {
      active: daysLocal.size,
      activeUtc: daysUtc.size,
      span: first ? daysBetween(first, last) + 1 : 0,
      first,
      last,
      best,
      current,
    },
    models,
    topTools: [...claude.tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([name, n]) => ({ name, n })),
    projects: [...projects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([name, n]) => ({ name, sessions: n })),
  };
}
