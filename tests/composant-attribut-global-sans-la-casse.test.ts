// un attribut global calculé sur la balise d'un composant (`tabindex={…}`) et la prop que ce composant déclare se reconnaissent sans tenir compte
// de la casse, comme les attributs HTML : `tabIndex={$t}` vise une prop `$tabindex` déclarée, `tabindex={$t}` une prop `$tabIndex`. Le composant la
// garde alors pour lui : aucun attribut sur sa balise, et la prop suit sa variable (`null` compris), à la racine comme dans un {for}. Sans prop de ce
// nom, l'attribut se pose sur la balise, quelle que soit la casse écrite

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
  '  $t     = 0',
  "  $liste = [{ key: 'k' }]",
  '</script>',
  '<@tab-bas data-t="a" tabIndex={$t}></@tab-bas>',
  '<@tab-haut data-t="b" tabindex={$t}></@tab-haut>',
  '<@tab-rien data-t="c" tabIndex={$t}></@tab-rien>',
  '{for x in $liste by key}<@tab-bas data-t="d" tabIndex={$t}></@tab-bas><@tab-haut data-t="e" TABINDEX={$t}></@tab-haut>{end}',
].join('\n')

const BAS  = '<script>\n  $tabindex = 5\n</script>\n<p class="v">{$tabindex}</p>\n'
const HAUT = '<script>\n  $tabIndex = 5\n</script>\n<p class="v">{$tabIndex}</p>\n'
const RIEN = '<p class="v">rien</p>\n'

describe('attribut global calculé sur un composant : la prop déclarée se reconnaît sans la casse', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  // la prop que chaque balise déclare (`tab-bas` : `$tabindex`, `tab-haut` : `$tabIndex`) ; `tab-rien` n'en déclare aucune et reçoit le nom écrit
  const CLE: Record<string, string> = { a: 'tabindex', b: 'tabIndex', c: 'tabIndex', d: 'tabindex', e: 'tabIndex' }
  let hote: any
  const el = (t: string): any => hote._shadow.querySelector('[data-t="' + t + '"]')
  const vu = (t: string): string => {
    const n = el(t)
    if (!n) return t + ' (balise absente)'
    const k = CLE[t]
    return t + ' attribut=' + JSON.stringify(n.getAttribute('tabindex')) + ' ' + k + '=' + JSON.stringify(n._state[k])
  }

  before(async () => {
    const root   = mjsTmp('attribut-global-casse')
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
    await attendre(() => ['a', 'b', 'c', 'd', 'e'].every((t) => !!el(t)?._shadow?.querySelector('.v')), 'les cinq composants rendus')
  })

  it('une prop déclarée dans une autre casse reçoit la valeur, sans attribut sur la balise ; sans prop, l\'attribut se pose', () => {
    assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map(vu), [
      'a attribut=null tabindex=0',
      'b attribut=null tabIndex=0',
      'c attribut="0" tabIndex=0',
      'd attribut=null tabindex=0',
      'e attribut=null tabIndex=0',
    ])
  })

  it('la prop suit sa variable, `null` compris', async () => {
    hote._set('t', null)
    await attendre(() => el('c').getAttribute('tabindex') === null, 'l\'attribut de la balise sans prop retiré')
    assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map(vu), [
      'a attribut=null tabindex=null',
      'b attribut=null tabIndex=null',
      'c attribut=null tabIndex=null',
      'd attribut=null tabindex=null',
      'e attribut=null tabIndex=null',
    ])
    hote._set('t', 3)
    await attendre(() => el('c').getAttribute('tabindex') === '3', 'l\'attribut de la balise sans prop reposé')
    assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map(vu), [
      'a attribut=null tabindex=3',
      'b attribut=null tabIndex=3',
      'c attribut="3" tabIndex=3',
      'd attribut=null tabindex=3',
      'e attribut=null tabIndex=3',
    ])
  })
})
