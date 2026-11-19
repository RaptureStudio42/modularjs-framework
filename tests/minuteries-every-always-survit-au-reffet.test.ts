// `always: true` vaut aussi pour `µevery` : posé pendant un passage d'un `µeffect`, il n'appartient pas à ce passage — le passage
// suivant ne l'arrête pas, la répétition garde sa cadence ; il s'arrête pour de bon à la destruction du composant (son `onStop`
// part une fois) et ne repart pas si le composant revient : le passage rejoué au retour en pose un autre. Aucun avertissement
// d'option inconnue.
// Montage RÉEL (happy-dom).

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

const attendre = (ms: number) => new Promise(r => setTimeout(r, ms))

// compile un composant et le monte dans happy-dom ; les avertissements de la console sont recueillis
async function monter(nom: string, source: string) {
  const root   = mjsTmp('minuteries-every-always')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, nom + '.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const win: any       = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  win.console.warn     = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
  const files = readdirSync(outDir)
  const lire  = (re: RegExp) => stripEsm(readFileSync(join(outDir, files.find((f: string) => re.test(f))!), 'utf-8'))
  win.eval(`${lire(/^mjs_core-/)}\nglobalThis.µ = µ;\n${lire(new RegExp('^' + nom + '-'))}`)
  const el: any = win.document.createElement('mjs-' + nom)
  win.document.body.appendChild(el)
  return { win, el, avis }
}

// une horloge posée par le reffet quand il n'y en a pas : le passage suivant ne doit pas l'arrêter
const SOURCE = [
  '<p>{$partie}</p>',
  '<script>',
  '$partie = 0',
  'window.__changer = -> $partie++',
  'µeffect ->',
  '  $partie',
  '  unless window.__h',
  '    window.__h = µevery 20, always: true, onStop: (-> window.__fin = (window.__fin or 0) + 1), -> window.__t = (window.__t or 0) + 1',
  '  null',
  '</script>'
].join('\n')

describe('minuteries — µevery … always: true survit aux passages du reffet', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  it('les passages suivants ne l\'arrêtent pas ; la destruction du composant l\'arrête pour de bon', async () => {
    const { win, el, avis } = await monter('horloge', SOURCE)
    await attendre(70)
    assert.ok(win.__t >= 2, `l'horloge tourne (${win.__t} tirs)`)
    for (let k = 0; k < 3; k++) {
      win.__changer()
      await attendre(30)
    }
    assert.equal(el._state.partie, 3, 'le reffet a fait trois passages de plus')
    const t0 = win.__t
    await attendre(120)
    const pris = win.__t - t0
    assert.ok(pris >= 3 && pris <= 8, `après les passages, une seule horloge tourne encore (${pris} tirs en 120 ms)`)
    win.document.body.removeChild(el)
    await attendre(30)
    const fige = win.__t
    await attendre(100)
    assert.equal(win.__t, fige, 'composant détruit : l\'horloge s\'arrête')
    assert.equal(win.__fin, 1, 'son onStop part une fois')
    win.document.body.appendChild(el)
    await attendre(100)
    assert.equal(win.__t, fige, 'le composant revenu : elle ne repart pas')
    assert.deepEqual(avis.filter(a => /always|µevery/.test(a)), [], 'aucun avertissement')
  })
})
