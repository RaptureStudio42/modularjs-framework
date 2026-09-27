// Régression — un nettoyage utilisateur (@attach/@this=!) qui LÈVE pendant
// une destruction ne doit ni laisser le nœud en place (fantôme à côté de la
// nouvelle branche {if}/{else}, {key}, {@html}), ni sauter le nettoyage du
// nœud suivant, ni partir en rejet non géré. `_mjs_destroyWithHooks`
// (mjs_destroy_hooks.ts) appelait `el._mjs_td()`/`el._mjs_ref_td()` HORS de
// tout try/catch : une levée y interrompait la promesse AVANT le retrait/la
// purge du nœud, et les appelants ({if}, {key}, {@html}) n'attendent ni ne
// rattrapent cette promesse (fire-and-forget par design).
//
// Fix : chaque nettoyage dans son propre try/catch (les suivants continuent,
// l'erreur part par µ.error) ; le groupe de transitions attend via
// `Promise.allSettled` (pas `Promise.all`) pour la même raison ; les 4
// appelants (`_mjs_updIf`, `_mjs_updItemIf`, `_mjs_updKey`, `_mjs_updHtml`)
// posent en plus un `.catch` défensif.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

describe('mjs_destroy_hooks.ts — un teardown qui lève ne bloque plus le retrait du nœud (unitaire)', function () {
  it('_mjs_destroyWithHooks : le teardown lève, le nœud est retiré quand même, aucun rejet, l\'erreur part par µ.error', async () => {
    const initSrc = readFileSync(join(__dirname, '../src/runtime/mjs_init.ts'), 'utf-8')
      .replace(/export\s*\{[^}]*\}/, '')
    const destroyHooksSrc = readFileSync(join(__dirname, '../src/runtime/mjs_destroy_hooks.ts'), 'utf-8')

    const win: any = new Window({ url: 'http://localhost/' })
    const sandbox = `
      ${initSrc}
      µ.Element = function () {}
      ${destroyHooksSrc}
      return µ;
    `
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const µ: any = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', sandbox)(
      win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet,
    )

    const errorCalls: any[] = []
    µ.error = (...a: any[]) => { errorCalls.push(a) }

    const node: any = win.document.createElement('div')
    let removedCalled = false
    const origRemove = node.remove.bind(node)
    node.remove = () => { removedCalled = true; return origRemove() }
    node._mjs_td = () => { throw new Error('nettoyage utilisateur') }
    const owner = { _mjs_mjsPurgeSubtreeState: () => {} }

    await assert.doesNotReject(
      µ.Element.prototype._mjs_destroyWithHooks.call(owner, node, false),
      'AVANT le fix : cette promesse rejetait avec l\'erreur du teardown',
    )
    assert.equal(removedCalled, true, 'AVANT le fix : node.remove() n\'était jamais atteint')
    assert.equal(node._mjs_dead, true, 'le nœud doit être marqué mort définitivement')
    assert.equal(errorCalls.length, 1, 'le teardown en erreur doit être rapporté une fois par µ.error')
    assert.match(String(errorCalls[0][1]?.message ?? errorCalls[0][1]), /nettoyage utilisateur/)

    win.close?.()
  })
})

async function bundleAndMount(name: string, source: string) {
  const root = mjsTmp('td-throw-' + name)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, `${name}.mjs`), source)

  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const win: any = new Window({ url: 'http://localhost/' })
  const document: any = win.document
  const files = readdirSync(outDir)
  const coreFile = files.find((f: string) => /^mjs_core-/.test(f))
  const compFile = files.find((f: string) => new RegExp(`^${name}-`).test(f))
  assert.ok(coreFile && compFile, 'core + composant compilés')
  win.eval(`${stripEsm(readFileSync(join(outDir, coreFile!), 'utf-8'))}\nglobalThis.µ = µ;\n${stripEsm(readFileSync(join(outDir, compFile!), 'utf-8'))}`)

  document.body.innerHTML = `<mjs-${name}></mjs-${name}>`
  const el: any = document.body.firstElementChild
  await new Promise((r) => setTimeout(r, 60))
  return { win, document, el }
}

describe('{if} — un teardown qui lève sur la branche sortante', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la branche {if} sortante est retirée (pas de doublon avec {else}), le nettoyage du VOISIN tourne quand même, aucun rejet non géré', async () => {
    const COMPONENT = `
<script lang="coffee">
$show = true

setupA = (_node) ->
  ->
    throw new Error('teardown boom A')

setupB = (_node) ->
  globalThis.__bTeardown = true
  ->
    globalThis.__bTeardown = 'done'
</script>

<button class="toggle" @click={$show = not $show}>toggle</button>
{if $show}
  <div class="wrapper">
    <canvas class="a" @attach={setupA}></canvas>
    <canvas class="b" @attach={setupB}></canvas>
  </div>
{else}
  <p class="else-branch">gone</p>
{end}
`
    const rejections: any[] = []
    const onRejection = (err: any) => rejections.push(err)
    process.on('unhandledRejection', onRejection)
    try {
      const { win, el } = await bundleAndMount('iftdfix', COMPONENT)
      const shadow = el._shadow || el.shadowRoot
      assert.ok(shadow, 'shadow root présent')

      shadow.querySelector('.toggle').dispatchEvent(new win.Event('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 100))
      await new Promise((r) => setTimeout(r, 100))

      assertAbsent(shadow.querySelector('.wrapper'), 'AVANT le fix : la branche sortante restait fantôme à côté de {else}')
      assert.ok(shadow.querySelector('.else-branch'), 'la branche {else} doit être affichée seule')
      assert.equal(win.eval('globalThis.__bTeardown'), 'done', 'AVANT le fix : le teardown du canvas B (voisin de A) n\'était jamais appelé')
      assert.equal(rejections.length, 0, `AVANT le fix : rejet(s) non géré(s) capturé(s) : ${rejections.map((r) => r?.message).join(', ')}`)

      win.close?.()
    } finally {
      process.removeListener('unhandledRejection', onRejection)
    }
  })
})

describe('{key} — un teardown qui lève au changement de clé', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('l\'ancien contenu {key} est retiré (pas de doublon avec le nouveau), aucun rejet non géré', async () => {
    const COMPONENT = `
<script lang="coffee">
$k = 1

setupA = (_node) ->
  ->
    throw new Error('teardown boom K')
</script>

<button class="toggle" @click={$k = 2}>toggle</button>
{key $k}
  <div class="wrapper"><canvas class="a" @attach={setupA}></canvas></div>
{end}
`
    const rejections: any[] = []
    const onRejection = (err: any) => rejections.push(err)
    process.on('unhandledRejection', onRejection)
    try {
      const { win, el } = await bundleAndMount('keytdfix', COMPONENT)
      const shadow = el._shadow || el.shadowRoot
      assert.ok(shadow, 'shadow root présent')

      shadow.querySelector('.toggle').dispatchEvent(new win.Event('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 100))
      await new Promise((r) => setTimeout(r, 100))

      const wrappers = shadow.querySelectorAll('.wrapper')
      assert.equal(wrappers.length, 1, `AVANT le fix : ${wrappers.length} .wrapper (ancien fantôme + nouveau) au lieu de 1`)
      assert.equal(rejections.length, 0, `AVANT le fix : rejet(s) non géré(s) capturé(s) : ${rejections.map((r) => r?.message).join(', ')}`)

      win.close?.()
    } finally {
      process.removeListener('unhandledRejection', onRejection)
    }
  })
})
