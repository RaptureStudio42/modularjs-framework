// Ce que ce test garantit : les visionneuses de développement sont compilées à la volée et partagent le cœur de l'application.
// Quand ce cœur est nu (`runtime: 'core'`), il n'embarque ni les crochets de vie, ni les blocs {if} et {for}, ni les mutations
// profondes que ces pages appellent : le script de la visionneuse les apporte lui-même, à elle seule (rien dans le cœur de
// l'application), et seulement ceux que le cœur n'a pas. Un cœur complet (clé `runtime` absente) n'ajoute rien à la page.
// - le script d'un cœur nu porte les fichiers manquants, gardés par un test de présence dans la page ;
// - le script d'un cœur complet est celui que le transpileur donne, sans un octet de plus ;
// - ce que le code compilé des deux visionneuses appelle est couvert : par le cœur nu, ou par ce que la page apporte ; un bloc balisé du
//   cœur (la machinerie des valeurs dérivées), que la page ne peut pas joindre, se juge sur le texte du cœur nu d'une construction de
//   développement, et le gestionnaire de `<@window>`, bloc que la page sait joindre, sur ce texte ou sur la page ;
// - en production, la page du journal (servie par son jeton) n'appelle rien que ni le cœur de l'appli la plus nue ni la page n'apportent :
//   les aides d'écriture d'attribut, qu'une construction de production retire d'un cœur où aucune unité ne s'en sert, la page les joint ;
// - un fichier joint, hors de la portée du module du cœur, n'y lit aucun nom que la page ne déclare pas elle-même ;
// - les deux modes de sortie (fichiers séparés, fichier unique) sont jugés sur le cœur qu'ils portent.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { Linter } from 'eslint'
import { transformSync } from 'esbuild'
import { localizeViewerSource } from '../src/server/viewer-page.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanCompiledFeatures, DERIVED_VALUES, ATTR_UPDATE, ATTR_SELECT, PROPS_PENDING, ATTR_FILTER, ROOT_TEXT, SIG_FREE } from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'
import { ROW_CLONE } from '../src/bundler/features.js'
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

