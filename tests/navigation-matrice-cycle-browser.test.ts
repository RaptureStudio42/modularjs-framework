// Matrice de la navigation, le cycle d'une visite : événements `mjs:before-visit` (annulé), `mjs:visit`,
// `mjs:before-cache` et `mjs:load`, navigation périmée abandonnée (deux clics rapides), cache de pages (retour et re-clic
// instantanés, arbre hiberné), élément `mjs-permanent`, `<head>` suivi, transition de vue de navigation. Vrai projet
// construit, navigateur réel (Chromium, Firefox, WebKit), chaque cas joué tel quel puis avec `window.navigation` retiré
// avant le démarrage : le comportement d'aujourd'hui, qui doit rester le même quand la navigation passera par l'API
// Navigation.

import assert from 'node:assert/strict'
import { matrix, address, sameDocument, events, hits, until, settle, back, SLOW, type Case } from './helpers/navigation-matrice.js'

const CASES: Case[] = [
  {
    name: 'événements d\'une visite : before-visit, visit, before-cache, load ; au Précédent : visit (cache), before-cache, load',
    run: async ({ open }) => {
      const p     = await open('/p1')
      const start = await events(p)
      assert.deepEqual(start, ['load initial /p1'])
      await p.click('#lp2')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      await settle(p)
      assert.deepEqual((await events(p)).slice(1), ['before-visit link /p2', 'visit link réseau /p2', 'before-cache - /p1', 'load link /p2'])
      await back(p)
      await until(p, () => location.pathname === '/p1' && !!document.getElementById('nom-p1'))
      await settle(p)
      assert.deepEqual((await events(p)).slice(5), ['visit popstate cache /p1', 'before-cache - /p2', 'load popstate /p1'])
    },
  },
  {
    name: '`mjs:before-visit` annulé : la page reste, rien ne part ; le clic suivant navigue',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.evaluate(() => document.addEventListener('mjs:before-visit', (e) => e.preventDefault(), { once: true }))
      await p.click('#lp2')
      await p.waitForTimeout(600)
      assert.equal(await address(p), '/p1')
      assert.ok(await p.evaluate(() => !!document.getElementById('nom-p1')))
      assert.deepEqual(hits(site), [])
      assert.deepEqual((await events(p)).slice(1), ['before-visit link /p2'])
      await p.click('#lp2')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      assert.deepEqual(hits(site), ['GET /p2 mjs'])
    },
  },
  {
    name: 'navigation périmée : un second lien pendant la première abandonne sa requête, seule la seconde page s\'affiche',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.click('#llent')
      await p.click('#lp2')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      await p.waitForTimeout(SLOW + 400)
      assert.equal(await address(p), '/p2')
      assert.ok(await p.evaluate(() => !document.getElementById('nom-lent') && !!document.getElementById('nom-p2')))
      assert.ok(await p.evaluate(() => !(window as any).µ.nav.active), 'µ.nav.active retombé')
      assert.deepEqual(hits(site), ['GET /lent mjs coupée', 'GET /p2 mjs'])
    },
  },
  {
    name: 'cache de pages : Précédent et re-clic rendent l\'arbre hiberné, sans requête',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.evaluate(() => { (document.getElementById('nom-p1') as any).__kept = 1 })
      await p.click('#lp2')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      await p.evaluate(() => { (document.getElementById('nom-p2') as any).__kept = 2 })
      await back(p)
      await until(p, () => location.pathname === '/p1' && (document.getElementById('nom-p1') as any)?.__kept === 1)
      await p.click('#lp2')
      await until(p, () => location.pathname === '/p2' && (document.getElementById('nom-p2') as any)?.__kept === 2)
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(hits(site), ['GET /p2 mjs'])
      assert.deepEqual((await events(p)).filter(e => e.startsWith('visit')), ['visit link réseau /p2', 'visit popstate cache /p1', 'visit link cache /p2'])
    },
  },
  {
    name: 'élément `mjs-permanent` : le même nœud vivant traverse la navigation',
    run: async ({ open }) => {
      const p = await open('/p1')
      await p.evaluate(() => { (document.getElementById('perma') as any).__kept = 1 })
      await p.click('#lp2')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      assert.ok(await p.evaluate(() => (document.getElementById('perma') as any).__kept === 1 && document.querySelectorAll('#perma').length === 1), 'le nœud de la page quittée')
    },
  },
  {
    name: '`<head>` suivi : titre et description de la page reçue',
    run: async ({ open }) => {
      const p = await open('/p1')
      assert.equal(await p.title(), 'Titre p1')
      await p.click('#lp2')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      await until(p, () => document.title === 'Titre p2')
      assert.equal(await p.evaluate(() => document.querySelector('meta[name="description"]')?.getAttribute('content')), 'desc p2')
      assert.equal(await p.evaluate(() => document.querySelectorAll('meta[name="description"]').length), 1)
    },
  },
  {
    name: 'transition de vue de navigation (`mjs-vt`) : une transition pour le lien qui la demande, aucune pour un lien ordinaire',
    run: async ({ open }) => {
      const p = await open('/p1')
      await p.click('#lvt')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      await until(p, () => (window as any).__vt === 1)
      await settle(p)
      await p.click('#lp1')
      await p.waitForSelector('#nom-p1', { state: 'attached' })
      await settle(p)
      assert.equal(await p.evaluate(() => (window as any).__vt), 1)
    },
  },
]

matrix('navigation, matrice du cycle d\'une visite — navigateur réel, vrai projet, avec et sans window.navigation', CASES)
