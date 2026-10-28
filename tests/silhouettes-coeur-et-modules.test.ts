// La silhouette d'un composant dont le code arrive (`µ._skels`, au manifeste) : `<@carte *skeleton>`
// la demande pour le composant du projet, `<@@switch *skeleton>` pour le module cœur — sous sa clé,
// `core-switch`, jamais celle d'un composant du projet homonyme. Avec `effects.skeleton: ['components']`,
// chaque composant qui attend un contenu (un {await}) a la sienne ; un module `.civet` n'a pas de gabarit,
// donc pas de silhouette.
// Un projet qui change entre deux tours de `mjs dev` (même instance du bundler) voit sa demande suivie.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

function projet(etiquette: string, fichiers: Record<string, string>, effects?: unknown) {
  const root   = mjsTmp('silhouettes-' + etiquette)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), ...(effects ? { effects } : {}) } as any)
  const cles    = () => {
    const m = /µ\._skels = (\{.*?\});/.exec(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    return m ? Object.keys(JSON.parse(m[1].replace(/\\u003c/g, '<'))).sort() : []
  }
  return { srcDir, bundler, cles }
}

const erreurs = (stats: any) => stats.errors.map((e: any) => e.message).join('\n')

describe('silhouettes : modules cœur, modules de script, suivi entre deux tours', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('<@@switch *skeleton> : la silhouette du module cœur, sous sa clé ; le composant homonyme du projet n\'en reçoit pas', async () => {
    const p = projet('coeur', {
      'page.mjs':   '<@@switch *skeleton></@@switch>\n<@carte *skeleton></@carte>\n<@switch></@switch>\n',
      'carte.mjs':  '<div class="c"><h2>Titre</h2></div>\n',
      'switch.mjs': '<div class="s"><p>projet</p></div>\n',
    })
    const stats = await p.bundler.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.deepEqual(p.cles(), ['carte', 'core-switch'])
    await p.bundler.close()
  })

  it('effects.skeleton: [\'components\'] : chaque composant qui attend un contenu, jamais un module .civet', async () => {
    const p = projet('components', {
      'carte.mjs':  '<div class="c">{await $c}{success v}<h2>{v.titre}</h2><p>texte</p>{end}</div>\n',
      'util.civet': 'export f := (x) -> x + 1\n',
      'page.mjs':   "@import util 'util.civet'\n<@carte></@carte>\n",
    }, { skeleton: ['components'] })
    const stats = await p.bundler.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.deepEqual(p.cles(), ['carte'])
    await p.bundler.close()
  })

  it('entre deux tours : une demande ajoutée est suivie, une demande retirée aussi', async () => {
    const p = projet('tours', {
      'page.mjs':  '<@carte></@carte>\n',
      'carte.mjs': '<div class="c"><h2>Titre</h2></div>\n',
    })
    await p.bundler.compile()
    assert.deepEqual(p.cles(), [])
    writeFileSync(join(p.srcDir, 'page.mjs'), '<@carte *skeleton></@carte>\n')
    await p.bundler.compile()
    assert.deepEqual(p.cles(), ['carte'])
    writeFileSync(join(p.srcDir, 'page.mjs'), '<@carte></@carte>\n')
    await p.bundler.compile()
    assert.deepEqual(p.cles(), [])
    await p.bundler.close()
  })
})
