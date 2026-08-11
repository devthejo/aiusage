# aiusage

Compte tes sessions, tes messages et tes tokens d'agents de codage, à partir des
transcripts déjà présents sur ta machine. Rien n'est envoyé nulle part.

```bash
npx aiusage
```

Le rapport HTML s'ouvre dans le navigateur. `-t` pour le terminal, `-j` pour le JSON.

## Ce qui est lu

| Outil | Emplacement |
|---|---|
| Claude Code — extension VS Code, app desktop, terminal, Agent SDK, sous-agents et agents de workflow | `~/.claude/projects` (et `$CLAUDE_CONFIG_DIR`) |
| Roo Code · Cline · Kilo Code | `globalStorage/<extension>/tasks` de VS Code, VSCodium, Cursor, Windsurf, Trae, Positron |
| Codex | `~/.codex/sessions`, `~/.codex/archived_sessions` |

Un outil repéré sans collecteur dédié (opencode, Gemini CLI, Aider, Copilot) est
signalé dans les notes du rapport plutôt que compté à moitié.

## Ce qui est compté

**Sessions**, par surface — l'`entrypoint` inscrit dans chaque transcript sépare
l'extension VS Code, l'app desktop, le terminal et les exécutions *headless* du
SDK. Les sous-agents, ouverts par l'IA et non par un humain, sont comptés à part.

**Messages** — les messages réellement tapés par un humain (réponses aux questions
de l'agent comprises) sont distingués des prompts émis par du code via le SDK, des
prompts d'orchestration IA→sous-agent, et des résultats d'outil.

**Tokens**, sous trois périmètres, parce que le chiffre change d'un facteur 30
selon la question posée :

| Périmètre | Ce que ça mesure |
|---|---|
| Cache compris | tout ce qui a traversé un modèle — la base de facturation |
| Hors relectures | `input + output + écriture de cache` : le contenu vu une 1ʳᵉ fois |
| Input + output | cache entièrement retiré |

Le rapport donne aussi ce que compterait un **compteur naïf** (`input + output`
sans dédoublonnage) : c'est l'ordre de grandeur qu'affichent la plupart des
panneaux d'usage, et il peut être 100 fois inférieur au volume réel quand le
cache porte l'essentiel du trafic.

**Coût** — estimé au tarif API public, depuis la table
[LiteLLM](https://github.com/BerriAI/litellm) mise en cache 24 h dans
`~/.cache/aiusage`. Le tarif majoré du cache à TTL 1 h est appliqué quand le
transcript le distingue. Roo Code et Cline déclarant eux-mêmes leur coût, celui-ci
est repris tel quel. Sous forfait, ce n'est pas ce que tu paies.

## Options

```
-w, --web            rapport HTML ouvert dans le navigateur   (défaut)
-t, --terminal       rapport dans le terminal
-j, --json           rapport brut en JSON sur la sortie standard
-o, --out <fichier>  écrit le rapport dans ce fichier au lieu d'un temporaire
    --no-open        écrit le HTML sans ouvrir le navigateur
    --tz <zone>      fuseau pour les jours et les heures (défaut : celui du système)
    --offline        n'interroge pas le réseau ; sans tarifs en cache, pas de coût
    --refresh        force le rafraîchissement de la table de tarifs
-q, --quiet          pas de progression
```

`NO_COLOR=1` ou `--no-color` désactive les couleurs du rendu terminal.

## Comme bibliothèque

```js
import { buildReport, renderTerminal, renderHtml } from 'aiusage';

const report = await buildReport({ tz: 'Europe/Paris' });
console.log(report.tokens.total, report.totals.sessions);
process.stdout.write(renderTerminal(report));
```

`buildReport()` renvoie un objet stable : `meta`, `totals`, `tokens`, `surfaces`,
`timeline`, `hours`, `days`, `models`, `topTools`, `projects`. C'est la même
structure que celle produite par `--json`.

## Exactitude

Les totaux de tokens sont alignés sur [ccusage](https://github.com/ccusage/ccusage),
qui fait référence, à **0,04 % près** sur chacun des quatre compteurs (le résidu
est l'activité survenue entre les deux collectes). En particulier :

- Le dédoublonnage porte sur `message_id` + `request_id`, avec repli sur le seul
  `message_id` quand une sidechain rejoue un message parent.
- Sur doublon, **l'entrée au plus gros total gagne**. Garder la première
  sous-compterait l'output de ~15 % : une reprise de session recopie l'historique,
  et la copie peut porter le décompte d'un flux interrompu.

`task ccusage-diff` rejoue cette comparaison sur ta machine.

## Développement

```bash
devbox install && task
```

`task check` lance les tests unitaires puis vérifie sur tes vraies données que le
rapport est cohérent de bout en bout (périmètres emboîtés, sommes par surface,
dimensions des séries temporelles).

## Publication

La CI publie sur npm quand une **Release GitHub** est publiée. Le workflow vérifie
d'abord que le tag correspond à la version du `package.json`, rejoue les tests,
puis publie avec [provenance](https://docs.npmjs.com/generating-provenance-statements).

```bash
task release -- 0.2.0   # tests, bump, tag, push
```

L'authentification passe par le *trusted publishing* npm (OIDC) : aucun jeton à
stocker. À défaut, le workflow accepte un secret `NPM_TOKEN`.

## Licence

MIT
