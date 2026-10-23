// En surveillance, une rafale d'écritures (rechercher-remplacer, changement de branche, formateur) donne une seule
// construction : les chemins arrivés ensemble, ou pendant une construction en vol, partent dans le même tour, qui voit
// tous les fichiers. Avant : une construction complète, et un rechargement de page, par fichier touché.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const simple = (texte: string) => ['<script>', '  $x = 1', '</script>', `<p>{$x} ${texte}</p>`].join('\n')
const attendre = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('surveillance : une rafale d\'écritures, une construction', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('12 fichiers écrits d\'un coup → un seul compile(), qui voit les 12 changements', async () => {
    const root = mjsTmp('watch-rafale')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(src, { recursive: true })
    for (let i = 0; i < 12; i++) writeFileSync(join(src, `c${i}.mjs`), simple(`v1-${i}`))
    const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js') })
    let compiles = 0
    const origine = b.compile.bind(b)
    ;(b as any).compile = async () => { compiles++; return origine() }
    const tours: string[] = []
    await b.watch({ onRecompile: (chemin) => tours.push(chemin) })
    assert.deepEqual(tours, ['<initial>'])
    const initial = compiles

    for (let i = 0; i < 12; i++) writeFileSync(join(src, `c${i}.mjs`), simple(`v2-${i}`))
    const debut = Date.now()
    while (tours.length < 2 && Date.now() - debut < 20000) await attendre(50)
    // fenêtre de grâce : une construction de trop arriverait ici
    await attendre(1500)
    assert.equal(compiles - initial, 1, `constructions pour la rafale : ${compiles - initial} (tours : ${tours.length - 1})`)
    assert.equal(tours.length, 2)
    const derniere = b.manifest
    for (let i = 0; i < 12; i++) {
      const fichier = join(out, derniere[`c${i}`].split('/').pop()!)
      assert.ok(readFileSync(fichier, 'utf-8').includes(`v2-${i}`), `c${i} construit dans sa nouvelle version`)
    }
  })
})
