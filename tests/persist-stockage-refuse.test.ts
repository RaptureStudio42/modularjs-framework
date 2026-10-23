// `@persist` quand le navigateur refuse le stockage (navigation privée, accès bloqué, quota plein) : le simple
// accès à `localStorage`/`sessionStorage` peut lever, tout comme `getItem` et `setItem`. Dans le code émis, chaque
// référence au stockage doit donc être dans le bloc d'un `try` de la MÊME fonction (le constructeur pour la
// lecture, le rappel de l'effet pour l'écriture), et le `catch` ne dit rien : ni relance, ni message.
// La lecture n'a qu'UNE garde : `getItem` et `JSON.parse` sont dans le même `try`.
// La garde ne couvre QUE le stockage : la clé de `by:` (celle de la lecture comme celle de chaque écriture) et
// `JSON.stringify` restent hors de tout `try`, une faute dans l'un ou l'autre sort comme sans garde.

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { transpile } from '../src/transpiler/index.js'

interface Reference {
  backend: string
  method: string | null
  garde: any | null
}

interface Call {
  name: string
  garde: any | null
}

// la fonction appelée par les `by:` du test : ses appels sont comptés dans le code émis
const BY_CALL = 'userKey'

const FONCTIONS = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'])

// la ligne d'import du cœur porte un `µ.asset(…)` que seul le bundler résout : acorn ne le lirait pas
function fixImportSpecifier(output: string): string {
  return output.replace(/from\s+µ\.asset\([^)]*\)/, 'from \'mjs_core.js\'')
}

// le `try` dont le BLOC contient le nœud (le `catch` ne garde rien), sans traverser une fonction
function gardeDe(ancetres: any[]): any | null {
  for (let i = ancetres.length - 2; i >= 0; i--) {
    const a = ancetres[i]
    if (FONCTIONS.has(a.type)) return null
    if (a.type === 'TryStatement' && ancetres[i + 1] === a.block) return a
  }
  return null
}

async function analyser(source: string, moduleName: string): Promise<{ references: Reference[], effets: { deps: string[], ecrit: boolean }[], outside: Call[] }> {
  const { output }                                   = await transpile(source, { moduleName })
  const ast                                          = acorn.parse(fixImportSpecifier(output), { ecmaVersion: 'latest', sourceType: 'module' })
  const references: Reference[]                      = []
  const effets: { deps: string[], ecrit: boolean }[] = []
  const outside: Call[]                              = []
  walk.ancestor(ast, {
    Identifier(node: any, _etat: any, ancetres: any[]) {
      if (node.name !== 'localStorage' && node.name !== 'sessionStorage') return
      const parent = ancetres[ancetres.length - 2]
      const method = parent.type === 'MemberExpression' && parent.object === node ? parent.property.name : null
      references.push({ backend: node.name, method, garde: gardeDe(ancetres) })
    },
    CallExpression(node: any, _etat: any, ancetres: any[]) {
      const c = node.callee
      if (c.type === 'Identifier' && c.name === BY_CALL) outside.push({ name: BY_CALL, garde: gardeDe(ancetres) })
      if (c.type === 'MemberExpression' && c.object.name === 'JSON' && c.property.name === 'stringify') outside.push({ name: 'JSON.stringify', garde: gardeDe(ancetres) })
      if (c.type !== 'MemberExpression' || c.object.name !== 'µ' || c.property.name !== 'effect') return
      const deps = (node.arguments[1]?.elements ?? []).map((e: any) => e.value)
      let ecrit  = false
      walk.simple(node.arguments[0], { Identifier(n: any) { if (n.name === 'localStorage' || n.name === 'sessionStorage') ecrit = true } })
      effets.push({ deps, ecrit })
    },
  })
  return { references, effets, outside }
}

// ce que le `catch` contient : relance ou appel (message, journal…) seraient du bruit
function bruyant(garde: any): boolean {
  let bruit = false
  walk.simple(garde.handler.body, {
    ThrowStatement() { bruit = true },
    CallExpression() { bruit = true },
    NewExpression() { bruit = true },
  })
  return bruit
}

function appelleJsonParse(bloc: any): boolean {
  let trouve = false
  walk.simple(bloc, {
    CallExpression(n: any) {
      if (n.callee.type === 'MemberExpression' && n.callee.object.name === 'JSON' && n.callee.property.name === 'parse') trouve = true
    },
  })
  return trouve
}

