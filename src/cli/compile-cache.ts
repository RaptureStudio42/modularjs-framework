// cache de compilation de Node (22.8 et plus), ouvert par bin/mjs AVANT de charger la CLI : ses modules, compilés une fois, sont relus tels
// quels aux lancements suivants (cf. worker-pool.ts, qui passe le même dossier aux ouvriers). Dans `mjs-node-cache-<uid>` du dossier
// temporaire, créé et vérifié comme celui des entrées serveur (cf. private-tmp-dir.ts) ; un dossier refusé ou un dossier temporaire absent :
// pas de cache, sans erreur. NODE_DISABLE_COMPILE_CACHE=1 le coupe ; un NODE_COMPILE_CACHE déjà posé, Node le suit déjà. Toutes les
// commandes sauf `dev`, `ws` et `server`, qui restent lancées et rechargent leurs fichiers par `?v=n` : Node y garderait une entrée par
// rechargement, jamais purgée (`serve` et `mcp` restent lancées mais ne rechargent rien) ; leurs ouvriers suivent (sans cache ouvert,
// worker-pool.ts ne leur passe aucun dossier)
import module from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { privateTmpDir } from './private-tmp-dir.js'

// mots de commande et drapeaux qui prennent la valeur suivante, les mêmes que parseArgs (cf. src/cli.ts) : la CLI n'est pas encore chargée
const COMMANDS     = ['init', 'build', 'dev', 'check', 'serve', 'ws', 'server', 'mcp']
const VALUE_FLAGS  = ['--root', '--manifest', '--output', '--entry', '--port', '--host']
const LONG_RUNNING = ['dev', 'ws', 'server']

// la commande lue comme parseArgs la lit : le dernier mot de commande l'emporte, `--once` vaut `build`, la valeur d'un drapeau n'est jamais
// une commande (`--root server`) ; `--help` et `--version` répondent avant toute commande (cf. run(), src/cli.ts), ponctuels
function longRunning(argv: string[]): boolean {
  let command = 'build'
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help' || a === '-v' || a === '--version') return false
    if (COMMANDS.includes(a)) command = a
    if (a === '--once') command = 'build'
    // valeur absente ou qui commence par `-` : jamais prise, comme value() de parseArgs
    if (VALUE_FLAGS.includes(a) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) i++
  }
  return LONG_RUNNING.includes(command)
}

export function openCompileCache(): void {
  const node = module as { enableCompileCache?: (dir?: string) => unknown }
  if (typeof node.enableCompileCache !== 'function' || process.env.NODE_DISABLE_COMPILE_CACHE || process.env.NODE_COMPILE_CACHE || longRunning(process.argv.slice(2))) return
  const dir = join(tmpdir(), `mjs-node-cache-${process.getuid?.() ?? 'nouid'}`)
  try {
    if (privateTmpDir(dir)) node.enableCompileCache(dir)
  }
  catch {
    // une accélération seulement : un dossier impossible à créer ne bloque jamais la CLI
  }
}

openCompileCache()
