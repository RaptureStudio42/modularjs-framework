// Libellés par défaut des modules cœur (<@@nom>) : la langue de la page choisit entre le français
// et l'anglais, un libellé donné par l'auteur l'emporte toujours. Vérifié par compilation réelle
// (Bundler + Window happy-dom), une fenêtre par langue : <html lang="en">, <html lang="fr"> et
// une page sans langue (français).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { existsSync } from 'node:fs'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'

const HOST = `<div id="carousel"><@@carousel><div>un</div><div>deux</div></@@carousel></div>
<div id="code"><@@code><pre><code>x = 1</code></pre></@@code></div>
<div id="code-auteur"><@@code label="Copiez" copied-label="Fait"><pre><code>y = 2</code></pre></@@code></div>
<div id="vide"><@@code label="" copied-label=""><pre><code>z</code></pre></@@code><@@number label="" less-label="" more-label=""></@@number><@@select name="v" placeholder=""><@@option value="a">Alpha</@@option></@@select><@@progress label=""></@@progress></div>
<div id="select"><@@select name="s" search><@@option value="a">Alpha</@@option></@@select></div>
<div id="select-auteur"><@@select name="t" search placeholder="Pays" search-placeholder="Cherchez" empty-label="Rien"><@@option value="a">Alpha</@@option></@@select></div>
<div id="number"><@@number big></@@number></div>
<div id="number-auteur"><@@number big label="Quantité" less-label="Retirer" more-label="Ajouter" big-less-label="Retirer dix" big-more-label="Ajouter dix"></@@number></div>
<div id="gauge"><@@gauge></@@gauge></div>
<div id="knob"><@@knob></@@knob></div>
<div id="progress"><@@progress></@@progress></div>
<div id="color"><@@color value="rgb(59, 130, 246)" editable></@@color></div>
<div id="menu"><@@menu><div>x</div></@@menu></div>
<div id="clock"><@@clock></@@clock></div>
<button id="bascule" @click={µlang = 'en'}>en</button>
<div id="clock-auteur"><@@clock labels="H, M, S"></@@clock></div>
`

const ATTENDU = {
  fr: {
    carouselPrev: 'Précédent', carouselNext: 'Suivant', codeCopy: 'Copier le code', codeCopied: 'Copié !',
    selectPlaceholder: 'Choisir…', selectSearch: 'Rechercher…', selectEmpty: 'Aucun résultat',
    numberLabel: 'Nombre', numberLess: 'Moins', numberMore: 'Plus', numberBigLess: 'Diminuer de 10', numberBigMore: 'Augmenter de 10',
    gaugeLabel: 'Nombre', knobLabel: 'Valeur', progressLabel: 'Progression', colorLabel: 'Couleur', menuLabel: 'Menu',
    clock: 'Heures,Minutes,Secondes',
  },
  en: {
    carouselPrev: 'Previous', carouselNext: 'Next', codeCopy: 'Copy code', codeCopied: 'Copied!',
    selectPlaceholder: 'Choose…', selectSearch: 'Search…', selectEmpty: 'No results',
    numberLabel: 'Number', numberLess: 'Less', numberMore: 'More', numberBigLess: 'Decrease by 10', numberBigMore: 'Increase by 10',
    gaugeLabel: 'Number', knobLabel: 'Value', progressLabel: 'Progress', colorLabel: 'Color', menuLabel: 'Menu',
    clock: 'Hours,Minutes,Seconds',
  },
}

describe('libellés des modules cœur — table fr/en', () => {
  it('le groupe core existe dans les deux langues, mêmes clés', () => {
    const fr = Object.keys((RUNTIME_LABELS.fr as any).core ?? {}).sort()
    const en = Object.keys((RUNTIME_LABELS.en as any).core ?? {}).sort()
    assert.equal(fr.length, 102)
    assert.deepEqual(en, fr)
  })
})

