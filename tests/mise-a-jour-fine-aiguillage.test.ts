// mise à jour fine, côté runtime : une écriture compilée d'un champ (`µ._mjs_deepSet` et ses sœurs) ne rejoue que les liaisons qui
// le lisent — la ligne de `{for}` qui montre l'objet écrit, rappelée avec le masque du champ, à l'heure des blocs (la microtâche) ; les
// liaisons du champ d'un objet hors liste, tout de suite comme aujourd'hui, ou à la sortie d'une boucle qui écrit l'état. Mêmes textes à
// l'écran qu'avec la variable entière prévenue ; ce qui est compté : lignes rappelées et liaisons jouées. La boîte de la variable écrite
// (graphe des signaux) avance comme sur le chemin ordinaire

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

const tic = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }

const SURPLACE = [
  '<script lang="js">',
  '  $data = [];',
  '  @poser = function(a) { $data = a; };',
  '  @update = function() { for (let i = 0; i < $data.length; i += 10) $data[i].label += \' !!!\'; };',
  '  @deux = function() { $data[1].label += \' a\'; $data[1].n += 1; $data[1].label += \' b\'; };',
  '  @cle = function() { $data[2].id = 99; };',
  '  @hors = function() { $data[3].autre = 1; };',
  '</script>',
  '<table><tbody>',
  '  {for row in $data by id}',
  '    <tr><td class="id">{row.id}</td><td class="lab">{row.label}</td><td class="n">{row.n}</td></tr>',
  '  {end}',
  '</tbody></table>',
].join('\n')

const CHAMPS = [
  '<script lang="js">',
  '  $o = { f0: \'v0\', f1: \'v1\', f2: \'v2\', f3: \'v3\', f4: \'v4\', f5: \'v5\', f6: \'v6\', f7: \'v7\', f8: \'v8\', f9: \'v9\' };',
  '  @un = function() { $o.f3 = \'x\'; };',
  '  @cinq = function() { for (let k = 0; k < 5; k++) { const key = \'f\' + k; $o[key] = \'y\' + k; } };',
  '  @tout = function() { $o = { ...$o, f9: \'z\' }; };',
  '</script>',
  ...Array.from({ length: 10 }, (_, i) => `<p class="f${i}">{$o.f${i}}</p>`),
].join('\n')

// une valeur dérivée et un reffet qui lisent la liste : le compilateur ne pose pas de table, la variable entière est prévenue
const DERIVEE = [
  '<script lang="js">',
  '  $data = [{ id: 1, label: \'a\' }, { id: 2, label: \'b\' }];',
  '  $nb = $data.map((r) => r.label).join(\',\');',
  '  µeffect(() => { globalThis.__read = $data[0].label; });',
  '  @ecrire = function() { $data[0].label += \'!\'; };',
  '</script>',
  '<p class="nb">{$nb}</p>',
  '{for row in $data by id}<b>{row.label}</b>{end}',
].join('\n')

// un même objet tenu deux fois dans la même variable : deux fois dans une liste sans clé, ou cité par une autre ligne
const DOUBLE = [
  '<script lang="js">',
  '  $dup = [];',
  '  $msgs = [];',
  '  @poser = function() { const a = { label: \'a\' }; const m1 = { id: 1, t: \'x\', parent: null }; $dup = [a, { label: \'b\' }, a]; $msgs = [m1, { id: 2, t: \'y\', parent: m1 }]; };',
  '  @ecrire = function() { $dup[0].label += \'!\'; $msgs[0].t += \'!\'; };',
  '</script>',
  '{for d in $dup}<u>{d.label}</u>{end}',
  '{for m in $msgs by id}<s>{m.t}/{m.parent ? m.parent.t : \'-\'}</s>{end}',
].join('\n')

