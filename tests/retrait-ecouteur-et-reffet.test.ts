// `µon` / `µ.on` et `µeffect` / `µ.effect` rendent une fonction qui les retire, sans attendre la destruction du
// composant. Garanti : l'écouteur retiré ne joue plus (son inscription de retrait à la destruction part avec lui) ; le
// reffet retiré ne tourne plus et son nettoyage joue une fois ; un deuxième appel ne fait rien ; retirer un reffet
// pendant que les reffets tournent (depuis un autre reffet, depuis lui-même, depuis son nettoyage) ne saute ni ne
// rejoue aucun autre reffet ; à la destruction, ce qui reste part comme avant, chaque nettoyage une fois, même quand il
// retire son reffet ou un autre ; un retrait demandé après la destruction ne rejoue pas le nettoyage, ne lève rien, et
// retire pour de bon : revenu dans la page, le composant ne relance pas ce reffet et ne fait plus jouer cet écouteur.
// Compilé en CoffeeScript comme en Civet (`=` et `:=`) : l'affectation garde la valeur rendue.
// Le routeur des gestionnaires du gabarit appelle toute fonction qu'un gestionnaire rend (forme `@click={save}`), sauf
// la fonction de retrait d'un `µon` née pendant ce gestionnaire (`@click={$brancher()}`, l'entrée de survol comprise) :
// l'écouteur qu'il vient de poser reste ; rendue à un clic suivant (`@click={arreter}`), appelée par l'écouteur lui-même
// ou par le code de l'appli, elle retire ; une fabrique rendue (`@click={fabrique(2)}`, `@mouseenter={fabrique(3)}`)
// est toujours appelée. Écrit en dernier dans un reffet (`µeffect -> µon 'scroll', f`), `µon` rend son nettoyage : les
// écouteurs ne s'empilent plus d'un passage à l'autre. L'exemple de la doc (`arreter := µeffect …`, `pause`) compile
// sans avertissement, ne repose son intervalle qu'au changement de `$delai`, jamais à chaque tour, et la pause l'arrête.

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'ret-on-coffee': [
    '<script lang="coffee">',
    'window.__on = {item: 0, autre: 0}',
    "arreter = µon 'click', '.item', (e, el) -> window.__on.item += 1",
    "couper = µ.on 'click', '.autre', (e) -> window.__on.autre += 1",
    'window.__on.arreter = arreter',
    'window.__on.couper = couper',
    '</script>',
    '<button class="item">a</button>',
    '<button class="autre">b</button>',
  ].join('\n'),
  'ret-on-civet': [
    '<script lang="civet">',
    'window.__onc = {item: 0, monte: 0}',
    'choisir = (e, el) -> window.__onc.item += 1',
    "arreter := µon 'click', '.item', choisir",
    'window.__onc.arreter = arreter',
    'µmount ->',
    "  window.__onc.arreterMonte = µon 'click', '.item', (e, el) -> window.__onc.monte += 1",
    '  return',
    '</script>',
    '<button class="item">a</button>',
  ].join('\n'),
  'ret-effet-civet': [
    '<script lang="civet">',
    '$n = 0',
    'window.__ec = {passages: 0, nettoyages: 0, autres: 0}',
    'stop := µeffect ->',
    '  window.__ec.passages += 1',
    '  $n',
    '  -> window.__ec.nettoyages += 1',
    'couper = µ.effect ->',
    '  window.__ec.autres += 1',
    '  $n',
    '  return',
    'pause := -> stop()',
    'window.__ec.stop = stop',
    'window.__ec.couper = couper',
    '</script>',
    '<p>{$n}</p>',
    '<button class="pause" @click={pause}>pause</button>',
  ].join('\n'),
  // e1 retire e2 (plus loin), e3 retire e1 (déjà passé), e4 se retire pendant son passage, e6 depuis son nettoyage
  'ret-effet-passage': [
    '<script lang="coffee">',
    '$n = 0',
    'p = window.__p = {e1: 0, e2: 0, e3: 0, e4: 0, e5: 0, e6: 0, c1: 0, c2: 0, c3: 0, c4: 0, c5: 0, c6: 0}',
    'stop1 = µeffect ->',
    '  p.e1 += 1',
    '  stop2() if $n == 1',
    '  -> p.c1 += 1',
    'stop2 = µeffect ->',
    '  p.e2 += 1',
    '  $n',
    '  -> p.c2 += 1',
    'stop3 = µeffect ->',
    '  p.e3 += 1',
    '  stop1() if $n == 2',
    '  -> p.c3 += 1',
    'stop4 = µeffect ->',
    '  p.e4 += 1',
    '  stop4() if $n == 3',
    '  -> p.c4 += 1',
    'stop5 = µeffect ->',
    '  p.e5 += 1',
    '  $n',
    '  -> p.c5 += 1',
    'stop6 = µeffect ->',
    '  p.e6 += 1',
    '  $n',
    '  ->',
    '    p.c6 += 1',
    '    stop6() if $n == 5',
    'window.__stops = [stop1, stop2, stop3, stop4, stop5, stop6]',
    '</script>',
    '<p>{$n}</p>',
  ].join('\n'),
  // fonctions de retrait rendues aux routeurs : celui des clics et celui de l'entrée de survol ; `µmount` présent, un
  // écouteur posé composant monté est inscrit au retrait à la destruction
  'ret-brancher': [
    '<script lang="coffee">',
    'w = window.__br = {item: 0, unique: 0, entrees: 0, survol: 0, fab: 0}',
    'µmount -> w.monte = true',
    'arreter = null',
    "$brancher = -> arreter = µon 'click', '.item', (e, el) -> w.item += 1",
    '$unique = ->',
    "  fin = µon 'click', '.unique', (e, el) ->",
    '    w.unique += 1',
    '    fin()',
    '$survoler = ->',
    '  w.entrees += 1',
    "  µon 'click', '.survol', (e, el) -> w.survol += 1",
    'fabrique = (x) -> (e) -> w.fab += x',
    '</script>',
    '<button class="brancher" @click={$brancher()}>b</button>',
    '<button class="arreter" @click={arreter}>a</button>',
    '<button class="armer" @click={$unique()}>u</button>',
    '<div class="zone" @mouseenter={$survoler()}>z</div>',
    '<div class="zone-fab" @mouseenter={fabrique(3)}>f</div>',
    '<button class="fab" @click={fabrique(2)}>f</button>',
    '<span class="item">i</span>',
    '<span class="unique">u</span>',
    '<span class="survol">s</span>',
  ].join('\n'),
  'ret-effet-on': [
    '<script>',
    '$n = 0',
    'w := window.__eo = {vus: 0}',
    'µmount -> w.monte = true',
    'µeffect ->',
    '  $n',
    "  µon 'scroll', (e) -> w.vus += 1",
    '</script>',
    '<p class="zone">{$n}</p>',
  ].join('\n'),
  // nettoyages joués pendant la destruction, qui retirent leur reffet (A, C) ou un autre (B)
  'ret-destruction': [
    '<script lang="coffee">',
    'p = window.__ds = {ca: 0, cb: 0, cc: 0}',
    '$n = 0',
    'stopA = µeffect ->',
    '  $n',
    '  ->',
    '    p.ca += 1',
    '    stopA()',
    '    stopB()',
    'stopB = µeffect ->',
    '  $n',
    '  -> p.cb += 1',
    'stopC = µeffect ->',
    '  $n',
    '  ->',
    '    p.cc += 1',
    '    stopC()',
    '</script>',
    '<p>{$n}</p>',
  ].join('\n'),
  // retraits demandés après la destruction, puis retour dans la page ; témoins jamais retirés
  'ret-retour': [
    '<script>',
    '$n = 0',
    'w := window.__rr = {e: 0, t: 0, item: 0, temoin: 0}',
    'w.stop = µeffect ->',
    '  w.e += 1',
    '  $n',
    '  return',
    'µeffect ->',
    '  w.t += 1',
    '  $n',
    '  return',
    "w.fin = µon 'click', '.item', -> w.item += 1",
    "µon 'click', '.temoin', -> w.temoin += 1",
    '</script>',
    '<p>{$n}</p>',
    '<button class="item">i</button>',
    '<button class="temoin">t</button>',
  ].join('\n'),
}

