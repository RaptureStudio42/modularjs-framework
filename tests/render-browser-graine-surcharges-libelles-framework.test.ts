// Le rendu par le moteur navigateur sème dans la graine `#__mjs_i18n` les surcharges des libellés du framework (`mjs.<groupe>.<clé>` du
// dictionnaire racine) de la langue du rendu, comme le moteur happy-dom : `µ._mjs_label` les lit sans les noter, et sans elles la reprise,
// qui dessine avant l'arrivée du fichier de langue, remplacerait les textes du serveur par les libellés par défaut. Seule la langue du rendu
// est semée, jamais les surcharges d'une autre langue.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const PAGE = `<script>
  $choix = null
</script>
<h1 class="t">{µt('/titre')}</h1>
<@@select class="liste" value=!{$choix}>
  <@@option value="a">Alpha</@@option>
  <@@option value="b">Bêta</@@option>
</@@select>
`

function projet(prefixe: string, defaut: string): { root: string, config: any } {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  mkdirSync(join(srcDir, 'i18n'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\nmjs:\n  core:\n    selectPlaceholder: Votre choix\n')
  writeFileSync(join(srcDir, 'i18n', 'en.yml'), 'titre: Title\nmjs:\n  core:\n    selectPlaceholder: Your pick\n')
  writeFileSync(join(srcDir, 'home.mjs'), PAGE)
  return { root, config: { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', i18n: { default: defaut } } }
}

function graineDe(texte: string): any {
  const m = texte.match(/<script[^>]*id="__mjs_i18n"[^>]*>([\s\S]*?)<\/script>/)
  assert.ok(m, 'la page porte sa graine de traduction')
  return JSON.parse(m![1])
}

describe('render-browser — graine : surcharges des libellés du framework', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const CAS = [
    { defaut: 'fr', autre: 'en', titre: 'Titre', choix: 'Votre choix' },
    { defaut: 'en', autre: 'fr', titre: 'Title', choix: 'Your pick' },
  ]

  for (const c of CAS) it(`langue du rendu « ${c.defaut} » : la graine porte ses surcharges mjs.*, pas celles de « ${c.autre} »`, async () => {
    const { root, config } = projet('graine-surcharges-' + c.defaut, c.defaut)
    const renderer = await createBrowserRenderer(config, { configDir: root })
    try {
      const res = await renderer.renderPage('mjs-home', { settleMs: 5000, ssrMode: 'markers' })
      assert.ok(res.html.includes(c.choix), 'la page rendue montre la surcharge du projet')
      const graine = graineDe(res.sharedScript + res.html)
      assert.equal(graine.lang, c.defaut)
      assert.deepEqual(graine.root, { [c.defaut]: { titre: c.titre, mjs: { core: { selectPlaceholder: c.choix } } } })
    }
    finally { await renderer.close() }
  })
})
