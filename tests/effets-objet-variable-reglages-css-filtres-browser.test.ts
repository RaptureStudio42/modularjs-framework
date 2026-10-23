// Un effet donné avec ses réglages par une variable (`$effet = { fx: 'gradient', s: { colors: [...] } }`, le `fx` de *delta, de *guard,
// de *offline) peut venir d'une donnée de l'utilisateur : dans Chromium réel, aucun de ses réglages ne fait charger une adresse, quelle
// que soit la voie qui le mène au CSS — une variable CSS de l'effet, un style posé par son code (les `colors` de *gradient, de *mesh, de
// *hologram, sa découpe `zone`…), une feuille. Chaque réglage de chaque effet reçoit une valeur qui sort de sa fonction CSS pour charger
// `url(http://evil.test/…)` : aucune requête ne part, et chaque effet qui se joue une fois est bien joué ; un effet continu (`*filter`, `*neon`,
// `*delta` et l'effet qu'il porte) ne se nomme pas, comme écrit en clair : il est écarté. Un texte de la page (les `chars` de *scramble) passe
// tel quel, parenthèse comprise.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { EFFECTS } from '../src/effects/catalog.js'

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

// les effets joués par *delta : ceux que le constat cite, et d'autres qui écrivent des couleurs, des images ou des listes dans le CSS
// un effet qui ne se joue pas une fois : écarté, jamais joué
const ECARTES = ['filter', 'neon']
const JOUES = ['gradient', 'mesh', 'hologram', 'shine', 'glitch', 'rainbow', 'pulse', 'beam', 'crt', 'flash', 'annotate', 'unveil', 'wave', 'sparkles', 'confetti', 'scramble']

const SOURCE = [
  '<script>',
  '$v = 1',
  "$f = 'none'",
  '</script>',
  '<span id="d" *delta(fx: $f)>{$v}</span>',
  '<div id="reserve">',
  ...JOUES.map((n) => '  <span *' + n + '>' + n + '</span>'),
  '</div>',
  '<style>',
  '#d',
  '  display: inline-block',
  '  width: 200px',
  '  height: 60px',
  '</style>',
  ''
].join('\n')

// une valeur qui ferme la fonction CSS où l'effet la pose pour en ouvrir une qui charge une adresse
const MAL = (cle: string) => 'red) , url(http://evil.test/' + cle + '.png), linear-gradient(red'

// tous les réglages de l'effet (sauf `on`, que l'effet imbriqué ne prend pas, et `fx`) : une liste pour une liste de couleurs, un texte sinon
function charge(nom: string): Record<string, unknown> {
  const s: Record<string, unknown> = {}
  for (const [cle, reglage] of Object.entries(EFFECTS[nom].settings)) {
    if (cle === 'on' || cle === 'fx') continue
    s[cle] = reglage.rule === 'colors' || reglage.rule === 'words' || reglage.rule === 'images' ? ['red', MAL(nom + '-' + cle)] : MAL(nom + '-' + cle)
  }
  return s
}

let compilation: Promise<string> | null = null
function compile(): Promise<string> {
  compilation ??= (async () => {
    const root   = mjsTmp('effets-objet-variable-css')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-objet.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })()
  return compilation
}

describe('effet imbriqué donné en objet par une variable : aucune adresse chargée (Chromium réel)', function () {
  this.timeout(300000)
  let present = false
  let script  = ''
  let browser: any = null

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium indisponible, tests sautés')
      return
    }
    script = await compile()
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  async function ouvre() {
    const contexte = await browser.newContext({ viewport: { width: 900, height: 700 } })
    const page     = await contexte.newPage()
    const erreurs: string[] = []
    const requetes: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    await page.route('http://evil.test/**', (route: any) => {
      requetes.push(route.request().url())
      return route.fulfill({ status: 404, body: '' })
    })
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-fx-objet></mjs-fx-objet><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-fx-objet') as any)?._shadow?.querySelector('#d [mjs-fx-delta-val]'))
    return { contexte, page, erreurs, requetes }
  }

  it('chaque réglage de chaque effet joué, mal formé exprès : aucune requête, et chaque effet est bien joué', async function () {
    if (!present) return this.skip()
    const { contexte, page, erreurs, requetes } = await ouvre()
    const charges = Object.fromEntries([...JOUES, ...ECARTES].map((n) => [n, charge(n)]))
    const vu = await page.evaluate(async (args: { joues: string[], charges: Record<string, any> }) => {
      const w: any = window
      const hote: any = document.querySelector('mjs-fx-objet')
      const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
      const joue: Record<string, boolean> = {}
      let v = 1
      for (const nom of args.joues) {
        w.µ._set(hote, 'f', { fx: nom, s: args.charges[nom] })
        await pause(40)
        w.µ._set(hote, 'v', ++v)
        await pause(250)
        const val = hote._shadow.querySelector('#d [mjs-fx-delta-val]')
        joue[nom] = !!(val && val._mjs_fxOff && val._mjs_fxOff[nom])
      }
      // un texte de la page passe tel quel ; *delta, qui ne se joue pas une fois, est écarté avec l'effet qu'il porte
      w.µ._set(hote, 'f', { fx: 'scramble', s: { chars: 'a) url(http://evil.test/texte.png' } })
      await pause(40)
      w.µ._set(hote, 'v', ++v)
      await pause(200)
      const val = hote._shadow.querySelector('#d [mjs-fx-delta-val]')
      const chars = val && val._mjs_fxOff && val._mjs_fxOff.scramble ? val._mjs_fxOff.scramble._s.chars : null
      w.µ._set(hote, 'f', { fx: 'delta', s: { fx: { fx: 'gradient', s: { colors: ['red', 'blue) , url(http://evil.test/double.png), linear-gradient(red'] } } } })
      await pause(40)
      w.µ._set(hote, 'v', ++v)
      await pause(200)
      const val2 = hote._shadow.querySelector('#d [mjs-fx-delta-val]')
      const dedans = val2 && val2._mjs_fxOff && val2._mjs_fxOff.delta ? val2._mjs_fxOff.delta._s.fx : null
      return { joue, chars, double: dedans ? { fx: dedans.fx, marque: dedans.byVar === true } : null }
    }, { joues: [...JOUES, ...ECARTES], charges })
    await page.waitForTimeout(800)
    await contexte.close()
    assert.deepEqual(requetes, [], requetes.length + ' requête(s) vers evil.test')
    assert.deepEqual(JOUES.filter((n) => !vu.joue[n]), [], 'des effets n\'ont pas été joués : ' + JSON.stringify(vu.joue))
    assert.equal(vu.chars, 'a) url(http://evil.test/texte.png', 'le texte de la page passe tel quel')
    assert.deepEqual(ECARTES.filter((n) => vu.joue[n]), [], 'un effet qui ne se joue pas une fois est écarté : ' + JSON.stringify(vu.joue))
    assert.equal(vu.double, null, '*delta ne se joue pas une fois : écarté, l\'effet qu\'il porte avec lui')
    assert.deepEqual(erreurs, [])
  })
})
