// bundler/worker-pool — pool de workers réutilisables pour `transpile()`.
//
// Pool de taille fixe (~cpus().length workers). Chaque worker reste alive
// pour toute la durée du Bundler — pas de spawn/teardown par fichier (le
// startup d'un worker coûte ~50-100ms, on amortit sur 100+ fichiers).
//
// API :
//   pool.submit(msg) → Promise<result>     // file vers worker libre, FIFO
//   pool.terminate() → Promise<void>       // clean shutdown
//
// Robustesse :
//   - Un worker perdu (crash, sortie, délai dépassé) est retiré et REMPLACÉ : le pool garde sa taille, une tâche
//     lente ne le fait plus rétrécir pour toutes les suivantes. Pas de remplaçant quand les pertes s'enchaînent sans
//     une seule réponse entre elles (worker cassé au démarrage : jamais une boucle de naissances).
//   - La tâche d'un worker perdu a une seconde chance, en tête de queue ; perdue une seconde fois, elle part au repli
//     (`WorkerPoolOpts.fallback`, la même tâche hors des workers), sinon elle est rejetée. Une ligne dit chaque
//     nouvel essai et chaque repli.
//   - Une tâche qui, COMMENCÉE (accusé du worker), a dépassé le délai ne part jamais au repli : rien n'y bornerait sa
//     durée ni sa mémoire (compilateur sans fin, processus principal emporté). Perdue une seconde fois, elle est rejetée
//     avec une erreur qui la nomme, comme une erreur du fichier. Le worker perdu ainsi est remplacé sans compter parmi
//     les pertes d'affilée : des fichiers trop longs ne tuent jamais le pool, dont la mort ferait passer toute la suite
//     au repli (au plus un remplaçant par délai écoulé et par worker, jamais une boucle de naissances).
//   - Une erreur RENDUE par la tâche (`ok: false`) n'est jamais reprise : c'est le fichier qui est en faute.
//   - Un pool mort (plus aucun worker, plus de remplaçant) n'est jamais recréé (cf. ensureWorkerPool, bundler/index.ts) : avec
//     un repli, il fait lui-même chaque tâche suivante, sans relancer un seul fil, et une ligne le dit une fois pour toute la
//     suite. Borne nette : un worker cassé dès son démarrage fait lancer la taille du pool et autant de remplaçants, une fois.
//
// Détection mode dev/prod : le worker script peut être .ts (dev via tsx)
// ou .js (prod compilé). `resolveWorkerScript` cherche les deux et passe
// le bon `execArgv` au Worker pour tsx en dev.

import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { t } from '../messages/index.js'

interface WorkerSpec {
  /** Path absolu vers le script du worker (.mjs bootstrap ou .js compilé). */
  workerPath: string
  /** Si non null, passé via `workerData` au worker (path du .ts à importer en dev). */
  workerData?: any
}

// délai maximal d'une tâche, compté à partir du moment où son worker la COMMENCE (accusé `{ id, started }`, cf.
// worker.ts) : ni l'attente en queue (congestion normale sous forte charge) ni le démarrage du worker (chargement de
// son paquet, plusieurs secondes sur une machine chargée) n'en mangent une part. Avant l'accusé, le même délai borne
// l'attente du début : un worker qui ne commence jamais la tâche est perdu comme un autre. Au-delà : worker perdu
// (cf. loseWorker) — retiré, remplacé, jamais réutilisé (un worker qui a débordé une fois reste suspect).
// Constante nommée, overridable via `WorkerPoolOpts.timeoutMs` (tests).
const DEFAULT_SUBMIT_TIMEOUT_MS = 60_000

/** minuteries du pool : celles de Node par défaut, une horloge factice dans les tests */
export interface PoolTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

