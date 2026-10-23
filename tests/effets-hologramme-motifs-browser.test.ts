// les motifs des styles de carte de *hologram viennent du thème, d'aucune autre part : l'effet ne dessine rien et ne livre
// aucune image. Dans Chromium réel, pour chacun des vingt styles et chaque boîte du calque (le reflet, ses deux
// pseudo-éléments, l'éclat, le sien) : avec l'image du thème (`--mjs-hologram-pattern-<nom>`) la couche du motif est cette
// image ; sans image donnée elle est vide et les autres couches restent — le fond n'est jamais retombé à « aucune image ».

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

// le fichier de l'effet est lu tel quel et posé dans une page nue, avec le strict nécessaire pour qu'il se charge (le registre des effets)
const EFFET = new URL('../src/runtime/mjs_fx_hologram.ts', import.meta.url)

const STYLES = ['sheen', 'frame', 'curtain', 'night-sky', 'frost', 'lattice', 'opal', 'streaks', 'rays', 'rays-window', 'rays-cloud', 'rays-fade', 'rays-wide', 'haze', 'haze-deep', 'dust-dark', 'dust', 'glint', 'glint-dark', 'bloom']
const NOMS   = ['sparkles', 'grain', 'sky-far', 'sky-mid', 'sky-near', 'ripples', 'ripples-mask', 'waves', 'discs', 'maze', 'weave']
const PIXEL  = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

