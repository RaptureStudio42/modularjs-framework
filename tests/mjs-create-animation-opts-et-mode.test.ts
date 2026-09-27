// Régression — animations/create.ts (µanim.create), deux défauts distincts du mode asymétrique
// (style 3 documenté en tête de fichier : `{ intro: (node, opts) -> …, outro: (node, opts) -> … }`) :
//
// 1. `mergedOpts = Object.assign({}, opts, { duration: cfg.duration, easing: cfg.easing })` copie
//    TOUJOURS les clés `duration`/`easing` de `cfg`, même quand elles valent `undefined` (un
//    config asym pur, sans duration/easing au niveau cfg, comme dans l'exemple documenté) —
//    Object.assign ne saute pas les valeurs `undefined`, il les écrit. Les `duration`/`easing`
//    passés par l'APPELANT (`@transition.nom={duration: 777, …}`) étaient donc écrasés par
//    `undefined` dès que le config asym ne les définissait pas lui-même.
//
// 2. Le mode détecté (`asym` vs `managed`) était mémoïsé sur `setup`, PARTAGÉ par tous les nœuds
//    d'une réutilisation manuelle bas niveau de la PAIRE `{intro, outro}` rendue par
//    `µanim.create(...)`  (inatteignable par un composant compilé : `{for}`+`@transition` appelle
//    la fabrique une fois PAR NŒUD) : un config-factory dont la forme dépend du nœud verrouillait
//    le mode du 1er nœud "managed" rencontré, et le `cfg.intro`/`cfg.outro` d'un 2e nœud asym
//    n'était alors plus jamais appelé — routé à tort en "managed".
//
// Même mécanisme de chargement que anim-create-collision-warning.test.ts (cf. son en-tête).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CREATE_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'animations', 'create.ts'), 'utf-8')

function loadCreateFactory(µ: any): (name: string, config: any) => any {
  const expr = CREATE_SRC.trim().replace(/;\s*$/, '')
  return new Function('µ', `return (${expr})`)(µ)
}

describe('µanim.create — mode asymétrique : duration/easing de l\'appelant préservés', function () {
  it("config asym SANS duration/easing (patron documenté) : opts.duration/easing de l'appelant atteignent intro(node, opts) intacts", async () => {
    const µ: any = { anim: {} }
    const create = loadCreateFactory(µ)
    const recu: any[] = []
    create('probeAsym', {
      intro: (_node: any, opts: any) => { recu.push(opts); return Promise.resolve('intro-ok') },
      outro: (_node: any, opts: any) => { recu.push(opts); return Promise.resolve('outro-ok') },
    })
    const instance = µ.anim.probeAsym({ duration: 777, easing: 'mon-easing-perso' })
    await instance.intro({ fakeNode: true })
    assert.equal(recu[0].duration, 777, 'AVANT le fix : écrasé par undefined (cfg.duration absent du config asym)')
    assert.equal(recu[0].easing, 'mon-easing-perso')
  })

  it('config asym qui DÉFINIT duration/easing : ceux-là gagnent sur ceux de l\'appelant (comportement voulu, inchangé)', async () => {
    const µ: any = { anim: {} }
    const create = loadCreateFactory(µ)
    const recu: any[] = []
    create('probeAsymOverride', {
      duration: 900,
      easing: 'depuis-cfg',
      intro: (_node: any, opts: any) => { recu.push(opts); return Promise.resolve() },
    })
    const instance = µ.anim.probeAsymOverride({ duration: 100, easing: 'depuis-appelant' })
    await instance.intro({ fakeNode: true })
    assert.equal(recu[0].duration, 900)
    assert.equal(recu[0].easing, 'depuis-cfg')
  })

  it("d'autres clés de opts (hors duration/easing) traversent intactes", async () => {
    const µ: any = { anim: {} }
    const create = loadCreateFactory(µ)
    const recu: any[] = []
    create('probeAutresClefs', { intro: (_node: any, opts: any) => { recu.push(opts); return Promise.resolve() } })
    const instance = µ.anim.probeAutresClefs({ y: 200, customClass: 'x' })
    await instance.intro({ fakeNode: true })
    assert.equal(recu[0].y, 200)
    assert.equal(recu[0].customClass, 'x')
  })

  it('mode managed (css/tick) : non affecté, opts passé intact à la config-factory (témoin)', async () => {
    const µ: any = { anim: {}, _mjs_runTransition: (node: any, setup: any, dir: any) => { const cfg = setup(node); return Promise.resolve({ dir, cfg }) } }
    const create = loadCreateFactory(µ)
    create('probeManaged', (_node: any, opts: any) => ({ duration: 400, css: (t: number) => ({ opacity: String(t) }), __optsRecus: opts }))
    const instance = µ.anim.probeManaged({ duration: 777, easing: 'x' })
    const r: any = await instance.intro({ fakeNode: true })
    assert.equal(r.cfg.__optsRecus.duration, 777)
  })
})

