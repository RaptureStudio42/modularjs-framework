// Rendu serveur : `shadowHtml` (l'ombre de la racine, hors de sa propre feuille) est le même par les deux moteurs, happy-dom et le
// navigateur réel, sur une page à composants imbriqués : l'ombre de chaque descendant y est, dans son `<template shadowrootmode>`
// avec sa feuille, à tout niveau. Le navigateur n'en donnait que l'ombre de la racine, ses sous-composants vides, et sa feuille en tête

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { createBrowserRenderer, resolveBrowserEngine } from '../src/server/render-browser.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCES: Record<string, string> = {
  'page.mjs':  '<div class="cadre"><@carte titre="a"></div>\n<@carte titre="b">\n<style>\n.cadre\n  color: red\n</style>\n',
  'carte.mjs': '<p class="t">{$titre}</p>\n<@puce>\n<style>\n.t\n  color: blue\n</style>\n',
  'puce.mjs':  '<i class="p">x</i>\n<style>\n.p\n  color: green\n</style>\n'
}

describe('rendu serveur : shadowHtml, le même par les deux moteurs', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('page à composants imbriqués : l\'ombre de chaque descendant est dans shadowHtml, comme par happy-dom', async function () {
    if (!(await resolveBrowserEngine())) { this.skip(); return }
    const root = mjsTmp('shadowhtml-deux-moteurs')
    mkdirSync(join(root, 'src'), { recursive: true })
    for (const [nom, code] of Object.entries(SOURCES)) writeFileSync(join(root, 'src', nom), code)
    const happy = await createSSRRenderer({ sourceDir: join(root, 'src'), outputDir: join(root, 'out-happy') } as any)
    let attendu: any
    try {
      attendu = await happy.renderToString('mjs-page', {})
    } finally {
      await happy.close()
    }
    assert.equal((attendu.shadowHtml.match(/<template shadowrootmode=/g) || []).length, 4, 'témoin : happy-dom écrit l\'ombre des deux cartes et de leurs puces')
    const navigateur = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out' }, { configDir: root })
    let rendu: any
    try {
      rendu = await navigateur.renderPage('mjs-page', {})
    } finally {
      await navigateur.close()
    }
    assert.equal(rendu.shadowHtml, attendu.shadowHtml)
  })
})
