// une aide du cœur qu'une unité appelle reste au cœur de production, même quand son appel est écrit, sur une même ligne, entre une
// division qui suit un `++` et une autre barre oblique (une autre division, un commentaire de fin de ligne, une adresse en texte) :
// l'appel profond (`$l.push(x)`), la suppression profonde (`delete $o.a`), l'état lu comme une valeur (`Object.assign($, …)`) et la
// case écrite sans rendu (`µwrite`). Le relevé des appels d'une unité doit voir un tel appel

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as bundlerModule from '../src/bundler/index.js'
import { collectCoreCalls } from '../src/bundler/core-contract.js'
import { mjsTmp } from './helpers/tmp.js'

const { Bundler, terminateSharedWorkerPool } = bundlerModule

const page  = (...lignes: string[]): string => lignes.join('\n')
const CARTE = page(
  '<script lang="js">',
  '  $liste = [1];',
  '  $objet = { a: 1, b: 2 };',
  '  $n     = 0;',
  '  $total = 0;',
  '  let compte = 0;',
  '  const pousser   = () => { const m = compte++ / 2; $liste.push(m); $total = m / 4; };',
  '  const supprimer = () => { const m = compte++ / 2; delete $objet.a; $total = m / 4; };',
  '  const valeur    = () => { const m = compte++ / 2; Object.assign($, { n: 7 }); $total = m / 4; };',
  '  const ecrire    = () => { const m = compte++ / 2; µwrite($n, 41); $total = m / 4; };',
  '</script>',
  '<button @click={pousser()}>a</button><button @click={supprimer()}>b</button><button @click={valeur()}>c</button><button @click={ecrire()}>d</button>',
  '<p>{$liste.length} {$objet.b} {$n} {$total}</p>')

// chaque aide : ce que le code de l'unité y écrit, et sa définition dans le texte du cœur (non minifié)
const AIDES: Array<[string, RegExp, RegExp]> = [
  ['l\'appel profond', /µ\._mjs_deepCall\(_mjsThis/, /µ\._mjs_deepCall = function/],
  ['la suppression profonde', /µ\._mjs_deepDelete\(_mjsThis/, /µ\._mjs_deepDelete = function/],
  ['l\'état lu comme une valeur', /µ\._mjs_makeDeepProxy\(_mjsThis/, /µ\._mjs_makeDeepProxy = function/],
  ['la case écrite sans rendu', /µ\._mjs_rawWrite\(_mjsThis\)/, /µ\._mjs_rawWrite = function/],
]

let faite: Promise<string> | undefined
function construire(): Promise<string> {
  faite ??= (async () => {
    const root   = mjsTmp('aide-apres-increment')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'carte-compte.mjs'), CARTE + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), runtime: 'core', js: 'bundle', env: 'prod', minify: false, lint: { a11y: false } } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return (readdirSync(outDir, { recursive: true }) as string[]).filter((f) => f.endsWith('.js')).sort().map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  })()
  return faite
}

describe('cœur de production : l\'aide appelée après un `++` suivi d\'une division y reste', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [forme, ligne] of [
    ['une autre division', 'const m = compte++ / 2; µ._mjs_deepCall(_mjsThis, [\'liste\'], \'push\', [m]); µ._set(_mjsThis, \'total\', m / 4);'],
    ['un commentaire de fin de ligne', 'const m = compte-- / 2; µ._mjs_deepCall(_mjsThis, [\'liste\'], \'push\', [m]); // noté'],
    ['une adresse en texte', 'const m = compte++ / 2; µ._mjs_deepCall(_mjsThis, [\'liste\'], \'push\', [m]); aller(\'/accueil\');'],
  ] as const) {
    it(`le relevé des appels d'une unité voit l'appel écrit entre un \`++\` suivi d'une division et ${forme}`, () => {
      assert.ok(collectCoreCalls(ligne).has('_mjs_deepCall'), 'appels relevés : ' + ([...collectCoreCalls(ligne)].join(', ') || 'aucun'))
    })
  }

  for (const [aide, appel, porte] of AIDES) {
    it(`production : ${aide}, que l'unité appelle, est au cœur`, async () => {
      const texte = await construire()
      assert.match(texte, appel, 'garde muette : le code de l\'unité appelle bien l\'aide')
      assert.match(texte, porte)
    })
  }
})
