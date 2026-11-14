// le cœur de production ne porte que les aides qu'une unité du build appelle, ou dont le cœur lui-même se sert encore : la mise à jour
// d'un attribut calculé (µ._mjs_updAttrNode et la méthode `_mjs_updAttr`), la valeur d'un <select> (µ._mjs_selVal), la prop posée sur un
// enfant pas encore mis à niveau (µ._mjs_pend), le filtre des attributs à risque (µ._mjs_safeAttr et ses tables) et la mise à jour d'un
// texte de la racine (`_mjs_updText`). Ce que le rendu serveur relit d'un composant (µ._ssrInfo, et son enveloppe du variant appliqué)
// n'entre en production qu'avec une construction qui peut rendre côté serveur. Tout build qui n'est pas de production, et le cœur demandé tout entier
// (`runtime: 'all'`), gardent les aides. Cœur de production non minifié : les noms internes y gardent leur texte

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as acorn from 'acorn'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'

const SANS   = '<script>\n$l = [{id: 1, n: \'a\'}]\n</script>\n<ul class="l">{for x in $l by id}<li title="t">{x.n}</li>{end}</ul>\n'
const ATTR   = '<script>\n$t = \'a\'\n</script>\n<p title={$t}>x</p>\n'
const LIGNE  = '<script>\n$l = [{id: 1, n: \'a\'}]\n</script>\n<ul class="l">{for x in $l by id}<li title={x.n}>x</li>{end}</ul>\n'
const PROP   = '<script>\n$v = 1\n</script>\n<mjs-enfant val={$v}></mjs-enfant>\n'
const TEXTE  = '<script>\n$a = 1\n</script>\n<p>{$a}</p>\n'

// les signaux du code compilé d'un composant, comme le build les relève
const signaux = async (source: string) => scanCompiledFeatures((await transpile(source, { moduleName: 'c' })).output)

// le cœur assemblé, non minifié
const coeur = async (used: Set<string>, opts: Record<string, unknown> = {}) => {
  const out     = mjsTmp('aides-jamais-appelees')
  const bundler = new Bundler({ outputDir: out, manifestPath: join(out, 'bundle.js'), minify: false, ...opts } as any)
  const chemin  = await bundler.bundleRuntime(used)
  // en fichier unique le cœur reste en mémoire, sous un nom virtuel
  return chemin === 'mjs:core' ? (bundler as any).bundleVirtualSources.get('mjs_core') as string : readFileSync(join(out, basename(chemin)), 'utf-8')
}

const PROD = { env: 'prod' }

// chaque aide, par le début de sa définition
const MAJ     = ['µ._mjs_updAttrNode = function', '_mjs_updAttr(id, attrName, val, sur) {']
const SELECT  = ['µ._mjs_selVal = ']
const ATTENTE = ['µ._mjs_pend = function', 'µ._mjs_ro = new WeakMap()']
const FILTRE  = ['µ._mjs_safeAttr = function', 'µ._mjs_isExecUrlAttr = function', 'µ._mjs_URL_ATTRS = ', 'µ._mjs_DANGER_SCHEMES = ', 'µ._mjs_ctrlCharRe = ', 'µ._mjs_schemeRe = ']
const TXT     = ['_mjs_updText(id, val) {']
const SERVEUR = ['µ._ssrInfo = function']
const VARIANT = ['var ssrInfo = µ._ssrInfo;']
const BLOCS   = ['attribut-maj', 'attribut-select', 'props-en-attente', 'attribut-filtre', 'texte-racine', 'infos-serveur']

const tous   = (texte: string, jalons: string[], quoi: string) => { for (const j of jalons) assert.ok(texte.includes(j), `${quoi} : « ${j} » manque`) }
const aucun  = (texte: string, jalons: string[], quoi: string) => { for (const j of jalons) assert.ok(!texte.includes(j), `${quoi} : « ${j} » est encore là`) }
const valide = (texte: string) => assert.doesNotThrow(() => acorn.parse(texte, { ecmaVersion: 'latest', sourceType: 'module' }), 'le cœur n\'est plus du JavaScript valide')
const marques = (texte: string) => { for (const nom of BLOCS) assert.doesNotMatch(texte, new RegExp(`^[ \\t]*// </?${nom}>$`, 'm'), `une marque du bloc ${nom} est restée seule`) }

