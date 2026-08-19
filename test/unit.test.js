import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hash53, isoWeekStart, streaks, daysBetween, walkFiles } from '../src/util.js';
import {
  compact, bar, spark, sparkColored, barColored, width, clip, stripAnsi, money,
} from '../src/report/format.js';
import { aggregate } from '../src/aggregate.js';
import { buildPayload, renderHtml } from '../src/report/html.js';
import { renderTerminal } from '../src/report/terminal.js';

test('hash53 est stable et distinct', () => {
  assert.equal(hash53('a|b'), hash53('a|b'));
  assert.notEqual(hash53('a|b'), hash53('a|c'));
  assert.ok(hash53('x') >= 0 && Number.isFinite(hash53('x')));
});

test('semaine ISO et écart de jours', () => {
  assert.equal(isoWeekStart('2026-08-11'), '2026-08-10'); // un mardi -> le lundi
  assert.equal(isoWeekStart('2026-08-10'), '2026-08-10');
  assert.equal(daysBetween('2026-08-01', '2026-08-11'), 10);
});

test('séries de jours consécutifs', () => {
  assert.deepEqual(streaks([]), { best: 0, current: 0 });
  assert.deepEqual(streaks(['2026-01-01', '2026-01-02', '2026-01-05']),
    { best: 2, current: 1 });
  assert.deepEqual(streaks(['2026-01-04', '2026-01-05', '2026-01-06']),
    { best: 3, current: 3 });
});

test('échelle courte française', () => {
  assert.equal(compact(999), '999');
  assert.equal(compact(12_345), '12 k');
  assert.equal(compact(1_234_567), '1,2 M');
  assert.equal(compact(123_456_789), '123 M');
  assert.equal(compact(83_400_000_000), '83,4 Md');
});

test('barres et sparklines restent dans leurs bornes', () => {
  assert.equal(bar(0, 100, 10), '');
  assert.equal(bar(100, 100, 10).length, 10);
  assert.equal(spark([0, 0]).length, 2);
  assert.equal(spark([1, 8, 4]).length, 3);
  assert.equal(width(sparkColored([1, 8, 4])), 3);
  assert.equal(stripAnsi(sparkColored([1, 8, 4])), spark([1, 8, 4]));
  assert.equal(width(barColored(100, 100, 10)), 10);
  assert.equal(stripAnsi(barColored(50, 100, 10)), bar(50, 100, 10));
});

test('largeur affichée : ANSI ignoré, emojis et CJK doubles, combinantes nulles', () => {
  assert.equal(width('abc'), 3);
  assert.equal(width('é—·'), 3);
  assert.equal(width('\x1b[1mabc\x1b[0m'), 3);
  assert.equal(width('🔥'), 2);
  assert.equal(width('⚡'), 2);
  assert.equal(width('✨ ai'), 5);
  assert.equal(width('█▁─'), 3, 'blocs et filets restent simples');
  assert.equal(width('文書'), 4, 'les idéogrammes occupent deux colonnes');
  assert.equal(width('가나'), 4, 'le hangul aussi');
  assert.equal(width('ＡＢ'), 4, 'formes pleine chasse');
  assert.equal(width('cafe\u0301'), 4, 'accent combinant (NFD) : largeur nulle');
  assert.equal(width('a\u200bb'), 2, 'largeur nulle pour les caractères de format');
});

test('money : deux décimales sous 10 $, entier au-delà', () => {
  assert.equal(money(0.42), '$0,42');
  assert.equal(money(9.99), '$9,99');
  assert.equal(money(12.6), '$13');
  assert.equal(money(0), '$0');
});

test('clip tronque aux colonnes affichées, ANSI préservé', () => {
  assert.equal(clip('abcdef', 10), 'abcdef');
  assert.equal(clip('abcdef', 4), 'abc…');
  assert.equal(clip('🔥🔥🔥', 4), '🔥…', 'un emoji occupe deux colonnes');
  const colored = clip('\x1b[1mabcdef\x1b[0m', 4);
  assert.equal(stripAnsi(colored), 'abc…');
  assert.ok(colored.endsWith('\x1b[0m'), 'la coupe referme la couleur');
  assert.ok(width(clip('\x1b]8;;http://x\x07abcdefgh', 6)) <= 6,
    'une séquence ESC non-SGR ne fait pas déborder la coupe');
});

