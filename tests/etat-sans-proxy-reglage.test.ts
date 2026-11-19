// réglage `proxy` de mjs.config.json : absent ou `true` (défaut), un objet rangé dans une variable `$` est enveloppé (Proxy),
// filet des changements faits hors de MJS ; `false`, il est rangé tel quel, sans aucune enveloppe — les écritures que le
// compilateur voit préviennent comme avant, un changement fait hors de MJS se signale par `µrefresh($x)`. Avec `false`, le cœur
// ne porte plus l'enveloppe ni les aides qu'elle est seule à appeler, en production comme en développement (le développement
// se comporte comme la production) ; µ.state et µ.Store, qui partagent deux de ces aides, les gardent. Toute autre valeur est
// refusée. Cœur non minifié : les noms internes y gardent leur texte

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as acorn from 'acorn'
import { mjsTmp } from './helpers/tmp.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'

function options(config: unknown) {
  const root  = mjsTmp('cfg-proxy')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config))
  const found = findConfig(root)
  assert.ok(found, 'mjs.config.json trouvé')
  return resolveBundlerOpts(found!.config, root)
}

const OBJET = '<script>\n$o = { a: { b: 1 } }\n@ecrire = -> $o.a.b = 2\n</script>\n<p>{$o.a.b}</p>\n'

// les signaux du code compilé d'un composant, comme le build les relève
const signaux = async (source: string) => scanCompiledFeatures((await transpile(source, { moduleName: 'c' })).output)

// le cœur assemblé, non minifié
const coeur = async (used: Set<string>, opts: Record<string, unknown> = {}) => {
  const out     = mjsTmp('sans-proxy')
  const bundler = new Bundler({ outputDir: out, manifestPath: join(out, 'bundle.js'), minify: false, ...opts } as any)
  const chemin  = await bundler.bundleRuntime(used)
  return chemin === 'mjs:core' ? (bundler as any).bundleVirtualSources.get('mjs_core') as string : readFileSync(join(out, basename(chemin)), 'utf-8')
}

// l'enveloppe et les aides qu'elle est seule à appeler, par le début de leur définition
const ENVELOPPE = ['proxy = new Proxy(target, handler);', 'const MJS_ENV_TRAPS = (class {', 'function _mjsEnvWrap(h, obj) {', 'function _mjsEnvMut(h, obj, prop, val) {', 'function _mjsEnvRelay(h, obj) {', 'MJS_DATE_MUTATORS = new Set([', 'function _mjsSnapBefore(el, rootKey, obj) {', 'function _mjsMutated(h, obj, snap) {', 'function _mjsKidsForget() {']
// les deux aides de lecture qu'elle partage avec µ.state et µ.Store (mjs_init.ts)
const AIDES     = ['µ._mjs_fixed = (o, k) =>', 'µ._mjs_readFn = (o, k, f, p, w) =>']
// le refus du mur des prototypes, qu'elle partage avec µ.state et µ.Store (mjs_element.ts) : gardé pour eux sans elle
const MUR       = ['function _mjsEnvReject(seg) {']
// l'objet rangé tel quel, sa clé notée
const TELQUEL = ['_mjs_wrapDeep(target, rootKey) {']
const BLOCS   = ['wrapper', 'no-wrapper', 'wrapper-helpers', 'wall']

const tous    = (texte: string, jalons: string[], quoi: string) => { for (const j of jalons) assert.ok(texte.includes(j), `${quoi} : « ${j} » manque`) }
const aucun   = (texte: string, jalons: string[], quoi: string) => { for (const j of jalons) assert.ok(!texte.includes(j), `${quoi} : « ${j} » est encore là`) }
const valide  = (texte: string) => assert.doesNotThrow(() => acorn.parse(texte, { ecmaVersion: 'latest', sourceType: 'module' }), 'le cœur n\'est plus du JavaScript valide')
const marques = (texte: string, blocs = BLOCS) => { for (const nom of blocs) assert.doesNotMatch(texte, new RegExp(`^[ \\t]*// </?${nom}>$`, 'm'), `une marque du bloc ${nom} est restée seule`) }

