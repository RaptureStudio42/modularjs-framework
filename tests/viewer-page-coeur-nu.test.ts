// Ce que ce test garantit : les visionneuses de développement sont compilées à la volée et partagent le cœur de l'application.
// Quand ce cœur est nu (`runtime: 'core'`), il n'embarque ni les crochets de vie, ni les blocs {if} et {for}, ni les mutations
// profondes que ces pages appellent : le script de la visionneuse les apporte lui-même, à elle seule (rien dans le cœur de
// l'application), et seulement ceux que le cœur n'a pas. Un cœur complet (clé `runtime` absente) n'ajoute rien à la page.
// - le script d'un cœur nu porte les fichiers manquants, gardés par un test de présence dans la page ;
// - le script d'un cœur complet est celui que le transpileur donne, sans un octet de plus ;
// - ce que le code compilé des deux visionneuses appelle est couvert : par le cœur nu, ou par ce que la page apporte ;
// - les deux modes de sortie (fichiers séparés, fichier unique) sont jugés sur le cœur qu'ils portent.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { localizeViewerSource } from '../src/server/viewer-page.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'
import * as pageVisionneuse from '../src/server/viewer-page.js'

const { getViewerScript, THEME_VIEWER, JOURNAL_VIEWER } = pageVisionneuse

const ICI = dirname(fileURLToPath(import.meta.url))

// `manifeste` : où le manifeste est écrit ; le dossier de sortie est `out/` (par convention, le manifeste y est aussi : le cœur
// séparé se lit à côté de lui)
async function construire(cfgExtra: any, manifeste = 'out/bundle.js'): Promise<string> {
  const root   = mjsTmp('viewer-coeur')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hop.mjs'), '<script>\n$t = \'ok\'\n</script>\n<p>{$t}</p>\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, manifeste), defaultScriptLang: 'civet', lint: { a11y: false }, ...cfgExtra } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return join(root, manifeste)
}

// ce que le transpileur donne pour une visionneuse, le cœur posé à la place du repère (c'est ce que getViewerScript fait avant d'y joindre quoi que ce soit)
async function sansApport(fichier: string, moduleName: string, corePath: string): Promise<string> {
  const { output } = await transpile(localizeViewerSource(readFileSync(join(ICI, '..', 'src', 'server', fichier), 'utf8')), { moduleName })
  return output.replace('µ.asset(\'mjs_core.js\')', JSON.stringify(corePath)).replace(/<\/script/gi, '<\\/script')
}

const MEMBRES = ['_mjs_hook', '_mjs_updIf', '_mjs_updFor', '_mjs_updList', '_mjs_destroyWithHooks', '_mjs_deepSet']

