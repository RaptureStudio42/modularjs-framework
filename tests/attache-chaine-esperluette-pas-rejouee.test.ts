// Une attache qui ne lit rien ne se rejoue pas à chaque rendu structurel (une ligne ajoutée à une
// liste, un bloc recréé). Pour le savoir, le compilateur cherche une lecture que rien ne suit — un
// paramètre de route `&x` ou un `µ…` — dans l'expression ; il la cherchait dans le texte brut,
// chaînes comprises : `mark('Q&A')`, `mark('url?x=1&page=2')` ou `mark('prix en µ')` étaient prises
// pour une lecture et rejouées à chaque rendu (nettoyage puis nouvelle pose sur la même balise,
// encore affichée). Seul le code compte : un `&x` ou un `µ` lu pour de vrai, hors des chaînes
// (y compris dans une interpolation de chaîne), garde le rejeu.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// journal tenu DANS la fenêtre happy-dom : recopié en tableau d'ici, sans quoi deepEqual compare deux mondes
const journal = (window: any): string[] => [...(window.__journal ?? [])]

async function monter(prefixe: string, fichiers: Record<string, string>, url: string) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code   = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  return window
}

const CHAINES = `<script>
  $items = [{id: 1}]
  log = (what) -> (globalThis.__journal ||= []).push(what)
  mark = (label) -> (node) ->
    log('attache ' + label)
    -> log('nettoyage ' + label)
</script>

<div class="t" @attach={mark('temoin')}>x</div>
<div class="a" @attach={mark('Q&A')}>x</div>
<div class="u" @attach={mark('url?x=1&page=2')}>x</div>
<div class="m" @attach={mark('prix en µ')}>x</div>
<div class="e" @attach={mark('et && ou')}>x</div>
<div class="d" @attach={mark("Q&A")}>x</div>
<div class="g" @attach={mark(\`µ&x\`)}>x</div>
<ul>{for it in $items by id}<li>{it.id}</li>{end}</ul>
`

const LECTURES = `<script>
  $items = [{id: 1}]
  log = (what) -> (globalThis.__journal ||= []).push(what)
  mark = (label) -> (node) ->
    log('attache ' + label)
    -> log('nettoyage ' + label)
</script>

<div class="p" @attach={mark('param ' + &room)}>x</div>
<div class="r" @attach={mark('url ' + typeof µurl)}>x</div>
<div class="i" @attach={mark(\`interp \${&room}\`)}>x</div>
<div class="s" @attach={mark('Q&A' + &room)}>x</div>
<ul>{for it in $items by id}<li>{it.id}</li>{end}</ul>
`

const LIGNES = `<script>
  $n     = 0
  $items = [{id: 1}, {id: 2}]
  log = (what) -> (globalThis.__journal ||= []).push(what)
  mark = (label) -> (node) ->
    log('attache ' + label)
    -> log('nettoyage ' + label)
</script>

<ul>{for it in $items by id}<li class="row"><b class="q" @attach={mark('Q&A ' + it.id)}>{$n}</b><i class="u" @attach={mark('url?x=1&page=2')}>{$n}</i><u class="m" @attach={mark('prix en µ')}>{$n}</u></li>{end}</ul>
`

describe('@attach : un « & » ou un « µ » dans une chaîne n\'est pas une lecture', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('chaînes qui contiennent « & » ou « µ » : posées une fois, pas rejouées quand une ligne s\'ajoute', async () => {
    const window = await monter('attache-chaine-esperluette', { 'demo-chaines.mjs': CHAINES }, 'http://localhost/')
    try {
      window.document.body.innerHTML = '<mjs-demo-chaines></mjs-demo-chaines>'
      const c = window.document.querySelector('mjs-demo-chaines')
      await attendre(() => !!c._shadow?.querySelector('li'))
      await pause(40)
      const montage = journal(window)
      for (const e of ['temoin', 'Q&A', 'url?x=1&page=2', 'prix en µ', 'et && ou', 'µ&x']) assert.ok(montage.includes('attache ' + e), `montage : ${e} posée (${JSON.stringify(montage)})`)
      window.__journal = []
      window.eval(`document.querySelector('mjs-demo-chaines')._set('items', [{id: 1}, {id: 2}])`)
      await pause(60)
      const j = journal(window)
      assert.deepEqual(j, [], `une ligne ajoutée : aucune attache de la racine n'est nettoyée ni reposée (${JSON.stringify(j)})`)
      window.eval(`document.querySelector('mjs-demo-chaines')._set('items', [{id: 1}, {id: 2}, {id: 3}])`)
      await pause(60)
      assert.deepEqual(journal(window), [], `une deuxième ligne ajoutée : toujours rien (${JSON.stringify(journal(window))})`)
    }
    finally {
      window.close()
    }
  })

  it('un paramètre de route ou un µ lu pour de vrai dans l\'expression garde le rejeu à chaque rendu', async () => {
    const window = await monter('attache-lecture-esperluette', { 'demo-lectures.mjs': LECTURES }, 'http://localhost/')
    try {
      window.document.body.innerHTML = '<mjs-demo-lectures></mjs-demo-lectures>'
      const c = window.document.querySelector('mjs-demo-lectures')
      await attendre(() => !!c._shadow?.querySelector('li'))
      await pause(40)
      window.__journal = []
      window.eval(`document.querySelector('mjs-demo-lectures')._set('items', [{id: 1}, {id: 2}])`)
      await pause(60)
      const j = journal(window)
      for (const e of ['param undefined', 'url object', 'interp undefined', 'Q&Aundefined']) {
        assert.ok(j.includes('nettoyage ' + e), `${e} : nettoyée au rendu suivant (${JSON.stringify(j)})`)
        assert.ok(j.includes('attache ' + e), `${e} : reposée au rendu suivant (${JSON.stringify(j)})`)
      }
    }
    finally {
      window.close()
    }
  })

  it('dans une ligne de {for} : la chaîne ne force pas le rejeu, la lecture de la ligne le garde', async () => {
    const window = await monter('attache-chaine-ligne', { 'demo-lignes.mjs': LIGNES }, 'http://localhost/')
    try {
      window.document.body.innerHTML = '<mjs-demo-lignes></mjs-demo-lignes>'
      const c = window.document.querySelector('mjs-demo-lignes')
      await attendre(() => c._shadow?.querySelectorAll('li.row').length === 2)
      await pause(40)
      const montage = journal(window)
      for (const e of ['Q&A 1', 'Q&A 2', 'url?x=1&page=2', 'prix en µ']) assert.ok(montage.includes('attache ' + e), `montage : ${e} posée (${JSON.stringify(montage)})`)
      window.__journal = []
      window.eval(`document.querySelector('mjs-demo-lignes')._set('n', 1)`)
      await pause(60)
      const j = journal(window)
      assert.equal(c._shadow.querySelector('b.q').textContent, '1', 'le rendu des lignes a bien repassé')
      for (const e of ['url?x=1&page=2', 'prix en µ']) assert.ok(!j.some((l) => l.endsWith(e)), `${e} : ni nettoyée ni reposée au rendu de la ligne (${JSON.stringify(j)})`)
      for (const e of ['Q&A 1', 'Q&A 2']) assert.ok(j.includes('nettoyage ' + e) && j.includes('attache ' + e), `${e} lit la ligne : rejouée avec elle (${JSON.stringify(j)})`)
    }
    finally {
      window.close()
    }
  })
})
