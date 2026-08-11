import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync, statSync } from 'node:fs';
import { relative, sep, basename } from 'node:path';
import { hash53, localParts, utcDay } from '../util.js';

const { files, root, tz } = workerData;

const USAGE_STRIDE = 11;
// [hExact, hMsg, tsMs, idxModèle, input, output, cacheWrite5m, cacheWrite1h,
//  cacheRead, sidechain, idxSession]
const NO_KEY = -1;

const records = [];
const usage = [];
const modelIds = new Map();
const tools = new Map();
const hours = {
  localAll: new Array(24).fill(0),
  localHuman: new Array(24).fill(0),
  utcHuman: new Array(24).fill(0),
};

const modelIdx = (m) => {
  let i = modelIds.get(m);
  if (i === undefined) {
    i = modelIds.size;
    modelIds.set(m, i);
  }
  return i;
};

/** subagents/ et subagents/workflows/ ne sont pas des conversations pilotées à la main. */
function classify(rel) {
  const parts = rel.split(sep);
  if (parts.includes('workflows')) return 'workflow';
  if (parts.includes('subagents')) return 'subagent';
  return 'main';
}

function blank(path) {
  const rel = relative(root, path);
  const rootLevel = !rel.includes(sep);
  let size = 0;
  try {
    size = statSync(path).size;
  } catch { /* fichier disparu entre le listing et la lecture */ }
  return {
    file: rel,
    kind: classify(rel),
    project: rootLevel ? '(racine)' : rel.split(sep)[0],
    rootLevel,
    sessionId: basename(path).replace(/\.jsonl$/, ''),
    size,
    entrypoint: null,
    version: null,
    cwd: null,
    firstTs: null,
    lastTs: null,
    daysUtc: [],
    daysLocal: [],
    nLines: 0,
    nHuman: 0,
    nHumanCmd: 0,
    nAnswer: 0,
    nHumanSide: 0,
    nMeta: 0,
    nToolResult: 0,
    nAssistant: 0,
    nAssistantSide: 0,
    nAttachment: 0,
    nThinking: 0,
    nToolUse: 0,
    nApiErr: 0,
    nSdkPrompt: 0,
    humanChars: 0,
    aiChars: 0,
    usageRaw: [0, 0, 0, 0, 0],
  };
}