describe('libellés des modules cœur — langue de la page (happy-dom, bundler réel)', function () {
  this.timeout(90000)

  const fenetres: any[] = []
  let outDir = ''
  let sources: string[] = []
  let libelles = ''

  const stripEsm = (s: string) => s
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/\bexport\s+default\s+/g, '')
    .replace(/\bexport\s+/g, '')
    .replace(/import\.meta\.url/g, "'http://localhost/'")

  async function tick(ms = 60) {
    await new Promise((r) => setTimeout(r, ms))
  }

  async function monter(lang: string): Promise<any> {
    const window: any = new Window({ url: 'http://localhost/' })
    if (lang) window.document.documentElement.setAttribute('lang', lang)
    fenetres.push(window)
    window.eval(`${sources.join('\n')}\nglobalThis.µ = µ;`)
    window.eval(libelles)
    window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
    await tick(150)
    const hote = window.document.body.firstElementChild
    assert.ok(hote._shadow, 'hôte monté')
    return { window, hote }
  }

  const mod = (hote: any, id: string, tag: string) => hote._shadow.querySelector(`#${id} ${tag}`)
  const dans = (hote: any, id: string, tag: string, sel: string) => mod(hote, id, tag)._shadow.querySelector(sel)

  before(async function () {
    const root = mjsTmp('core-libelles-langue')
    const srcDir = join(root, 'src')
    outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOST)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f: string) => f.endsWith('.js'))
    const ordre = (f: string) => /^mjs_core-/.test(f) ? 0 : /^hote-/.test(f) ? 2 : 1
    files.sort((a: string, b: string) => ordre(a) - ordre(b))
    // les lignes que le manifeste pose pour tous les builds (libellés fr/en + langue de repli)
    libelles = libellesDuManifeste(join(root, 'bundle.js'))
    sources = [...files.map((f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8')))]
  })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  for (const lang of ['en', 'fr', '']) {
    const t = lang === 'en' ? ATTENDU.en : ATTENDU.fr
    describe(`page ${lang ? `lang="${lang}"` : 'sans langue'}`, () => {
      let hote: any

      before(async () => {
        hote = (await monter(lang)).hote
      })

      it('carrousel : boutons précédent et suivant', () => {
        assert.equal(dans(hote, 'carousel', 'mjs-core-carousel', 'button.prev').getAttribute('aria-label'), t.carouselPrev)
        assert.equal(dans(hote, 'carousel', 'mjs-core-carousel', 'button.next').getAttribute('aria-label'), t.carouselNext)
      })

      it('code : bouton copier, puis copié', async () => {
        const b = dans(hote, 'code', 'mjs-core-code', 'button.copy')
        assert.equal(b.getAttribute('aria-label'), t.codeCopy)
        assert.equal(b.getAttribute('title'), t.codeCopy)
        const w = hote.ownerDocument.defaultView
        w.navigator.clipboard.writeText = () => Promise.resolve()
        b.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
        await tick()
        assert.equal(b.getAttribute('aria-label'), t.codeCopied)
      })

      it('sélecteur : texte d\'attente, recherche, aucun résultat', async () => {
        const btn = dans(hote, 'select', 'mjs-core-select', 'button.select-btn')
        assert.ok(btn.textContent.includes(t.selectPlaceholder), `attente : ${btn.textContent}`)
        const w = hote.ownerDocument.defaultView
        btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
        await tick()
        const champ = dans(hote, 'select', 'mjs-core-select', 'input.select-search')
        assert.equal(champ.getAttribute('placeholder'), t.selectSearch)
        assert.equal(champ.getAttribute('aria-label'), t.selectSearch)
        champ.value = 'zzz'
        champ.dispatchEvent(new w.Event('input', { bubbles: true }))
        await tick()
        assert.equal(dans(hote, 'select', 'mjs-core-select', '.select-empty').textContent.trim(), t.selectEmpty)
      })

      it('nombre : groupe, moins, plus, grands pas', () => {
        const m = mod(hote, 'number', 'mjs-core-number')._shadow
        assert.equal(m.querySelector('[role="group"]').getAttribute('aria-label'), t.numberLabel)
        assert.equal(m.querySelector('.step.less:not(.big)').getAttribute('aria-label'), t.numberLess)
        assert.equal(m.querySelector('.step.more:not(.big)').getAttribute('aria-label'), t.numberMore)
        assert.equal(m.querySelector('.step.less.big').getAttribute('aria-label'), t.numberBigLess)
        assert.equal(m.querySelector('.step.more.big').getAttribute('aria-label'), t.numberBigMore)
      })

      it('jauge, bouton rotatif, progression, couleur, menu', () => {
        assert.equal(dans(hote, 'gauge', 'mjs-core-gauge', '[role="spinbutton"]').getAttribute('aria-label'), t.gaugeLabel)
        assert.equal(dans(hote, 'knob', 'mjs-core-knob', '[role="slider"]').getAttribute('aria-label'), t.knobLabel)
        assert.equal(dans(hote, 'progress', 'mjs-core-progress', '[role="progressbar"]').getAttribute('aria-label'), t.progressLabel)
        assert.equal(dans(hote, 'color', 'mjs-core-color', 'input[type="color"]').getAttribute('aria-label'), t.colorLabel)
        assert.equal(dans(hote, 'menu', 'mjs-core-menu', 'button[part="toggle"]').getAttribute('aria-label'), t.menuLabel)
      })

      it('horloge : noms des trois cadrans', () => {
        const noms = Array.from(mod(hote, 'clock', 'mjs-core-clock')._shadow.querySelectorAll('h2 span')).map((s: any) => s.textContent.trim())
        assert.equal(noms.join(','), t.clock)
      })

      it('un libellé écrit vide par l\'auteur reste vide : aucun texte par défaut ne le remplace', () => {
        assert.equal(dans(hote, 'vide', 'mjs-core-code', 'button.copy').getAttribute('aria-label') ?? '', '')
        const n = dans(hote, 'vide', 'mjs-core-number', '[role="group"]')
        assert.equal(n.getAttribute('aria-label') ?? '', '')
        assert.equal(dans(hote, 'vide', 'mjs-core-number', '.step.less:not(.big)').getAttribute('aria-label') ?? '', '')
        assert.equal(dans(hote, 'vide', 'mjs-core-select', 'button.select-btn').textContent.trim(), '')
        assert.equal(dans(hote, 'vide', 'mjs-core-progress', '[role="progressbar"]').getAttribute('aria-label') ?? '', '')
      })

      it('un libellé donné par l\'auteur l\'emporte, dans toutes les langues', () => {
        const c = dans(hote, 'code-auteur', 'mjs-core-code', 'button.copy')
        assert.equal(c.getAttribute('aria-label'), 'Copiez')
        const n = mod(hote, 'number-auteur', 'mjs-core-number')._shadow
        assert.equal(n.querySelector('[role="group"]').getAttribute('aria-label'), 'Quantité')
        assert.equal(n.querySelector('.step.less:not(.big)').getAttribute('aria-label'), 'Retirer')
        assert.equal(n.querySelector('.step.more:not(.big)').getAttribute('aria-label'), 'Ajouter')
        assert.equal(n.querySelector('.step.less.big').getAttribute('aria-label'), 'Retirer dix')
        assert.equal(n.querySelector('.step.more.big').getAttribute('aria-label'), 'Ajouter dix')
        const noms = Array.from(mod(hote, 'clock-auteur', 'mjs-core-clock')._shadow.querySelectorAll('h2 span')).map((s: any) => s.textContent.trim())
        assert.equal(noms.join(','), 'H,M,S')
        const sel = dans(hote, 'select-auteur', 'mjs-core-select', 'button.select-btn')
        assert.ok(sel.textContent.includes('Pays'))
      })
    })
  }

  describe('bascule de langue en cours de route', () => {
    it('µlang change les libellés par défaut sans remonter les modules ; celui de l\'auteur reste', async () => {
      const { window, hote } = await monter('fr')
      const n = mod(hote, 'number', 'mjs-core-number')._shadow
      const code = dans(hote, 'code', 'mjs-core-code', 'button.copy')
      assert.equal(code.getAttribute('aria-label'), ATTENDU.fr.codeCopy)
      hote._shadow.querySelector('#bascule').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
      await tick(200)
      assert.equal(dans(hote, 'code', 'mjs-core-code', 'button.copy').getAttribute('aria-label'), ATTENDU.en.codeCopy)
      assert.equal(n.querySelector('.step.less:not(.big)').getAttribute('aria-label'), ATTENDU.en.numberLess)
      assert.equal(n.querySelector('.step.less.big').getAttribute('aria-label'), ATTENDU.en.numberBigLess)
      assert.equal(dans(hote, 'code-auteur', 'mjs-core-code', 'button.copy').getAttribute('aria-label'), 'Copiez')
    })
  })
})

