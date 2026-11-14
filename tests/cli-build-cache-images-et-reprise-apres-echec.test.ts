// `mjs build --cache`, ce que les empreintes de contenu ne suivent pas seules. (1) Images : une image changée ou ajoutée dans le dossier
// d'un motif `µasset`, une image changée dans un autre dossier d'images (`assetDirs`), un jumeau ajouté sous `sourceDir` qui passe
// devant, une image retirée du motif : la sortie suit, identique à l'octet à une construction complète, dossier neuf comme sur place.
// (2) Un tour EN ÉCHEC sous le cache laisse une sortie partielle ; la construction réussie suivante, sur place, rend la même sortie
// qu'une construction complète partie du même dossier.

import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { PNG, build, files, gaps, write } from './helpers/construction-cache.js'

const CONFIG  = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs', assetDirs: ['app/assets/images'] }
const variant = (mark: string): Buffer => Buffer.concat([PNG, Buffer.from(mark)])
// un script que Civet ne sait pas lire : la construction échoue
const BROKEN  = '<script>\n  x := ((\n</script>\n'
const SOURCES: Record<string, string | Buffer> = {
  'app/modularjs/accueil.mjs':       '<h1 class="t">accueil</h1>\n<mjs-jeu></mjs-jeu>\n<mjs-photo></mjs-photo>\n<mjs-pied></mjs-pied>\n',
  'app/modularjs/jeu.mjs':           '<script>\n$n = 1\n</script>\n<img src={µasset "motifs/case-#{$n}.png"} alt="case">\n',
  'app/modularjs/motifs/case-1.png': PNG,
  'app/modularjs/motifs/case-2.png': variant('2'),
  'app/modularjs/photo.mjs':         '<img src="µasset(\'photo.png\')" alt="photo">\n',
  'app/assets/images/photo.png':     variant('dossier d images'),
  'app/modularjs/pied.mjs':          '<footer class="p">pied</footer>\n',
  'app/modularjs/libre.mjs':         '<p class="l">libre</p>\n',
}

