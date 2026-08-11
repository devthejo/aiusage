#!/usr/bin/env node
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { buildReport } from '../src/index.js';
import { renderTerminal } from '../src/report/terminal.js';
import { renderHtml } from '../src/report/html.js';

const HELP = `
  ai-agent-stats — compte tes sessions, messages et tokens d'agents de codage.

  Lit les transcripts déjà sur ton disque : Claude Code (toutes surfaces et
  sous-agents), Roo Code / Cline / Kilo Code, Codex. Rien n'est envoyé nulle part.

  Usage
    npx ai-agent-stats [options]

  Options
    -w, --web            rapport HTML ouvert dans le navigateur   (défaut)
    -t, --terminal       rapport dans le terminal
    -j, --json           rapport brut en JSON sur la sortie standard
    -o, --out <fichier>  écrit le rapport dans ce fichier au lieu d'un temporaire
        --no-open        écrit le HTML sans ouvrir le navigateur
        --tz <zone>      fuseau pour les jours et les heures (défaut : celui du système)
        --offline        n'interroge pas le réseau ; sans tarifs en cache, pas de coût
        --refresh        force le rafraîchissement de la table de tarifs
    -q, --quiet          pas de progression
    -h, --help           cette aide
    -V, --version        version

  Exemples
    npx ai-agent-stats                        rapport web
    npx ai-agent-stats -t                     rapport terminal
    npx ai-agent-stats -t --no-color          terminal sans couleurs (ou NO_COLOR=1)
    npx ai-agent-stats -j > usage.json        données brutes
    npx ai-agent-stats -o ~/rapport.html      HTML à un emplacement choisi
`;

function parseArgs(argv) {
  const o = { mode: 'web', open: true, quiet: false, offline: false, refresh: false, out: null, tz: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) {
        console.error(`ai-agent-stats: valeur manquante après ${a}`);
        process.exit(2);
      }
      return v;
    };
    switch (a) {
      case '-w': case '--web': o.mode = 'web'; break;
      case '-t': case '--terminal': o.mode = 'terminal'; break;
      case '-j': case '--json': o.mode = 'json'; break;
      case '-o': case '--out': o.out = next(); break;
      case '--no-open': o.open = false; break;
      case '--tz': o.tz = next(); break;
      case '--offline': o.offline = true; break;
      case '--refresh': o.refresh = true; break;
      case '--no-color': process.env.NO_COLOR = '1'; break;
      case '-q': case '--quiet': o.quiet = true; break;
      case '-h': case '--help': o.help = true; break;
      case '-V': case '--version': o.version = true; break;
      default:
        console.error(`ai-agent-stats: option inconnue « ${a} »\nEssaie: npx ai-agent-stats --help`);
        process.exit(2);
    }
  }
  return o;
}

function openInBrowser(file) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {
    console.error(`  (ouverture automatique impossible — ouvre ${file} à la main)`);
  });
  child.unref();
}

function progressBar(quiet) {
  if (quiet || !process.stderr.isTTY) return undefined;
  let last = 0;
  return (label, done, total) => {
    const now = Date.now();
    if (now - last < 90 && done < total) return;
    last = now;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const w = 24;
    const full = Math.round((pct / 100) * w);
    const name = String(label).replace(process.env.HOME || '~', '~').slice(-40);
    process.stderr.write(`\r  \x1b[2m${'█'.repeat(full)}${'░'.repeat(w - full)}\x1b[0m `
      + `${String(pct).padStart(3)}%  \x1b[2m${name}\x1b[0m\x1b[K`);
  };
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) { console.log(HELP); process.exit(0); }
if (opts.version) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

const onProgress = progressBar(opts.quiet);
let report;
try {
  report = await buildReport({
    tz: opts.tz, offline: opts.offline, refreshPricing: opts.refresh, onProgress,
  });
} catch (e) {
  if (onProgress) process.stderr.write('\r\x1b[K');
  console.error(`ai-agent-stats: la collecte a échoué — ${e.message}`);
  process.exit(1);
}
if (onProgress) process.stderr.write('\r\x1b[K');

if (!report.totals.sessions) {
  console.error('ai-agent-stats: aucun transcript trouvé.\n'
    + '  Emplacements inspectés :\n'
    + Object.entries(report.meta.roots)
      .map(([k, v]) => `    ${k} : ${v.length ? v.join(', ') : 'aucun'}`).join('\n')
    + '\n  Si tes transcripts sont ailleurs, pointe CLAUDE_CONFIG_DIR dessus.');
  process.exit(1);
}

if (opts.mode === 'json') {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

if (opts.mode === 'terminal') {
  process.stdout.write(`${renderTerminal(report)}\n`);
  process.exit(0);
}

const html = renderHtml(report);
const file = opts.out
  ? resolve(opts.out)
  : join(tmpdir(), `ai-agent-stats-${new Date(report.meta.generatedAt).toISOString().slice(0, 10)}.html`);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, html);
console.error(`  rapport écrit : ${file}`);
if (opts.open) openInBrowser(file);
