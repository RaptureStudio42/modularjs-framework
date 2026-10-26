// magasin `$$` : une variable qui prend un objet du magasin par une affectation logique (`||=`, `&&=`, `??=`, en Civet
// `?=`), par une boucle (Civet `for t of $$liste` et `for t in $$liste`, `for (const c in …)`, CoffeeScript `for t from`),
// par une déstructuration (`{ a } := $$prefs`, `[t] := $$liste`, `({ a } = …)`, motif d'une boucle) ou par la valeur par
// défaut d'un paramètre (`(t = $$prefs.a) ->`) écrit par l'aide gardée : une clé `'__proto__'` venue de données ne
// pollue ni `Object.prototype` ni `String.prototype` (la clé d'un `for…in` est une chaîne), et l'avertissement nomme
// le segment en développement. Une écriture permise par ces variables redessine la vue. Civet, CoffeeScript et
// JavaScript, développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $$prefs = { a: { x: 1 } }
  $$liste = [{ id: 1, fait: false, vu: false, n: 0 }]
  $$fiches = [{ meta: { n: 1 } }]
  @ouEgal = (s, k) ->
    x .= null
    x ||= $$prefs[s]
    x[k] = 1
    return
  @nulEgal = (s, k) ->
    x .= null
    x ?= $$prefs[s]
    x[k] = 1
    return
  @etEgal = (s, k) ->
    x .= 1
    x &&= $$prefs[s]
    x[k] = 1
    return
  @boucleOf = (s, k) ->
    for t of $$liste
      t[s][k] = 1
    return
  @boucleOfRang = (s, k) ->
    for t, i of $$liste
      t[s][k] = 1
    return
  @boucleIn = (s, k) ->
    for t in $$liste
      t[s][k] = 1
    return
  @boucleInRang = (s, k) ->
    for t, i in $$liste
      t[s][k] = 1
    return
  @boucleOfMotif = (s, k) ->
    for { meta } of $$fiches
      meta[s][k] = 1
    return
  @motif = (s, k) ->
    { a } := $$prefs
    a[s][k] = 1
    return
  @motifListe = (s, k) ->
    [t] := $$liste
    t[s][k] = 1
    return
  @motifAffecte = (s, k) ->
    a .= null
    { a } = $$prefs
    a[s][k] = 1
    return
  @defaut = (s, k) ->
    ecrire := (t = $$prefs.a) ->
      t[s][k] = 1
      return
    ecrire()
    return
  @attente = (s, k) ->
    t := await $$prefs.a
    t[s][k] = 1
    return
  @cocher = ->
    for t of $$liste
      t.fait = true
    return
  @voir = ->
    x .= null
    x ||= $$liste[0]
    x.vu = true
    return
  @compter = ->
    [t] := $$liste
    t.n = 5
    return
</script>

<p class="liste">{JSON.stringify($$liste)}</p>
`

const COFFEE = `<script lang="coffee">
$$fprefs = { a: { x: 1 } }
$$fliste = [{ id: 1, fait: false }]
@ouEgal = (s, k) ->
  x = null
  x or= $$fprefs[s]
  x[k] = 1
  return
@nulEgal = (s, k) ->
  x = null
  x ?= $$fprefs[s]
  x[k] = 1
  return
@boucleIn = (s, k) ->
  for t in $$fliste
    t[s][k] = 1
  return
@boucleOfValeur = (s, k) ->
  for cle, val of $$fprefs
    val[s][k] = 1
  return
@boucleFrom = (s, k) ->
  for t from $$fliste
    t[s][k] = 1
  return
@motif = (s, k) ->
  { a } = $$fprefs
  a[s][k] = 1
  return
@motifListe = (s, k) ->
  [t] = $$fliste
  t[s][k] = 1
  return
@defaut = (s, k) ->
  ecrire = (t = $$fprefs.a) ->
    t[s][k] = 1
    return
  ecrire()
  return
@cocher = ->
  for t from $$fliste
    t.fait = true
  return
</script>

<p class="liste">{JSON.stringify($$fliste)}</p>
`

const JS = `<script lang="js">
$$jprefs = { a: { x: 1 } }
$$jliste = [{ id: 1, fait: false }]
$$jfiches = [{ meta: { n: 1 } }]
@nulEgal = function(s, k) { let y; y ??= $$jprefs[s]; y[k] = 1 }
@ouEgal = function(s, k) { let y = 0; y ||= $$jprefs[s]; y[k] = 1 }
@etEgal = function(s, k) { let y = 1; y &&= $$jprefs[s]; y[k] = 1 }
@boucleOf = function(s, k) { for (const t of $$jliste) t[s][k] = 1 }
@boucleOfNu = function(s, k) { let t; for (t of $$jliste) t[s][k] = 1 }
@boucleIn = function(s, k) { for (const c in $$jprefs) c[s][k] = 1 }
@boucleOfMotif = function(s, k) { for (const { meta } of $$jfiches) meta[s][k] = 1 }
@motif = function(s, k) { const { a } = $$jprefs; a[s][k] = 1 }
@motifAffecte = function(s, k) { let a; ({ a } = $$jprefs); a[s][k] = 1 }
@defaut = function(s, k) { const ecrire = (t = $$jprefs.a) => { t[s][k] = 1 }; ecrire() }
@attente = async function(s, k) { const t = await $$jprefs.a; t[s][k] = 1 }
@cocher = function() { for (const t of $$jliste) t.fait = true }
</script>

