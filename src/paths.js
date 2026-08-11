import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { exists } from './util.js';

const HOME = homedir();

/** Racine de configuration des éditeurs VS Code et de ses forks, par OS. */
function editorRoots() {
  const p = platform();
  const base =
    p === 'darwin' ? join(HOME, 'Library', 'Application Support')
      : p === 'win32' ? (process.env.APPDATA || join(HOME, 'AppData', 'Roaming'))
        : (process.env.XDG_CONFIG_HOME || join(HOME, '.config'));
  const editors = ['Code', 'Code - OSS', 'VSCodium', 'Cursor', 'Windsurf', 'Trae', 'Positron'];
  return editors.map((e) => ({ editor: e, dir: join(base, e, 'User', 'globalStorage') }))
    .filter((x) => exists(x.dir));
}

/** Extensions au format Cline (Roo Code en est un fork : même arborescence de tâches). */
const CLINE_LIKE = [
  { id: 'rooveterinaryinc.roo-cline', tool: 'Roo Code' },
  { id: 'kilocode.kilo-code', tool: 'Kilo Code' },
  { id: 'saoudrizwan.claude-dev', tool: 'Cline' },
];

export function claudeRoots() {
  const roots = [];
  if (process.env.CLAUDE_CONFIG_DIR) {
    for (const d of process.env.CLAUDE_CONFIG_DIR.split(',')) {
      roots.push(join(d.trim(), 'projects'));
    }
  }
  roots.push(join(HOME, '.claude', 'projects'));
  roots.push(join(process.env.XDG_CONFIG_HOME || join(HOME, '.config'), 'claude', 'projects'));
  return [...new Set(roots)].filter(exists);
}

export function clineLikeRoots() {
  const out = [];
  for (const { editor, dir } of editorRoots()) {
    for (const { id, tool } of CLINE_LIKE) {
      const tasks = join(dir, id, 'tasks');
      if (exists(tasks)) out.push({ tool, editor, dir: tasks });
    }
  }
  return out;
}

export function codexRoots() {
  return [join(HOME, '.codex', 'sessions'), join(HOME, '.codex', 'archived_sessions')]
    .filter(exists);
}

/** Outils repérés sur la machine mais dont aucun collecteur ne lit le format. */
export function unsupportedHints() {
  const hints = [];
  const check = (p, label) => { if (exists(p)) hints.push(label); };
  check(join(HOME, '.local', 'share', 'opencode', 'storage'), 'opencode');
  check(join(HOME, '.gemini', 'tmp'), 'Gemini CLI');
  check(join(HOME, '.aider'), 'Aider');
  check(join(HOME, '.config', 'github-copilot'), 'GitHub Copilot');
  return hints;
}
