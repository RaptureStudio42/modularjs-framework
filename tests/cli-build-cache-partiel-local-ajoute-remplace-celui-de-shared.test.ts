// `mjs build --cache` : `sous/fiche.mjs` inclut `entete` par son nom simple, pris dans `shared/_entete.mjs` ; un partiel local
// `sous/_entete.mjs` ajouté ensuite le remplace. La construction avec le cache le voit : la fiche se recompile, sa sortie porte
// l'entête proche, et toute la sortie est identique à l'octet à celle d'une construction complète, en développement et en production,
// dans un dossier de sortie NEUF comme sur place. Avant ce correctif, seul le partiel trouvé comptait dans les dépendances de la
// fiche : le cache la reprenait avec l'ancienne entête.

import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, gaps, write } from './helpers/construction-cache.js'

const CONFIG = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs' }

// l'entête que porte la fiche publiée dans un dossier de sortie
const header = (dir: string): string => readdirSync(dir).filter(f => /^fiche-.*\.js$/.test(f)).map(f => /ENTETE-[A-Z]+/.exec(readFileSync(join(dir, f), 'utf-8'))?.[0] ?? '').join(' | ')

describe('mjs build --cache : un partiel local ajouté remplace celui de shared/ du même nom', function () {
  this.timeout(300_000)

  for (const mode of [[], ['--prod']]) it(`${mode.length > 0 ? 'production' : 'développement'} : la fiche se recompile, écart 0 avec une construction complète, dossier neuf et sur place`, function () {
    const root    = mjsTmp('cache-partiel-proche')
    const src     = join(root, 'app/modularjs')
    const cache   = join(root, 'node_modules/.cache')
    const saved   = join(root, 'cache-avant')
    const state   = join(root, 'etat')
    const publicD = join(root, 'public')
    write(join(root, 'mjs.config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`)
    write(join(src, 'accueil.mjs'), '<mjs-fiche></mjs-fiche>\n')
    write(join(src, 'sous/fiche.mjs'), '<div>\n  <@include entete>\n</div>\n')
    write(join(src, 'shared/_entete.mjs'), '<h2>ENTETE-PARTAGEE</h2>\n')
    mkdirSync(join(root, 'node_modules'))

    // premier passage, sur place : tout se compile, le cache s'écrit
    const first = build(root, [...mode, '--cache'])
    assert.equal(first.status, 0, first.out)
    assert.equal(first.reason, 'premier passage', first.out)
    assert.equal(header(join(publicD, 'modularjs')), 'ENTETE-PARTAGEE')
    renameSync(publicD, state)

    write(join(src, 'sous/_entete.mjs'), '<h2>ENTETE-PROCHE</h2>\n')
    cpSync(cache, saved, { recursive: true })
    const fresh     = build(root, [...mode, '--cache', '--output', join(root, 'neuf'), '--manifest', join(root, 'neuf/bundle.js')])
    const freshFull = build(root, [...mode, '--output', join(root, 'complet'), '--manifest', join(root, 'complet/bundle.js')])
    // sur place : le cache et le dossier de sortie d'avant l'ajout, pour les deux constructions
    rmSync(cache, { recursive: true, force: true })
    cpSync(saved, cache, { recursive: true })
    cpSync(state, publicD, { recursive: true })
    const inPlace = build(root, [...mode, '--cache'])
    renameSync(publicD, join(root, 'place'))
    cpSync(state, publicD, { recursive: true })
    const inPlaceFull = build(root, mode)

    for (const b of [fresh, freshFull, inPlace, inPlaceFull]) assert.equal(b.status, 0, b.out)
    // tous les constats avant d'échouer, dossier neuf et sur place
    const found: string[] = []
    const check = (ok: boolean, label: string): void => { if (!ok) found.push(label) }
    check(fresh.cold === 1, `dossier neuf : ${fresh.cold} unités recompilées, 1 attendue`)
    check(header(join(root, 'neuf')) === 'ENTETE-PROCHE', `dossier neuf : la fiche servie porte ${header(join(root, 'neuf'))}`)
    check(header(join(root, 'place/modularjs')) === 'ENTETE-PROCHE', `sur place : la fiche servie porte ${header(join(root, 'place/modularjs'))}`)
    for (const gap of gaps(join(root, 'neuf'), join(root, 'complet'))) found.push(`dossier neuf, écart avec une construction complète : ${gap}`)
    for (const gap of gaps(join(root, 'place'), publicD)) found.push(`sur place, écart avec une construction complète : ${gap}`)
    assert.deepEqual(found, [], `${fresh.out}\n${inPlace.out}`)
  })
})
