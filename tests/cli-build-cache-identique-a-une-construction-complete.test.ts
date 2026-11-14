// `mjs build --cache` sur un petit projet fabriqué ici : après chaque sorte de modification (composant, partiel, module importé,
// configuration neuve puis déjà vue, traduction, fichier ajouté, fichier supprimé, tour en erreur puis tour réparé), la construction
// avec le cache donne la même sortie à l'octet qu'une construction complète sans cache (registre `.mjs-outputs.json` compris), dans
// un dossier de sortie NEUF (l'essai d'une appli qui part d'un dossier vide) comme sur place, et ne recompile que ce qui a changé.
// Le dossier neuf n'est pas à la profondeur du dossier sur place : un fichier gardé qui dépendrait de son dossier de sortie s'y verrait.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const MJS    = fileURLToPath(new URL('../bin/mjs', import.meta.url))
const PNG    = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
// un script que Civet ne sait pas lire : la construction échoue
const BROKEN = '<script>\n  x := ((\n</script>\n'
const CONFIG = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs', i18n: { default: 'fr' } }

// dix composants, un partiel, un module importé par un seul composant, une traduction, une image citée par µasset
const SOURCES: Record<string, string | Buffer> = {
  'accueil.mjs':             '<h1 class="t">accueil</h1>\n<mjs-carte-a></mjs-carte-a>\n<mjs-carte-b></mjs-carte-b>\n<mjs-galerie></mjs-galerie>\n',
  'carte-a.mjs':             '@import marque \'outils.module.civet.mjs\'\n\n<p class="a">{marque}</p>\n<mjs-puce></mjs-puce>\n',
  'carte-b.mjs':             '<div class="b">\n  <@include entete>\n  <p>b</p>\n</div>\n',
  '_entete.mjs':             '<h2 class="entete">entête</h2>\n',
  'outils.module.civet.mjs': 'export marque := \'valeur du module\'\n',
  'puce.mjs':                '<i class="puce">puce</i>\n',
  'galerie.mjs':             '<img src="µasset(\'img/logo.png\')">\n<p>galerie</p>\n',
  'img/logo.png':            PNG,
  'traduit.mjs':             '<p class="tr">{µt(\'titre\')}</p>\n',
  'i18n/fr.yml':             'titre: Bonjour\n',
  'libre.mjs':               '<p class="l">libre</p>\n',
  'pied.mjs':                '<footer class="p">pied</footer>\n',
  'menu.mjs':                '<nav class="m"><mjs-bouton></mjs-bouton></nav>\n',
  'bouton.mjs':              '<button class="bt">ok</button>\n',
}

interface Build { status: number; out: string; cold: number; served: number; reason: string }

