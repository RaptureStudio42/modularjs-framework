// magasin `$$` — une lecture rend ce que JavaScript rend, une écriture va où JavaScript l'envoie : `lu := $$o[k]`,
// `v := $$rows[i].v` et la variable de travail de CoffeeScript (`$$rows[i]?.v`) se compilent en lecture nue, sans
// aide ni garde ; `k` valant `constructor` rend `Object`, `__proto__` rend `Object.prototype`, `prototype` rend
// `undefined`, sans avertissement ; l'écriture qui suit (par la variable, par le chemin d'un prototype rangé dans le
// magasin, `delete`, méthode) refuse ce prototype ou cette fonction : rien n'est écrit, un avertissement nomme le
// segment qui y mène ; une méthode absente lève la TypeError de JavaScript (« … is not a function »), en
// développement comme en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $$rows = [{ id: 1, v: 5 }]
  $$o = { a: { b: 0 }, p: null }
  $$l = [{ n: 1, a: {} }]
  $$t = [[]]
  @lit = (k) ->
    lu := $$o[k]
    lu
  @litVal = (i) ->
    v := $$rows[i].v
    v
  @range = (k) -> $$o.p = $$o[k]
  @ecritRange = (k2) -> $$o.p[k2] = 'pollue'
  @effaceRange = (k2) -> delete $$o.p[k2]
  @ecritAlias = (k, k2) ->
    pris := $$o[k]
    pris[k2] = 'pollue'
  @effaceAlias = (k, k2) ->
    pd := $$o[k]
    delete pd[k2]
  @pousseAlias = (k) ->
    pl := $$t[0][k]
    pl.push('pollue')
  @methode = -> $$o.a.push(1)
  @methodeAlias = ->
    s := $$o.a
    s.push(1)
  @methodeFind = -> $$l.find((x) -> x.n == 1).a.push(1)
</script>

<p class="etat">{JSON.stringify($$o)} {JSON.stringify($$t)}</p>
`

const COFFEE = `<script lang="coffee">
$$crows = [{ id: 1, v: 5 }]
@litOpt = (i) ->
  v = $$crows[i]?.v
  v
@lit = (k) ->
  lu = $$crows[0][k]
  lu
</script>

