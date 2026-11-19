// `mjs build --prod --cache` sur un projet qui emploie des modules du cœur (`<@@checkbox>`, `<@@switch>`, puis `<@@radio>`) : une
// modification qui change le cœur bâti (un fichier ajouté qui demande un morceau neuf, puis retiré) fait recompiler les unités
// gardées, modules du cœur compris ; la sortie reste identique à l'octet à celle de `mjs build --prod` sans cache, `core-*` compris,
// en dossier neuf comme sur place, et de même pour une construction de développement. Un module du cœur recompilé ainsi prenait le
// nom court de son fichier (`checkbox.mjs` → `<mjs-checkbox>`) et l'appel qui enregistre cet alias (`µ._al`), qu'une construction
// complète ne lui donne jamais ; le cœur bâti prenait alors la brique des alias, et chaque fichier changeait de nom. `--prod
// --cache=verify` sur la même modification : égale, une ligne le dit.

import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, files, gaps, write } from './helpers/construction-cache.js'

const CONFIG  = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs', i18n: { default: 'fr' } }
const CHECKED = /^cache vérifié : (\d+) fichiers identiques à l'octet$/m

const SOURCES: Record<string, string> = {
  'accueil.mjs':  '<script lang="js">\n  $n = 0;\n  @inc = function() { $n++; };\n</script>\n\n<div class="accueil">\n  <button @click={@inc()}>{$n}</button>\n  <@@checkbox></@@checkbox>\n  <mjs-reglages></mjs-reglages>\n</div>\n',
  'reglages.mjs': '<script lang="js">\n  $items = [{ id: 1, t: \'a\' }];\n</script>\n\n<section class="reglages">\n  {for it in $items by id}\n    <i>{it.t}</i>\n  {end}\n  <@@switch></@@switch>\n</section>\n',
  'pied.mjs':     '<p class="pied">pied</p>\n',
}

// un composant qui demande au cœur un morceau que les autres n'emploient pas : l'ajouter, puis le retirer, change le cœur bâti
const ATTENTE = '<script lang="js">\n  $n = 0;\n</script>\n\n<div class="attente">\n  {await $n}\n    <i>…</i>\n  {success valeur}\n    <i>{valeur}</i>\n  {error err}\n    <i>{err.message}</i>\n  {end}\n</div>\n'