interface WorkerPoolOpts {
  /** Délai maximal (ms) d'une tâche commencée, et de l'attente de son début. Défaut DEFAULT_SUBMIT_TIMEOUT_MS. */
  timeoutMs?: number
  /** Repli d'une tâche perdue deux fois (worker mort, ou qui ne la commence pas dans le délai), ou sans plus aucun worker
   *  pour la reprendre : la même tâche, faite hors des workers. Sans lui, la tâche est rejetée. Jamais appelé pour une
   *  tâche qui, commencée, a dépassé le délai : elle est rejetée (cf. giveUp). */
  fallback?: (msg: any) => Promise<any>
  /** Reçoit la ligne de chaque nouvel essai et de chaque repli. Défaut : console.warn. */
  log?: (line: string) => void
  /** Minuteries du délai (tests). Défaut : setTimeout/clearTimeout de Node. */
  timers?: PoolTimers
}

interface PendingTask {
  msg: any
  resolve: (v: any) => void
  reject: (e: any) => void
  /** essais déjà perdus (worker mort ou délai dépassé) : 0, puis 1 pour la seconde chance */
  lost: number
  /** essais qui, commencés, ont dépassé le délai : dès le premier, plus jamais de repli (cf. giveUp) */
  overdue: number
}

interface InFlightTask extends PendingTask {
  worker: Worker
  /** minuteur du délai par tâche — CLEARÉ dès la réponse (handleResponse) ou la perte du worker (loseWorker) :
   *  jamais laissé courir après coup, sinon il finirait par juger un AUTRE worker/tâche que le sien. Remplacé par un
   *  neuf à l'accusé de début. */
  timer: unknown
  /** accusé de début reçu : un délai dépassé ensuite est celui du fichier, plus celui du worker */
  started: boolean
}

/** nom d'une tâche dans les messages : son module, à défaut son type */
function taskName(msg: any): string {
  return String(msg?.moduleName ?? msg?.type ?? '?')
}

export class WorkerPool {
  private workers: Worker[] = []
  private idle: Worker[] = []
  private queue: PendingTask[] = []
  private nextId = 0
  private inFlight = new Map<number, InFlightTask>()
  private terminated = false
  private size: number
  private spec: WorkerSpec
  private timeoutMs: number
  private fallback: ((msg: any) => Promise<any>) | undefined
  private log: (line: string) => void
  private timers: PoolTimers
  // workers perdus d'affilée, sans une réponse entre eux : au-delà de la taille du pool, plus de remplaçant
  private lossesInARow = 0
  // la ligne du repli direct (pool mort) est déjà écrite : une seule pour toute la suite
  private directSaid = false

