// FERMETURE RÉELLE DES FENÊTRES HAPPY-DOM DES TESTS — importé par tmp-sweep.ts, donc chargé par tout run.
//
// window.close() ne fait rien sur une fenêtre faite par `new Window()` : happy-dom ne laisse un script fermer que
// les fenêtres ouvertes par window.open(). Un test qui fermait sa fenêtre par close() la laissait donc tourner jusqu'à
// la fin du processus, minuteries, boucles d'images et mémoire comprises (31 tours de minuterie et 128 391 images en
// 200 ms, mesurés après close()). Pour une fenêtre créée par le code des tests (un fichier sous tests/), close() passe
// ici par window.happyDOM.close() : tout s'arrête au retour, closed vaut true, un second close() ne fait rien. Une
// fenêtre créée ailleurs (src/ : rendu serveur, API de test publique ; appli compilée dans un dossier temporaire)
// garde le close() de happy-dom : ces chemins se testent tels qu'ils tournent chez l'utilisateur.
//
// FILET DE FIN DE FICHIER — une fenêtre jamais fermée, créée par le code même d'un fichier de test (pas par un aide
// partagé, qui pourrait la garder pour le fichier suivant), est fermée quand ce fichier a fini : tous ses tests joués
// et verts (ou sautés), et ses after() passés, puisque la fermeture attend le premier test d'un AUTRE fichier. Et
// seulement si plus rien ne la tient en global (la fenêtre, son document, une classe ou un objet à elle posé sur
// globalThis) : un fichier suivant pourrait encore s'en servir. Un fichier qui n'a pas tout joué (before en échec,
// --grep) ou qui a un test rouge garde ses fenêtres ouvertes, comme avant.

import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, PropertySymbol, Window } from 'happy-dom'

const SELF      = fileURLToPath(import.meta.url)
const TESTS_DIR = SELF.slice(0, SELF.lastIndexOf(`${sep}helpers${sep}`) + 1)
const HAPPY_DOM = `${sep}node_modules${sep}happy-dom${sep}`
const BIND      = (PropertySymbol as any).bindMethods
const proto     = BrowserWindow.prototype as any

if (typeof proto.close !== 'function' || typeof proto[BIND] !== 'function') {
  throw new Error('tests/helpers/happy-dom-fermeture.ts : BrowserWindow.prototype.close ou [PropertySymbol.bindMethods] introuvable — happy-dom a changé, la fermeture réelle des fenêtres de test ne peut plus se poser')
}

const fromTests   = new WeakSet<object>()                  //créées par le code des tests : close() les ferme vraiment
const byFile      = new Map<string, Set<WeakRef<any>>>()  //fichier → fenêtres créées par son propre code, pour le filet
const nodeGlobals = new Set<unknown>(Reflect.ownKeys(globalThis).map((k) => Object.getOwnPropertyDescriptor(globalThis, k)?.value))

// premier appelant hors happy-dom et hors de ce fichier, lu sur la pile
function creator(): string {
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 30
  const stack = new Error().stack ?? ''
  Error.stackTraceLimit = limit
  for (const line of stack.split('\n').slice(1)) {
    const m = /\(?((?:file:\/\/)?\/[^()]*?):\d+:\d+\)?$/.exec(line)
    if (!m) continue
    const file = m[1].startsWith('file://') ? fileURLToPath(m[1]) : m[1]
    if (file === SELF || file.includes(HAPPY_DOM)) continue
    return file
  }
  return ''
}

// bindMethods tourne dans le constructeur de chaque fenêtre et y fige close() : la pose précède toute fenêtre
const nativeBind = proto[BIND]
proto[BIND] = function (this: any) {
  nativeBind.call(this)
  if (!(this instanceof Window)) return                    //iframe ou window.open() : happy-dom les ferme déjà
  const file = creator()
  if (!file.startsWith(TESTS_DIR)) return
  fromTests.add(this)
  let refs = byFile.get(file)
  if (!refs) byFile.set(file, refs = new Set())
  refs.add(new WeakRef(this))
}

