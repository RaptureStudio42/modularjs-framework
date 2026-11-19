// `mjs build --cache` : une construction en échec garde sur le disque ce qui a compilé. La suivante, la faute corrigée, ne
// recompile que le fichier corrigé — premier passage en échec compris, et sans refaire un fichier changé qui avait compilé
// pendant le tour en échec — et sa sortie est identique à l'octet à une construction complète en dossier neuf.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, gaps, write } from './helpers/construction-cache.js'

const CONFIG = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs' }
// un script que Civet ne sait pas lire : la construction échoue
const BROKEN  = '<script>\n  x := ((\n</script>\n'
const PIED    = '<footer class="p">pied</footer>\n'
const SOURCES: Record<string, string> = {
  'app/modularjs/accueil.mjs': '<h1 class="t">accueil</h1>\n<@carte />\n<@pied />\n',
  'app/modularjs/carte.mjs':   '<script>\n$n = 1\n</script>\n<p class="c">{$n}</p>\n',
  'app/modularjs/pied.mjs':    PIED,
  'app/modularjs/libre.mjs':   '<p class="l">libre</p>\n',
}

function project(prefix: string): string {
  const root = mjsTmp(prefix)
  write(join(root, 'mjs.config.json'), JSON.stringify(CONFIG))
  for (const [rel, data] of Object.entries(SOURCES)) write(join(root, rel), data)
  // le cache sur disque vit sous node_modules/.cache : sans ce dossier, il est écarté
  mkdirSync(join(root, 'node_modules'))
  return root
}

// écarts à l'octet entre la sortie sur place et une construction complète en dossier neuf
function gapsWithFullBuild(root: string): string[] {
  const fresh = join(root, 'complete-neuve')
  const run   = build(root, ['--output', fresh, '--manifest', join(fresh, 'bundle.js')])
  assert.equal(run.status, 0, run.out)
  return gaps(join(root, 'public/modularjs'), fresh)
}

describe('mjs build --cache : une construction en échec garde ce qui a compilé', function () {
  this.timeout(180000)

  it('premier passage en échec : le cache est écrit, la construction réparée ne recompile que le fichier corrigé', function () {
    const root = project('cache-premier-echec')
    const pied = join(root, 'app/modularjs/pied.mjs')
    writeFileSync(pied, `${PIED}${BROKEN}`)
    const failed = build(root, ['--cache'])
    assert.notEqual(failed.status, 0, failed.out)
    assert.ok(existsSync(join(root, 'node_modules/.cache/mjs/build')), `aucun cache écrit après la construction en échec\n${failed.out}`)
    writeFileSync(pied, PIED)
    const repaired = build(root, ['--cache'])
    assert.equal(repaired.status, 0, repaired.out)
    assert.deepEqual({ recompiles: repaired.cold, repris: repaired.served }, { recompiles: 1, repris: 3 }, repaired.out)
    assert.deepEqual(gapsWithFullBuild(root), [])
  })

  it('cache d\'une construction réussie, deux fichiers changés dont un en échec : la réparation ne recompile que lui', function () {
    const root = project('cache-echec-apres-reussite')
    assert.equal(build(root, ['--cache']).status, 0)
    const pied = join(root, 'app/modularjs/pied.mjs')
    writeFileSync(join(root, 'app/modularjs/carte.mjs'), '<script>\n$n = 2\n</script>\n<p class="c">{$n}</p>\n')
    writeFileSync(pied, `${PIED}${BROKEN}`)
    const failed = build(root, ['--cache'])
    assert.notEqual(failed.status, 0, failed.out)
    // réparé autrement qu'avant : le cache de la construction réussie ne le connaît pas
    writeFileSync(pied, '<footer class="p">pied réparé</footer>\n')
    const repaired = build(root, ['--cache'])
    assert.equal(repaired.status, 0, repaired.out)
    assert.deepEqual({ recompiles: repaired.cold, repris: repaired.served }, { recompiles: 1, repris: 3 }, repaired.out)
    assert.deepEqual(gapsWithFullBuild(root), [])
  })
})
