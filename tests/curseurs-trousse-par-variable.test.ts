// *cursors et *follow : ce qu'on montre (`cursor`, `selection`, `focus`) tenu par une variable change
// sans effacer les curseurs des autres, sans oublier le compte des clics, et sans laisser un curseur
// figé chez eux quand on cesse de partager ; un champ mot de passe ne livre pas non plus sa place ;
// `*cursors(cursor: none, selection: false, focus: false)` n'installe rien (et sans trousse, rien ne lève :
// position reçue, changement de `max`, balayage des visiteurs) ; sous un harnais sans animation native
// (happy-dom), la partie montrée de *follow ne lève pas d'erreur ; une connexion qui s'ouvre ou se rouvre
// (« connecting », « reconnecting ») demande par son accueil, pas deux fois ; un meneur parti efface sa souris.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { mjsTmp } from './helpers/tmp.js'

const CORPS   = '<section><button class="b">Un</button><input class="i" aria-label="note" value="un texte"><input class="mdp" type="password" aria-label="mot de passe" value="secret"></section>'
const BOUTONS = '<button class="tc" @click={$c = \'pulse\'}>c</button><button class="ts" @click={$s = true}>s</button><button class="tf" @click={$f = true}>f</button><button class="k1" @click={$c = \'none\'}>k1</button><button class="k2" @click={$s = false}>k2</button><button class="k3" @click={$f = false}>k3</button>'