<p class="etat">{JSON.stringify($$crows)}</p>
`

async function construire(prefixe: string, prod: boolean): Promise<{ code: string, sortie: string }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'lecture-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'lecture-coffee.mjs'), COFFEE)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return { code: readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, ''), sortie: '' }
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  const appli = files.filter((f) => f.startsWith('lecture-')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  return { code: files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n'), sortie: appli }
}

async function monter(code: string, prod: boolean) {
  const window: any = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  window.eval(prod ? code : `${code}\nglobalThis.µ = µ;`)
  if (!prod) window.µ.warn = (m: string) => avis.push(String(m))
  window.document.body.innerHTML = '<mjs-lecture-civet></mjs-lecture-civet><mjs-lecture-coffee></mjs-lecture-coffee>'
  const civet  = window.document.querySelector('mjs-lecture-civet')
  const coffee = window.document.querySelector('mjs-lecture-coffee')
  const etat   = () => civet._shadow?.querySelector('.etat')?.textContent
  const fin    = Date.now() + 3000
  while (!(etat() && coffee._shadow?.querySelector('.etat')?.textContent) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  return { window, civet, coffee, avis, etat }
}

// écriture relevée sur les prototypes et constructeurs de la page (`polluK` écrit, `polluD` effacé, `Array.prototype`
// rempli, `Object.assign` remplacé), puis retirée — `Object.assign` rendu à la page
function pollution(window: any, assign: any): string[] {
  const vus = window.eval(`[Object.prototype, Object, Array.prototype, Function.prototype].map((t, i) => Object.prototype.hasOwnProperty.call(t, 'polluK') ? ['Object.prototype', 'Object', 'Array.prototype', 'Function.prototype'][i] + '.polluK' : '').filter(Boolean)`)
  if (window.eval('Array.prototype.length')) vus.push('Array.prototype[0]')
  if (window.eval('Object.prototype.hasOwnProperty(\'polluD\')') === false) vus.push('Object.prototype.polluD retiré')
  if (window.Object.assign !== assign) vus.push(`Object.assign = ${window.Object.assign}`)
  window.Object.assign = assign
  window.eval('delete Object.prototype.polluK; delete Object.polluK; delete Array.prototype.polluK; delete Function.prototype.polluK; delete Object.prototype.polluD; Array.prototype.length = 0')
  return [...vus]
}

describe('magasin $$ : une lecture rend ce que JavaScript rend, une écriture refuse un prototype ou une fonction', function () {
  this.timeout(180000)
  const builds: Record<string, { code: string, sortie: string }> = {}

  before(async function () {
    this.timeout(240000)
    builds.dev  = await construire('lecture-js', false)
    builds.prod = await construire('lecture-js-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('compilé : une déclaration qui lit le magasin par une clé calculée reste une lecture nue, sans aide', () => {
    const s = builds.dev.sortie
    assert.match(s, /const lu = µ\.store\.o\[k\]/)
    assert.match(s, /const v = µ\.store\.rows\[i\]\.v/)
    assert.match(s, /lu = µ\.store\.crows\[0\]\[k\]/)
    assert.match(s, /\(ref = µ\.store\.crows\[i\]\) != null \? ref\.v : void 0/)
    assert.doesNotMatch(s, /_mjs_storeAt\(µ\.store\.(o|rows|crows)\b/, 'aucune navigation gardée pour une lecture')
  })

  for (const mode of ['dev', 'prod']) {
    it(`${mode === 'dev' ? 'développement' : 'production'} : la lecture rend la valeur de JavaScript, sans avertissement`, async () => {
      const { window, civet, coffee, avis } = await monter(builds[mode].code, mode === 'prod')
      try {
        assert.equal(civet.lit('constructor'), window.Object)
        assert.equal(civet.lit('__proto__'), window.Object.prototype)
        assert.equal(civet.lit(['__proto__']), window.Object.prototype)
        assert.equal(civet.lit('prototype'), undefined)
        assert.equal(civet.lit('a').b, 0)
        assert.equal(civet.litVal(0), 5)
        assert.equal(coffee.lit('constructor'), window.Object)
        assert.equal(coffee.lit('__proto__'), window.Object.prototype)
        assert.equal(coffee.litOpt(0), 5)
        assert.equal(coffee.litOpt(3), undefined)
        assert.deepEqual(avis, [], 'une lecture n\'avertit de rien')
      }
      finally {
        window.close()
      }
    })

    it(`${mode === 'dev' ? 'développement' : 'production'} : l'écriture dans un prototype ou une fonction est refusée, un avertissement nomme le segment qui y mène`, async () => {
      const { window, civet, avis, etat } = await monter(builds[mode].code, mode === 'prod')
      const assign = window.Object.assign
      try {
        const ecarts: string[] = []
        // rien n'est écrit ni effacé ; `seg` : le segment que nomme l'avertissement (développement)
        const jouer = (nom: string, f: () => any, seg: string) => {
          avis.length = 0
          window.eval('Object.defineProperty(Object.prototype, \'polluD\', { value: 1, configurable: true, writable: true })')
          try {
            f()
          }
          catch (e: any) {
            ecarts.push(`${nom} : ${e.name}: ${e.message}`)
          }
          const p = pollution(window, assign)
          if (p.length) ecarts.push(`${nom} : ${p.join(' ; ')} au lieu de rien`)
          if (mode === 'dev' && !(avis.length === 1 && avis[0].includes(`segment « ${seg} »`))) ecarts.push(`${nom} : avertissement ${avis.join(' | ') || 'absent'}`)
        }
        civet.range('__proto__')
        jouer('chemin d\'un prototype rangé', () => civet.ecritRange('polluK'), '__proto__')
        jouer('delete par le chemin d\'un prototype rangé', () => civet.effaceRange('polluD'), '__proto__')
        jouer('delete par une variable', () => civet.effaceAlias('__proto__', 'polluD'), '__proto__')
        civet.range('a')
        jouer('variable qui tient Object.prototype', () => civet.ecritAlias('__proto__', 'polluK'), '__proto__')
        jouer('variable qui tient Object.prototype, clé tableau', () => civet.ecritAlias(['__proto__'], 'polluK'), '__proto__')
        jouer('variable qui tient Object', () => civet.ecritAlias('constructor', 'polluK'), 'constructor')
        jouer('variable qui tient Object, méthode remplacée', () => civet.ecritAlias('constructor', 'assign'), 'constructor')
        jouer('méthode par une variable qui tient Array.prototype', () => civet.pousseAlias('__proto__'), '__proto__')
        assert.deepEqual(ecarts, [])
        await new Promise((r) => setTimeout(r, 40))
        assert.equal(etat(), '{"a":{"b":0},"p":{"b":0}} [[]]', 'rien d\'autre n\'est écrit')
      }
      finally {
        window.Object.assign = assign
        window.close()
      }
    })

    it(`${mode === 'dev' ? 'développement' : 'production'} : une méthode absente lève la TypeError de JavaScript`, async () => {
      const { window, civet } = await monter(builds[mode].code, mode === 'prod')
      try {
        for (const m of ['methode', 'methodeAlias', 'methodeFind']) assert.throws(() => civet[m](), (e: any) => e.name === 'TypeError' && /^push is not a function$/.test(e.message), m)
      }
      finally {
        window.close()
      }
    })
  }
})
