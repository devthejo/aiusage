import { readFileSync } from 'node:fs';
import { walkFiles } from '../util.js';
import { codexRoots } from '../paths.js';

const ORIGINATORS = {
  codex_vscode: 'Codex — extension VS Code',
  'codex-tui': 'Codex — terminal',
  codex_cli_rs: 'Codex — terminal',
  codex_exec: 'Codex — exec (headless)',
};

export const codexSurface = (o) => ORIGINATORS[o] || (o ? `Codex — ${o}` : 'Codex');

/**
 * Rollouts Codex : un JSONL par session. Le cumul de tokens vit dans le dernier
 * `token_count`, qui porte le total courant de la session — on ne somme donc pas
 * les événements, on garde le dernier.
 */
function scanSession(path, archived) {
  const rec = {
    file: path, archived, id: null, cwd: null, originator: null, source: null,
    version: null, model: null, firstTs: null, lastTs: null,
    nHuman: 0, nAi: 0, nTool: 0, nReasoning: 0, nTurns: 0,
    input: 0, output: 0, cached: 0, reasoningOut: 0,
  };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return rec;
  }
  let last = null;
  for (const line of text.split('\n')) {
    if (line.length < 2 || line.charCodeAt(0) !== 123) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const ms = d.timestamp ? Date.parse(d.timestamp) : NaN;
    if (!Number.isNaN(ms)) {
      if (rec.firstTs === null || ms < rec.firstTs) rec.firstTs = ms;
      if (rec.lastTs === null || ms > rec.lastTs) rec.lastTs = ms;
    }
    const p = d.payload;
    if (!p || typeof p !== 'object') continue;
    if (d.type === 'session_meta') {
      rec.id ??= p.id;
      rec.cwd ??= p.cwd;
      rec.originator ??= p.originator;
      rec.source ??= p.source;
      rec.version ??= p.cli_version;
    } else if (d.type === 'turn_context') {
      rec.model = p.model || rec.model;
    } else if (d.type === 'event_msg') {
      if (p.type === 'user_message') rec.nHuman++;
      else if (p.type === 'agent_message') rec.nAi++;
      else if (p.type === 'agent_reasoning') rec.nReasoning++;
      else if (p.type === 'task_started') rec.nTurns++;
      else if (p.type === 'token_count' && p.info?.total_token_usage) last = p.info.total_token_usage;
    } else if (d.type === 'response_item') {
      if (p.type === 'function_call' || p.type === 'custom_tool_call') rec.nTool++;
    }
  }
  if (last) {
    // `input_tokens` de Codex englobe déjà `cached_input_tokens` : on isole la part non cachée
    rec.cached = last.cached_input_tokens || 0;
    rec.input = Math.max(0, (last.input_tokens || 0) - rec.cached);
    rec.output = last.output_tokens || 0;
    rec.reasoningOut = last.reasoning_output_tokens || 0;
  }
  return rec;
}

export function collectCodex() {
  const roots = codexRoots();
  const sessions = [];
  for (const root of roots) {
    const archived = root.includes('archived');
    for (const f of walkFiles(root)) sessions.push(scanSession(f, archived));
  }
  return { tool: 'Codex', roots, sessions };
}
