// Graphe des signaux (src/runtime/mjs_signals.ts) branché sur les écritures, sans rien changer encore aux valeurs dérivées
// ni aux reffets : le module part avec l'appli seulement quand elle a une valeur dérivée précise (dont le calcul note ses
// lectures ; une valeur à l'horloge ne s'en sert pas) ou un reffet ; chaque écriture
// fait avancer la boîte de ce qu'elle écrit, une fois la valeur rangée — état d'un composant (`_set`, mutations
// profondes, enveloppe de l'état, `µrefresh`, `µrefresh($x)`, `µwrite`), magasin global (`$$x`, mutations profondes,
// `µrefresh($$x)`, `µwrite $$x`, suppression, structure), `µ.Store` et `µ.state` ; sans lecteur, aucune boîte n'existe et
// une écriture ne paie qu'une lecture et un test, sans appel. La boîte naît ici d'une lecture notée par un calcul du
// graphe (`µ._mjs_sigRead`), comme le fera le code compilé d'une valeur dérivée.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler } from '../src/bundler/index.js'
import { DERIVED_VALUES, SIG_READS } from '../src/bundler/features.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// composant à valeur dérivée précise, jamais lue (aucune boîte ne naît d'elle) : il emporte le module ; ses gestionnaires
// écrivent comme le code compilé
const HOTE = `<script>
$n = 1
$o = { a: 1 }
$p = null
$l = []
$d = $n * 2
$jamais = [$n].join('')
@setN = (v) -> $n = v
@meme = -> µrefresh($o)
</script>
<p>{$d} {$n} {$o} {$l.length}</p>`

// valeurs dérivées toutes à l'horloge : le graphe ne leur sert pas, le module ne part pas
const HORLOGE = `<script>
$n = 1
$d = $n * 2
@setN = (v) -> $n = v
</script>
<p>{$d}</p>`

// même composant, sans valeur dérivée ni reffet : il n'emporte pas le module
const SANS = `<script>
$n = 1
@setN = (v) -> $n = v
</script>
<p>{$n}</p>`

// même composant, sans valeur dérivée, avec un reffet
const REFFET = `<script>
$n = 1
µeffect -> console.log $n
</script>
<p>{$n}</p>`

async function construire(source: string, prefixe: string, opts: Record<string, any>): Promise<{ outDir: string; fichiers: string[] }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return { outDir, fichiers: readdirSync(outDir).filter((f) => f.endsWith('.js')) }
}

function coeur(outDir: string, fichiers: string[]): string {
  const f = fichiers.find((x) => x.startsWith('mjs_core'))
  assert.ok(f, 'le cœur est écrit')
  return readFileSync(join(outDir, f!), 'utf-8')
}

// la boîte de `k` chez `owner`, créée par une lecture notée pendant le calcul d'une dérivée du graphe
function boite(µ: any, owner: any, k: any): any {
  const d = µ._mjs_sigDerived(null, '$t', () => {
    µ._mjs_sigRead(owner, k)
    return 0
  })
  µ._mjs_sigGet(d)
  assert.ok(owner._mjs_sigBoxes && owner._mjs_sigBoxes[k], 'la lecture notée crée la boîte')
  return owner._mjs_sigBoxes[k]
}

// lectures de `_mjs_sigBoxes` faites sur `owner` pendant `ecrire`, et appels de µ._mjs_sigWrite
function compter(µ: any, owner: any, ecrire: () => void): { lus: number; appels: number } {
  let lus = 0, appels = 0
  const garde = Object.getOwnPropertyDescriptor(owner, '_mjs_sigBoxes')
  const avant = µ._mjs_sigWrite
  Object.defineProperty(owner, '_mjs_sigBoxes', { configurable: true, get: () => { lus++; return null }, set: () => {} })
  µ._mjs_sigWrite = function(...a: any[]) {
    appels++
    return avant.apply(this, a)
  }
  try {
    ecrire()
  }
  finally {
    µ._mjs_sigWrite = avant
    if (garde) Object.defineProperty(owner, '_mjs_sigBoxes', garde)
    else delete owner._mjs_sigBoxes
  }
  return { lus, appels }
}


