import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const { files: dirs, tool, editor } = workerData;

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

/**
 * Format Cline (dont Roo Code et Kilo Code héritent) :
 *  - type 'ask'  = l'agent interroge l'utilisateur (approbation d'outil, question)
 *  - type 'say'  = l'agent parle, sauf 'user_feedback' qui est la réponse humaine
 * Le nombre d'aller-retours API se lit sur les 'api_req_started'.
 */
function scanTask(dir) {
  const h = readJson(join(dir, 'history_item.json')) || {};
  const rec = {
    id: basename(dir),
    tool,
    editor,
    ts: num(h.ts) || null,
    workspace: h.workspace || null,
    mode: h.mode || null,
    parent: h.parentTaskId || null,
    tokensIn: num(h.tokensIn),
    tokensOut: num(h.tokensOut),
    cacheReads: num(h.cacheReads),
    cacheWrites: num(h.cacheWrites),
    cost: num(h.totalCost),
    nHuman: 0,
    nAnswer: 0,
    nAi: 0,
    nTool: 0,
    nFollowup: 0,
    nApiAsst: 0,
    protocols: [],
  };

  const ui = readJson(join(dir, 'ui_messages.json'));
  if (Array.isArray(ui)) {
    rec.nHuman = 1; // la consigne initiale de la tâche
    const protos = new Set();
    for (const m of ui) {
      if (!m || typeof m !== 'object') continue;
      if (m.type === 'ask') {
        if (m.ask === 'tool' || m.ask === 'command' || m.ask === 'use_mcp_server'
          || m.ask === 'browser_action_launch') rec.nTool++;
        else if (m.ask === 'followup') rec.nFollowup++;
      } else if (m.type === 'say') {
        if (m.say === 'user_feedback' || m.say === 'user_feedback_diff') {
          rec.nHuman++;
          rec.nAnswer++;
        } else if (m.say === 'api_req_started') {
          rec.nAi++;
          if (typeof m.text === 'string' && m.text.length < 4096) {
            try {
              const j = JSON.parse(m.text);
              if (j?.apiProtocol) protos.add(j.apiProtocol);
            } catch { /* champ libre selon la version de l'extension */ }
          }
        }
      }
    }
    rec.protocols = [...protos];
  }

  const api = readJson(join(dir, 'api_conversation_history.json'));
  if (Array.isArray(api)) {
    for (const m of api) if (m?.role === 'assistant') rec.nApiAsst++;
  }
  if (rec.ts === null && Array.isArray(ui) && ui.length && typeof ui[0]?.ts === 'number') {
    rec.ts = ui[0].ts;
  }
  return rec;
}

parentPort.postMessage({ records: dirs.map(scanTask) });
