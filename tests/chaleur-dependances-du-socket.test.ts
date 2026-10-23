// *heatmap lit deux choses de la connexion µ.socket (mjs_socket.ts) pour savoir si le lien est saturé : ce que le
// navigateur n'a pas encore envoyé (`bufferedAmount` du WebSocket, `_mjs_ws`) et la borne de la connexion
// (`opts.maxBuffered`, 65 536 par défaut). Ici sur la VRAIE connexion — un faux objet ne rougit pas quand l'une de
// ces deux dépendances change de nom — : le lien saturé retient le point, il part quand le lien se vide.

import assert from 'node:assert/strict'
import { visite, attendre, tick, place } from './helpers/chaleur-visite.js'

describe('*heatmap — le lien saturé, sur la vraie connexion', function () {
  this.timeout(30000)

  it('`bufferedAmount` du vrai WebSocket au-delà de la borne par défaut : le point attend, puis part quand le lien se vide', async () => {
    const v = await visite()
    v.pose(v.el)
    assert.ok(v.sock._mjs_ws, 'la connexion tient un WebSocket')
    v.sock._mjs_ws.bufferedAmount = 100000
    v.clic(0)
    await tick(350)
    assert.equal(v.recus.length, 0, 'le lien est saturé : rien ne part')
    assert.equal(v.emis(), 0, 'le point n\'est pas confié à la connexion')
    v.sock._mjs_ws.bufferedAmount = 0
    await attendre(() => v.recus.length >= 1, 3000)
    assert.deepEqual(v.places(), [place(0)])
    await v.fermer()
  })

  it('la borne est `maxBuffered` de la connexion : 2 000 octets en attente retiennent le point d\'une connexion bornée à 1 000, pas celui d\'une connexion par défaut', async () => {
    const v = await visite({ maxBuffered: 1000 })
    v.pose(v.el)
    v.sock._mjs_ws.bufferedAmount = 2000
    v.clic(0)
    await tick(350)
    assert.equal(v.recus.length, 0, 'au-delà de sa borne de 1 000')
    v.sock._mjs_ws.bufferedAmount = 500
    await attendre(() => v.recus.length >= 1, 3000)
    assert.equal(v.recus.length, 1, 'sous sa borne : le point part')
    await v.fermer()

    const w = await visite()
    w.pose(w.el)
    w.sock._mjs_ws.bufferedAmount = 2000
    w.clic(0)
    await attendre(() => w.recus.length >= 1, 3000)
    assert.equal(w.recus.length, 1, 'la borne par défaut (65 536) laisse passer 2 000 octets')
    await w.fermer()
  })
})
