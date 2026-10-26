// état `$` : un prototype atteint par une clé venue de données et rangé dans l'état (`$racine = $$o.str[k]`, `k` valant
// `__proto__`) se lit comme JavaScript le lit. Le prototype d'une valeur simple (`String.prototype`, `Number.prototype`,
// `Boolean.prototype`, `Symbol.prototype`, `BigInt.prototype`) est rendu tel quel : ses méthodes vérifient leur `this`,
// une enveloppe les ferait lever — `String($racine)`, le gabarit, `+ ''`, `valueOf()`, `JSON.stringify` et `{$vue}`
// rendent ce que rend JavaScript (`''`, `0`, `false`), le composant ne tombe pas. Les autres prototypes (`Map`, `Set`,
// `Array`, `Date`, `RegExp`, tableaux typés, `Promise`) se lisent aussi comme en JavaScript : même valeur, ou même
// erreur. Civet et CoffeeScript, développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $$o = { str: 'abc', num: 1, boo: true, sym: Symbol('s'), big: BigInt(1), m: new Map(), s: new Set(), l: [], d: new Date(0), re: /x/, ta: new Uint8Array(1), pr: Promise.resolve(1) }
  $racine = null
  $vue = null
  @ranger = (src, k) -> $racine = $$o[src][k]
  @lire = -> $racine
  @montrer = (src) -> $vue = $$o[src]['__proto__']
</script>

<p class="vue">{$vue}</p>
`

const COFFEE = `<script lang="coffee">
$$c = { str: 'abc', num: 1, boo: true, sym: Symbol('s'), big: BigInt(1), m: new Map(), s: new Set(), l: [], d: new Date(0), re: /x/, ta: new Uint8Array(1), pr: Promise.resolve(1) }
$cr = null
$cv = null
@ranger = (src, k) -> $cr = $$c[src][k]
@lire = -> $cr
@montrer = (src) -> $cv = $$c[src]['__proto__']
</script>

<p class="vue">{$cv}</p>
`

// source → constructeur dont le prototype est atteint
const SOURCES: Record<string, string> = { str: 'String', num: 'Number', boo: 'Boolean', sym: 'Symbol', big: 'BigInt', m: 'Map', s: 'Set', l: 'Array', d: 'Date', re: 'RegExp', ta: 'Uint8Array', pr: 'Promise' }
const OPS: Record<string, (x: any) => any> = {
  texte: (x) => String(x),
  gabarit: (x) => `${x}`,
  concat: (x) => x + '',
  valeur: (x) => typeof x.valueOf(),
  etiquette: (x) => Object.prototype.toString.call(x),
  json: (x) => JSON.stringify(x),
}
const issue = (f: () => any) => {
  try {
    const r = f()
    return typeof r === 'string' ? `vaut ${JSON.stringify(r)}` : `vaut ${typeof r}`
  }
  catch (e: any) {
    return `lève ${e.name}`
  }
}

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'simple-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'simple-coffee.mjs'), COFFEE)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

async function monter(code: string, prod: boolean) {
  const window: any = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  const erreurs: string[] = []
  window.eval(prod ? code : `${code}\nglobalThis.µ = µ;`)
  if (!prod) window.µ.warn = (m: string) => avis.push(String(m))
  const err = window.console.error
  window.console.error = (...a: any[]) => { erreurs.push(a.map(String).join(' ')); return err }
  window.document.body.innerHTML = '<mjs-simple-civet></mjs-simple-civet><mjs-simple-coffee></mjs-simple-coffee>'
  const civet  = window.document.querySelector('mjs-simple-civet')
  const coffee = window.document.querySelector('mjs-simple-coffee')
  const vue    = (c: any) => c._shadow?.querySelector('.vue')?.textContent
  const fin    = Date.now() + 3000
  while (!(vue(civet) !== undefined && vue(coffee) !== undefined) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  return { window, civet, coffee, avis, erreurs, vue }
}

describe('état $ : un prototype rangé par une lecture se lit comme en JavaScript, celui d\'une valeur simple tel quel', function () {
  this.timeout(240000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('proto-simple', false)
    codes.prod = await construire('proto-simple-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    const nom  = mode === 'dev' ? 'développement' : 'production'
    const prod = mode === 'prod'

    it(`${nom} : String(x), gabarit, + '', valueOf, étiquette, JSON rendent ce que rend JavaScript, pour chaque prototype, Civet et CoffeeScript`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        const ecarts: string[] = []
        for (const [langue, c] of [['Civet', m.civet], ['CoffeeScript', m.coffee]] as [string, any][]) {
          for (const [src, ctor] of Object.entries(SOURCES)) {
            c.ranger(src, '__proto__')
            const x = c.lire()
            const brut = m.window.eval(`${ctor}.prototype`)
            for (const [op, f] of Object.entries(OPS)) {
              const a = issue(() => f(x))
              const b = issue(() => f(brut))
              if (a !== b) ecarts.push(`${langue} ${ctor}.prototype ${op} : ${a} au lieu de ${b}`)
            }
          }
        }
        assert.deepEqual(ecarts, [])
        if (!prod) assert.deepEqual(m.avis, [])
      }
      finally {
        m.window.close()
      }
    })

    it(`${nom} : {$vue} affiche le prototype d'une valeur simple comme JavaScript ('', 0, false), le composant ne tombe pas`, async () => {
      const ecarts: string[] = []
      for (const [src, attendu] of [['str', ''], ['num', '0'], ['boo', 'false']]) {
        // une page neuve par source : un composant tombé le reste
        const m = await monter(codes[mode], prod)
        try {
          for (const [langue, c] of [['Civet', m.civet], ['CoffeeScript', m.coffee]] as [string, any][]) {
            c.montrer(src)
            await new Promise((r) => setTimeout(r, 30))
            if (m.vue(c) !== attendu) ecarts.push(`${langue} ${src} : affiche ${JSON.stringify(m.vue(c))} au lieu de ${JSON.stringify(attendu)}`)
          }
          if (m.erreurs.some((e) => /Crash|TypeError/.test(e))) ecarts.push(`${src} : erreurs ${JSON.stringify(m.erreurs).slice(0, 200)}`)
        }
        finally {
          m.window.close()
        }
      }
      assert.deepEqual(ecarts, [])
    })
  }
})
