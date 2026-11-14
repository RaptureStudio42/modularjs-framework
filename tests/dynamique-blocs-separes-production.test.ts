// `<@element>` et `<@module>` partagent mjs_dynamic.ts, mais aucune des deux parties ne se sert de l'autre : en production, le cœur d'une
// appli qui n'écrit que l'une ne porte pas le code de l'autre. Le module demandé par `runtime` (`'all'`, ou `'dynamic'` dans la liste) et
// tout build qui n'est pas de production gardent les deux. Les blocs de la classe étalée vivent DANS les deux parties : une partie retirée
// part avec le sien, même gardé par un étalement ; une partie gardée perd le sien seul (aucun étalement) et le reste de sa fonction reste
// intact. Cœur de production non minifié : les noms internes y gardent leur texte

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as acorn from 'acorn'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanCompiledFeatures, SPREAD_CLASS } from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'

const ELEMENT = '<script>\n$tag = \'section\'\n</script>\n<@element $tag data-t="el">x</@element>\n'
const MODULE  = '<script>\n$comp = \'dyn-ca\'\n$x    = {\'data-k\': \'k1\'}\n</script>\n<@module $comp data-t="mod" {...$x}></@module>\n'
const DEUX    = '<script>\n$tag  = \'section\'\n$comp = \'dyn-ca\'\n</script>\n<@element $tag data-t="el">x</@element>\n<@module $comp data-t="mod"></@module>\n'
const AUCUN   = '<script>\n$a = 1\n</script>\n<p>{$a}</p>\n'

// les signaux du code compilé d'un composant, comme le build les relève
const signaux = async (source: string) => scanCompiledFeatures((await transpile(source, { moduleName: 'c' })).output)

// la part de mjs_dynamic.ts dans le cœur (vide quand le module n'y entre pas)
const partDynamique = async (source: string, opts: Record<string, unknown> = {}) => {
  const out     = mjsTmp('dynamique-blocs')
  const bundler = new Bundler({ outputDir: out, manifestPath: join(out, 'bundle.js'), minify: false, ...opts } as any)
  const chemin  = await bundler.bundleRuntime(await signaux(source))
  // en fichier unique le cœur reste en mémoire, sous un nom virtuel
  const texte   = chemin === 'mjs:core' ? (bundler as any).bundleVirtualSources.get('mjs_core') : readFileSync(join(out, basename(chemin)), 'utf-8')
  const debut   = texte.indexOf('// === mjs_dynamic.ts ===')
  if (debut < 0) return ''
  const fin     = texte.indexOf('\n// === ', debut + 1)
  return texte.slice(debut, fin < 0 ? texte.length : fin)
}

const PROD = { env: 'prod' }

// les deux fonctions et leurs aides ; jalons de chaque fonction, dans l'ordre, autour de son bloc de la classe étalée
const ELEMENT_FN      = 'µ._updDynEl = function'
const MODULE_FN       = 'µ._updModule = function'
const MODULE_AIDES    = ['µ._mjs_modTag = ', 'µ._mjs_modProps = ', 'µ._mjs_modSame = ', 'µ._mjs_modSet = ', 'µ._mjs_modGlob = ', 'µ._mjs_modAttrs = ']
const COMMUNES        = ['µ._mjs_swap = ', 'µ._mjs_dynTagsRefuses = ', 'µ._mjs_dynAcceptList = ', 'µ._mjs_dynMask = ', 'µ._mjs_dynUnmask = ']
const ELEMENT_JALONS  = ['nn._mjs_spk = cur._mjs_spk;', 'var onceMap = component._mjs_once_fired;', 'µ._mjs_swap(cur, nn);', 'curs[j] = nn;', 'if (component._mjs_nodes) {']
const MODULE_JALONS   = ['µ._mjs_modAttrs(nn, attrs);', 'µ._mjs_modProps(nn, props);', 'var onceMap = component._mjs_once_fired;', 'µ._mjs_swap(cur, nn);', 'nn._mjs_modOrig   = tete;', 'if (component._mjs_nodes) {']
const ELEMENT_PROPRES = ['curs[j] = nn;', 'var tagStr = ', 'document.createElement(tagStr)']
const ELEMENT_CLASSE  = '_mjs_clsBases.set(nn, _mjs_clsBases.get(cur));'
const MODULE_CLASSE   = 'if (_mjs_spCk.has(cur)) _mjs_spCk.set(nn, _mjs_spCk.get(cur));'
const marque          = (nom: string) => new RegExp(`^[ \\t]*// </?${nom}>$`, 'm')

// le texte d'une fonction du module dans le cœur, de sa définition à son accolade finale
const fonction = (part: string, nom: string) => {
  const d = part.indexOf(`µ.${nom} = function`)
  return d < 0 ? '' : part.slice(d, part.indexOf('\n};\n', d) + 3)
}

