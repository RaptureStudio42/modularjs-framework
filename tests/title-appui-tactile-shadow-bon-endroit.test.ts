// Régression — `@title` au doigt (appui long) sur un élément DANS un composant
// à shadow root : un `touchstart` `composed:true` traverse la racine shadow
// PUIS document (retargeting shadow DOM), chacune écoutée séparément par
// `µ._mjs_titleAttach`. Le survol/focus (`__titleOnEnter`/`__titleOnLeave`)
// posait déjà une garde anti double-passage (`e._mjs_mjsTitleHandled`) — les
// gestionnaires TACTILES (`__titleOnTouchStart`/`__titleOnTouchEnd`) en
// étaient dépourvus : la 2e passe (root = document) écrasait le `root`
// programmé par la 1re (root = shadow), et la bulle finissait TOUJOURS en
// repli `document.body`, même quand Popover est disponible dans le shadow.
//
// Fix : même garde posée sur `__titleOnTouchStart`/`__titleOnTouchEnd`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

describe('mjs_title.ts — appui tactile sur composant shadow : la bulle naît au bon endroit', function () {
  this.timeout(40000)
  let window: any = null
  let document: any = null
  let el: any = null

  before(async function () {
    const root = mjsTmp('title-touch-fix')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'titletouchfix.mjs'), `
<script>
$x = 0
</script>
<button id="shadowbtn" @title="Info du composant">Bouton</button>
`)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtime: ['title'] })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir)
    const coreFile = files.find((f: string) => /^mjs_core-/.test(f))
    const compFile = files.find((f: string) => /^titletouchfix-/.test(f))
    assert.ok(coreFile && compFile)

    window = new Window({ url: 'http://localhost/' })
    document = window.document
    // Popover polyfillé AVANT chargement du cœur (feature-detect au chargement du module).
    window.eval(`
      HTMLElement.prototype.showPopover = function () { this.setAttribute('data-popover-open', ''); };
      HTMLElement.prototype.hidePopover = function () { this.removeAttribute('data-popover-open'); };
    `)
    window.eval(`${stripEsm(readFileSync(join(outDir, coreFile!), 'utf-8'))}\nglobalThis.µ = µ;\n${stripEsm(readFileSync(join(outDir, compFile!), 'utf-8'))}`)
    document.body.innerHTML = '<mjs-titletouchfix></mjs-titletouchfix>'
    el = document.body.firstElementChild
    await sleep(50)
    assert.ok(el._shadow, 'shadow root monté')
  })

  after(async () => {
    delete window?.HTMLElement?.prototype?.showPopover
    delete window?.HTMLElement?.prototype?.hidePopover
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('appui long (touchstart composed) sur bouton shadow : la bulle naît DANS le shadow, jamais dans document.body', async function () {
    const btn = el._shadow.querySelector('#shadowbtn')
    assert.ok(btn, 'bouton shadow trouvé')

    const touchStart = new window.Event('touchstart', { bubbles: true, composed: true })
    Object.defineProperty(touchStart, 'touches', { value: [{ clientX: 10, clientY: 10 }] })
    btn.dispatchEvent(touchStart)

    await sleep(650) // > TITLE_TOUCH_PRESS_MS (500ms)

    const bubbleInShadow = el._shadow.querySelector('.mjs-title')
    const bubbleInDocument = document.querySelector('.mjs-title')

    assert.ok(bubbleInShadow, 'AVANT le fix : la bulle naissait dans document.body, jamais dans le shadow')
    assert.equal(bubbleInDocument, null, 'AVANT le fix : une bulle apparaissait en repli document.body même avec Popover disponible')
    assert.equal(bubbleInShadow.textContent, 'Info du composant')

    const touchEnd = new window.Event('touchend', { bubbles: true, composed: true })
    btn.dispatchEvent(touchEnd)
    await sleep(10)
  })
})
