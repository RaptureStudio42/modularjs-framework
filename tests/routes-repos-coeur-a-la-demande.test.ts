// Construction : le chargement au repos des pages d'une table de routes (bloc balisé `<routes-idle>` de runtime/mjs_router.ts et
// runtime/mjs_autoloader.ts — `µ._mjs_routesIdle`, `µ._mjs_routesQuiet`) n'entre au cœur que si un composant le demande : une table
// sous "idle" (défaut), "on" ou "off" (sous "on", la demande de la page montée et la reprise d'un fichier raté en dépendent). Une
// appli sans table ne paie pas un octet de ce code

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import * as features from '../src/bundler/features.js'
import { mjsTmp } from './helpers/tmp.js'

const AVEC: Record<string, string> = {
  'shell.page.mjs': '<routes target="root">\n  /   page-a\n  /b  page-b\n</routes>\n<a href="#/b">B</a>\n<@view root>\n',
  'page-a.mjs':     '<p>A</p>\n',
  'page-b.mjs':     '<p>B</p>\n',
}
const SANS: Record<string, string> = {
  'accueil.mjs': '<p>accueil</p>\n<@carte></@carte>\n',
  'carte.mjs':   '<a href="/autre">autre</a>\n',
}

// le cœur construit (non minifié) d'une appli à unités séparées
async function coeur(nom: string, sources: Record<string, string>, env: 'dev' | 'prod', routesPreload?: 'on' | 'idle' | 'off'): Promise<string> {
  const root   = mjsTmp('routes-repos-' + nom + '-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, c] of Object.entries(sources)) writeFileSync(join(srcDir, f), c)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), js: 'split', env, minify: false, routesPreload } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const fichier = readdirSync(outDir).find((f) => /^mjs_core/.test(f) && f.endsWith('.js'))
  assert.ok(fichier, `cœur introuvable dans ${readdirSync(outDir).join(', ')}`)
  return readFileSync(join(outDir, fichier), 'utf-8')
}

describe('chargement au repos des pages — seulement quand une table le demande', function () {
  this.timeout(180000)

  after(async () => { await terminateSharedWorkerPool() })

  it('signal : l\'appel émis par le compilateur le pose', () => {
    const signal = (features as any).ROUTES_IDLE
    assert.equal(typeof signal, 'string', 'le signal est publié par le module des signaux')
    assert.equal(features.scanCompiledFeatures('µ._mjs_routesIdle?.(["a-page"]);').has(signal), true)
    assert.equal(features.scanCompiledFeatures('µ._mjs_routesIdle?.([]);').has(signal), true)
    assert.equal(features.scanCompiledFeatures("µ.Autoloader?.load?.('mjs-a-page');").has(signal), false)
  })

  for (const env of ['dev', 'prod'] as const) {
    it(`cœur (${env === 'dev' ? 'développement' : 'production'}) : absent sans table, présent sous "idle", "on" et "off"`, async () => {
      for (const [cas, c] of [['sans table', await coeur('sans', SANS, env)]] as const) {
        assert.equal(c.includes('_mjs_routesIdle'), false, `${cas} : ni la file au repos`)
        assert.equal(c.includes('µ._idle = function'), false, `${cas} : ni l'attente commune des files du repos`)
        assert.equal(c.includes('_mjs_busy'), false, `${cas} : ni le compte des demandes en vol`)
        assert.equal(c.includes('<routes-idle>'), false, `${cas} : le bloc balisé est retiré`)
      }
      for (const [cas, c] of [['défaut', await coeur('defaut', AVEC, env)], ['"on"', await coeur('on', AVEC, env, 'on')], ['"off"', await coeur('off', AVEC, env, 'off')]] as const) {
        assert.equal(c.includes('µ._mjs_routesIdle = function'), true, `${cas} : la file au repos est au cœur`)
        assert.equal(c.includes('µ._idle = function'), true, `${cas} : l'attente commune des files du repos aussi`)
      }
    })
  }
})
