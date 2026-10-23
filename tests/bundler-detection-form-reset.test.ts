// mjs_form_reset.ts (µ._mjs_formReset : la remise à zéro d'un formulaire, écrite une seule fois pour les modules de
// saisie du cœur — case, interrupteur, radio, nombre, jauge, bouton rotatif, liste, champ, éditeur) : fichier détecté
// (clé 'form_reset'). Absent d'un build qui n'emploie aucun de ces modules, présent dès qu'un seul est employé,
// quelle que soit la sélection `runtime` (même un cœur nu, même sans UJS) ; faits inconnus (API directe) : gardé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const MARK = 'µ._mjs_formReset = function'

async function construire(nom: string, conf: any, source: string): Promise<{ sortie: string }> {
  const root = mjsTmp('detect-form-reset-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...conf } as any)
  const stats = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  // tout le JavaScript émis : le cœur (construction découpée) comme le fichier unique (`js: 'bundle'`)
  const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => join(outDir, f))
  fichiers.push(join(root, 'bundle.js'))
  const sortie = fichiers.map((f) => { try { return readFileSync(f, 'utf-8') } catch { return '' } }).join('\n')
  return { sortie }
}

const SANS_SAISIE = '<script>\n$n = 0\n</script>\n<button @click={$n++}>{$n}</button>\n<@@progress value={3}></@@progress>'
const AVEC = {
  'la case':        '<form @noUJS><@@checkbox name="c">Case</@@checkbox></form>',
  'l\'interrupteur': '<form @noUJS><@@switch name="s">Interrupteur</@@switch></form>',
  'le radio':       '<form @noUJS><@@radio name="r" value="a">A</@@radio></form>',
  'le nombre':      '<form @noUJS><@@number name="n" value={3}></@@number></form>',
  'la jauge':       '<form @noUJS><@@gauge name="g" value={3}></@@gauge></form>',
  'le bouton':      '<form @noUJS><@@knob name="k" value={30}></@@knob></form>',
  'la liste':       '<form @noUJS><@@select name="p"><@@option value="a">A</@@option></@@select></form>',
  'le champ':       '<form @noUJS><@@field name="f"><input name="f"></@@field></form>',
  'l\'éditeur':     '<form @noUJS><@@editor name="e"></@@editor></form>',
}

describe('mjs_form_reset.ts — détecté, build RÉEL', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('aucun module de saisie : ABSENT, en cœur nu, par défaut et en fichier unique', async () => {
    for (const [nom, conf] of [['core', { runtime: 'core' }], ['defaut', {}], ['bundle', { js: 'bundle' }]] as Array<[string, any]>) {
      const { sortie } = await construire('nu-' + nom, conf, SANS_SAISIE)
      assert.equal(sortie.includes(MARK), false, nom)
      assert.equal(sortie.includes('_mjs_formReset'), false, nom + ' : aucun appel non plus')
    }
  })

  it('un seul module de saisie, quel qu\'il soit : PRÉSENT, une seule fois', async () => {
    for (const [nom, source] of Object.entries(AVEC)) {
      const { sortie } = await construire('un-' + nom.replace(/\W+/g, '-'), { runtime: 'core' }, source)
      assert.ok(sortie.includes(MARK), nom)
      assert.equal(sortie.split(MARK).length - 1, 1, nom + ' : écrit une seule fois')
    }
  })

  it('la sélection du runtime n\'y change rien : cœur nu, sans UJS, liste à la main, défaut, fichier unique', async () => {
    const source = AVEC['la case']
    for (const [nom, conf] of [['core', { runtime: 'core' }], ['sans-ujs', { runtime: ['router', 'easing'] }], ['defaut', {}], ['bundle', { js: 'bundle' }], ['bundle-core', { js: 'bundle', runtime: 'core' }]] as Array<[string, any]>) {
      const { sortie } = await construire('sel-' + nom, conf, source)
      assert.ok(sortie.includes(MARK), nom)
      assert.equal(sortie.includes('µ._mjs_ujsOnClick = function'), nom === 'defaut' || nom === 'bundle', nom + ' : l\'UJS suit la sélection, la remise à zéro n\'en dépend pas')
    }
  })

  it('runtime: [\'form_reset\'] : PRÉSENT sans module de saisie', async () => {
    const { sortie } = await construire('force', { runtime: ['form_reset'] }, SANS_SAISIE)
    assert.ok(sortie.includes(MARK))
  })

  describe('API directe (resolveRuntimeFiles)', () => {
    it('faits inconnus : gardé', () => {
      assert.ok(new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles().files.includes('mjs_form_reset.ts'))
    })

    it('faits connus sans signal : absent, en core comme en all', () => {
      for (const runtime of ['core', 'all']) {
        assert.equal(new Bundler({ runtime } as any).resolveRuntimeFiles(new Set()).files.includes('mjs_form_reset.ts'), false, runtime)
      }
    })

    it('le signal form_reset le rend, en core comme en all', () => {
      for (const runtime of ['core', 'all']) {
        const { files } = new Bundler({ runtime } as any).resolveRuntimeFiles(new Set(['form_reset']))
        assert.ok(files.includes('mjs_form_reset.ts'), runtime)
      }
    })
  })
})