const valide     = (part: string) => assert.doesNotThrow(() => acorn.parse(part, { ecmaVersion: 'latest', sourceType: 'script' }), 'la part de mjs_dynamic.ts du cœur n\'est plus du JavaScript valide')
const tous       = (part: string, textes: string[], quoi: string) => { for (const t of textes) assert.ok(part.includes(t), `${quoi} : « ${t} » manque`) }
const aucun      = (part: string, textes: string[], quoi: string) => { for (const t of textes) assert.ok(!part.includes(t), `${quoi} : « ${t} » est encore là`) }
const dansLOrdre = (texte: string, jalons: string[], quoi: string) => {
  let i = 0
  for (const j of jalons) {
    const k = texte.indexOf(j, i)
    assert.ok(k >= 0, `${quoi} : « ${j} » manque ou n'est plus à sa place`)
    i = k + j.length
  }
}

describe('mjs_dynamic.ts en production : la partie de <@element> et celle de <@module> n\'entrent qu\'avec leur balise', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('<@element> seul : la partie de <@module> part, la partie élément perd son bloc de la classe étalée et garde tout le reste', async () => {
    const part = await partDynamique(ELEMENT, PROD)
    tous(part, [ELEMENT_FN, ...COMMUNES], 'partie élément et aides communes')
    const fe = fonction(part, '_updDynEl')
    dansLOrdre(fe, ELEMENT_JALONS, 'µ._updDynEl')
    aucun(fe, [ELEMENT_CLASSE, '_mjs_clsBases'], 'bloc de la classe étalée sans étalement')
    aucun(part, [MODULE_FN, ...MODULE_AIDES], 'partie de <@module>')
    for (const nom of ['module-dynamique', 'etale-classe']) assert.doesNotMatch(part, marque(nom), `une marque du bloc ${nom} est restée seule`)
    valide(part)
  })

  it('<@module> seul, étalé : la partie élément part tout entière, son bloc de la classe étalée compris (gardé par l\'étalement)', async () => {
    assert.ok((await signaux(MODULE)).has(SPREAD_CLASS), 'l\'étalement sur <@module> ne réclame plus la classe étalée : ce cas ne prouve plus rien')
    const part = await partDynamique(MODULE, PROD)
    tous(part, [MODULE_FN, ...MODULE_AIDES, ...COMMUNES], 'partie de <@module> et aides communes')
    dansLOrdre(fonction(part, '_updModule'), ['µ._mjs_dynUnmask(cur);', MODULE_CLASSE, ...MODULE_JALONS], 'µ._updModule et son bloc de la classe étalée')
    aucun(part, [ELEMENT_FN, ELEMENT_CLASSE, ...ELEMENT_PROPRES], 'partie élément')
    assert.doesNotMatch(part, marque('element-dynamique'), 'une marque de la partie élément est restée seule')
    valide(part)
  })

  it('les deux balises, sans étalement : les deux parties restent, chacune sans son bloc de la classe étalée', async () => {
    const part = await partDynamique(DEUX, PROD)
    tous(part, [ELEMENT_FN, MODULE_FN, ...MODULE_AIDES, ...COMMUNES], 'les deux parties')
    dansLOrdre(fonction(part, '_updDynEl'), ELEMENT_JALONS, 'µ._updDynEl')
    dansLOrdre(fonction(part, '_updModule'), MODULE_JALONS, 'µ._updModule')
    aucun(part, [ELEMENT_CLASSE, MODULE_CLASSE], 'blocs de la classe étalée sans étalement')
    valide(part)
  })

  it('aucune des deux balises : mjs_dynamic.ts n\'entre pas au cœur', async () => {
    assert.equal(await partDynamique(AUCUN, PROD), '')
  })

  it('module demandé par `runtime` (`\'all\'`, `\'dynamic\'` dans la liste) ou build de développement : les deux parties restent', async () => {
    for (const [cas, source, opts] of [['runtime: \'all\'', ELEMENT, { env: 'prod', runtime: 'all' }], ['runtime: [\'dynamic\'], aucune balise', AUCUN, { env: 'prod', runtime: ['dynamic'] }], ['développement', ELEMENT, {}]] as const) {
      const part = await partDynamique(source, opts)
      tous(part, [ELEMENT_FN, MODULE_FN, ...MODULE_AIDES, ...COMMUNES], cas)
      dansLOrdre(fonction(part, '_updDynEl'), ELEMENT_JALONS, `${cas}, µ._updDynEl`)
      dansLOrdre(fonction(part, '_updModule'), MODULE_JALONS, `${cas}, µ._updModule`)
      valide(part)
    }
  })
})