describe('mise à jour fine — l\'aiguillage à l\'écriture (runtime)', function () {
  this.timeout(60000)
  let win: any, µ: any

  before(async () => {
    const root   = mjsTmp('fine-aiguillage')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'surplace.mjs'), SURPLACE)
    writeFileSync(join(srcDir, 'champs.mjs'), CHAMPS)
    writeFileSync(join(srcDir, 'derivee.mjs'), DERIVEE)
    writeFileSync(join(srcDir, 'double.mjs'), DOUBLE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = '<mjs-surplace></mjs-surplace><mjs-champs></mjs-champs><mjs-derivee></mjs-derivee><mjs-double></mjs-double>'
    µ = win.µ
    await tic()
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const hote = (nom: string): any => win.document.querySelector('mjs-' + nom)
  const textes = (el: any, sel: string) => Array.from((el._shadow || el.shadowRoot).querySelectorAll(sel)).map((x: any) => x.textContent)

  // chaque ligne rappelée (élément, masque) : la fermeture de chaque entrée enveloppée
  function espionLignes(el: any): [number, number | undefined][] {
    const vus: [number, number | undefined][] = []
    for (const cache of Object.values(el._mjs_list_cache) as any[]) {
      for (const en of cache.values()) {
        const f = en._mjs_updFn
        en._mjs_updFn = function(it: any, ix: any, m?: number) { vus.push([ix, m]); return f(it, ix, m) }
      }
    }
    return vus
  }

  it('une ligne sur dix : seules les lignes écrites sont rappelées, avec le masque du libellé, à la microtâche', async () => {
    const el = hote('surplace')
    el.poser(Array.from({ length: 20 }, (_, i) => ({ id: i, label: 'r' + i, n: 0 })))
    await tic()
    const vus = espionLignes(el)
    el.update()
    // l'heure d'aujourd'hui : la ligne change à la microtâche du bloc
    assert.equal(textes(el, 'td.lab')[0], 'r0')
    await tic()
    assert.equal(textes(el, 'td.lab')[0], 'r0 !!!')
    assert.equal(textes(el, 'td.lab')[10], 'r10 !!!')
    assert.equal(textes(el, 'td.lab').filter((t) => t.endsWith('!!!')).length, 2)
    assert.deepEqual(vus, [[0, 2], [10, 2]])
  })

  it('trois écritures d\'une ligne dans le même tour : rappelée une fois, masques cumulés', async () => {
    const el = hote('surplace')
    const vus = espionLignes(el)
    el.deux()
    await tic()
    assert.equal(textes(el, 'td.lab')[1], 'r1 a b')
    assert.equal(textes(el, 'td.n')[1], '1')
    assert.deepEqual(vus, [[1, 6]])
  })

  it('le champ de la clé et un champ que la ligne ne lit pas : clé par le chemin ordinaire, champ non lu sans rien rappeler', async () => {
    const el = hote('surplace')
    let vus = espionLignes(el)
    el.cle()
    await tic()
    assert.equal(textes(el, 'td.id')[2], '99')
    // la liste entière repasse (clé changée), sans masque
    assert.ok(vus.length >= 19 && vus.every(([, m]) => m === undefined), JSON.stringify(vus))
    vus = espionLignes(el)
    el.hors()
    await tic()
    assert.deepEqual(vus, [])
  })

  it('objet hors liste : un champ écrit ne rejoue que ses liaisons, tout de suite ; en boucle, à la sortie, une fois chacune', async () => {
    const el = hote('champs')
    let n = 0
    const proto = Object.getPrototypeOf(el)._mjs_updText
    el._mjs_updText = function(...a: any[]) { n++; return proto.apply(this, a) }
    el.un()
    assert.equal(textes(el, 'p.f3')[0], 'x')
    assert.equal(n, 1)
    n = 0
    el.cinq()
    assert.deepEqual(textes(el, 'p').slice(0, 6), ['y0', 'y1', 'y2', 'y3', 'y4', 'v5'])
    assert.equal(n, 5)
    n = 0
    el.tout()
    await tic()
    assert.equal(textes(el, 'p.f9')[0], 'z')
    assert.equal(n, 10)
  })

  it('valeur dérivée et reffet qui lisent la liste : aucune table, l\'écran et le reffet suivent comme avant', async () => {
    const el = hote('derivee')
    assert.equal(el._mjs_fine, undefined)
    el.ecrire()
    await tic()
    assert.equal(textes(el, 'p.nb')[0], 'a!,b')
    assert.deepEqual(textes(el, 'b'), ['a!', 'b'])
    assert.equal(win.__read, 'a!')
  })

  it('un objet tenu deux fois dans la même variable : chaque endroit qui le montre suit', async () => {
    const el = hote('double')
    el.poser()
    await tic()
    // la ligne qui lit sous un champ (`m.parent.t`) ôte la table de sa liste ; la liste sans clé garde la sienne
    assert.deepEqual(Object.keys(el._mjs_fine), ['dup'])
    el.ecrire()
    await tic()
    assert.deepEqual(textes(el, 'u'), ['a!', 'b', 'a!'])
    assert.deepEqual(textes(el, 's'), ['x!/-', 'y/x!'])
  })

  it('le chemin fin fait avancer la boîte de la variable écrite : un calcul du graphe qui la lit se refait', async function () {
    const el = hote('surplace')
    if (typeof µ._mjs_sigDerived !== 'function') this.skip()
    // le compte de l'horloge des valeurs dérivées, appelé par le chemin fin, vit dans le même cœur
    assert.equal(win.eval('typeof _mjsCount'), 'function')
    const n = µ._mjs_sigDerived(el, '__essai', () => {
      µ._mjs_sigRead(el, 'data')
      return µ._mjs_toRaw(el._state.data)[5].label
    })
    assert.equal(µ._mjs_sigGet(n), 'r5')
    const vus = espionLignes(el)
    µ._mjs_deepSet(el, ['data', 5, 'label'], 'neuf')
    assert.equal(µ._mjs_sigGet(n), 'neuf')
    await tic()
    assert.equal(textes(el, 'td.lab')[5], 'neuf')
    assert.deepEqual(vus, [[5, 2]])
  })
})
