// le manifeste n'emporte que les libellés par défaut des modules du cœur que le build emporte : une page qui n'emploie que
// <@@select> ne paie pas les textes de l'éditeur, de la barre, du carrousel, de l'horloge… Build RÉEL (Bundler), en
// développement et en production, manifeste éclaté (`js: 'split'`) et fichier unique (`js: 'bundle'`).
// Le module qui en pose un autre l'emporte avec ses libellés (<@@editor> pose <@@toolbar>) ; un fichier du projet qui lit
// lui-même le groupe `core` (la copie éjectée d'un module du cœur) garde tout le groupe.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuBuild } from './helpers/libelles-par-module.js'

type Env = 'dev' | 'prod'
type Js  = 'split' | 'bundle'

const MODES: Array<[Env, Js]> = [['dev', 'split'], ['prod', 'split'], ['dev', 'bundle'], ['prod', 'bundle']]

const SELECT   = ['selectPlaceholder', 'selectSearch', 'selectEmpty', 'selectOther', 'selectOtherPlaceholder', 'selectOtherHint', 'selectOtherOk', 'selectOtherSep']
const NUMBER   = ['numberLabel', 'numberLess', 'numberMore', 'numberBigLess', 'numberBigMore']
const CAROUSEL = ['carouselPrev', 'carouselNext']
const AUTRES   = ['codeCopy', 'codeCopied', 'gaugeLabel', 'knobLabel', 'progressLabel', 'colorLabel', 'menuLabel', 'clockHours', 'clockMinutes', 'clockSeconds']

// l'éditeur et sa barre : les clés qui n'ont pas le préfixe de leur module (link*, box*, checked, unchecked pour l'éditeur ; tool* pour la barre)
const EDITEUR  = ['editorLabel', 'editorPlaceholder', 'linkLabel', 'linkApply', 'linkRemove', 'linkCancel', 'linkDone', 'boxChecked', 'boxUnchecked', 'checked', 'unchecked']
const BARRE    = ['toolbarLabel', 'toolH2', 'toolH3', 'toolQuote', 'toolBold', 'toolItalic', 'toolUnderline', 'toolStrike', 'toolUl', 'toolOl', 'toolCheck', 'toolLink', 'toolUndo', 'toolRedo', 'toolClear']

const PAGES = {
  select:  '<@@select name="s"><@@option value="a">Alpha</@@option></@@select>',
  editor:  '<@@editor name="t"></@@editor>',
  barre:   '<@@toolbar for="zone"></@@toolbar>\n<div id="zone"></div>',
  trois:   '<@@select name="s"><@@option value="a">Alpha</@@option></@@select>\n<@@number big></@@number>\n<@@carousel><div>un</div><div>deux</div></@@carousel>',
  sansLib: '<@@sortable><div>a</div><div>b</div></@@sortable>\n<@@field name="n"><input></@@field>',
  nu:      '<p>x</p>',
}

