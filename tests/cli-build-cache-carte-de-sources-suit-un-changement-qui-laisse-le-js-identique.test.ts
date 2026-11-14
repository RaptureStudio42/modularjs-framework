// `mjs build --cache` : une ligne vide, un commentaire ou des espaces ajoutés à un composant laissent son `.js` identique (même nom) mais
// changent sa carte de sources (`.map`, qui porte le texte du composant). Un dossier de sortie neuf servi par le cache, et le dossier sur
// place quand le cache vient d'une construction faite ailleurs entre-temps, reçoivent la carte d'une construction complète, jamais
// l'ancienne ; même contrôle après un partiel et un module changés

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, files, gaps, write } from './helpers/construction-cache.js'

const CONFIG  = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs' }
const SOURCES: Record<string, string> = {
  'app/modularjs/accueil.mjs':            '<h1 class="t">accueil</h1>\n<mjs-pied></mjs-pied>\n<mjs-aide></mjs-aide>\n',
  'app/modularjs/pied.mjs':               '<script>\n$x = 1\n</script>\n<footer class="p">pied {$x}</footer>\n',
  'app/modularjs/aide.mjs':               '@import marque \'outil.module.civet.mjs\'\n\n<script>\n$vu = marque\n</script>\n<p class="aide">{$vu}</p>\n<@include note>\n',
  'app/modularjs/_note.mjs':              '<small class="note">note</small>\n',
  'app/modularjs/outil.module.civet.mjs': 'export marque := \'banc\'\n',
}

const out  = (dir: string): string[] => ['--output', dir, '--manifest', join(dir, 'bundle.js')]
const maps = (dir: string): Map<string, Buffer> => new Map([...files(dir)].filter(([rel]) => rel.endsWith('.map')))

describe('mjs build --cache : la carte de sources suit un changement qui laisse le .js identique', function () {
  this.timeout(300_000)

  it('composant, partiel, module : dossier neuf et sur place reçoivent la carte de la construction complète', function () {
    const root = mjsTmp('cache-carte')
    for (const [rel, data] of Object.entries(SOURCES)) write(join(root, rel), data)
    write(join(root, 'mjs.config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`)
    mkdirSync(join(root, 'node_modules'))
    const place = join(root, 'public/modularjs')
    const first = build(root, ['--cache'])
    assert.equal(first.status, 0, first.out)
    const steps = [
      { label: 'ligne vide en fin de composant', file: 'app/modularjs/pied.mjs', change: (t: string): string => `${t}\n` },
      { label: 'commentaire HTML en tête de composant', file: 'app/modularjs/pied.mjs', change: (t: string): string => `<!-- note -->\n${t}` },
      { label: 'espaces dans le script d\'un composant', file: 'app/modularjs/pied.mjs', change: (t: string): string => t.replace('$x = 1', '$x = 1   ') },
      // une carte ne porte que le texte de son composant, et un commentaire de module change son .js : ici, contrôle de la sortie seul
      { label: 'ligne vide en tête de partiel', file: 'app/modularjs/_note.mjs', change: (t: string): string => `\n${t}` },
      { label: 'commentaire en tête de module', file: 'app/modularjs/outil.module.civet.mjs', change: (t: string): string => `// note\n${t}` },
    ]
    const report: string[] = []
    let bad       = 0
    let exercised = 0
    for (const [n, step] of steps.entries()) {
      const dir    = join(root, 'runs', String(n))
      const before = maps(place)
      write(join(root, step.file), step.change(readFileSync(join(root, step.file), 'utf-8')))
      // le cache est écrit ailleurs, puis sert un dossier neuf, puis le dossier sur place, resté à l'état d'avant le changement
      const elsewhere = build(root, ['--cache', ...out(join(dir, 'ailleurs'))])
      const fresh     = build(root, ['--cache', ...out(join(dir, 'neuf'))])
      const inPlace   = build(root, ['--cache'])
      const full      = build(root, out(join(dir, 'complet')))
      for (const b of [elsewhere, fresh, inPlace, full]) assert.equal(b.status, 0, b.out)
      // le cas visé : une carte changée sous le même nom (son .js n'a pas changé)
      const after   = maps(join(dir, 'complet'))
      const changed = [...after].filter(([rel, data]) => before.has(rel) && !before.get(rel)!.equals(data)).map(([rel]) => rel)
      if (changed.length > 0) exercised++
      const gFresh = gaps(join(dir, 'neuf'), join(dir, 'complet'))
      const gPlace = gaps(place, join(dir, 'complet'))
      if (gFresh.length + gPlace.length > 0) bad++
      report.push(`${step.label} (cartes changées sous le même nom : ${changed.join(', ') || 'aucune'}) : neuf, repris ${fresh.served}, écarts ${gFresh.length}${gFresh.map(g => ` [${g}]`).join('')} ; sur place, repris ${inPlace.served}, écarts ${gPlace.length}${gPlace.map(g => ` [${g}]`).join('')}`)
    }
    assert.equal(bad, 0, report.join('\n'))
    assert.ok(exercised >= 2, `cas visé trop rare :\n${report.join('\n')}`)
  })
})
