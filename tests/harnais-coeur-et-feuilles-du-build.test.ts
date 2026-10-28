// Le harnais de test d'une appli (`createHarness`) charge le cœur, les feuilles partagées et les effets de SA compilation, jamais les
// restes d'un build antérieur qui traînent dans le dossier de sortie.
//
// Le dossier de sortie d'un vrai projet garde des sorties d'avant que le ménage des empreintes ne retire pas (celles d'une 2.5 par
// exemple). Le harnais prenait le premier `mjs_core-*` que le dossier listait (ordre du système de fichiers, non garanti) et
// évaluait toute feuille ou tout effet dont le NOM ressemblait à une sortie : un ancien cœur pouvait porter `µ`, un ancien effet
// ou une ancienne feuille tournait dans la page simulée. Même règle que le rendu serveur : le cœur de la compilation
// (`coreHashedPath`), et seuls les fichiers qu'elle a écrits ou repris.

import assert from 'node:assert/strict'
import fs, { mkdirSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('harnais de test : le cœur, les feuilles et les effets de la compilation', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('les restes d\'un build antérieur sont ignorés, même listés en tête du dossier', async () => {
    const root   = mjsTmp('harnais-sorties-du-build')
    const sortie = join(root, 'out')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(sortie, { recursive: true })
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
    writeFileSync(join(root, 'src', 'carte.mjs'), '<script>\n$n = 1\n</script>\n<p class="t" *neon>Bonjour</p>\n<button class="b" @click={$n++}>+</button>\n<span class="n">{$n}</span>\n')
    // restes d'un build d'avant, posés à la main : absents du registre des sorties
    writeFileSync(join(sortie, 'mjs_core-00000.js'), 'const µ = { perime: true }\nexport { µ }\n')
    writeFileSync(join(sortie, 'mjs_styles-00000.js'), 'globalThis.feuillePerimee = true\n')
    writeFileSync(join(sortie, 'mjs_fx_neon-00000.js'), 'globalThis.effetPerime = true\n')
    // le dossier de sortie listé dans l'ordre le plus défavorable, restes en tête : le résultat ne dépend plus du système de fichiers
    const lireDossier = fs.readdirSync
    const restesEnTete = (liste: any[]) => [...liste].sort((a, b) => Number(/-00000\./.test(String(b))) - Number(/-00000\./.test(String(a))))
    fs.readdirSync = ((chemin: any, options?: any) => {
      const liste: any = lireDossier(chemin, options)
      return String(chemin) === sortie ? restesEnTete(liste) : liste
    }) as typeof fs.readdirSync
    syncBuiltinESMExports()
    try {
      const app = await createHarness({ root })
      try {
        assert.equal(app.µ.perime, undefined, 'µ vient du cœur de la compilation')
        assert.equal(app.window.feuillePerimee, undefined, 'l\'ancienne feuille partagée n\'est pas évaluée')
        assert.equal(app.window.effetPerime, undefined, 'l\'ancien effet n\'est pas évalué')
        const c = await app.mount('carte')
        assert.match(String(c.find('.t')?.getAttribute('mjs-fx') ?? ''), /neon/, 'l\'effet de la compilation se pose')
        await c.click('.b')
        assert.equal(c.text('.n'), '2')
      }
      finally {
        await app.destroy()
      }
    }
    finally {
      fs.readdirSync = lireDossier
      syncBuiltinESMExports()
    }
  })
})