describe('signaux — le module part avec une valeur dérivée précise ou un reffet, et seulement alors', () => {
  it('sélection : une valeur dérivée précise, un reffet (écrit ou porté par <@head>) l\'emportent ; ni un cœur sans eux, ni des valeurs à l\'horloge seules, ni « core » sans relevé ; faits inconnus : il part', () => {
    const b    = new Bundler({ env: 'prod' })
    const avec = (used?: Set<string>) => b.resolveRuntimeFiles(used).files.includes('mjs_signals.ts')
    assert.equal(avec(new Set([DERIVED_VALUES, SIG_READS])), true, 'valeur dérivée précise')
    assert.equal(avec(new Set([DERIVED_VALUES])), false, 'valeurs dérivées toutes à l\'horloge')
    assert.equal(avec(new Set(['effect'])), true, 'reffet')
    assert.equal(avec(new Set(['head'])), true, '<@head> s\'appuie sur un reffet')
    assert.equal(avec(new Set()), false, 'ni dérivée ni reffet')
    assert.equal(avec(new Set(['for', 'if', 'deep'])), false, 'blocs et mutations profondes seuls')
    assert.equal(avec(undefined), true, 'faits inconnus : il part, comme tout module relevé')
    const core = new Bundler({ env: 'prod', runtime: 'core' })
    assert.equal(core.resolveRuntimeFiles(new Set()).files.includes('mjs_signals.ts'), false, 'cœur nu')
    assert.equal(core.resolveRuntimeFiles(new Set([DERIVED_VALUES, SIG_READS])).files.includes('mjs_signals.ts'), true, 'cœur nu qui a une valeur dérivée précise')
  })

  it('sélection : le module précède tout fichier qui écrit (magasins, µ.state, magasin global, composant)', () => {
    const files = new Bundler({ runtime: 'all', i18n: { default: 'fr' } }).resolveRuntimeFiles().files
    const i     = files.indexOf('mjs_signals.ts')
    assert.ok(i >= 0, 'en \'all\', faits inconnus : il part')
    for (const f of ['mjs_store.ts', 'mjs_state.ts', 'mjs_store_globals.ts', 'mjs_element.ts']) {
      assert.ok(files.indexOf(f) > i, `${f} vient après mjs_signals.ts`)
    }
  })

  it('construction de production : l\'appli à valeur dérivée précise porte le module et ses écritures branchées ; celle à reffet aussi ; l\'appli sans l\'une ni l\'autre, ou aux valeurs dérivées toutes à l\'horloge, n\'en garde aucune trace', async function() {
    this.timeout(60000)
    const a = await construire(HOTE, 'sig-ecr-prod-a', { env: 'prod', minify: false })
    const ca = coeur(a.outDir, a.fichiers)
    assert.ok(ca.includes('µ._mjs_sigWrite = function'), 'le module est dans le cœur')
    assert.ok(/if \(this\._mjs_sigBoxes\) µ\._mjs_sigWrite\(this, k\)/.test(ca), 'l\'écriture d\'un composant avance sa boîte')
    const r = await construire(REFFET, 'sig-ecr-prod-r', { env: 'prod', minify: false })
    assert.ok(coeur(r.outDir, r.fichiers).includes('µ._mjs_sigWrite = function'), 'un reffet emporte le module')
    for (const [texte, nom] of [[SANS, 'sig-ecr-prod-s'], [HORLOGE, 'sig-ecr-prod-h']]) {
      const s  = await construire(texte, nom, { env: 'prod', minify: false })
      const cs = coeur(s.outDir, s.fichiers)
      for (const trace of ['_mjs_sigWrite', '_mjs_sigBoxes', '_mjs_sigRead', '// <signaux>']) {
        assert.ok(!cs.includes(trace), `aucune trace « ${trace} » dans le cœur d'une appli sans valeur dérivée précise ni reffet (${nom})`)
      }
    }
  })
})


