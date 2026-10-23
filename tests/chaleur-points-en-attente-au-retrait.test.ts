// *heatmap : les points qui attendent ne meurent pas avec l'effet. Un clic de navigation (le premier de la visite) sur une
// vue qui porte `*heatmap` : la connexion est paresseuse, elle n'est pas encore ouverte quand la navigation retire l'effet —
// le point part à l'ouverture, dans un délai borné. Quand la connexion est celle de l'effet seul (`server:`), elle reste
// ouverte le temps de l'envoyer (borné aussi), puis se ferme. Au retrait, un lot de plus de 16 000 octets part en plusieurs
// trames d'un trait. Et une connexion qui ne s'ouvre pas retente au rythme de la connexion elle-même (son recul), l'effet
// ne lui ajoute aucune tentative. Le vrai effet, la vraie connexion µ.socket, le vrai paquet heatmapPackage.

import assert from 'node:assert/strict'
import { visite, attendre, tick, element, place } from './helpers/chaleur-visite.js'

// un WebSocket qui ne s'ouvre jamais ; `crees` garde chaque connexion tentée (`closed` : fermée par l'appelant)
function muet(crees: any[]) {
  return function () {
    const ws: any = { readyState: 0, bufferedAmount: 0, closed: false, send() {}, close() { ws.closed = true; ws.readyState = 3 }, onopen: null, onclose: null, onmessage: null, onerror: null }
    crees.push(ws)
    return ws
  }
}

// un WebSocket qui échoue aussitôt (fermé en 1006 sans s'être ouvert) ; `essais.n` compte les tentatives
function echec(essais: { n: number }) {
  return function () {
    essais.n++
    const ws: any = { readyState: 0, bufferedAmount: 0, send() {}, close() {}, onopen: null, onclose: null, onmessage: null, onerror: null }
    setTimeout(() => { ws.readyState = 3; if (ws.onclose) ws.onclose({ code: 1006 }) }, 5)
    return ws
  }
}

// l'horloge avance de `ms` le temps de `fn` (la borne de l'attente s'écoule sans attendre pour de vrai)
async function horlogeAvancee(ms: number, fn: () => Promise<void>) {
  const maintenant = Date.now
  Date.now = () => maintenant() + ms
  try { await fn() }
  finally { Date.now = maintenant }
}

describe('*heatmap — le point qui attend l\'ouverture ne meurt pas avec l\'effet', function () {
  this.timeout(40000)

  it('un clic puis le retrait de l\'effet avant l\'ouverture de la connexion (un clic de navigation) : le point part quand elle s\'ouvre', async () => {
    const v = await visite({ connecte: false })
    const arret = v.pose(v.el)
    v.clic(0)
    arret()
    await attendre(() => v.recus.length >= 1, 3000)
    assert.deepEqual(v.places(), [place(0)], `${v.recus.length} point reçu sur 1`)
    assert.equal(v.connexions(), 1, 'une seule connexion')
    await v.fermer()
  })

  it('plusieurs points en attente quand la connexion est coupée, puis le retrait : ils partent tous à la réouverture', async () => {
    const v = await visite({ reconnexion: 600 })
    const arret = v.pose(v.el)
    v.sock._mjs_ws.close(1006, 'coupure')
    const maintenant = Date.now
    try {
      for (let i = 0; i < 5; i++) { Date.now = () => maintenant() + 1000 * (i + 1); v.clic(i) }
    }
    finally { Date.now = maintenant }
    arret()
    assert.equal(v.recus.length, 0)
    await attendre(() => v.recus.length >= 5, 6000)
    assert.deepEqual(v.places(), [0, 1, 2, 3, 4].map(place), `${v.recus.length} points reçus sur 5`)
    await v.fermer()
  })

  it('`server:` : la connexion de l\'effet seul reste ouverte le temps d\'envoyer le point, puis se ferme', async () => {
    const v = await visite({ connecte: false })
    const crees: any[] = []
    const reel = (globalThis as any).WebSocket
    ;(globalThis as any).WebSocket = function (...a: any[]) { const ws = reel(...a); crees.push(ws); return ws }
    const arret = v.pose(v.el, { sock: undefined, server: 'memory://seule' })
    v.clic(0)
    arret()
    await attendre(() => v.recus.length >= 1, 3000)
    assert.deepEqual(v.places(), [place(0)], `${v.recus.length} point reçu sur 1`)
    await attendre(() => crees.length > 0 && crees.every((w) => w.readyState === 3), 3000)
    assert.equal(crees.length, 1, 'une seule connexion, celle de l\'effet')
    assert.equal(crees[0].readyState, 3, 'fermée une fois le point parti')
    await v.fermer()
  })

  it('`server:` et une connexion qui ne s\'ouvre jamais : elle reste le temps de la borne (10 s), puis l\'effet la ferme et abandonne le point', async () => {
    const v = await visite({ connecte: false })
    const crees: any[] = []
    ;(globalThis as any).WebSocket = muet(crees)
    const arret = v.pose(v.el, { sock: undefined, server: 'memory://seule' })
    v.clic(0)
    arret()
    await tick(350)
    assert.equal(crees.length, 1, 'la connexion de l\'effet est tentée')
    assert.equal(crees[0].closed, false, 'elle reste ouverte tant que la borne n\'est pas passée : le point attend l\'ouverture')
    await horlogeAvancee(11000, async () => { await tick(350) })
    assert.equal(crees[0].closed, true, 'passée la borne, l\'effet la ferme')
    assert.equal(v.recus.length, 0)
    await v.fermer()
  })

  it('une connexion de l\'appli qui ne s\'ouvre jamais : le point en attente est abandonné au bout de la borne, plus aucun minuteur ne tourne', async () => {
    const v = await visite({ connecte: false })
    const crees: any[] = []
    ;(globalThis as any).WebSocket = muet(crees)
    const arret = v.pose(v.el)
    v.clic(0)
    arret()
    const reel = globalThis.setTimeout
    let relances = 0
    ;(globalThis as any).setTimeout = (f: any, ms?: number, ...reste: any[]) => { if (ms === 100) relances++; return (reel as any)(f, ms, ...reste) }
    try {
      await tick(350)
      assert.ok(relances >= 2, 'le point attend l\'ouverture : ' + relances + ' relances de 100 ms')
      await horlogeAvancee(11000, async () => { await tick(250) })
      const apres = relances
      await tick(400)
      assert.equal(relances, apres, 'la borne passée, plus aucune relance')
    }
    finally { globalThis.setTimeout = reel }
    assert.equal(v.recus.length, 0)
    await v.fermer()
  })
})

