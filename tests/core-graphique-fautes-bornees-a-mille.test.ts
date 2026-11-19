// <@@chart> dit chaque donnée fautive une fois par page, et la table qui s'en souvient garde 1 000 fautes au plus : des données fautives
// sans fin (une date impossible par ligne) ne la font plus grossir sans fin. La 1 001e dit une seule fois, au vouvoiement, que les données
// fautives suivantes ne sont plus listées ; les fautes d'après ne disent plus rien
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'

// 1 200 dates impossibles distinctes (le 30 février de 1 200 années), entre deux jours qui existent
const HOTE = `<script>
  $une    = [{ key: 'v', name: 'Valeur' }]
  $lignes = [{ x: '2026-01-05', v: 1 }, ...Array.from({ length: 1200 }, (_, i) => ({ x: (1000 + i) + '-02-30', v: 2 })), { x: '2026-01-12', v: 3 }]
</script>
<@@chart class="fautes" rows={$lignes} series={$une} step="week"></@@chart>
`

describe('<@@chart> — la table des données fautives bornée à 1 000', function () {
  this.timeout(120000)

  let erreurs: string[] = []
  let avis: string[]    = []

  before(async () => {
    const root   = mjsTmp('graphique-fautes-bornees')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
    const code  = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    window.eval(`${code}\nglobalThis.µ = µ;\nglobalThis.__erreurs = [];\nglobalThis.__avis = [];\nµ.error = function(...a) { globalThis.__erreurs.push(a.map(String).join(' ')); };\nµ.warn = function(...a) { globalThis.__avis.push(a.map(String).join(' ')); };`)
    window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
    const hote = window.document.querySelector('mjs-hote')
    await attendre(() => !!hote._shadow && !!hote._shadow.querySelector('mjs-core-chart')?._shadow?.querySelector('.chart'))
    await pause(150)
    erreurs = window.eval('globalThis.__erreurs')
    avis    = window.eval('globalThis.__avis')
    await window.happyDOM.close()
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('1 200 données fautives distinctes : 1 000 dites, une par une', () => {
    const dites = erreurs.filter((e) => /n'est pas une date qui existe/.test(e))
    assert.equal(dites.length, 1000)
    assert.match(dites[0], /« 1000-02-30 »/)
    assert.match(dites[999], /« 1999-02-30 »/)
  })

  it('un seul avertissement de fin, au vouvoiement : les suivantes ne sont plus listées', () => {
    const fin = avis.filter((a) => /ne sont plus listées/.test(a))
    assert.equal(fin.length, 1, avis.join('\n'))
    assert.match(fin[0], /<@@chart> : 1000 données fautives sont déjà signalées sur cette page ; les suivantes ne sont plus listées\. Corrigez d'abord celles-ci\./)
  })
})