function project(prefix: string): string {
  const root = mjsTmp(prefix)
  for (const [rel, data] of Object.entries(SOURCES)) write(join(root, 'app/modularjs', rel), data)
  write(join(root, 'mjs.config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`)
  mkdirSync(join(root, 'node_modules'))
  return root
}

// les modules du cœur d'une sortie, et ceux qui enregistrent un alias court
function coreModules(dir: string): { names: string[]; aliased: string[] } {
  const names = [...files(dir).entries()].filter(([rel]) => /^core-[\w-]+\.js$/.test(rel))
  return { names: names.map(([rel]) => rel), aliased: names.filter(([, data]) => data.includes('._al(')).map(([rel]) => rel) }
}

describe('mjs build --prod --cache : un module du cœur recompilé est identique à celui d\'une construction complète', function () {
  this.timeout(300_000)

  it('fichier ajouté puis retiré qui change le cœur, module du cœur ajouté : écart 0 avec --prod sans cache, core-* compris, dossier neuf et sur place', function () {
    const rootF   = project('cache-coeur-neuf')
    const rootP   = project('cache-coeur-place')
    const state   = join(rootP, 'etat')
    const publicD = join(rootP, 'public')
    for (const b of [build(rootF, ['--prod', '--cache', '--output', join(rootF, 'runs/init'), '--manifest', join(rootF, 'runs/init/bundle.js')]), build(rootP, ['--prod', '--cache'])]) {
      assert.equal(b.status, 0, b.out)
    }
    renameSync(publicD, state)

    const edit = (rel: string, change: (text: string) => string): void => {
      for (const root of [rootF, rootP]) writeFileSync(join(root, 'app/modularjs', rel), change(readFileSync(join(root, 'app/modularjs', rel), 'utf-8')))
    }
    const steps: { label: string; change: () => void; coreChanged: boolean }[] = [
      { label: 'composant', change: () => edit('pied.mjs', t => t.replace('>pied<', '>pied, tour 1<')), coreChanged: false },
      { label: 'fichier ajouté qui change le cœur', change: () => { for (const root of [rootF, rootP]) write(join(root, 'app/modularjs/attente.mjs'), ATTENTE) }, coreChanged: true },
      { label: 'module du cœur ajouté', change: () => edit('pied.mjs', t => `${t}<@@radio></@@radio>\n`), coreChanged: false },
      { label: 'fichier retiré qui change le cœur', change: () => { for (const root of [rootF, rootP]) rmSync(join(root, 'app/modularjs/attente.mjs')) }, coreChanged: true },
    ]
    const report: string[] = []
    const found: string[]  = []
    for (const [n, step] of steps.entries()) {
      const dirF = join(rootF, 'runs', String(n))
      const dirP = join(rootP, 'runs', String(n))
      step.change()
      const fresh     = build(rootF, ['--prod', '--cache', '--output', join(dirF, 'neuf'), '--manifest', join(dirF, 'neuf/bundle.js')])
      const freshFull = build(rootF, ['--prod', '--output', join(dirF, 'complet'), '--manifest', join(dirF, 'complet/bundle.js')])
      // sur place : le dossier de sortie d'avant ce tour (son `.mangle-cache.json` compris), pour les deux constructions
      cpSync(state, publicD, { recursive: true })
      const inPlace = build(rootP, ['--prod', '--cache'])
      mkdirSync(dirP, { recursive: true })
      renameSync(publicD, join(dirP, 'place'))
      cpSync(state, publicD, { recursive: true })
      const inPlaceFull = build(rootP, ['--prod'])
      rmSync(state, { recursive: true, force: true })
      renameSync(publicD, state)
      for (const b of [fresh, freshFull, inPlace, inPlaceFull]) assert.equal(b.status, 0, `${step.label}\n${b.out}`)
      const cores = coreModules(join(dirF, 'complet'))
      report.push(`${step.label} : repris ${fresh.served}, recompilés ${fresh.cold} (dossier neuf) ; repris ${inPlace.served}, recompilés ${inPlace.cold} (sur place) ; modules du cœur ${cores.names.join(', ')}`)
      assert.ok(cores.names.length >= 2, `${step.label} : modules du cœur bâtis\n${freshFull.out}`)
      // le cœur changé : chaque unité gardée est recompilée, modules du cœur compris (sinon ce tour ne prouverait rien)
      if (step.coreChanged) assert.ok(fresh.cold >= cores.names.length && inPlace.cold >= cores.names.length, `${step.label} : unités recompilées\n${fresh.out}\n${inPlace.out}`)
      for (const [mode, out] of [['dossier neuf', join(dirF, 'neuf')], ['sur place', join(dirP, 'place/modularjs')]]) {
        for (const rel of coreModules(out).aliased) found.push(`${step.label}, ${mode} : alias court enregistré par ${rel}`)
      }
      for (const gap of gaps(join(dirF, 'neuf'), join(dirF, 'complet'))) found.push(`${step.label}, dossier neuf : ${gap}`)
      for (const gap of gaps(join(dirP, 'place'), state)) found.push(`${step.label}, sur place : ${gap}`)
    }
    // eslint-disable-next-line no-console
    console.log(`      ${report.join('\n      ')}`)
    assert.deepEqual(found, [], 'écarts avec --prod sans cache')
  })

  it('construction de développement : fichier ajouté qui change le cœur, écart 0 avec une construction complète, core-* compris', function () {
    const root = project('cache-coeur-dev')
    const init = build(root, ['--cache', '--output', join(root, 'runs/init'), '--manifest', join(root, 'runs/init/bundle.js')])
    assert.equal(init.status, 0, init.out)
    write(join(root, 'app/modularjs/attente.mjs'), ATTENTE)
    const warm = build(root, ['--cache', '--output', join(root, 'runs/chaud'), '--manifest', join(root, 'runs/chaud/bundle.js')])
    const full = build(root, ['--output', join(root, 'runs/complet'), '--manifest', join(root, 'runs/complet/bundle.js')])
    for (const b of [warm, full]) assert.equal(b.status, 0, b.out)
    assert.ok(warm.cold >= coreModules(join(root, 'runs/complet')).names.length, `unités recompilées\n${warm.out}`)
    const aliased = coreModules(join(root, 'runs/chaud')).aliased.map(rel => `alias court enregistré par ${rel}`)
    assert.deepEqual([...aliased, ...gaps(join(root, 'runs/chaud'), join(root, 'runs/complet'))], [], 'écarts avec une construction complète')
  })

  it('--prod --cache=verify : un fichier ajouté qui change le cœur, la construction servie par le cache est égale, une ligne le dit', function () {
    const root = project('cache-coeur-verifier')
    const init = build(root, ['--prod', '--cache=verify'])
    assert.equal(init.status, 0, init.out)
    write(join(root, 'app/modularjs/attente.mjs'), ATTENTE)
    const again = build(root, ['--prod', '--cache=verify'])
    assert.equal(again.status, 0, again.out)
    assert.ok(CHECKED.test(again.out), again.out)
    assert.deepEqual(coreModules(join(root, 'public/modularjs')).aliased, [], 'aucun module du cœur n\'enregistre d\'alias court')
  })
})
