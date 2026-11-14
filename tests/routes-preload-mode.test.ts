// Chargement des pages d'une table de routes, réglage `routes.preload` de mjs.config.json (option `routesPreload` du
// compilateur) : sous "on", le composant qui porte la table demande toutes ses pages à son montage (une ligne
// `µ.Autoloader?.load?.('mjs-<page>')` par page) et confie au routeur une liste vide (la demande de la page montée et la reprise
// d'un fichier raté en dépendent) ; sous "idle" (défaut), il les confie au routeur qui les charge au repos,
// après l'affichage (un seul appel `µ._mjs_routesIdle?.([...])`) ; sous "off", la liste confiée est vide (chaque page se
// charge à sa première visite). Un composant sans table n'émet rien

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const BLOC      = ['<routes target="main">', '  /        home-page', '  /guide   guide-page', '</routes>', '<@view main>'].join('\n')
const DIRECTIVE = ['<script>', "  @routes = { 'main': { '/': 'home-page', '/guide': 'guide-page' } }", '</script>', '<@view main>'].join('\n')
const CONSTANTE = ['<script>', "  MAIN_ROUTES = { '/': 'home-page', '/guide': 'guide-page' }", '  @routes = main: MAIN_ROUTES', '</script>', '<@view main>'].join('\n')
const SANS      = '<p>rien</p>\n'

const sortie = async (source: string, mode?: 'on' | 'idle' | 'off') => (await transpile(source, mode ? { moduleName: 'routes-mode', routesPreload: mode } as any : { moduleName: 'routes-mode' })).output
const charges = (s: string) => [...s.matchAll(/µ\.Autoloader\?\.load\?\.\('mjs-([a-z0-9-]+)'\);/g)].map((m) => m[1])
const repos   = (s: string) => [...s.matchAll(/µ\._mjs_routesIdle\?\.\((\[[^\]]*\])\);/g)].map((m) => JSON.parse(m[1]))

describe('routes.preload — ce que le compilateur émet pour une table de routes', () => {
  for (const [forme, source] of [['bloc', BLOC], ['directive', DIRECTIVE]] as const) {
    it(`${forme} sous "on" : une demande par page au montage, une liste vide confiée au routeur`, async () => {
      const s = await sortie(source, 'on')
      assert.deepEqual(charges(s), ['home-page', 'guide-page'])
      assert.ok(s.includes("\nµ.Autoloader?.load?.('mjs-home-page');\nµ.Autoloader?.load?.('mjs-guide-page');\nµ._mjs_routesIdle?.([]);"), 'les lignes, caractère pour caractère')
      assert.deepEqual(repos(s), [[]])
    })

    for (const mode of ['idle', undefined] as const) {
      it(`${forme} sous ${mode ? '"idle"' : 'le défaut'} : un seul appel au routeur avec la liste des pages, aucune demande au montage`, async () => {
        const s = await sortie(source, mode)
        assert.deepEqual(charges(s), [])
        assert.deepEqual(repos(s), [['home-page', 'guide-page']])
        assert.ok(s.includes('\nµ._mjs_routesIdle?.(["home-page","guide-page"]);'))
      })
    }

    it(`${forme} sous "off" : la liste confiée au routeur est vide`, async () => {
      const s = await sortie(source, 'off')
      assert.deepEqual(charges(s), [])
      assert.deepEqual(repos(s), [[]])
    })
  }

  it('table rangée dans une constante : une liste vide confiée au routeur, sous "on", "idle" et "off"', async () => {
    assert.deepEqual(charges(await sortie(CONSTANTE, 'on')), [])
    assert.deepEqual(repos(await sortie(CONSTANTE, 'on')), [[]])
    assert.deepEqual(repos(await sortie(CONSTANTE, 'idle')), [[]])
    assert.deepEqual(repos(await sortie(CONSTANTE)), [[]])
    assert.deepEqual(repos(await sortie(CONSTANTE, 'off')), [[]])
  })

  it('composant sans table : rien, quel que soit le réglage', async () => {
    for (const mode of ['on', 'idle', 'off', undefined] as const) {
      const s = await sortie(SANS, mode)
      assert.equal(s.includes('_mjs_routesIdle'), false)
      assert.deepEqual(charges(s), [])
    }
  })
})
