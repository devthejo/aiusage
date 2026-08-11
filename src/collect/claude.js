import { walkFiles } from '../util.js';
import { claudeRoots } from '../paths.js';
import { runPool } from '../pool.js';

/** Étiquettes des `entrypoint` écrits par Claude Code dans ses transcripts. */
export const SURFACES = {
  'claude-vscode': { label: 'Claude Code — extension VS Code', interactive: true },
  'claude-desktop': { label: 'Claude Code — app desktop', interactive: true },
  cli: { label: 'Claude Code — terminal', interactive: true },
  'sdk-cli': { label: 'Claude Agent SDK — CLI', interactive: false },
  'sdk-ts': { label: 'Claude Agent SDK — TypeScript', interactive: false },
  'sdk-py': { label: 'Claude Agent SDK — Python', interactive: false },
};

export const surfaceOf = (ep) =>
  SURFACES[ep] || { label: ep ? `Claude Code — ${ep}` : 'Claude Code — surface inconnue', interactive: false };

export async function collectClaude({ tz, onProgress } = {}) {
  const roots = claudeRoots();
  const out = {
    tool: 'Claude Code', roots, sessions: [], usage: [], models: [],
    tools: new Map(), hours: { localAll: new Array(24).fill(0), localHuman: new Array(24).fill(0), utcHuman: new Array(24).fill(0) },
    errors: [], files: 0,
  };
  if (!roots.length) return out;

  const workerUrl = new URL('../workers/claude.js', import.meta.url);
  for (const root of roots) {
    const files = walkFiles(root);
    out.files += files.length;
    const { results, errors } = await runPool(workerUrl, files, { root, tz }, {
      onProgress: onProgress && ((d, t) => onProgress(root, d, t)),
    });
    out.errors.push(...errors);

    for (const r of results) {
      const remap = r.models.map((m) => {
        let i = out.models.indexOf(m);
        if (i === -1) { i = out.models.length; out.models.push(m); }
        return i;
      });
      // les index (modèle, session) sont locaux au worker : on les rebase sur les tables globales
      const sessionBase = out.sessions.length;
      const arr = new Float64Array(r.usage);
      for (let i = 0; i < arr.length; i += r.stride) {
        arr[i + 3] = remap[arr[i + 3]];
        arr[i + 10] += sessionBase;
      }
      out.usage.push(arr);
      for (const s of r.records) { s.root = root; out.sessions.push(s); }
      for (const [k, v] of r.tools) out.tools.set(k, (out.tools.get(k) || 0) + v);
      for (const k of ['localAll', 'localHuman', 'utcHuman']) {
        for (let i = 0; i < 24; i++) out.hours[k][i] += r.hours[k][i];
      }
    }
  }
  return out;
}