// l'exemple de `docs/03-reactivite.md` où `µeffect` rend la fonction qui retire le reffet
const EXEMPLE_DOC = readFileSync(new URL('../docs/03-reactivite.md', import.meta.url), 'utf-8').split('```html\n').map((b) => b.split('\n```')[0]).find((b) => b.includes('arreter := µeffect')) ?? ''
if (EXEMPLE_DOC) SOURCES['doc-pause'] = EXEMPLE_DOC

function projet(): string {
  const root = mjsTmp('retrait-ecouteur-reffet')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(root, 'src', `${nom}.mjs`), source + '\n')
  return root
}

const pause = (ms = 40) => new Promise(r => setTimeout(r, ms))

describe('µon et µeffect rendent une fonction qui les retire', function () {
  this.timeout(60000)
  let app: any
  before(async () => { app = await createHarness({ root: projet() }) })
  after(async () => { if (app) await app.destroy() })

  it('µon / µ.on (CoffeeScript) : la fonction rendue retire l\'écouteur, un deuxième appel ne fait rien', async () => {
    const c = await app.mount('ret-on-coffee')
    const v = app.window.__on
    try {
      assert.equal(typeof v.arreter, 'function', 'µon rend une fonction')
      assert.equal(typeof v.couper, 'function', 'µ.on rend une fonction')
      await c.click('.item')
      await c.click('.autre')
      assert.deepEqual({ item: v.item, autre: v.autre }, { item: 1, autre: 1 })
      v.arreter()
      await c.click('.item')
      await c.click('.autre')
      assert.deepEqual({ item: v.item, autre: v.autre }, { item: 1, autre: 2 }, 'seul l\'écouteur retiré se tait')
      v.couper()
      assert.doesNotThrow(() => { v.arreter(); v.couper() }, 'deuxième appel')
      await c.click('.item')
      await c.click('.autre')
      assert.deepEqual({ item: v.item, autre: v.autre }, { item: 1, autre: 2 })
    }
    finally {
      c.destroy()
    }
  })

  it('µon posé au montage (Civet) : retiré avec son inscription de retrait à la destruction ; après la destruction, rien ne lève', async () => {
    const c = await app.mount('ret-on-civet')
    const v = app.window.__onc
    await pause()
    assert.equal(typeof v.arreter, 'function', 'µon rend une fonction (affectation Civet)')
    assert.equal(typeof v.arreterMonte, 'function', 'µon rend une fonction au montage')
    await c.click('.item')
    assert.deepEqual({ item: v.item, monte: v.monte }, { item: 1, monte: 1 })
    const inscrits = (c.el._mjs_destroy_cbs ?? []).length
    v.arreterMonte()
    assert.equal((c.el._mjs_destroy_cbs ?? []).length, inscrits - 1, 'l\'inscription de retrait à la destruction part avec l\'écouteur')
    await c.click('.item')
    assert.deepEqual({ item: v.item, monte: v.monte }, { item: 2, monte: 1 })
    v.arreter()
    assert.equal((c.el._mjs_destroy_cbs ?? []).length, inscrits - 1, 'un écouteur posé par le script n\'a pas d\'inscription')
    assert.doesNotThrow(() => { v.arreter(); v.arreterMonte() }, 'deuxième appel')
    await c.click('.item')
    assert.deepEqual({ item: v.item, monte: v.monte }, { item: 2, monte: 1 })
    c.destroy()
    await pause()
    assert.doesNotThrow(() => { v.arreter(); v.arreterMonte() }, 'appel après la destruction')
  })

  it('µeffect / µ.effect (Civet) : le reffet retiré ne tourne plus, son nettoyage joue une fois ; un deuxième appel ne fait rien, un appel après la destruction ne rejoue pas le nettoyage', async () => {
    const c = await app.mount('ret-effet-civet')
    const v = app.window.__ec
    await pause()
    assert.equal(typeof v.stop, 'function', 'µeffect rend une fonction (affectation Civet)')
    assert.equal(typeof v.couper, 'function', 'µ.effect rend une fonction')
    assert.deepEqual({ passages: v.passages, nettoyages: v.nettoyages, autres: v.autres }, { passages: 1, nettoyages: 0, autres: 1 })
    await c.set({ n: 1 })
    assert.deepEqual({ passages: v.passages, nettoyages: v.nettoyages, autres: v.autres }, { passages: 2, nettoyages: 1, autres: 2 })
    await c.click('.pause')
    assert.deepEqual({ passages: v.passages, nettoyages: v.nettoyages }, { passages: 2, nettoyages: 2 }, 'le nettoyage joue au retrait')
    v.stop()
    assert.equal(v.nettoyages, 2, 'un deuxième appel ne rejoue pas le nettoyage')
    await c.set({ n: 2 })
    assert.deepEqual({ passages: v.passages, nettoyages: v.nettoyages, autres: v.autres }, { passages: 2, nettoyages: 2, autres: 3 }, 'le reffet retiré ne tourne plus, l\'autre si')
    v.couper()
    await c.set({ n: 3 })
    assert.equal(v.autres, 3, 'µ.effect retiré')
    c.destroy()
    await pause()
    assert.equal(v.nettoyages, 2, 'la destruction ne rejoue pas un nettoyage déjà joué')
    assert.doesNotThrow(() => { v.stop(); v.couper() }, 'appel après la destruction')
    assert.equal(v.nettoyages, 2)
  })

  it('retirer des reffets pendant leur passage : depuis un autre, depuis lui-même, depuis son nettoyage — aucun saut, aucun double passage', async () => {
    const c = await app.mount('ret-effet-passage')
    const w = app.window
    const p = w.__p
    const etat = () => ({ ...p })
    const attendu = (e: number[], cl: number[]) => {
      const o: Record<string, number> = {}
      e.forEach((x, i) => { o['e' + (i + 1)] = x })
      cl.forEach((x, i) => { o['c' + (i + 1)] = x })
      return o
    }
    await pause()
    assert.deepEqual(etat(), attendu([1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0]), 'premier passage')
    // e1 retire e2, plus loin dans la liste : e2 ne tourne pas, son nettoyage joue une fois
    await c.set({ n: 1 })
    assert.deepEqual(etat(), attendu([2, 1, 2, 2, 2, 2], [1, 1, 1, 1, 1, 1]), 'e1 retire e2')
    w.__stops[1]()
    assert.equal(p.c2, 1, 'deuxième appel de stop2')
    // e3 retire e1, déjà passé : e4 n'est pas sauté
    await c.set({ n: 2 })
    assert.deepEqual(etat(), attendu([3, 1, 3, 3, 3, 3], [3, 1, 2, 2, 2, 2]), 'e3 retire e1')
    // e4 se retire pendant son passage : ce qu'il vient de rendre joue une fois, e5 n'est pas sauté
    await c.set({ n: 3 })
    assert.deepEqual(etat(), attendu([3, 1, 4, 4, 4, 4], [3, 1, 3, 4, 3, 3]), 'e4 se retire')
    await c.set({ n: 4 })
    assert.deepEqual(etat(), attendu([3, 1, 5, 4, 5, 5], [3, 1, 4, 4, 4, 4]), 'passage suivant')
    // e6 se retire depuis son nettoyage : le nettoyage joue une fois, e6 ne tourne plus
    await c.set({ n: 5 })
    assert.deepEqual(etat(), attendu([3, 1, 6, 4, 6, 5], [3, 1, 5, 4, 5, 5]), 'e6 se retire depuis son nettoyage')
    assert.ok(!w.µ._mjs_effRun, 'plus aucun reffet en cours')
    c.destroy()
    await pause()
    assert.deepEqual(etat(), attendu([3, 1, 6, 4, 6, 5], [3, 1, 6, 4, 6, 5]), 'la destruction emporte e3 et e5, rien d\'autre')
    assert.doesNotThrow(() => { for (const s of w.__stops) s() }, 'appels après la destruction')
    assert.deepEqual(etat(), attendu([3, 1, 6, 4, 6, 5], [3, 1, 6, 4, 6, 5]))
  })

  it('`@click={$brancher()}` garde l\'écouteur qu\'il vient de poser ; `@click={arreter}`, à un clic suivant, le retire', async () => {
    const c = await app.mount('ret-brancher')
    const v = app.window.__br
    try {
      await c.click('.item')
      assert.equal(v.item, 0, 'rien n\'est encore posé')
      await c.click('.brancher')
      await c.click('.item')
      await c.click('.item')
      assert.equal(v.item, 2, 'la fonction de retrait rendue au routeur n\'a rien retiré')
      await c.click('.arreter')
      await c.click('.item')
      assert.equal(v.item, 2, 'retiré par `@click={arreter}`')
    }
    finally { c.destroy() }
  })

  it('`arreter()` écrit dans l\'écouteur même le retire, avec son inscription de retrait à la destruction', async () => {
    const c = await app.mount('ret-brancher')
    const v = app.window.__br
    try {
      await pause()
      const inscrits = (c.el._mjs_destroy_cbs ?? []).length
      await c.click('.armer')
      assert.equal((c.el._mjs_destroy_cbs ?? []).length, inscrits + 1, 'posé composant monté : inscrit à la destruction')
      await c.click('.unique')
      await c.click('.unique')
      assert.equal(v.unique, 1, 'l\'écouteur ne joue qu\'une fois')
      assert.equal((c.el._mjs_destroy_cbs ?? []).length, inscrits, 'son inscription est partie avec lui')
    }
    finally { c.destroy() }
  })

  it('l\'entrée de survol (`@mouseenter={$survoler()}`, son propre routeur) garde aussi l\'écouteur posé', async () => {
    const c = await app.mount('ret-brancher')
    const v = app.window.__br
    try {
      await c.fire('.zone', 'mouseover', { relatedTarget: null })
      assert.equal(v.entrees, 1, 'le gestionnaire d\'entrée a joué')
      await c.click('.survol')
      await c.click('.survol')
      assert.equal(v.survol, 2)
      await c.fire('.zone-fab', 'mouseover', { relatedTarget: null })
      assert.equal(v.fab, 3, 'la fabrique rendue par l\'entrée de survol est appelée')
    }
    finally { c.destroy() }
  })

  it('une fabrique rendue (`@click={fabrique(2)}`) est toujours appelée', async () => {
    const c = await app.mount('ret-brancher')
    const v = app.window.__br
    try {
      await c.click('.fab')
      await c.click('.fab')
      assert.equal(v.fab, 4)
    }
    finally { c.destroy() }
  })

  it('`µeffect -> µon \'scroll\', f` : la fonction de retrait rendue devient le nettoyage du reffet, les écouteurs ne s\'empilent plus', async () => {
    const c = await app.mount('ret-effet-on')
    const v = app.window.__eo
    await pause()
    await c.fire('.zone', 'scroll')
    assert.equal(v.vus, 1, 'premier passage')
    await c.set({ n: 1 })
    await pause()
    const inscrits = (c.el._mjs_destroy_cbs ?? []).length
    await c.fire('.zone', 'scroll')
    assert.equal(v.vus, 2, 'deuxième passage : un seul écouteur')
    await c.set({ n: 2 })
    await pause()
    await c.fire('.zone', 'scroll')
    assert.equal(v.vus, 3, 'troisième passage : un seul écouteur')
    assert.equal((c.el._mjs_destroy_cbs ?? []).length, inscrits, 'les inscriptions de retrait à la destruction ne s\'empilent pas')
    const zone = c.find('.zone')
    c.destroy()
    await pause()
    zone.dispatchEvent(new app.window.Event('scroll', { bubbles: true, composed: true }))
    assert.equal(v.vus, 3, 'retiré à la destruction')
  })

  it('à la destruction, chaque nettoyage joue une fois, même quand il retire son reffet ou un autre', async () => {
    const c = await app.mount('ret-destruction')
    await pause()
    c.destroy()
    await pause()
    assert.deepEqual({ ...app.window.__ds }, { ca: 1, cb: 1, cc: 1 })
  })

  it('appelées après la destruction, les fonctions de retrait retirent pour de bon : revenu dans la page, le composant ne relance pas le reffet et ne fait plus jouer l\'écouteur', async () => {
    const c = await app.mount('ret-retour')
    const w = app.window.__rr
    await pause()
    assert.deepEqual({ e: w.e, t: w.t }, { e: 1, t: 1 })
    const el     = c.el
    const parent = el.parentNode
    el.remove()
    await pause()
    assert.doesNotThrow(() => { w.stop(); w.fin() })
    parent.appendChild(el)
    await pause()
    await c.set({ n: 1 })
    await pause()
    assert.equal(w.e, 1, 'le reffet retiré ne repart pas')
    assert.ok(w.t > 1, 'témoin : un reffet laissé repart au retour')
    await c.click('.item')
    await c.click('.temoin')
    assert.deepEqual({ item: w.item, temoin: w.temoin }, { item: 0, temoin: 1 }, 'l\'écouteur retiré ne joue plus, le témoin si')
    c.destroy()
  })

  it('l\'exemple de la doc (`arreter := µeffect …`) compile sans avertissement', async () => {
    assert.ok(EXEMPLE_DOC, 'exemple trouvé dans docs/03-reactivite.md')
    const vus: string[] = []
    const avant = console.warn
    console.warn = (...a: any[]) => { vus.push(a.join(' ')) }
    try { await transpile(EXEMPLE_DOC + '\n', { moduleName: 'doc-pause' }) }
    finally { console.warn = avant }
    assert.deepEqual(vus, [])
  })

  it('l\'exemple de la doc : l\'intervalle est posé une fois, pas à chaque tour ; il l\'est de nouveau quand `$delai` change, et la pause l\'arrête', async () => {
    assert.ok(EXEMPLE_DOC, 'exemple trouvé dans docs/03-reactivite.md')
    const w     = app.window
    const avant = w.setInterval
    let poses   = 0
    let tours   = 0
    // même code, tour raccourci à 20 ms et compté
    w.setInterval = (f: any, _d: number, ...r: any[]) => { poses++; return avant.call(w, (...a: any[]) => { tours++; return f(...a) }, 20, ...r) }
    try {
      const c = await app.mount('doc-pause')
      try {
        await pause(80)
        assert.ok(tours >= 2 && c.state.heure, `l'horloge tourne (${tours} tours)`)
        await c.set({ heure: '' })
        await pause(80)
        assert.ok(c.state.heure, 'réécrite au tour suivant')
        assert.equal(poses, 1, 'intervalle posé une fois, malgré les rendus')
        await c.set({ delai: 500 })
        assert.equal(poses, 2, 'posé de nouveau quand $delai change')
        await c.click('button')
        const t = tours
        await pause(80)
        assert.equal(tours, t, 'arrêté par la pause')
        assert.equal(poses, 2)
      }
      finally { c.destroy() }
    }
    finally { w.setInterval = avant }
  })
})