async function construire(nom: string, fichiers: Record<string, string>, env: Env, js: Js): Promise<Record<string, any>> {
  const root   = mjsTmp(`libelles-par-module-${nom}-${env}-${js}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [n, c] of Object.entries(fichiers)) writeFileSync(join(srcDir, n), c + '\n')
  const manifestPath = env === 'prod' ? join(outDir, 'bundle.js') : join(root, 'bundle.js')
  const bundler      = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath, js, ...(env === 'prod' ? { env: 'prod' } : {}) } as any)
  const stats        = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return libellesDuBuild(manifestPath, outDir)
}

// les clés du groupe `core` d'une langue, triées ; vide quand le groupe est absent
const cles = (table: Record<string, any>, lang = 'fr'): string[] => Object.keys(table[lang]?.core ?? {}).sort()

describe('libellés du manifeste — seulement ceux des modules du cœur que le build emporte', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  // `mjs dev` garde le même Bundler d'un tour à l'autre : ajouter puis retirer un module à une page change les clés du manifeste,
  // dans les deux sens, sans rien garder du tour d'avant
  for (const env of ['dev', 'prod'] as Env[]) {
    it(`le même Bundler sur plusieurs tours (${env}) : les clés suivent les modules de la page, à la hausse et à la baisse`, async () => {
      const root   = mjsTmp(`libelles-par-module-tours-${env}`)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      const manifestPath = join(outDir, 'bundle.js')
      const bundler      = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath, js: 'split', ...(env === 'prod' ? { env: 'prod' } : {}) } as any)
      const tour = async (page: string) => {
        writeFileSync(join(srcDir, 'hote.mjs'), page + '\n')
        const stats = await bundler.compile()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
        return cles(libellesDuBuild(manifestPath, outDir))
      }
      try {
        assert.deepEqual(await tour(PAGES.select), [...SELECT].sort())
        assert.deepEqual(await tour(PAGES.select + '\n' + PAGES.editor), [...SELECT, ...EDITEUR, ...BARRE].sort())
        assert.deepEqual(await tour(PAGES.select), [...SELECT].sort())
        assert.deepEqual(await tour(PAGES.nu), [])
        assert.deepEqual(await tour(PAGES.barre), [...BARRE].sort())
      }
      finally {
        await bundler.close()
      }
    })
  }

  for (const [env, js] of MODES) {
    describe(`${env}, js: '${js}'`, () => {
      it('<@@select> seul : ses huit clés, aucune de l\'éditeur, de la barre, du carrousel ni des autres modules', async () => {
        const t = await construire('select', { 'hote.mjs': PAGES.select }, env, js)
        assert.deepEqual(cles(t), [...SELECT].sort())
        assert.deepEqual(cles(t, 'en'), [...SELECT].sort())
        for (const k of [...EDITEUR, ...BARRE, ...CAROUSEL, ...NUMBER, ...AUTRES]) assert.equal(k in t.fr.core, false, `${k} ne doit pas partir pour <@@select>`)
      })

      it('<@@editor> : les clés de l\'éditeur et celles de la barre qu\'il pose, aucune d\'un autre module', async () => {
        const t = await construire('editor', { 'hote.mjs': PAGES.editor }, env, js)
        assert.deepEqual(cles(t), [...EDITEUR, ...BARRE].sort())
        assert.deepEqual(cles(t, 'en'), [...EDITEUR, ...BARRE].sort())
        for (const k of [...SELECT, ...CAROUSEL, ...NUMBER, ...AUTRES]) assert.equal(k in t.fr.core, false, `${k} ne doit pas partir pour <@@editor>`)
      })
    })
  }

  for (const [env, js] of [['dev', 'split'], ['prod', 'bundle']] as Array<[Env, Js]>) {
    describe(`autres pages, ${env}, js: '${js}'`, () => {
      it('<@@toolbar for="…"> posée à part : les clés de la barre, aucune de l\'éditeur', async () => {
        const t = await construire('barre', { 'hote.mjs': PAGES.barre }, env, js)
        assert.deepEqual(cles(t), [...BARRE].sort())
        for (const k of [...EDITEUR.filter((c) => c !== 'checked' && c !== 'unchecked'), ...SELECT]) assert.equal(k in t.fr.core, false, `${k} ne doit pas partir pour <@@toolbar>`)
      })

      it('trois modules (<@@select>, <@@number>, <@@carousel>) : l\'union de leurs clés, rien de plus', async () => {
        const t = await construire('trois', { 'hote.mjs': PAGES.trois }, env, js)
        assert.deepEqual(cles(t), [...SELECT, ...NUMBER, ...CAROUSEL].sort())
      })

      it('modules sans libellé par défaut (<@@sortable>, <@@field>) : le groupe core ne part pas', async () => {
        const t = await construire('sans-lib', { 'hote.mjs': PAGES.sansLib }, env, js)
        assert.equal('core' in t.fr, false)
        assert.equal('core' in t.en, false)
      })

      it('aucun module du cœur : le groupe core ne part pas', async () => {
        const t = await construire('nu', { 'hote.mjs': PAGES.nu }, env, js)
        assert.equal('core' in t.fr, false)
        assert.equal('core' in t.en, false)
      })

      it('les textes partent tels quels, en français et en anglais', async () => {
        const t = await construire('select-textes', { 'hote.mjs': PAGES.select }, env, js)
        assert.equal(t.fr.core.selectPlaceholder, RUNTIME_LABELS.fr.core.selectPlaceholder)
        assert.equal(t.fr.core.selectPlaceholder, 'Choisir…')
        assert.equal(t.en.core.selectPlaceholder, 'Choose…')
        assert.equal(t.fr.core.selectOtherSep, ' : ')
      })

      it('une copie éjectée d\'un module du cœur, qui lit elle-même le groupe core : tout le groupe part', async () => {
        const dossier = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core-modules')
        const copie   = readFileSync(join(dossier, 'select.mjs'), 'utf-8')
        const t = await construire('copie', { 'ma-liste.mjs': copie, 'hote.mjs': '<@ma-liste name="s"><@@option value="a">Alpha</@@option></@ma-liste>' }, env, js)
        assert.deepEqual(cles(t), Object.keys(RUNTIME_LABELS.fr.core).sort())
        assert.deepEqual(cles(t, 'en'), Object.keys(RUNTIME_LABELS.en.core).sort())
      })
    })
  }
})
