// `mjs dev` sur un projet rangé sous un dossier dont le nom contient `.git` (`moi.github.io/`) : un fichier que réunit le
// manifeste externe hors de sourceDir (`#= require ../vendor/lib`) relance la construction quand il change, comme sous un
// dossier ordinaire. Son chemin se testait en entier contre les motifs d'exclusion : `.github.io` le faisait ignorer

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const attendre = (ms: number) => new Promise(r => setTimeout(r, ms))
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

describe('watch() : fichier du manifeste externe sous un dossier à point', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const parent of ['projets', 'moi.github.io']) {
    it(`projet sous « ${parent} » : modifier vendor/lib.js relance compile()`, async () => {
      const root = mjsTmp('watch-dep-externe')
      const p    = join(root, parent, 'app')
      mkdirSync(join(p, 'src'), { recursive: true })
      mkdirSync(join(p, 'vendor'), { recursive: true })
      writeFileSync(join(p, 'src', 'a.mjs'), '<p>a</p>\n')
      writeFileSync(join(p, 'vendor', 'lib.js'), 'window.LIB = 1\n')
      writeFileSync(join(p, 'src', 'manifest.coffee'), '#= require ../vendor/lib\n')
      const b = new Bundler({ sourceDir: join(p, 'src'), outputDir: join(p, 'out'), manifestPath: join(p, 'out', 'bundle.js'), manifestExternal: join(p, 'src', 'manifest.coffee') })
      const appels: string[] = []
      try {
        await muet(async () => {
          await b.watch({ onRecompile: c => appels.push(c) })
          // les fichiers du manifeste externe rejoignent l'observateur après le premier tour
          await attendre(1500)
          writeFileSync(join(p, 'vendor', 'lib.js'), 'window.LIB = 2\n')
          // jusqu'à 10 s : sous une machine chargée, la construction relancée tarde
          for (let i = 0; i < 100 && appels.length < 2; i++) await attendre(100)
        })
      }
      finally {
        await b.close()
      }
      assert.equal(appels.length, 2, `modification de vendor/lib.js non vue : ${JSON.stringify(appels)}`)
      assert.ok(appels[1].endsWith(join('vendor', 'lib.js')), appels[1])
    })
  }
})
