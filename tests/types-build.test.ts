// Types et valeurs permises — le build : les fichiers *.types.mjs (règles nommées, valables dans
// toute l'appli) ne sont pas des composants ; leurs règles arrivent à chaque composant qui les cite,
// et un changement de règle recompile ceux qui s'en servent. Le module runtime n'est embarqué que
// si un composant écrit un <vars>. En développement, le manifeste dit ce que fait une valeur
// interdite (`"types": "warn"` par défaut, ou `"error"`) ; en production, rien.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

const VOLUME = ['<vars>', '  $volume  Percent', '</vars>', '<script>', '  $volume = 50', '</script>', '<p>{$volume}</p>'].join('\n')

function projet(etiquette: string, fichiers: Record<string, string>) {
  const root   = mjsTmp(`types-build-${etiquette}`)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, contenu] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), contenu)
  const bundler = (opts: Record<string, unknown> = {}) => new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), ...opts })
  const lire    = () => {
    const out = readdirSync(join(root, 'out'))
    return {
      core:      readFileSync(join(root, 'out', out.find(f => /^mjs_core-/.test(f))!), 'utf-8'),
      manifeste: readFileSync(join(root, 'bundle.js'), 'utf-8'),
      composant: (nom: string) => readFileSync(join(root, 'out', out.find(f => f.startsWith(`${nom}-`) && f.endsWith('.js'))!), 'utf-8'),
    }
  }
  return { root, srcDir, bundler, lire }
}

const erreurs = (stats: any) => stats.errors.map((e: any) => e.message).join('\n')

describe('types — le build', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un fichier *.types.mjs donne ses règles aux composants ; le module runtime est embarqué ; le manifeste de dev prévient', async () => {
    const p = projet('ok', { 'app.types.mjs': '<types>\n  Percent  int 0..100\n</types>\n', 'volume.mjs': VOLUME })
    const b = p.bundler()
    const stats = await b.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    const { core, manifeste, composant } = p.lire()
    assert.match(composant('volume'), /volume:\{t:'i',a:0,b:100,d:"Percent"\}/)
    assert.match(core, /_mjs_storeTypes\s*=\s*function/, 'le module runtime (mjs_types.ts) est dans le cœur')
    assert.match(manifeste, /µ\._typesMode = "warn";/)
    assert.doesNotMatch(manifeste, /app-types|app\.types/, 'un fichier de types n’est pas un composant')
    await b.close()
  })

  it('"types": "error" dans le manifeste de développement', async () => {
    const p = projet('erreur', { 'app.types.mjs': '<types>\nPercent int 0..100\n</types>\n', 'volume.mjs': VOLUME })
    const b = p.bundler({ types: 'error' })
    const stats = await b.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.match(p.lire().manifeste, /µ\._typesMode = "error";/)
    await b.close()
  })

  it('production : ni mode dans le manifeste, ni texte des règles', async () => {
    const p = projet('prod', { 'app.types.mjs': '<types>\nPercent int 0..100\n</types>\n', 'volume.mjs': VOLUME })
    const b = p.bundler({ env: 'prod' })
    const stats = await b.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    const { manifeste, composant } = p.lire()
    assert.doesNotMatch(manifeste, /_typesMode/)
    assert.doesNotMatch(composant('volume'), /Percent/)
    await b.close()
  })

  it('sans <vars>, le module runtime reste dehors', async () => {
    const p = projet('sans', { 'simple.mjs': '<script>\n$a = 1\n</script>\n<p>{$a}</p>' })
    const b = p.bundler()
    const stats = await b.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.doesNotMatch(p.lire().core, /_mjs_storeTypes\s*=\s*function/)
    await b.close()
  })

  it('une règle changée recompile le composant qui s’en sert', async () => {
    const p = projet('cache', { 'app.types.mjs': '<types>\nPercent int 0..100\n</types>\n', 'volume.mjs': VOLUME })
    const b = p.bundler()
    let stats = await b.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    writeFileSync(join(p.srcDir, 'app.types.mjs'), '<types>\nPercent int 0..10\n</types>\n')
    stats = await b.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.match(p.lire().composant('volume'), /volume:\{t:'i',a:0,b:10,d:"Percent"\}/)
    await b.close()
  })

  it('refus : même nom dans deux fichiers, fichier impur ou sans bloc, règle inconnue dans une définition', async () => {
    const cas: [string, Record<string, string>, RegExp][] = [
      ['double', { 'a.types.mjs': '<types>\nPercent int 0..100\n</types>\n', 'b.types.mjs': '<types>\nPercent float 0..1\n</types>\n' }, /Percent[\s\S]*a\.types\.mjs[\s\S]*b\.types\.mjs|Percent[\s\S]*b\.types\.mjs[\s\S]*a\.types\.mjs/],
      ['impur', { 'a.types.mjs': '<types>\nPercent int 0..100\n</types>\n<script>\n$a = 1\n</script>\n' }, /a\.types\.mjs[\s\S]*<script>/],
      ['vide', { 'a.types.mjs': '<p>rien</p>\n' }, /a\.types\.mjs[\s\S]*<types>/],
      ['inconnue', { 'a.types.mjs': '<types>\nVolume Percnt\n</types>\n' }, /Percnt/],
    ]
    for (const [etiquette, fichiers, attendu] of cas) {
      const p = projet(`refus-${etiquette}`, fichiers)
      const b = p.bundler()
      await assert.rejects(b.compile().then((stats: any) => { if (stats.errors.length > 0) throw new Error(erreurs(stats)) }), attendu, etiquette)
      await b.close()
    }
  })

  it('refus : deux composants qui donnent deux règles différentes au même store', async () => {
    const p = projet('store-conflit', {
      'un.mjs':   '<vars>\n$$level int 1..3\n</vars>\n<p>{$$level}</p>',
      'deux.mjs': '<vars>\n$$level int 1..5\n</vars>\n<p>{$$level}</p>',
      'trois.mjs': '<vars>\n$$level int 1..3\n</vars>\n<p>{$$level}</p>',
    })
    const b = p.bundler()
    const stats = await b.compile()
    const conflits = stats.errors.filter((e: any) => /\$\$level/.test(e.message))
    assert.equal(conflits.length, 1, 'un seul message pour ce store : ' + erreurs(stats))
    assert.match(conflits[0].message, /int 1\.\.3[\s\S]*int 1\.\.5|int 1\.\.5[\s\S]*int 1\.\.3/)
    assert.match(conflits[0].message, /deux\.mjs/)
    await b.close()
  })
})

describe('types — la clé "types" de mjs.config.json', () => {
  const avec = (types: unknown) => {
    const root = mjsTmp('types-config')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', types }))
    return root
  }

  it('"warn" ou "error" : acceptés, et transmis au bundler', () => {
    for (const v of ['warn', 'error']) {
      const trouve = findConfig(avec(v))!
      assert.equal(resolveBundlerOpts(trouve.config, trouve.configDir).types, v)
    }
  })

  it('toute autre valeur est refusée, avec les deux valeurs possibles', () => {
    assert.throws(() => findConfig(avec('loud')), /types[\s\S]*warn[\s\S]*error/)
    assert.throws(() => findConfig(avec(true)), /types/)
  })
})