describe('mjs.config.json — réglage proxy', () => {
  it('absent : rien n\'est transmis au bundler, qui garde l\'enveloppe (défaut)', () => {
    assert.equal(options({}).proxy, undefined)
  })

  it('true et false sont acceptés et transmis au bundler', () => {
    assert.equal(options({ proxy: true }).proxy, true)
    assert.equal(options({ proxy: false }).proxy, false)
  })

  it('la CLI (`mjs build`, `mjs dev`) le transmet au bundler, et son littéral de repli (sans mjs.config.json) le déclare', () => {
    // lu sur le texte de cli.ts, comme les réglages voisins : une clé résolue mais jamais transmise serait morte, sans erreur
    const cli = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts'), 'utf-8')
    assert.match(cli, /^\s*proxy:\s+cfgOpts\.proxy,$/m, 'proxy: cfgOpts.proxy manque au new Bundler de la CLI')
    assert.match(cli, /derivedMode: undefined,(?: [A-Za-z]+: undefined,)* proxy: undefined,/, 'le littéral de repli ne déclare pas proxy')
  })

  it('une autre valeur est refusée, dans la forme des messages voisins : la clé, « doit être », les deux valeurs permises, « reçu : » et la valeur reçue', () => {
    assert.throws(() => options({ proxy: 'non' }), (e: Error) => /^\[mjs\.config\.json\] proxy doit être true \(défaut : .+\) ou false \(.+µrefresh\(\$x\).+\), reçu : "non"$/.test(e.message), 'message attendu')
    assert.throws(() => options({ proxy: 0 }), (e: Error) => /^\[mjs\.config\.json\] proxy doit être .+, reçu : 0$/.test(e.message))
  })
})

describe('cœur sans enveloppe de l\'état (réglage proxy: false)', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('production : ni l\'enveloppe ni ses aides, l\'objet rangé tel quel', async () => {
    const texte = await coeur(await signaux(OBJET), { env: 'prod', proxy: false })
    aucun(texte, [...ENVELOPPE, ...AIDES, ...MUR], 'production sans enveloppe')
    tous(texte, TELQUEL, 'production sans enveloppe')
    marques(texte)
    valide(texte)
  })

  it('développement : le même cœur sans enveloppe, comme la production', async () => {
    const texte = await coeur(await signaux(OBJET), { proxy: false })
    aucun(texte, [...ENVELOPPE, ...AIDES, ...MUR], 'développement sans enveloppe')
    tous(texte, TELQUEL, 'développement sans enveloppe')
    marques(texte)
    valide(texte)
  })

  it('µ.state au cœur garde les deux aides de lecture et le refus du mur des prototypes qu\'il partage, sans l\'enveloppe de l\'état', async () => {
    const texte = await coeur(new Set([...await signaux(OBJET), 'state']), { env: 'prod', proxy: false })
    assert.ok(texte.includes('// === mjs_state.ts ==='), 'µ.state n\'entre plus au cœur : ce cas ne prouve plus rien')
    tous(texte, [...AIDES, ...MUR], 'µ.state au cœur')
    aucun(texte, ENVELOPPE, 'µ.state au cœur')
    valide(texte)
  })

  it('sans le réglage, ou avec proxy: true, le cœur garde l\'enveloppe et ses aides, en production comme en développement', async () => {
    for (const [cas, opts] of [['production', { env: 'prod' }], ['production, proxy: true', { env: 'prod', proxy: true }], ['développement', {}]] as const) {
      const texte = await coeur(await signaux(OBJET), opts)
      tous(texte, [...ENVELOPPE, ...AIDES, ...MUR], cas)
      aucun(texte, TELQUEL, cas)
      // gardé, le bloc des aides garde ses marques en commentaire, comme les aides d'écriture voisines ; l'enveloppe perd les siennes
      marques(texte, ['wrapper', 'no-wrapper'])
      valide(texte)
    }
  })
})
