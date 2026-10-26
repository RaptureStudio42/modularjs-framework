// Le moteur navigateur amorce sa page sur le cœur de SA compilation, jamais sur le premier `mjs_core-*` du dossier de sortie.
//
// Le dossier de sortie d'un vrai projet garde des cœurs de builds antérieurs que le ménage des empreintes ne retire jamais (sorties
// d'avant le registre des sorties, celles d'une 2.5 par exemple). Un ancien cœur classé avant le neuf était importé par la page
// d'amorce : `µ.server` et le relevé des clés racine se posaient sur lui, pas sur le cœur que chargent les composants — la page se
// rendait comme chez le visiteur, et sa graine de traduction perdait ses textes racine.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

function graineDe(texte: string): any {
  const m = texte.match(/<script[^>]*id="__mjs_i18n"[^>]*>([\s\S]*?)<\/script>/)
  assert.ok(m, 'la page porte sa graine de traduction')
  return JSON.parse(m![1])
}

describe('render-browser — la page d\'amorce importe le cœur de la compilation du rendu', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un ancien cœur classé avant le neuf est ignoré : la graine garde ses textes racine', async () => {
    const root   = mjsTmp('coeur-du-build')
    const srcDir = join(root, 'src')
    mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
    mkdirSync(join(root, 'out'), { recursive: true })
    writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
    writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'salut: Bonjour\n')
    writeFileSync(join(srcDir, 'home.mjs'), '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')} / {µt(\'/titre\')}</h1>\n')
    // reste d'un build d'avant, posé à la main : absent du registre des sorties, comme les sorties d'une 2.5
    writeFileSync(join(root, 'out', 'mjs_core-00000000.js'), 'const µ = {}\nexport { µ }\n')
    const config   = { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', i18n: { default: 'fr' } }
    const renderer = await createBrowserRenderer(config as any, { configDir: root })
    try {
      const res = await renderer.renderPage('mjs-home', { settleMs: 5000, ssrMode: 'markers' })
      assert.match(res.html.replace(/<!--[\s\S]*?-->/g, ''), /Bonjour \/ Titre/)
      assert.deepEqual(graineDe(res.sharedScript + res.html).root, { fr: { titre: 'Titre' } })
    }
    finally { await renderer.close() }
  })

  it('la carte de source du cœur n\'est pas comptée comme un second cœur : aucun avertissement de cœurs multiples', async () => {
    const root = mjsTmp('coeur-carte-de-source')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'home.mjs'), '<h1 class="t">accueil</h1>\n')
    const config   = { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', sourceMap: 'always' }
    const journal: string[] = []
    const renderer = await createBrowserRenderer(config as any, { configDir: root, env: 'prod', log: (m: string) => { journal.push(m) } })
    try {
      assert.ok(readdirSync(join(root, 'out')).some(f => /^mjs_core-.+\.js\.map$/.test(f)), 'le cœur a sa carte de source')
      assert.doesNotMatch(journal.join('\n'), /mjs_core-\*\.js/)
    }
    finally { await renderer.close() }
  })
})