  constructor(size: number, spec: WorkerSpec, opts: WorkerPoolOpts = {}) {
    this.size      = size
    this.spec      = spec
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS
    this.fallback  = opts.fallback
    this.log       = opts.log ?? (line => console.warn(line))
    this.timers    = opts.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout) }
    for (let i = 0; i < size; i++) this.spawn()
  }

  // un worker de plus, branché et libre : à la création du pool, puis en remplaçant d'un worker perdu
  private spawn(): void {
    const w = new Worker(this.spec.workerPath, {
      workerData: this.spec.workerData,
    })
    w.on('message', (response: any) => this.handleResponse(w, response))
    w.on('error', (err: Error) => this.loseWorker(w, err))
    // Un thread peut SORTIR sans émettre 'error' (process.exit, OOM) : sans
    // ce handler, ses tâches in-flight pendaient à jamais et le worker mort
    // restait éligible au dispatch.
    w.on('exit', (code: number) => {
      if (this.terminated) return
      // Un `exit` code 0 AVEC une tâche en vol (process.exit propre côté
      // worker, OOM silencieux…) laissait la promesse orpheline : on traite
      // sa tâche + la queue via loseWorker, comme pour un crash.
      // Sinon (worker idle qui sort proprement), simple retrait.
      const hasInFlight = [...this.inFlight.values()].some(p => p.worker === w)
      if (code !== 0 || hasInFlight) {
        this.loseWorker(w, new Error(t('bundler.worker-pool.worker-sorti', { code })))
      } else {
        this.removeWorker(w)
      }
    })
    // Note : on NE PAS unref() — sinon Node peut exit avant que les workers
    // aient eu le temps de répondre (les pending promises n'empêchent pas
    // Node d'exit sur des workers unref'd). Le caller DOIT appeler
    // `pool.terminate()` (ou `bundler.close()`) explicitement.
    this.workers.push(w)
    this.idle.push(w)
  }

  /** true si le pool n'a plus AUCUN worker vivant (tous crashés/sortis). Avec un repli, il fait lui-même les tâches
   *  suivantes (cf. submit) ; sans repli, il les rejette. */
  isDead(): boolean {
    return this.workers.length === 0
  }

  /** Soumet un message au prochain worker libre. Retourne le résultat. */
  submit<T = any>(msg: any): Promise<T> {
    if (this.terminated) {
      return Promise.reject(new Error(t('bundler.worker-pool.deja-termine')))
    }
    // Aucun worker vivant : la tâche partirait en queue sans jamais être dispatchée (personne pour la traiter) → hang. Le
    // repli la fait tout de suite, sans relancer de fil (un pool mort reste mort : borne nette du nombre de fils), une ligne
    // le dit à la première ; sans repli, elle est rejetée
    if (this.workers.length === 0) {
      const fallback = this.fallback
      if (!fallback) return Promise.reject(new Error(t('bundler.worker-pool.aucun-worker-vivant')))
      if (!this.directSaid) this.log(t('bundler.worker-pool.repli-direct'))
      this.directSaid = true
      const direct    = { ...msg, id: this.nextId++ }
      return Promise.resolve().then(() => fallback(direct))
    }
    return new Promise<T>((resolve, reject) => {
      const task = { msg: { ...msg, id: this.nextId++ }, resolve, reject, lost: 0, overdue: 0 }
      const w    = this.idle.pop()
      if (w) {
        this.dispatch(w, task)
      } else {
        this.queue.push(task)
      }
    })
  }

  // dispatch — poste la tâche à `w` et arme son délai (armTimer). Un seul point de dispatch pour les 3 appelants
  // (submit(), handleResponse(), redispatchQueue()) : le minuteur ne peut pas être oublié sur l'un d'eux.
  private dispatch(w: Worker, task: PendingTask): void {
    const entry: InFlightTask = { ...task, worker: w, timer: undefined, started: false }
    entry.timer = this.armTimer(task.msg.id, entry)
    this.inFlight.set(task.msg.id, entry)
    w.postMessage(task.msg)
  }

  // délai de la tâche `id` : au-delà de `timeoutMs` sans réponse, son worker est perdu (loseWorker : retrait,
  // remplaçant, seconde chance) puis `terminate()` forcé (le thread est planté pour de bon, jamais laissé tourner en
  // tâche de fond). La décision attend un tour de boucle (setImmediate) : une réponse arrivée pendant que ce thread
  // était occupé (repli en cours, gros calcul) passe avant elle, un accusé de début arrivé entre-temps réarme le
  // délai — seul un worker resté VRAIMENT muet est perdu. Une tâche commencée (accusé reçu) qui dépasse le délai est
  // marquée : c'est le fichier qui retient le compilateur, elle ne partira jamais au repli (cf. giveUp).
  private armTimer(id: number, entry: InFlightTask): unknown {
    const handle = this.timers.setTimeout(() => {
      setImmediate(() => {
        if (this.inFlight.get(id) !== entry || entry.timer !== handle) return
        if (entry.started) entry.overdue++
        this.loseWorker(entry.worker, new Error(t('bundler.worker-pool.tache-timeout', { fichier: taskName(entry.msg), ms: this.timeoutMs })), entry.started)
        void entry.worker.terminate().catch(() => {})
      })
    }, this.timeoutMs)
    return handle
  }

  private handleResponse(w: Worker, response: any): void {
    const pending = this.inFlight.get(response.id)
    // réponse orpheline, ou venue d'un worker déjà perdu dont la tâche est repartie ailleurs sous le même id : ignorée
    if (!pending || pending.worker !== w) return
    this.timers.clearTimeout(pending.timer)
    // accusé de début : le délai repart de zéro, la tâche reste en vol
    if (response.started) {
      pending.started = true
      pending.timer   = this.armTimer(response.id, pending)
      return
    }
    this.inFlight.delete(response.id)
    this.lossesInARow = 0

    if (response.ok) {
      pending.resolve(response.result)
    } else {
      const err = new Error(response.error ?? t('bundler.worker-pool.erreur-inconnue'))
      if (response.stack) (err as any).stack = response.stack
      pending.reject(err)
    }

    // Worker libre : dispatch la prochaine tâche en queue ou retour en idle.
    const next = this.queue.shift()
    if (next) {
      this.dispatch(w, next)
    } else {
      this.idle.push(w)
    }
  }

  // worker perdu (crash, sortie, délai dépassé) : retiré, remplacé (tant que les pertes ne s'enchaînent pas, cf.
  // lossesInARow), ses tâches en vol repartent (retry) et la queue est redistribuée. Avant : le worker n'avait pas de
  // remplaçant, chaque perte rétrécissait le pool pour toutes les tâches suivantes (cascade sous forte charge). Un
  // worker déjà retiré est ignoré : l'`exit` qui suit son terminate() ne compte pas une seconde fois. `overdue` : le
  // worker a commencé sa tâche puis dépassé le délai — il a prouvé qu'il marche, la perte n'entre pas dans les pertes
  // d'affilée (le pool ne meurt pas de fichiers trop longs).
  private loseWorker(w: Worker, err: Error, overdue = false): void {
    if (this.terminated || !this.workers.includes(w)) return
    this.removeWorker(w)
    if (!overdue) this.lossesInARow++
    if (this.lossesInARow <= this.size) {
      // remplaçant refusé par Node (jamais une exception dans le gestionnaire d'un worker : elle tuerait le processus) :
      // le pool continue avec ceux qui restent, et sans aucun, la queue part au repli ci-dessous
      try { this.spawn() } catch { /* pas de remplaçant */ }
    }
    for (const [id, p] of this.inFlight) {
      if (p.worker !== w) continue
      this.timers.clearTimeout(p.timer)
      this.inFlight.delete(id)
      this.retry(p, err)
    }
    if (this.workers.length === 0) {
      // plus aucun worker : la queue part au repli, ou est rejetée (si tous mouraient, compile() pendait sans message)
      const orphans = this.queue
      this.queue = []
      for (const p of orphans) this.giveUp(p, new Error(t('bundler.worker-pool.plus-aucun-worker', { message: err.message })))
    } else {
      this.redispatchQueue()
    }
  }

  // seconde chance d'une tâche perdue : en tête de queue (elle a déjà attendu son tour) ; perdue une seconde fois, repli
  // ou rejet (cf. giveUp)
  private retry(task: PendingTask, err: Error): void {
    if (task.lost > 0) {
      this.giveUp(task, err)
      return
    }
    this.log(t('bundler.worker-pool.nouvel-essai', { fichier: taskName(task.msg), raison: err.message }))
    this.queue.unshift({ msg: task.msg, resolve: task.resolve, reject: task.reject, lost: task.lost + 1, overdue: task.overdue })
  }

  // tâche que plus aucun worker ne reprendra : le repli la fait (une ligne le dit), sinon elle est rejetée. Une tâche
  // qui, commencée, a dépassé le délai est rejetée dans tous les cas, en la nommant : dans le processus principal, rien
  // ne bornerait ni sa durée ni sa mémoire
  private giveUp(task: PendingTask, err: Error): void {
    if (task.overdue > 0) {
      task.reject(new Error(t('bundler.worker-pool.delai-depasse', { fichier: taskName(task.msg), ms: this.timeoutMs, fois: task.overdue })))
      return
    }
    const fallback = this.fallback
    if (!fallback) {
      task.reject(err)
      return
    }
    this.log(t('bundler.worker-pool.repli-principal', { fichier: taskName(task.msg), raison: err.message }))
    Promise.resolve().then(() => fallback(task.msg)).then(task.resolve, task.reject)
  }

  private removeWorker(w: Worker): void {
    const wi = this.workers.indexOf(w)
    if (wi !== -1) this.workers.splice(wi, 1)
    const ii = this.idle.indexOf(w)
    if (ii !== -1) this.idle.splice(ii, 1)
  }

  private redispatchQueue(): void {
    let w = this.idle.pop()
    while (w && this.queue.length > 0) {
      this.dispatch(w, this.queue.shift()!)
      w = this.idle.pop()
    }
    if (w) this.idle.push(w)
  }

  async terminate(): Promise<void> {
    if (this.terminated) return
    this.terminated = true
    // Reject les tâches en attente
    for (const p of this.queue) {
      p.reject(new Error(t('bundler.worker-pool.terminate-queue')))
    }
    this.queue = []
    // Reject AUSSI les in-flight : `worker.terminate()` n'émet pas 'error' —
    // un compile() concurrent restait suspendu pour toujours.
    for (const [, p] of this.inFlight) {
      this.timers.clearTimeout(p.timer)
      p.reject(new Error(t('bundler.worker-pool.terminate-inflight')))
    }
    this.inFlight.clear()
    await Promise.all(this.workers.map(w => w.terminate()))
    this.workers = []
    this.idle = []
  }
}

