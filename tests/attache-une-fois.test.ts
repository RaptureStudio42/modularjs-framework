// `@attach.once={fabrique(args)}` : la fabrique est appelée UNE fois quand la balise apparaît ; son nettoyage
// joue quand la balise disparaît (ligne retirée, `{if}` fermé) ; jamais rejoué entre les deux, même si la ligne
// se redessine ou si une variable lue change. Sans `.once`, l'attache qui lit sa ligne se rejoue toujours.
// Un modificateur inconnu (`.onec`) est refusé au build avec la suggestion `.once`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { setMessagesLang, t } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await pause(10)
}

async function compiler(prefixe: string, fichiers: Record<string, string>) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  return { stats, outDir }
}

async function monter(prefixe: string, fichiers: Record<string, string>) {
  const { stats, outDir } = await compiler(prefixe, fichiers)
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  return window
}

const journal = (window: any): string[] => [...(window.__journal ?? [])]
const efface  = (window: any) => { window.__journal = [] }

// la fabrique lit `$tick` et la ligne : sans `.once`, chacun la relancerait
const PAGE = (modificateur: string) => `<script>
  $show  = true
  $tick  = 0
  $items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]
  log = (what) -> (globalThis.__journal ||= []).push(what)
  suivre = (key, tick) -> (node) ->
    log('pose ' + key)
    -> log('retrait ' + key)
</script>

{if $show}<div class="bloc" @attach${modificateur}={suivre('bloc', $tick)}>{$tick}</div>{end}
<ul>{for p in $items by key}<li class="ligne" @attach${modificateur}={suivre(p.key, $tick)}>{p.key} {$tick}</li>{end}</ul>
`

describe('@attach.once : posée une fois par balise', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  async function essai(modificateur: string, fn: (c: any, window: any) => Promise<void>) {
    const window = await monter('attache-une-fois', { 'demo-page.mjs': PAGE(modificateur) })
    try {
      window.document.body.innerHTML = '<mjs-demo-page></mjs-demo-page>'
      const c = window.document.querySelector('mjs-demo-page')
      await attendre(() => c._shadow?.querySelectorAll('.ligne').length === 3)
      await pause(150)
      await fn(c, window)
    }
    finally {
      window.close()
    }
  }

  it('une variable lue qui change et une ligne qui se redessine ne la rejouent pas', async () => {
    await essai('.once', async (c, window) => {
      assert.deepEqual(journal(window).sort(), ['pose a', 'pose b', 'pose bloc', 'pose c'], 'une pose par balise au montage')
      efface(window)
      for (let i = 1; i <= 4; i++) { c._set('tick', i); await pause(40) }
      await pause(100)
      assert.deepEqual(journal(window), [], 'ni retrait ni pose quand $tick change et que les lignes se redessinent')
    })
  })

  it('le nettoyage joue quand la balise disparaît : ligne retirée, {if} fermé', async () => {
    await essai('.once', async (c, window) => {
      efface(window)
      c._set('items', [{ key: 'a' }, { key: 'c' }])
      await attendre(() => journal(window).length >= 1)
      await pause(100)
      assert.deepEqual(journal(window), ['retrait b'], 'seule la ligne retirée est nettoyée')
      efface(window)
      c._set('show', false)
      await attendre(() => journal(window).length >= 1)
      await pause(100)
      assert.deepEqual(journal(window), ['retrait bloc'], 'le bloc fermé est nettoyé, une fois')
    })
  })

  it('une ligne déplacée dans un {for} à clé garde son attache', async () => {
    await essai('.once', async (c, window) => {
      assert.equal(journal(window).length, 4, 'attaches posées au montage')
      efface(window)
      c._set('items', [{ key: 'c' }, { key: 'b' }, { key: 'a' }])
      await pause(300)
      const ordre = [...c._shadow.querySelectorAll('.ligne')].map((n: any) => n.textContent.trim().split(' ')[0])
      assert.deepEqual(ordre, ['c', 'b', 'a'], 'les lignes sont bien déplacées')
      assert.deepEqual(journal(window), [], 'aucun retrait ni pose')
    })
  })

  it('sans .once le comportement reste : l\'attache qui lit sa ligne ou $tick est rejouée', async () => {
    await essai('', async (c, window) => {
      efface(window)
      c._set('tick', 1)
      await pause(300)
      const j = journal(window)
      assert.ok(j.includes('retrait a') && j.includes('pose a'), `rejouée sans .once (${JSON.stringify(j)})`)
      assert.ok(j.includes('retrait bloc') && j.includes('pose bloc'), `bloc rejoué sans .once (${JSON.stringify(j)})`)
    })
  })
})

