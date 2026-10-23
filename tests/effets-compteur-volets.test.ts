// *count en volets : `*count(style: flip)` dessine chaque chiffre du nombre sur une carte qui bascule quand il change (un panneau d'aéroport).
// Ce fichier tient la construction : les réglages neufs (style, pad, speed, background, color) sont reconnus, une valeur inconnue est refusée
// comme pour les autres réglages, et le code des volets n'est dans le fichier de l'effet que si une page écrit `style: flip` (le zéro de tête
// `pad`, lui, ne part qu'avec `pad`) — une page qui compte sans volets ne paie ni leur style ni leur code. Le comportement se voit au banc
// navigateur (effets-compteur-volets-browser.test.ts).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as acorn from 'acorn'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { selectFxSections } from '../src/bundler/fx-sections.js'
import { fxSignal, fxUseSignal, FX_ANY } from '../src/bundler/features.js'
import { EFFECTS, parseEffect } from '../src/effects/catalog.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = readFileSync(join(import.meta.dirname, '../src/runtime/mjs_fx_count.ts'), 'utf-8')

// ce que le fichier de l'effet porte pour chaque section : un texte qui lui est propre
const VOLETS = 'function _mjsFxCountFlip('
const CARTE  = 'mjs-fx-count-card'
const ZEROS  = 'function _mjsFxCountPad('

const demande = (...signaux: string[]) => new Set<string>([fxUseSignal('count'), ...signaux])
const filtre  = (used: Set<string>, force = false) => selectFxSections('mjs_fx_count.ts', SOURCE, used, force)

describe('*count en volets — les réglages', () => {
  it('style: flip est reconnu, comme les réglages que *count avait déjà', () => {
    const r = parseEffect('count', 'style: flip, duration: 0, speed: 300ms, pad: 2, background: #123456, color: #abcdef')
    assert.deepEqual(r.fixed, { style: 'flip', duration: '0', speed: '300ms', pad: 2, background: '#123456', color: '#abcdef' })
    assert.deepEqual(parseEffect('count', 'style: plain').fixed, { style: 'plain' })
    // le réglage principal reste la durée
    assert.deepEqual(parseEffect('count', '3s, style: flip').fixed, { duration: '3s', style: 'flip' })
  })

  it('un réglage tenu par une variable est accepté', () => {
    const r = parseEffect('count', 'style: $allure, pad: $zeros')
    assert.deepEqual(Object.keys(r.dynamic).sort(), ['pad', 'style'])
  })

  it('une valeur inconnue est refusée, avec ce qui est permis', () => {
    assert.throws(() => parseEffect('count', 'style: carre'), /\*count : style = carre — permis : .*flip/)
    assert.throws(() => parseEffect('count', 'pad: 0'), /\*count : pad = 0 — permis : /)
    assert.throws(() => parseEffect('count', 'pad: 40'), /\*count : pad = 40 — permis : /)
    assert.throws(() => parseEffect('count', 'speed: vite'), /\*count : speed = vite — permis : /)
    // une couleur est lue comme celles des autres effets : tout ce que CSS accepte, sauf ce qui sortirait de la déclaration
    assert.throws(() => parseEffect('count', 'background: \'red; x\''), /\*count : background = red; x — permis : /)
    assert.throws(() => parseEffect('count', 'color: \'a{b}\''), /\*count : color = a\{b\} — permis : /)
    // un réglage qui n'existe pas dit les réglages de l'effet, les neufs compris
    assert.throws(() => parseEffect('count', 'volets: true'), /réglage « volets » inconnu[\s\S]*style[\s\S]*speed/)
  })

  it('le catalogue donne le défaut de chacun : plain, 400ms, les deux couleurs des cartes', () => {
    const s = EFFECTS.count.settings
    assert.equal(s.style.dflt, 'plain')
    assert.equal(s.speed.dflt, '400ms')
    assert.equal(s.background.dflt, '#1f2633')
    assert.equal(s.color.dflt, '#f5f7fa')
    assert.equal(s.pad.dflt, undefined)
    assert.equal(EFFECTS.count.main, 'duration')
  })
})