/**
 * Localise (ou compile) le script worker.
 *
 * - En prod (dist) : `worker.js` est déjà compilé par `build:self`, on l'utilise direct.
 * - En dev (src .ts) : Node Workers ne supportent pas le chargement de `.ts`
 *   (l'option `--import tsx/esm` n'est pas appliquée aux threads workers).
 *   On compile donc `worker.ts` → `.mjs` via esbuild en mémoire, écrit dans
 *   un fichier cache de `os.tmpdir()`, et passe ce path au Worker.
 *   La compile coûte ~50-200ms one-time par session de bundler.
 */
export async function resolveWorkerScript(): Promise<WorkerSpec> {
  const thisFile = fileURLToPath(import.meta.url)
  const thisDir = dirname(thisFile)

  // En prod : .js compilé existe à côté de worker-pool.js
  const jsPath = join(thisDir, 'worker.js')
  if (existsSync(jsPath)) {
    return { workerPath: jsPath }
  }

  // En dev : compile worker.ts à la volée
  const tsPath = join(thisDir, 'worker.ts')
  if (!existsSync(tsPath)) {
    throw new Error(t('bundler.worker-pool.worker-ts-introuvable', { chemin: tsPath }))
  }
  const compiledPath = await compileWorkerInMemory(tsPath)
  return { workerPath: compiledPath }
}

