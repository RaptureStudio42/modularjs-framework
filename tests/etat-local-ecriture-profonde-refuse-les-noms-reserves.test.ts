// état local `$` — une écriture profonde, clé calculée comprise (`$o[k1][k2] = v`, sur un chemin plus long, `delete`, une
// méthode (`push`) sur un élément du chemin), refuse une clé `'__proto__'`, `['__proto__']`, un objet dont `toString`
// rend `'__proto__'`, `'constructor'` ou `'prototype'` : rien n'est écrit, aucune erreur, un avertissement nomme le
// segment. Chaque forme est jouée sur l'état puis sur sa jumelle, la même source où `$o` est un objet ordinaire de la
// page (`globalThis.j_o`, que MJS ne réécrit pas) : la jumelle laisse la trace de JavaScript (prototype écrit ou effacé,
// fonction écrite, TypeError), l'état n'en laisse aucune, en développement comme en production (docs/03-reactivite.md ;
// docs/18-pieges.md, § 18)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SCRIPT = `
  $o = { a: { b: 1, l: [] }, tags: [] }
  @remettre = -> $o = { a: { b: 1, l: [] }, tags: [] }
  @lire = -> JSON.stringify($o)
  @cEgal = (k1, k2) -> $o[k1][k2] = 'pollue'
  @cProfond = (k1, k2) -> $o.a[k1][k2] = 'pollue'
  @cEfface = (k1, k2) -> delete $o[k1][k2]
  @cEffaceProfond = (k1, k2) -> delete $o.a[k1][k2]
  @cPousse = (k1) -> $o.tags[k1].push('pollue')
  @cPousseProfond = (k1) -> $o.a.l[k1].push('pollue')
`
const jumelle = (script: string) => script.replace(/\$(\w+)/g, 'globalThis.j_$1')

const SOURCES = {
  'profond.mjs': `<script>${SCRIPT}</script>\n\n<p class="etat">{JSON.stringify($o)}</p>\n`,
  'profond-js.mjs': `<script>${jumelle(SCRIPT)}</script>\n\n<p class="etat">jumelle</p>\n`,
}
const FORMES = ['cEgal', 'cProfond', 'cEfface', 'cEffaceProfond', 'cPousse', 'cPousseProfond']
const CLES: [string, () => any][] = [
  ['\'__proto__\'', () => '__proto__'],
  ['[\'__proto__\']', () => ['__proto__']],
  ['objet dont toString rend \'__proto__\'', () => ({ toString: () => '__proto__' })],
  ['\'constructor\'', () => 'constructor'],
  ['\'prototype\'', () => 'prototype'],
]
const TEMOINS = ['Object.prototype', 'Object', 'Array.prototype', 'Function.prototype']

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
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
  window.eval(prod ? code : `${code}\nglobalThis.µ = µ;`)
  if (!prod) window.µ.warn = (m: string) => avis.push(String(m))
  window.document.body.innerHTML = '<mjs-profond></mjs-profond><mjs-profond-js></mjs-profond-js>'
  const comp = window.document.querySelector('mjs-profond')
  const jum  = window.document.querySelector('mjs-profond-js')
  const etat = (c: any) => c._shadow?.querySelector('.etat')?.textContent
  const fin  = Date.now() + 3000
  while (!(etat(comp) && etat(jum)) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  return { window, comp, jum, avis, prod, etat: () => etat(comp) }
}

// trace d'une forme jouée avec une clé (aucune forme : rien n'est joué) : prototypes et fonctions écrits (`polluK`) ou
// effacés (`polluD`), `Array.prototype` rempli, nom de l'erreur levée, puis les données ; tout est retiré ensuite, les
// données remises
function tracer(window: any, c: any, forme: string, cle: any): string {
  const efface = forme.includes('Efface')
  window.eval(TEMOINS.map((t) => `Object.defineProperty(${t}, 'polluD', { value: 1, configurable: true, writable: true })`).join(';'))
  let erreur = ''
  try {
    if (forme) c[forme](cle, efface ? 'polluD' : 'polluK')
  }
  catch (e: any) {
    erreur = e.name
  }
  const pollue = window.eval(`[${TEMOINS.map((t) => `Object.prototype.hasOwnProperty.call(${t}, 'polluK') ? '${t}.polluK' : ''`).join(', ')}, Array.prototype.length ? 'Array.prototype[0]' : '', ${TEMOINS.map((t) => `Object.prototype.hasOwnProperty.call(${t}, 'polluD') ? '' : '${t}.polluD retiré'`).join(', ')}].filter(Boolean)`)
  window.eval(`${TEMOINS.map((t) => `delete ${t}.polluK; delete ${t}.polluD`).join(';')}; Array.prototype.length = 0`)
  const donnees = c.lire()
  c.remettre()
  return JSON.stringify({ pollue: [...pollue], erreur, donnees })
}

describe('état local $ : une écriture profonde refuse __proto__, constructor et prototype, clé calculée comprise', function () {
  this.timeout(180000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('profond-formes', false)
    codes.prod = await construire('profond-formes-prod', true)
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const mode of ['dev', 'prod']) {
    it(`${mode === 'dev' ? 'développement' : 'production'} : ${FORMES.length} formes × ${CLES.length} clés, l'état ne garde aucune trace, la jumelle celle de JavaScript`, async () => {
      const m = await monter(codes[mode], mode === 'prod')
      const ecarts: string[] = []
      const traces: Record<string, any> = {}
      const avant  = m.etat()
      const intact = tracer(m.window, m.comp, '', null)
      for (const forme of FORMES) {
        for (const [nom, cle] of CLES) {
          m.avis.length = 0
          const etat = tracer(m.window, m.comp, forme, cle())
          const seg  = nom.includes('constructor') ? 'constructor' : nom.includes('\'prototype\'') ? 'prototype' : '__proto__'
          if (!m.prod && !(m.avis.length === 1 && m.avis[0].includes(`segment « ${seg} »`))) ecarts.push(`${forme}(${nom}) : avertissements ${JSON.stringify(m.avis)}`)
          if (etat !== intact) ecarts.push(`${forme}(${nom}) : état ${etat}`)
          traces[`${forme}(${nom})`] = JSON.parse(tracer(m.window, m.jum, forme, cle()))
        }
      }
      assert.deepEqual(ecarts, [])
      // la jumelle fait ce que fait JavaScript : la garde porte
      assert.deepEqual(traces['cEgal(\'__proto__\')'].pollue, ['Object.prototype.polluK'])
      assert.deepEqual(traces['cEgal(\'constructor\')'].pollue, ['Object.polluK'])
      assert.equal(traces['cEgal(\'prototype\')'].erreur, 'TypeError')
      assert.deepEqual(traces['cEfface(\'__proto__\')'].pollue, ['Object.prototype.polluD retiré'])
      assert.deepEqual(traces['cPousse(\'__proto__\')'].pollue, ['Array.prototype[0]'])
      await new Promise((r) => setTimeout(r, 30))
      assert.equal(m.etat(), avant, 'données remises : l\'écran revient à son état')
    })
  }
})
