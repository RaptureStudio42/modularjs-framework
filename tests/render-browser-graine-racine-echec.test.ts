// Le rendu par le moteur navigateur relève, dans la page, les clés racine que la page a lues (`µ._i18nUsedRoot`) pour les semer dans la
// graine `#__mjs_i18n`. Si ce relevé échoue, la page sort quand même, mais sa graine n'a plus ses textes racine : ils arriveront avec le
// fichier de langue, et le texte pourra clignoter. Cet échec ne doit jamais passer sous silence : il est rangé dans les avertissements du
// rendu, comme les autres (`warnings` du résultat), et la page est rendue quand même.
//
// L'échec est fabriqué en faisant rejeter, pour ce seul relevé, l'`evaluate` de la page : `chromium.launch` est remplacé le temps du test
// (même module Playwright que celui du moteur), le navigateur reste le vrai.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { mjsTmp } from './helpers/tmp.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

function projet(prefixe: string): { root: string, config: any } {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
  writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'salut: Bonjour\n')
  writeFileSync(join(srcDir, 'home.mjs'), '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')} / {µt(\'/titre\')}</h1>\n')
  return { root, config: { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', i18n: { default: 'fr' } } }
}

function graineDe(texte: string): any {
  const m = texte.match(/<script[^>]*id="__mjs_i18n"[^>]*>([\s\S]*?)<\/script>/)
  assert.ok(m, 'la page porte sa graine de traduction')
  return JSON.parse(m![1])
}

// le vrai navigateur, mais la page rejette l'évaluation qui relève les clés racine
function lancementAvecRelevePerdu(origine: any): any {
  return async (...args: any[]) => {
    const navigateur = await origine(...args)
    const newContext = navigateur.newContext.bind(navigateur)
    navigateur.newContext = async (...a: any[]) => {
      const contexte = await newContext(...a)
      const newPage  = contexte.newPage.bind(contexte)
      contexte.newPage = async (...b: any[]) => {
        const page     = await newPage(...b)
        const evaluate = page.evaluate.bind(page)
        page.evaluate  = (fonction: any, arg: any) => typeof fonction === 'string' && fonction.includes('_i18nUsedRoot') ? Promise.reject(new Error('relevé refusé par le test')) : evaluate(fonction, arg)
        return page
      }
      return contexte
    }
    return navigateur
  }
}

describe('render-browser — relevé des clés racine de la graine', function () {
  this.timeout(60000)
  const lancementOrigine = chromium.launch

  afterEach(() => { (chromium as any).launch = lancementOrigine })
  after(async () => { await terminateSharedWorkerPool() })

  it('relevé qui réussit : la graine porte les clés racine lues, aucun avertissement sur le relevé', async () => {
    const { root, config } = projet('graine-racine-ok')
    const renderer = await createBrowserRenderer(config, { configDir: root })
    try {
      const res = await renderer.renderPage('mjs-home', { settleMs: 5000, ssrMode: 'markers' })
      assert.deepEqual(graineDe(res.sharedScript + res.html).root, { fr: { titre: 'Titre' } })
      assert.doesNotMatch(res.warnings.join('\n'), /clés racine/)
    }
    finally { await renderer.close() }
  })

  it('relevé qui échoue : un avertissement le dit (cause comprise), la page est rendue et sa graine garde ses sections', async () => {
    ;(chromium as any).launch = lancementAvecRelevePerdu(lancementOrigine.bind(chromium))
    const { root, config } = projet('graine-racine-echec')
    const renderer = await createBrowserRenderer(config, { configDir: root })
    try {
      const res = await renderer.renderPage('mjs-home', { settleMs: 5000, ssrMode: 'markers' })
      assert.match(res.html, /Bonjour/, 'la page est rendue quand même')
      const graine = graineDe(res.sharedScript + res.html)
      assert.equal(graine.root, undefined, 'la graine sort sans les textes racine')
      assert.deepEqual(graine.sections, { fr: { accueil: { salut: 'Bonjour' } } })
      const avertis = res.warnings.filter((w: string) => /clés racine/.test(w))
      assert.equal(avertis.length, 1, `un seul avertissement : ${JSON.stringify(res.warnings)}`)
      assert.match(avertis[0], /<mjs-home>/)
      assert.match(avertis[0], /relevé refusé par le test/, 'la cause est dite')
      assert.match(avertis[0], /fichier de langue/, 'la conséquence est dite')
    }
    finally { await renderer.close() }
  })
})
