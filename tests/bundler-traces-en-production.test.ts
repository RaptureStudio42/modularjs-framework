// les traces `µ.log` du cœur ne partent pas en production quand le niveau de console les coupe
//
// build RÉEL d'une appli routée (cœur complet : routeur, UJS, ajax, chargeur) en production, aux niveaux de
// console 'warn' (défaut), 'error' et 'silent', en fichiers séparés et en fichier unique (`js: 'bundle'`) : ni
// appel µ.log, ni appel gardé µ._mjs_logger()?.(…), ni leurs textes, ni l'aide µ._mjs_logger dans le code
// envoyé. Au niveau 'log' en production, et en développement, chaque trace est là comme avant
//
// les repères sont des chaînes ASCII qui n'existent que dans une trace : les noms de propriété sont raccourcis en
// production, les chaînes restent (le texte français de secours part, la clé de la table des messages reste)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ROUTEUR = [
  'routerLogRegister', 'routerLogInit', 'routerLogNavigate', 'routerLogCurtain', 'routerLogViewTransition', 'routerLogNative', 'routerLogNoRoutes',
  'routerLogAnalyze', 'routerLogMatch', 'routerLogNothingToInject', 'routerNoRouteLog', 'routerLogViewCleared', 'routerLogCacheHit', 'routerLogCreate',
]
const AUTRES  = ['ajax] Success']
// UJS écrit son texte deux fois : dans la trace du mode 'silent' et dans l'avertissement des autres modes, qui reste ;
// au niveau 'log' le manifeste le porte aussi, dans chaque langue (le texte des traces part avec lui)
const UJS = 'ujsNoPage'
// le chargeur de composants n'existe qu'en fichiers séparés : le fichier unique les embarque tous
const CHARGEUR = ['Downloading', 'ES6 Module instantiated']

const SOURCES: Record<string, string> = {
  'app.page.mjs':   ['<script>', '  @routes =', '    \'main\':', '      \'/\':      \'home-page\'', '      \'/about\': \'about-page\'', '</script>', '', '<nav><a href="#/">Accueil</a> <a href="#/about">A propos</a></nav>', '<@view main>'].join('\n'),
  'home-page.mjs':  '<h1>Accueil</h1>',
  'about-page.mjs': '<h1>A propos</h1>',
}

interface Built { code: string, cache: Record<string, string>, files: string[] }

async function build(opts: { env: 'prod' | 'dev', logLevel?: string, js?: 'bundle', minify?: boolean }): Promise<Built> {
  const root   = mjsTmp('traces-prod')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'dist', 'assets')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), contenu + '\n')
  // le compte des traces porte sur le cœur complet (routeur, navigation, connexion), que les sources ne citent pas : 'all', sauf
  // demande contraire du cas
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), runtime: 'all', ...opts } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter(f => f.endsWith('.js')).sort()
  const cache = join(outDir, '.mangle-cache.json')
  return { code: files.map(f => readFileSync(join(outDir, f), 'utf-8')).join('\n'), cache: existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf-8')) : {}, files }
}

