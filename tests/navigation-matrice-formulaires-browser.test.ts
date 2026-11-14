// Matrice de la navigation, les formulaires et les verbes : formulaire `GET`, formulaire `POST` redirigé (PRG), champ
// caché `_method`, lien `mjs-method`, question `mjs-confirm` refusée puis acceptée, sur un lien et sur un formulaire.
// Vrai projet construit, navigateur réel (Chromium, Firefox, WebKit), chaque cas joué tel quel puis avec
// `window.navigation` retiré avant le démarrage : le comportement d'aujourd'hui, qui doit rester le même quand la
// navigation passera par l'API Navigation.

import assert from 'node:assert/strict'
import { matrix, address, sameDocument, hits, type Case } from './helpers/navigation-matrice.js'

const CASES: Case[] = [
  {
    name: 'formulaire GET : ses champs dans l\'adresse, la page reçue sans chargement complet',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.click('#envoiget')
      await p.waitForSelector('#nom-rech', { state: 'attached' })
      assert.equal(await address(p), '/rech?q=chat')
      assert.equal(await p.textContent('#nom-rech'), 'chat')
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(hits(site), ['GET /rech?q=chat mjs'])
    },
  },
  {
    name: 'formulaire POST redirigé (303) : l\'adresse devient la destination, le corps part au serveur',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.click('#envoipost')
      await p.waitForSelector('#nom-recu', { state: 'attached' })
      assert.equal(await address(p), '/recu')
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(hits(site), ['POST /post mjs', 'GET /recu mjs'])
      assert.match(site.log[0].body, /(^|&)a=1(&|$)/)
    },
  },
  {
    name: 'champ caché `_method=delete` : le verbe part au serveur avec les autres champs',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.click('#envoidel')
      await p.waitForSelector('#nom-p3', { state: 'attached' })
      assert.equal(await address(p), '/p3')
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(hits(site), ['DELETE /item mjs', 'GET /p3 mjs'])
      assert.match(site.log[0].body, /(^|&)b=2(&|$)/)
    },
  },
  {
    name: 'lien `mjs-method="delete"` : le verbe part au serveur, sans corps',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.click('#ldel')
      await p.waitForSelector('#nom-p3', { state: 'attached' })
      assert.equal(await address(p), '/p3')
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(hits(site), ['DELETE /item mjs', 'GET /p3 mjs'])
      assert.equal(site.log[0].body, '')
    },
  },
  {
    name: 'lien `mjs-confirm` : refusé, rien ne part ; accepté, la page arrive',
    run: async ({ open, site }) => {
      const p                   = await open('/p1')
      const questions: string[] = []
      p.once('dialog', d => { questions.push(d.message()); d.dismiss() })
      await p.click('#lconf')
      await p.waitForTimeout(600)
      assert.equal(await address(p), '/p1')
      assert.deepEqual(hits(site), [])
      p.once('dialog', d => { questions.push(d.message()); d.accept() })
      await p.click('#lconf')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      assert.equal(await address(p), '/p2')
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(questions, ['Vraiment ?', 'Vraiment ?'])
      assert.deepEqual(hits(site), ['GET /p2 mjs'])
    },
  },
  {
    name: 'formulaire `mjs-confirm` : refusé, rien ne part ; accepté, l\'envoi part',
    run: async ({ open, site }) => {
      const p                   = await open('/p1')
      const questions: string[] = []
      p.once('dialog', d => { questions.push(d.message()); d.dismiss() })
      await p.click('#envoiconf')
      await p.waitForTimeout(600)
      assert.equal(await address(p), '/p1')
      assert.deepEqual(hits(site), [])
      p.once('dialog', d => { questions.push(d.message()); d.accept() })
      await p.click('#envoiconf')
      await p.waitForSelector('#nom-recu', { state: 'attached' })
      assert.equal(await address(p), '/recu')
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(questions, ['Envoyer ?', 'Envoyer ?'])
      assert.deepEqual(hits(site), ['POST /post mjs', 'GET /recu mjs'])
      assert.match(site.log[0].body, /(^|&)a=3(&|$)/)
    },
  },
]

matrix('navigation, matrice des formulaires et des verbes — navigateur réel, vrai projet, avec et sans window.navigation', CASES)
