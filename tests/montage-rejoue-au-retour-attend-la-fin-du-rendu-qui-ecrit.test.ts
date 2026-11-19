// µmount rejoué au retour d'un composant remis dans la page après sa destruction part à la fin du rendu de ce retour, même quand ce rendu
// écrit une variable. Un `{if}` ouvert pendant l'absence crée au retour une balise à `clientWidth=!{$largeur}`, placée avant une balise
// `:this` : la largeur mesurée qu'elle écrit passait par le chemin synchrone de `_mjs_invalidate`, qui relançait µmount sur-le-champ, avant
// la référence que le même rendu repose plus loin (`null` au montage rejoué). happy-dom n'a pas de mise en page (largeur 0, rien ne
// s'écrit) : la largeur des `<div>` est posée sur leur prototype, avant le montage

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { attendre, pause } from './helpers/coeur-monter.js'
import { mjsTmp } from './helpers/tmp.js'

// un composant qui a un µdestroy est détruit à sa sortie, µmount rejoue à son retour ; `__journal` note les crochets dans leur ordre, et
// pour µmount la balise que tient alors sa référence `:this`
const SOURCE = `
<script>
  $voir ?= false
  $largeur ?= 0
  toile = null

  µawake ->
    window.__journal.push('awake')

  µmount ->
    nom = if toile then toile.tagName else 'null'
    window.__journal.push('mount ' + nom)

  µdestroy ->
    window.__journal.push('destroy')
</script>

{if $voir}<div clientWidth=!{$largeur}></div>{end}<canvas :this=!{toile} width="10" height="10"></canvas><p>{$largeur}</p>
`

// l'hôte compilé par le vrai Bundler, monté dans une page dont les `<div>` mesurent 120 de large, retiré jusqu'à sa destruction, puis remis
// dans la page ; `ouvrir` ouvre le `{if}` pendant son absence
async function remettre(ouvrir: boolean, prefixe: string): Promise<{ window: any; hote: any }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), SOURCE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  Object.defineProperty(window.HTMLDivElement.prototype, 'clientWidth', { get: () => 120, configurable: true })
  window.eval(`${code}\nglobalThis.µ = µ;\nglobalThis.__journal = [];`)
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const hote = window.document.querySelector('mjs-hote')
  await attendre(() => window.__journal.length > 1)
  await pause(60)
  hote.remove()
  await attendre(() => window.__journal.includes('destroy'))
  await pause(40)
  if (ouvrir) hote._set('voir', true)
  window.document.body.appendChild(hote)
  await attendre(() => window.__journal.length > 4)
  await pause(60)
  return { window, hote }
}

describe('µmount rejoué au retour attend la fin du rendu de ce retour, même quand ce rendu écrit une variable', function () {
  this.timeout(40000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('remis dans la page, le `{if}` ouvert pendant son absence écrit la largeur mesurée : µmount rejoué lit la référence `:this` posée après', async () => {
    const { window, hote } = await remettre(true, 'retour-qui-ecrit')
    assert.equal(hote._shadow.querySelector('p').textContent, '120', 'le rendu du retour a écrit la largeur mesurée')
    assert.ok(hote._shadow.querySelector('div'), 'le `{if}` ouvert pendant l\'absence est rendu au retour')
    assert.deepEqual([...window.__journal], ['awake', 'mount CANVAS', 'destroy', 'awake', 'mount CANVAS'], 'au retour : µawake, puis µmount rejoué, la référence du canevas déjà reposée')
    hote._set('largeur', 300)
    await pause(60)
    assert.equal(hote._shadow.querySelector('p').textContent, '300', 'une écriture après le retour passe à l\'écran')
    assert.equal(window.__journal.length, 5, 'µmount rejoué une seule fois')
    window.close?.()
  })

  it('remis dans la page sans écriture au retour : µawake, puis µmount rejoué, la référence reposée', async () => {
    const { window, hote } = await remettre(false, 'retour-sans-ecriture')
    assert.equal(hote._shadow.querySelector('p').textContent, '0', 'rien d\'écrit au retour')
    assert.deepEqual([...window.__journal], ['awake', 'mount CANVAS', 'destroy', 'awake', 'mount CANVAS'], 'au retour : µawake, puis µmount rejoué')
    window.close?.()
  })
})