// Cache du worker compilé pour éviter de re-compiler à chaque appel à
// `resolveWorkerScript`. La compile dure ~50-200ms et le résultat est
// déterministe pour un même worker.ts.
let _cachedWorkerJsPath: string | null = null

async function compileWorkerInMemory(workerTsPath: string): Promise<string> {
  if (_cachedWorkerJsPath && existsSync(_cachedWorkerJsPath)) {
    return _cachedWorkerJsPath
  }
  // Cache dir : on doit écrire le worker.mjs DANS un dossier qui a accès au
  // node_modules du projet MJS (pour résoudre les `import 'acorn'`, etc. à
  // l'exécution). `os.tmpdir()` est hors node_modules tree → import échoue.
  // Solution : chercher le node_modules ancestor depuis worker-pool.ts, et
  // écrire dans `<that_node_modules>/.cache/mjs/`.
  const { dir: cacheDir, bundleDeps } = findCacheDir(workerTsPath)
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
  // Hash sur le path pour éviter conflit entre projets utilisant MJS
  const projectHash = createHash('sha256').update(workerTsPath).digest('hex').slice(0, 8)
  const outFile = join(cacheDir, `worker-${projectHash}.mjs`)
  // `packages: 'external'` était
  // codé en DUR ici, contredisant la propre doc de `findCacheDir` juste en
  // dessous : dans le cas de repli `os.tmpdir()` (aucun `node_modules`
  // ancêtre trouvé), le fichier compilé est écrit HORS de tout arbre
  // node_modules — ses `import 'acorn'`/`import 'esbuild'`/etc. externes
  // ne peuvent alors JAMAIS être résolus à l'exécution (aucun node_modules
  // accessible depuis ce dossier) → le worker CRASHE AU BOOT
  // ("Cannot find module 'acorn'"). Le commentaire de `findCacheDir`
  // promettait déjà d'embarquer les deps pour ce cas précis — jamais
  // implémenté. Fix : `findCacheDir` renvoie maintenant aussi `bundleDeps`,
  // utilisé ici pour choisir le bon mode.
  //
  // `packages: 'external'` (cas normal) : les deps npm (acorn, esbuild,
  // @danielx/civet, etc.) restent en `import` runtime → résolues à
  // l'exécution depuis node_modules du projet. Pas de gros bundle, juste le
  // code MJS compilé. Repli : `packages` OMIS (pas `'bundle'` — vérifié
  // empiriquement que cette valeur n'existe pas dans l'esbuild installé,
  // rejetée au runtime avec "Invalid value 'bundle'" ; la doc de
  // `findCacheDir` employait ce mot à tort) — laisser `packages` à
  // `undefined` restaure le comportement de bundling COMPLET déjà induit
  // par `bundle: true` : esbuild résout et EMBARQUE alors chaque dépendance
  // directement dans le fichier de sortie (résolution effectuée depuis
  // `workerTsPath`, qui a TOUJOURS accès au node_modules du framework,
  // peu importe où le fichier de SORTIE atterrit ensuite) — plus gros et
  // plus lent au démarrage, mais fonctionne peu importe où il est chargé.
  // DURCISSEMENT — `worker-<hash>.mjs`
  // est le MÊME fichier pour tous les projets d'une installation : 2 process
  // (2 projets, CI parallèle) écrivant DIRECTEMENT dessus pouvaient laisser un
  // fichier TRONQUÉ pendant que l'autre spawne des Workers dessus → worker
  // cassé au boot. Écriture ATOMIQUE : esbuild écrit dans un temp UNIQUE (pid),
  // puis renameSync (atomique sur le même volume) — jamais d'état intermédiaire
  // visible, et un Worker déjà en cours de chargement garde son inode.
  const tmpOut = join(cacheDir, `worker-${projectHash}.${process.pid}.${Date.now()}.tmp.mjs`)
  await build({
    entryPoints: [workerTsPath],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    packages: bundleDeps ? undefined : 'external',
    outfile: tmpOut,
    logLevel: 'silent',
  })
  try {
    renameSync(tmpOut, outFile)
  } catch (e) {
    try { unlinkSync(tmpOut) } catch {}
    // Un autre process a pu gagner la course et produire un outFile valide
    // (même contenu, par construction) — dans ce cas, non fatal.
    if (!existsSync(outFile)) throw e
  }
  _cachedWorkerJsPath = outFile
  return outFile
}