describe('µanim.create — mode (asym/managed) mémoïsé PAR NŒUD, pas sur la fabrique partagée', function () {
  it('nœud managed PUIS nœud asym, MÊME instance réutilisée : le 2e nœud est bien routé en asym (AVANT le fix : verrouillé en managed)', async () => {
    const appels: any[] = []
    const µ: any = { anim: {}, _mjs_runTransition: (node: any, _setup: any, dir: any) => { appels.push(['managed-route', node.id, dir]); return Promise.resolve('managed-resolved') } }
    const create = loadCreateFactory(µ)
    // config-FACTORY dont la forme dépend du nœud (ex. paramétrée par une donnée du composant)
    create('probeOrdre', (node: any) => {
      if (node.shape === 'managed') return { duration: 300, css: (t: number) => ({ opacity: String(t) }) }
      return { intro: (n: any) => { appels.push(['asym-intro', n.id]); return Promise.resolve('ok') } }
    })
    const instance = µ.anim.probeOrdre({}) // UNE SEULE instance, réutilisée manuellement pour 2 nœuds
    await instance.intro({ id: 'M', shape: 'managed' })
    await instance.intro({ id: 'A', shape: 'asym' })

    const asymAppele = appels.some((e) => e[0] === 'asym-intro' && e[1] === 'A')
    assert.ok(asymAppele, 'le cfg.intro du nœud A (asym) doit être appelé, pas routé en managed à cause du nœud M')
  })

  it('sens inverse (asym PUIS managed) : déjà correct avant le fix, non-régression', async () => {
    const appels: any[] = []
    const µ: any = { anim: {}, _mjs_runTransition: (node: any) => { appels.push(['managed-route', node.id]); return Promise.resolve('ok') } }
    const create = loadCreateFactory(µ)
    create('probeOrdreInverse', (node: any) => {
      if (node.shape === 'managed') return { duration: 300, css: (t: number) => ({ opacity: String(t) }) }
      return { intro: (n: any) => { appels.push(['asym-intro', n.id]); return Promise.resolve('ok') } }
    })
    const instance = µ.anim.probeOrdreInverse({})
    await instance.intro({ id: 'A2', shape: 'asym' })
    await instance.intro({ id: 'M2', shape: 'managed' })
    assert.ok(appels.some((e) => e[0] === 'managed-route' && e[1] === 'M2'))
    assert.ok(appels.some((e) => e[0] === 'asym-intro' && e[1] === 'A2'))
  })

  it('le MÊME nœud appelé deux fois : le 2e intro() ne rappelle PAS setup() (perf — le mode par nœud est bien mémoïsé, pas juste désactivé)', async () => {
    let appelsSetup = 0
    const µ: any = { anim: {}, _mjs_runTransition: () => Promise.resolve('ok') }
    const create = loadCreateFactory(µ)
    create('probePerf', (_node: any) => { appelsSetup++; return { duration: 300, css: (t: number) => ({ opacity: String(t) }) } })
    const instance = µ.anim.probePerf({})
    const node = { id: 'N1' } // MÊME objet réutilisé pour les deux appels (WeakMap : clé par IDENTITÉ)
    await instance.intro(node)
    assert.equal(appelsSetup, 1, "1er appel : setup() de détection")
    await instance.intro(node) // même nœud, 2e intro
    assert.equal(appelsSetup, 1, "2e appel sur le MÊME nœud déjà 'managed' : setup() ne doit PAS être rappelé ici (_mjs_runTransition s'en charge)")
  })

  it('DEUX nœuds managed DISTINCTS : chacun voit son mode mémoïsé séparément, aucune interférence', async () => {
    const routes: string[] = []
    const µ: any = { anim: {}, _mjs_runTransition: (node: any) => { routes.push(node.id); return Promise.resolve('ok') } }
    const create = loadCreateFactory(µ)
    create('probeDeuxNoeuds', (_node: any) => ({ duration: 300, css: (t: number) => ({ opacity: String(t) }) }))
    const instance = µ.anim.probeDeuxNoeuds({})
    const n1 = { id: 'N1' }
    const n2 = { id: 'N2' }
    await instance.intro(n1)
    await instance.intro(n2)
    await instance.intro(n1)
    assert.deepEqual(routes, ['N1', 'N2', 'N1'])
  })
})
