// Effets « exclusivités MJS » — ce que seul MJS sait faire parce qu'il connaît les règles de ses
// variables, son serveur temps réel, ses mises à jour : *gauge (un nombre se remplit comme une
// jauge, dans la plage de sa variable), *guard (un champ qui refuse une valeur hors de sa règle
// tremble et dit ce qui est permis). happy-dom ne calcule aucune mise en page : on lit les
// variables CSS et les attributs posés, la géométrie se vérifie au banc navigateur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { parseEffect, checkPlacement } from '../src/effects/catalog.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { mjsTmp } from './helpers/tmp.js'
import { mesurer } from './helpers/mesure-balise.js'

const COMPOSANTS: Record<string, string> = {
  'fx-jauge': '<vars>\n  $volume  int 0..200\n</vars>\n<script>\n$volume = 50\n$p = 3\n</script>\n<span class="g" *gauge>{$volume}</span>\n<span class="h" *gauge(min: 0, max: 10, style: line, direction: left)>5</span>\n<div class="v" *gauge(value: $p, max: 12, colors: [#00ff00, #ff0000])></div>\n<button class="max" @click={$volume = 200}>+</button>\n<button class="p6" @click={$p = 6}>6</button>',
  'fx-eclair': '<script>\n$p = 1\n</script>\n<b class="f" *flash(#ff0000, duration: 300ms, style: fill)>{$p}</b>\n<button class="plus" @click={$p++}>+</button>',
  'fx-direct': '<@document *react(server: \'wss://x.fr/ws\', size: 20, duration: 300ms)></@document>\n<button class="r" *react(❤)>❤</button>',
  'fx-direct-local': '<script>\n@sock = null\n</script>\n<div class="z" *react(stage: true, rate: 3, duration: 300ms)><button class="l" *react(🎉, count: 2)>🎉</button></div>\n<button class="p" *react(😂)>😂</button>',
  'fx-direct-serveur': '<div class="z" *react(stage: true, server: \'wss://x.fr/ws\', rate: 3, duration: 300ms)><button class="l" *react(🎉, count: 2)>🎉</button></div>\n<div class="pluie" *react(stage: true, server: \'wss://x.fr/ws\', direction: down, gravity: 2)><button class="d" *react(💧)>💧</button></div>',
  'fx-suivre': '<script>\n$mene = true\n</script>\n<div class="z" *follow(server: \'wss://x.fr/ws\', lead: $mene)><section>Un</section><section>Deux</section></div>\n<button class="m" @click={$mene = !$mene}>m</button>',
  'fx-suivre-curseur': '<div class="m" *follow(server: \'wss://x.fr/ws\', lead: true, cursor: normal, selection: false, focus: false)><section>Un <input class="i" aria-label="note" value="un texte"></section></div>\n<div class="s" *follow(server: \'wss://x.fr/ws\', cursor: normal, selection: false, focus: false)><section>Un <input class="i" aria-label="note" value="un texte"></section></div>',
  'fx-suivre-regle': '<script>\n$c = \'none\'\n</script>\n<div class="z" *follow(server: \'wss://x.fr/ws\', lead: true, cursor: $c)><section>Un</section></div>\n<button class="c" @click={$c = \'pulse\'}>c</button>',
  'fx-suivre-tout': '<div class="m" *follow(server: \'wss://x.fr/ws\', lead: true, cursor: pulse, selection: true, focus: true)><section><button class="b">Un</button><input class="i" aria-label="note" value="un texte"></section></div>\n<div class="s" *follow(server: \'wss://x.fr/ws\', cursor: pulse, selection: true, focus: true)><section><button class="b">Un</button><input class="i" aria-label="note" value="un texte"></section></div>',
  'fx-suivre-local': '<script>\n@sock = null\n</script>\n<div class="a" *follow(lead: true, room: demo)><section>Un</section><section>Deux</section></div>\n<div class="b" *follow(room: demo)><section>Un</section><section>Deux</section></div>',
  'fx-clics': '<@document *heatmap(server: \'wss://x.fr/ws\')></@document>\n<div class="c">zone</div>',
  'fx-chaleur': '<script>\n$n = 2\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="h" *heatmap(server: \'wss://x.fr/ws\', on: mouseover, show: true)>zone</div>\n<div class="k" *heatmap(server: \'wss://x.fr/ws\', on: mouseover, show: $n)>zone</div>\n<div class="auto" *heatmap(on: mouseover, show: true)>zone</div>\n<button class="plus" @click={$n = 3}>+</button>',
  'fx-chaleur-seule': '<script>\n@sock = null\n</script>\n<div class="sans" *heatmap(show: true)>zone</div>',
  'fx-suivre-auto': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="m" *follow(lead: true)><section><button class="b">Un</button><input class="i" aria-label="note" value="un texte"></section></div>',
  'fx-suivre-deux': '<script>\n$deux = true\n@sock = µsocket \'wss://appli2.fr/ws\'\n</script>\n<div class="a" *follow(lead: true)><section>Un</section></div>\n{if $deux}<div class="b" *follow><section>Un</section></div>{end}\n<button class="k" @click={$deux = false}>k</button>',
  'fx-direct-boutons': '<script>\n$deux = true\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<button class="a" *react(🎉)>🎉</button>\n{if $deux}<button class="b" *react(❤)>❤</button>{end}\n<button class="k" @click={$deux = false}>k</button>',
  'fx-curseurs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="c" *cursors><section><button class="b">Un</button><input class="i" aria-label="note" value="un texte"></section></div>',
  'fx-curseurs-regle': '<script>\n$c = \'none\'\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="c" *cursors(cursor: $c, selection: false, focus: false)><section>Un</section></div>\n<button class="k" @click={$c = \'pulse\'}>c</button>',
  'fx-direct-auto': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<@document *react(size: 20, duration: 300ms) *heatmap></@document>\n<button class="r" *react(❤)>❤</button>',
  'fx-curseurs-max': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n$m = 2\n</script>\n<div class="c" *cursors(max: $m)><section><b class="b">x</b></section></div>\n<button class="m3" @click={$m = 3}>m</button>',
  'fx-suivre-store': '<div class="m" *follow(lead: true, sock: $$sock)><section>Un</section></div>',
  'fx-suivre-b': '<script>\n@sock = µsocket \'wss://b.fr/ws\'\n</script>\n<div class="m" *follow(lead: true)><section>Un</section></div>',
  'fx-chaleur-serveur': '<div class="m" *heatmap(server: \'wss://x.fr/ws\', on: mousemove, name: carte)>zone</div>',
  'fx-hors': '<@document *offline(delay: 0s)></@document>\n<p>notes</p>',
  'fx-hors-regle': '<section class="z" *offline(\'Pas de réseau\', place: top, size: 56, zindex: 30, background: #102030, color: #ffcc00, opacity: 0.9, logo: 📡, veil: 0.5, count: false, delay: 0s)><p>zone</p></section>',
  'fx-garde': '<vars>\n  $age  int 18..120\n  $nom  string 2..10\n</vars>\n<script>\n$age = 30\n$nom = \'Zora\'\n</script>\n<input class="a" aria-label="âge" value=!{$age} *guard>\n<input class="n" aria-label="nom" value=!{$nom} *guard(text: \'Deux à dix lettres\')>\n<b class="va">{$age}</b><b class="vn">{$nom}</b>',
  'fx-garde-delai': '<vars>\n  $age  int 18..120\n  $nom  string 2..10\n</vars>\n<script>\n$age = 30\n$nom = \'Zora\'\n</script>\n<input class="d" aria-label="âge" value=!{$age} *guard(delay: 150ms)>\n<input class="z" aria-label="âge" value=!{$age} *guard(delay: 0)>\n<input class="n" aria-label="nom" value=!{$nom} *guard(delay: 150ms)>\n<input class="s" aria-label="âge" value=!{$age} *guard(silent: true)>\n<b class="va">{$age}</b><b class="vn">{$nom}</b>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('effets — exclusivités MJS', function () {
  this.timeout(60000)
  let window: any
  let vraiSocket: any

  before(async () => {
    const root   = mjsTmp('effets-exclusivites')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    // les libellés du runtime (la bulle de *guard) viennent du manifeste
    const libelles = /µ\._runtimeLabels = (\{[\s\S]*?\});\n/.exec(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;${libelles ? ` µ._runtimeLabels = ${libelles[1]};` : ''}`)
    window.document.documentElement.lang = 'fr'
    vraiSocket = window.µ.socket
    // un effet en direct sans connexion : l'erreur au bout de 60 ms, pas de 2 s
    window.µ._mjs_sockGrace = 60
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await new Promise((r) => setTimeout(r, 20))
    return comp._shadow.querySelector(sel)
  }

  const p = (el: any) => el.querySelector('[mjs-fx-layer="gauge"]')?.style.getPropertyValue('--mjs-fx-gauge-p')

  it('*gauge : la plage vient du <vars> de la variable écrite dans la balise ; la jauge suit le nombre', async () => {
    const g = await monter('mjs-fx-jauge', '.g')
    assert.equal(p(g), '0.25', '$volume = 50 dans 0..200')
    g.getRootNode().querySelector('.max').click()
    await attendre(() => p(g) === '1')
    assert.equal(p(g), '1')
  })

  it('*gauge(min, max, style: line, direction: left) : la plage écrite, le trait, le sens', async () => {
    const h = await monter('mjs-fx-jauge', '.h')
    assert.equal(p(h), '0.5')
    assert.equal(h.getAttribute('mjs-fx-gauge-style'), 'line')
    assert.equal(h.getAttribute('mjs-fx-gauge-dir'), 'left')
  })

  it('*gauge(value: $p, colors) : une variable suivie sans reposer la jauge ; la couleur suit la valeur', async () => {
    const v = await monter('mjs-fx-jauge', '.v')
    const calque = v.querySelector('[mjs-fx-layer="gauge"]')
    assert.equal(p(v), '0.25')
    v.getRootNode().querySelector('.p6').click()
    await attendre(() => p(v) === '0.5')
    assert.equal(p(v), '0.5')
    assert.ok(v.querySelector('[mjs-fx-layer="gauge"]') === calque, 'la même jauge, qui glisse d\'une valeur à l\'autre')
    assert.match(calque.style.getPropertyValue('--mjs-fx-gauge-c'), /color-mix\(in srgb, #ff0000 50(\.0+)?%, #00ff00\)/)
  })

  it('*gauge : dessine dans sa balise — refusé sur une image, réglages vérifiés', () => {
    assert.throws(() => checkPlacement('gauge', parseEffect('gauge', ''), 'img', false), /\*gauge/)
    assert.deepEqual(parseEffect('gauge', '#0f0, style: ring, thickness: 6').fixed, { color: '#0f0', style: 'ring', thickness: 6 })
    assert.throws(() => parseEffect('gauge', 'style: barre'), /style/)
  })

  const taper = async (i: any, v: string, fin = false) => {
    i.value = v
    i.dispatchEvent(new window.Event('input', { bubbles: true }))
    if (fin) i.dispatchEvent(new window.Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 30))
  }

  it('*guard : pendant la frappe, une valeur hors de la règle ne part pas dans la variable ; le champ garde ce qu\'on tape', async () => {
    const a    = await monter('mjs-fx-garde', '.a')
    const root = a.getRootNode()
    await taper(a, '1')
    assert.equal(a.value, '1', 'le champ n\'est pas réécrit en pleine frappe')
    assert.equal(root.querySelector('.va').textContent, '30', '$age garde sa dernière bonne valeur')
    await taper(a, '12')
    assert.equal(root.querySelector('.va').textContent, '30')
    await taper(a, '120')
    assert.equal(root.querySelector('.va').textContent, '120', 'une valeur permise part tout de suite')
  })

  it('*guard : à la sortie du champ, une valeur hors de sa plage y est ramenée ; le champ tremble et la bulle dit ce qui est permis', async () => {
    const a    = await monter('mjs-fx-garde', '.a')
    const root = a.getRootNode()
    assertAbsent(root.querySelector('[mjs-fx-guard-tip]'), 'pas de bulle au départ')
    await taper(a, '300', true)
    assert.equal(a.value, '120', 'ramenée à la borne')
    assert.equal(root.querySelector('.va').textContent, '120')
    assert.ok((a.getAttribute('mjs-fx') || '').includes('shake'), 'le champ tremble (*shake, l\'effet par défaut)')
    const bulle = root.querySelector('[mjs-fx-guard-tip]')
    assert.ok(bulle, 'la bulle')
    assert.equal(bulle.textContent, 'de 18 à 120')
    await taper(a, '12', true)
    assert.equal(a.value, '18')
  })

  it('*guard(text) : une valeur refusée (un texte trop court) rend la dernière bonne ; la bulle dit le texte donné', async () => {
    const n    = await monter('mjs-fx-garde', '.n')
    const root = n.getRootNode()
    await taper(n, 'Z', true)
    assert.equal(n.value, 'Zora', 'la dernière bonne valeur revient dans le champ')
    assert.equal(root.querySelector('.vn').textContent, 'Zora')
    assert.equal(root.querySelector('[mjs-fx-guard-tip]').textContent, 'Deux à dix lettres')
  })

  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it('*guard(delay) : rien pendant la frappe ; une pause sur une valeur hors de la règle, et le garde prévient (bulle, secousse) sans toucher au champ ; il ne corrige qu\'à la sortie', async () => {
    const d    = await monter('mjs-fx-garde-delai', '.d')
    const root = d.getRootNode()
    await taper(d, '2')
    assertAbsent(root.querySelector('[mjs-fx-guard-tip]'), 'pas de bulle avant la pause')
    await taper(d, '25')
    assert.equal(root.querySelector('.va').textContent, '25', '« 25 » tapé d\'un trait : bon, rien ne s\'est déclenché')
    await pause(250)
    assertAbsent(root.querySelector('[mjs-fx-guard-tip]'), 'une bonne valeur : rien après la pause')
    await taper(d, '2')
    await pause(250)
    assert.equal(root.querySelector('[mjs-fx-guard-tip]')?.textContent, 'de 18 à 120', 'la pause sur « 2 » : la bulle')
    assert.ok((d.getAttribute('mjs-fx') || '').includes('shake'), 'le champ tremble')
    assert.equal(d.value, '2', 'le champ garde ce qu\'on tape')
    assert.equal(root.querySelector('.va').textContent, '25', '$age garde sa dernière bonne valeur')
    await taper(d, '2', true)
    assert.equal(d.value, '18', 'à la sortie : ramené à la borne')
    assert.equal(root.querySelector('.va').textContent, '18')
  })

  it('*guard(delay: 0) : prévient dès la frappe, sans toucher au champ', async () => {
    const z    = await monter('mjs-fx-garde-delai', '.z')
    const root = z.getRootNode()
    await taper(z, '2')
    assert.equal(root.querySelector('[mjs-fx-guard-tip]')?.textContent, 'de 18 à 120')
    assert.equal(z.value, '2')
  })

  it('*guard(delay) : un texte refusé n\'est jamais effacé pendant la pause — la bulle seulement ; la sortie rend la dernière bonne valeur', async () => {
    const n    = await monter('mjs-fx-garde-delai', '.n')
    const root = n.getRootNode()
    await taper(n, 'Z')
    await pause(250)
    assert.ok(root.querySelector('[mjs-fx-guard-tip]'), 'la bulle après la pause')
    assert.equal(n.value, 'Z', 'rien d\'effacé')
    await taper(n, 'Z', true)
    assert.equal(n.value, 'Zora')
  })

  it('*guard(silent: true) : ni secousse ni bulle ; la frappe jamais réécrite, la valeur ramenée à la sortie', async () => {
    const s    = await monter('mjs-fx-garde-delai', '.s')
    const root = s.getRootNode()
    await taper(s, '2')
    assert.equal(s.value, '2', 'le champ garde ce qu\'on tape')
    assert.equal(root.querySelector('.va').textContent, '30')
    await taper(s, '300', true)
    assert.equal(s.value, '120', 'ramenée à la sortie')
    assert.equal(root.querySelector('.va').textContent, '120')
    assertAbsent(root.querySelector('[mjs-fx-guard-tip]'), 'aucune bulle')
    assert.ok(!(s.getAttribute('mjs-fx') || '').includes('shake'), 'aucune secousse')
    assert.equal(s.hasAttribute('mjs-fx-guard-no'), false, 'aucun liseré')
  })

  it('*flash : la balise s\'éclaire quand son contenu change (rien au premier affichage) — la couleur, la durée, le style donnés', async () => {
    const appels: any[] = []
    // le prototype des éléments est celui de toutes les fenêtres de happy-dom : `animate` y revient tel qu'il était (propre, ou absent)
    const avant = Object.getOwnPropertyDescriptor(window.Element.prototype, 'animate')
    window.Element.prototype.animate = function(kf: any, o: any) {
      appels.push([this, kf, o])
      return { cancel() {}, finished: Promise.resolve(), onfinish: null }
    }
    try {
      const f = await monter('mjs-fx-eclair', '.f')
      await new Promise((r) => setTimeout(r, 30))
      assert.equal(appels.filter((a) => a[0] === f).length, 0, 'rien au premier affichage')
      f.getRootNode().querySelector('.plus').click()
      await attendre(() => appels.some((a) => a[0] === f))
      const [, kf, o] = appels.find((a) => a[0] === f)
      assert.match(JSON.stringify(kf), /#ff0000/)
      assert.match(JSON.stringify(kf), /backgroundColor/, 'style: fill — le fond')
      assert.equal(o.duration, 300)
    }
    finally {
      if (avant) Object.defineProperty(window.Element.prototype, 'animate', avant)
      else delete window.Element.prototype.animate
    }
  })

  // un serveur temps réel simulé : ce que l'effet envoie, les salons rejoints ; `recoit` joue une trame
  const fauxSocket = () => {
    const envoyes: any[] = []
    const requetes: any[] = []
    const ecoutes: Record<string, any[]> = {}
    const salons: string[] = []
    const s: any = {
      envoyes, salons, requetes,
      presents: { '7': true, '9': true, bot: true } as Record<string, boolean>,
      send(type: string, p: any, o?: any) { envoyes.push([type, p, o]) },
      on(type: string, f: any) { (ecoutes[type] ||= []).push(f); return () => {} },
      room(nom: string) { salons.push(nom); return { presence: () => s.presents, leave() {} } },
      destroy() {},
      request(type: string, p: any) { requetes.push([type, p]); return Promise.resolve(type === 'follow:last' ? { a: [1], y: 0 } : { id: 'moi', name: 'Moi' }) },
      recoit(type: string, p: any) { (ecoutes[type] || []).forEach((f) => f(p)) },
      release() {},
    }
    window.µ.socket = () => s
    // la connexion que l'appli a ouverte : celle que prend un effet sans `server`
    window.µ._mjs_sockets = { 'wss://x.fr/ws': s }
    return s
  }

  // aucune connexion ouverte par l'appli : un effet en direct sans `server` attend, puis le dit
  const sansConnexion = () => {
    window.µ.socket = () => { throw new Error('aucune connexion ne doit s\'ouvrir') }
    window.µ._mjs_sockets = {}
  }

  it('*react(server) sur <@document> et *react(❤) : un clic envoie l\'émoji au salon de la page et le fait monter ici ; celui des autres monte aussi', async () => {
    const sock = fauxSocket()
    const r = await monter('mjs-fx-direct', '.r')
    const doc = window.document
    assert.deepEqual(sock.salons, ['reactions:/'], 'le salon de la page')
    r.click()
    assert.equal(JSON.stringify(sock.envoyes.map((e: any) => [e[0], e[1]])), JSON.stringify([['reactions:send', { room: '/', e: '❤' }]]))
    const vus = () => Array.from(doc.querySelectorAll('[mjs-fx-react-emoji]') as ArrayLike<any>).map((e: any) => e.textContent)
    assert.deepEqual(vus(), ['❤'], 'il monte tout de suite, chez soi')
    sock.recoit('reactions:send', { room: '/', e: '🎉', from: { id: '2', name: 'Theo' } })
    assert.deepEqual(vus(), ['❤', '🎉'], 'celui d\'un autre visiteur aussi')
    sock.recoit('reactions:send', { room: '/autre', e: '😂', from: { id: '2', name: 'Theo' } })
    assert.deepEqual(vus(), ['❤', '🎉'], 'pas celui d\'une autre page')
    await attendre(() => vus().length === 0, 2000)
    assert.deepEqual(vus(), [], 'monté, il s\'en va')
  })

  it('*react sans connexion (@sock vide) : rien ne monte, une erreur en console le dit — scène d\'une balise ou posée par un bouton', async () => {
    const erreurs: string[] = []
    const avant = window.µ.error
    window.µ.error = (...a: any[]) => { erreurs.push(a.join(' ')) }
    try {
      sansConnexion()
      const l   = await monter('mjs-fx-direct-local', '.l')
      const z   = l.getRootNode().querySelector('.z')
      const doc = window.document
      l.click()
      l.click()
      l.getRootNode().querySelector('.p').click()
      assertAbsent(z.querySelector('[mjs-fx-react-emoji]'), 'rien dans la zone')
      assertAbsent(doc.body.querySelector('[mjs-fx-react-emoji]'), 'rien sur la page')
      await attendre(() => erreurs.length >= 2, 1000)
      await new Promise((r) => setTimeout(r, 100))
      assert.ok(erreurs.some((e) => /\*react/.test(e) && /µsocket/.test(e) && /reactionsPackage/.test(e)), JSON.stringify(erreurs))
      assert.equal(erreurs.length, 2, 'une erreur par scène, pas une par clic : ' + JSON.stringify(erreurs))
      assertAbsent(doc.body.querySelector('[mjs-fx-react-emoji]'), 'toujours rien')
    }
    finally {
      window.µ.error = avant
    }
  })

  it('*react sur des boutons seuls : la scène de la page est posée dès les boutons — les émojis des autres montent avant tout clic ; elle reste tant qu\'un bouton est là', async () => {
    const sock = fauxSocket()
    const a = await monter('mjs-fx-direct-boutons', '.a')
    await attendre(() => sock.salons.includes('reactions:/'))
    assert.deepEqual(sock.salons, ['reactions:/'], 'une scène pour la page, sans clic')
    const vus = () => Array.from(window.document.querySelectorAll('[mjs-fx-react-emoji]') as ArrayLike<any>).map((e: any) => e.textContent)
    sock.recoit('reactions:send', { room: '/', e: '🔥', from: { id: '9', name: 'Zora' } })
    assert.deepEqual(vus(), ['🔥'], 'l\'émoji d\'un autre visiteur monte')
    a.getRootNode().querySelector('.k').click()
    await attendre(() => !a.getRootNode().querySelector('.b'))
    sock.recoit('reactions:send', { room: '/', e: '👏', from: { id: '9', name: 'Zora' } })
    assert.ok(vus().includes('👏'), 'un bouton retiré, la scène reste pour l\'autre')
  })

  it('*react et *heatmap sur <@document>, sans sock : la connexion de @sock', async () => {
    const sock = fauxSocket()
    const r = await monter('mjs-fx-direct-auto', '.r')
    assert.deepEqual(sock.salons, ['reactions:/'], 'la scène de la page, sur la connexion de @sock')
    r.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true, clientX: 10, clientY: 20 }))
    await attendre(() => sock.envoyes.some((e: any) => e[0] === 'heatmap:point'))
    const types = sock.envoyes.map((e: any) => e[0])
    assert.ok(types.includes('reactions:send'), 'l\'émoji part : ' + JSON.stringify(types))
    assert.ok(types.includes('heatmap:point'), 'le point de chaleur part : ' + JSON.stringify(types))
  })

  it('*react(server) : la scène d\'une balise, count, le débit permis (rate) ; direction et gravité (down, gravity) — les émojis tombent en accélérant', async () => {
    const sock = fauxSocket()
    const l   = await monter('mjs-fx-direct-serveur', '.l')
    const z   = l.getRootNode().querySelector('.z')
    const dans = (n: any) => Array.from(n.querySelectorAll('[mjs-fx-react-emoji]') as ArrayLike<any>)
    l.click()
    assert.deepEqual(dans(z).map((e: any) => e.textContent), ['🎉', '🎉'], 'count: 2')
    l.click()
    assert.equal(dans(z).length, 3, 'rate: 3 — trois par seconde au plus')
    assert.equal(sock.envoyes.filter((e: any) => e[0] === 'reactions:send').length, 3)
    const haut = dans(z)[0]
    assert.ok(parseFloat(haut.style.getPropertyValue('--dy')) < 0, 'par défaut, vers le haut')
    const d = l.getRootNode().querySelector('.d')
    d.click()
    const goutte = dans(l.getRootNode().querySelector('.pluie'))[0]
    assert.ok(parseFloat(goutte.style.getPropertyValue('--dy')) > 0, 'direction: down — vers le bas : ' + goutte.style.getPropertyValue('--dy'))
    assert.ok(parseFloat(goutte.style.top) < 20, 'part du haut de la scène : ' + goutte.style.top)
    assert.match(goutte.style.getPropertyValue('--mjs-fx-react-ease'), /cubic-bezier\(0\.[5-9]/, 'gravity: 2 — elle accélère')
  })

  it('*reactions n\'existe plus : *react fait tout', () => {
    assert.throws(() => parseEffect('reactions', "'wss://x.fr/ws'"), /reactions/)
    assert.deepEqual(parseEffect('react', "❤, count: 2, rate: 8").fixed, { emoji: '❤', count: 2, rate: 8 })
    assert.deepEqual(parseEffect('react', "server: 'wss://x.fr/ws', stage: true").fixed, { server: 'wss://x.fr/ws', stage: true })
    assert.deepEqual(parseEffect('react', "direction: down-left, gravity: -1.5").fixed, { direction: 'down-left', gravity: -1.5 })
  })

  it('*follow(lead: $mene) : qui mène envoie sa position au défilement ; qui suit la reçoit ; `lead` se bascule sans reposer l\'effet', async () => {
    const sock = fauxSocket()
    const z = await monter('mjs-fx-suivre', '.z')
    assert.deepEqual(sock.salons, ['follow:/'])
    z.dispatchEvent(new window.Event('scroll'))
    await attendre(() => sock.envoyes.some((e: any) => e[0] === 'follow:at'))
    const at = sock.envoyes.find((e: any) => e[0] === 'follow:at')[1]
    assert.equal(at.room, '/')
    assert.ok(Array.isArray(at.a) && typeof at.y === 'number', JSON.stringify(at))
    // devenu public : il n'envoie plus, il suit
    z.getRootNode().querySelector('.m').click()
    await new Promise((r) => setTimeout(r, 30))
    sock.envoyes.length = 0
    z.dispatchEvent(new window.Event('scroll'))
    await new Promise((r) => setTimeout(r, 120))
    assert.deepEqual(sock.envoyes, [], 'le public n\'envoie rien')
    assert.deepEqual(sock.salons, ['follow:/'], 'le même salon, l\'effet n\'a pas été reposé')
  })

  it('*follow chez qui mène : le haut de sa zone tombe entre deux balises (leur marge) — la position part sur la suivante, un peu au-dessus d\'elle', async () => {
    const sock = fauxSocket()
    const z = await monter('mjs-fx-suivre', '.z')
    const [un, deux] = Array.from(z.querySelectorAll('section') as ArrayLike<any>)
    const boite = (top: number, h: number) => () => ({ left: 0, right: 300, width: 300, top, bottom: top + h, height: h, x: 0, y: top })
    mesurer(window, z, boite(100, 200))
    mesurer(window, un, boite(20, 72))
    mesurer(window, deux, boite(104, 76))
    const racine = z.getRootNode()
    const avant = racine.elementFromPoint
    // sous le haut de la zone : la zone elle-même (l'espace entre les deux parties)
    racine.elementFromPoint = () => z
    try {
      sock.envoyes.length = 0
      z.dispatchEvent(new window.Event('scroll'))
      await attendre(() => sock.envoyes.some((e: any) => e[0] === 'follow:at'))
      const at = sock.envoyes.filter((e: any) => e[0] === 'follow:at').pop()[1]
      assert.equal(JSON.stringify(at.a), JSON.stringify([Array.prototype.indexOf.call(z.childNodes, deux)]), 'la partie qui suit l\'espace : ' + JSON.stringify(at))
      assert.equal(at.y, -0.0526, 'le haut de la zone, 4 px au-dessus d\'elle (76 px de haut)')
      // une balise fixe par-dessus le haut (un en-tête) ne compte pas
      un.style.position = 'fixed'
      racine.elementFromPoint = () => un
      sock.envoyes.length = 0
      z.dispatchEvent(new window.Event('scroll'))
      await attendre(() => sock.envoyes.some((e: any) => e[0] === 'follow:at'))
      const at2 = sock.envoyes.filter((e: any) => e[0] === 'follow:at').pop()[1]
      assert.equal(JSON.stringify(at2.a), JSON.stringify(at.a), 'pas l\'en-tête fixe : ' + JSON.stringify(at2))
    }
    finally {
      racine.elementFromPoint = avant
    }
  })

  it('*follow sans connexion (@sock vide) : rien ne suit, une erreur en console le dit', async () => {
    const erreurs: string[] = []
    const avant = window.µ.error
    window.µ.error = (...a: any[]) => { erreurs.push(a.join(' ')) }
    const eclaires: any[] = []
    const anim = Object.getOwnPropertyDescriptor(window.Element.prototype, 'animate')
    window.Element.prototype.animate = function (this: any) { eclaires.push(this); return { finished: Promise.resolve(), cancel() {} } }
    try {
      sansConnexion()
      const a = await monter('mjs-fx-suivre-local', '.a')
      a.dispatchEvent(new window.Event('scroll'))
      await attendre(() => erreurs.length >= 2, 1000)
      assert.equal(eclaires.length, 0, 'rien ne suit')
      assert.ok(erreurs.some((e) => /\*follow/.test(e) && /µsocket/.test(e) && /followPackage/.test(e)), JSON.stringify(erreurs))
    }
    finally {
      window.µ.error = avant
      if (anim) Object.defineProperty(window.Element.prototype, 'animate', anim)
      else delete window.Element.prototype.animate
    }
  })

  it('*follow(sock: $$sock) : la connexion d\'un store — vide, il le dit ; remplie plus tard, il s\'y branche ; retiré, il la rend sans la fermer', async () => {
    const erreurs: string[] = []
    const avant   = window.µ.error
    const avantWs = window.WebSocket
    window.µ.error = (...a: any[]) => { erreurs.push(a.join(' ')) }
    // un WebSocket qui ne sort pas : la connexion de l'appli reste en route
    window.WebSocket = class { readyState = 0; send() {} close() {} }
    try {
      sansConnexion()
      window.µ.socket = vraiSocket
      // une autre connexion de l'appli, ouverte avant : ce n'est pas la sienne
      const autre = window.µ.socket('wss://autre.fr/ws')
      const m = await monter('mjs-fx-suivre-store', '.m')
      await attendre(() => erreurs.length > 0, 1000)
      assert.ok(!autre._mjs_rooms['follow:/'], 'pas la connexion d\'à côté')
      assert.ok(erreurs.some((e) => /\*follow/.test(e) && /µsocket/.test(e)), 'le store vide : il le dit — ' + JSON.stringify(erreurs))
      // l'appli ouvre sa connexion et la range dans le store : l'effet s'y branche
      const sock = window.µ.socket('wss://appli.fr/ws')
      window.µ.store.sock = sock
      await attendre(() => !!sock._mjs_rooms['follow:/'])
      assert.ok(sock._mjs_rooms['follow:/'], 'le salon de la page, sur la connexion du store')
      assert.equal(sock._mjs_refs, 1, 'l\'effet s\'en sert sans la retenir : elle reste à l\'appli')
      assert.equal(sock._mjs_fxDrops.length, 1)
      m.remove()
      window.document.body.innerHTML = ''
      await attendre(() => sock._mjs_fxDrops.length === 0)
      assert.equal(sock._mjs_fxDrops.length, 0, 'l\'effet parti, il s\'en détache')
      assert.equal(sock._mjs_destroyed, false, 'sans la fermer : elle est à l\'appli')
      sock.destroy()
      autre.destroy()
      window.µ.store.sock = null
    }
    finally {
      window.µ.error = avant
      window.WebSocket = avantWs
    }
  })

  it('*follow sans sock : la connexion de @sock, pas la première que l\'appli a ouverte', async () => {
    const avantWs = window.WebSocket
    window.WebSocket = class { readyState = 0; send() {} close() {} }
    try {
      window.µ._mjs_sockets = {}
      window.µ.socket = vraiSocket
      const a = window.µ.socket('wss://a.fr/ws')
      await monter('mjs-fx-suivre-b', '.m')
      const b = window.µ._mjs_sockets['wss://b.fr/ws']
      await attendre(() => !!b?._mjs_rooms['follow:/'])
      assert.ok(b._mjs_rooms['follow:/'], 'le salon, sur la connexion de @sock')
      assert.ok(!a._mjs_rooms['follow:/'], 'pas sur la première ouverte')
      window.document.body.innerHTML = ''
      a.destroy()
      b.destroy()
    }
    finally {
      window.WebSocket = avantWs
    }
  })

  it('deux effets sur la même connexion et le même salon : l\'un retiré, l\'autre y reste ; le salon n\'est quitté qu\'au départ du dernier', async () => {
    const avantWs = window.WebSocket
    window.WebSocket = class { readyState = 0; send() {} close() {} }
    try {
      window.µ._mjs_sockets = {}
      window.µ.socket = vraiSocket
      const sock = window.µ.socket('wss://appli2.fr/ws')
      const a = await monter('mjs-fx-suivre-deux', '.a')
      await attendre(() => !!a.getRootNode().querySelector('.b'))
      assert.ok(sock._mjs_rooms['follow:/'], 'les deux zones dans le salon de la page')
      a.getRootNode().querySelector('.k').click()
      await attendre(() => !a.getRootNode().querySelector('.b'))
      await new Promise((r) => setTimeout(r, 30))
      assert.ok(sock._mjs_rooms['follow:/'], 'la zone qui reste est toujours dans le salon')
      window.document.body.innerHTML = ''
      await attendre(() => !sock._mjs_rooms['follow:/'])
      assert.ok(!sock._mjs_rooms['follow:/'], 'la dernière partie, le salon est quitté')
      assert.equal(sock._mjs_destroyed, false, 'la connexion reste à l\'appli')
      sock.destroy()
    }
    finally {
      window.WebSocket = avantWs
    }
  })

  it('*follow sans réglage : tout est montré — la souris et ses clics, la balise active, la sélection', async () => {
    const sock = fauxSocket()
    const m = await monter('mjs-fx-suivre-auto', '.m')
    assert.deepEqual(sock.salons, ['follow:/'], 'la connexion de l\'appli, sans adresse écrite')
    const cible = m.querySelector('.b')
    const avant = window.document.elementFromPoint
    window.document.elementFromPoint = () => cible
    try {
      window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }))
      window.document.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }))
      await attendre(() => sock.envoyes.some((e: any) => e[0] === 'follow:cursor' && e[1].c === 1 && e[1].p))
      assert.ok(sock.envoyes.some((e: any) => e[0] === 'follow:cursor' && e[1].c === 1 && e[1].p), 'la souris et son clic (cursor: pulse)')
      cible.focus()
      await attendre(() => sock.envoyes.some((e: any) => e[0] === 'follow:cursor' && Array.isArray(e[1].f)))
      assert.ok(sock.envoyes.some((e: any) => e[0] === 'follow:cursor' && Array.isArray(e[1].f)), 'la balise active (focus)')
      const champ = m.querySelector('.i')
      champ.focus()
      champ.setSelectionRange(1, 4)
      champ.dispatchEvent(new window.Event('keyup', { bubbles: true, composed: true }))
      await attendre(() => sock.envoyes.some((e: any) => e[0] === 'follow:cursor' && e[1].t))
      assert.ok(sock.envoyes.some((e: any) => e[0] === 'follow:cursor' && e[1].t), 'la sélection (selection)')
    }
    finally {
      window.document.elementFromPoint = avant
    }
  })

  it('*follow chez qui suit : celui qui mène quitte le salon (sa présence) — sa souris s\'efface', async () => {
    const sock = fauxSocket()
    await monter('mjs-fx-suivre-tout', '.s')
    sock.recoit('follow:cursor', { room: '/', p: { a: [0, 0], x: 0.5, y: 0.5 }, t: null, f: null, c: 0, from: { id: '7', name: 'Prof' } })
    await attendre(() => !!window.document.querySelector('[mjs-fx-cursor]'))
    assert.ok(window.document.querySelector('[mjs-fx-cursor]'), 'sa souris')
    delete sock.presents['7']
    await attendre(() => !window.document.querySelector('[mjs-fx-cursor]'), 2500)
    assertAbsent(window.document.querySelector('[mjs-fx-cursor]'), 'parti : sa souris s\'en va')
  })

  it('chaque effet en direct dit à sa connexion quel paquet il attend du serveur (le message, s\'il manque)', async () => {
    const sock = fauxSocket()
    await monter('mjs-fx-direct-auto', '.r')
    await attendre(() => !!sock._mjs_fxPackages?.['reactions:'])
    assert.deepEqual(Object.keys(sock._mjs_fxPackages).sort(), ['heatmap:', 'reactions:'])
    assert.equal(sock._mjs_fxPackages['heatmap:'].paquet, 'heatmapPackage')
    const sock2 = fauxSocket()
    await monter('mjs-fx-suivre-auto', '.m')
    assert.equal(sock2._mjs_fxPackages?.['follow:']?.paquet, 'followPackage')
    const sock3 = fauxSocket()
    await monter('mjs-fx-curseurs', '.c')
    assert.equal(sock3._mjs_fxPackages?.['cursors:']?.paquet, 'cursorsPackage')
  })

  it('*cursors(max) : au plus max curseurs à l\'écran (20 par défaut) — un nouveau prend la place de celui qui a bougé le moins récemment ; positions une à une ou regroupées par le serveur ; une variable le change', async () => {
    const sock = fauxSocket()
    const c = await monter('mjs-fx-curseurs-max', '.c')
    await attendre(() => sock.requetes.some((r: any) => r[0] === 'cursors:me'))
    assert.equal(JSON.stringify(sock.requetes.find((r: any) => r[0] === 'cursors:me')[1]), '{"max":2}', 'le serveur sait combien en montrer')
    const noms = () => Array.from(window.document.querySelectorAll('[mjs-fx-cursor] b') as ArrayLike<any>).map((b: any) => b.textContent).sort()
    const ici  = { a: [0, 0], x: 0.5, y: 0.5 }
    const bouge = (id: string, name: string) => sock.recoit('cursors:move', { room: '/', p: ici, t: null, f: null, c: 0, from: { id, name } })
    bouge('7', 'Ana')
    bouge('9', 'Bob')
    bouge('bot', 'Cid')
    await attendre(() => noms().length === 2 && noms().includes('Cid'))
    assert.deepEqual(noms(), ['Bob', 'Cid'], 'Ana, qui a bougé le moins récemment, laisse sa place')
    sock.recoit('cursors:moves', { room: '/', list: [{ room: '/', p: ici, t: null, f: null, c: 0, from: { id: '7', name: 'Ana' } }] })
    await attendre(() => noms().includes('Ana'))
    assert.deepEqual(noms(), ['Ana', 'Cid'], 'regroupées par le serveur : même règle')
    c.getRootNode().querySelector('.m3').click()
    await new Promise((r) => setTimeout(r, 30))
    bouge('9', 'Bob')
    await attendre(() => noms().length === 3)
    assert.deepEqual(noms(), ['Ana', 'Bob', 'Cid'], 'max passe à 3 : trois curseurs')
  })

  it('*cursors : la souris d\'un autre glisse d\'une position à la suivante au rythme de la part des effets — 250 ms à 4 par seconde, 100 ms à 10', async () => {
    fauxSocket()
    const glisse = () => window.document.querySelector('[mjs-fx-cursors-layer]')?.style.getPropertyValue('--mjs-fx-cursor-glide')
    await monter('mjs-fx-curseurs', '.c')
    assert.equal(glisse(), '250ms')
    window.document.body.innerHTML = ''
    window.µ._fxConf = { rate: 10 }
    try {
      await monter('mjs-fx-curseurs', '.c')
      assert.equal(glisse(), '100ms')
    }
    finally {
      window.µ._fxConf = undefined
      window.document.body.innerHTML = ''
    }
  })

  it('*cursors : le salon par défaut est la page et sa route (`#/…` du routeur), sans ancre ni requête', async () => {
    const sock = fauxSocket()
    window.history.replaceState({}, '', '/cours#/lecon/3?onglet=code')
    try {
      await monter('mjs-fx-curseurs', '.c')
      assert.deepEqual(sock.salons, ['cursors:/cours#/lecon/3'])
    }
    finally {
      window.history.replaceState({}, '', '/')
    }
  })

  it('*follow : cursor (none, normal, pulse), selection et focus ; show n\'existe plus', () => {
    assert.equal(JSON.stringify(parseEffect('follow', "server: 'wss://x.fr/ws', cursor: pulse, selection: true, focus: true").fixed), JSON.stringify({ server: 'wss://x.fr/ws', cursor: 'pulse', selection: true, focus: true }))
    assert.equal(parseEffect('follow', "cursor: normal").fixed.cursor, 'normal')
    assert.equal(JSON.stringify(parseEffect('follow', "cursor: none, selection: false, focus: false").fixed), JSON.stringify({ cursor: 'none', selection: false, focus: false }))
    assert.throws(() => parseEffect('follow', "server: 'wss://x.fr/ws', show: both"), /show/)
    assert.throws(() => parseEffect('follow', "cursor: blink"), /cursor/)
  })

  it('*cursors : les mêmes réglages que *follow — cursor (none, normal, pulse), selection, focus ; show n\'existe plus', () => {
    assert.equal(JSON.stringify(parseEffect('cursors', "cursor: normal, selection: false, focus: true, room: doc").fixed), JSON.stringify({ cursor: 'normal', selection: false, focus: true, room: 'doc' }))
    assert.equal(parseEffect('cursors', "server: 'wss://x.fr/ws'").fixed.server, 'wss://x.fr/ws', 'une autre connexion que celle de l\'appli, si on veut')
    assert.throws(() => parseEffect('cursors', "show: both"), /show/)
    assert.throws(() => parseEffect('cursors', "cursor: blink"), /cursor/)
  })

  it('*cursors sans réglage : la connexion de l\'appli, tout montré — la souris et ses clics, la balise active partent ; chez les autres, l\'onde et l\'anneau', async () => {
    const sock = fauxSocket()
    const c = await monter('mjs-fx-curseurs', '.c')
    assert.deepEqual(sock.salons, ['cursors:/'], 'le salon de la page, sur la connexion de l\'appli')
    const cible = c.querySelector('.b')
    const avant = window.document.elementFromPoint
    window.document.elementFromPoint = () => cible
    try {
      window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }))
      window.document.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }))
      await attendre(() => sock.envoyes.some((e: any) => e[0] === 'cursors:move' && e[1].c === 1 && e[1].p))
      assert.ok(sock.envoyes.some((e: any) => e[0] === 'cursors:move' && e[1].c === 1 && e[1].p), 'la souris et son clic')
      cible.focus()
      await attendre(() => sock.envoyes.some((e: any) => e[0] === 'cursors:move' && Array.isArray(e[1].f)))
      assert.ok(sock.envoyes.some((e: any) => e[0] === 'cursors:move' && Array.isArray(e[1].f)), 'la balise active')
      // un autre visiteur : sa balise active s'entoure, son clic bat
      mesurer(window, cible, () => ({ left: 40, top: 60, right: 120, bottom: 90, width: 80, height: 30, x: 40, y: 60 }))
      const de = { id: '9', name: 'Zora' }
      sock.recoit('cursors:move', { room: '/', p: { a: [0, 0], x: 0.5, y: 0.5 }, t: null, f: [0, 0], c: 3, from: de })
      await attendre(() => !!window.document.querySelector('[mjs-fx-cursor-focus]'))
      assert.ok(window.document.querySelector('[mjs-fx-cursor-focus]'), 'l\'anneau autour de sa balise active')
      sock.recoit('cursors:move', { room: '/', p: { a: [0, 0], x: 0.5, y: 0.5 }, t: null, f: [0, 0], c: 4, from: de })
      await attendre(() => !!window.document.querySelector('[mjs-fx-cursor-pulse]'))
      assert.ok(window.document.querySelector('[mjs-fx-cursor-pulse]'), 'son clic bat')
    }
    finally {
      window.document.elementFromPoint = avant
    }
  })

  it('*cursors(cursor: $c, selection: false, focus: false) : rien que ce qu\'on demande ; une variable change ce qu\'on montre, sans reposer l\'effet', async () => {
    const sock = fauxSocket()
    const c = await monter('mjs-fx-curseurs-regle', '.c')
    const cible = c.querySelector('section')
    const avant = window.document.elementFromPoint
    window.document.elementFromPoint = () => cible
    try {
      window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }))
      await new Promise((r) => setTimeout(r, 40))
      assert.equal(sock.envoyes.filter((e: any) => e[0] === 'cursors:move').length, 0, 'cursor: none — la souris ne part pas')
      c.getRootNode().querySelector('.k').click()
      await new Promise((r) => setTimeout(r, 30))
      window.document.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }))
      await attendre(() => sock.envoyes.some((e: any) => e[0] === 'cursors:move' && e[1].c === 1))
      assert.ok(sock.envoyes.some((e: any) => e[0] === 'cursors:move' && e[1].c === 1), 'cursor: pulse — la souris et le clic partent')
      assert.equal(JSON.stringify(sock.salons), JSON.stringify(['cursors:/']), 'le même salon, l\'effet n\'a pas été reposé')
    }
    finally {
      window.document.elementFromPoint = avant
    }
  })

  it('*follow(cursor: normal, selection: false, focus: false) : la souris de celui qui mène part avec sa position ; chez qui suit, elle s\'affiche avec son nom — dans un seul sens ; ni sélection, ni balise active, ni onde', async () => {
    const sock = fauxSocket()
    const m = await monter('mjs-fx-suivre-curseur', '.m')
    const cible = m.querySelector('section')
    const avant = window.document.elementFromPoint
    window.document.elementFromPoint = () => cible
    try {
      // un texte choisi dans un champ : sans `selection` ni `focus`, il reste chez qui mène
      const champ = m.querySelector('.i')
      champ.focus()
      champ.setSelectionRange(1, 4)
      champ.dispatchEvent(new window.Event('keyup', { bubbles: true, composed: true }))
      window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }))
      window.document.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }))
      await attendre(() => sock.envoyes.some((e: any) => e[0] === 'follow:cursor'))
      await new Promise((r) => setTimeout(r, 30))
      const partis = sock.envoyes.filter((e: any) => e[0] === 'follow:cursor').map((e: any) => e[1])
      const envoi  = partis[partis.length - 1]
      assert.equal(envoi.room, '/')
      assert.ok(envoi.p && Array.isArray(envoi.p.a), JSON.stringify(envoi))
      assert.ok(partis.every((x: any) => !x.t && !x.f && !x.c), 'ni sélection, ni balise active, ni clic compté : ' + JSON.stringify(partis))
      sock.recoit('follow:cursor', { room: '/', p: { a: [0], x: 0.5, y: 0.5 }, t: null, f: null, c: 1, from: { id: '7', name: 'Prof' } })
      sock.recoit('follow:cursor', { room: '/', p: { a: [0], x: 0.5, y: 0.5 }, t: null, f: null, c: 2, from: { id: '7', name: 'Prof' } })
      await attendre(() => !!window.document.querySelector('[mjs-fx-cursor]'))
      await new Promise((r) => setTimeout(r, 40))
      const curseurs = Array.from(window.document.querySelectorAll('[mjs-fx-cursor]') as ArrayLike<any>)
      assert.equal(curseurs.length, 1, 'une seule souris dessinée : chez qui suit, pas chez qui mène')
      assert.equal(curseurs[0].textContent, 'Prof')
      assertAbsent(window.document.querySelector('[mjs-fx-cursor-pulse]'), 'cursor: normal ne bat pas au clic')
    }
    finally {
      window.document.elementFromPoint = avant
    }
  })

  it('*follow(cursor: pulse) : un clic de celui qui mène est compté et part avec sa souris ; chez qui suit, une onde bat là où il a cliqué', async () => {
    const sock = fauxSocket()
    const m = await monter('mjs-fx-suivre-tout', '.m')
    const cible = m.querySelector('.b')
    const avant = window.document.elementFromPoint
    window.document.elementFromPoint = () => cible
    try {
      window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }))
      await attendre(() => sock.envoyes.some((e: any) => e[0] === 'follow:cursor' && e[1].p))
      window.document.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 10 }))
      await attendre(() => sock.envoyes.some((e: any) => e[0] === 'follow:cursor' && e[1].c === 1))
      const clic = sock.envoyes.filter((e: any) => e[0] === 'follow:cursor' && e[1].c === 1).pop()[1]
      assert.ok(clic.p && Array.isArray(clic.p.a), 'avec la place de la souris : ' + JSON.stringify(clic))
      // chez qui suit : le premier message note le compte (des clics d'avant son arrivée), le suivant qui le fait monter bat
      const de = { id: '7', name: 'Prof' }
      const p  = { a: [0, 0], x: 0.5, y: 0.5 }
      const ondes = () => window.document.querySelectorAll('[mjs-fx-cursor-pulse]').length
      sock.recoit('follow:cursor', { room: '/', p, t: null, f: null, c: 4, from: de })
      await attendre(() => !!window.document.querySelector('[mjs-fx-cursor]'))
      await new Promise((r) => setTimeout(r, 40))
      assert.equal(ondes(), 0, 'les clics d\'avant son arrivée ne battent pas')
      sock.recoit('follow:cursor', { room: '/', p, t: null, f: null, c: 5, from: de })
      await attendre(() => ondes() > 0)
      assert.equal(ondes(), 1, 'une onde pour un clic')
      sock.recoit('follow:cursor', { room: '/', p: { a: [0, 0], x: 0.6, y: 0.5 }, t: null, f: null, c: 5, from: de })
      await new Promise((r) => setTimeout(r, 40))
      assert.equal(ondes(), 1, 'la souris qui bouge ne bat pas')
      await attendre(() => ondes() === 0, 2000)
      assert.equal(ondes(), 0, 'l\'onde s\'en va')
    }
    finally {
      window.document.elementFromPoint = avant
    }
  })

  it('*follow(cursor: $c) : une variable change ce qu\'on montre, sans reposer l\'effet (même salon)', async () => {
    const sock = fauxSocket()
    const z = await monter('mjs-fx-suivre-regle', '.z')
    const cible = z.querySelector('section')
    const avant = window.document.elementFromPoint
    window.document.elementFromPoint = () => cible
    try {
      window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }))
      await new Promise((r) => setTimeout(r, 40))
      assert.equal(sock.envoyes.filter((e: any) => e[0] === 'follow:cursor').length, 0, 'cursor: none — la souris ne part pas')
      z.getRootNode().querySelector('.c').click()
      await new Promise((r) => setTimeout(r, 30))
      window.document.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }))
      await attendre(() => sock.envoyes.some((e: any) => e[0] === 'follow:cursor' && e[1].c === 1))
      assert.ok(sock.envoyes.some((e: any) => e[0] === 'follow:cursor' && e[1].c === 1), 'cursor: pulse — la souris et le clic partent')
      assert.equal(JSON.stringify(sock.salons), JSON.stringify(['follow:/']), 'le même salon, l\'effet n\'a pas été reposé')
    }
    finally {
      window.document.elementFromPoint = avant
    }
  })

  it('*follow(focus: true) : la balise active de celui qui mène part avec sa place ; chez qui suit, la même balise s\'entoure', async () => {
    const sock = fauxSocket()
    const m = await monter('mjs-fx-suivre-tout', '.m')
    const s = m.getRootNode().querySelector('.s')
    m.querySelector('.b').focus()
    await attendre(() => sock.envoyes.some((e: any) => e[0] === 'follow:cursor' && Array.isArray(e[1].f)))
    const envoi = sock.envoyes.filter((e: any) => e[0] === 'follow:cursor' && Array.isArray(e[1].f)).pop()[1]
    assert.equal(JSON.stringify(envoi.f), '[0,0]', 'le bouton : premier enfant de la première partie de la zone')
    // happy-dom ne met rien en page : la boîte du bouton de qui suit est donnée
    const b = s.querySelector('.b')
    mesurer(window, b, () => ({ left: 40, top: 60, right: 120, bottom: 90, width: 80, height: 30, x: 40, y: 60 }))
    sock.recoit('follow:cursor', { room: '/', p: null, t: null, f: [0, 0], c: 0, from: { id: '7', name: 'Prof' } })
    await attendre(() => !!window.document.querySelector('[mjs-fx-cursor-focus]'))
    const anneau = window.document.querySelector('[mjs-fx-cursor-focus]')
    assert.ok(anneau, 'la balise entourée')
    assert.equal(anneau.style.left, '37px', 'autour du bouton, un peu en dehors')
    assert.equal(anneau.style.width, '86px')
    // la balise active change de place (plus rien) : l'anneau s'en va
    sock.recoit('follow:cursor', { room: '/', p: null, t: null, f: null, c: 0, from: { id: '7', name: 'Prof' } })
    await attendre(() => !window.document.querySelector('[mjs-fx-cursor-focus]'))
    assertAbsent(window.document.querySelector('[mjs-fx-cursor-focus]'), 'plus de balise active, plus d\'anneau')
  })

  it('*follow chez qui suit : sa zone défile dans un composant — la souris et l\'anneau de la balise active suivent le contenu', async () => {
    const sock = fauxSocket()
    const m = await monter('mjs-fx-suivre-tout', '.m')
    const s = m.getRootNode().querySelector('.s')
    const b = s.querySelector('.b')
    let haut = 60
    mesurer(window, b, () => ({ left: 40, top: haut, right: 120, bottom: haut + 30, width: 80, height: 30, x: 40, y: haut }))
    sock.recoit('follow:cursor', { room: '/', p: { a: [0, 0], x: 0.5, y: 0.5 }, t: null, f: [0, 0], c: 0, from: { id: '7', name: 'Prof' } })
    const anneau = () => window.document.querySelector('[mjs-fx-cursor-focus]')
    await attendre(() => !!anneau())
    assert.equal(anneau().style.top, '57px')
    // la zone défile (un défilement ne sort pas du composant) : le bouton est monté de 40 px
    haut = 20
    s.dispatchEvent(new window.Event('scroll'))
    await attendre(() => anneau()?.style.top === '17px')
    assert.equal(anneau().style.top, '17px', 'l\'anneau a suivi le bouton')
    assert.match(window.document.querySelector('[mjs-fx-cursor]').style.transform, /translate\(80px,\s*35px\)/, 'la souris aussi')
  })

  it('*follow chez qui mène : sa zone défile sous une souris immobile — la souris repart, sur ce qu\'elle montre maintenant', async () => {
    const sock = fauxSocket()
    const m = await monter('mjs-fx-suivre-tout', '.m')
    const avant = window.document.elementFromPoint
    let sous = m.querySelector('.b')
    window.document.elementFromPoint = () => sous
    try {
      window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }))
      await attendre(() => sock.envoyes.some((e: any) => e[0] === 'follow:cursor' && e[1].p))
      sous = m.querySelector('.i')
      sock.envoyes.length = 0
      m.dispatchEvent(new window.Event('scroll'))
      await attendre(() => sock.envoyes.some((e: any) => e[0] === 'follow:cursor' && e[1].p))
      const envoi = sock.envoyes.filter((e: any) => e[0] === 'follow:cursor').pop()
      assert.ok(envoi, 'la souris repart au défilement')
      assert.equal(JSON.stringify(envoi[1].p.a), '[0,1]', 'sur le champ, maintenant sous la souris')
    }
    finally {
      window.document.elementFromPoint = avant
    }
  })

  it('*follow(selection: true) : ce que celui qui mène sélectionne part (ici, dans un champ) ; chez qui suit, son curseur de texte s\'affiche avec son nom', async () => {
    const sock = fauxSocket()
    const m = await monter('mjs-fx-suivre-tout', '.m')
    const champ = m.querySelector('.i')
    champ.focus()
    champ.setSelectionRange(2, 5)
    champ.dispatchEvent(new window.Event('keyup', { bubbles: true, composed: true }))
    await attendre(() => sock.envoyes.some((e: any) => e[0] === 'follow:cursor' && e[1].t))
    const envoi = sock.envoyes.filter((e: any) => e[0] === 'follow:cursor' && e[1].t).pop()[1]
    assert.equal(envoi.t.k, 'f', 'un champ')
    assert.deepEqual([envoi.t.s, envoi.t.e], [2, 5], 'la sélection dans le champ')
    sock.recoit('follow:cursor', { room: '/', p: null, t: envoi.t, f: null, c: 0, from: { id: '7', name: 'Prof' } })
    await attendre(() => !!window.document.querySelector('[mjs-fx-cursor-caret]'))
    assert.equal(window.document.querySelector('[mjs-fx-cursor-caret]').textContent, 'Prof')
  })

  it('*heatmap sur <@document> : un clic part avec l\'adresse de la page (sa route, sans requête ni ancre) et sa place dans la page ; rien d\'autre', async () => {
    const sock = fauxSocket()
    const c = await monter('mjs-fx-clics', '.c')
    window.history.replaceState({}, '', '/tarifs?email=a@b.fr#/offre/2?x=1')
    try {
      c.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true, clientX: 10, clientY: 20 }))
    }
    finally {
      window.history.replaceState({}, '', '/')
    }
    await attendre(() => sock.envoyes.some((e: any) => e[0] === 'heatmap:point'))
    const clic = sock.envoyes.find((e: any) => e[0] === 'heatmap:point')[1]
    assert.equal(clic.url, 'http://localhost/tarifs#/offre/2')
    assert.deepEqual(Object.keys(clic).sort(), ['ev', 'url', 'z'])
    assert.equal(clic.ev, 'click')
    assert.equal(clic.z[0][0], 'document')
    assert.equal(clic.z[0].length, 5)
  })

  it('*heatmap(on: mousemove) : l\'événement choisi part, dix fois par seconde au plus, avec son nom', async () => {
    const sock = fauxSocket()
    const m = await monter('mjs-fx-chaleur-serveur', '.m')
    m.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, composed: true, clientX: 5, clientY: 5 }))
    m.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, composed: true, clientX: 6, clientY: 6 }))
    m.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true, clientX: 6, clientY: 6 }))
    await new Promise((r) => setTimeout(r, 30))
    const partis = sock.envoyes.filter((e: any) => e[0] === 'heatmap:point').map((e: any) => e[1])
    assert.equal(partis.length, 1, 'deux mouvements dans le même dixième de seconde : un seul point ; le clic ne compte pas ici')
    assert.equal(partis[0].ev, 'mousemove')
    assert.equal(partis[0].z[0][0], 'carte')
  })

  it('*heatmap : ses points ne partent jamais en file hors ligne (volatiles), et attendent la part des effets en direct — plusieurs partent d\'un trait, aucun n\'est jeté', async () => {
    const sock = fauxSocket()
    sock.state = 'open'
    sock._mjs_fxToken = () => false
    const m = await monter('mjs-fx-chaleur-serveur', '.m')
    m.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, composed: true, clientX: 5, clientY: 5 }))
    await new Promise((r) => setTimeout(r, 130))
    m.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, composed: true, clientX: 6, clientY: 6 }))
    assert.equal(sock.envoyes.filter((e: any) => e[0] === 'heatmap:point').length, 0, 'la part est épuisée : rien ne part encore')
    sock._mjs_fxToken = () => true
    await attendre(() => sock.envoyes.some((e: any) => e[0] === 'heatmap:point'))
    const partis = sock.envoyes.filter((e: any) => e[0] === 'heatmap:point')
    assert.equal(partis.length, 1, 'une seule trame')
    assert.equal(partis[0][1].pts.length, 2, 'qui porte les deux points')
    assert.equal(partis[0][2].volatile, true, 'jamais en file hors ligne')
  })

  it('*heatmap(show) : true dessine tous les points, en direct ; un nombre, les plus récents — une variable le change sur place ; sans server, la connexion de @sock', async () => {
    fauxSocket()
    const h = await monter('mjs-fx-chaleur', '.h')
    const root = h.getRootNode()
    const k = root.querySelector('.k')
    const auto = root.querySelector('.auto')
    for (const x of [4, 8, 12, 16]) {
      h.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, composed: true, clientX: x, clientY: x }))
      k.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, composed: true, clientX: x, clientY: x }))
      auto.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, composed: true, clientX: x, clientY: x }))
      await new Promise((r) => setTimeout(r, 110))
    }
    assert.equal(h.querySelector('[mjs-fx-heatmap-layer]').getAttribute('mjs-fx-heatmap-n'), '4', 'show: true — tous')
    const calque = k.querySelector('[mjs-fx-heatmap-layer]')
    assert.equal(calque.getAttribute('mjs-fx-heatmap-n'), '2', 'show: 2 — les deux plus récents')
    root.querySelector('.plus').click()
    await attendre(() => calque.getAttribute('mjs-fx-heatmap-n') === '3')
    assert.equal(calque.getAttribute('mjs-fx-heatmap-n'), '3', 'la variable passe à 3 : le calque suit')
    assert.ok(k.querySelector('[mjs-fx-heatmap-layer]') === calque, 'le même calque, pas reposé')
    assert.equal(auto.querySelector('[mjs-fx-heatmap-layer]')?.getAttribute('mjs-fx-heatmap-n'), '4', 'sans server : la connexion de @sock sert')
  })

  it('*heatmap sans connexion (@sock vide) : rien ne part ni ne se dessine, une erreur en console le dit', async () => {
    const erreurs: string[] = []
    const avant = window.µ.error
    window.µ.error = (...a: any[]) => { erreurs.push(a.join(' ')) }
    try {
      sansConnexion()
      const z = await monter('mjs-fx-chaleur-seule', '.sans')
      z.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true, clientX: 4, clientY: 4 }))
      await attendre(() => erreurs.length > 0, 1000)
      assertAbsent(z.querySelector('[mjs-fx-heatmap-layer]'), 'rien de dessiné')
      assert.ok(erreurs.some((e) => /\*heatmap/.test(e) && /µsocket/.test(e) && /heatmapPackage/.test(e)), JSON.stringify(erreurs))
    }
    finally {
      window.µ.error = avant
    }
  })

  // le réseau coupé, puis rétabli, tel que le voit la page
  const reseau = (en: boolean) => {
    Object.defineProperty(window.navigator, 'onLine', { get: () => en, configurable: true })
    window.dispatchEvent(new window.Event(en ? 'online' : 'offline'))
  }

  it('*offline sur <@document> : réseau coupé → un voile et un bandeau qui dit combien de changements attendent ; rétabli → tout part', async () => {
    await monter('mjs-fx-hors', 'p')
    const doc = window.document
    assertAbsent(doc.querySelector('[mjs-fx-offline-band]'), 'en ligne : rien')
    // un serveur temps réel de MJS qui garde trois messages, et une mise à jour optimiste en vol
    window.µ._mjs_sockets = { 'wss://x': { _mjs_queue: [1, 2, 3], _mjs_pendingOpenReqs: [], _mjs_wantOpen: true, state: 'reconnecting' } }
    window.µ._mjs_optPending = 1
    reseau(false)
    await attendre(() => !!doc.querySelector('[mjs-fx-offline-band][mjs-fx-offline-in]'))
    const bande = doc.querySelector('[mjs-fx-offline-band]')
    assert.ok(bande.parentNode === doc.body, 'toute la page : le bandeau dans <body>, fixé')
    assert.equal(bande.getAttribute('mjs-fx-offline-place'), 'top', 'en haut par défaut')
    assert.equal(bande.textContent, 'Hors ligne — 4 changements partiront au retour du réseau')
    assert.ok(doc.querySelector('[mjs-fx-offline-veil][mjs-fx-offline-in]'), 'la page se voile')
    window.µ._mjs_sockets = {}
    window.µ._mjs_optPending = 0
    reseau(true)
    await attendre(() => !doc.querySelector('[mjs-fx-offline-band]'), 2000)
    assertAbsent(doc.querySelector('[mjs-fx-offline-band]'), 'en ligne : le bandeau part')
    assertAbsent(doc.querySelector('[mjs-fx-offline-veil]'), 'le voile aussi')
  })

  it('*offline sur une balise, tout réglé : le bandeau à son bord, en haut, sa taille, sa couleur, son texte, son logo', async () => {
    const z = await monter('mjs-fx-hors-regle', '.z')
    window.µ._mjs_sockets = {}
    reseau(false)
    await attendre(() => !!z.querySelector('[mjs-fx-offline-band][mjs-fx-offline-in]'))
    const bande = z.querySelector('[mjs-fx-offline-band]')
    assert.equal(bande.getAttribute('mjs-fx-offline-place'), 'top')
    assert.equal(bande.textContent, '📡Pas de réseau', 'le logo, puis le texte donné ; count: false, sans le nombre')
    const vu = (k: string) => z.style.getPropertyValue('--mjs-offline-' + k)
    assert.deepEqual([vu('size'), vu('zindex'), vu('background'), vu('color'), vu('opacity'), vu('veil')], ['56px', '30', '#102030', '#ffcc00', '0.9', '0.5'])
    assert.ok(z.querySelector('[mjs-fx-offline-veil]'), 'la zone seule se voile')
    reseau(true)
    await attendre(() => !z.querySelector('[mjs-fx-offline-band]'), 2000)
  })

  it('*offline : un de plus parmi les effets de toute la page (<@document>)', () => {
    assert.deepEqual(parseEffect('offline', "'Hors ligne', place: top, fx: *fly(down), logo: '/logo.svg'").fixed, { text: 'Hors ligne', place: 'top', fx: { fx: 'fly', s: { direction: 'down' } }, logo: '/logo.svg' })
    assert.throws(() => parseEffect('offline', 'place: left'), /place/)
  })

  it('*guard : sur un champ seulement (input, textarea, select)', () => {
    assert.throws(() => checkPlacement('guard', parseEffect('guard', ''), 'p', false), /\*guard/)
    checkPlacement('guard', parseEffect('guard', ''), 'textarea', false)
    assert.deepEqual(parseEffect('guard', "text: 'De 1 à 5', fx: *attention(headshake), place: top").fixed, { text: 'De 1 à 5', fx: { fx: 'attention', s: { style: 'headshake' } }, place: 'top' })
    assert.deepEqual(parseEffect('guard', 'delay: 800ms, silent: true').fixed, { delay: '800ms', silent: true })
    assert.throws(() => parseEffect('guard', 'on: input'), /on/, 'on: input est devenu delay: 0')
  })
})
