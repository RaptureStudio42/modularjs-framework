// Ce que le build embarque pour l'attente des textes traduits. Le défaut (`wait`) n'a besoin d'aucun code d'effet : l'accroche de
// l'indicateur de chargement (`*loader`) et son effet ne partent que si une page ou la configuration les écrit — comme les effets,
// détectés dans le code compilé. Le rendu des barres grises est toujours au cœur d'une appli traduite : le secours de `wait`
// (trois secondes sans textes, le module paraît avec des barres) s'en sert. Une appli sans traduction n'est pas touchée.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// des chaînes que le cœur écrit en toutes lettres, minifié ou non : le rendu des barres, l'accroche de l'indicateur, le code de l'effet *loader
const BARRES     = 'mjs-i18n-skel'
const ACCROCHE   = 'mjs-i18n-loader'
const EFFET      = 'mjs-fx-loader-style'
const EFFET_SQUELETTE = 'mjs-fx-layer="skeleton"'

const page = (directive = '') => ["@i18n 'accueil'", directive, '<h1>{µt(\'titre\')}</h1>', ''].join('\n')
const nue  = '<p>rien à traduire</p>\n'

interface Build { sortie: string, coeur: string, fichiers: Record<string, string>, manifeste: string }

async function batir(opts: { prod: boolean, i18n?: Record<string, unknown> | null, js?: 'split' | 'bundle', sources?: Record<string, string> }): Promise<Build> {
  const root   = mjsTmp('i18n-attente-bundle')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  if (opts.i18n !== null) {
    mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
    writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
    writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'titre: Bonjour\n')
  }
  for (const [nom, src] of Object.entries(opts.sources ?? { vue: page() })) writeFileSync(join(srcDir, `${nom}.mjs`), src)
  const bundler = new Bundler({
    sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), forceMinify: opts.prod, js: opts.js,
    ...opts.i18n === null ? {} : { i18n: { default: 'fr', ...opts.i18n } },
  } as any)
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const fichiers: Record<string, string> = {}
  for (const f of readdirSync(outDir)) if (f.endsWith('.js')) fichiers[f] = readFileSync(join(outDir, f), 'utf-8')
  const coeurNom = Object.keys(fichiers).find(f => /^mjs_core-/.test(f))
  return { sortie: outDir, coeur: coeurNom ? fichiers[coeurNom] : Object.values(fichiers).join('\n'), fichiers, manifeste: readFileSync(join(root, 'bundle.js'), 'utf-8') }
}

const tous = (b: Build) => Object.values(b.fichiers).join('\n')

describe('attente des textes traduits — ce que le build embarque', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    const env = prod ? 'production' : 'développement'

    it(`${env} : une appli sans traduction ne reçoit ni barres, ni indicateur`, async () => {
      const b = await batir({ prod, i18n: null, sources: { vue: nue } })
      for (const motif of [BARRES, ACCROCHE, EFFET, EFFET_SQUELETTE]) assert.equal(tous(b).includes(motif), false, motif)
    })

    it(`${env} : le défaut (wait) : le manifeste dit wait, le cœur porte les barres du secours, ni accroche ni effet`, async () => {
      const b = await batir({ prod })
      assert.match(b.manifeste, /"placeholder":"wait"/)
      assert.equal(b.manifeste.includes('"fx"'), false, 'aucun réglage d\'effet au manifeste')
      assert.equal(b.coeur.includes(BARRES), true, 'les barres du secours sont au cœur')
      for (const motif of [ACCROCHE, EFFET, EFFET_SQUELETTE]) assert.equal(tous(b).includes(motif), false, motif)
    })

    it(`${env} : wait et key écrits (page ou configuration) : comme le défaut`, async () => {
      for (const b of [await batir({ prod, i18n: { placeholder: 'wait' } }), await batir({ prod, i18n: { placeholder: 'key' } }), await batir({ prod, sources: { vue: page('@i18nPlaceholder key') } })]) {
        assert.equal(b.coeur.includes(BARRES), true)
        for (const motif of [ACCROCHE, EFFET, EFFET_SQUELETTE]) assert.equal(tous(b).includes(motif), false, motif)
      }
    })

    it(`${env} : *skeleton (page ou configuration) : rien de plus que le défaut — ni accroche, ni effet`, async () => {
      for (const b of [await batir({ prod, sources: { vue: page('@i18nPlaceholder *skeleton(color: #333)') } }), await batir({ prod, i18n: { placeholder: '*skeleton' } })]) {
        assert.equal(b.coeur.includes(BARRES), true, 'les barres sont au cœur')
        for (const motif of [ACCROCHE, EFFET, EFFET_SQUELETTE]) assert.equal(tous(b).includes(motif), false, motif)
      }
    })

    it(`${env} : *loader(bloom) dans une page : l'accroche au cœur, le code de l'effet dans le fichier du module qui l'écrit`, async () => {
      const b = await batir({ prod, sources: { vue: page('@i18nPlaceholder *loader(bloom)'), autre: page() } })
      assert.equal(b.coeur.includes(ACCROCHE), true, 'l\'accroche est au cœur')
      assert.equal(b.coeur.includes(EFFET), false, 'le code de l\'effet n\'est pas au cœur de toutes les pages')
      const effets = Object.keys(b.fichiers).filter(f => /^mjs_fx_loader-/.test(f))
      assert.equal(effets.length, 1, 'un fichier pour l\'effet')
      assert.equal(b.fichiers[effets[0]].includes(EFFET), true)
      const importeurs = Object.keys(b.fichiers).filter(f => b.fichiers[f].includes(effets[0].replace(/\.js$/, '')) && !/^mjs_fx_loader-/.test(f) && !/^mjs_core-/.test(f))
      assert.ok(importeurs.length >= 1, 'le module qui écrit l\'attente importe le fichier de l\'effet')
    })

    it(`${env} : *loader(bloom) dans la configuration : l'effet et le réglage partent avec le cœur`, async () => {
      const b = await batir({ prod, i18n: { placeholder: '*loader(bloom)' } })
      assert.equal(b.coeur.includes(ACCROCHE), true)
      assert.equal(b.coeur.includes(EFFET), true, 'l\'effet est au cœur : prêt avant le premier module')
      assert.match(b.manifeste, /"placeholder":"\*loader","fx":\{"style":"bloom"\}/)
    })
  }

  it('*loader(bloom) en un seul fichier (js: bundle) : tout y est', async () => {
    const b = await batir({ prod: true, js: 'bundle', sources: { vue: page('@i18nPlaceholder *loader(bloom)') } })
    const tout = tous(b) + b.manifeste
    assert.equal(tout.includes(ACCROCHE), true)
    assert.equal(tout.includes(EFFET), true)
  })
})
