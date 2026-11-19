// clé calculée à la racine de l'état (`$[c.nom].x`) et du magasin (`µ.store[k].x`), dans Chromium, script en mode strict : avec une
// clé `__proto__` venue de données, ni `=`, ni `++`, ni `+=`, ni `delete` ne touchent le modèle commun de tous les objets de la page
// (Object.prototype) d'un vrai navigateur ; une clé juste écrit la fiche, et l'état la redessine

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { codeStrict } from './helpers/construction-stricte.js'
import { attendreEgal } from './helpers/attendre.js'
import { COMPOSANT_ETAT, COMPOSANT_MAGASIN, CLE_ETAT, CLE_MAGASIN, scenario, ecran, ATTENDU } from './helpers/cle-calculee-racine.js'

describe('clé calculée à la racine de l\'état et du magasin, dans Chromium : une clé `__proto__` venue de données n\'écrit rien dans Object.prototype', function () {
  this.timeout(120000)
  let navigateur: any
  let page: any
  const erreurs: string[] = []

  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) this.skip()
    const code = await codeStrict('cle-racine-navigateur', { 'cle-etat': COMPOSANT_ETAT, 'cle-magasin': COMPOSANT_MAGASIN })
    navigateur = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
    page       = await navigateur.newPage()
    page.on('pageerror', (e: any) => erreurs.push(e.message))
    await page.setContent('<!doctype html><html><body><mjs-cle-etat></mjs-cle-etat><mjs-cle-magasin></mjs-cle-magasin></body></html>')
    await page.addScriptTag({ content: code })
    await page.waitForFunction(() => ['mjs-cle-etat', 'mjs-cle-magasin'].every((b) => !!(document.querySelector(b) as any)?._shadow?.querySelector('p')))
  })

  after(async () => {
    await navigateur?.close()
    await terminateSharedWorkerPool()
  })

  it('état, `$[c.nom].x` : Object.prototype intact après les quatre formes par `__proto__` ; la fiche écrite et redessinée par une clé juste', async () => {
    const vu = JSON.parse(await page.evaluate(scenario('mjs-cle-etat', CLE_ETAT)))
    await attendreEgal(async () => ({ ...vu, ecran: await page.evaluate(ecran('mjs-cle-etat')) }), { ...ATTENDU, ecran: 'ok-3' }, 'formes par `__proto__`, puis écran', 2000)
    assert.deepEqual(erreurs, [])
  })

  it('magasin, `µ.store[k].x` : Object.prototype intact après les quatre formes par `__proto__` ; la fiche du magasin écrite par une clé juste', async () => {
    assert.deepEqual(JSON.parse(await page.evaluate(scenario('mjs-cle-magasin', CLE_MAGASIN))), ATTENDU)
    assert.deepEqual(erreurs, [])
  })
})
