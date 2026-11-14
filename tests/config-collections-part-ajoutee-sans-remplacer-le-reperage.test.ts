// mjs.config.json — `"collections": true` : la part des collections de l'état (suivi des clés objets, enveloppe des `WeakMap` et des
// `WeakSet`) est AJOUTÉE au cœur, pour une collection donnée par une bibliothèque chargée à part ; le repérage des autres modules reste
// celui d'une configuration sans la clé (une liste `runtime` le remplacerait). `false` ou absente : la sortie d'une configuration sans
// la clé, à l'octet. Toute autre valeur est refusée à la lecture de la configuration

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

function lire(config: Record<string, unknown>) {
  const root = mjsTmp('config-collections')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config))
  const found = findConfig(root)
  return resolveBundlerOpts(found!.config, root)
}

// une appli bâtie : ses fichiers `.js` par nom, et le paquet de production
async function construire(source: string, plus: Record<string, unknown> = {}, prod = true): Promise<Record<string, string>> {
  const root   = mjsTmp('config-collections-part')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'co-app.mjs'), source)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), ...plus }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle', minify: false })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [])
  const sortie: Record<string, string> = {}
  for (const f of readdirSync(outDir).filter((f) => f.endsWith('.js')).sort()) sortie[f] = readFileSync(join(outDir, f), 'utf-8')
  return sortie
}

// lu hors des lignes de commentaire : l'aide des clés et le carnet des collections faibles
const porte = (code: string) => { const c = code.replace(/^[ \t]*\/\/.*$/gm, ''); return { cles: /\._mjs_keyIn\b/.test(c), faibles: /\._mjs_weakRaw\b/.test(c) } }

// une appli qui ne nomme aucune collection : la `Map` lui vient de la page ; elle se sert d'une fenêtre modale (module optionnel repéré)
const VENUE = `<script>\n$m = window.__carte()\n@ouvrir = -> µ.modal.open('<p>a</p>')\n</script>\n<p class="v" @click={@ouvrir}>{$m.size}</p>\n`
const SANS  = `<script>\n$n = 1\n@ouvrir = -> µ.modal.open('<p>a</p>')\n</script>\n<p class="v" @click={@ouvrir}>{$n}</p>\n`

describe('mjs.config.json — collections : la part des collections ajoutée sans remplacer le repérage', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const mauvais of ['true', 1, null, ['collections'], { on: true }]) {
    it(`refuse ${JSON.stringify(mauvais)}`, () => {
      assert.throws(() => lire({ collections: mauvais }), (e: any) => {
        assert.match(e.message, /collections doit être true/)
        assert.match(e.message, /false/)
        assert.match(e.message, /bibliothèque chargée à part/)
        return true
      })
    })
  }

  for (const valeur of [true, false]) {
    it(`accepte ${valeur} et le transmet à la construction`, () => {
      assert.equal((lire({ collections: valeur }) as any).collections, valeur)
    })
  }

  it('sans réglage : rien n\'est transmis', () => {
    assert.equal((lire({}) as any).collections, undefined)
  })

  it('appli à `Map` venue de la page, sans clé `runtime` : avec `"collections": true` la part est dans le paquet', async () => {
    const sans = await construire(VENUE)
    const avec = await construire(VENUE, { collections: true })
    assert.deepEqual(porte(sans['bundle.js']), { cles: false, faibles: false })
    assert.deepEqual(porte(avec['bundle.js']), { cles: true, faibles: true })
  })

  it('appli sans collection : avec la clé la part y est aussi, et le repérage des autres modules reste le même', async () => {
    const sans  = await construire(SANS, {}, false)
    const avec  = await construire(SANS, { collections: true }, false)
    const liste = await construire(SANS, { runtime: ['collections'] }, false)
    const coeur = (s: Record<string, string>) => Object.entries(s).filter(([f]) => f.startsWith('mjs_')).map(([, c]) => c).join('\n')
    assert.deepEqual(porte(coeur(sans)), { cles: false, faibles: false })
    assert.deepEqual(porte(coeur(avec)), { cles: true, faibles: true })
    // la fenêtre modale repérée reste au cœur ; une liste remplace le repérage : elle en sortirait
    const modale = (s: Record<string, string>) => /_mjs_modalSheet\b/.test(coeur(s))
    assert.deepEqual([modale(sans), modale(avec), modale(liste)], [true, true, false])
  })

  it('`false` ou absente : la même sortie, à l\'octet', async () => {
    assert.deepEqual(await construire(SANS, { collections: false }), await construire(SANS))
    assert.deepEqual(await construire(SANS, { collections: false }, false), await construire(SANS, {}, false))
  })
})
