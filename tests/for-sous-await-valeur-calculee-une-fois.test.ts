// Test runtime — un `{for}` dans une branche `{await}` qui lit une variable du composant calcule
// chaque valeur de ligne UNE fois.
//
// Avant : à la construction de la branche, la liste était remplie (une lecture par ligne), puis
// l'effet que `compileFor` enregistre juste après (pour suivre la variable du dehors) la rappelait
// au montage : une seconde lecture par ligne, sans rien de changé. Une fonction coûteuse lue dans
// la ligne payait donc double à l'affichage. On compte ici les appels d'une fonction lue dans la
// ligne, et on garde que la liste reste juste et suit toujours : variable du dehors changée,
// promesse résolue après le montage, promesse remplacée, branche `{error}`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function monter(prefixe: string, nom: string, source: string) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, `${nom}.mjs`), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code   = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  window.document.body.innerHTML = `<mjs-${nom}></mjs-${nom}>`
  return { window, c: window.document.querySelector(`mjs-${nom}`) as any }
}

const SCRIPT = `<script>
  $p = Promise.resolve([10, 20])
  $x = 1
  compte = (nom, v) ->
    c = (globalThis.__cnt ?= {})
    c[nom] = (c[nom] or 0) + 1
    v
</script>
`

const lire = (c: any) => [...c._shadow.querySelectorAll('em')].map((e: any) => e.textContent).join(',')

describe('{for} sous {await} — chaque valeur de ligne calculée une seule fois', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('montage = 1 par ligne, variable du dehors changée = 1 par ligne de plus', async () => {
    const { window, c } = await monter('fsa-base', 'fsabase', `${SCRIPT}<div>{await $p}{success v}{for n in v}<em>{compte('fr', n + $x)}</em>{end}{end}</div>\n`)
    try {
      await pause(120)
      assert.equal(lire(c), '11,21', 'lignes posées')
      assert.equal(window.__cnt.fr, 2, 'montage : une lecture par ligne (2 lignes)')
      c._set('x', 2)
      await pause(80)
      assert.equal(lire(c), '12,22', 'la ligne suit $x')
      assert.equal(window.__cnt.fr, 4, '$x change : une lecture de plus par ligne')
    }
    finally { window.close() }
  })

  it('promesse résolue APRÈS le montage : une lecture par ligne, valeurs justes, et la liste suit ensuite $x', async () => {
    const { window, c } = await monter('fsa-tard', 'fsatard', `<script>
  $p = new Promise((ok) -> setTimeout((-> ok([10, 20, 30])), 80))
  $x = 1
  compte = (nom, v) ->
    c = (globalThis.__cnt ?= {})
    c[nom] = (c[nom] or 0) + 1
    v
</script>
<div>{await $p}<b class="p">...</b>{success v}{for n in v}<em>{compte('fr', n + $x)}</em>{end}{end}</div>
`)
    try {
      await pause(30)
      assert.ok(c._shadow.querySelector('.p'), 'en attente')
      assert.equal(window.__cnt?.fr, undefined, 'rien lu avant la résolution')
      await pause(200)
      assert.equal(lire(c), '11,21,31', 'lignes posées après le montage')
      assert.equal(window.__cnt.fr, 3, 'résolution tardive : une lecture par ligne')
      c._set('x', 2)
      await pause(80)
      assert.equal(lire(c), '12,22,32', 'la ligne suit $x')
      assert.equal(window.__cnt.fr, 6, '$x change : une lecture de plus par ligne')
    }
    finally { window.close() }
  })

  it('promesse remplacée : nouvelles lignes, une lecture par ligne, valeurs justes', async () => {
    const { window, c } = await monter('fsa-rempl', 'fsarempl', `${SCRIPT}<div>{await $p}{success v}{for n in v}<em>{compte('fr', n + $x)}</em>{end}{end}</div>\n`)
    try {
      await pause(120)
      assert.equal(window.__cnt.fr, 2)
      c._set('x', 2)
      await pause(60)
      assert.equal(window.__cnt.fr, 4)
      c._set('p', Promise.resolve([1, 2, 3]))
      await pause(120)
      assert.equal(lire(c), '3,4,5', 'nouvelle liste avec $x courant')
      assert.equal(window.__cnt.fr, 7, 'promesse remplacée : une lecture par ligne neuve')
      c._set('x', 3)
      await pause(60)
      assert.equal(lire(c), '4,5,6')
      assert.equal(window.__cnt.fr, 10, '$x change ensuite : une lecture par ligne')
    }
    finally { window.close() }
  })

  it('branche {error} : une lecture par ligne, valeurs justes, et la liste suit $x', async () => {
    const { window, c } = await monter('fsa-err', 'fsaerr', `<script>
  $p = Promise.reject({lignes: [5, 6]})
  $x = 1
  compte = (nom, v) ->
    c = (globalThis.__cnt ?= {})
    c[nom] = (c[nom] or 0) + 1
    v
</script>
<div>{await $p}{success v}<u>ok</u>{error er}{for n in er.lignes}<em>{compte('fr', n + $x)}</em>{end}{end}</div>
`)
    try {
      await pause(150)
      assert.equal(lire(c), '6,7', 'lignes de la branche erreur')
      assert.equal(window.__cnt.fr, 2, 'montage : une lecture par ligne')
      c._set('x', 2)
      await pause(80)
      assert.equal(lire(c), '7,8', 'la ligne suit $x')
      assert.equal(window.__cnt.fr, 4, '$x change : une lecture de plus par ligne')
    }
    finally { window.close() }
  })
  // pourquoi ce test : le saut du second calcul ne doit jamais avaler une vraie écriture. Une variable
  // écrite juste après l'arrivée de la promesse (quelques microtâches plus tard, avant tout délai)
  // restait figée quand le saut dépendait du moment ; il dépend maintenant des valeurs lues
  it('variable écrite quelques microtâches après la résolution : la liste la suit', async () => {
    for (const sauts of [0, 1, 2, 3, 5]) {
      const { window, c } = await monter(`fsa-micro${sauts}`, `fsamicro${sauts}`, `<script>
  $liste = [{ id: 1, nom: 'a' }]
  $x = 0
  $p = new Promise((ok) -> setTimeout((-> ok(5)), 40))
  ecrire = ->
    q = $p
${Array.from({ length: sauts }, () => '    q = q.then -> null').join('\n')}
    q.then -> $x = 'W'
  ecrire()
</script>
<div>{await $p}<i>...</i>{success v}{for n in $liste by id}<em>{n.nom}-{$x}</em>{end}{end}</div>
`)
      try {
        await pause(250)
        assert.equal(lire(c), 'a-W', `écriture ${sauts} microtâche(s) après la résolution`)
      }
      finally { window.close() }
    }
  })
})
