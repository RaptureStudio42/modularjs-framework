// garde des boucles de rendu : un rendu programmé ordinaire (clic sur un bouton qui allonge une liste que rien d'autre ne lit) n'arme aucune minuterie (aucune tâche de plus après lui) ; la minuterie qui nomme la
// rafale n'est armée qu'après 100 rendus d'un même composant comptés sans elle. Une boucle réactive (un reffet qui réécrit sans fin la
// variable qu'il lit) est toujours coupée, avec le même avertissement, une fois ; des rendus faits en rafales séparées ne le déclenchent jamais

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const SOURCES: Record<string, string> = {
  'gardecompte.mjs': [
    '<script>',
    '$l = []',
    '@inc = -> $l = $l.concat([$l.length])',
    '</script>',
    '<button class="go" @click={@inc()}>+</button>',
    '<ul>{for v in $l}<li>{v}</li>{end}</ul>'
  ].join('\n'),
  'gardeboucle.mjs': [
    '<script>',
    '$x = 0',
    'µeffect ->',
    '  $x = Math.random()',
    '</script>',
    '<p class="x">{$x}</p>'
  ].join('\n')
}

// attentes faites par les minuteries de la page (non comptées) : la minuterie de fin de rafale, quand elle est armée, part avant elles
let arme: any = null
const pause = (ms = 0) => new Promise((r) => arme.call(null, r, ms))
const tic = async () => { await pause(); await pause() }

describe('garde des boucles de rendu — sans minuterie par rendu, boucle toujours coupée', function () {
  this.timeout(60000)
  let win: any
  let code = ''
  const avis: string[] = []
  let minuteries = 0

  before(async () => {
    const root = mjsTmp('garde-de-boucle')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.console.warn = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
    // chaque minuterie sans délai armée par la page, comptée
    arme = win.setTimeout.bind(win)
    win.setTimeout = function(fn: any, ms?: number, ...a: any[]) { if (!ms) minuteries++; return arme(fn, ms, ...a) }
    win.eval(`${code}\nglobalThis.µ = µ;`)
    await tic()
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const clic = (el: any) => (el._shadow || el.shadowRoot).querySelector('.go').click()
  const boucles = () => avis.filter((a) => /Boucle réactive|Reactive loop/.test(a))
  const monter = async (balise: string) => {
    const el = win.document.createElement(balise)
    win.document.body.appendChild(el)
    await tic()
    return el
  }

  it('un rendu ordinaire n\'arme aucune minuterie', async () => {
    const el = await monter('mjs-gardecompte')
    minuteries = 0
    clic(el)
    await tic()
    assert.equal((el._shadow || el.shadowRoot).querySelectorAll('li').length, 1)
    assert.equal(minuteries, 0, 'minuteries armées par un rendu : ' + minuteries)
  })

  it('250 rendus en rafales séparées : aucune boucle signalée, une minuterie toutes les 100 au plus', async () => {
    const el = win.document.querySelector('mjs-gardecompte')
    minuteries = 0
    for (let i = 0; i < 250; i++) {
      clic(el)
      await tic()
    }
    assert.equal((el._shadow || el.shadowRoot).querySelectorAll('li').length, 251)
    assert.ok(minuteries <= 3, 'minuteries armées : ' + minuteries)
    assert.deepEqual(boucles(), [])
  })

  it('un reffet qui réécrit sans fin la variable qu\'il lit : coupé, un avertissement, l\'écran suit l\'état', async () => {
    const el = await monter('mjs-gardeboucle')
    const fin = Date.now() + 10000
    while (!boucles().length && Date.now() < fin) await pause(50)
    await pause(300)
    assert.equal(boucles().length, 1, 'un avertissement')
    assert.match(boucles()[0], /plus de 10 000 rendus dans la même rafale/)
    assert.equal((el._shadow || el.shadowRoot).querySelector('.x').textContent, String(el._state.x), 'l\'écran suit la dernière valeur écrite')
    // la page reste vivante : une minuterie de la page part encore
    await pause(10)
  })
})