describe('visionneuses de développement — ce qu\'un cœur nu n\'embarque pas', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const js of ['split', 'bundle'] as const) {
    it(`fichiers ${js === 'split' ? 'séparés' : 'en un seul'}, cœur nu : chaque visionneuse apporte les fichiers que le cœur n'a pas, chacun derrière un test de présence`, async () => {
      const manifeste = await construire({ js, runtime: 'core' })
      for (const spec of [THEME_VIEWER, JOURNAL_VIEWER]) {
        const script = await getViewerScript(manifeste, spec)
        for (const membre of MEMBRES) assert.match(script, new RegExp(`\\.${membre} = (?:async )?function`), `${spec.fileName} (${js}) apporte ${membre}`)
        assert.match(script, /if \(!µ\.Element\.prototype\._mjs_hook\)/, 'chaque fichier apporté est gardé par un test de présence')
        assert.ok(script.indexOf('_mjs_hook = function') > script.indexOf('import { µ } from'), 'l\'import du cœur reste en tête de module')
      }
    })

    it(`fichiers ${js === 'split' ? 'séparés' : 'en un seul'}, cœur complet : le script de la visionneuse est celui du transpileur, rien de plus`, async () => {
      const manifeste = await construire({ js })
      const source    = readFileSync(manifeste, 'utf-8')
      const corePath  = source.match(/const µCore = '([^']+)';/)?.[1] ?? '/__mjs/bundle.js'
      for (const [spec, fichier] of [[THEME_VIEWER, 'theme-viewer.mjs'], [JOURNAL_VIEWER, 'errors-viewer.mjs']] as const) {
        assert.equal(await getViewerScript(manifeste, spec), await sansApport(fichier, spec.moduleName, corePath), `${fichier} (${js}) : rien n'est ajouté à la page`)
      }
    })
  }

  it('fichiers séparés, cœur introuvable à côté du manifeste : la page apporte tous les fichiers, chacun derrière son test de présence', async () => {
    const manifeste = await construire({ js: 'split' }, 'bundle.js')
    for (const spec of [THEME_VIEWER, JOURNAL_VIEWER]) {
      const script = await getViewerScript(manifeste, spec)
      for (const membre of MEMBRES) assert.match(script, new RegExp(`if \\(!µ(?:\\.Element\\.prototype)?\\.${membre}\\) \\{`), `${spec.fileName} garde ${membre} par un test de présence`)
    }
  })

  it('fichiers séparés, manifeste hors du dossier de sortie : avec le dossier de sortie donné par le serveur, un cœur complet n\'ajoute rien et un cœur nu apporte ce qui manque', async () => {
    for (const [cfg, attendu] of [[{ js: 'split' }, 0], [{ js: 'split', runtime: 'core' }, MEMBRES.length]] as const) {
      const manifeste = await construire(cfg, 'bundle.js')
      const sortie    = join(dirname(manifeste), 'out')
      for (const spec of [THEME_VIEWER, JOURNAL_VIEWER]) {
        const script = await getViewerScript(manifeste, spec, sortie)
        const gardes = MEMBRES.filter(membre => new RegExp(`if \\(!µ(?:\\.Element\\.prototype)?\\.${membre}\\) \\{`).test(script))
        assert.equal(gardes.length, attendu, `${spec.fileName} (${'runtime' in cfg ? 'cœur nu' : 'cœur complet'}) : ${gardes.length} fichier(s) joint(s), ${attendu} attendu(s)`)
      }
    }
  })

  it('la page ne redéfinit rien de ce que le cœur a déjà : chaque fichier joint est sauté quand son membre existe', () => {
    const tete    = 'import { µ } from "/cœur.js";\n'
    const apport  = (pageVisionneuse as any).withViewerRuntime(tete, (pageVisionneuse as any).VIEWER_RUNTIME ?? []) as string
    assert.ok(apport.length > tete.length, 'les fichiers sont joints derrière l\'import du cœur')
    const present = () => 'déjà là'
    // un cœur qui a déjà tous les membres : si un seul fichier n'était pas gardé, il s'exécuterait sur ce faux cœur et lèverait
    const faux = { _mjs_deepSet: present, Element: { prototype: { _mjs_hook: present, _mjs_destroyWithHooks: present, _mjs_updIf: present, _mjs_updFor: present, _mjs_updList: present } } }
    new Function('µ', apport.slice(tete.length))(faux)
    assert.equal(faux._mjs_deepSet, present)
    for (const membre of Object.keys(faux.Element.prototype)) assert.equal((faux.Element.prototype as any)[membre], present, `${membre} n'est pas redéfini`)
    // et sur un cœur qui n'a rien, le premier fichier joint s'exécute bien (le garde ne saute pas tout)
    const vide: any = { Element: class {}, _mjs_msg: () => '', warn: () => {} }
    new Function('µ', apport.slice(tete.length))(vide)
    assert.equal(typeof vide._mjs_deepSet, 'function', 'sur un cœur sans rien, les mutations profondes sont posées')
    for (const membre of Object.keys(faux.Element.prototype)) assert.equal(typeof vide.Element.prototype[membre], 'function', `sur un cœur sans rien, ${membre} est posé`)
  })

  it('tout ce que le code compilé des deux visionneuses appelle est dans le cœur nu, ou apporté par la page', async () => {
    const root    = mjsTmp('viewer-coeur-liste')
    const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), runtime: 'core' } as any)
    const coeurNu = bundler.resolveRuntimeFiles(new Set<string>()).files
    await bundler.close()
    const apportes = ((pageVisionneuse as any).VIEWER_RUNTIME ?? []).map((e: { file: string }) => e.file)
    for (const [fichier, moduleName] of [['theme-viewer.mjs', 'theme-viewer'], ['errors-viewer.mjs', 'journal-viewer']] as const) {
      const { output } = await transpile(localizeViewerSource(readFileSync(join(ICI, '..', 'src', 'server', fichier), 'utf8')), { moduleName })
      const appeles    = [...scanCompiledFeatures(output)].sort()
      assert.ok(appeles.length >= 3, `garde muette : ${fichier} appelle plusieurs fonctions du cœur (${appeles.join(', ')})`)
      const manque = appeles.filter(f => !coeurNu.includes('mjs_' + f + '.ts') && !apportes.includes('mjs_' + f + '.ts'))
      assert.deepEqual(manque, [], `${fichier} appelle ce que ni le cœur nu ni la page n'apportent : ${manque.join(', ')}`)
    }
  })
})
