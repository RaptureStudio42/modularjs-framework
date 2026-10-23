// Un composant et un module du même nom (`cart.mjs` et `cart.civet`, motif naturel : un composant et sa logique) publiaient la même
// clé : le module prenait la place du composant, jamais écrit, et `<mjs-cart>` ne s'éveillait jamais, sur un build vert (un simple
// avertissement de collision qui parlait d'import 404). La construction échoue désormais, par une erreur qui nomme les deux fichiers ;
// un module renommé construit les deux.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const MODULE = 'export function total(x) { return x * 2 }\n'
const hote   = (chemin: string) => [`@import { total } '${chemin}'`, '<script>', '  $n = total(2)', '</script>', '<p>{$n}</p>', ''].join('\n')

async function construire(prefixe: string, fichiers: Record<string, string>) {
  const root = mjsTmp(prefixe)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(src, chemin)), { recursive: true })
    writeFileSync(join(src, chemin), contenu)
  }
  const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), keepFailedComponents: false })
  try {
    const stats = await b.compile()
    return { out, erreurs: stats.errors.map(e => e.message) }
  }
  finally {
    await b.close()
  }
}

describe('bundler — un composant et un module du même nom', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('cart.mjs et cart.civet dans le même dossier : erreur de construction qui nomme les deux fichiers', async () => {
    const { erreurs } = await construire('meme-nom-composant-module', { 'cart.civet': MODULE, 'cart.mjs': hote('cart.civet') })
    const nommee = erreurs.filter(m => m.includes('cart.mjs') && m.includes('cart.civet'))
    assert.equal(nommee.length, 1, 'une erreur qui nomme les deux fichiers : ' + JSON.stringify(erreurs))
    assert.match(nommee[0], /<mjs-cart>/, nommee[0])
  })

  it('le module dans un sous-dossier garde le même nom publié : même erreur', async () => {
    const { erreurs } = await construire('meme-nom-composant-module-dossier', { 'logique/cart.civet': MODULE, 'cart.mjs': hote('logique/cart.civet') })
    assert.equal(erreurs.filter(m => m.includes('cart.mjs') && m.includes(join('logique', 'cart.civet'))).length, 1, JSON.stringify(erreurs))
  })

  it('témoin : le module renommé, les deux sont écrits et le composant définit sa balise', async () => {
    const { out, erreurs } = await construire('meme-nom-composant-module-temoin', { 'cart-logique.civet': MODULE, 'cart.mjs': hote('cart-logique.civet') })
    assert.deepEqual(erreurs, [])
    const js = existsSync(out) ? readdirSync(out).filter(f => f.endsWith('.js')) : []
    const composant = js.filter(f => /^cart-[0-9a-z]{5}\.js$/.test(f))
    assert.equal(composant.length, 1, JSON.stringify(js))
    assert.ok(js.some(f => /^cart-logique-[0-9a-z]{5}\.js$/.test(f)), JSON.stringify(js))
    assert.match(readFileSync(join(out, composant[0]), 'utf-8'), /mjs-cart/)
  })
})
