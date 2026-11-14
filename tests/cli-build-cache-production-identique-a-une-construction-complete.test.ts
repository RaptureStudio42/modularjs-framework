// `mjs build --prod --cache` sur un projet fabriqué ici (seize composants dont chacun porte ses propres noms internes) : après chaque
// sorte de modification (composant, premier composant dans l'ordre des noms, partiel, module importé, magasin, configuration,
// traduction, fichier ajouté, fichier ajouté qui porte des noms neufs, fichier supprimé), la sortie est identique à l'octet à celle de
// `mjs build --prod` sans cache (`.mangle-cache.json` et registre compris), et le cache sert : les noms courts d'un fichier repris sont
// ceux qu'une construction complète lui donnerait. Deux suites : l'une part toujours d'un dossier de sortie NEUF (sans
// `.mangle-cache.json`, l'essai d'une appli qui construit dans un dossier vide), l'autre construit toujours sur place (avec celui de la
// construction d'avant) ; puis une construction en dossier neuf sur un cache écrit sur place, juste elle aussi. `--prod
// --cache=verifier` : égale sur place, une ligne le dit ; un fichier du cache faussé à la main est vu, et la sortie reçoit les fichiers
// de la construction complète (code 1).

import assert from 'node:assert/strict'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { PNG, build, files, gaps, write } from './helpers/construction-cache.js'

const CONFIG = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs', i18n: { default: 'fr' } }
const CHECKED = /^cache vérifié : (\d+) fichiers identiques à l'octet$/m

// un composant qui porte un état, une liste à clé, une condition, un gestionnaire : chacun ses noms internes
const vivant = (nom: string, extra = ''): string => `<script lang="js">\n  $n = 0;\n  $items = [{ id: 1, t: '${nom}' }];\n  @inc = function() { $n++; };\n</script>\n\n<div class="${nom}">\n  <button @click={@inc()}>{$n}</button>\n  {for it in $items by id}\n    <i>{it.t}</i>\n  {end}\n  {if $n > 2}\n    <b>${nom}</b>\n  {end}\n  ${extra}\n</div>\n`

const SOURCES: Record<string, string | Buffer> = {
  'accueil.mjs':             vivant('accueil', '<mjs-carte-a></mjs-carte-a>\n  <mjs-carte-b></mjs-carte-b>\n  <mjs-galerie></mjs-galerie>'),
  'carte-a.mjs':             '@import marque \'outils.module.civet.mjs\'\n\n<p class="a">{marque}</p>\n<mjs-puce></mjs-puce>\n',
  'carte-b.mjs':             '<div class="b">\n  <@include entete>\n  <p>b</p>\n</div>\n',
  '_entete.mjs':             '<h2 class="entete">entête</h2>\n',
  'outils.module.civet.mjs': 'export marque := \'valeur du module\'\n',
  'panier.module.civet.mjs': 'export panier := new µStore(total: 1)\n',
  'caisse.mjs':              '@import µ$$panier \'panier.module.civet.mjs\'\n\n<p class="caisse">{µ$$panier.total}</p>\n',
  'puce.mjs':                vivant('puce'),
  'galerie.mjs':             '<img src="µasset(\'img/logo.png\')">\n<p>galerie</p>\n',
  'img/logo.png':            PNG,
  'traduit.mjs':             '<p class="tr">{µt(\'titre\')}</p>\n',
  'i18n/fr.yml':             'titre: Bonjour\n',
  'libre.mjs':               vivant('libre'),
  'pied.mjs':                vivant('pied'),
  'menu.mjs':                '<nav class="m"><mjs-bouton></mjs-bouton></nav>\n',
  'bouton.mjs':              vivant('bouton'),
  'zone.mjs':                vivant('zone'),
  'liste.mjs':               vivant('liste'),
  'compteur.mjs':            '<script lang="js">\n  $c = 1;\n</script>\n\n<p class="cpt" :class{$c > 1}="haut">{$c}</p>\n',
}

