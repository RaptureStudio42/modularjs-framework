// Composant léger (`mjs-light`) posé dans l'ombre d'un composant hôte, sous CSP (`µ._csp`) : sa feuille est une
// CSSStyleSheet construite, adoptée par l'ombre de l'hôte. La table qui la retient pour le rechargement CSS à chaud
// (`µ._mjs_lightSheetsByTag`) ne gardait jamais rien en moins : une feuille neuve par ombre adoptante, et une de plus à
// chaque reconnexion de l'hôte (son rendu repose ses propres feuilles, le léger réadopte la sienne). Une liste d'hôtes
// montés puis retirés la faisait grossir sans fin. Règle : UNE feuille par balise et par texte, partagée par toutes les
// racines qui l'adoptent ; la table reste bornée au nombre de balises, et le rechargement à chaud la retrouve toujours.
// Les vérifications de présence se font après une reconnexion du seul léger (réinséré dans l'ombre de son hôte) : elle
// (ré)adopte la feuille quel que soit l'ordre dans lequel le moteur connecte l'hôte et les nœuds de son ombre.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const ENFANT = [
  '<script lang="coffee">',
  '$titre = "salut"',
  '</script>',
  '<p class="t">{$titre}</p>',
  '<style>',
  ':host',
  '  padding: 1px',
  '.t',
  '  color: red',
  '</style>',
].join('\n')

const HOTE = [
  '<div class="cadre">',
  '  <@enfantcsp mjs-light>',
  '</div>',
].join('\n')

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const sheetText = (sheet: any): string => Array.from(sheet.cssRules).map((r: any) => r.cssText).join(' ')
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms))

async function harnais() {
  const root = mjsTmp('leger-csp-borne')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'enfantcsp.mjs'), ENFANT)
  writeFileSync(join(srcDir, 'hotecsp.mjs'), HOTE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const window: any = new Window({ url: 'http://localhost/' })
  const files = readdirSync(outDir)
  const coreFile = files.find((f: string) => /^mjs_core-/.test(f))
  const enfantFile = files.find((f: string) => /^enfantcsp-/.test(f))
  const hoteFile = files.find((f: string) => /^hotecsp-/.test(f))
  assert.ok(coreFile && enfantFile && hoteFile, `sortie du build inattendue : ${files.join(', ')}`)
  window.eval([
    stripEsm(readFileSync(join(outDir, coreFile!), 'utf-8')),
    'globalThis.µ = µ;',
    stripEsm(readFileSync(join(outDir, enfantFile!), 'utf-8')),
    stripEsm(readFileSync(join(outDir, hoteFile!), 'utf-8')),
  ].join('\n'))
  // happy-dom ne pose pas l'attribut avant le constructeur d'un enfant composé : repli officiel du runtime
  window.customElements.get('mjs-enfantcsp').mjsLight = true
  window.µ._csp = true
  return { window, document: window.document, µ: window.µ }
}

// la feuille du léger adoptée par l'ombre de cet hôte (texte réécrit par balise)
const feuilleDe = (hote: any) => hote._shadow.adoptedStyleSheets.find((s: any) => sheetText(s).indexOf('mjs-enfantcsp') !== -1)

describe('léger dans une ombre, sous CSP : une feuille par balise, table bornée', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  // l'hôte déplacé : sa reconnexion repose ses feuilles, celle du léger réadopte la sienne
  const deplacer = async (document: any, hote: any) => {
    document.body.appendChild(hote)
    await tick()
  }

  // le seul léger reconnecté, réinséré à sa place dans l'ombre de l'hôte
  const readopter = async (hote: any) => {
    const enfant: any = hote._shadow.querySelector('mjs-enfantcsp')
    enfant.parentNode.appendChild(enfant)
    await tick()
  }

  it('douze hôtes montés puis retirés tour à tour : la table garde une seule feuille, partagée', async () => {
    const { document, µ } = await harnais()
    let hote: any
    for (let i = 0; i < 12; i++) {
      document.body.innerHTML = '<mjs-hotecsp></mjs-hotecsp>'
      await tick()
      hote = document.body.querySelector('mjs-hotecsp')
      const enfant: any = hote._shadow.querySelector('mjs-enfantcsp')
      assert.ok(enfant && enfant._mjs_isLight === true, 'le léger doit être monté dans l\'ombre de l\'hôte, en mode léger')
      await deplacer(document, hote)
    }
    await readopter(hote)
    const entrees = µ._mjs_lightSheetsByTag.get('mjs-enfantcsp')
    assert.equal(entrees.length, 1, `une seule feuille retenue pour la balise, ${entrees.length} trouvées`)
    assert.ok(feuilleDe(hote) === entrees[0].sheet, 'l\'ombre du dernier hôte adopte la feuille de la table')
  })

  it('un même hôte déplacé dix fois : chaque reconnexion réadopte la même feuille, sans en créer une autre', async () => {
    const { document, µ } = await harnais()
    document.body.innerHTML = '<div id="a"><mjs-hotecsp></mjs-hotecsp></div><div id="b"></div>'
    await tick()
    const hote: any = document.body.querySelector('mjs-hotecsp')
    await readopter(hote)
    const premiere = feuilleDe(hote)
    assert.ok(premiere, 'feuille adoptée par l\'ombre de l\'hôte')
    for (let i = 0; i < 10; i++) {
      document.getElementById(i % 2 ? 'a' : 'b').appendChild(hote)
      await tick()
    }
    await readopter(hote)
    assert.ok(feuilleDe(hote) === premiere, 'après les déplacements, l\'ombre porte toujours la même feuille')
    assert.equal(hote._shadow.adoptedStyleSheets.filter((s: any) => s === premiere).length, 1, 'adoptée une seule fois, jamais en double')
    assert.equal(µ._mjs_lightSheetsByTag.get('mjs-enfantcsp').length, 1, 'aucune feuille de plus dans la table')
  })

  it('rechargement à chaud : la feuille est remplacée en place dans toutes les ombres vivantes', async () => {
    const { document, µ } = await harnais()
    document.body.innerHTML = '<mjs-hotecsp id="h1"></mjs-hotecsp><mjs-hotecsp id="h2"></mjs-hotecsp>'
    await tick()
    const h1: any = document.getElementById('h1')
    const h2: any = document.getElementById('h2')
    await readopter(h1)
    await readopter(h2)
    assert.match(sheetText(feuilleDe(h1)), /color: red/)
    assert.equal(µ._hotCss({ components: { 'mjs-enfantcsp': ':host{color:blue}' } }), true)
    for (const hote of [h1, h2]) {
      const texte = sheetText(feuilleDe(hote))
      assert.match(texte, /color: blue/, 'nouveau CSS dans l\'ombre de ' + hote.id)
      assert.doesNotMatch(texte, /:host/, 'sélecteur toujours réécrit par balise')
    }
  })
})
