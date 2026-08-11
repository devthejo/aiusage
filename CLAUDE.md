# ai-agent-stats — état du projet

CLI Node sans dépendance qui compte sessions, messages et tokens des agents de
codage depuis les transcripts locaux, et rend un rapport HTML (défaut) ou terminal.

Commandes : voir `Taskfile.yml` (`task` seul les liste). `devbox install && task`
suffit à démarrer.

## Décisions verrouillées

- **Zéro dépendance runtime.** `npx ai-agent-stats` doit démarrer sans rien installer.
  Tout est Node natif : `worker_threads`, `fetch`, `node:test`.
- **Le français est la langue du produit** (aide, rapports, README). Les chaînes
  visibles vivent dans `src/report/terminal.js` et `assets/template.html` : une
  traduction se ferait là, et nulle part ailleurs.
- **ccusage est la référence sur les tokens.** Toute divergence au-delà de ~0,5 %
  sur input / output / cacheWrite / cacheRead est un bug chez nous.
  `task ccusage-diff` le vérifie. Leur source est clonée dans `.repos/ccusage`
  (Rust depuis la v20 : `rust/adapters/claude/src/daily.rs`).
- **Les trois périmètres de tokens sont le cœur du produit**, pas un détail
  d'affichage : « cache compris » (facturation), « hors relectures », « input +
  output ». Un seul chiffre induirait en erreur d'un facteur 30.

## Pièges payés

- **Dédoublonnage : garder l'entrée au plus gros total, pas la première.** Une
  reprise de session recopie l'historique dans un nouveau fichier ; la copie peut
  porter le décompte d'un flux interrompu. Garder la première sous-compte l'output
  de ~15 % et rend le résultat dépendant de l'ordre de lecture des fichiers.
  Clé de dédoublonnage : `message_id|request_id`, avec repli sur `message_id` seul
  quand l'une des deux entrées est une sidechain (les journaux de sidechain
  rejouent des messages parents avec un `request_id` neuf).
- **`input_tokens` de Codex englobe déjà `cached_input_tokens`.** Sans la
  soustraction, l'input double.
- **Le cache Claude Code est à TTL 1 h à ~99,99 %**, facturé 1,6× le tarif 5 min
  (`cache_creation_input_token_cost_above_1hr`). L'ignorer sous-estime le coût de
  ~10 %. Le détail vit dans `usage.cache_creation.ephemeral_1h_input_tokens`.
- **`~/.claude/projects` contient des symlinks de répertoire** (alias de chemins
  de devcontainer). Suivre les liens fait compter deux fois les mêmes sessions :
  `walkFiles` écarte les symlinks et déduplique par inode.
- **Les transcripts de sous-agents vivent dans `<projet>/<idSession>/subagents/`**
  et, pour les workflows, un cran plus bas. Ce ne sont pas des sessions : ils sont
  comptés à part, mais leurs tokens sont attribués à la surface de la session mère.
- **L'œuf et la poule du trusted publishing est réelle, côté registre.**
  `POST /-/package/<nom>/trust` répond 404 « Package not found » tant que le paquet
  n'existe pas ([npm/cli#8544](https://github.com/npm/cli/issues/8544)). Le
  `--dry-run` de `npm trust` ne contacte pas le serveur et affiche une configuration
  plausible : il ne prouve rien. La 1re version part de `task bootstrap`, la CI
  prend le relais en OIDC ensuite.
- **« 2FA required » de npm veut souvent dire « active la 2FA », pas « donne un
  code ».** Sur un compte sans 2FA, `--otp` est ignoré et aucun prompt ne s'ouvre.
  Vérifier d'abord : `npm profile get | grep two-factor` doit dire
  `auth-and-writes`.
- **`npm trust` exige npm >= 11.10**, alors que le nodejs de devbox embarque
  11.6.2 : les tâches épinglent `npx npm@11`.
- **Les messages « user » ne sont pas tous humains.** Un `type: "user"` peut être
  un résultat d'outil, une injection système (`isMeta`), un prompt SDK
  (`promptSource: "sdk"`) ou un prompt d'orchestration vers un sous-agent
  (`isSidechain`). Seul le reste est tapé par une personne — plus les réponses à
  `AskUserQuestion`, qui arrivent sous forme de `tool_result`.

## Structure

```
bin/ai-agent-stats.js        CLI : options, progression, ouverture du navigateur
src/index.js          buildReport() — point d'entrée programmatique
src/paths.js          où chaque outil range ses transcripts, par OS
src/collect/*.js      un collecteur par famille d'outil
src/workers/*.js      parsing parallèle (worker_threads)
src/aggregate.js      dédoublonnage + ventilation : tout le sens est ici
src/pricing.js        table LiteLLM, cache 24 h, résolution des noms de modèle
src/report/           rendus terminal et HTML + formatage partagé
assets/template.html  gabarit du rapport web, données injectées à la place de /*__DATA__*/
scripts/              vérification de cohérence, comparaison ccusage
test/                 fichiers nommés un par un dans `npm test` : `--test` n'expanse
                      les globs qu'à partir de Node 22, or le socle est Node 18.17
```

Le format d'échange entre worker et agrégateur est un `Float64Array` à plat, de
stride 11 : `[hExact, hMsg, tsMs, idxModèle, input, output, cacheWrite5m,
cacheWrite1h, cacheRead, sidechain, idxSession]`. Changer ce stride impose de
toucher les trois fichiers `workers/claude.js`, `collect/claude.js`,
`aggregate.js` — ils sont couplés par cet ordre.
