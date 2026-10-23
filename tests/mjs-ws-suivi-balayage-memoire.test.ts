// mjs-ws — suivi (follow.ts) : la mémoire est bornée. Toutes les 200 demandes, la dernière position d'un salon
// que plus personne ne tient est oubliée (sinon un serveur long garde une position par salon jamais revu) ;
// celle d'un salon encore tenu reste.

import assert from 'node:assert/strict'
import { followPackage } from '../src/mjs-ws/index.js'

// un serveur factice : ce que le paquet demande à `app` (serve, on, room), les salons tenus à la main
function fauxServeur(pkg: any) {
  const serves: Record<string, any> = {}
  const ons: Record<string, any>    = {}
  const salons                      = new Map<string, Set<any>>()
  const lus: Record<string, number> = {}
  const app: any                    = {
    serve: (t: string, f: any) => { serves[t] = f },
    on: (t: string, f: any) => { ons[t] = f },
    room: (nom: string) => {
      lus[nom] = (lus[nom] ?? 0) + 1
      const membres = () => salons.get(nom) ?? new Set<any>()
      return {
        get clients() { return membres().values() },
        get size() { return membres().size },
        has: (c: any) => membres().has(c),
        send: () => {},
      }
    },
  }
  pkg.installer(app)
  const entre = (nom: string, c: any) => { if (!salons.has(nom)) salons.set(nom, new Set()); salons.get(nom)!.add(c) }
  const sort  = (nom: string, c: any) => { salons.get(nom)?.delete(c) }
  return { serves, ons, entre, sort, lus }
}

const visiteur = (n: number) => ({ id: 'c' + n, identity: { id: 'u' + n, name: 'Visiteur ' + n } })

describe('mjs-ws — suivi : le balayage de la mémoire', function () {
  it('toutes les 200 demandes, la position d\'un salon vidé est oubliée ; celle d\'un salon tenu reste', async () => {
    const pkg  = followPackage({ canLead: () => true })
    const s    = fauxServeur(pkg)
    const part = visiteur(1)
    const reste = visiteur(2)
    const pose = visiteur(3)
    s.entre('follow:parti', part)
    s.entre('follow:tenu', reste)
    s.entre('follow:actif', pose)
    await s.ons['follow:at']({ room: 'parti', a: [0], y: 0.5 }, part)
    await s.ons['follow:at']({ room: 'tenu', a: [0], y: 0.5 }, reste)
    const last: Map<string, unknown> = (pkg as any)._last
    assert.ok(last.has('follow:parti') && last.has('follow:tenu'), 'les deux positions sont posées')
    s.sort('follow:parti', part)
    // moins de 200 demandes : rien n'est encore balayé
    for (let i = 0; i < 50; i++) s.serves['follow:last']({ room: 'actif' }, pose)
    assert.ok(last.has('follow:parti'), 'pas de balayage avant la 200e demande')
    for (let i = 0; i < 250; i++) s.serves['follow:last']({ room: 'actif' }, pose)
    assert.ok(!last.has('follow:parti'), 'la position du salon vidé est oubliée au balayage')
    assert.ok(last.has('follow:tenu'), 'celle du salon que quelqu\'un tient encore reste')
  })

  it('le balayage oublie aussi les seaux et les témoins du salon vidé : il ne les relit plus au balayage suivant', async () => {
    const pkg  = followPackage({ canLead: () => true })
    const s    = fauxServeur(pkg)
    const part = visiteur(1)
    const pose = visiteur(3)
    s.entre('follow:parti', part)
    s.entre('follow:actif', pose)
    await s.ons['follow:at']({ room: 'parti', a: [0], y: 0.5 }, part)
    s.sort('follow:parti', part)
    for (let i = 0; i < 200; i++) s.serves['follow:last']({ room: 'actif' }, pose)
    s.lus['follow:parti'] = 0
    for (let i = 0; i < 200; i++) s.serves['follow:last']({ room: 'actif' }, pose)
    assert.equal(s.lus['follow:parti'], 0, 'ni le seau ni le témoin du salon vidé ne sont encore là au second balayage')
  })

  it('un salon vidé repart avec un seau neuf : le seau d\'avant est oublié', async () => {
    const pkg  = followPackage({ canLead: () => true })
    const s    = fauxServeur(pkg)
    const part = visiteur(1)
    const pose = visiteur(3)
    s.entre('follow:parti', part)
    s.entre('follow:actif', pose)
    for (let i = 0; i < 60; i++) await s.ons['follow:at']({ room: 'parti', a: [0], y: 0.5 }, part)
    const last: Map<string, unknown> = (pkg as any)._last
    s.sort('follow:parti', part)
    for (let i = 0; i < 200; i++) s.serves['follow:last']({ room: 'actif' }, pose)
    s.entre('follow:parti', part)
    last.delete('follow:parti')
    await s.ons['follow:at']({ room: 'parti', a: [0], y: 0.5 }, part)
    assert.ok(last.has('follow:parti'), 'le seau épuisé d\'avant le balayage ne bloque pas le retour')
  })

  it('le seuil est de 200 demandes : ni plus tôt, ni plus tard', async () => {
    const pkg  = followPackage({ canLead: () => true })
    const s    = fauxServeur(pkg)
    const part = visiteur(1)
    const pose = visiteur(3)
    s.entre('follow:parti', part)
    s.entre('follow:actif', pose)
    await s.ons['follow:at']({ room: 'parti', a: [0], y: 0.5 }, part)
    const last: Map<string, unknown> = (pkg as any)._last
    s.sort('follow:parti', part)
    for (let i = 0; i < 198; i++) s.serves['follow:last']({ room: 'actif' }, pose)
    assert.ok(last.has('follow:parti'), '199 demandes : pas encore balayé')
    s.serves['follow:last']({ room: 'actif' }, pose)
    assert.ok(!last.has('follow:parti'), 'à la 200e demande : balayé')
  })
})