const nativeClose = proto.close
proto.close = function (this: any) {
  if (!fromTests.has(this)) return nativeClose.call(this)
  if (this.closed) return
  this.happyDOM.close().catch((e: any) => console.warn(`⚠  fermeture d'une fenêtre happy-dom de test : ${e?.message ?? e}`))
}

// valeurs communes à toutes les fenêtres (classes que happy-dom partage, globaux de Node) : posées sur globalThis par
// un fichier, elles ne disent pas QUELLE fenêtre est tenue — sans ce tri, un CustomEvent mis en global gardait tout ouvert
let shared: Set<unknown> | null = null

function sharedValues(): Set<unknown> {
  if (shared) return shared
  const ref: any = new Window({ url: 'http://localhost/' })
  shared = new Set(nodeGlobals)
  for (const key of Object.getOwnPropertyNames(ref)) shared.add(Object.getOwnPropertyDescriptor(ref, key)?.value)
  ref.happyDOM.close().catch((e: any) => console.warn(`⚠  fermeture de la fenêtre témoin du filet : ${e?.message ?? e}`))
  return shared
}

// la fenêtre, son document ou un objet à elle seule (classe, customElements, µ évalué dedans…) encore posé sur globalThis
function heldByGlobal(win: any): boolean {
  const common = sharedValues()
  const own    = new Set<unknown>([win, win.document])
  for (const key of Object.getOwnPropertyNames(win)) {
    const value = Object.getOwnPropertyDescriptor(win, key)?.value
    if (value && (typeof value === 'object' || typeof value === 'function') && !common.has(value)) own.add(value)
  }
  for (const key of Reflect.ownKeys(globalThis)) {
    if (own.has(Object.getOwnPropertyDescriptor(globalThis, key)?.value)) return true
  }
  return false
}

function closeWindowsOf(file: string): void {
  const refs = byFile.get(file)
  byFile.delete(file)
  for (const ref of refs ?? []) {
    const win = ref.deref()
    if (win && !win.closed && !heldByGlobal(win)) win.close()
  }
}

let remaining: Map<string, number> | null = null           //fichier → tests qui doivent encore tourner
const finished = new Set<string>()                          //fichiers finis et verts : fermés au premier test d'un autre fichier
const red      = new Set<string>()

function countTests(suite: any, out: Map<string, number>): void {
  for (const t of suite.tests) if (t.file && !t.isPending()) out.set(t.file, (out.get(t.file) ?? 0) + 1)
  for (const s of suite.suites) countTests(s, out)
}

// crochets racine (tmp-sweep.ts) : une erreur ici ne doit jamais faire tomber un crochet racine, qui sauterait tout le run
export function closeFinishedFiles(this: any): void {
  try {
    const test = this.currentTest
    if (!remaining) {
      let root = test.parent
      while (root.parent) root = root.parent
      countTests(root, remaining = new Map())
    }
    for (const file of finished) {
      if (file === test.file) continue
      finished.delete(file)
      closeWindowsOf(file)
    }
  }
  catch (e: any) {
    console.warn(`⚠  filet des fenêtres happy-dom : ${e?.message ?? e} — fenêtres laissées ouvertes`)
  }
}

export function countFinishedTest(this: any): void {
  try {
    const test = this.currentTest
    if (!remaining || !test?.file) return
    if (test.state === 'failed') red.add(test.file)
    if (test.state !== 'passed' && test.state !== 'failed' && test.state !== 'pending') return
    const left = (remaining.get(test.file) ?? 0) - 1
    remaining.set(test.file, left)
    if (left === 0 && !red.has(test.file)) finished.add(test.file)
  }
  catch (e: any) {
    console.warn(`⚠  filet des fenêtres happy-dom : ${e?.message ?? e} — fenêtres laissées ouvertes`)
  }
}
