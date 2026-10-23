// *count, *gauge, *delta : l'écriture et la lecture d'un nombre. Le signe suit la valeur ARRONDIE : -0,3 s'écrit « 0 », jamais
// « -0 » (ni « -00 » avec `pad`), et un décompte de -3 vers 0 ne montre jamais « -0 ». Le signe moins typographique (−, celui
// qu'écrit toLocaleString en suédois, en finnois, en norvégien…) se lit comme un tiret. Seul le premier nombre du texte compte
// (« 3/10 » vaut 3, « Étape 2 sur 5 » vaut 2), un nombre écrit avec ses séparateurs de milliers (« 12 480 », « 1,234 ») restant
// entier. Un réglage d'écriture de *count changé en direct (le suffixe) réécrit le nombre affiché sans recompter depuis `from`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// les sections de *count qu'il faut au test (les zéros de tête : `pad`) partent avec une page qui les écrit
const COMPOSANTS: Record<string, string> = {
  'nombre-zeros': '<b class="n" *count(on: load, pad: 2, suffix: \' €\')>12</b>',
  'nombre-jauge': '<b class="g" *gauge>42</b>'
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('*count, *gauge : le signe d\'un nombre arrondi, le signe moins typographique, le premier nombre du texte, un réglage changé en direct', function () {
  this.timeout(90000)
  let window: any
  let µ: any

  before(async () => {
    const root   = mjsTmp('effets-nombres-signe')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    µ = window.µ
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // les textes successifs du calque d'un *count posé sur `texte`, pendant `ms`
  async function textesVus(texte: string, reglages: any, ms: number): Promise<string[]> {
    const el = window.document.createElement('span')
    el.textContent = texte
    window.document.body.appendChild(el)
    const off = µ._mjs_fx(null, el, 'count', reglages)
    const vus: string[] = []
    const fin = Date.now() + ms
    while (Date.now() < fin) {
      const l = el.querySelector('[mjs-fx-layer="text"]')
      const t = l ? l.textContent : '?'
      if (vus[vus.length - 1] !== t) vus.push(t)
      await attendre(5)
    }
    off()
    el.remove()
    return vus
  }

  it('le signe suit la valeur arrondie : -0,3 s\'écrit « 0 », -0,04 « 0,0 », -1,2 « -1 »', () => {
    const num = µ._mjs_fxNum({})
    num.dec = 0
    assert.deepEqual([num.fmt(-0.3), num.fmt(-0.49), num.fmt(-1.2), num.fmt(-0)], ['0', '0', '-1', '0'])
    num.dec = 1
    assert.deepEqual([num.fmt(-0.04), num.fmt(-0.06)], ['0,0', '-0,1'])
  })

  it('un décompte de -3 vers 0 ne montre jamais « -0 », ni « -00 » avec pad: 2', async () => {
    const simple = await textesVus('0', { from: -3, duration: '400ms', on: 'load' }, 700)
    assert.ok(!simple.includes('-0'), 'textes vus : ' + JSON.stringify(simple))
    assert.equal(simple[simple.length - 1], '0')
    const zeros = await textesVus('0', { from: -3, duration: '400ms', on: 'load', pad: 2 }, 700)
    assert.ok(!zeros.includes('-00'), 'textes vus avec pad: 2 : ' + JSON.stringify(zeros))
    assert.equal(zeros[zeros.length - 1], '00')
  })

  it('le signe moins typographique se lit comme un tiret : « \u22121 234,5 » vaut -1234,5', () => {
    const num = µ._mjs_fxNum({})
    assert.deepEqual(['\u22121 234,5', '\u22125', '\ufe632', '\uff0d2', '-2 €'].map((t) => num.parse(t)), [-1234.5, -5, -2, -2, -2])
  })

  it('seul le premier nombre du texte compte : « 3/10 » vaut 3, « Étape 2 sur 5 » vaut 2, « 24/7 » vaut 24', () => {
    const num = µ._mjs_fxNum({})
    assert.deepEqual(['3/10', 'Étape 2 sur 5', '24/7', '2 sur 10,5'].map((t) => num.parse(t)), [3, 2, 24, 2])
    const en = µ._mjs_fxNum({ separator: ',', decimal: '.' })
    assert.deepEqual(['3/10', '24/7'].map((t) => en.parse(t)), [3, 24])
  })

  it('un nombre écrit avec ses séparateurs de milliers reste entier, comme avant', () => {
    const num = µ._mjs_fxNum({})
    assert.deepEqual(['12 480', '12\u202f480 €', '1 234 567', '1 234,5', '12480', '3.5', '12 480.5', '-2 €'].map((t) => num.parse(t)), [12480, 12480, 1234567, 1234.5, 12480, 3.5, 12480.5, -2])
    const en = µ._mjs_fxNum({ separator: ',', decimal: '.' })
    assert.deepEqual(['1,234', '1,234.5', '1,234,567'].map((t) => en.parse(t)), [1234, 1234.5, 1234567])
    const de = µ._mjs_fxNum({ separator: '.', decimal: ',' })
    assert.deepEqual(['12.480,5', '12480.5'].map((t) => de.parse(t)), [12480.5, 12480.5])
  })

  it('*gauge sur « 3/10 » lit 3, pas 310', () => {
    const el = window.document.createElement('b')
    el.textContent = '3/10'
    window.document.body.appendChild(el)
    const off = µ._mjs_fx(null, el, 'gauge', {})
    const part = el.querySelector('[mjs-fx-layer]')?.style.getPropertyValue('--mjs-fx-gauge-p') || el.style.getPropertyValue('--mjs-fx-gauge-p')
    off()
    el.remove()
    assert.equal(parseFloat(part), 0.03)
  })

  it('*count : un suffixe changé en plein décompte réécrit le nombre affiché, sans repartir de 0', async () => {
    const el = window.document.createElement('span')
    el.textContent = '1000'
    window.document.body.appendChild(el)
    const off = µ._mjs_fx(null, el, 'count', { suffix: ' €', duration: '900ms', on: 'load' })
    const calque = () => el.querySelector('[mjs-fx-layer="text"]')
    const valeur = () => parseFloat(calque().textContent.replace(/\D/g, ''))
    await attendre(450)
    const avant = valeur()
    µ._mjs_fxSet(el, 'count', { suffix: ' $' })
    const juste = calque().textContent
    const apres = valeur()
    await attendre(1200)
    const fin = calque().textContent.replace(/\s/g, ' ')
    off()
    el.remove()
    assert.ok(avant > 100, 'avant le changement : ' + avant)
    assert.ok(/ \$$/.test(juste), 'juste après le changement : ' + JSON.stringify(juste))
    assert.ok(apres >= avant, `le décompte est reparti : ${avant} avant, ${apres} juste après`)
    assert.equal(fin, '1 000 $')
  })
})