<p class="liste">{JSON.stringify($$jliste)}</p>
`

// langue, balise, méthodes qui écrivent par une clé venue de données
const FORMES: [string, string, string[]][] = [
  ['Civet', 'mjs-formes-civet', ['ouEgal', 'nulEgal', 'etEgal', 'boucleOf', 'boucleOfRang', 'boucleIn', 'boucleInRang', 'boucleOfMotif', 'motif', 'motifListe', 'motifAffecte', 'defaut', 'attente']],
  ['CoffeeScript', 'mjs-formes-coffee', ['ouEgal', 'nulEgal', 'boucleIn', 'boucleOfValeur', 'boucleFrom', 'motif', 'motifListe', 'defaut']],
  ['JS', 'mjs-formes-js', ['nulEgal', 'ouEgal', 'etEgal', 'boucleOf', 'boucleOfNu', 'boucleIn', 'boucleOfMotif', 'motif', 'motifAffecte', 'defaut', 'attente']],
]

async function construire(prefixe: string, prod: boolean): Promise<{ code: string, emis: string }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'formes-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'formes-coffee.mjs'), COFFEE)
  writeFileSync(join(srcDir, 'formes-js.mjs'), JS)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return { code: readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, ''), emis: '' }
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  const emis  = files.filter((f) => f.startsWith('formes-')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  return { code: files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n'), emis }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function monter(code: string, prod: boolean) {
  const window: any = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  window.eval(prod ? code : `${code}\nglobalThis.µ = µ;`)
  if (!prod) window.µ.warn = (m: string) => avis.push(String(m))
  window.document.body.innerHTML = FORMES.map(([, b]) => `<${b}></${b}>`).join('')
  const q   = (b: string) => window.document.querySelector(b)
  const vue = (b: string) => q(b)._shadow?.querySelector('.liste')?.textContent
  const fin = Date.now() + 3000
  while (!FORMES.every(([, b]) => vue(b) !== undefined) && Date.now() < fin) await pause(10)
  await pause(60)
  return { window, q, vue, avis }
}

describe('magasin $$ : boucle, affectation logique, déstructuration et valeur par défaut refusent le prototype', function () {
  this.timeout(240000)
  const builds: Record<string, { code: string, emis: string }> = {}

  before(async function () {
    this.timeout(240000)
    builds.dev  = await construire('formes-garde', false)
    builds.prod = await construire('formes-garde-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    const prod = mode === 'prod'

    it(`${mode} : aucune forme n'écrit dans Object.prototype ni dans String.prototype`, async () => {
      const { window, q, avis } = await monter(builds[mode].code, prod)
      const pollue  = (p: string, proto: string) => window.eval(`${proto}.prototype.hasOwnProperty(${JSON.stringify(p)})`)
      const releves: string[] = []
      const fautes: string[]  = []
      try {
        for (const [langue, balise, methodes] of FORMES) {
          for (const m of methodes) {
            const k = `pollu_${langue}_${m}`
            const n = avis.length
            let leve = ''
            try {
              await q(balise)[m]('__proto__', k)
            }
            catch (e: any) {
              leve = ` · lève ${String(e?.message).slice(0, 60)}`
            }
            const o = pollue(k, 'Object')
            const s = pollue(k, 'String')
            releves.push(`${langue} ${m} : Object.prototype=${o} String.prototype=${s} avis=${avis.length - n}${leve}`)
            if (o || s || leve) fautes.push(`${langue} ${m}`)
            if (!prod && avis.length === n) fautes.push(`${langue} ${m} (sans avertissement)`)
          }
        }
      }
      finally {
        console.log(`      ${mode}\n        ${releves.join('\n        ')}`)
        window.eval(`for (const p of Object.getOwnPropertyNames(Object.prototype)) if (p.startsWith('pollu_')) delete Object.prototype[p]; for (const p of Object.getOwnPropertyNames(String.prototype)) if (p.startsWith('pollu_')) delete String.prototype[p]`)
        window.close()
      }
      assert.deepEqual(fautes, [])
    })

    it(`${mode} : une écriture permise par la variable d'une boucle, d'un ||= ou d'une déstructuration redessine la vue`, async () => {
      const { window, q, vue } = await monter(builds[mode].code, prod)
      try {
        q('mjs-formes-civet').cocher()
        q('mjs-formes-civet').voir()
        q('mjs-formes-civet').compter()
        q('mjs-formes-coffee').cocher()
        q('mjs-formes-js').cocher()
        await pause(60)
        assert.equal(vue('mjs-formes-civet'), '[{"id":1,"fait":true,"vu":true,"n":5}]')
        assert.equal(vue('mjs-formes-coffee'), '[{"id":1,"fait":true}]')
        assert.equal(vue('mjs-formes-js'), '[{"id":1,"fait":true}]')
      }
      finally {
        window.close()
      }
    })
  }

  it('dev : code émis — aucune écriture par une clé venue de données ne reste nue, chacune passe par l\'aide gardée', () => {
    const emis   = builds.dev.emis
    const nues   = emis.split('\n').filter((l) => /\[k\] = 1/.test(l)).map((l) => l.trim().slice(0, 170))
    const gardes = emis.split('_mjs_storeSetOn(').length - 1
    assert.deepEqual(nues, [])
    assert.ok(gardes >= 30, `${gardes} écritures gardées`)
  })
})
