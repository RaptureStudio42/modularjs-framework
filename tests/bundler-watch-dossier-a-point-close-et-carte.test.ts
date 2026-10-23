// Surveillance (watch()) et fichier unique (`js: 'bundle'`) :
// - un projet rangé sous un dossier dont le nom commence par un point ou contient `.git` (`moi.github.io/`,
//   `~/.projets/`) n'était jamais surveillé : les motifs d'exclusion se testaient sur le chemin complet. Seuls les
//   fichiers cachés DU PROJET restent ignorés
// - close() ne fermait que le pool de travailleurs : l'observateur continuait de relancer des constructions ; un
//   second watch() sur la même instance empilait un second observateur
// - en fichier unique avec carte de source (défaut en développement), la carte s'écrivait avant la création du
//   dossier du manifeste (ENOENT à chaque construction) et à chaque tour, même identique (boucle de reconstructions
//   quand le manifeste vit sous un dossier surveillé)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const attendre = (ms: number) => new Promise(r => setTimeout(r, ms))
const comp     = (texte: string) => `<p>${texte}</p>\n`
const muet     = async <T>(f: () => Promise<T>): Promise<T> => {
  const l = console.log
  const e = console.error
  console.log   = () => {}
  console.error = () => {}
  try {
    return await f()
  }
  finally {
    console.log   = l
    console.error = e
  }
}

describe('watch() : dossier parent à point, close(), carte du fichier unique', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const parent of ['moi.github.io', join('.projets', 'app')]) {
    it(`projet sous « ${parent} » : une édition relance compile(), un fichier caché du projet non`, async () => {
      const root = mjsTmp('watch-parent-point')
      const src  = join(root, parent, 'src')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'a.mjs'), comp('v1'))
      const b = new Bundler({ sourceDir: src, outputDir: join(root, 'out'), manifestPath: join(root, 'out', 'bundle.js') })
      const appels: string[] = []
      await muet(() => b.watch({ onRecompile: c => appels.push(c) }))
      writeFileSync(join(src, '.brouillon.mjs'), comp('caché'))
      await attendre(600)
      assert.deepEqual(appels, ['<initial>'], 'un fichier caché du projet reste ignoré')
      writeFileSync(join(src, 'a.mjs'), comp('v2'))
      for (let i = 0; i < 40 && appels.length < 2; i++) await attendre(100)
      await b.close()
      assert.equal(appels.length, 2, `édition non vue : ${JSON.stringify(appels)}`)
      assert.ok(appels[1].endsWith('a.mjs'))
    })
  }

  it('close() après watch() : plus aucune construction ; un second watch() vivant est refusé', async () => {
    const root = mjsTmp('watch-close')
    const src  = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'a.mjs'), comp('v1'))
    const b = new Bundler({ sourceDir: src, outputDir: join(root, 'out'), manifestPath: join(root, 'out', 'bundle.js') })
    const appels: string[] = []
    await muet(() => b.watch({ onRecompile: c => appels.push(c) }))
    await assert.rejects(() => b.watch(), /watch\(\)/)
    await b.close()
    writeFileSync(join(src, 'a.mjs'), comp('v2'))
    await attendre(1500)
    assert.deepEqual(appels, ['<initial>'], 'aucune construction après close()')
    // relançable après close()
    await muet(() => b.watch({ onRecompile: c => appels.push(c) }))
    await b.close()
    assert.equal(appels.length, 2)
  })

  it('js: "bundle" en développement, manifeste dans un dossier absent hors outputDir : construit dès le premier tour', async () => {
    const root = mjsTmp('bundle-dossier-absent')
    const src  = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'a.mjs'), comp('a'))
    const man = join(root, 'web', 'bundle.js')
    const b   = new Bundler({ sourceDir: src, outputDir: join(root, 'out'), manifestPath: man, js: 'bundle' } as any)
    for (const tour of [1, 2]) {
      const s = await b.compile()
      assert.equal(s.errors.length, 0, `tour ${tour} : ${s.errors.map((e: any) => e.message).join('\n')}`)
      assert.ok(existsSync(man) && existsSync(man + '.map'), `tour ${tour} : manifeste et carte écrits`)
    }
    await b.close()
  })

  // un manifeste sous sourceDir n'est admis que si la construction écrit dans le dossier des sources (outputDir dedans, sorties
  // marquées) : le manifeste et sa carte vivent alors sous le dossier surveillé
  it('js: "bundle" en développement, manifeste et sortie sous sourceDir : aucune reconstruction au repos', async () => {
    const root = mjsTmp('bundle-carte-repos')
    const src  = join(root, 'src')
    mkdirSync(join(src, 'public'), { recursive: true })
    writeFileSync(join(src, 'a.mjs'), comp('a'))
    const man = join(src, 'public', 'bundle.js')
    const b   = new Bundler({ sourceDir: src, outputDir: join(src, 'public'), manifestPath: man, js: 'bundle' } as any)
    const appels: string[] = []
    await muet(() => b.watch({ onRecompile: c => appels.push(c) }))
    // les événements de la construction initiale passent (au plus une reconstruction, lente sur une machine chargée) : on attend
    // 1,5 s sans nouvel appel ; ensuite, plus rien ne doit bouger
    for (let vu = -1, n = 0; vu !== appels.length && n < 20; n++) {
      vu = appels.length
      await muet(() => attendre(1500))
    }
    assert.ok(appels.length <= 2, `construction initiale suivie d'une boucle : ${JSON.stringify(appels)}`)
    const avant = appels.length
    const m0    = statSync(man + '.map').mtimeMs
    await muet(() => attendre(2500))
    await b.close()
    assert.equal(appels.length - avant, 0, `reconstructions au repos : ${JSON.stringify(appels.slice(avant))}`)
    assert.equal(statSync(man + '.map').mtimeMs, m0, 'carte identique non retouchée')
  })
})
