// magasin `$$` : une variable qui tient un objet du magasin (variable d'une boucle sur le magasin) écrit par l'aide gardée,
// mais une AUTRE variable du même nom — boucle sur une liste hors du magasin, autre fonction, paramètre d'un rappel —
// écrit comme JavaScript : le prototype d'une classe reçoit sa méthode, une clé `constructor` d'un objet ordinaire
// s'écrit, un accesseur est appelé même pour une valeur égale, aucune clé du magasin n'est prévenue. Une autre variable
// du nom d'une variable DÉCLARÉE d'une lecture du magasin (`lu := $$prefs.a`) écrit de même, mais refuse d'écrire dans un
// prototype du langage (`Object.prototype`, où mène une clé `'__proto__'` venue de données) ou dans l'une de ses
// fonctions. La variable de la boucle sur le magasin refuse toujours le prototype. Civet, CoffeeScript et JavaScript,
// développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { applyPathTracking } from '../src/generator/path-tracker.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $$nliste = [{ id: 1, fait: false }]
  $$nprefs = { a: { x: 1 } }
  @cocher = ->
    for t of $$nliste
      t.fait = true
    return
  @protoBoucle = (s, k) ->
    for t of $$nliste
      t[s][k] = 1
    return
  @classe = ->
    Foo := class
    for t of [Foo]
      t.prototype.salut = 'ok'
    String((new Foo()).salut)
  @meme = ->
    o := { v: 1, n: 0 }
    Object.defineProperty(o, 'w', { get: (-> @v), set: ((x) -> @n++), enumerable: true })
    for t of [o]
      t.w = t.w
    String(o.n)
  @nomReserve = ->
    for t of [{ id: 1 }]
      t.constructor = 'fiche'
      µ.__civetReserve = t.constructor
    String(µ.__civetReserve)
  @local = ->
    autres := [{ x: 0 }]
    autres.forEach((t) -> t.x = 1)
    autres[0].x
  @lire = ->
    lu := $$nprefs.a
    lu.x = 2
    return
  @luPollue = (lu, s, k) ->
    lu[s][k] = 1
    return
  @luClasse = (lu) ->
    lu.prototype.salut = 'lu'
    String((new lu()).salut)
  @luMeme = (lu) ->
    lu.w = lu.w
    return
</script>

<p class="liste">{JSON.stringify($$nliste)}</p>
`

const COFFEE = `<script lang="coffee">
$$fnliste = [{ id: 1, fait: false }]
$$fnprefs = { a: { x: 1 } }
@cocher = ->
  for t in $$fnliste
    t.fait = true
  return
@protoBoucle = (s, k) ->
  for t in $$fnliste
    t[s][k] = 1
  return
@classe = ->
  class Foo
  for t in [Foo]
    t.prototype.salut = 'ok'
  String((new Foo()).salut)
@meme = ->
  o = { v: 1, n: 0 }
  Object.defineProperty(o, 'w', { get: (-> @v), set: ((x) -> @n++), enumerable: true })
  for t in [o]
    t.w = t.w
  String(o.n)
@nomReserve = ->
  for t in [{ id: 1 }]
    t.constructor = 'fiche'
    µ.__coffeeReserve = t.constructor
  String(µ.__coffeeReserve)
@local = ->
  autres = [{ x: 0 }]
  autres.forEach (t) -> t.x = 1
  autres[0].x
@lire = ->
  lu = $$fnprefs.a
  lu.x = 2
  return
@luPollue = (lu, s, k) ->
  lu[s][k] = 1
  return
@luClasse = (lu) ->
  lu.prototype.salut = 'lu'
  String((new lu()).salut)
@luMeme = (lu) ->
  lu.w = lu.w
  return
</script>

<p class="liste">{JSON.stringify($$fnliste)}</p>
`

const JS = `<script lang="js">
$$jnliste = [{ id: 1, fait: false }]
$$jnprefs = { a: { x: 1 } }
@cocher = function() { for (const t of $$jnliste) t.fait = true }
@protoBoucle = function(s, k) { for (const t of $$jnliste) t[s][k] = 1 }
@classe = function() { class Foo {}; for (const t of [Foo]) t.prototype.salut = 'ok'; return String((new Foo()).salut) }
@meme = function() { const o = { v: 1, n: 0 }; Object.defineProperty(o, 'w', { get() { return this.v }, set(x) { this.n++ }, enumerable: true }); for (const t of [o]) t.w = t.w; return String(o.n) }
@nomReserve = function() { let r; for (const t of [{ id: 1 }]) { t.constructor = 'fiche'; r = t.constructor }; return String(r) }
@local = function() { const autres = [{ x: 0 }]; autres.forEach((t) => { t.x = 1 }); return autres[0].x }
@lire = function() { const lu = $$jnprefs.a; lu.x = 2 }
@luPollue = function(lu, s, k) { lu[s][k] = 1 }
@luClasse = function(lu) { lu.prototype.salut = 'lu'; return String((new lu()).salut) }
@luMeme = function(lu) { lu.w = lu.w }
</script>