describe('signaux — chaque écriture fait avancer la boîte de ce qu\'elle écrit', function() {
  this.timeout(60000)
  let window: any, µ: any, a: any, b: any

  before(async () => {
    // développement, magasin global, µ.Store, µ.state et mutations profondes demandés ; le module vient de la valeur dérivée précise
    const { outDir, fichiers } = await construire(HOTE, 'sig-ecr-dev', { runtime: ['vault', 'store', 'state', 'deep'] })
    const ordre = [...fichiers.filter((f) => f.startsWith('mjs_')), ...fichiers.filter((f) => !f.startsWith('mjs_'))]
    const code  = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-hote id="a"></mjs-hote><mjs-hote id="b"></mjs-hote>'
    a = window.document.getElementById('a')
    b = window.document.getElementById('b')
    const fin = Date.now() + 5000
    while((!a._shadow || !b._shadow) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    µ = window.µ
    assert.equal(typeof µ._mjs_sigWrite, 'function', 'le module est dans le cœur de développement')
  })

  after(async () => {
    await window?.happyDOM?.close()
  })

  it('sans lecteur, aucune boîte : toutes les voies écrivent, aucune boîte ne naît ; chaque écriture ne paie qu\'une lecture et un test, aucun appel', () => {
    const st = new µ.Store({ n: 1, o: { a: 1 } })
    const s  = µ.state({ n: 1, o: { a: 1 } })
    a._set('n', 5)
    a._set('o', { a: 2 })
    µ._mjs_deepSet(a, ['o', 'a'], 3)
    µ._mjs_deepCall(a, ['l'], 'push', [1])
    µ._mjs_deepDelete(a, ['o', 'a'])
    µ._mjs_refresh(a, 'o')
    µ._mjs_rawWrite(a).n = 6
    a.setN(7)
    a.meme()
    µ._storeSet('z', 1)
    µ._mjs_storeRefresh('z')
    µ._mjs_storeRawWrite.z = 2
    µ._mjs_storeDelete('z')
    st.data.n = 2
    st.data.o.a = 2
    delete st.data.n
    s.n = 2
    s.o.a = 2
    delete s.n
    assert.ok(a._mjs_sigBoxes == null, 'composant')
    assert.ok(µ._mjs_storeSig._mjs_sigBoxes == null, 'magasin global')
    assert.ok(st._mjs_sigBoxes == null, 'µ.Store')
    assert.ok(µ._mjs_stateSig.get(µ._mjs_toRaw(s))._mjs_sigBoxes == null, 'µ.state')
    assert.deepEqual(compter(µ, a, () => a._set('n', 8)), { lus: 1, appels: 0 }, '_set (chemin rapide)')
    assert.deepEqual(compter(µ, a, () => a._set('o', { a: 9 })), { lus: 1, appels: 0 }, '_set d\'un objet')
    assert.deepEqual(compter(µ, a, () => µ._mjs_deepSet(a, ['o', 'a'], 10)), { lus: 1, appels: 0 }, 'écriture profonde')
    assert.deepEqual(compter(µ, a, () => { µ._mjs_rawWrite(a).n = 11 }), { lus: 1, appels: 0 }, 'µwrite')
    assert.deepEqual(compter(µ, a, () => a._set('n', 11)), { lus: 0, appels: 0 }, 'même valeur : rien')
    assert.deepEqual(compter(µ, µ._mjs_storeSig, () => µ._storeSet('z', 3)), { lus: 2, appels: 0 }, '$$z : la clé, puis la structure')
    assert.deepEqual(compter(µ, st, () => { st.data.o.a = 3 }), { lus: 1, appels: 0 }, 'µ.Store')
    assert.deepEqual(compter(µ, µ._mjs_stateSig.get(µ._mjs_toRaw(s)), () => { s.o.a = 3 }), { lus: 1, appels: 0 }, 'µ.state')
  })

  it('composant : _set, enveloppe de l\'état, mutations profondes, clés qui tiennent le même objet, µrefresh, µrefresh($x) du composant, µwrite, écriture compilée', () => {
    const bn = boite(µ, b, 'n')
    const bo = boite(µ, b, 'o')
    const bl = boite(µ, b, 'l')
    const bp = boite(µ, b, 'p')
    b._set('n', 2)
    assert.equal(bn.ver, 1, '_set d\'une valeur simple')
    b._set('n', 2)
    assert.equal(bn.ver, 1, 'même valeur : la boîte ne bouge pas')
    b._set('o', { a: 5 })
    assert.equal(bo.ver, 1, '_set d\'un objet')
    b._state.o.a = 6
    assert.equal(bo.ver, 2, 'écriture par l\'enveloppe de l\'état')
    µ._mjs_deepSet(b, ['o', 'a'], 7)
    assert.equal(bo.ver, 3, 'écriture profonde')
    µ._mjs_deepSet(b, ['o', 'a'], 7)
    assert.equal(bo.ver, 3, 'écriture profonde de la même valeur : rien')
    µ._mjs_deepCall(b, ['l'], 'push', [1])
    assert.equal(bl.ver, 1, 'méthode profonde')
    µ._mjs_deepDelete(b, ['o', 'a'])
    assert.equal(bo.ver, 4, 'suppression profonde')
    b._set('p', b._state.o)
    assert.equal(bp.ver, 1, 'une autre clé reçoit le même objet')
    µ._mjs_deepSet(b, ['o', 'b'], 1)
    assert.deepEqual([bo.ver, bp.ver], [5, 2], 'une écriture profonde avance les deux clés qui tiennent l\'objet')
    µ._mjs_refresh(b, 'o')
    assert.deepEqual([bo.ver, bp.ver], [6, 3], 'µrefresh($o)')
    b.meme()
    assert.deepEqual([bo.ver, bp.ver], [7, 4], 'µrefresh($o) écrit dans le composant')
    µ._mjs_rawWrite(b).n = 9
    assert.equal(bn.ver, 2, 'µwrite $n')
    b.setN(3)
    assert.equal(bn.ver, 3, 'écriture compilée d\'un gestionnaire')
    assert.equal(b._state.n, 3, 'la valeur est rangée comme avant')
  })

  it('magasin global : $$x, structure, mutation profonde, µrefresh($$x), µwrite $$x, suppression', () => {
    const o  = µ._mjs_storeSig
    const bs = boite(µ, o, 's')
    const bg = boite(µ, o, 'g')
    const bt = boite(µ, o, '*')
    µ._storeSet('s', 1)
    assert.deepEqual([bs.ver, bt.ver], [1, 1], 'écriture d\'une clé, puis la structure')
    µ._storeSet('s', 1)
    assert.deepEqual([bs.ver, bt.ver], [1, 1], 'même valeur : rien')
    µ._storeSet('g', { a: 1 })
    assert.deepEqual([bg.ver, bt.ver], [1, 2], 'objet rangé')
    µ._mjs_storeSetOn('g', µ._mjs_storeRaw.g, 'a', 2)
    assert.equal(bg.ver, 2, 'mutation profonde')
    µ._mjs_storeRefresh('g')
    assert.equal(bg.ver, 3, 'µrefresh($$g)')
    µ._mjs_storeRawWrite.s = 5
    assert.deepEqual([bs.ver, bt.ver], [2, 3], 'µwrite $$s')
    µ._mjs_storeDelete('s')
    assert.deepEqual([bs.ver, bt.ver], [3, 4], 'suppression')
  })

  it('µ.Store : clé, sous-objet, méthode, suppression et structure', () => {
    const st = new µ.Store({ n: 1, o: { a: 1 }, l: [] })
    const bn = boite(µ, st, 'n')
    const bo = boite(µ, st, 'o')
    const bl = boite(µ, st, 'l')
    const bt = boite(µ, st, µ._mjs_STRUCT)
    st.data.n = 2
    assert.equal(bn.ver, 1, 'clé')
    st.data.n = 2
    assert.equal(bn.ver, 1, 'même valeur : rien')
    st.data.o.a = 2
    assert.equal(bo.ver, 1, 'sous-objet')
    st.data.l.push(1)
    assert.equal(bl.ver, 1, 'méthode')
    delete st.data.n
    assert.deepEqual([bn.ver, bt.ver], [2, 1], 'suppression, puis la structure')
  })

  it('µ.state : clé, sous-objet, suppression et structure ; le propriétaire se retrouve depuis l\'objet brut', () => {
    const s  = µ.state({ n: 1, o: { a: 1 } })
    const ow = µ._mjs_stateSig.get(µ._mjs_toRaw(s))
    const bn = boite(µ, ow, 'n')
    const bo = boite(µ, ow, 'o')
    const bt = boite(µ, ow, µ._mjs_STRUCT)
    s.n = 2
    assert.deepEqual([bn.ver, bt.ver], [1, 1], 'clé, puis la structure')
    s.n = 2
    assert.deepEqual([bn.ver, bt.ver], [1, 1], 'même valeur : rien')
    s.o.a = 2
    assert.equal(bo.ver, 1, 'sous-objet')
    delete s.n
    assert.deepEqual([bn.ver, bt.ver], [2, 2], 'suppression, puis la structure')
  })
})
