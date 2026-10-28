// Ce que ce test garantit : au prérendu, un avertissement qui revient dans le rendu de plusieurs pages et de plusieurs
// langues s'imprime UNE fois, avec les pages et les langues qu'il concerne. Ceux de la compilation reviennent dans le
// rendu de chaque page et de chaque langue : un site de 8 pages en 2 langues imprimait chacun 16 fois. Un avertissement
// propre à une page garde le nom de sa page, et lui seul ; sans langues déclarées, une page seule garde sa ligne d'avant.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { prerenderPages } from '../src/server/prerender.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

function projet(): string {
  const root = mjsTmp('prerender-avertissements')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'accueil.mjs'), '<script>\n$titre = \'Accueil\'\n</script>\n<h1>{$titre}</h1>\n')
  // promesse jamais résolue : le rendu de CETTE page ne se stabilise pas, avertissement propre à la page
  writeFileSync(join(root, 'src', 'lente.mjs'), '<script>\n$p = new Promise(->)\n</script>\n{await $p}<span>attente</span>{success v}<span>{v}</span>{end}\n')
  // composant sans HTML : avertissement de la compilation, rendu avec chaque page
  writeFileSync(join(root, 'src', 'vide.mjs'), '<script>\nx = 1\n</script>\n')
  return root
}

async function prerendre(root: string, routes: Record<string, { component: string, settleMs?: number }>, locales?: string[]): Promise<string[]> {
  const lignes: string[] = []
  const render = { default: 'prerender' as const, engine: { prerender: 'happy-dom' as const }, routes, ...(locales ? { locales } : {}) }
  const report = await prerenderPages({ sourceDir: 'src', outputDir: 'public/out', render } as any, root, l => lignes.push(l))
  assert.equal(report.skipped.length, 0, `aucune page en échec :\n${lignes.join('\n')}`)
  return lignes
}

describe('prérendu — chaque avertissement une seule fois', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  it('4 pages en 2 langues : l\'avertissement de la compilation sort une fois, celui d\'une page une fois avec sa page', async () => {
    const lignes = await prerendre(projet(), {
      '/':      { component: 'mjs-accueil' },
      '/a':     { component: 'mjs-accueil' },
      '/b':     { component: 'mjs-accueil' },
      '/lente': { component: 'mjs-lente', settleMs: 30 },
    }, ['fr', 'en'])
    const journal = lignes.join('\n')
    const vide    = lignes.filter(l => l.includes('⚠️') && /vide\.mjs/.test(l))
    const lente   = lignes.filter(l => l.includes('⚠️') && /non stabilisé/.test(l))
    assert.equal(vide.length, 1, `l'avertissement de la compilation sort une fois, pas une fois par page et par langue :\n${journal}`)
    assert.match(vide[0], /^ {3}⚠️ {2}4 pages \[fr, en\] : /, `il dit le nombre de pages et les langues :\n${vide[0]}`)
    assert.equal(lente.length, 1, `l'avertissement propre à une page sort une fois :\n${journal}`)
    assert.match(lente[0], /^ {3}⚠️ {2}\/lente \[fr, en\] : /, `il nomme sa page et ses langues, et rien d'autre :\n${lente[0]}`)
    assert.equal(lignes.filter(l => l.includes('✓')).length, 8, `les 8 rendus sont écrits :\n${journal}`)
  })

  it('sans langues déclarées : deux pages nommées, et la page seule garde sa ligne', async () => {
    const lignes = await prerendre(projet(), {
      '/':      { component: 'mjs-accueil' },
      '/lente': { component: 'mjs-lente', settleMs: 30 },
    })
    const journal = lignes.join('\n')
    const vide    = lignes.filter(l => l.includes('⚠️') && /vide\.mjs/.test(l))
    const lente   = lignes.filter(l => l.includes('⚠️') && /non stabilisé/.test(l))
    assert.equal(vide.length, 1, `une fois pour les deux pages :\n${journal}`)
    assert.match(vide[0], /^ {3}⚠️ {2}\/, \/lente : /, `les deux pages sont nommées :\n${vide[0]}`)
    assert.equal(lente.length, 1, `une fois :\n${journal}`)
    assert.match(lente[0], /^ {3}⚠️ {2}\/lente : \[mjs-ssr\] rendu de <mjs-lente> non stabilisé en 30ms/, `la ligne d'une page seule ne change pas :\n${lente[0]}`)
  })
})
