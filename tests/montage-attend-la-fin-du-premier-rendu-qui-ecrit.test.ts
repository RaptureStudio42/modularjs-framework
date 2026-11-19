// µmount part à la fin du premier rendu, même quand ce rendu écrit une variable. La liaison `clientWidth=!{$largeur}` d'une balise
// placée avant une balise `:this` écrit la largeur mesurée pendant le premier rendu ; cette écriture passait par le chemin synchrone
// de `_mjs_invalidate`, qui lançait µmount sur-le-champ, avant la référence posée plus loin dans le même rendu (`null` au montage,
// `getContext` sur `null` dans un vrai composant). happy-dom n'a pas de mise en page (largeur 0, rien ne s'écrit) : la largeur et la
// hauteur des `<div>` sont posées sur leur prototype, avant le montage

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { attendre, pause } from './helpers/coeur-monter.js'
import { mjsTmp } from './helpers/tmp.js'

// l'hôte compilé par le vrai Bundler, monté dans une page dont les `<div>` mesurent 120 × 80 ; `__montages` compte les µmount
async function monterMesure(source: string, prefixe: string): Promise<{ window: any; hote: any }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  Object.defineProperty(window.HTMLDivElement.prototype, 'clientWidth', { get: () => 120, configurable: true })
  Object.defineProperty(window.HTMLDivElement.prototype, 'clientHeight', { get: () => 80, configurable: true })
  window.eval(`${code}\nglobalThis.µ = µ;\nglobalThis.__montages = 0;`)
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const hote = window.document.querySelector('mjs-hote')
  await attendre(() => window.__montages > 0)
  await pause(60)
  return { window, hote }
}

describe('µmount attend la fin du premier rendu qui écrit une variable', function () {
  this.timeout(40000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('la référence `:this` posée après une liaison de largeur qui écrit pendant le premier rendu est là au montage', async () => {
    const { window, hote } = await monterMesure(`
<script>
  $largeur ?= 0
  toile = null

  µmount ->
    window.__montages++
    window.__toile = if toile then toile.tagName else 'null'
</script>

<div class="cadre" clientWidth=!{$largeur}><canvas :this=!{toile} width="10" height="10"></canvas><p>{$largeur}</p></div>
`, 'montage-ref')
    assert.equal(hote._shadow.querySelector('p').textContent, '120', 'le premier rendu a écrit la largeur mesurée')
    assert.equal(window.__toile, 'CANVAS', 'µmount lit la référence du canevas, posée après la liaison de largeur')
    window.close?.()
  })

  it('deux écritures pendant le premier rendu : µmount part une seule fois, après toutes les références et les valeurs écrites', async () => {
    const { window, hote } = await monterMesure(`
<script>
  $largeur ?= 0
  $hauteur ?= 0
  toile = null
  texte = null

  µmount ->
    window.__montages++
    a = if toile then toile.tagName else 'null'
    b = if texte then texte.tagName else 'null'
    window.__seenMark = [a, b, $largeur, $hauteur].join(' ')
</script>

<div class="cadre" clientWidth=!{$largeur} clientHeight=!{$hauteur}><canvas :this=!{toile} width="10" height="10"></canvas></div><p :this=!{texte}>{$largeur} x {$hauteur}</p>
`, 'montage-une-fois')
    assert.equal(window.__seenMark, 'CANVAS P 120 80', 'au montage : les deux références et les deux valeurs écrites par le premier rendu')
    hote._set('largeur', 300)
    await pause(60)
    assert.equal(hote._shadow.querySelector('p').textContent, '300 x 80', 'une écriture après le montage passe à l\'écran')
    assert.equal(window.__montages, 1, 'µmount une seule fois')
    window.close?.()
  })
})
