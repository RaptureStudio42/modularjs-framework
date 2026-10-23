// Une méthode d'auteur qui porte un nom du DOM (`@replaceWith`, `@focus`, `@click`) masque celle de la
// balise du composant : le cadre ne doit JAMAIS l'appeler à la place de la méthode de la balise.
// Défauts gardés absents, un par site de la navigation et de la confirmation :
//  - une navigation `X-MJS-Method: replace` dont la zone est la balise d'un composant : la zone est
//    remplacée par la page qui arrive, sans appeler le `@replaceWith` de l'auteur (qui, lui, la laissait
//    en place) ;
//  - le focus rendu après une navigation, sur la balise d'un composant : la balise prend le focus, sans
//    appeler le `@focus` de l'auteur (qui recevait l'objet d'options à la place de son argument) ;
//  - le rejeu d'un `@confirm` accepté sur la balise d'un composant : le clic accepté est rejoué sur la
//    balise (un vrai événement `click`), sans appeler le `@click` de l'auteur — par les deux voies de
//    rejeu (cible du clic d'origine, ou le porteur de la confirmation lui-même).
// Garde : un élément ordinaire (sans méthode d'auteur) reste remplacé, focalisé et cliqué.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const SOURCES: Record<string, string> = {
  'sonde-remplace.mjs': '<script>\n$r = 0\n@replaceWith = (x) ->\n  window.__appels.push(\'replaceWith\')\n</script>\n<p class="dedans">zone</p>\n',
  'sonde-focus.mjs':    '<script>\n$sel = \'aucun\'\n@focus = (id) ->\n  $sel = id\n  window.__appels.push(\'focus\')\n</script>\n<p class="sel">{$sel}</p>\n',
  'sonde-clic.mjs':     '<script>\n$c = 0\n@click = (o) ->\n  window.__appels.push(\'click\')\n</script>\n<p class="dedans">clic</p>\n',
  'sonde-libre.mjs':    '<script>\n$l = 0\n</script>\n<p class="dedans">libre</p>\n'
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('méthodes d\'auteur au nom du DOM : le cadre prend celle de la balise (navigation, focus, rejeu de @confirm)', function () {
  this.timeout(60000)
  let code = ''

  before(async () => {
    const root   = mjsTmp('methodes-auteur-nav')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    code = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  after(async () => { await terminateSharedWorkerPool() })

  // une fenêtre avec la page de départ ; `appels` recueille les appels des méthodes d'auteur
  async function ouvrir(corps: string, attendu: string) {
    const win: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    win.eval(`${code}\nglobalThis.µ = µ;\nglobalThis.__appels = [];\nµ.error = function() {};\nµ.warn = function() {};`)
    win.document.body.innerHTML = corps
    const hote = win.document.querySelector(attendu)
    for (let i = 0; i < 150 && !hote?._shadow?.querySelector('p'); i++) await pause(20)
    await pause(60)
    return { win, hote, appels: () => [...win.eval('globalThis.__appels')] as string[] }
  }

  it('navigation « replace » sur la balise d\'un composant à @replaceWith : la zone cède sa place, sans appeler la méthode d\'auteur', async function () {
    const { win, hote, appels } = await ouvrir('<mjs-sonde-remplace id="zr"></mjs-sonde-remplace>', 'mjs-sonde-remplace')
    const neuf = win.document.createElement('div')
    neuf.id = 'zr2'
    neuf.innerHTML = '<p class="neuf">NEUF</p>'
    win.µ._mjs_navInstallNodes({ zone: hote, mode: 'target', target: '#zr' }, [neuf], 'replace')
    assert.deepEqual(appels(), [], 'la méthode d\'auteur n\'est jamais appelée')
    assert.equal(hote.isConnected, false, 'la zone a quitté la page')
    assert.equal(win.document.querySelector('#zr2 .neuf')?.textContent, 'NEUF', 'la page qui arrive est affichée à sa place')
  })

  it('navigation « replace » sur un composant sans méthode d\'auteur : la zone cède sa place (garde)', async function () {
    const { win, hote, appels } = await ouvrir('<mjs-sonde-libre id="zr"></mjs-sonde-libre>', 'mjs-sonde-libre')
    const neuf = win.document.createElement('div')
    neuf.id = 'zr2'
    neuf.innerHTML = '<p class="neuf">NEUF</p>'
    win.µ._mjs_navInstallNodes({ zone: hote, mode: 'target', target: '#zr' }, [neuf], 'replace')
    assert.deepEqual(appels(), [])
    assert.equal(hote.isConnected, false, 'la zone a quitté la page')
    assert.equal(win.document.querySelector('#zr2 .neuf')?.textContent, 'NEUF')
  })

  it('focus d\'après navigation sur la balise d\'un composant à @focus : la balise prend le focus, sans appeler la méthode d\'auteur', async function () {
    const { win, hote, appels } = await ouvrir('<mjs-sonde-focus id="zf"></mjs-sonde-focus>', 'mjs-sonde-focus')
    let recus = 0
    hote.addEventListener('focus', () => { recus++ })
    win.µ._mjs_focusAfterSwap(hote)
    assert.deepEqual(appels(), [], 'la méthode d\'auteur n\'est jamais appelée')
    assert.equal(hote._shadow.querySelector('.sel').textContent, 'aucun', 'l\'état de l\'auteur n\'a pas reçu l\'objet d\'options')
    assert.equal(recus, 1, 'la balise a pris le focus')
  })

  it('rejeu d\'un @confirm accepté sur la balise d\'un composant à @click (cible du clic) : un vrai clic est rejoué, sans appeler la méthode d\'auteur', async function () {
    const { win, hote, appels } = await ouvrir('<mjs-sonde-clic id="zc" mjs-confirm="Sûr ?"></mjs-sonde-clic>', 'mjs-sonde-clic')
    let clics = 0
    hote.addEventListener('click', () => { clics++ })
    win.µ._mjs_ujsConfirmRefire(hote, null, hote)
    assert.deepEqual(appels(), [], 'la méthode d\'auteur n\'est jamais appelée')
    assert.equal(clics, 1, 'le clic accepté est rejoué sur la balise')
    assert.equal(hote.getAttribute('mjs-confirm'), 'Sûr ?', 'la question est remise en place après le rejeu')
  })

  it('rejeu d\'un @confirm accepté sur la balise d\'un composant à @click (le porteur lui-même) : un vrai clic est rejoué, sans appeler la méthode d\'auteur', async function () {
    const { win, hote, appels } = await ouvrir('<mjs-sonde-clic id="zc" mjs-confirm="Sûr ?"></mjs-sonde-clic>', 'mjs-sonde-clic')
    let clics = 0
    hote.addEventListener('click', () => { clics++ })
    win.µ._mjs_ujsConfirmRefire(hote, null, null)
    assert.deepEqual(appels(), [], 'la méthode d\'auteur n\'est jamais appelée')
    assert.equal(clics, 1, 'le clic accepté est rejoué sur la balise')
  })

  it('rejeu d\'un @confirm accepté sur un composant sans méthode d\'auteur : le clic est rejoué (garde)', async function () {
    const { win, hote, appels } = await ouvrir('<mjs-sonde-libre id="zl" mjs-confirm="Sûr ?"></mjs-sonde-libre>', 'mjs-sonde-libre')
    let clics = 0
    hote.addEventListener('click', () => { clics++ })
    win.µ._mjs_ujsConfirmRefire(hote, null, hote)
    assert.deepEqual(appels(), [])
    assert.equal(clics, 1)
  })
})