/**
 * Cherche un dossier `node_modules/.cache/mjs` à partir du path donné en
 * remontant vers la racine. Si trouvé : retourne ce path avec `bundleDeps:
 * false` (les deps npm restent résolues à l'exécution depuis ce
 * node_modules). Sinon : fallback sur `os.tmpdir()/mjs-worker-cache/` avec
 * `bundleDeps: true` (aucun node_modules accessible depuis ce dossier —
 * les deps DOIVENT être embarquées dans le bundle, cf. `compileWorkerInMemory`).
 */
function findCacheDir(fromPath: string): { dir: string; bundleDeps: boolean } {
  let dir = dirname(fromPath)
  while (dir !== dirname(dir)) {  // jusqu'à la racine
    const nm = join(dir, 'node_modules')
    if (existsSync(nm)) {
      return { dir: join(nm, '.cache', 'mjs'), bundleDeps: false }
    }
    dir = dirname(dir)
  }
  // DURCISSEMENT — isole par UID : un tmpdir
  // PARTAGÉ (typiquement `/tmp`) rendait `mjs-worker-cache` PRÉVISIBLE et commun
  // à tous les utilisateurs de la machine (pré-seed / hijack d'un worker par un
  // autre utilisateur sur une machine multi-utilisateurs). `process.getuid` est
  // absent sous Windows → repli `'nouid'`.
  return { dir: join(tmpdir(), `mjs-worker-cache-${process.getuid?.() ?? 'nouid'}`), bundleDeps: true }
}

// Exports réservés aux tests (mineur : vérifier le choix packages:'bundle'
// vs 'external' sans dépendre du cache module-level, partagé avec le VRAI
// pool utilisé par les autres tests du process Mocha).
export const _internal = { compileWorkerInMemory, findCacheDir, resetCompileCache: () => { _cachedWorkerJsPath = null } }