// le nom court de µ dans le code réduit : celui dont la propriété `log` est définie (`n.log=function(…`)
function nomDeMu(code: string): string {
  const m = code.match(/([\w$]+)\.log=function\(/)
  assert.ok(m, 'la définition de µ.log est introuvable dans le code envoyé')
  return m![1]
}

// les appels `<µ>.log(` du code réduit
function appelsDeLog(code: string): number {
  return (code.match(new RegExp('(?<![\\w$.])' + nomDeMu(code).replace('$', '\\$') + '\\.log\\(', 'g')) || []).length
}

const present = (code: string, reperes: string[]) => reperes.filter(r => code.includes(r))
const fois    = (code: string, repere: string) => code.split(repere).length - 1

describe('traces du cœur en production — le niveau de console les coupe du code envoyé', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  const built: Record<string, Built> = {}
  before(async () => {
    built['défaut-fichiers']  = await build({ env: 'prod' })
    built['défaut-bundle']    = await build({ env: 'prod', js: 'bundle' })
    built['warn-fichiers']    = await build({ env: 'prod', logLevel: 'warn' })
    built['error-fichiers']   = await build({ env: 'prod', logLevel: 'error' })
    built['silent-bundle']    = await build({ env: 'prod', logLevel: 'silent', js: 'bundle' })
    built['log-fichiers']     = await build({ env: 'prod', logLevel: 'log' })
    built['log-bundle']       = await build({ env: 'prod', logLevel: 'log', js: 'bundle' })
    built['dev-fichiers']     = await build({ env: 'dev' })
    built['dev-minifié']      = await build({ env: 'dev', minify: true })
  })

  for (const nom of ['défaut-fichiers', 'défaut-bundle', 'warn-fichiers', 'error-fichiers', 'silent-bundle']) {
    it(`${nom} : aucune trace du routeur, d'UJS, d'ajax ni du chargeur, aucun appel µ.log, pas d'aide µ._mjs_logger`, () => {
      const { code, cache } = built[nom]
      assert.deepEqual(present(code, [...ROUTEUR, ...AUTRES, ...CHARGEUR]), [])
      assert.equal(fois(code, UJS), 1, 'le texte de l\'avertissement reste, celui de la trace est parti')
      assert.equal(appelsDeLog(code), 0)
      assert.equal(cache._mjs_logger, undefined)
      assert.ok(!code.includes('MJS_TRACE'))
    })
  }

  for (const nom of ['log-fichiers', 'log-bundle']) {
    it(`${nom} : chaque trace est là, avec ses appels et l'aide`, () => {
      const { code, cache } = built[nom]
      const chargeur = nom === 'log-fichiers' ? CHARGEUR : []
      assert.deepEqual(present(code, ROUTEUR), ROUTEUR)
      assert.equal(fois(code, UJS), 4, 'deux fois dans le cœur (la trace et l\'avertissement), puis une fois par langue dans le texte des traces que le manifeste porte')
      assert.deepEqual(present(code, [...AUTRES, ...CHARGEUR]), [...AUTRES, ...chargeur])
      assert.ok(appelsDeLog(code) >= 1 + chargeur.length, 'ajax, et le chargeur ×2 en fichiers séparés')
      assert.equal(typeof cache._mjs_logger, 'string')
      assert.ok(!code.includes('MJS_TRACE'))
    })
  }

  it('développement minifié : le niveau de production ne retire rien, chaque trace est là', () => {
    const { code } = built['dev-minifié']
    assert.deepEqual(present(code, [...ROUTEUR, ...AUTRES, ...CHARGEUR]), [...ROUTEUR, ...AUTRES, ...CHARGEUR])
    assert.ok(appelsDeLog(code) >= 3)
    assert.ok(!code.includes('MJS_TRACE'))
  })

  it('développement : les traces sont dans le code, sous leur forme du source, rien de réécrit', () => {
    const { code } = built['dev-fichiers']
    const sansCommentaires = code.replace(/^\s*\/\/.*$/gm, '')
    // en développement, le cœur embarque aussi µ.state, µ.smooth et µ.socket ; µ.smooth n'a plus de trace, µ.socket ne garde que celle de la poignée partie
    assert.equal(fois(sansCommentaires, 'µ._mjs_logger()?.('), 16, '13 traces du routeur, celle d\'UJS, celle des clés refusées par µ.state, celle d\'une poignée de salon déjà partie')
    assert.ok(code.includes('µ._mjs_logger = function'))
    assert.ok(code.includes('µ.log("[µ.ajax] Success"'))
    assert.ok(code.includes('[Autoloader]'))
    assert.deepEqual(present(code, [...ROUTEUR, ...AUTRES, ...CHARGEUR]), [...ROUTEUR, ...AUTRES, ...CHARGEUR])
    assert.ok(!code.includes('MJS_TRACE'))
  })
})