// les signaux qui ne sont pas un fichier du runtime mais un bloc balisé du cœur : la définition que le bloc pose
const BLOCS: Record<string, RegExp> = {
  [DERIVED_VALUES]: /\._mjs_setComputed = (?:async )?function/,
  [ATTR_UPDATE]:    /\._mjs_updAttrNode = function/,
  [ATTR_SELECT]:    /\._mjs_selVal = \(/,
  [PROPS_PENDING]:  /\._mjs_pend = function/,
  [ATTR_FILTER]:    /\._mjs_safeAttr = function/,
  [ROOT_TEXT]:      /\b_mjs_updText\([^)]*\)\s*\{/,
  // l'élément du dernier gabarit de ligne copié (bloc `<copie-de-ligne>`, mjs_init.ts) : gardé par tout cœur de développement
  [ROW_CLONE]:      /\bvar _mjsLastHtml, _mjsLastEl;/,
}

// un bloc balisé que la page sait joindre quand le cœur ne l'a pas (le gestionnaire de `<@window>` hors du calcul en cours) : la
// définition que le bloc pose, avec ou sans graphe des signaux
const JOINTS: Record<string, RegExp> = {
  [SIG_FREE]: /\._mjs_sigFree (?:\|\|)?= /,
}

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

    // le gestionnaire de `<@window>` hors du calcul en cours (`_mjs_sigFree`), que l'atelier de thème appelle : un cœur de développement
    // complet le garde, même sans unité qui en écrit un ni graphe des signaux (posé `||=`, que le test de présence de la page reconnaît)
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

  it('fichiers séparés, manifeste hors du dossier de sortie : avec le dossier de sortie donné par le serveur, un cœur complet n\'ajoute aucun fichier et un cœur nu apporte ce qui manque', async () => {
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
    const faux = { _mjs_deepSet: present, _mjs_safeAttr: present, _mjs_sigFree: present, _mjs_selVal: present, _mjs_updAttrNode: present, Element: { prototype: { _mjs_hook: present, _mjs_destroyWithHooks: present, _mjs_updIf: present, _mjs_updFor: present, _mjs_updList: present } } }
    new Function('µ', apport.slice(tete.length))(faux)
    for (const membre of ['_mjs_deepSet', '_mjs_safeAttr', '_mjs_sigFree', '_mjs_selVal', '_mjs_updAttrNode']) assert.equal((faux as any)[membre], present, `${membre} n'est pas redéfini`)
    for (const membre of Object.keys(faux.Element.prototype)) assert.equal((faux.Element.prototype as any)[membre], present, `${membre} n'est pas redéfini`)
    // et sur un cœur qui n'a rien, le premier fichier joint s'exécute bien (le garde ne saute pas tout)
    const vide: any = { Element: class {}, _mjs_msg: () => '', warn: () => {} }
    new Function('µ', apport.slice(tete.length))(vide)
    assert.equal(typeof vide._mjs_deepSet, 'function', 'sur un cœur sans rien, les mutations profondes sont posées')
    for (const membre of ['_mjs_safeAttr', '_mjs_sigFree', '_mjs_selVal', '_mjs_updAttrNode']) assert.equal(typeof vide[membre], 'function', `sur un cœur sans rien, ${membre} est posé`)
    for (const membre of Object.keys(faux.Element.prototype)) assert.equal(typeof vide.Element.prototype[membre], 'function', `sur un cœur sans rien, ${membre} est posé`)
  })

  it('tout ce que le code compilé des deux visionneuses appelle est dans le cœur nu, ou apporté par la page', async () => {
    const root    = mjsTmp('viewer-coeur-liste')
    const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), runtime: 'core' } as any)
    const coeurNu = bundler.resolveRuntimeFiles(new Set<string>()).files
    await bundler.close()
    // le cœur nu d'une construction de développement, celui que les visionneuses partagent
    const sortie   = dirname(await construire({ js: 'split', runtime: 'core', env: 'dev' }))
    const texte    = readFileSync(join(sortie, readdirSync(sortie).find(f => /^mjs_core.*\.js$/.test(f)) ?? 'mjs_core.js'), 'utf-8')
    const apportes = ((pageVisionneuse as any).VIEWER_RUNTIME ?? []).map((e: { file: string }) => e.file)
    for (const [fichier, spec] of [['theme-viewer.mjs', THEME_VIEWER], ['errors-viewer.mjs', JOURNAL_VIEWER]] as const) {
      const { output } = await transpile(localizeViewerSource(readFileSync(join(ICI, '..', 'src', 'server', fichier), 'utf8')), { moduleName: spec.moduleName })
      const page       = await getViewerScript(join(sortie, 'bundle.js'), spec)
      const appeles    = [...scanCompiledFeatures(output)].sort()
      assert.ok(appeles.length >= 3, `garde muette : ${fichier} appelle plusieurs fonctions du cœur (${appeles.join(', ')})`)
      const manque = appeles.filter(f => f in BLOCS ? !BLOCS[f].test(texte) : f in JOINTS ? !JOINTS[f].test(texte) && !JOINTS[f].test(page) : !coeurNu.includes('mjs_' + f + '.ts') && !apportes.includes('mjs_' + f + '.ts'))
      assert.deepEqual(manque, [], `${fichier} appelle ce que ni le cœur nu ni la page n'apportent : ${manque.join(', ')}`)
    }
  })

  // une construction de production retire du cœur les blocs qu'aucune unité ne nomme (aides d'écriture d'attribut, texte de la racine…) :
  // la page du journal, servie en production par son jeton, ne doit rien appeler que le cœur de l'appli la plus nue n'ait plus, sans que
  // la page l'apporte. Construction non minifiée : les noms restent lisibles dans le cœur comme dans la page
  for (const js of ['split', 'bundle'] as const) {
    it(`production, fichiers ${js === 'split' ? 'séparés' : 'en un seul'} : chaque fonction du cœur que la page du journal appelle est dans le cœur de l'appli, ou apportée par la page`, async () => {
      const manifeste  = await construire({ js, env: 'prod', minify: false })
      const sortie     = dirname(manifeste)
      const coeur      = js === 'split' ? readFileSync(join(sortie, readdirSync(sortie).find(f => /^mjs_core.*\.js$/.test(f)) ?? 'mjs_core.js'), 'utf-8') : readFileSync(manifeste, 'utf-8')
      const page       = await getViewerScript(manifeste, JOURNAL_VIEWER)
      const { output } = await transpile(localizeViewerSource(readFileSync(join(ICI, '..', 'src', 'server', 'errors-viewer.mjs'), 'utf8')), { moduleName: 'journal-viewer' })
      const appelees   = [...new Set([...output.matchAll(/\.(_mjs_\w+)\(/g)].map(m => m[1]))].sort()
      const definie    = (texte: string, nom: string): boolean => new RegExp(`\\.${nom}\\s*(?:\\|\\|)?=\\s*(?:async\\s+)?(?:function\\b|\\([^()]*\\)\\s*=>)|^\\s*(?:async\\s+)?${nom}\\s*\\([^()]*\\)\\s*\\{`, 'm').test(texte)
      assert.ok(appelees.includes('_mjs_updAttrNode') && appelees.includes('_mjs_mount'), `garde muette : la page appelle les fonctions du cœur (${appelees.join(', ')})`)
      assert.ok(definie(coeur, '_mjs_mount') && !definie('µ._mjs_updAttrNode(n, a, v)', '_mjs_updAttrNode'), 'garde muette : une définition se reconnaît, un appel non')
      const manque = appelees.filter(nom => !definie(coeur, nom) && !definie(page, nom))
      assert.deepEqual(manque, [], `la page du journal appelle ce que ni le cœur de production ni la page n'apportent : ${manque.join(', ')}`)
      // et ce qu'appelle à son tour un bloc que la page apporte (la valeur d'un <select>, le filtre des attributs) : dans le cœur, ou apporté
      const blocs = ((pageVisionneuse as any).VIEWER_RUNTIME ?? []).filter((e: { block?: string }) => e.block !== undefined).map((e: { member: string }) => e.member)
      assert.ok(blocs.length >= 3, `garde muette : la page sait apporter les aides d'écriture (${blocs.join(', ')})`)
      const absents = blocs.filter((nom: string) => !definie(coeur, nom) && !definie(page, nom))
      assert.deepEqual(absents, [], `ni le cœur de production ni la page n'ont : ${absents.join(', ')}`)
    })
  }

  it('un fichier joint hors de la portée du cœur n\'y lit aucun nom que la page ne déclare pas', () => {
    const linter = new Linter()
    const dir    = join(ICI, '..', 'src', 'runtime')
    // les noms déclarés au niveau d'un fichier du runtime : dans une application, ils vivent dans la portée du module du cœur, jamais sur `µ`
    const portee  = new Set<string>()
    const relever = { rules: { noms: { create: (ctx: any) => ({ 'Program:exit': (n: any) => { const g = ctx.sourceCode.getScope(n); for (const s of [g, ...g.childScopes.filter((c: any) => c.type === 'module')]) for (const v of s.variables) portee.add(v.name) } }) } } }
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))) {
      const erreurs = linter.verify(transformSync(readFileSync(join(dir, f), 'utf8'), { loader: 'ts' }).code, { languageOptions: { ecmaVersion: 'latest', sourceType: 'module' }, plugins: { t: relever }, rules: { 't/noms': 'error' } }).filter((m) => m.fatal)
      assert.deepEqual(erreurs.map((m) => m.message), [], `${f} se lit`)
    }
    // les noms qu'un code lit sans les déclarer, `µ` à part
    const libres = (code: string) => [...new Set(linter.verify(code, { languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { µ: 'readonly' } }, rules: { 'no-undef': 'error' } }).map((m) => /'([^']+)'/.exec(m.message)?.[1] ?? m.message))]
    assert.ok(portee.has('MJS_RESOLVED_DESTROY') && portee.has('MJS_BOOLEAN_PROPS'), 'garde muette : les noms de la portée du cœur sont relevés')
    assert.deepEqual(libres('MJS_RESOLVED_DESTROY.then(() => µ)'), ['MJS_RESOLVED_DESTROY'], 'garde muette : un nom lu sans déclaration est relevé')
    const tete   = 'import { µ } from "/cœur.js";\n'
    const apport = (pageVisionneuse as any).withViewerRuntime(tete, (pageVisionneuse as any).VIEWER_RUNTIME ?? []) as string
    const lus    = libres(apport).filter((nom) => portee.has(nom))
    assert.deepEqual(lus, [], `la page joint des fichiers qui lisent ces noms de la portée du cœur sans les déclarer : ${lus.join(', ')}`)
  })
})
