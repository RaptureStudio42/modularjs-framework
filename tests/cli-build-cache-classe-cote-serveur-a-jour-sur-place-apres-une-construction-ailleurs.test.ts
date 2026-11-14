// `mjs build --cache` : une classe changée, construite d'abord dans un autre dossier de sortie (`--output`, qui écrit le cache), puis sur
// place. Son module côté serveur (`node/<Classe>.js`) porte un nom fixe : sur place, il est celui d'une construction complète, jamais
// celui d'avant le changement

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, gaps, write } from './helpers/construction-cache.js'

const CONFIG = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs' }
const out    = (dir: string): string[] => ['--output', dir, '--manifest', join(dir, 'bundle.js')]

describe('mjs build --cache : classe côté serveur à jour sur place après une construction ailleurs', function () {
  this.timeout(300_000)

  it('classe changée, construite ailleurs puis sur place : node/<Classe>.js est celui de la construction complète', function () {
    const root = mjsTmp('cache-classe')
    write(join(root, 'app/modularjs/outil.mjs'), '<button @click={µOutils.un()}>un</button>\n')
    write(join(root, 'app/modularjs/Outils.class.mjs'), 'class Outils\n  un = -> 1\n')
    write(join(root, 'mjs.config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`)
    mkdirSync(join(root, 'node_modules'))
    const place = join(root, 'public/modularjs')
    const first = build(root, ['--cache'])
    assert.equal(first.status, 0, first.out)
    const old = readFileSync(join(place, 'node/Outils.js'))
    write(join(root, 'app/modularjs/Outils.class.mjs'), 'class Outils\n  un = -> 2\n')
    const elsewhere = build(root, ['--cache', ...out(join(root, 'ailleurs'))])
    const inPlace   = build(root, ['--cache'])
    const full      = build(root, out(join(root, 'complet')))
    for (const b of [elsewhere, inPlace, full]) assert.equal(b.status, 0, b.out)
    assert.ok(existsSync(join(root, 'complet/node/Outils.js')))
    assert.ok(!old.equals(readFileSync(join(root, 'complet/node/Outils.js'))), 'la classe changée doit changer node/Outils.js')
    const found = gaps(place, join(root, 'complet'))
    assert.deepEqual(found, [], `sur place (repris ${inPlace.served}, recompilés ${inPlace.cold}) :\n${found.join('\n')}`)
  })
})
