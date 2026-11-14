// Matrice de la navigation, l'historique et le défilement : ancre de la page, ancre d'une autre page, Précédent et
// Suivant entre deux pages puis d'ancre en ancre (`anchorHistory`), position rendue au Précédent, focus après l'échange,
// routeur `#/…` à côté de la navigation. Vrai projet construit, navigateur réel (Chromium, Firefox, WebKit), chaque cas
// joué tel quel puis avec `window.navigation` retiré avant le démarrage : le comportement d'aujourd'hui, qui doit rester
// le même quand la navigation passera par l'API Navigation.

import assert from 'node:assert/strict'
import { matrix, address, sameDocument, events, hits, until, settle, scrollToY, reached, focused, deepHas, back, forward, type Case } from './helpers/navigation-matrice.js'

const CASES: Case[] = [
  {
    name: 'ancre de la page : défilement jusqu\'à la cible, `:target`, l\'entrée remplacée, rien au serveur',
    run: async ({ open, site }) => {
      const p      = await open('/p1')
      const length = await p.evaluate(() => history.length)
      await p.click('#lb')
      await reached(p, 'b')
      assert.equal(await p.evaluate(() => document.querySelector(':target')?.id), 'b')
      await p.click('#la')
      await reached(p, 'a')
      assert.equal(await address(p), '/p1#a')
      assert.equal(await p.evaluate(() => history.length), length)
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(hits(site), [])
    },
  },
  {
    name: 'ancre d\'une autre page : la page arrive, puis défile jusqu\'à la cible',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.click('#lp2b')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      await until(p, () => location.pathname + location.hash === '/p2#b' && Math.abs(document.getElementById('b')!.getBoundingClientRect().top) <= 2)
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(hits(site), ['GET /p2 mjs'])
    },
  },
  {
    name: 'Précédent puis Suivant entre deux pages : chacune revient du cache, sans requête',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.evaluate(() => { (document.getElementById('nom-p1') as any).__kept = 1 })
      await p.click('#lp2')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      await p.evaluate(() => { (document.getElementById('nom-p2') as any).__kept = 2 })
      await back(p)
      await until(p, () => location.pathname === '/p1' && (document.getElementById('nom-p1') as any)?.__kept === 1 && !document.getElementById('nom-p2'))
      await forward(p)
      await until(p, () => location.pathname === '/p2' && (document.getElementById('nom-p2') as any)?.__kept === 2 && !document.getElementById('nom-p1'))
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(hits(site), ['GET /p2 mjs'])
    },
  },
  {
    name: 'Précédent puis Suivant d\'ancre en ancre (`anchorHistory`) : chaque entrée rend sa position',
    run: async ({ open, site }) => {
      const p      = await open('/ah/p1')
      const length = await p.evaluate(() => history.length)
      await p.click('#la')
      await reached(p, 'a')
      await p.click('#lb')
      await reached(p, 'b')
      assert.equal(await p.evaluate(() => history.length), length + 2)
      await back(p)
      await until(p, () => location.hash === '#a' && Math.abs(document.getElementById('a')!.getBoundingClientRect().top) <= 2)
      await back(p)
      await until(p, () => location.pathname === '/ah/p1' && !location.hash && scrollY === 0)
      await forward(p)
      await until(p, () => location.hash === '#a' && Math.abs(document.getElementById('a')!.getBoundingClientRect().top) <= 2)
      assert.ok((await settle(p)) > 0, 'la page reste sur l\'ancre')
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(hits(site), [])
    },
  },
  {
    name: 'la même ancre suivie deux fois (`anchorHistory`) : avec l\'API, chaque entrée garde sa position ; sans elle, celle de la dernière quittée par une ancre',
    run: async ({ open, withoutApi }) => {
      const p   = await open('/ah/p1')
      const top = await p.evaluate(() => Math.round(document.getElementById('a')!.getBoundingClientRect().top + scrollY))
      await p.click('#la')
      await reached(p, 'a')
      await scrollToY(p, top + 400)
      await p.click('#lb')
      await reached(p, 'b')
      await p.click('#la')
      await reached(p, 'a')
      await scrollToY(p, top + 150)
      await p.click('#lb')
      await reached(p, 'b')
      await back(p)
      await until(p, (y) => location.hash === '#a' && Math.abs(scrollY - y) <= 1, top + 150)
      await back(p)
      await until(p, () => location.hash === '#b' && Math.abs(document.getElementById('b')!.getBoundingClientRect().top) <= 2)
      await back(p)
      await until(p, () => location.hash === '#a')
      assert.equal((await settle(p, 800)) - top, withoutApi ? 150 : 400)
    },
  },
  {
    name: 'position rendue au Précédent : la page quittée à 900 px y revient',
    run: async ({ open }) => {
      const p = await open('/p1')
      await scrollToY(p, 900)
      await p.click('#lp2')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      assert.equal(await settle(p), 0)
      await back(p)
      await until(p, () => location.pathname === '/p1' && !!document.getElementById('nom-p1') && Math.abs(scrollY - 900) <= 1)
      assert.equal(await settle(p), 900)
    },
  },
  {
    name: 'focus après l\'échange : le premier titre `<h1>` du contenu reçu le prend, pas la barre de liens',
    run: async ({ open }) => {
      const p = await open('/p1')
      await p.click('#lf')
      await p.waitForSelector('#titre-f', { state: 'attached' })
      await until(p, () => document.activeElement?.id === 'titre-f')
      assert.equal(await focused(p), 'H1#titre-f')
    },
  },
  {
    name: 'routeur `#/…` à côté : une route ne demande rien au serveur ni n\'émet d\'événement, Précédent la rend, une page revient sur elle',
    run: async ({ open, site }) => {
      const p = await open('/app#/a')
      await until(p, () => !!(window as any).__deep('r-a'))
      const before = (await events(p)).length
      await p.click('#lvb')
      await until(p, () => location.hash === '#/b' && !!(window as any).__deep('r-b'))
      assert.deepEqual((await events(p)).slice(before), [])
      await back(p)
      await until(p, () => location.hash === '#/a' && !!(window as any).__deep('r-a') && !(window as any).__deep('r-b'))
      await p.click('#lp2')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      await back(p)
      await until(p, () => location.pathname + location.hash === '/app#/a' && !!document.getElementById('nom-app'))
      assert.ok(await deepHas(p, 'r-a'), 'la vue de la route revient avec la page')
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(hits(site), ['GET /p2 mjs'])
    },
  },
]

matrix('navigation, matrice de l\'historique et du défilement — navigateur réel, vrai projet, avec et sans window.navigation', CASES)