describe('motifs de *hologram : le thème seulement', function () {
  this.timeout(120000)

  it('le fichier de l\'effet ne dessine rien et ne livre aucune image', () => {
    const src = readFileSync(EFFET, 'utf-8')
    for (const reste of ['getContext', 'toBlob', 'createObjectURL', 'toDataURL', 'createElement(\'canvas\')', 'data:image', 'requestIdleCallback', 'blob:']) {
      assert.equal(src.includes(reste), false, reste + ' : plus aucun motif n\'est dessiné')
    }
    for (const nom of NOMS) assert.ok(src.includes(`--mjs-hologram-pattern-${nom}`) || src.includes(`tex('${nom}')`) || src.includes(`pat('${nom}')`), nom + ' : lu dans le thème')
  })

  describe('dans Chromium', function () {
    let present = false
    let browser: any = null
    let page: any    = null

    before(async function () {
      present = await chromiumPresent()
      if (!present) {
        console.log('  ℹ️  Chromium non installé, test des motifs sauté. Activer : `npx playwright install chromium`')
        return
      }
      const { chromium } = await import('playwright')
      browser = await chromium.launch({ args: ['--no-sandbox'] })
      page    = await browser.newPage()
      await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
      await page.addScriptTag({ content: 'var µ = { _mjs_fxDefs: {} };\n' + readFileSync(EFFET, 'utf-8') + '\nwindow.__css = µ._mjs_fxDefs.hologram.css;' })
      await page.evaluate((styles: string[]) => {
        const css = document.createElement('style')
        css.textContent = (window as any).__css
        document.head.appendChild(css)
        const site = document.createElement('div')
        site.id = 'site'
        site.innerHTML = styles.map((s) => `<span class="c" data-style="${s}" mjs-fx-layer="hologram" mjs-fx-hologram-card mjs-fx-hologram-style="${s}" mjs-fx-hologram-nu mjs-fx-hologram-open><b></b><i></i></span>`).join('')
        document.body.appendChild(site)
      }, STYLES)
    })

    after(async () => { if (browser) await browser.close() })

    // pour chaque style et chaque boîte : les couches du fond calculé (le fond découpé aux virgules de premier niveau)
    const couches = (donne: boolean) => page.evaluate(([noms, pixel, avec]: [string[], string, boolean]) => {
      const site = document.getElementById('site') as HTMLElement
      for (const n of noms) {
        if (avec) site.style.setProperty('--mjs-hologram-pattern-' + n, `url("${pixel}")`)
        else site.style.removeProperty('--mjs-hologram-pattern-' + n)
      }
      const decoupe = (v: string) => {
        const out: string[] = []
        let prof = 0
        let debut = 0
        for (let i = 0; i < v.length; i++) {
          if (v[i] === '(') prof++
          else if (v[i] === ')') prof--
          else if (v[i] === ',' && prof === 0) { out.push(v.slice(debut, i).trim()); debut = i + 1 }
        }
        out.push(v.slice(debut).trim())
        return out
      }
      const res: Record<string, string[]> = {}
      for (const c of Array.from(document.querySelectorAll('#site .c')) as HTMLElement[]) {
        for (const [base, pseudo] of [['i', ''], ['i', '::before'], ['i', '::after'], ['b', ''], ['b', '::after']]) {
          res[c.dataset.style + ' ' + base + pseudo] = decoupe(getComputedStyle(c.querySelector(base) as Element, pseudo || null).backgroundImage)
        }
      }
      return res
    }, [NOMS, PIXEL, donne])

    it('sans image donnée, la couche du motif est vide et les autres restent ; avec l\'image du thème, elle est cette image', async function () {
      if (!present) { this.skip(); return }
      const avec = await couches(true)
      const sans = await couches(false)
      let images = 0
      for (const cle of Object.keys(avec)) {
        assert.equal(sans[cle].length, avec[cle].length, cle + ' : le nombre de couches ne change pas sans image')
        avec[cle].forEach((couche, k) => {
          if (couche.startsWith('url(')) {
            images++
            assert.equal(sans[cle][k], 'none', cle + ' couche ' + k + ' : sans image donnée, la couche est vide')
          }
          else assert.equal(sans[cle][k], couche, cle + ' couche ' + k + ' : les autres couches ne bougent pas')
        })
      }
      assert.ok(images >= 30, 'le test voit les couches des motifs : ' + images)
    })

    it('night-sky : le plan lointain du ciel est l\'image du thème, ou rien', async function () {
      if (!present) { this.skip(); return }
      const avec = await couches(true)
      const sans = await couches(false)
      assert.ok(avec['night-sky i'][0].startsWith('url('), avec['night-sky i'][0].slice(0, 40))
      assert.equal(sans['night-sky i'][0], 'none')
      assert.ok(sans['night-sky i'].slice(1).every((c: string) => c.includes('gradient')), 'les dégradés du ciel tiennent sans image : ' + sans['night-sky i'].map((c: string) => c.slice(0, 24)).join(' | '))
    })

    it('shine : bright est l\'éclat de base, calm et shade changent l\'éclat de rays, calm celui d\'opal, une valeur inconnue du style ne change rien', async function () {
      if (!present) { this.skip(); return }
      const lu = await page.evaluate(() => {
        const site = document.getElementById('site') as HTMLElement
        const poser = (style: string, shine: string, nu: boolean) => {
          const c = document.createElement('span')
          c.setAttribute('mjs-fx-layer', 'hologram')
          c.setAttribute('mjs-fx-hologram-card', '')
          c.setAttribute('mjs-fx-hologram-style', style)
          if (shine) c.setAttribute('mjs-fx-hologram-shine', shine)
          if (nu) c.setAttribute('mjs-fx-hologram-nu', '')
          c.innerHTML = '<b></b><i></i>'
          site.appendChild(c)
          const dire = (el: Element, pseudo: string | null) => { const cs = getComputedStyle(el, pseudo); return [cs.backgroundImage, cs.backgroundSize, cs.backgroundPosition, cs.filter, cs.mixBlendMode, cs.opacity, cs.content].join(' ; ') }
          const r = { b: dire(c.querySelector('b')!, null), ia: dire(c.querySelector('i')!, '::after'), ib: dire(c.querySelector('i')!, '::before') }
          c.remove()
          return r
        }
        return {
          raysBase: poser('rays', '', false), raysBright: poser('rays', 'bright', false), raysCalm: poser('rays', 'calm', false), raysShade: poser('rays', 'shade', false),
          raysNuBase: poser('rays', '', true), raysNuShade: poser('rays', 'shade', true), raysNuCalm: poser('rays', 'calm', true),
          opalBase: poser('opal', '', false), opalCalm: poser('opal', 'calm', false), opalShade: poser('opal', 'shade', false),
          glintBase: poser('glint', '', false), glintCalm: poser('glint', 'calm', false)
        }
      })
      assert.deepEqual(lu.raysBright, lu.raysBase, 'bright est la base')
      assert.notEqual(lu.raysCalm.b, lu.raysBase.b, 'rays calm : un autre éclat')
      assert.match(lu.raysCalm.b, /brightness\(0\.9\) contrast\(1\.75\)/)
      assert.match(lu.raysCalm.ib, /none$/, 'rays calm : pas de halo')
      assert.ok(!/none$/.test(lu.raysBase.ib), 'rays : un halo de base')
      assert.notEqual(lu.raysShade.b, lu.raysBase.b, 'rays shade : un autre éclat')
      assert.match(lu.raysShade.b, /darken/, 'rays shade : assombrit les bords')
      assert.ok(!/none$/.test(lu.raysShade.ib), 'rays shade : garde le halo')
      assert.notEqual(lu.raysNuShade.ia, lu.raysNuBase.ia, 'sans image, shade change aussi la seconde couche de rayons')
      assert.equal(lu.raysNuCalm.ia, lu.raysNuBase.ia)
      assert.notEqual(lu.opalCalm.b, lu.opalBase.b, 'opal calm : un autre éclat')
      assert.match(lu.opalCalm.b, /brightness\(0\.8\) contrast\(1\.5\)/)
      assert.deepEqual(lu.opalShade, lu.opalBase, 'opal ne connaît pas shade : son éclat de base')
      assert.deepEqual(lu.glintCalm, lu.glintBase, 'glint ne connaît aucun éclat à part')
    })
  })
})