// page réelle : le vrai bundle.js chargé comme module dans Chromium, sans aucun montage à la main.
// Prouve que le manifeste pose les libellés AVANT le premier rendu d'un module cœur.
describe('libellés des modules cœur — page réelle (Chromium, bundle.js chargé par le navigateur)', function () {
  this.timeout(90000)

  let browser: any = null
  let present = false
  let racine = ''

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) return
    const root = mjsTmp('core-libelles-page-reelle')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), '<@@number big></@@number><@@select name="s"><@@option value="a">A</@@option></@@select><@@code><pre><code>x</code></pre></@@code>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    racine = root
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const lang of ['en', 'fr']) {
    it(`<html lang="${lang}"> : libellés par défaut présents dès le premier rendu`, async function () {
      if (!present) { this.skip(); return }
      const t = lang === 'en' ? ATTENDU.en : ATTENDU.fr
      const page = await browser.newPage()
      try {
        await page.route('http://t.test/**', async (route: any) => {
          const chemin = new URL(route.request().url()).pathname
          if (chemin === '/') {
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script type="module" src="/bundle.js"></script></body></html>` })
          }
          const fichier = join(racine, chemin)
          if (!existsSync(fichier)) return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/javascript', body: readFileSync(fichier, 'utf-8') })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('mjs-core-code')?._shadow?.querySelector('button.copy'))
        await page.waitForTimeout(200)
        const lus = await page.evaluate(() => {
          const h = (document.querySelector('mjs-hote') as any)._shadow
          const n = h.querySelector('mjs-core-number')._shadow
          return {
            copy: h.querySelector('mjs-core-code')._shadow.querySelector('button.copy').getAttribute('aria-label'),
            less: n.querySelector('.step.less:not(.big)').getAttribute('aria-label'),
            more: n.querySelector('.step.more:not(.big)').getAttribute('aria-label'),
            bigLess: n.querySelector('.step.less.big').getAttribute('aria-label'),
            attente: h.querySelector('mjs-core-select')._shadow.querySelector('button.select-btn').textContent.trim(),
          }
        })
        assert.equal(lus.copy, t.codeCopy)
        assert.equal(lus.less, t.numberLess)
        assert.equal(lus.more, t.numberMore)
        assert.equal(lus.bigLess, t.numberBigLess)
        assert.ok(lus.attente.includes(t.selectPlaceholder), `attente : ${lus.attente}`)
      } finally {
        await page.close()
      }
    })
  }
})