function scanFile(path, recIdx) {
  const rec = blank(path);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return rec;
  }
  const eps = new Map();
  const vers = new Map();
  const daysU = new Set();
  const daysL = new Set();
  const askIds = new Set();

  let pos = 0;
  while (pos < text.length) {
    let nl = text.indexOf('\n', pos);
    if (nl === -1) nl = text.length;
    const line = text.slice(pos, nl);
    pos = nl + 1;
    if (line.length < 2 || line.charCodeAt(0) !== 123) continue; // '{'
    rec.nLines++;

    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof d !== 'object' || d === null) continue;

    if (d.entrypoint) eps.set(d.entrypoint, (eps.get(d.entrypoint) || 0) + 1);
    if (d.version) vers.set(d.version, (vers.get(d.version) || 0) + 1);
    if (d.cwd && !rec.cwd) rec.cwd = d.cwd;

    let ms = null, hl = null, hu = null;
    if (typeof d.timestamp === 'string') {
      ms = Date.parse(d.timestamp);
      if (Number.isNaN(ms)) ms = null;
    }
    if (ms !== null) {
      if (rec.firstTs === null || ms < rec.firstTs) rec.firstTs = ms;
      if (rec.lastTs === null || ms > rec.lastTs) rec.lastTs = ms;
      daysU.add(utcDay(ms));
      const [dl, h] = localParts(ms, tz);
      daysL.add(dl);
      hl = h;
      hu = new Date(ms).getUTCHours();
    }

    const type = d.type;
    const side = d.isSidechain === true;

    if (type === 'attachment') {
      rec.nAttachment++;
      continue;
    }

    if (type === 'user') {
      if (hl !== null) hours.localAll[hl]++;
      if (d.promptSource === 'sdk') rec.nSdkPrompt++;
      const c = d.message?.content;
      let isToolResult = false, isCmd = false, isAnswer = false, chars = 0;
      if (Array.isArray(c)) {
        for (const b of c) {
          if (!b || typeof b !== 'object') continue;
          if (b.type === 'tool_result') {
            isToolResult = true;
            if (askIds.has(b.tool_use_id)) isAnswer = true;
          } else if (b.type === 'text' && typeof b.text === 'string') {
            chars += b.text.length;
            if (b.text.includes('<command-name>')) isCmd = true;
          }
        }
      } else if (typeof c === 'string') {
        chars = c.length;
        if (c.includes('<command-name>')) isCmd = true;
      }
      if (isToolResult) {
        rec.nToolResult++;
        if (isAnswer) {
          // une réponse à AskUserQuestion est bien un message humain
          rec.nAnswer++;
          rec.nHuman++;
          if (hl !== null) hours.localHuman[hl]++;
          if (hu !== null) hours.utcHuman[hu]++;
        }
      } else if (d.isMeta) {
        rec.nMeta++;
      } else if (side) {
        rec.nHumanSide++;
      } else {
        rec.nHuman++;
        rec.humanChars += chars;
        if (isCmd) rec.nHumanCmd++;
        if (hl !== null) hours.localHuman[hl]++;
        if (hu !== null) hours.utcHuman[hu]++;
      }
      continue;
    }

    if (type !== 'assistant') continue;

    if (hl !== null) hours.localAll[hl]++;
    if (side) rec.nAssistantSide++;
    else rec.nAssistant++;
    if (d.isApiErrorMessage) rec.nApiErr++;

    const m = d.message;
    if (!m || typeof m !== 'object') continue;
    const c = m.content;
    if (Array.isArray(c)) {
      for (const b of c) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'tool_use') {
          rec.nToolUse++;
          const name = b.name || '?';
          tools.set(name, (tools.get(name) || 0) + 1);
          if (name === 'AskUserQuestion') askIds.add(b.id);
        } else if (b.type === 'text') {
          if (typeof b.text === 'string') rec.aiChars += b.text.length;
        } else if (b.type === 'thinking') {
          rec.nThinking++;
        }
      }
    }
    const u = m.usage;
    if (!u || typeof u !== 'object') continue;
    const inp = u.input_tokens || 0;
    const out = u.output_tokens || 0;
    const cw = u.cache_creation_input_tokens || 0;
    const cr = u.cache_read_input_tokens || 0;
    // le cache 1 h se facture plus cher que le 5 min : on garde les deux séparés
    const cc = u.cache_creation;
    const cw1h = cc && typeof cc === 'object' ? (cc.ephemeral_1h_input_tokens || 0) : 0;
    const cw5m = Math.max(0, cw - cw1h);
    rec.usageRaw[0] += inp;
    rec.usageRaw[1] += out;
    rec.usageRaw[2] += cw;
    rec.usageRaw[3] += cr;
    rec.usageRaw[4]++;
    // deux clés, comme ccusage : l'exacte, et celle sur le seul message_id — les
    // journaux de sidechain rejouent des messages parents avec un requestId neuf
    const hExact = m.id ? hash53(`${m.id}|${d.requestId ?? ''}`) : NO_KEY;
    const hMsg = m.id ? hash53(`${m.id}|`) : NO_KEY;
    usage.push(hExact, hMsg, ms ?? 0, modelIdx(m.model || 'inconnu'),
      inp, out, cw5m, cw1h, cr, side ? 1 : 0, recIdx);
  }

  let bestEp = null, bestN = 0;
  for (const [k, n] of eps) if (n > bestN) { bestEp = k; bestN = n; }
  let bestV = null; bestN = 0;
  for (const [k, n] of vers) if (n > bestN) { bestV = k; bestN = n; }
  rec.entrypoint = bestEp;
  rec.version = bestV;
  rec.daysUtc = [...daysU].sort();
  rec.daysLocal = [...daysL].sort();
  return rec;
}

files.forEach((f, i) => records.push(scanFile(f, i)));

const buf = new Float64Array(usage);
parentPort.postMessage(
  {
    records,
    usage: buf.buffer,
    stride: USAGE_STRIDE,
    models: [...modelIds.keys()],
    tools: [...tools],
    hours,
  },
  [buf.buffer],
);
