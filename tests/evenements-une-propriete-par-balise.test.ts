// routage des événements : une balise qui porte un gestionnaire ne reçoit qu'UNE propriété JavaScript (comme le `__click` de Svelte),
// jamais de tableau ni d'attribut neuf ; ce que le compilateur sait d'avance (le composant, les identifiants du gabarit de la ligne) est
// préparé une fois par gabarit, partagé par toutes les lignes. Le routage reste le même : le gestionnaire de la balise la plus proche,
// `e.currentTarget`, l'élément de la ligne relu par son gestionnaire, `.once` par balise, une ligne retirée

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

const SOURCE = [
  '<script lang="js">',
  '  $rows = [{ id: 1, label: \'un\' }, { id: 2, label: \'deux\' }, { id: 3, label: \'trois\' }];',
  '  $sel = 0;',
  '  $vu = \'\';',
  '  $fois = 0;',
  '  @retirer = function(row) { $rows = $rows.filter((r) => r !== row); };',
  '</script>',
  '<button class="haut" @click={$vu = e.currentTarget.className}>haut</button>',
  '<table><tbody>',
  '  {for row in $rows by id}',
  '    <tr><td><a class="choisir" @click={$sel = row.id}>{row.label}</a></td><td><a class="retirer" @click={@retirer(row)}>x</a></td><td><b class="une" @click.once={$fois++}>1</b></td></tr>',
  '  {end}',
  '</tbody></table>'
].join('\n')

const tic = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }

describe('événements — une seule propriété par balise qui porte un gestionnaire', function () {
  this.timeout(60000)
  let win: any, el: any

  before(async () => {
    const root = mjsTmp('evenements-une-propriete')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'liens.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = '<mjs-liens></mjs-liens>'
    el = win.document.body.firstElementChild
    await tic()
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const racine = () => el._shadow || el.shadowRoot
  const tous = (sel: string) => Array.from(racine().querySelectorAll(sel)) as any[]
  // les propriétés internes du framework posées sur la balise (les gardes de classe et le rang d'une ligne non pure exceptés)
  const internes = (n: any) => Object.getOwnPropertyNames(n).filter((k) => k.startsWith('_mjs_') && !k.startsWith('_mjs_cl_') && !k.startsWith('_mjs_idx_'))
  const clic = async (n: any) => { n.dispatchEvent(new win.MouseEvent('click', { bubbles: true, composed: true })); await tic() }

  it('une balise de ligne ou de la racine qui porte un gestionnaire : une seule propriété, aucun tableau, aucun attribut neuf', () => {
    const balises = [...tous('a.choisir'), ...tous('a.retirer'), ...tous('b.une'), ...tous('button.haut')]
    assert.equal(balises.length, 10)
    for (const n of balises) {
      assert.deepEqual(internes(n).length, 1, `${n.className} : ${internes(n).join(', ')}`)
      assert.ok(!Object.getOwnPropertyNames(n).some((k) => Array.isArray(n[k])), `${n.className} : un tableau posé sur la balise`)
      assert.deepEqual(n.getAttributeNames(), ['class'], `${n.className} : attributs ${n.getAttributeNames().join(', ')}`)
    }
  })

  it('ce que le compilateur sait d\'avance est partagé par les lignes du gabarit', () => {
    const [a, b] = tous('a.choisir')
    const pa = a[internes(a)[0]], pb = b[internes(b)[0]]
    const commun = Object.keys(pa).filter((k) => typeof pa[k] === 'object' && pa[k] !== null && pa[k] === pb[k] && !(pa[k] instanceof win.Node))
    assert.ok(commun.length >= 1, 'aucune description commune aux deux lignes : ' + Object.keys(pa).join(', '))
  })

  it('le routage reste le même : la ligne relue par son gestionnaire, e.currentTarget, une ligne retirée', async () => {
    await clic(tous('a.choisir')[1])
    assert.equal(el._state.sel, 2)
    await clic(tous('button.haut')[0])
    assert.equal(el._state.vu, 'haut')
    await clic(tous('a.retirer')[0])
    assert.deepEqual(tous('a.choisir').map((n) => n.textContent), ['deux', 'trois'])
    await clic(tous('a.choisir')[1])
    assert.equal(el._state.sel, 3)
  })

  it('.once vaut par balise : une ligne ne désarme pas sa voisine', async () => {
    const [x, y] = tous('b.une')
    await clic(x)
    await clic(x)
    await clic(y)
    assert.equal(el._state.fois, 2)
  })
})
