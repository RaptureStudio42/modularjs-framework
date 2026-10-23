// Une attache `@attach` se pose une fois par balise : un rendu qui repasse sans rien changer pour
// elle ne la démonte plus pour la reposer aussitôt. Avant, chaque passage du rendu structurel
// (une navigation dans la même page routée, qui relit `&room`, un `$n` affiché à côté, une ligne
// ajoutée à une liste) appelait son nettoyage puis la rejouait sur la MÊME balise, encore affichée
// — un nettoyage qui remet un état à zéro le faisait donc à chaque navigation. Restent rejouées :
// la balise neuve (bloc `{if}`/`{key}` recréé, ligne ajoutée), l'attache dont une variable `$` a
// changé, et toutes après une reconnexion du composant (le nettoyage a tourné à la déconnexion).

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

const LAYOUT = `<routes target="main">
  /house/(:room)      house-page
  /house/:room/:tab   house-page
  /elsewhere          other-page
</routes>

<script>
  µurlChange (path) -> null
</script>

<div class="shell"><@view main></div>
`

const HOUSE = `<script>
  log = (what) -> (globalThis.__journal ||= []).push(what)
  keep = (node) ->
    log('attache')
    -> log('nettoyage')
</script>

<div class="house" @class{&room}="in-room" @attach={keep(_node)}>
  {if &room}<a class="back" href="#/house">retour</a>{end}
  <h1>{&room or 'hall'}</h1>
</div>
`

const PARAM = `<script>
  log = (what) -> (globalThis.__journal ||= []).push(what)
  track = (room) -> (node) ->
    log('attache ' + room)
    -> log('nettoyage ' + room)
</script>

<div class="tracked" @attach={track(&room or 'hall')}>{&room or 'hall'}</div>
`

const ELSEWHERE = `<p class="other">ailleurs</p>
`

const LOCAL = `<script>
  $show  = true
  $n     = 0
  $items = [{id: 1}, {id: 2}]
  $msg   = 'a'
  log = (what) -> (globalThis.__journal ||= []).push(what)
  mark = (label) -> (node) ->
    log('attache ' + label)
    -> log('nettoyage ' + label)
  tip = (text) -> (node) ->
    log('attache bulle ' + text)
    -> log('nettoyage bulle ' + text)
</script>

<div class="root" @attach={mark('racine')}>{$n}</div>
{if $show}<div class="branch" @attach={mark('branche')}>{$n}</div>{end}
<ul>{for it in $items by id}<li @attach={mark('ligne')}>{it.id} {$n}</li>{end}</ul>
<p class="tip" @attach={tip($msg)}>{$n}</p>
{key $n}<i class="keyed" @attach={mark('cle')}></i>{end}
`