describe('*heatmap — au retrait, un lot de plus de 16 000 octets part en plusieurs trames, d\'un trait', function () {
  this.timeout(40000)

  it('onze points d\'environ 2 Ko : le premier part, dix attendent la part des effets ; au retrait, les dix partent sans attendre le minuteur', async () => {
    const v = await visite({ rate: 1 })
    // des segments de 15 lettres : un segment de 16 caractères ou plus serait masqué (`_SECRET_ID_`)
    v.va('/' + ('p'.repeat(15) + '/').repeat(119).slice(0, 1900))
    const z = element()
    const arret = v.pose(z.el, { on: 'mousemove' })
    const maintenant = Date.now
    try {
      for (let i = 0; i < 11; i++) { Date.now = () => maintenant() + 1000 * (i + 1); z.tire('mousemove', i) }
    }
    finally { Date.now = maintenant }
    await attendre(() => v.recus.length >= 1, 2000)
    assert.equal(v.recus.length, 1, 'le premier est parti, les dix autres attendent la part')
    const avant = v.trames.length
    arret()
    // « d'un trait » : bien avant le minuteur de 100 ms qui relance un envoi en attente
    await tick(40)
    assert.equal(v.recus.length, 11, `${v.recus.length} points reçus sur 11, 40 ms après le retrait`)
    const trames = v.trames.slice(avant)
    assert.ok(trames.length >= 2, 'le lot s\'est coupé en plusieurs trames : ' + trames.length)
    for (const p of trames) assert.ok(JSON.stringify({ t: 'heatmap:point', p }).length <= 16100, 'une trame sous la borne de 16 000 octets de points')
    await v.fermer()
  })
})

describe('*heatmap — une connexion qui ne s\'ouvre pas : le rythme des tentatives est celui de la connexion', function () {
  this.timeout(40000)

  it('un point en attente 1,3 s (treize passages du minuteur de l\'effet) : une seule tentative, comme la connexion seule', async () => {
    const seule = { n: 0 }
    {
      const v = await visite({ connecte: false, reconnexion: 100000 })
      ;(globalThis as any).WebSocket = echec(seule)
      v.sock.connect()
      await tick(1300)
      await v.fermer()
    }
    const essais = { n: 0 }
    const v = await visite({ connecte: false, reconnexion: 100000 })
    ;(globalThis as any).WebSocket = echec(essais)
    v.pose(v.el)
    v.clic(0)
    await tick(1300)
    assert.equal(essais.n, seule.n, `la connexion seule : ${seule.n} tentative ; avec l'effet : ${essais.n}`)
    assert.equal(essais.n, 1, 'une seule tentative : le recul de la connexion (100 s ici) fait attendre le minuteur de l\'effet')
    await v.fermer()
  })
})