const AUTRES = `<script>
  $tick  = 0
  $cle   = 1
  $show  = true
  log = (what) -> (globalThis.__journal ||= []).push(what)
  suivre = (nom, tick) -> (node) ->
    log('pose ' + nom)
    -> log('retrait ' + nom)
  $promesse = new Promise((resolve) -> setTimeout((-> resolve('ok')), 20))
</script>

<p class="racine" @attach.once={suivre('racine', $tick)}>{$tick}</p>
{key $cle}<p class="cle" @attach.once={suivre('cle', $tick)}>{$tick}</p>{end}
{if $show}{await $promesse}<i>attente</i>{success valeur}<p class="attente" @attach.once={suivre('await', $tick)}>{valeur} {$tick}</p>{end}{end}
`

describe('@attach.once : racine, {key}, {await}', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('une pose, aucun rejeu quand $tick change ; nettoyage à la disparition, au changement de clé et à la destruction', async () => {
    const window = await monter('attache-une-fois-autres', { 'demo-autres.mjs': AUTRES })
    try {
      window.document.body.innerHTML = '<mjs-demo-autres></mjs-demo-autres>'
      const c = window.document.querySelector('mjs-demo-autres')
      await attendre(() => journal(window).length >= 3)
      await pause(200)
      assert.deepEqual(journal(window).sort(), ['pose await', 'pose cle', 'pose racine'], 'une pose par balise')
      efface(window)
      for (let i = 1; i <= 3; i++) { c._set('tick', i); await pause(60) }
      await pause(100)
      assert.deepEqual(journal(window), [], 'aucun rejeu')
      c._set('cle', 2)
      await attendre(() => journal(window).length >= 2)
      await pause(100)
      assert.deepEqual(journal(window).sort(), ['pose cle', 'retrait cle'], 'la clé change : retrait puis pose')
      efface(window)
      c._set('show', false)
      await attendre(() => journal(window).length >= 1)
      await pause(100)
      assert.deepEqual(journal(window), ['retrait await'], 'le {if} fermé nettoie la balise du {await}')
      efface(window)
      c.remove()
      await attendre(() => journal(window).length >= 2)
      await pause(100)
      assert.deepEqual(journal(window).sort(), ['retrait cle', 'retrait racine'], 'composant détruit : tout est nettoyé')
    }
    finally {
      window.close()
    }
  })
})

describe('@attach.onec : modificateur inconnu', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('refusé au build, avec la suggestion .once', async () => {
    const { stats } = await compiler('attache-une-fois-faute', { 'demo-faute.mjs': '<div @attach.onec={(n) -> null}>x</div>\n' })
    const texte = stats.errors.map((e: any) => e.message).join('\n')
    assert.ok(stats.errors.length > 0, 'une erreur de build')
    assert.ok(texte.includes('.onec') && texte.includes('.once'), `l'erreur nomme la faute et propose .once : ${texte}`)
    assert.ok(!texte.includes('événement'), `l'erreur parle de l'attache, pas d'un événement : ${texte}`)
  })

  it('le message existe en français (vouvoiement) et en anglais', () => {
    setMessagesLang('fr')
    const fr = t('generator.attach-modificateur-inconnu', { attrName: '@attach.onec', mod: 'onec', hint: ' Vouliez-vous dire « .once » ?' })
    setMessagesLang('en')
    const en = t('generator.attach-modificateur-inconnu', { attrName: '@attach.onec', mod: 'onec', hint: ' Did you mean ".once"?' })
    setMessagesLang('fr')
    assert.ok(fr.includes('.once') && /utilisez|écrivez/i.test(fr), fr)
    assert.ok(en.includes('.once') && /use|write/i.test(en), en)
  })
})
