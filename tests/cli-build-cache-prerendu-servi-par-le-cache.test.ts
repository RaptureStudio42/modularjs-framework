// `mjs build --cache` sur un projet qui prérend ses pages (`render.routes`) : la construction servie par le cache ne recompile que ce
// qui a changé, le prérendu rend sur elle sans recompiler le projet (aucune ligne de cache à lui), et la sortie (pages prérendues
// comprises) reste identique à l'octet à une construction complète, dans un dossier de sortie neuf comme sur place.

import assert from 'node:assert/strict'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, gaps, write } from './helpers/construction-cache.js'

const CONFIG = {
  sourceDir:    'app/modularjs',
  outputDir:    'public/modularjs',
  manifestPath: 'public/modularjs/bundle.js',
  urlPrefix:    '/modularjs',
  render:       { routes: { '/': { component: 'mjs-accueil' } }, engine: { prerender: 'happy-dom' } },
}
const SOURCES: Record<string, string> = {
  'accueil.mjs': '<h1 class="t">accueil</h1>\n<mjs-carte></mjs-carte>\n<mjs-pied></mjs-pied>\n',
  'carte.mjs':   '<div class="c">\n  <@include entete>\n  <p>carte</p>\n</div>\n',
  '_entete.mjs': '<h2 class="e">entête</h2>\n',
  'pied.mjs':    '<footer class="p">pied</footer>\n',
  'libre.mjs':   '<p class="l">libre</p>\n',
}

describe('mjs build --cache : le prérendu rend sur la construction servie par le cache', function () {
  this.timeout(300_000)

  it('composant changé, puis rien de changé : la construction ne recompile que ce qui a changé, le prérendu rien, écart 0 pages comprises', function () {
    const root    = mjsTmp('cache-prerendu')
    const cache   = join(root, 'node_modules/.cache')
    const state   = join(root, 'etat')
    const publicD = join(root, 'public')
    for (const [rel, data] of Object.entries(SOURCES)) write(join(root, 'app/modularjs', rel), data)
    write(join(root, 'mjs.config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`)
    mkdirSync(join(root, 'node_modules'))

    const first = build(root, ['--cache'])
    assert.equal(first.status, 0, first.out)
    assert.equal(first.reason, 'premier passage', first.out)
    assert.equal(first.prerender, null, `le prérendu ne compile pas, aucune ligne de cache à lui :\n${first.out}`)
    assert.ok(existsSync(join(publicD, 'mjs_pages/index.html')), first.out)
    const report = [`premier passage : construction ${first.cold} compilés, prérendu sans compilation`]
    renameSync(publicD, state)

    const steps: { label: string; change: () => void; cold: number }[] = [
      { label: 'composant', change: () => appendFileSync(join(root, 'app/modularjs/carte.mjs'), '<i hidden>tour 1</i>\n'), cold: 1 },
      { label: 'rien de changé', change: () => {}, cold: 0 },
    ]
    for (const [n, step] of steps.entries()) {
      const dir   = join(root, 'runs', String(n))
      const saved = join(dir, 'cache-avant')
      step.change()
      cpSync(cache, saved, { recursive: true })
      // les pages prérendues vont à côté du dossier de sortie (`mjs_pages`), dans le dossier neuf comme sur place
      const fresh     = build(root, ['--cache', '--output', join(dir, 'neuf/modularjs'), '--manifest', join(dir, 'neuf/modularjs/bundle.js')])
      const freshFull = build(root, ['--output', join(dir, 'complet/modularjs'), '--manifest', join(dir, 'complet/modularjs/bundle.js')])
      rmSync(cache, { recursive: true, force: true })
      cpSync(saved, cache, { recursive: true })
      cpSync(state, publicD, { recursive: true })
      const inPlace = build(root, ['--cache'])
      renameSync(publicD, join(dir, 'place'))
      cpSync(state, publicD, { recursive: true })
      const inPlaceFull = build(root, [])
      rmSync(state, { recursive: true, force: true })
      renameSync(publicD, state)
      for (const b of [fresh, freshFull, inPlace, inPlaceFull]) assert.equal(b.status, 0, `${step.label}\n${b.out}`)
      report.push(`${step.label} : construction ${fresh.cold} / ${inPlace.cold} recompilés, prérendu sans compilation (dossier neuf / sur place)`)
      for (const b of [fresh, inPlace]) {
        assert.equal(b.cold, step.cold, `${step.label} : unités recompilées par la construction\n${b.out}`)
        assert.equal(b.prerender, null, `${step.label} : le prérendu ne recompile rien\n${b.out}`)
      }
      // la comparaison porte sur de vraies pages prérendues
      for (const page of [join(dir, 'neuf/mjs_pages/index.html'), join(dir, 'place/mjs_pages/index.html')]) assert.match(readFileSync(page, 'utf-8'), /carte/, page)
      assert.deepEqual(gaps(join(dir, 'neuf'), join(dir, 'complet')), [], `${step.label}, dossier neuf : écarts avec une construction complète`)
      assert.deepEqual(gaps(join(dir, 'place'), state), [], `${step.label}, sur place : écarts avec une construction complète`)
    }
    // eslint-disable-next-line no-console
    console.log(`      ${report.join('\n      ')}`)
  })
})