function project(prefix: string): string {
  const root = mjsTmp(prefix)
  for (const [rel, data] of Object.entries(SOURCES)) write(join(root, 'app/modularjs', rel), data)
  write(join(root, 'mjs.config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`)
  mkdirSync(join(root, 'node_modules'))
  return root
}

describe('mjs build --prod --cache : sortie identique à une construction complète', function () {
  this.timeout(300_000)

  it('dix sortes de modifications : écart 0 avec --prod sans cache, dossier neuf et sur place, et le cache sert', function () {
    // une suite en dossier neuf (rootF), une suite sur place (rootP), mêmes sources, mêmes modifications
    const rootF   = project('cache-prod-neuf')
    const rootP   = project('cache-prod-place')
    const state   = join(rootP, 'etat')
    const publicD = join(rootP, 'public')
    const firstF  = build(rootF, ['--prod', '--cache', '--output', join(rootF, 'runs/init'), '--manifest', join(rootF, 'runs/init/bundle.js')])
    const firstP  = build(rootP, ['--prod', '--cache'])
    for (const b of [firstF, firstP]) {
      assert.equal(b.status, 0, b.out)
      assert.equal(b.reason, 'premier passage', b.out)
    }
    assert.ok(existsSync(join(publicD, 'modularjs/.mangle-cache.json')), firstP.out)
    renameSync(publicD, state)

    const edit = (rel: string, change: (text: string) => string): void => {
      for (const root of [rootF, rootP]) writeFileSync(join(root, 'app/modularjs', rel), change(readFileSync(join(root, 'app/modularjs', rel), 'utf-8')))
    }
    const put = (rel: string, data: string): void => {
      for (const root of [rootF, rootP]) write(join(root, rel), data)
    }
    const steps: { label: string; change: () => void; served: boolean }[] = [
      { label: 'composant', change: () => edit('pied.mjs', t => t.replace("t: 'pied'", "t: 'pied, tour 1'")), served: true },
      { label: 'premier composant', change: () => edit('accueil.mjs', t => t.replace('<b>accueil</b>', '<b>accueil {$n}</b>')), served: false },
      { label: 'partiel', change: () => edit('_entete.mjs', t => t.replace('entête', 'entête, tour 3')), served: true },
      { label: 'module importé', change: () => edit('outils.module.civet.mjs', t => `${t}export tour := 4\n`), served: true },
      { label: 'magasin', change: () => edit('panier.module.civet.mjs', t => t.replace('total: 1', 'total: 2')), served: true },
      { label: 'configuration', change: () => put('mjs.config.json', `${JSON.stringify({ ...CONFIG, prune: true }, null, 2)}\n`), served: false },
      { label: 'traduction', change: () => put('app/modularjs/i18n/fr.yml', 'titre: Bonjour à tous\n'), served: true },
      { label: 'fichier ajouté', change: () => put('app/modularjs/nouveau.mjs', vivant('nouveau')), served: true },
      { label: 'fichier ajouté qui porte des noms neufs', change: () => put('app/modularjs/attente.mjs', vivant('attente', '{await $n}\n    <i>…</i>\n  {success valeur}\n    <i>{valeur}</i>\n  {error err}\n    <i>{err.message}</i>\n  {end}')), served: false },
      { label: 'fichier supprimé', change: () => { for (const root of [rootF, rootP]) rmSync(join(root, 'app/modularjs/libre.mjs')) }, served: true },
    ]
    const report: string[] = []
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
      report.push(`${step.label} : repris ${fresh.served}, recompilés ${fresh.cold} (dossier neuf) ; repris ${inPlace.served}, recompilés ${inPlace.cold} (sur place)`)
      for (const b of [fresh, freshFull, inPlace, inPlaceFull]) assert.equal(b.status, 0, `${step.label}\n${b.out}`)
      for (const b of [fresh, inPlace]) assert.ok(b.cold >= 0 && !/production/.test(b.reason), `${step.label} : ligne de bilan\n${b.out}`)
      for (const out of [join(dirF, 'neuf'), join(dirP, 'place/modularjs')]) {
        const names = [...files(out).keys()]
        assert.ok(names.includes('.mangle-cache.json') && names.includes('.mjs-outputs.json') && names.some(f => /^logo-\w+\.png$/.test(f)), `${step.label} : sortie incomplète dans ${out} : ${names.join(', ')}`)
      }
      assert.deepEqual(gaps(join(dirF, 'neuf'), join(dirF, 'complet')), [], `${step.label}, dossier neuf : écarts avec --prod sans cache`)
      assert.deepEqual(gaps(join(dirP, 'place'), state), [], `${step.label}, sur place : écarts avec --prod sans cache`)
      if (step.served) assert.ok(fresh.served > 0 && inPlace.served > 0, `${step.label} : le cache sert en production\n${fresh.out}\n${inPlace.out}`)
    }
    // un cache écrit sur place, lu par une construction en dossier neuf : juste aussi
    const cross     = build(rootP, ['--prod', '--cache', '--output', join(rootP, 'runs/croise/neuf'), '--manifest', join(rootP, 'runs/croise/neuf/bundle.js')])
    const crossFull = build(rootP, ['--prod', '--output', join(rootP, 'runs/croise/complet'), '--manifest', join(rootP, 'runs/croise/complet/bundle.js')])
    for (const b of [cross, crossFull]) assert.equal(b.status, 0, b.out)
    assert.deepEqual(gaps(join(rootP, 'runs/croise/neuf'), join(rootP, 'runs/croise/complet')), [], 'cache écrit sur place, dossier neuf : écarts avec --prod sans cache')
    report.push(`cache écrit sur place, dossier neuf : repris ${cross.served}, recompilés ${cross.cold}`)
    // eslint-disable-next-line no-console
    console.log(`      ${report.join('\n      ')}`)
  })

  it('--prod --cache=verifier : égale sur place, une ligne le dit ; un fichier du cache faussé est vu, la sortie reçoit les fichiers justes, code 1', function () {
    const root  = project('cache-prod-verifier')
    const cache = join(root, 'node_modules/.cache/mjs/build')
    const pied  = join(root, 'app/modularjs/pied.mjs')
    const init  = build(root, ['--prod', '--cache=verifier'])
    assert.equal(init.status, 0, init.out)
    writeFileSync(pied, readFileSync(pied, 'utf-8').replace("t: 'pied'", "t: 'pied, tour 2'"))
    const again = build(root, ['--prod', '--cache=verifier'])
    assert.equal(again.status, 0, again.out)
    assert.ok(again.served > 0, again.out)
    assert.ok(CHECKED.test(again.out), `sur place, la vérification part du même .mangle-cache.json que la construction\n${again.out}`)
    // dossier neuf : un cache écrit en dossier neuf, dont le .js gardé de carte-b est faussé à la main
    const first = build(root, ['--prod', '--cache', '--output', join(root, 'essai/premier'), '--manifest', join(root, 'essai/premier/bundle.js')])
    assert.equal(first.status, 0, first.out)
    const kept = [...files(join(cache, 'files')).keys()].find(f => /^carte-b-\w+\.js$/.test(f))
    assert.ok(kept !== undefined, `fichier gardé de carte-b : ${[...files(join(cache, 'files')).keys()].join(', ')}`)
    appendFileSync(join(cache, 'files', kept), '\n// faussé à la main\n')
    const neuf    = join(root, 'essai/neuf')
    const checked = build(root, ['--prod', '--cache=verifier', '--output', neuf, '--manifest', join(neuf, 'bundle.js')])
    assert.equal(checked.status, 1, checked.out)
    assert.match(checked.out, /cache jeté/, checked.out)
    assert.ok(checked.out.includes(kept), `le fichier qui diffère est nommé\n${checked.out}`)
    const complet = join(root, 'essai/complet')
    const full    = build(root, ['--prod', '--output', complet, '--manifest', join(complet, 'bundle.js')])
    assert.equal(full.status, 0, full.out)
    assert.deepEqual(gaps(neuf, complet), [], 'la sortie a reçu les fichiers de la construction complète')
  })
})