describe('*count en volets — les sections du fichier de l\'effet', () => {
  it('sans `style: flip`, ni les volets ni leur feuille ne partent ; avec, ils partent', () => {
    for (const [nom, used] of [['rien d\'écrit', demande()], ['la durée seule', demande(fxSignal('count', 'duration', '1s'))], ['style: plain', demande(fxSignal('count', 'style', 'plain'))], ['les couleurs seules', demande(fxSignal('count', 'background', '#000'))]] as const) {
      const texte = filtre(used)
      assert.equal(texte.includes(VOLETS), false, nom + ' : le code des volets ne part pas')
      assert.equal(texte.includes(CARTE), false, nom + ' : la feuille des volets ne part pas')
    }
    for (const [nom, used] of [['style: flip', demande(fxSignal('count', 'style', 'flip'))], ['une variable', demande(fxSignal('count', 'style', FX_ANY))]] as const) {
      const texte = filtre(used)
      assert.ok(texte.includes(VOLETS), nom + ' : le code des volets part')
      assert.ok(texte.includes(CARTE), nom + ' : la feuille des volets part')
    }
  })

  it('les zéros de tête (`pad`) ne partent qu\'avec pad, volets ou non', () => {
    assert.equal(filtre(demande()).includes(ZEROS), false)
    assert.equal(filtre(demande(fxSignal('count', 'style', 'flip'))).includes(ZEROS), false, 'les volets seuls ne les demandent pas')
    for (const used of [demande(fxSignal('count', 'pad', '2')), demande(fxSignal('count', 'pad', FX_ANY))]) {
      const texte = filtre(used)
      assert.ok(texte.includes(ZEROS))
      assert.equal(texte.includes(VOLETS), false, 'pad seul ne fait pas partir les volets')
    }
  })

  it('le fichier entier (développement, demande explicite) porte tout ; aucune marque ne sort du filtre', () => {
    const tout = filtre(demande(), true)
    assert.ok(tout.includes(VOLETS) && tout.includes(CARTE) && tout.includes(ZEROS))
    // une marque est une ligne qui ne dit que `// @@ étiquette`, ou une ligne de code qui s'en termine (l'en-tête du fichier en parle sans en être une)
    const marque = /^\s*\/\/ @@(?: [A-Za-z0-9 ._=,*-]+)?\s*$|^.*\S\s+\/\/ @@ [A-Za-z0-9 ._=,*-]+$/m
    for (const texte of [tout, filtre(demande()), filtre(demande(fxSignal('count', 'style', 'flip'), fxSignal('count', 'pad', '3')))]) {
      assert.equal(marque.test(texte), false, 'une marque est sortie')
    }
    assert.ok(marque.test(SOURCE), 'le fichier entier porte bien ses marques (le garde ci-dessus lit quelque chose)')
  })

  it('chaque combinaison de sections est du JavaScript valide', () => {
    for (const used of [demande(), demande(fxSignal('count', 'style', 'flip')), demande(fxSignal('count', 'pad', '2')), demande(fxSignal('count', 'style', 'flip'), fxSignal('count', 'pad', '2'))]) {
      assert.doesNotThrow(() => acorn.parse(filtre(used), { ecmaVersion: 'latest', sourceType: 'script' }), [...used].join(' '))
    }
  })
})

describe('*count en volets — dans un build de production', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  // un build RÉEL de production dont le code reste lisible : rend tout le JavaScript émis, et à part le fichier de l'effet (en `split`)
  async function construire(nom: string, source: string, conf: Record<string, unknown>): Promise<{ tout: string, effet: string }> {
    const root   = mjsTmp('compteur-volets-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'p.mjs'), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', minify: false, ...conf } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    return {
      tout:  fichiers.map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n'),
      effet: fichiers.filter((f) => f.startsWith('mjs_fx_count')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
    }
  }

  for (const [mode, conf] of [['bundle', { js: 'bundle' }], ['split', { js: 'split' }]] as const) {
    it(`en ${mode} : les volets ne partent qu'avec \`style: flip\`, les zéros de tête qu'avec \`pad\``, async () => {
      const page     = (reglages: string, script = '') => `<script>\n$n = 12\n${script}</script>\n<span class="a" *count(${reglages})>{$n}</span>`
      const sans     = await construire(mode + '-sans', page('duration: 0, on: load'), conf)
      const volets   = await construire(mode + '-flip', page('style: flip, duration: 0, on: load'), conf)
      const zeros    = await construire(mode + '-pad', page('pad: 2, duration: 0, on: load'), conf)
      const variable = await construire(mode + '-var', page('style: $s', '$s = \'flip\'\n'), conf)
      assert.ok(sans.tout.includes('function _mjsFxCountDigit('), mode + ' : l\'effet part')
      assert.equal(sans.tout.includes(VOLETS) || sans.tout.includes(CARTE) || sans.tout.includes(ZEROS), false, mode + ' : sans réglage, ni volets ni zéros')
      assert.ok(volets.tout.includes(VOLETS) && volets.tout.includes(CARTE), mode + ' : style: flip embarque les volets')
      assert.equal(volets.tout.includes(ZEROS), false, mode + ' : et pas les zéros de tête')
      assert.ok(zeros.tout.includes(ZEROS), mode + ' : pad embarque les zéros de tête')
      assert.equal(zeros.tout.includes(VOLETS), false, mode + ' : et pas les volets')
      assert.ok(variable.tout.includes(VOLETS), mode + ' : une variable embarque les volets (toutes les valeurs)')
      if (mode === 'split') {
        assert.ok(volets.effet.includes(VOLETS) && sans.effet.length > 0 && !sans.effet.includes(VOLETS), 'le code des volets est dans le fichier de l\'effet')
        assert.ok(volets.effet.length > sans.effet.length, 'le fichier de l\'effet est plus lourd avec les volets')
      }
    })
  }
})