describe('@attach sans dépendance : une pose par balise, pas de rejeu à chaque rendu', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('page routée : naviguer dans la même page ne démonte pas l\'attache de sa racine (même instance)', async () => {
    const window = await monter('attache-route', { 'app.page.mjs': LAYOUT, 'house-page.mjs': HOUSE, 'other-page.mjs': ELSEWHERE }, 'http://localhost/#/house')
    try {
      window.document.body.innerHTML = '<mjs-app></mjs-app>'
      const app   = window.document.querySelector('mjs-app')
      const page  = () => app._shadow?.querySelector('mjs-house-page')
      const titre = () => page()?._shadow?.querySelector('h1')?.textContent
      await attendre(() => titre() === 'hall')
      await pause(30)
      const premiere = page()
      assert.deepEqual(journal(window), ['attache'], 'posée une fois au montage')
      window.eval(`µ.Router.to('/house/lounge')`)
      await attendre(() => titre() === 'lounge')
      await pause(30)
      assert.ok(page() === premiere, 'le routeur garde la même instance de page : rien n\'est recréé')
      assert.ok(page()._shadow.querySelector('.house').classList.contains('in-room'), 'le rendu a bien suivi le paramètre')
      window.eval(`µ.Router.to('/house/lounge/furniture')`)
      await pause(60)
      window.eval(`µ.Router.to('/house')`)
      await attendre(() => titre() === 'hall')
      await pause(30)
      assert.deepEqual(journal(window), ['attache'], `trois navigations dans la page : ni nettoyage ni nouvelle pose (${JSON.stringify(journal(window))})`)
      window.eval(`µ.Router.to('/elsewhere')`)
      await attendre(() => !!app._shadow?.querySelector('mjs-other-page'))
      await pause(30)
      assert.deepEqual(journal(window), ['attache', 'nettoyage'], 'quitter la page nettoie l\'attache')
      window.eval(`µ.Router.to('/house')`)
      await attendre(() => titre() === 'hall' && page()?.isConnected)
      await pause(30)
      assert.deepEqual(journal(window), ['attache', 'nettoyage', 'attache'], 'revenir sur la page la repose')
    }
    finally {
      window.close()
    }
  })

  it('une attache qui lit un paramètre de route le suit toujours', async () => {
    const window = await monter('attache-param', { 'app.page.mjs': LAYOUT.replace(/house-page/g, 'param-page'), 'param-page.mjs': PARAM, 'other-page.mjs': ELSEWHERE }, 'http://localhost/#/house')
    try {
      window.document.body.innerHTML = '<mjs-app></mjs-app>'
      const app   = window.document.querySelector('mjs-app')
      const texte = () => app._shadow?.querySelector('mjs-param-page')?._shadow?.querySelector('.tracked')?.textContent
      await attendre(() => texte() === 'hall')
      await pause(30)
      window.eval(`µ.Router.to('/house/lounge')`)
      await attendre(() => texte() === 'lounge')
      await pause(30)
      const j = journal(window)
      assert.equal(j[j.length - 1], 'attache lounge', `l'attache reposée avec le nouveau paramètre (${JSON.stringify(j)})`)
      assert.ok(j.includes('nettoyage hall'), 'l\'ancienne pose nettoyée')
    }
    finally {
      window.close()
    }
  })

  it('racine, branche {if}, ligne de {for}, bloc {key} et attache à dépendance $ : chacune rejouée seulement quand il le faut', async () => {
    const window = await monter('attache-local', { 'demo-attache.mjs': LOCAL }, 'http://localhost/')
    try {
      window.document.body.innerHTML = '<mjs-demo-attache></mjs-demo-attache>'
      const c = window.document.querySelector('mjs-demo-attache')
      await attendre(() => !!c._shadow?.querySelector('.keyed'))
      await pause(30)
      const pose = async (cle: string, valeur: any) => {
        window.__journal = []
        window.eval(`document.querySelector('mjs-demo-attache')._set(${JSON.stringify(cle)}, ${JSON.stringify(valeur)})`)
        await pause(30)
        return journal(window)
      }
      const montage = journal(window)
      for (const e of ['racine', 'branche', 'ligne', 'bulle a', 'cle']) assert.ok(montage.includes('attache ' + e), `montage : ${e} posée (${JSON.stringify(montage)})`)
      assert.ok(!montage.some((e) => /nettoyage (racine|branche|ligne|cle)/.test(e)), `montage : aucun nettoyage (${JSON.stringify(montage)})`)
      let j = await pose('n', 1)
      assert.deepEqual(j, ['nettoyage cle', 'attache cle'], `$n change : seul le bloc {key $n}, recréé, repose la sienne (${JSON.stringify(j)})`)
      j = await pose('items', [{id: 1}, {id: 2}, {id: 3}])
      assert.deepEqual(j, ['attache ligne'], `une ligne ajoutée : seule la nouvelle ligne pose la sienne (${JSON.stringify(j)})`)
      j = await pose('msg', 'b')
      assert.deepEqual(j, ['nettoyage bulle a', 'attache bulle b'], `$msg change : l'attache qui le lit est reposée (${JSON.stringify(j)})`)
      j = await pose('show', false)
      assert.deepEqual(j, ['nettoyage branche'], `branche fermée : sa balise part, son nettoyage tourne (${JSON.stringify(j)})`)
      j = await pose('show', true)
      assert.deepEqual(j, ['attache branche'], `branche rouverte : la balise neuve pose la sienne (${JSON.stringify(j)})`)
    }
    finally {
      window.close()
    }
  })

  it('composant retiré puis remis : nettoyées à la déconnexion, reposées à la reconnexion', async () => {
    const window = await monter('attache-reconnexion', { 'demo-attache.mjs': LOCAL }, 'http://localhost/')
    try {
      window.document.body.innerHTML = '<div class="a"><mjs-demo-attache></mjs-demo-attache></div><div class="b"></div>'
      const c = window.document.querySelector('mjs-demo-attache')
      await attendre(() => !!c._shadow?.querySelector('.keyed'))
      await pause(30)
      window.__journal = []
      window.document.querySelector('.b').appendChild(c)
      await pause(40)
      const j = journal(window)
      for (const e of ['racine', 'branche', 'ligne', 'cle']) {
        assert.ok(j.includes('nettoyage ' + e), `déplacement : ${e} nettoyée (${JSON.stringify(j)})`)
        assert.ok(j.lastIndexOf('attache ' + e) > j.indexOf('nettoyage ' + e), `déplacement : ${e} reposée après son nettoyage (${JSON.stringify(j)})`)
      }
    }
    finally {
      window.close()
    }
  })
})