function build(root: string, args: string[]): Build {
  const run   = spawnSync(process.execPath, [MJS, 'build', '--root', root, ...args], { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' }, maxBuffer: 64 * 1024 * 1024 })
  const out   = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
  const used  = /cache : (\d+) fichiers? repris, (\d+) recompilés?/.exec(out)
  const skip  = /cache écarté — (.+) : construction complète \((\d+) fichiers? compilés?\)/.exec(out)
  return { status: run.status ?? -1, out, cold: Number(used?.[2] ?? skip?.[2] ?? -1), served: Number(used?.[1] ?? 0), reason: skip?.[1] ?? '' }
}

// chaque fichier d'un dossier, par chemin relatif, avec son contenu
function files(dir: string): Map<string, Buffer> {
  const all = new Map<string, Buffer>()
  if (!existsSync(dir)) return all
  for (const rel of (readdirSync(dir, { recursive: true }) as string[]).sort()) {
    const path = join(dir, rel)
    if (statSync(path).isFile()) all.set(rel, readFileSync(path))
  }
  return all
}

// écarts à l'octet entre la sortie avec le cache et la sortie sans
function gaps(withCache: string, without: string): string[] {
  const left  = files(withCache)
  const right = files(without)
  const found: string[] = []
  for (const [rel, data] of left) {
    if (!right.has(rel)) found.push(`seulement avec le cache : ${rel}`)
    else if (!data.equals(right.get(rel)!)) found.push(`différent : ${rel}`)
  }
  for (const rel of right.keys()) if (!left.has(rel)) found.push(`seulement sans le cache : ${rel}`)
  return found
}

const write = (path: string, data: string | Buffer): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
}

describe('mjs build --cache : sortie identique à une construction complète', function () {
  this.timeout(300_000)

  it('composant, partiel, module importé, configuration, traduction, ajout, suppression, erreur puis réparation : écart 0, dossier neuf et sur place', function () {
    const root    = mjsTmp('cache-disque')
    const src     = join(root, 'app/modularjs')
    const config  = join(root, 'mjs.config.json')
    const cache   = join(root, 'node_modules/.cache')
    const state   = join(root, 'etat')
    const publicD = join(root, 'public')
    for (const [rel, data] of Object.entries(SOURCES)) write(join(src, rel), data)
    write(config, `${JSON.stringify(CONFIG, null, 2)}\n`)
    mkdirSync(join(root, 'node_modules'))

    // tour initial, sur place : premier passage, tout se compile, le cache s'écrit
    const first = build(root, ['--cache'])
    assert.equal(first.status, 0, first.out)
    assert.equal(first.reason, 'premier passage', first.out)
    const all = first.cold
    assert.ok(all >= 11, `unités compilées au premier passage : ${all}\n${first.out}`)
    renameSync(publicD, state)

    const edit = (rel: string, change: (text: string) => string): void => writeFileSync(join(src, rel), change(readFileSync(join(src, rel), 'utf-8')))
    const steps: { label: string; change: () => void; cold: number; reason?: string; fails?: boolean }[] = [
      { label: 'composant', change: () => edit('pied.mjs', t => `${t}<i hidden>tour 1</i>\n`), cold: 1 },
      { label: 'partiel', change: () => edit('_entete.mjs', t => `${t}<i hidden>tour 2</i>\n`), cold: 1 },
      { label: 'module importé', change: () => edit('outils.module.civet.mjs', t => `${t}export tour := 3\n`), cold: 2 },
      { label: 'configuration neuve', change: () => write(config, `${JSON.stringify({ ...CONFIG, prune: true }, null, 2)}\n`), cold: all, reason: 'mjs.config.json a changé' },
      { label: 'configuration déjà vue', change: () => write(config, `${JSON.stringify(CONFIG, null, 2)}\n`), cold: 0 },
      { label: 'traduction', change: () => write(join(src, 'i18n/fr.yml'), 'titre: Bonjour à tous\n'), cold: 0 },
      { label: 'fichier ajouté', change: () => write(join(src, 'nouveau.mjs'), '<p class="n">nouveau</p>\n'), cold: 1 },
      { label: 'fichier supprimé', change: () => rmSync(join(src, 'libre.mjs')), cold: 0 },
      { label: 'tour en erreur', change: () => edit('carte-b.mjs', t => `${t}${BROKEN}`), cold: -1, fails: true },
      { label: 'tour réparé', change: () => edit('carte-b.mjs', t => t.replace(BROKEN, '')), cold: 0 },
    ]
    const report: string[] = []
    for (const [n, step] of steps.entries()) {
      const dir   = join(root, 'runs', String(n))
      const saved = join(dir, 'cache-avant')
      step.change()
      cpSync(cache, saved, { recursive: true })
      const fresh      = build(root, ['--cache', '--output', join(dir, 'neuf'), '--manifest', join(dir, 'neuf/bundle.js')])
      const freshFull  = build(root, ['--output', join(dir, 'complet'), '--manifest', join(dir, 'complet/bundle.js')])
      // sur place : le cache et le dossier de sortie d'avant ce tour, pour les deux constructions
      rmSync(cache, { recursive: true, force: true })
      cpSync(saved, cache, { recursive: true })
      cpSync(state, publicD, { recursive: true })
      const inPlace = build(root, ['--cache'])
      renameSync(publicD, join(dir, 'place'))
      cpSync(state, publicD, { recursive: true })
      const inPlaceFull = build(root, [])
      rmSync(state, { recursive: true, force: true })
      renameSync(publicD, state)
      report.push(`${step.label} : recompilés ${fresh.cold} (dossier neuf), ${inPlace.cold} (sur place)`)
      if (step.fails) {
        // un tour en erreur n'écrit pas le cache : ses fichiers restent ceux d'avant le tour
        for (const b of [fresh, freshFull, inPlace, inPlaceFull]) assert.notEqual(b.status, 0, `${step.label} : la construction devait échouer\n${b.out}`)
        const keys = [...files(saved).keys()].filter(rel => rel.endsWith('.json'))
        assert.ok(keys.length >= 2, `${step.label} : fichiers du cache d'avant le tour ${keys.join(', ')}`)
        for (const rel of keys) assert.ok(readFileSync(join(saved, rel)).equals(readFileSync(join(cache, rel))), `${step.label} : ${rel} réécrit par un tour en erreur`)
        continue
      }
      for (const b of [fresh, freshFull, inPlace, inPlaceFull]) assert.equal(b.status, 0, `${step.label}\n${b.out}`)
      assert.equal(fresh.cold, step.cold, `${step.label}, dossier neuf : unités recompilées\n${fresh.out}`)
      assert.equal(inPlace.cold, step.cold, `${step.label}, sur place : unités recompilées\n${inPlace.out}`)
      if (step.reason !== undefined) assert.equal(fresh.reason, step.reason, fresh.out)
      // les deux comparaisons portent sur une vraie sortie : composants, image publiée, registre
      for (const out of [join(dir, 'neuf'), join(dir, 'place/modularjs')]) {
        const names = [...files(out).keys()]
        assert.ok(names.length >= 12 && names.some(f => /^logo-\w+\.png$/.test(f)) && names.includes('.mjs-outputs.json'), `${step.label} : sortie incomplète dans ${out} : ${names.join(', ')}`)
        if (step.label === 'fichier supprimé') assert.ok(!names.some(f => f.startsWith('libre-')), `${step.label} : la sortie du fichier supprimé reste dans ${out}`)
      }
      assert.deepEqual(gaps(join(dir, 'neuf'), join(dir, 'complet')), [], `${step.label}, dossier neuf : écarts avec une construction complète`)
      assert.deepEqual(gaps(join(dir, 'place'), state), [], `${step.label}, sur place : écarts avec une construction complète`)
    }
    // eslint-disable-next-line no-console
    console.log(`      ${report.join('\n      ')}`)
  })
})
