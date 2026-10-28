// {for} de racine, ligne pure (elle ne lit que son élément et son index) : ses gestionnaires lisent l'élément et l'indice de leur ligne
// sur l'entrée de la ligne, plus sur un indice posé sur la balise. Une ligne qui n'affiche pas son indice ne se rejoue donc plus quand elle
// glisse (suppression, échange, insertion avant elle) ; un clic sur une ligne glissée agit toujours sur son propre élément, avec son
// indice d'aujourd'hui. Une ligne qui affiche son indice se rejoue quand il change.
// On compte les lectures par un accesseur posé sur les objets (aucun appel de fonction dans la ligne).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

async function monter(base: string, source: string) {
  const root = mjsTmp(`lpe-${base}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, `${base}.mjs`), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const win: any = new Window({ url: 'http://localhost/' })
  const files = readdirSync(outDir)
  const coeur = files.find((f: string) => /^mjs_core-/.test(f))!
  const code = files.filter((f: string) => !/^mjs_core/.test(f) && f.endsWith('.js')).map((f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  win.eval(`${stripEsm(readFileSync(join(outDir, coeur), 'utf-8'))}\nglobalThis.µ = µ;\n${code}`)
  win.document.body.innerHTML = `<mjs-${base}></mjs-${base}>`
  const el: any = win.document.body.firstElementChild
  await attendre(80)
  return { win, el, code }
}

const attendre = (ms = 30) => new Promise((r) => setTimeout(r, ms))

// objet dont le champ `label` compte ses lectures dans `lus[id]`
function ligne(lus: Record<number, number>, id: number) {
  const o: any = { id }
  lus[id] = 0
  Object.defineProperty(o, 'label', { enumerable: true, get() { lus[id]++; return 'L' + id } })
  return o
}

const composant = (ligneDuFor: string, boucle = '{for i, row in $data by id}') => `
<script lang="js">
$data = µ.raw([]);
$vu = '';
$sel = -1;
@set = function(rows) { rows.forEach((r) => µ.raw(r)); $data = µ.raw(rows); };
@poser = function(v) { $data = v; };
@pick = function(row, i) { $vu = row.id + '@' + i; };
@choisir = function(id) { $sel = id; };
</script>
<p class="vu">{$vu}</p>
<ul>
${boucle}
  ${ligneDuFor}
{end}
</ul>
`

const SANS_INDICE = composant('<li @class{$sel === row.id}="on"><a class="p" @click={@pick(row, i)}>{row.label}</a><b class="c" @click={@choisir(row.id)}>c</b></li>')
const AVEC_INDICE = composant('<li><a class="p" @click={@pick(row, i)}>{i}:{row.label}</a></li>')

describe('{for} — ligne pure : élément et indice lus sur l\'entrée de la ligne', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const ombre = (el: any) => el._shadow || el.shadowRoot
  const lis = (el: any) => Array.from(ombre(el).querySelectorAll('li')) as any[]
  const textes = (el: any) => lis(el).map((li) => li.querySelector('.p').textContent)
  const zero = (lus: Record<number, number>) => { for (const k of Object.keys(lus)) lus[+k] = 0 }
  // un clic sur chaque ligne : le gestionnaire reçoit l'élément de la ligne et son indice d'aujourd'hui
  async function clics(win: any, el: any, rows: any[]) {
    for (let k = 0; k < rows.length; k++) {
      lis(el)[k].querySelector('.p').dispatchEvent(new win.Event('click', { bubbles: true }))
      await attendre(5)
      assert.equal(ombre(el).querySelector('.vu').textContent, `${rows[k].id}@${k}`, `clic sur la ligne ${k}`)
    }
  }

  it('code généré : drapeau 2 pour une ligne qui ne lit pas son indice, 1 sinon ; aucun indice posé sur les balises de la ligne', async () => {
    const sans = await monter('lpe-code-a', SANS_INDICE)
    assert.ok(/_mjs_p: 2/.test(sans.code), 'drapeau 2')
    assert.ok(!/_mjs_nIdx/.test(sans.code), 'aucun indice posé par la mise à jour de la ligne')
    assert.ok(/_mjs_en/.test(sans.code), 'le gestionnaire lit l\'entrée de la ligne')
    assert.ok(!/data-mjs-idx-0/.test(sans.code), 'aucune lecture d\'attribut d\'indice')
    sans.win.close?.()
    const avec = await monter('lpe-code-b', AVEC_INDICE)
    assert.ok(/_mjs_p: 1/.test(avec.code), 'drapeau 1 : la ligne affiche son indice')
    avec.win.close?.()
  })

  it('suppression, échange, insertion : les lignes glissées ne se rejouent pas et les clics restent justes', async () => {
    const { win, el } = await monter('lpe-ops', SANS_INDICE)
    const lus: Record<number, number> = {}
    let rows = [1, 2, 3, 4, 5, 6].map((id) => ligne(lus, id))
    el.set(rows)
    await attendre()
    assert.deepEqual(textes(el), ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'])
    // suppression au milieu
    zero(lus)
    rows = rows.filter((r) => r.id !== 3)
    el.set(rows)
    await attendre()
    assert.deepEqual(textes(el), ['L1', 'L2', 'L4', 'L5', 'L6'])
    assert.deepEqual([lus[4], lus[5], lus[6]], [0, 0, 0], 'lignes glissées après la suppression : non rejouées')
    await clics(win, el, rows)
    // échange
    zero(lus)
    rows = rows.slice(); [rows[0], rows[3]] = [rows[3], rows[0]]
    el.set(rows)
    await attendre()
    assert.deepEqual(textes(el), ['L5', 'L2', 'L4', 'L1', 'L6'])
    assert.deepEqual([lus[1], lus[5]], [0, 0], 'lignes échangées : non rejouées')
    await clics(win, el, rows)
    // insertion d'un bloc au début
    zero(lus)
    rows = [ligne(lus, 7), ligne(lus, 8), ...rows]
    el.set(rows)
    await attendre()
    assert.deepEqual(textes(el), ['L7', 'L8', 'L5', 'L2', 'L4', 'L1', 'L6'])
    assert.equal(lus[5] + lus[2] + lus[4] + lus[1] + lus[6], 0, 'lignes glissées par l\'insertion : non rejouées')
    await clics(win, el, rows)
    win.close?.()
  })

  it('réserve : une ligne retirée puis remise, et une liste vidée puis recréée, prennent leur nouvel élément et leur nouvel indice', async () => {
    const { win, el } = await monter('lpe-reserve', SANS_INDICE)
    const lus: Record<number, number> = {}
    const rows = [1, 2, 3, 4].map((id) => ligne(lus, id))
    el.set(rows)
    await attendre()
    const x = rows[1]
    let a = rows.filter((r) => r !== x)
    el.set(a)
    await attendre()
    // le même objet revient, en fin de liste : sa ligne sort de la réserve, elle est rejouée et suit la sélection
    zero(lus)
    a = [...a, x]
    el.set(a)
    await attendre()
    assert.deepEqual(textes(el), ['L1', 'L3', 'L4', 'L2'])
    assert.ok(lus[2] >= 1, 'ligne sortie de la réserve : rejouée')
    await clics(win, el, a)
    lis(el)[3].querySelector('.c').dispatchEvent(new win.Event('click', { bubbles: true }))
    await attendre()
    assert.deepEqual(lis(el).map((li) => li.className.includes('on')), [false, false, false, true], 'sélection sur la ligne remise')
    // vidée puis recréée avec d'autres objets : les lignes viennent de la réserve
    el.set([])
    await attendre()
    const b = [11, 12, 13].map((id) => ligne(lus, id))
    el.set(b)
    await attendre()
    assert.deepEqual(textes(el), ['L11', 'L12', 'L13'])
    await clics(win, el, b)
    win.close?.()
  })

  it('ligne qui affiche son indice : rejouée quand il change, clics justes', async () => {
    const { win, el } = await monter('lpe-avec', AVEC_INDICE)
    const lus: Record<number, number> = {}
    let rows = [1, 2, 3, 4].map((id) => ligne(lus, id))
    el.set(rows)
    await attendre()
    zero(lus)
    rows = rows.filter((r) => r.id !== 2)
    el.set(rows)
    await attendre()
    assert.deepEqual(textes(el), ['0:L1', '1:L3', '2:L4'])
    assert.equal(lus[1], 0, 'ligne avant la suppression : sautée')
    assert.ok(lus[3] >= 1 && lus[4] >= 1, 'lignes dont l\'indice a changé : rejouées')
    await clics(win, el, rows)
    win.close?.()
  })

  it('collection objet : le gestionnaire reçoit la clé de sa ligne', async () => {
    const src = composant('<li><a class="p" @click={@pick(row, i)}>{row.label}</a></li>', '{for i, row in $data}')
    const { win, el } = await monter('lpe-objet', src)
    const lus: Record<number, number> = {}
    const o: any = { a: ligne(lus, 1), b: ligne(lus, 2), c: ligne(lus, 3) }
    el.poser(win.µ.raw(o))
    await attendre()
    const vu = () => ombre(el).querySelector('.vu').textContent
    lis(el)[2].querySelector('.p').dispatchEvent(new win.Event('click', { bubbles: true }))
    await attendre()
    assert.equal(vu(), '3@c')
    const o2: any = { a: o.a, c: o.c }
    el.poser(win.µ.raw(o2))
    await attendre()
    assert.deepEqual(textes(el), ['L1', 'L3'])
    lis(el)[1].querySelector('.p').dispatchEvent(new win.Event('click', { bubbles: true }))
    await attendre()
    assert.equal(vu(), '3@c')
    win.close?.()
  })

  it('gestionnaire compilé dans les deux grammaires (Civet et l\'écriture « js ») : l\'entrée de la ligne, sans indice posé', async () => {
    const src = [
      '<script>',
      '$items = [1,2,3]',
      '</script>',
      '<div>{for item, i in $items}<button @click={$n = item + i}>x</button>{end}</div>',
    ].join('\n')
    for (const templateLang of [undefined, 'js'] as const) {
      const { output } = await transpile(src, { moduleName: 'lpe-gram-' + (templateLang ?? 'civet'), ...(templateLang ? { templateLang } : {}) })
      assert.match(output, /_mjs_en/, 'entrée de la ligne lue (' + (templateLang ?? 'civet') + ')')
      assert.doesNotMatch(output, /data-mjs-idx-0|_mjs_nIdx/, 'aucun indice posé ni lu sur la balise (' + (templateLang ?? 'civet') + ')')
    }
  })
})
