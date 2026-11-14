// Matrice de la navigation, les liens : ce que la navigation de MJS prend (lien de la même origine, lien d'un composant
// à ombre, redirection, erreur du serveur) et ce qu'elle laisse au navigateur (autre origine, `target="_blank"`, touches
// de modification, clic du milieu, `download`, `mjs-no-ujs`). Vrai projet construit, navigateur réel (Chromium, Firefox,
// WebKit), chaque cas joué tel quel puis avec `window.navigation` retiré avant le démarrage : le comportement
// d'aujourd'hui, qui doit rester le même quand la navigation passera par l'API Navigation.

import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { matrix, address, sameDocument, events, hits, until, waitHit, deepClick, type Case, type Run } from './helpers/navigation-matrice.js'

// geste que le navigateur garde : aucune requête de la navigation de MJS, aucun `mjs:before-visit` ; la page de départ
// reste affichée, ou le navigateur la quitte lui-même par un chargement complet
function kept(name: string, gesture: (p: Page) => Promise<void>): Case {
  return {
    name,
    run: async ({ open, site }: Run) => {
      const p = await open('/p1')
      await gesture(p)
      await p.waitForTimeout(1000)
      assert.ok(!site.log.some(h => h.mjs), 'aucune requête de la navigation de MJS : ' + hits(site).join(', '))
      if (await sameDocument(p).catch(() => false)) {
        assert.equal(await address(p), '/p1')
        assert.ok(!(await events(p)).some(e => e.startsWith('before-visit')), 'aucun mjs:before-visit')
      }
      else {
        assert.ok(site.log.some(h => h.path === '/p2' && !h.mjs), 'quittée par le navigateur lui-même : ' + hits(site).join(', '))
      }
    },
  }
}

const CASES: Case[] = [
  {
    name: 'lien de la même origine : la page arrive par la navigation, sans chargement complet, dans une entrée neuve',
    run: async ({ open, site }) => {
      const p      = await open('/p1')
      const length = await p.evaluate(() => history.length)
      await p.click('#lp2')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      assert.equal(await address(p), '/p2')
      assert.ok(await sameDocument(p), 'même document')
      assert.equal(await p.evaluate(() => history.length), length + 1)
      assert.deepEqual(hits(site), ['GET /p2 mjs'])
    },
  },
  {
    name: 'lien vers une autre origine : suivi par le navigateur',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.click('#lext')
      await until(p, () => !!document.getElementById('ext'))
      assert.ok(p.url().startsWith(site.other + '/ext'), p.url())
      assert.deepEqual(hits(site), ['GET autre:/ext navigateur'])
    },
  },
  {
    name: 'lien `target="_blank"` : le navigateur ouvre la page ailleurs, la page de départ reste',
    run: async ({ open, site, ctx }) => {
      const p       = await open('/p1')
      const [popup] = await Promise.all([ctx.waitForEvent('page'), p.click('#lblank')])
      await until(popup, () => !!document.getElementById('nom-p2'))
      assert.equal(await address(p), '/p1')
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(hits(site), ['GET /p2 navigateur'])
    },
  },
  kept('Ctrl + clic : laissé au navigateur', p => p.click('#lp2', { modifiers: ['Control'] })),
  kept('Maj + clic : laissé au navigateur', p => p.click('#lp2', { modifiers: ['Shift'] })),
  kept('Méta + clic : laissé au navigateur', p => p.click('#lp2', { modifiers: ['Meta'] })),
  kept('clic du milieu : laissé au navigateur', p => p.click('#lp2', { button: 'middle' })),
  {
    name: 'lien `download` : le navigateur télécharge, la page reste',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.click('#ldl')
      await waitHit(site, h => h.path === '/fichier.csv')
      await p.waitForTimeout(300)
      assert.equal(await address(p), '/p1')
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(hits(site), ['GET /fichier.csv navigateur'])
    },
  },
  {
    name: 'lien `download` sans valeur : la page ne se croit pas quittée (`µ._mjs_left()` faux)',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.click('#ldl')
      await waitHit(site, h => h.path === '/fichier.csv')
      await p.waitForTimeout(300)
      // pour un attribut `download` sans valeur, l'API Navigation donne `downloadRequest === ''` : un téléchargement quand
      // même, aucun départ ; Firefox annonce aussitôt le même téléchargement une seconde fois, par un `navigate` vers la même
      // adresse, venu du même lien, `downloadRequest` nul : ni pris par la navigation, ni un départ ; sans l'API, aucun
      // départ n'est annoncé non plus
      assert.equal(await p.evaluate(() => (window as any).µ._mjs_left()), false)
      assert.equal(await address(p), '/p1')
      assert.ok(!site.log.some(h => h.mjs), 'aucune requête de la navigation de MJS : ' + hits(site).join(', '))
    },
  },
  {
    name: 'lien `mjs-no-ujs` : chargement complet par le navigateur',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.click('#lnoujs')
      await until(p, () => location.pathname === '/p2' && !!document.getElementById('nom-p2') && (window as any).__doc !== 'départ')
      assert.deepEqual(hits(site), ['GET /p2 navigateur'])
    },
  },
  {
    name: 'lien dans l\'ombre (fermée) d\'un composant : pris par la navigation',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await deepClick(p, 'lo')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      assert.equal(await address(p), '/p2')
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(hits(site), ['GET /p2 mjs'])
    },
  },
  {
    name: 'redirection du serveur : l\'adresse devient la destination finale',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.click('#lredir')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      await until(p, () => location.pathname === '/p2')
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(hits(site), ['GET /redir mjs', 'GET /p2 mjs'])
    },
  },
  {
    name: 'erreur du serveur (500) : la page est redemandée au navigateur, qui affiche la réponse du serveur',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.click('#lboom')
      await until(p, () => !!document.getElementById('erreur'))
      assert.equal(await address(p), '/boom')
      assert.deepEqual(hits(site), ['GET /boom mjs', 'GET /boom navigateur'])
    },
  },
]

matrix('navigation, matrice des liens — navigateur réel, vrai projet, avec et sans window.navigation', CASES)
