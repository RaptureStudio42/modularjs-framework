// *heatmap : une trame de points reste sous `limits.maxPayload` du serveur (65 536 octets par défaut) — au-delà, le
// serveur EXPULSE la connexion (code 1009), celle de toute l'appli. Un lot de 20 points aux adresses longues, avec ses
// 8 zones, pèse plus que la borne : il se coupe en plusieurs trames. Une adresse que le serveur refuserait de toute
// façon (plus de 2 000 caractères) ne part pas du tout : elle n'a jamais de quoi faire sauter la borne.

import assert from 'node:assert/strict'
import { visite, attendre, tick } from './helpers/chaleur-visite.js'

const LONGUEUR = 1900

// la page entière (`<@document>`), un clic tombe au fond de 7 composants aux noms de 115 caractères : 8 zones
function pageProfonde(v: any) {
  const ecouteurs: Record<string, (ev: any) => void> = {}
  v.document.addEventListener = (t: string, f: (ev: any) => void) => { ecouteurs[t] = f }
  v.document.removeEventListener = (t: string) => { delete ecouteurs[t] }
  const d = v.document.documentElement
  Object.assign(d, { scrollWidth: 2000, scrollHeight: 3000, clientWidth: 800, clientHeight: 600 })
  let parent: any = d
  for (let i = 0; i < 7; i++) parent = { nodeType: 1, localName: 'mjs-' + 'x'.repeat(110) + i, parentNode: parent, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) }
  const feuille: any = { nodeType: 1, localName: 'span', parentNode: parent, getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }) }
  v.pose(d)
  return (i: number) => ecouteurs.click({ clientX: 5 + i, clientY: 5, detail: 1, composedPath: () => [feuille], target: feuille })
}

describe('*heatmap — une trame reste sous la borne du serveur (maxPayload)', function () {
  this.timeout(40000)

  it('20 points aux adresses de 1 900 caractères et à 8 zones, serveur borné à 16 Ko : le lot se coupe, le serveur reçoit les 20, la connexion tient', async () => {
    const v = await visite({ reconnexion: 600, limites: { maxPayload: 16384 } })
    // des segments de 15 lettres : un segment de 16 caractères ou plus serait masqué (`_SECRET_ID_`)
    v.va('/' + ('p'.repeat(15) + '/').repeat(LONGUEUR).slice(0, LONGUEUR))
    const clic = pageProfonde(v)
    // la connexion est coupée : les points attendent (20 au plus), puis partent d'un trait à la réouverture
    v.sock._mjs_ws.close(1006, 'coupure')
    const maintenant = Date.now
    try {
      for (let i = 0; i < 20; i++) { Date.now = () => maintenant() + 1000 * (i + 1); clic(i) }
    }
    finally { Date.now = maintenant }
    assert.equal(v.recus.length, 0)
    await attendre(() => v.recus.length >= 20, 8000)
    await tick(200)
    assert.equal(v.recus.length, 20, `${v.recus.length} points reçus sur 20 — état : ${v.sock.state}, erreur : ${JSON.stringify(v.sock.lastError)}`)
    assert.equal(v.sock.state, 'open', 'la connexion n\'a pas été expulsée')
    assert.ok(v.trames.length > 1, 'le lot s\'est coupé : ' + v.trames.length + ' trame(s)')
    for (const p of v.trames) assert.ok(JSON.stringify({ t: 'heatmap:point', p }).length <= 16384, 'une trame sous la borne')
    assert.deepEqual(v.recus[0].z.length, 8)
    await v.fermer()
  })

  it('une adresse de plus de 2 000 caractères, que le serveur refuserait : le point ne part pas, la connexion tient', async () => {
    const v = await visite()
    v.va('/' + ('p'.repeat(15) + '/').repeat(188).slice(0, 3000))
    const clic = pageProfonde(v)
    for (let i = 0; i < 25; i++) { clic(i); await tick(110) }
    await tick(400)
    assert.equal(v.emis(), 0, 'rien n\'est confié à la connexion')
    assert.equal(v.recus.length, 0)
    assert.equal(v.sock.state, 'open')
    // et la même page, à une adresse acceptée, envoie bien ses points
    v.va('/tarifs')
    clic(0)
    await attendre(() => v.recus.length >= 1, 3000)
    assert.equal(v.recus.length, 1)
    await v.fermer()
  })
})
