// un attribut global écrit EN CLAIR sur la balise d'un composant (`tabIndex="-1"`) va à la prop que ce composant déclare, quelle que soit la casse de
// l'une et de l'autre, comme les attributs HTML : le HTML pose l'attribut (`tabindex="-1"`, son nom en minuscules) sur la balise, et la prop `$tabIndex`
// comme la prop `$tabindex` reçoit sa valeur, à la racine comme dans un {for}, puis le suit quand la page le change. Aucun autre attribut n'apparaît sur
// la balise. Sans prop de ce nom, l'attribut reste sur la balise et aucune prop ne naît

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string): string => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

// une condition relue toutes les 10 ms, 5 s au plus (jamais une durée fixe)
const attendre = async (vrai: () => boolean, quoi: string): Promise<void> => {
  for (let i = 0; i < 500; i++) {
    if (vrai()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('jamais vu : ' + quoi)
}

const HOTE = [
  '<script>',
  "  $liste = [{ key: 'k' }]",
  '</script>',
  '<@tab-haut data-t="a" tabIndex="0"></@tab-haut>',
  '<@tab-bas data-t="b" tabIndex="-1"></@tab-bas>',
  '<@tab-haut data-t="c" TABINDEX="-2"></@tab-haut>',
  '<@tab-rien data-t="d" tabIndex="-3"></@tab-rien>',
  '{for x in $liste by key}<@tab-haut data-t="e" tabIndex="-4"></@tab-haut><@tab-bas data-t="f" tabindex="-5"></@tab-bas>{end}',
].join('\n')

const BAS  = '<script>\n  $tabindex = 1\n</script>\n<p class="v">{$tabindex}</p>\n'
const HAUT = '<script>\n  $tabIndex = 1\n</script>\n<p class="v">{$tabIndex}</p>\n'
const RIEN = '<p class="v">rien</p>\n'

describe('attribut global écrit en clair sur un composant : la prop déclarée le reçoit sans la casse', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  // la prop que chaque balise déclare (`tab-haut` : `$tabIndex`, `tab-bas` : `$tabindex`) ; `tab-rien` n'en déclare aucune
  const CLE: Record<string, string> = { a: 'tabIndex', b: 'tabindex', c: 'tabIndex', d: 'tabIndex', e: 'tabIndex', f: 'tabindex' }
  const TOUTES = ['a', 'b', 'c', 'd', 'e', 'f']
  let hote: any
  const el = (t: string): any => hote._shadow.querySelector('[data-t="' + t + '"]')
  const vu = (t: string): string => {
    const n = el(t)
    if (!n) return t + ' (balise absente)'
    const k = CLE[t]
    return t + ' attribut=' + JSON.stringify(n.getAttribute('tabindex')) + ' ' + k + '=' + JSON.stringify(n._state[k]) + ' affiché=' + JSON.stringify(n._shadow.querySelector('.v').textContent)
  }

  before(async () => {
    const root   = mjsTmp('attribut-global-en-clair-casse')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
    writeFileSync(join(srcDir, 'tab-bas.mjs'), BAS)
    writeFileSync(join(srcDir, 'tab-haut.mjs'), HAUT)
    writeFileSync(join(srcDir, 'tab-rien.mjs'), RIEN)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code   = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.insertAdjacentHTML('beforeend', '<mjs-hote></mjs-hote>')
    hote = window.document.body.querySelector('mjs-hote')
    await attendre(() => TOUTES.every((t) => !!el(t)?._shadow?.querySelector('.v')), 'les six composants rendus')
  })

  it('la prop déclarée reçoit la valeur, quelle que soit la casse écrite ; l\'attribut reste sur la balise, sans prop là où rien ne la déclare', () => {
    assert.deepEqual(TOUTES.map(vu), [
      'a attribut="0" tabIndex="0" affiché="0"',
      'b attribut="-1" tabindex="-1" affiché="-1"',
      'c attribut="-2" tabIndex="-2" affiché="-2"',
      'd attribut="-3" tabIndex=undefined affiché="rien"',
      'e attribut="-4" tabIndex="-4" affiché="-4"',
      'f attribut="-5" tabindex="-5" affiché="-5"',
    ])
    assert.equal(el('d')._state.tabindex, undefined, 'aucune prop ne naît sur un composant qui ne la déclare pas')
  })

  it('aucun autre attribut sur la balise que ceux que la page écrit', () => {
    for (const t of TOUTES) {
      const noms = Array.from(el(t).attributes as ArrayLike<{ name: string }>).map((a) => a.name).filter((n) => !n.startsWith('mjs-')).sort()
      assert.deepEqual(noms, ['data-t', 'tabindex'], t)
    }
  })

  it('la prop suit l\'attribut quand la page le change', async () => {
    el('a').setAttribute('tabindex', '-6')
    el('e').setAttribute('tabindex', '-7')
    await attendre(() => el('a')._shadow.querySelector('.v').textContent === '-6' && el('e')._shadow.querySelector('.v').textContent === '-7', 'la prop qui suit l\'attribut changé')
    assert.deepEqual(['a', 'e'].map(vu), ['a attribut="-6" tabIndex="-6" affiché="-6"', 'e attribut="-7" tabIndex="-7" affiché="-7"'])
  })
})