test('walkFiles ignore les symlinks de répertoire',
  { skip: process.platform === 'win32' ? 'symlinks non créables sans privilèges' : false },
  () => {
  const root = mkdtempSync(join(tmpdir(), 'ai-agent-stats-walk-'));
  try {
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'x.jsonl'), '{}\n');
    writeFileSync(join(root, 'a', 'skip.txt'), 'non');
    symlinkSync(join(root, 'a'), join(root, 'alias'), 'dir');
    const files = walkFiles(root);
    assert.equal(files.length, 1, 'le répertoire aliasé ne doit pas être recompté');
    assert.ok(files[0].endsWith('x.jsonl'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Jeu d'essai minimal : deux entrées en double, dont une au total plus élevé. */
function fixture() {
  const S = 11;
  const rows = [];
  const push = (hExact, hMsg, ms, model, i, o, w5, w1, cr, side, sess) =>
    rows.push(hExact, hMsg, ms, model, i, o, w5, w1, cr, side, sess);
  const ts = Date.parse('2026-08-10T09:00:00Z');
  //                                        in   out  cw5m cw1h  cr   side sess
  push(111, 222, ts, 0, 10, 100, 0, 1000, 5000, 0, 0);  // 1re copie, flux coupé
  push(111, 222, ts, 0, 10, 400, 0, 1000, 5000, 0, 0);  // reprise complète -> doit gagner
  push(333, 444, ts, 0, 5, 50, 200, 0, 0, 0, 0);
  const sessions = [{
    file: 'projet/sess.jsonl', kind: 'main', project: 'projet', rootLevel: false,
    sessionId: 'sess', entrypoint: 'claude-vscode', version: '1', cwd: '/x',
    firstTs: ts, lastTs: ts, daysUtc: ['2026-08-10'], daysLocal: ['2026-08-10'],
    nLines: 3, nHuman: 2, nHumanCmd: 0, nAnswer: 1, nHumanSide: 0, nMeta: 0,
    nToolResult: 1, nAssistant: 3, nAssistantSide: 0, nAttachment: 0, nThinking: 1,
    nToolUse: 2, nApiErr: 0, nSdkPrompt: 0, humanChars: 42, aiChars: 100,
    usageRaw: [25, 550, 2200, 10000, 3],
  }];
  return {
    claude: {
      roots: ['/fake'], sessions, usage: [new Float64Array(rows)],
      models: ['claude-opus-4-5'], tools: new Map([['Bash', 2]]),
      hours: { localAll: new Array(24).fill(0), localHuman: new Array(24).fill(0), utcHuman: new Array(24).fill(0) },
      errors: [], files: 1,
    },
    clineGroups: [],
    codex: { tool: 'Codex', roots: [], sessions: [] },
    pricer: { cost: () => 1.5, source: 'test', available: true, unknown: new Set() },
    tz: 'Europe/Paris',
    hints: [],
    startedAt: Date.now(),
    S,
  };
}

test('sur doublon, l’entrée au plus gros total gagne', () => {
  const r = aggregate(fixture());
  // 400 (reprise) et non 100 (copie tronquée), + 50 de la seconde requête
  assert.equal(r.tokens.output, 450);
  assert.equal(r.tokens.input, 15);
  assert.equal(r.tokens.cacheWrite, 1200);
  assert.equal(r.tokens.cacheWrite1h, 1000);
  assert.equal(r.tokens.cacheRead, 5000);
  assert.equal(r.meta.dedup.dropped, 1);
  assert.equal(r.tokens.total, 15 + 450 + 1200 + 5000);
  assert.equal(r.tokens.fresh, 15 + 450 + 1200);
  assert.equal(r.tokens.io, 15 + 450);
});

test('le compteur naïf reprend l’usage brut, sans dédoublonnage', () => {
  const r = aggregate(fixture());
  assert.equal(r.tokens.naive, 25 + 550);
});

test('les messages humains et la surface sont attribués', () => {
  const r = aggregate(fixture());
  assert.equal(r.totals.sessions, 1);
  assert.equal(r.totals.human, 2);
  assert.equal(r.totals.humanAnswer, 1);
  assert.equal(r.surfaces[0].label, 'Claude Code — extension VS Code');
  assert.equal(r.surfaces[0].sessions, 1);
});

test('les deux rendus acceptent un rapport minimal', () => {
  const r = aggregate(fixture());
  const term = renderTerminal(r, { width: 100 });
  assert.match(term, /VUE D’ENSEMBLE/);
  assert.match(term, /Claude Code — extension VS Code/);
  assert.match(term, /POUR SITUER/);

  const payload = buildPayload(r);
  assert.equal(payload.hero.value, '1');
  assert.ok(payload.breakdown.total > 0);

  const html = renderHtml(r);
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(!html.includes('/*__DATA__*/null'), 'les données doivent être injectées');
  assert.ok(!html.includes('</script>{'), 'le JSON ne doit pas casser la balise script');
});

test('les encadrés du rendu terminal ont un bord droit aligné', () => {
  const r = aggregate(fixture());
  for (const w of [58, 74, 100, 120]) {
    const lines = renderTerminal(r, { width: w }).split('\n')
      .filter((l) => l.includes('│') || l.includes('╭') || l.includes('╰'));
    assert.ok(lines.length > 10, 'le rendu doit être encadré');
    const widths = new Set(lines.map((l) => width(l)));
    assert.equal(widths.size, 1,
      `toutes les lignes encadrées font la même largeur (largeur ${w} : ${[...widths]})`);
  }
});

test('le rendu coloré est le rendu neutre plus des couleurs bien formées', () => {
  const r = aggregate(fixture());
  const plain = renderTerminal(r, { width: 100, color: false });
  const colored = renderTerminal(r, { width: 100, color: true });
  assert.equal(plain.includes('\x1b'), false, 'sans couleur, zéro code ANSI');
  assert.ok(/\x1b\[38;5;\d+m/.test(colored), 'avec couleur, des codes 256 présents');
  assert.equal(stripAnsi(colored), plain, 'mêmes caractères sous les couleurs');
  assert.ok(!colored.includes('undefined'), 'aucun code couleur indéfini');
  const lines = colored.split('\n').filter((l) => l.includes('│'));
  const widths = new Set(lines.map((l) => width(l)));
  assert.equal(widths.size, 1, 'les encadrés colorés restent alignés');
});

test('bout en bout : les trois modes du CLI sur un transcript minimal', () => {
  const home = mkdtempSync(join(tmpdir(), 'ai-agent-stats-e2e-'));
  const proj = join(home, 'claude-config', 'projects', 'mon-projet');
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, 'sess1.jsonl'), [
    JSON.stringify({
      type: 'user', timestamp: '2026-08-10T09:00:00Z', entrypoint: 'claude-vscode',
      version: '2.0.0', cwd: '/x', message: { content: 'salut' },
    }),
    JSON.stringify({
      type: 'assistant', timestamp: '2026-08-10T09:00:05Z', requestId: 'req_1',
      message: {
        id: 'msg_1', model: 'claude-opus-5',
        content: [{ type: 'text', text: 'bonjour' }],
        usage: {
          input_tokens: 10, output_tokens: 100,
          cache_creation_input_tokens: 50, cache_read_input_tokens: 200,
        },
      },
    }),
  ].join('\n'));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    CLAUDE_CONFIG_DIR: join(home, 'claude-config'),
    NO_COLOR: '1',
  };
  const bin = fileURLToPath(new URL('../bin/ai-agent-stats.js', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [bin, '--offline', '-q', ...args],
    { env, encoding: 'utf8' });
  try {
    const json = run('--json');
    assert.equal(json.status, 0, json.stderr);
    const report = JSON.parse(json.stdout);
    assert.equal(report.totals.sessions, 1);
    assert.equal(report.tokens.total, 10 + 100 + 50 + 200);

    const term = run('--terminal');
    assert.equal(term.status, 0, term.stderr);
    assert.match(term.stdout, /VUE D’ENSEMBLE/);
    assert.equal(term.stdout.includes('\x1b'), false, 'NO_COLOR respecté');

    const out = join(home, 'rapport.html');
    const web = run('--out', out, '--no-open');
    assert.equal(web.status, 0, web.stderr);
    assert.match(web.stdout, /VUE D’ENSEMBLE/, 'le mode web affiche aussi le rapport terminal');
    assert.match(readFileSync(out, 'utf8'), /^<!DOCTYPE html>/, 'le HTML est bien écrit');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