describe('cœur de production : les aides qu\'aucune unité n\'appelle n\'y entrent pas', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('une liste de textes sans attribut calculé : ni la mise à jour des attributs, ni le filtre, ni la prop en attente, ni le texte de la racine, ni le rendu serveur', async () => {
    const texte = await coeur(await signaux(SANS), PROD)
    aucun(texte, [...MAJ, ...SELECT, ...ATTENTE, ...FILTRE, ...TXT, ...SERVEUR], 'appli sans ces aides')
    marques(texte)
    valide(texte)
  })

  it('un attribut calculé à la racine garde la mise à jour, la valeur d\'un <select> et le filtre, qu\'elle appelle', async () => {
    const texte = await coeur(await signaux(ATTR), PROD)
    tous(texte, [...MAJ, ...SELECT, ...FILTRE], 'attribut calculé')
    aucun(texte, ATTENTE, 'attribut calculé, sans prop d\'enfant')
    valide(texte)
  })

  it('un attribut calculé dans une ligne de liste (µ._mjs_updAttrNode appelé par la ligne) garde la mise à jour et ses aides', async () => {
    const texte = await coeur(await signaux(LIGNE), PROD)
    tous(texte, [...MAJ, ...SELECT, ...FILTRE], 'attribut calculé de ligne')
    valide(texte)
  })

  it('une prop posée sur un enfant garde µ._mjs_pend, sans la mise à jour des attributs', async () => {
    const texte = await coeur(await signaux(PROP), PROD)
    tous(texte, ATTENTE, 'prop d\'enfant')
    aucun(texte, [...MAJ, ...SELECT], 'prop d\'enfant, sans attribut calculé')
    valide(texte)
  })

  it('un texte de la racine garde `_mjs_updText`', async () => {
    const texte = await coeur(await signaux(TEXTE), PROD)
    tous(texte, TXT, 'texte de la racine')
    aucun(texte, [...MAJ, ...FILTRE], 'texte de la racine, sans attribut calculé')
    valide(texte)
  })

  it('un module du cœur qui se sert du filtre (fenêtres) le garde, lu sur le texte du cœur, sans la mise à jour des attributs', async () => {
    const texte = await coeur(await signaux(SANS), { env: 'prod', runtime: ['modal'] })
    assert.ok(texte.includes('// === mjs_modal.ts ==='), 'le module des fenêtres n\'entre plus au cœur : ce cas ne prouve plus rien')
    tous(texte, FILTRE, 'filtre appelé par le module des fenêtres')
    aucun(texte, MAJ, 'module des fenêtres, sans attribut calculé')
    valide(texte)
  })

  it('build de développement, cœur demandé tout entier (`runtime: \'all\'`) : toutes les aides restent', async () => {
    for (const [cas, opts] of [['développement', {}], ['runtime: \'all\'', { env: 'prod', runtime: 'all' }]] as const) {
      const texte = await coeur(await signaux(SANS), opts)
      tous(texte, [...MAJ, ...SELECT, ...ATTENTE, ...FILTRE, ...TXT], cas)
      valide(texte)
    }
  })

  it('µ._ssrInfo et son enveloppe du variant appliqué : en production, seulement avec une construction qui peut rendre côté serveur ; toujours en développement', async () => {
    const avecVariant = new Set([...await signaux(SANS), 'layout_variant'])
    const client      = await coeur(avecVariant, PROD)
    assert.ok(client.includes('// === mjs_layout_variant.ts ==='), 'le module des variants n\'entre plus au cœur : ce cas ne prouve plus rien')
    aucun(client, [...SERVEUR, ...VARIANT], 'construction sans rendu serveur')
    marques(client)
    valide(client)
    for (const [cas, opts] of [['moteur de rendu', { env: 'prod', serverRender: true }], ['bloc render en ssr', { env: 'prod', render: { default: 'ssr' } }], ['développement', {}]] as const) {
      const texte = await coeur(avecVariant, opts)
      tous(texte, [...SERVEUR, ...VARIANT], cas)
      valide(texte)
    }
  })
})