function project(prefix: string): string {
  const root = mjsTmp(prefix)
  for (const [rel, data] of Object.entries(SOURCES)) write(join(root, rel), data)
  write(join(root, 'mjs.config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`)
  mkdirSync(join(root, 'node_modules'))
  return root
}

describe('mjs build --cache : images suivies, reprise après un tour en échec', function () {
  this.timeout(300_000)

  it('motif µasset et autre dossier d\'images : une image changée, ajoutée, doublée ou retirée, la sortie suit, écart 0', function () {
    const root    = project('cache-images')
    const cache   = join(root, 'node_modules/.cache')
    const state   = join(root, 'etat')
    const publicD = join(root, 'public')
    const first   = build(root, ['--cache'])
    assert.equal(first.status, 0, first.out)
    renameSync(publicD, state)
    const steps: { label: string; change: () => void }[] = [
      { label: 'image du motif changée', change: () => write(join(root, 'app/modularjs/motifs/case-2.png'), variant('2 bis')) },
      { label: 'image ajoutée au motif', change: () => write(join(root, 'app/modularjs/motifs/case-3.png'), variant('3')) },
      { label: 'image changée dans un autre dossier d\'images', change: () => write(join(root, 'app/assets/images/photo.png'), variant('dossier d images, bis')) },
      { label: 'jumeau ajouté sous sourceDir', change: () => write(join(root, 'app/modularjs/photo.png'), variant('jumeau')) },
      { label: 'image retirée du motif', change: () => rmSync(join(root, 'app/modularjs/motifs/case-3.png')) },
    ]
    const report: string[] = []
    for (const [n, step] of steps.entries()) {
      const dir   = join(root, 'runs', String(n))
      const saved = join(dir, 'cache-avant')
      step.change()
      cpSync(cache, saved, { recursive: true })
      const fresh     = build(root, ['--cache', '--output', join(dir, 'neuf'), '--manifest', join(dir, 'neuf/bundle.js')])
      const freshFull = build(root, ['--output', join(dir, 'complet'), '--manifest', join(dir, 'complet/bundle.js')])
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
      report.push(`${step.label} : recompilés ${fresh.cold} (dossier neuf), ${inPlace.cold} (sur place)`)
      assert.ok(fresh.served > 0 && inPlace.served > 0, `${step.label} : le cache doit servir\n${fresh.out}`)
      assert.deepEqual(gaps(join(dir, 'neuf'), join(dir, 'complet')), [], `${step.label}, dossier neuf : écarts avec une construction complète`)
      assert.deepEqual(gaps(join(dir, 'place'), state), [], `${step.label}, sur place : écarts avec une construction complète`)
    }
    // eslint-disable-next-line no-console
    console.log(`      ${report.join('\n      ')}`)
  })

  it('tour en échec sous le cache, puis tour réparé sur place : même sortie qu\'une construction complète partie du même dossier', function () {
    const root    = project('cache-reprise')
    const cache   = join(root, 'node_modules/.cache')
    const saved   = join(root, 'cache-avant')
    const publicD = join(root, 'public')
    const pied    = join(root, 'app/modularjs/pied.mjs')
    const clean   = readFileSync(pied, 'utf-8')
    assert.equal(build(root, ['--cache']).status, 0)
    const start = join(root, 'depart')
    cpSync(publicD, start, { recursive: true })
    cpSync(cache, saved, { recursive: true })
    // le cache d'avant le tour en échec, et le dossier de sortie de départ, pour chaque construction
    const reset = (): void => {
      rmSync(cache, { recursive: true, force: true })
      cpSync(saved, cache, { recursive: true })
      rmSync(publicD, { recursive: true, force: true })
      cpSync(start, publicD, { recursive: true })
    }
    writeFileSync(pied, `${clean}${BROKEN}`)
    const failed: Record<string, string> = {}
    for (const [label, args] of [['cache, sur place', ['--cache']], ['complète, sur place', []]] as const) {
      reset()
      const run = build(root, [...args])
      assert.notEqual(run.status, 0, `${label} : la construction devait échouer\n${run.out}`)
      failed[label] = join(root, `partielle ${label}`)
      renameSync(publicD, failed[label])
    }
    for (const [label, args] of [['cache, dossier neuf', ['--cache']], ['complète, dossier neuf', []]] as const) {
      reset()
      const out = join(root, `partielle ${label}`)
      const run = build(root, [...args, '--output', out, '--manifest', join(out, 'bundle.js')])
      assert.notEqual(run.status, 0, `${label} : la construction devait échouer\n${run.out}`)
      failed[label] = out
    }
    const report = Object.entries(failed).map(([label, dir]) => `sortie partielle (${label}) : ${files(dir).size} fichiers`)
    for (const [a, b] of [['cache, sur place', 'complète, sur place'], ['cache, dossier neuf', 'complète, dossier neuf']]) report.push(`écarts ${a} / ${b} : ${gaps(failed[a], failed[b]).slice(0, 6).join(' ; ') || 'aucun'}`)

    // tour réparé, sur place, depuis la sortie partielle laissée par le tour en échec sous le cache
    writeFileSync(pied, clean)
    const repaired: string[] = []
    for (const args of [['--cache'], []]) {
      rmSync(cache, { recursive: true, force: true })
      cpSync(saved, cache, { recursive: true })
      rmSync(publicD, { recursive: true, force: true })
      cpSync(failed['cache, sur place'], publicD, { recursive: true })
      const run = build(root, args)
      assert.equal(run.status, 0, run.out)
      if (args.length > 0) report.push(`tour réparé sous le cache : ${run.cold} recompilés, ${run.served} repris`)
      const out = join(root, `reparee ${repaired.length}`)
      renameSync(publicD, out)
      repaired.push(out)
    }
    const fresh = join(root, 'complete-neuve')
    assert.equal(build(root, ['--output', fresh, '--manifest', join(fresh, 'bundle.js')]).status, 0)
    report.push(`tour réparé sous le cache / construction complète en dossier neuf : ${gaps(join(repaired[0], 'modularjs'), fresh).slice(0, 6).join(' ; ') || 'aucun écart'}`)
    // eslint-disable-next-line no-console
    console.log(`      ${report.join('\n      ')}`)
    assert.deepEqual(gaps(repaired[0], repaired[1]), [], 'tour réparé sous le cache, sur place : écarts avec une construction complète partie du même dossier')
  })
})
