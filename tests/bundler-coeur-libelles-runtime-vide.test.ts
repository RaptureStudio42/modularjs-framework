// Un projet en `runtime: []` qui pose un module cœur à libellé par défaut (<@@select>, <@@number>…)
// se construit : ces modules lisent la langue (`µlang`), le store global qui la porte entre donc au
// cœur de ce build — au lieu d'un refus « Cœur incomplet ». Le libellé sort dans la langue de la page.
// Build RÉEL (Bundler) + fenêtre happy-dom, une par langue.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { CORE_LABEL_MODULES, coreLabelKeys } from '../src/runtime-labels.js'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { libellesDuBuild, modulesPoses, moduleEtPoses } from './helpers/libelles-par-module.js'

// un modèle par module cœur qui a des libellés par défaut (groupe `core` de runtime-labels.ts)
const MODULES: Record<string, string> = {
  carousel: '<@@carousel><div>un</div><div>deux</div></@@carousel>',
  code:     '<@@code><pre><code>x = 1</code></pre></@@code>',
  select:   '<@@select name="s"><@@option value="a">Alpha</@@option></@@select>',
  number:   '<@@number big></@@number>',
  gauge:    '<@@gauge></@@gauge>',
  knob:     '<@@knob></@@knob>',
  progress: '<@@progress></@@progress>',
  color:    '<@@color value="rgb(59, 130, 246)" editable></@@color>',
  menu:     '<@@menu><div>x</div></@@menu>',
  clock:    '<@@clock></@@clock>',
  editor:   '<@@editor name="t"></@@editor>',
  toolbar:  '<@@toolbar for="zone"></@@toolbar><div id="zone"></div>',
}

// la page unique ci-dessous évalue les fichiers du build à la suite, dans UN seul script : les noms que plusieurs modules déclarent
// à leur niveau (`told` pour <@@select> et <@@toolbar>) s'y heurtent, alors que le navigateur donne à chaque module sa portée.
// L'éditeur et sa barre ont leur batterie à eux (tests/core-editeur-*.test.ts) ; ici ils ne passent que par les builds seuls
const SANS_PAGE_UNIQUE = ['editor', 'toolbar']

async function construire(nom: string, gabarit: string): Promise<{ root: string, outDir: string, erreurs: string[] }> {
  const root = mjsTmp(`coeur-libelles-runtime-vide-${nom}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), gabarit + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtime: [] } as any)
  const stats = await bundler.compile()
  return { root, outDir, erreurs: stats.errors.map((e: any) => e.message) }
}

describe('modules cœur à libellé en `runtime: []` — build RÉEL', function () {
  this.timeout(90000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la table des libellés du cœur ne gagne pas de module sans modèle ici', () => {
    for (const module of Object.keys(CORE_LABEL_MODULES)) assert.ok(MODULES[module], `module cœur sans modèle de test : ${module}`)
  })

  for (const [nom, gabarit] of Object.entries(MODULES)) {
    it(`<@@${nom}> seul : le build passe, le store global entre au cœur`, async () => {
      const { outDir, erreurs } = await construire(nom, gabarit)
      assert.equal(erreurs.length, 0, erreurs.join('\n'))
      const coeur = readdirSync(outDir).find((f) => /^mjs_core-/.test(f))
      assert.ok(coeur, 'mjs_core-*.js doit exister')
      assert.ok(readFileSync(join(outDir, coeur!), 'utf-8').includes('µ._storeDeclare = function'), 'µ._storeDeclare doit être défini au cœur')
    })

    it(`<@@${nom}> seul : le manifeste pose les clés de ce module et de ceux qu'il pose, pas une de plus`, async () => {
      const { root, outDir, erreurs } = await construire(`cles-${nom}`, gabarit)
      assert.equal(erreurs.length, 0, erreurs.join('\n'))
      const attendu = [...coreLabelKeys(moduleEtPoses(nom, modulesPoses()))].sort()
      const table   = libellesDuBuild(join(root, 'bundle.js'), outDir)
      assert.deepEqual(Object.keys(table.fr.core ?? {}).sort(), attendu)
      assert.deepEqual(Object.keys(table.en.core ?? {}).sort(), attendu)
    })
  }

  it('sans module cœur à libellé : le store global reste ABSENT du cœur', async () => {
    const { outDir, erreurs } = await construire('rien', '<p>x</p>')
    assert.equal(erreurs.length, 0, erreurs.join('\n'))
    const coeur = readdirSync(outDir).find((f) => /^mjs_core-/.test(f))
    assert.ok(!readFileSync(join(outDir, coeur!), 'utf-8').includes('µ._storeDeclare = function'))
  })

  describe('libellé par défaut, dans la langue de la page', () => {
    const fenetres: any[] = []
    let sources: string[] = []
    let libelles = ''

    const stripEsm = (s: string) => s
      .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
      .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
      .replace(/\bexport\s+default\s+/g, '')
      .replace(/\bexport\s+/g, '')
      .replace(/import\.meta\.url/g, "'http://localhost/'")

    async function monter(lang: string): Promise<any> {
      const window: any = new Window({ url: 'http://localhost/' })
      if (lang) window.document.documentElement.setAttribute('lang', lang)
      fenetres.push(window)
      window.eval(`${sources.join('\n')}\nglobalThis.µ = µ;`)
      window.eval(libelles)
      window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
      await new Promise((r) => setTimeout(r, 150))
      const hote = window.document.body.firstElementChild
      assert.ok(hote._shadow, 'hôte monté')
      return hote
    }

    before(async () => {
      const gabarit = Object.entries(MODULES).filter(([n]) => !SANS_PAGE_UNIQUE.includes(n)).map(([n, g]) => `<div id="${n}">${g}</div>`).join('\n')
      const { root, outDir, erreurs } = await construire('page', gabarit)
      assert.equal(erreurs.length, 0, erreurs.join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const ordre = (f: string) => /^mjs_core-/.test(f) ? 0 : /^hote-/.test(f) ? 2 : 1
      files.sort((a, b) => ordre(a) - ordre(b))
      libelles = libellesDuManifeste(join(root, 'bundle.js'))
      sources = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8')))
    })

    after(() => { for (const w of fenetres) w.close?.() })

    for (const [lang, t] of [['', { sel: 'Choisir…', menu: 'Menu', progress: 'Progression' }], ['fr', { sel: 'Choisir…', menu: 'Menu', progress: 'Progression' }], ['en', { sel: 'Choose…', menu: 'Menu', progress: 'Progress' }]] as const) {
      it(`page ${lang ? `lang="${lang}"` : 'sans langue'} : sélecteur, menu, progression`, async () => {
        const hote = await monter(lang)
        const dans = (id: string, tag: string, sel: string) => hote._shadow.querySelector(`#${id} ${tag}`)._shadow.querySelector(sel)
        assert.ok(dans('select', 'mjs-core-select', 'button.select-btn').textContent.includes(t.sel))
        assert.equal(dans('menu', 'mjs-core-menu', 'button[part="toggle"]').getAttribute('aria-label'), t.menu)
        assert.equal(dans('progress', 'mjs-core-progress', '[role="progressbar"]').getAttribute('aria-label'), t.progress)
      })
    }
  })
})
