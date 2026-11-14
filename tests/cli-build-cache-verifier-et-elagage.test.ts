// `mjs build --cache=verifier` et l'élagage du cache, sur un petit projet fabriqué ici. Vérifier : la construction servie par le cache
// est comparée à l'octet à une construction complète faite à part ; égale, une ligne le dit (code 0) ; un fichier du cache faussé à la
// main est vu, le cache est jeté, la sortie reçoit les fichiers justes (code 1). Élagage : après cinq configurations successives, quatre
// clés restent, et `files/` ne garde aucun fichier que seule la clé retirée citait.

import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { PNG, build, files, gaps, write } from './helpers/construction-cache.js'

const CONFIG = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs', i18n: { default: 'fr' } }
const SOURCES: Record<string, string | Buffer> = {
  'accueil.mjs':  '<h1 class="t">accueil</h1>\n<mjs-carte></mjs-carte>\n<mjs-galerie></mjs-galerie>\n<mjs-traduit></mjs-traduit>\n',
  'carte.mjs':    '<div class="c">\n  <@include entete>\n  <p>carte</p>\n</div>\n',
  '_entete.mjs':  '<h2 class="e">entête</h2>\n',
  'galerie.mjs':  '<img src="µasset(\'img/logo.png\')" alt="logo">\n',
  'img/logo.png': PNG,
  'traduit.mjs':  '<p class="tr">{µt(\'titre\')}</p>\n',
  'i18n/fr.yml':  'titre: Bonjour\n',
}
const CHECKED = /^cache vérifié : (\d+) fichiers identiques à l'octet$/m

function project(prefix: string): string {
  const root = mjsTmp(prefix)
  for (const [rel, data] of Object.entries(SOURCES)) write(join(root, 'app/modularjs', rel), data)
  write(join(root, 'mjs.config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`)
  mkdirSync(join(root, 'node_modules'))
  return root
}

const keys = (cache: string): string[] => existsSync(cache) ? readdirSync(cache).filter(f => /^[0-9a-f]{16}\.json$/.test(f)) : []

describe('mjs build --cache=verifier et élagage du cache', function () {
  this.timeout(300_000)

  it('--cache=verifier : sortie égale à une construction complète, une ligne le dit, code 0', function () {
    const root  = project('cache-verifier')
    const first = build(root, ['--cache=verifier'])
    assert.equal(first.status, 0, first.out)
    assert.equal(first.reason, 'premier passage', first.out)
    assert.ok(Number(CHECKED.exec(first.out)?.[1] ?? 0) >= 8, `ligne de vérification attendue\n${first.out}`)
    appendFileSync(join(root, 'app/modularjs/carte.mjs'), '<i hidden>tour 2</i>\n')
    const second = build(root, ['--cache=verifier'])
    assert.equal(second.status, 0, second.out)
    assert.equal(second.cold, 1, second.out)
    assert.ok(CHECKED.test(second.out), second.out)
    // la construction complète faite à part ne laisse rien derrière elle
    const left = readdirSync(join(root, 'node_modules/.cache/mjs/build')).filter(f => !/^[0-9a-f]{16}\.json$|^dernier\.json$|^files$/.test(f))
    assert.deepEqual(left, [], second.out)
  })

  it('--cache=verifier : un fichier du cache faussé à la main est vu, le cache est jeté, la sortie reçoit les fichiers justes, code 1', function () {
    const root  = project('cache-verifier-fausse')
    const cache = join(root, 'node_modules/.cache/mjs/build')
    const init  = build(root, ['--cache'])
    assert.equal(init.status, 0, init.out)
    // le .js gardé de la carte, faussé : un dossier de sortie neuf le reprend tel quel
    const kept = [...files(join(cache, 'files')).keys()].find(f => /^carte-\w+\.js$/.test(f))
    assert.ok(kept !== undefined, `fichier gardé de la carte : ${[...files(join(cache, 'files')).keys()].join(', ')}`)
    appendFileSync(join(cache, 'files', kept), '\n// faussé à la main\n')
    const neuf    = join(root, 'essai/neuf')
    const checked = build(root, ['--cache=verifier', '--output', neuf, '--manifest', join(neuf, 'bundle.js')])
    assert.equal(checked.status, 1, checked.out)
    assert.equal(checked.cold, 0, checked.out)
    assert.match(checked.out, /cache jeté/, checked.out)
    assert.ok(checked.out.includes(kept), `le fichier qui diffère est nommé\n${checked.out}`)
    assert.ok(!CHECKED.test(checked.out), checked.out)
    assert.deepEqual(keys(cache), [], `cache jeté\n${checked.out}`)
    const complet = join(root, 'essai/complet')
    const full    = build(root, ['--output', complet, '--manifest', join(complet, 'bundle.js')])
    assert.equal(full.status, 0, full.out)
    assert.deepEqual(gaps(neuf, complet), [], 'la sortie a reçu les fichiers de la construction complète')
    assert.ok(!readFileSync(join(neuf, kept), 'utf-8').includes('faussé'), checked.out)
  })

  it('élagage : cinq configurations successives, quatre clés restent, files/ ne garde que les noms des clés restantes', function () {
    const root    = project('cache-elagage')
    const cache   = join(root, 'node_modules/.cache/mjs/build')
    const outputs: Set<string>[] = []
    const config  = (n: number): void => write(join(root, 'mjs.config.json'), `${JSON.stringify({ ...CONFIG, urlPrefix: `/m${n}` }, null, 2)}\n`)
    for (let n = 1; n <= 5; n++) {
      config(n)
      const run = build(root, ['--cache'])
      assert.equal(run.status, 0, run.out)
      outputs.push(new Set(files(join(root, 'public/modularjs')).keys()))
      assert.equal(keys(cache).length, Math.min(n, 4), `clés après la configuration ${n} : ${keys(cache).join(', ')}`)
      if (n === 4) {
        // avant l'élagage, files/ garde des fichiers que seule la première configuration produit : la suite n'est pas vide de sens
        const own = [...outputs[0]].filter(f => !outputs.slice(1).some(o => o.has(f)))
        assert.ok(own.some(f => existsSync(join(cache, 'files', f))), `propres à la première configuration : ${own.join(', ')}`)
      }
    }
    const cited  = new Set(outputs.slice(1).flatMap(o => [...o]))
    const orphan = [...files(join(cache, 'files')).keys()].filter(f => !cited.has(f))
    assert.deepEqual(orphan, [], 'files/ ne garde que les sorties des quatre configurations restantes')
    // une configuration restante resert entière ; la première, retirée, recompile tout
    config(2)
    const again = build(root, ['--cache'])
    assert.equal(again.cold, 0, again.out)
    config(1)
    const gone = build(root, ['--cache'])
    assert.equal(gone.reason, 'mjs.config.json a changé', gone.out)
  })
})
