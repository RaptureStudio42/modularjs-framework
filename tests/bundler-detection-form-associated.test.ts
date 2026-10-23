// mjs_form_associated.ts (µ._mjs_formClass : le socle des composants associés au formulaire, écrit une seule fois pour tous ceux qui le
// déclarent — case, interrupteur, radio du cœur, ou un composant de l'application, par la directive racine `@formAssociated`) : fichier
// détecté (clé 'form_associated'). Absent d'un build sans composant déclaré — même avec des modules de saisie qui ne le déclarent pas encore —,
// présent dès qu'un seul l'est, quelle que soit la sélection `runtime` ; faits inconnus (API directe) : gardé. La directive se lit au
// compilateur : l'appel du socle s'écrit avant l'enregistrement de la balise du composant déclaré, et nulle part ailleurs ; une valeur
// après la directive est une erreur de compilation.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const MARK = 'µ._mjs_formClass = function'

async function construire(nom: string, conf: any, fichiers: Record<string, string>): Promise<{ sortie: string }> {
  const root = mjsTmp('detect-form-associated-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(fichiers)) writeFileSync(join(srcDir, f), source + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...conf } as any)
  const stats = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  // tout le JavaScript émis : le cœur (construction découpée) comme le fichier unique (`js: 'bundle'`)
  const emis = readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => join(outDir, f))
  emis.push(join(root, 'bundle.js'))
  const sortie = emis.map((f) => { try { return readFileSync(f, 'utf-8') } catch { return '' } }).join('\n')
  return { sortie }
}

const SANS = '<script>\n$n = 0\n</script>\n<button @click={$n++}>{$n}</button>\n<form @noUJS></form>'
const AVEC = {
  'la case':           '<form @noUJS><@@checkbox name="c">Case</@@checkbox></form>',
  'l\'interrupteur':   '<form @noUJS><@@switch name="s">Interrupteur</@@switch></form>',
  'le radio':          '<form @noUJS><@@radio name="r" value="a">A</@@radio></form>',
  'le nombre':         '<form @noUJS><@@number name="n" value={3}></@@number></form>',
  'le bouton rotatif': '<form @noUJS><@@knob name="k"></@@knob></form>',
  'la jauge':          '<form @noUJS><@@gauge name="g"></@@gauge></form>',
  'la liste':          '<form @noUJS><@@select name="p"><@@option value="a">A</@@option></@@select></form>',
}
const APPLI = '@formAssociated\n\n<script>\n  $oui = false\n</script>\n\n<button type="button">{$oui}</button>'

describe('mjs_form_associated.ts — détecté, build RÉEL', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('aucun composant déclaré (des modules de saisie qui ne le déclarent pas compris) : ABSENT, en cœur nu, par défaut et en fichier unique', async () => {
    for (const [nom, conf] of [['core', { runtime: 'core' }], ['defaut', {}], ['bundle', { js: 'bundle' }]] as Array<[string, any]>) {
      const { sortie } = await construire('nu-' + nom, conf, { 'hote.mjs': SANS })
      assert.equal(sortie.includes(MARK), false, nom)
      assert.equal(sortie.includes('_mjs_formClass'), false, nom + ' : aucun appel non plus')
    }
  })

  it('un module de saisie déclaré (case, interrupteur, radio, nombre, bouton rotatif, jauge, liste) : PRÉSENT, une seule fois', async () => {
    for (const [nom, source] of Object.entries(AVEC)) {
      const { sortie } = await construire('un-' + nom.replace(/\W+/g, '-'), { runtime: 'core' }, { 'hote.mjs': source })
      assert.ok(sortie.includes(MARK), nom)
      assert.equal(sortie.split(MARK).length - 1, 1, nom + ' : écrit une seule fois')
    }
  })

  it('un composant de l\'application déclaré `@formAssociated` : PRÉSENT, quelle que soit la sélection du runtime', async () => {
    for (const [nom, conf] of [['core', { runtime: 'core' }], ['defaut', {}], ['bundle', { js: 'bundle' }]] as Array<[string, any]>) {
      const { sortie } = await construire('appli-' + nom, conf, { 'hote.mjs': '<@accord name="a"></@accord>', 'accord.mjs': APPLI })
      assert.ok(sortie.includes(MARK), nom)
    }
  })

  it('runtime: [\'form_associated\'] : PRÉSENT sans composant déclaré', async () => {
    const { sortie } = await construire('force', { runtime: ['form_associated'] }, { 'hote.mjs': SANS })
    assert.ok(sortie.includes(MARK))
  })

  describe('API directe (resolveRuntimeFiles)', () => {
    it('faits inconnus : gardé', () => {
      assert.ok(new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles().files.includes('mjs_form_associated.ts'))
    })

    it('faits connus sans signal : absent, en core comme en all', () => {
      for (const runtime of ['core', 'all']) {
        assert.equal(new Bundler({ runtime } as any).resolveRuntimeFiles(new Set()).files.includes('mjs_form_associated.ts'), false, runtime)
      }
    })

    it('le signal form_associated le rend, en core comme en all', () => {
      for (const runtime of ['core', 'all']) {
        const { files } = new Bundler({ runtime } as any).resolveRuntimeFiles(new Set(['form_associated']))
        assert.ok(files.includes('mjs_form_associated.ts'), runtime)
      }
    })
  })
})

describe('@formAssociated — la directive lue par le compilateur', function () {
  this.timeout(60000)

  it('l\'appel du socle s\'écrit juste avant l\'enregistrement de la balise, avec la classe du composant', async () => {
    const { output } = await transpile(APPLI, { moduleName: 'accord' })
    const appel = output.indexOf('µ._mjs_formClass(')
    const def   = output.indexOf('µ._def(')
    assert.ok(appel > 0 && def > appel, 'avant µ._def')
    assert.match(output.slice(appel, def), /^µ\._mjs_formClass\(\w+\);\n$/)
    assert.equal(output.includes('@formAssociated'), false, 'la directive ne reste pas dans la sortie')
  })

  it('écrite dans le <script> : même effet ; un composant sans la directive : aucun appel', async () => {
    const dedans = await transpile('<script>\n  @formAssociated\n  $oui = false\n</script>\n\n<p>{$oui}</p>', { moduleName: 'accord' })
    assert.ok(dedans.output.includes('µ._mjs_formClass('))
    const sans = await transpile('<script>\n  $oui = false\n</script>\n\n<p>{$oui}</p>', { moduleName: 'accord' })
    assert.equal(sans.output.includes('_mjs_formClass'), false)
  })

  it('une valeur après la directive : erreur de compilation qui donne la forme attendue', async () => {
    await assert.rejects(() => transpile('@formAssociated true\n\n<script>\n  $oui = false\n</script>\n\n<p>{$oui}</p>', { moduleName: 'accord' }), /@formAssociated.*seul sur sa ligne|@formAssociated.*alone on its line/)
  })
})