// keyCalls : appels de BY_CALL attendus (la clé de lecture + la clé de chaque écriture) ; deps : dépendances de l'effet d'écriture (1 par défaut)
const CAS: { nom: string, source: string, lectures: number, locales: number, keyCalls: number, deps?: number }[] = [
  {
    nom: '@persist $x (localStorage)',
    source: ['<script>$draft = \'depart\'</script>', '@persist $draft', '<p>{$draft}</p>'].join('\n'),
    lectures: 1,
    locales: 1,
    keyCalls: 0,
  },
  {
    nom: '@persist session: $x (sessionStorage)',
    source: ['<script>$step = 1</script>', '@persist session: $step', '<p>{$step}</p>'].join('\n'),
    lectures: 1,
    locales: 0,
    keyCalls: 0,
  },
  {
    nom: '@persist $a $b (plusieurs variables) + une variable de session',
    source: ['<script>$a = 1\n$b = 2\n$c = 3</script>', '@persist $a $b', '@persist session: $c', '<p>{$a} {$b} {$c}</p>'].join('\n'),
    lectures: 3,
    locales: 2,
    keyCalls: 0,
  },
  {
    nom: '@persist … by: (clé dynamique)',
    source: ['<script>$foo = 1</script>', '@persist session: $foo by: window.location.hash', '<p>{$foo}</p>'].join('\n'),
    lectures: 1,
    locales: 0,
    keyCalls: 0,
  },
  {
    nom: '@persist … by: $uid (clé dynamique qui suit une variable réactive)',
    source: ['<script>$cart = 1\n$uid = 2</script>', `@persist $cart by: ${BY_CALL}($uid)`, '<p>{$cart} {$uid}</p>'].join('\n'),
    lectures: 1,
    locales: 1,
    keyCalls: 2,
    deps: 2,
  },
]

describe('@persist — chaque appel au stockage du code émis est sous garde', function () {
  this.timeout(20000)

  for (const cas of CAS) {
    describe(cas.nom, () => {
      let analyse: Awaited<ReturnType<typeof analyser>>

      before(async () => { analyse = await analyser(cas.source, 'mjs-persist-garde') })

      it('une lecture et une écriture par variable (le test ne passe pas à vide)', () => {
        const methodes = analyse.references.map((r) => r.method)
        assert.equal(methodes.filter((m) => m === 'getItem').length, cas.lectures, `getItem : ${JSON.stringify(methodes)}`)
        assert.equal(methodes.filter((m) => m === 'setItem').length, cas.lectures, `setItem : ${JSON.stringify(methodes)}`)
        assert.equal(analyse.references.length, cas.lectures * 2, 'aucune autre référence au stockage')
        assert.equal(analyse.references.filter((r) => r.backend === 'localStorage').length, cas.locales * 2)
      })

      it('l\'accès au stockage lui-même, getItem et setItem sont dans le bloc d\'un try de leur fonction', () => {
        for (const r of analyse.references) assert.ok(r.garde, `${r.backend}.${r.method ?? '?'} est hors de tout try`)
      })

      it('getItem et JSON.parse partagent la même garde', () => {
        const lectures = analyse.references.filter((r) => r.method === 'getItem')
        for (const r of lectures) assert.ok(r.garde !== null && appelleJsonParse(r.garde.block), `${r.backend}.getItem : JSON.parse n'est pas sous la même garde`)
      })

      it('le catch ne dit rien : ni relance, ni appel', () => {
        for (const r of analyse.references) {
          assert.ok(r.garde?.handler, `${r.backend}.${r.method} : pas de catch`)
          assert.equal(bruyant(r.garde), false, `${r.backend}.${r.method} : le catch relance ou appelle quelque chose`)
        }
      })

      it('JSON.stringify et la clé de by: restent hors de toute garde : une faute là sort comme sans garde', () => {
        const stringifies = analyse.outside.filter((h) => h.name === 'JSON.stringify')
        const keys        = analyse.outside.filter((h) => h.name === BY_CALL)
        assert.equal(stringifies.length, cas.lectures, 'un JSON.stringify par variable')
        assert.equal(keys.length, cas.keyCalls, 'la clé de by: est calculée pour la lecture ET pour chaque écriture')
        for (const h of analyse.outside) assert.ok(h.garde === null, `${h.name} est dans le bloc d'un try : une faute serait avalée`)
      })

      it('l\'effet d\'écriture dépend toujours de sa variable (la garde ne cache pas la lecture)', () => {
        const ecrivains = analyse.effets.filter((e) => e.ecrit)
        assert.equal(ecrivains.length, cas.lectures, 'un effet d\'écriture par variable')
        for (const e of ecrivains) assert.equal(e.deps.length, cas.deps ?? 1, `dépendances annoncées : ${JSON.stringify(e.deps)}`)
      })
    })
  }
})