<p class="liste">{JSON.stringify($$jnliste)}</p>
`

// langue, balise, clé de la liste, clé des réglages
const LANGUES: [string, string, string, string][] = [
  ['Civet', 'mjs-meme-nom-civet', 'nliste', 'nprefs'],
  ['CoffeeScript', 'mjs-meme-nom-coffee', 'fnliste', 'fnprefs'],
  ['JS', 'mjs-meme-nom-js', 'jnliste', 'jnprefs'],
]

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'meme-nom-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'meme-nom-coffee.mjs'), COFFEE)
  writeFileSync(join(srcDir, 'meme-nom-js.mjs'), JS)
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

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function monter(code: string, prod: boolean) {
  const window: any = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  window.eval(prod ? code : `${code}\nglobalThis.µ = µ;`)
  // avertissements : développement seulement, la production n'en garde rien
  if (!prod) window.µ.warn = (m: string) => avis.push(String(m))
  window.document.body.innerHTML = LANGUES.map(([, b]) => `<${b}></${b}>`).join('')
  const q   = (b: string) => window.document.querySelector(b)
  const vue = (b: string) => q(b)._shadow?.querySelector('.liste')?.textContent
  const fin = Date.now() + 3000
  while (!LANGUES.every(([, b]) => vue(b) !== undefined) && Date.now() < fin) await pause(10)
  await pause(60)
  return { window, q, vue, avis }
}

// clés du magasin prévenues pendant `faire` (espion posé sur l'aide qui prévient une clé) ; la production ne montre pas
// `µ` à la page : aucune clé relevée, la valeur seule
function prevenues(window: any, faire: () => any): { cles: string[], valeur: any } {
  const cles: string[] = []
  if (!window.µ) return { cles, valeur: faire() }
  const avant = window.µ._mjs_storeNotifyKey
  window.µ._mjs_storeNotifyKey = function (k: string) {
    cles.push(k)
    return avant.call(this, k)
  }
  try {
    return { cles, valeur: faire() }
  }
  finally {
    window.µ._mjs_storeNotifyKey = avant
  }
}

describe('magasin $$ : une autre variable du même nom écrit comme JavaScript', function () {
  this.timeout(240000)
  const builds: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    builds.dev  = await construire('meme-nom', false)
    builds.prod = await construire('meme-nom-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    const prod = mode === 'prod'

    it(`${mode} : prototype d'une classe, clé constructor, accesseur, rappel sur une liste hors du magasin — écrits comme en JavaScript, aucune clé prévenue`, async () => {
      const { window, q, avis } = await monter(builds[mode], prod)
      try {
        const releves: string[] = []
        for (const [langue, balise] of LANGUES) {
          const c = q(balise)
          const n = avis.length
          const r: string[] = []
          for (const m of ['classe', 'meme', 'nomReserve', 'local']) {
            const { cles, valeur } = prevenues(window, () => c[m]())
            r.push(`${m}=${JSON.stringify(valeur)} clés=${JSON.stringify(cles)}`)
          }
          r.push(`avis=${avis.length - n}`)
          releves.push(`${langue} : ${r.join(' · ')}`)
        }
        assert.deepEqual(releves, LANGUES.map(([langue]) => `${langue} : classe="ok" clés=[] · meme="1" clés=[] · nomReserve="fiche" clés=[] · local=1 clés=[] · avis=0`))
      }
      finally {
        window.close()
      }
    })

    it(`${mode} : autre variable du nom d'une variable déclarée d'une lecture du magasin — classe et accesseur écrits, prototype du langage refusé, aucune clé prévenue`, async () => {
      const { window, q, avis } = await monter(builds[mode], prod)
      const pollue = (p: string) => window.eval(`Object.prototype.hasOwnProperty(${JSON.stringify(p)})`)
      try {
        const releves: string[] = []
        for (const [langue, balise] of LANGUES) {
          const c = q(balise)
          const n = avis.length
          const Classe = window.eval('(class {})')
          const o = window.eval('({ v: 1, n: 0, get w() { return this.v }, set w(x) { this.n++ } })')
          const classe = prevenues(window, () => c.luClasse(Classe))
          const meme   = prevenues(window, () => c.luMeme(o))
          const k      = `pollu_meme_nom_${langue}`
          // objets faits dans la page : son `Object.prototype` est celui que la liste du langage connaît
          const proto  = prevenues(window, () => c.luPollue(window.eval('({})'), '__proto__', k))
          const fonction = prevenues(window, () => c.luPollue(window.eval('({})'), 'constructor', 'keys2'))
          // un objet d'un autre domaine (ici celui des tests, comme une iframe ou le rendu serveur) : son prototype aussi
          const ailleurs = prevenues(window, () => c.luPollue({}, '__proto__', `${k}_ailleurs`))
          const hote     = Object.prototype.hasOwnProperty(`${k}_ailleurs`)
          delete (Object.prototype as any)[`${k}_ailleurs`]
          releves.push(`${langue} : classe=${JSON.stringify(classe.valeur)} ${JSON.stringify(classe.cles)} · accesseur=${o.n} ${JSON.stringify(meme.cles)} · Object.prototype=${pollue(k)} ${JSON.stringify(proto.cles)} · Object=${window.Object.hasOwnProperty('keys2')} ${JSON.stringify(fonction.cles)} · autre domaine=${hote} ${JSON.stringify(ailleurs.cles)} · avis=${avis.length - n}`)
          window.eval(`delete Object.prototype[${JSON.stringify(k)}]; delete Object.keys2`)
        }
        assert.deepEqual(releves, LANGUES.map(([langue]) => `${langue} : classe="lu" [] · accesseur=1 [] · Object.prototype=false [] · Object=false [] · autre domaine=false [] · avis=${prod ? 0 : 3}`))
      }
      finally {
        window.close()
      }
    })

    it(`${mode} : la variable de la boucle sur le magasin refuse toujours le prototype, et une écriture permise prévient la clé`, async () => {
      const { window, q, vue, avis } = await monter(builds[mode], prod)
      const pollue = (p: string) => window.eval(`Object.prototype.hasOwnProperty(${JSON.stringify(p)})`)
      try {
        const releves: string[] = []
        for (const [langue, balise] of LANGUES) {
          const c = q(balise)
          const n = avis.length
          const k = `pollu_boucle_${langue}`
          c.protoBoucle('__proto__', k)
          const cocher = prevenues(window, () => c.cocher())
          const lire   = prevenues(window, () => c.lire())
          releves.push(`${langue} : Object.prototype=${pollue(k)} avis=${avis.length - n} · cocher ${JSON.stringify(cocher.cles)} · lire ${JSON.stringify(lire.cles)}`)
          window.eval(`delete Object.prototype[${JSON.stringify(k)}]`)
        }
        await pause(60)
        const cle = (k: string) => JSON.stringify(prod ? [] : [k])
        assert.deepEqual(releves, LANGUES.map(([langue, , liste, prefs]) => `${langue} : Object.prototype=false avis=${prod ? 0 : 1} · cocher ${cle(liste)} · lire ${cle(prefs)}`))
        for (const [, balise] of LANGUES) assert.equal(vue(balise), '[{"id":1,"fait":true}]')
      }
      finally {
        window.close()
      }
    })
  }

  it('compilation : la variable d\'une boucle, d\'un motif ou d\'un rappel est suivie dans son bloc ; une autre du même nom reste telle qu\'écrite', () => {
    const js  = 'for (const t of µ.store.l) t.x = 1; for (const t of [o]) t.y = 2; [o].forEach((t) => { t.z = 3 }); function f(t) { t.w = 4 }; const { a } = µ.store.p; function g(a) { a.v = 5 }'
    const out = applyPathTracking(js)
    assert.match(out, /µ\._mjs_storeSetOn\("l", t, "x", 1\)/)
    assert.match(out, /for \(const t of \[o\]\) t\.y = 2/)
    assert.match(out, /\(t\) => \{ t\.z = 3 \}/)
    assert.match(out, /function f\(t\) \{ t\.w = 4 \}/)
    assert.match(out, /function g\(a\) \{ a\.v = 5 \}/)
  })

  it('compilation : une autre variable du nom d\'une variable déclarée d\'une lecture du magasin passe par l\'aide douce, sans clé', () => {
    const js  = 'const lu = µ.store.p.a; lu.x = 1; function f(lu, k) { lu.y = 2; lu[k] += 1; lu.push(3); delete lu.z }'
    const out = applyPathTracking(js)
    assert.match(out, /µ\._mjs_storeSetOn\("p", lu, "x", 1\)/)
    assert.match(out, /µ\._mjs_softSetOn\(lu, "y", 2\)/)
    assert.match(out, /µ\._mjs_softSetOn\(lu, k, lu\[k\] \+ \(1\)\)/)
    assert.match(out, /µ\._mjs_softCallOn\(lu, 'push', \[3\]\)/)
    assert.match(out, /µ\._mjs_softDeleteOn\(lu, "z"\)/)
  })
})