const COMPOSANTS: Record<string, string> = {
  'fx-cv-curseurs': '<script>\n$c = \'normal\'\n$s = false\n$f = false\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="c" *cursors(cursor: $c, selection: $s, focus: $f)>' + CORPS + '</div>' + BOUTONS,
  'fx-cv-curseurs-tout': '<script>\n$c = \'pulse\'\n$s = true\n$f = true\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="c" *cursors(cursor: $c, selection: $s, focus: $f)>' + CORPS + '</div>' + BOUTONS,
  'fx-cv-curseurs-defaut': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="c" *cursors>' + CORPS + '</div>',
  'fx-cv-curseurs-rien': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="c" *cursors(cursor: none, selection: false, focus: false)>' + CORPS + '</div>',
  'fx-cv-suivre': '<script>\n$c = \'normal\'\n$s = false\n$f = false\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *follow(cursor: $c, selection: $s, focus: $f)>' + CORPS + '</div>' + BOUTONS,
  'fx-cv-suivre-tout': '<script>\n$c = \'pulse\'\n$s = true\n$f = true\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *follow(lead: true, cursor: $c, selection: $s, focus: $f)>' + CORPS + '</div>' + BOUTONS,
  'fx-cv-suivre-mene': '<script>\n$c = \'normal\'\n$s = false\n$f = false\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *follow(lead: true, cursor: $c, selection: $s, focus: $f)>' + CORPS + '</div>' + BOUTONS,
  'fx-cv-suivre-bascule': '<script>\n$m = true\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *follow(lead: $m)>' + CORPS + '</div><button class="bm" @click={$m = !$m}>m</button>',
  'fx-cv-suivre-public': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *follow><section>Un</section><section>Deux</section></div>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('*cursors, *follow — ce qu\'on montre tenu par une variable', function () {
  this.timeout(60000)
  let window: any
  let pointOrigine: any

  before(async () => {
    const root   = mjsTmp('curseurs-trousse-par-variable')
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
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.documentElement.lang = 'fr'
    window.µ._mjs_sockGrace = 60
    pointOrigine = window.document.elementFromPoint
  })

  afterEach(() => { window.document.elementFromPoint = pointOrigine })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await pause(20)
    return comp._shadow.querySelector(sel)
  }

  // un serveur temps réel simulé : ce que l'effet envoie, les salons rejoints ; `recoit` joue une trame
  const fauxSocket = (etat?: string) => {
    const envoyes: any[]                 = []
    const requetes: any[]                = []
    const ecoutes: Record<string, any[]> = {}
    const salons: string[]               = []
    const s: any                         = {
      envoyes, salons, requetes,
      state: etat,
      presents: { '7': true, '9': true, bot: true } as Record<string, boolean>,
      send(type: string, p: any, o?: any) { envoyes.push([type, p, o]) },
      on(type: string, f: any) { (ecoutes[type] ||= []).push(f); return () => {} },
      room(nom: string) { salons.push(nom); return { presence: () => s.presents, leave() {} } },
      destroy() {},
      request(type: string, p: any) { requetes.push([type, p]); return Promise.resolve(type === 'follow:last' ? null : { id: 'moi', name: 'Moi' }) },
      recoit(type: string, p: any) { (ecoutes[type] || []).forEach((f) => f(p)) },
      release() {},
    }
    window.µ.socket = () => s
    window.µ._mjs_sockets = { 'wss://x.fr/ws': s }
    return s
  }

  const de       = { id: '7', name: 'Ana' }
  const ici      = { a: [0, 0], x: 0.5, y: 0.5 }
  const curseurs = () => window.document.querySelectorAll('[mjs-fx-cursor]').length
  // la souris, un clic, la balise active, le texte d'un champ : ce que fait celui qui partage
  const sous    = (cible: any) => { window.document.elementFromPoint = () => cible }
  const bouge   = () => window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }))
  const clique  = () => window.document.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }))
  const choisit = (champ: any, a: number, b: number) => {
    champ.focus()
    champ.setSelectionRange(a, b)
    champ.dispatchEvent(new window.Event('keyup', { bubbles: true, composed: true }))
  }
  const partis   = (sock: any, type: string) => sock.envoyes.filter((e: any) => e[0] === type).map((e: any) => e[1])
  const demandes = (sock: any, type: string) => sock.requetes.filter((r: any) => r[0] === type).length

  const EFFETS = [
    { nom: '*cursors', tag: 'mjs-fx-cv-curseurs', sel: '.c', recu: 'cursors:move', salon: 'cursors:/' },
    { nom: '*follow', tag: 'mjs-fx-cv-suivre', sel: '.z', recu: 'follow:cursor', salon: 'follow:/' },
  ]

  for (const e of EFFETS) {
    for (const [reglage, bouton] of [['cursor', '.tc'], ['selection', '.ts'], ['focus', '.tf']] as const) {
      it(`${e.nom} : changer \`${reglage}\` par une variable garde les curseurs des autres affichés, et l'effet reste dans son salon`, async () => {
        const sock = fauxSocket()
        const c    = await monter(e.tag, e.sel)
        sock.recoit(e.recu, { room: '/', p: ici, t: null, f: null, c: 0, from: de })
        await attendre(() => curseurs() === 1)
        assert.equal(curseurs(), 1, 'le curseur de l\'autre, avant le changement')
        c.getRootNode().querySelector(bouton).click()
        await pause(60)
        assert.equal(curseurs(), 1, 'le curseur de l\'autre est toujours là, sans qu\'il ait rebougé')
        assert.equal(window.document.querySelector('[mjs-fx-cursor] b').textContent, 'Ana')
        assert.equal(window.document.querySelectorAll('[mjs-fx-cursors-layer]').length, 1, 'un seul calque, pas un de plus ni un de moins')
        assert.deepEqual(sock.salons, [e.salon], 'l\'effet n\'a pas été reposé')
      })
    }
  }

  it('*cursors : `selection` par une variable — une fois vrai, le texte choisi dans un champ part', async () => {
    const sock = fauxSocket()
    const c    = await monter('mjs-fx-cv-curseurs', '.c')
    choisit(c.querySelector('.i'), 1, 4)
    await pause(40)
    assert.ok(partis(sock, 'cursors:move').every((x: any) => !x.t), 'selection: faux — le texte ne part pas')
    c.getRootNode().querySelector('.ts').click()
    await pause(40)
    choisit(c.querySelector('.i'), 2, 5)
    await attendre(() => partis(sock, 'cursors:move').some((x: any) => x.t))
    const t = partis(sock, 'cursors:move').filter((x: any) => x.t).pop().t
    assert.deepEqual([t.k, t.s, t.e], ['f', 2, 5], 'selection: vrai — le texte part')
    assert.deepEqual(sock.salons, ['cursors:/'])
  })

  it('*cursors : `focus` par une variable — une fois vrai, la balise active part', async () => {
    const sock = fauxSocket()
    const c    = await monter('mjs-fx-cv-curseurs', '.c')
    c.querySelector('.b').focus()
    await pause(40)
    assert.ok(partis(sock, 'cursors:move').every((x: any) => !x.f), 'focus: faux — la balise active ne part pas')
    c.querySelector('.i').focus()
    c.getRootNode().querySelector('.tf').click()
    await pause(40)
    c.querySelector('.b').focus()
    await attendre(() => partis(sock, 'cursors:move').some((x: any) => Array.isArray(x.f)))
    assert.equal(JSON.stringify(partis(sock, 'cursors:move').filter((x: any) => Array.isArray(x.f)).pop().f), '[0,0]', 'focus: vrai — la balise active part')
    assert.deepEqual(sock.salons, ['cursors:/'])
  })

  it('*follow (qui mène) : `selection` et `focus` par une variable — une fois vrais, le texte et la balise active partent', async () => {
    const sock = fauxSocket()
    const m    = await monter('mjs-fx-cv-suivre-mene', '.z')
    choisit(m.querySelector('.i'), 1, 4)
    m.querySelector('.b').focus()
    await pause(40)
    assert.ok(partis(sock, 'follow:cursor').every((x: any) => !x.t && !x.f), 'faux — ni texte ni balise active')
    m.getRootNode().querySelector('.ts').click()
    m.getRootNode().querySelector('.tf').click()
    await pause(40)
    choisit(m.querySelector('.i'), 2, 5)
    await attendre(() => partis(sock, 'follow:cursor').some((x: any) => x.t))
    m.querySelector('.b').focus()
    await attendre(() => partis(sock, 'follow:cursor').some((x: any) => Array.isArray(x.f)))
    assert.equal(partis(sock, 'follow:cursor').filter((x: any) => x.t).pop().t.s, 2, 'le texte part')
    assert.equal(JSON.stringify(partis(sock, 'follow:cursor').filter((x: any) => Array.isArray(x.f)).pop().f), '[0,0]', 'la balise active part')
    assert.deepEqual(sock.salons, ['follow:/'])
  })

  it('*cursors par défaut : le texte choisi part et celui des autres se dessine (selection est vrai sans rien écrire)', async () => {
    const sock = fauxSocket()
    const c    = await monter('mjs-fx-cv-curseurs-defaut', '.c')
    choisit(c.querySelector('.i'), 1, 4)
    await attendre(() => partis(sock, 'cursors:move').some((x: any) => x.t))
    assert.ok(partis(sock, 'cursors:move').some((x: any) => x.t && x.t.k === 'f'), 'le texte choisi part')
    sock.recoit('cursors:move', { room: '/', p: null, t: { k: 'f', a: [0, 1], s: 1, e: 4 }, f: null, c: 0, from: de })
    await attendre(() => !!window.document.querySelector('[mjs-fx-cursor-caret]'))
    assert.equal(window.document.querySelector('[mjs-fx-cursor-caret]')?.textContent, 'Ana', 'son curseur de texte se dessine')
  })

  for (const e of [
    { nom: '*cursors', tag: 'mjs-fx-cv-curseurs-tout', sel: '.c', type: 'cursors:move' },
    { nom: '*follow (qui mène)', tag: 'mjs-fx-cv-suivre-tout', sel: '.z', type: 'follow:cursor' },
  ]) {
    it(`${e.nom} : cesser de partager envoie « plus rien » — la souris, le texte et la balise active ne restent pas figés chez les autres`, async () => {
      const sock  = fauxSocket()
      const c     = await monter(e.tag, e.sel)
      const champ = c.querySelector('.i')
      sous(champ)
      bouge()
      choisit(champ, 1, 4)
      await attendre(() => partis(sock, e.type).some((x: any) => x.p && x.t && Array.isArray(x.f)))
      const plein = partis(sock, e.type).filter((x: any) => x.p && x.t && Array.isArray(x.f))
      assert.ok(plein.length > 0, 'la souris, le texte et la balise active partent : ' + JSON.stringify(partis(sock, e.type).pop()))
      const racine = c.getRootNode()
      racine.querySelector('.k1').click()
      racine.querySelector('.k2').click()
      racine.querySelector('.k3').click()
      await pause(60)
      const dernier = partis(sock, e.type).pop()
      assert.deepEqual({ p: dernier.p, t: dernier.t, f: dernier.f }, { p: null, t: null, f: null }, 'la dernière trame dit « plus rien » : ' + JSON.stringify(dernier))
    })

    it(`${e.nom} : le compte des clics est gardé quand ce qu'on montre change — le premier clic d'après compte un de plus`, async () => {
      const sock = fauxSocket()
      const c    = await monter(e.tag, e.sel)
      sous(c.querySelector('.b'))
      bouge()
      clique()
      await attendre(() => partis(sock, e.type).some((x: any) => x.c === 1))
      c.getRootNode().querySelector('.k2').click()
      await pause(60)
      clique()
      await attendre(() => partis(sock, e.type).some((x: any) => x.c >= 1 && x.c !== 1))
      assert.equal(partis(sock, e.type).pop().c, 2, 'deux clics en tout : ' + JSON.stringify(partis(sock, e.type).map((x: any) => x.c)))
    })
  }

  for (const e of [
    { nom: '*cursors', tag: 'mjs-fx-cv-curseurs-tout', sel: '.c', type: 'cursors:move' },
    { nom: '*follow (qui mène)', tag: 'mjs-fx-cv-suivre-tout', sel: '.z', type: 'follow:cursor' },
  ]) {
    it(`${e.nom} : un champ mot de passe ne livre pas non plus son chemin — la balise active qui part est nulle`, async () => {
      const sock = fauxSocket()
      const c    = await monter(e.tag, e.sel)
      c.querySelector('.i').focus()
      await attendre(() => partis(sock, e.type).some((x: any) => Array.isArray(x.f)))
      assert.ok(partis(sock, e.type).some((x: any) => Array.isArray(x.f)), 'un champ ordinaire : son chemin part')
      c.querySelector('.mdp').focus()
      await pause(60)
      assert.equal(partis(sock, e.type).pop().f, null, 'le mot de passe : aucun chemin ne part')
      assert.ok(!partis(sock, e.type).some((x: any) => x.t && x.t.k === 'f' && JSON.stringify(x.t.a) === '[0,2]'), 'ni son texte ni sa sélection')
    })
  }

  it('*follow : cesser de mener envoie « plus rien » ; le devenir efface la souris de l\'ancien meneur', async () => {
    const sock  = fauxSocket()
    const z     = await monter('mjs-fx-cv-suivre-bascule', '.z')
    const champ = z.querySelector('.i')
    sous(champ)
    bouge()
    choisit(champ, 1, 4)
    await attendre(() => partis(sock, 'follow:cursor').some((x: any) => x.p && x.t && Array.isArray(x.f)))
    assert.ok(partis(sock, 'follow:cursor').some((x: any) => x.p && x.t && Array.isArray(x.f)), 'qui mène : sa souris, son texte et sa balise active partent')
    z.getRootNode().querySelector('.bm').click()
    await pause(60)
    const dernier = partis(sock, 'follow:cursor').pop()
    assert.deepEqual({ p: dernier.p, t: dernier.t, f: dernier.f }, { p: null, t: null, f: null }, 'qui cesse de mener ne laisse rien de figé : ' + JSON.stringify(dernier))
    // qui suit : la souris de l'autre meneur ; le redevenir l'efface
    sock.recoit('follow:cursor', { room: '/', p: ici, t: null, f: null, c: 0, from: de })
    await attendre(() => curseurs() === 1)
    assert.equal(curseurs(), 1, 'qui suit voit la souris de qui mène')
    z.getRootNode().querySelector('.bm').click()
    await pause(60)
    assert.equal(curseurs(), 0, 'qui mène ne voit plus celle de l\'ancien meneur')
    assert.deepEqual(sock.salons, ['follow:/'], 'l\'effet n\'a pas été reposé')
  })

  it('*cursors(cursor: none, selection: false, focus: false) n\'installe rien : ni calque, ni écouteur', async () => {
    const sock = fauxSocket()
    const c    = await monter('mjs-fx-cv-curseurs-rien', '.c')
    assertAbsent(window.document.querySelector('[mjs-fx-cursors-layer]'), 'aucun calque posé sur la page')
    sous(c.querySelector('.b'))
    bouge()
    clique()
    c.querySelector('.b').focus()
    await pause(60)
    assert.equal(partis(sock, 'cursors:move').length, 0, 'rien ne part')
    assert.deepEqual(sock.salons, ['cursors:/'], 'le salon est rejoint : l\'effet est là, il ne montre rien')
  })

  it('*cursors : un visiteur parti (la présence du salon) voit son curseur s\'effacer', async () => {
    const sock = fauxSocket()
    await monter('mjs-fx-cv-curseurs-defaut', '.c')
    sock.recoit('cursors:move', { room: '/', p: ici, t: null, f: null, c: 0, from: de })
    await attendre(() => curseurs() === 1)
    assert.equal(curseurs(), 1, 'son curseur')
    delete sock.presents['7']
    await attendre(() => curseurs() === 0, 2500)
    assert.equal(curseurs(), 0, 'parti : son curseur s\'en va')
  })

  it('*follow : celui qui mène parti (la présence du salon) voit sa souris s\'effacer chez qui suit', async () => {
    const sock = fauxSocket()
    await monter('mjs-fx-cv-suivre-public', '.z')
    sock.recoit('follow:cursor', { room: '/', p: ici, t: null, f: null, c: 0, from: de })
    await attendre(() => curseurs() === 1)
    assert.equal(curseurs(), 1, 'sa souris')
    delete sock.presents['7']
    await attendre(() => curseurs() === 0, 2500)
    assert.equal(curseurs(), 0, 'parti : sa souris s\'en va')
  })

  it('*cursors sans rien montrer (pas de trousse) : une position reçue, une trame regroupée, un changement de `max` et le balayage des visiteurs ne lèvent rien', async () => {
    const erreurs: string[] = []
    const ecoute            = (e: any) => erreurs.push(String(e.message || e.error))
    window.addEventListener('error', ecoute)
    try {
      const sock = fauxSocket()
      const c    = await monter('mjs-fx-cv-curseurs-rien', '.c')
      assert.doesNotThrow(() => sock.recoit('cursors:move', { room: '/', p: ici, t: null, f: null, c: 0, from: de }), 'une position reçue')
      assert.doesNotThrow(() => sock.recoit('cursors:moves', { room: '/', list: [{ room: '/', p: ici, t: null, f: null, c: 0, from: de }] }), 'une trame regroupée')
      assert.doesNotThrow(() => window.µ._mjs_fxSet(c, 'cursors', { max: 3 }), 'un changement de max (une variable le tient)')
      await pause(1300)
      assert.deepEqual(erreurs, [], 'le balayage des visiteurs (une seconde) ne lève rien')
      assert.equal(curseurs(), 0, 'rien n\'est dessiné')
    }
    finally {
      window.removeEventListener('error', ecoute)
    }
  })

  // une connexion qui s'ouvre ou se rouvre : son accueil (`welcome`) demande, l'effet ne demande pas en plus tout de suite
  for (const e of [
    { nom: '*cursors', tag: 'mjs-fx-cv-curseurs-defaut', sel: '.c', demande: 'cursors:me' },
    { nom: '*follow', tag: 'mjs-fx-cv-suivre-public', sel: '.z', demande: 'follow:last' },
  ]) {
    for (const etat of ['connecting', 'reconnecting']) {
      it(`${e.nom} : la connexion est « ${etat} » — rien n'est demandé tout de suite, son accueil demande une fois`, async () => {
        const sock = fauxSocket(etat)
        await monter(e.tag, e.sel)
        assert.equal(demandes(sock, e.demande), 0, `${e.demande} demandé pendant que la connexion est « ${etat} » : ${JSON.stringify(sock.requetes)}`)
        sock.recoit('welcome', {})
        await pause(20)
        assert.equal(demandes(sock, e.demande), 1, `${e.demande} à l'accueil : ${JSON.stringify(sock.requetes)}`)
      })
    }

    it(`${e.nom} : la connexion est ouverte — une seule demande tout de suite`, async () => {
      const sock = fauxSocket('open')
      await monter(e.tag, e.sel)
      assert.equal(demandes(sock, e.demande), 1, `${e.demande} : ${JSON.stringify(sock.requetes)}`)
    })
  }

  it('*follow chez qui suit : sans animation native (harnais de test), la position reçue ne lève pas d\'erreur', async () => {
    const sock = fauxSocket()
    // le prototype des éléments est celui de toutes les fenêtres de happy-dom : `animate` y revient tel qu'il était (propre, ou absent)
    const anim = Object.getOwnPropertyDescriptor(window.Element.prototype, 'animate')
    window.Element.prototype.animate = undefined
    try {
      await monter('mjs-fx-cv-suivre-public', '.z')
      assert.doesNotThrow(() => sock.recoit('follow:at', { room: '/', a: [1], y: 0, from: de }), 'follow:at reçu sans Element.prototype.animate')
    }
    finally {
      if (anim) Object.defineProperty(window.Element.prototype, 'animate', anim)
      else delete window.Element.prototype.animate
    }
  })
})
