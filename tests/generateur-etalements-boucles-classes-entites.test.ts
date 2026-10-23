// Générateur, montage happy-dom :
//   - deux étalements sur une balise qui posent la même clé (`{...$a} {...$b}`) : quand l'un la perd, l'attribut restait retiré
//     alors que l'autre la posait encore. La clé n'est retirée que si aucun étalement de la balise ne la pose plus, et le dernier
//     étalement qui la pose gagne toujours, comme à la première pose
//   - une clé retirée par un étalement emportait la valeur fixe écrite par l'auteur (`<div class="st" title="…" {...$o}>`) : elle
//     revient désormais, entités décodées comme le ferait le navigateur
//   - `{for}` sur une `Map` ou un `Set` : dans un gestionnaire ou une liaison deux sens de la ligne, la variable de ligne valait
//     `undefined` (la ligne était relue par sa position dans la collection, qu'une Map ou un Set n'ont pas)
//   - deux bascules qui ne partagent qu'une partie de leurs classes (`@class{$a}="on" @class{$b}="on big"`) : `on` dépendait de
//     l'ordre des écritures ; une classe est présente si au moins une bascule qui la contient est vraie
//   - les entités des parties fixes d'un attribut mêlé (`title="caf&eacute; {$x}"`) restaient telles quelles à l'écran

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

export const SOURCES: Record<string, string> = {
  'deux-etalements': [
    '<script>',
    '$a = { title: "A", "data-a": "1" }',
    '$b = { title: "B" }',
    '</script>',
    '<div class="d" {...$a} {...$b}>d</div>',
    '<button class="perd" @click={$a = { "data-a": "2" }}>1</button>',
    '<button class="b2" @click={$b = { title: "B2" }}>2</button>',
    '<button class="a3" @click={$a = { title: "A3" }}>3</button>',
    '<button class="bvide" @click={$b = {}}>4</button>',
  ].join('\n'),
  'etalement-statique': [
    '<script>',
    '$o = { title: "dyn", class: "k" }',
    '</script>',
    '<div title="caf&eacute;" class="st" data-fixe hidden {...$o}>d</div>',
    '<button class="vide" @click={$o = {}}>1</button>',
    '<button class="fixe" @click={$o = { "data-fixe": "x" }}>2</button>',
    '<button class="montre" @click={$o = { hidden: false }}>3</button>',
    '<button class="rien" @click={$o = null}>4</button>',
  ].join('\n'),
  'boucle-map-set': [
    '<script>',
    '$m = new Map([["x", 1], ["y", 2]])',
    '$s = new Set(["p", "q"])',
    '$mo = new Map([["a", { nom: "A" }], ["b", { nom: "B" }]])',
    '</script>',
    '{for k, v in $m}<button class="m{k}" @click={globalThis.__m = [k, v]}>{v[0]}</button>{end}',
    '{for i, v in $s}<button class="s{i}" @click={globalThis.__s = [i, v]}>{v}</button>{end}',
    '{for i, ent in $mo}<input class="n{i}" value=!{ent[1].nom}>{end}',
  ].join('\n'),
  'classes-partagees': [
    '<script>',
    '$a = true',
    '$b = false',
    '</script>',
    '<p class="q" @class{$a}="on" @class{$b}="on big">q</p>',
    '{for r in [1]}<i class="w" @class{$a}="on" @class{$b}="on big">w</i>{end}',
    '<button class="bvrai" @click={$b = true}>1</button>',
    '<button class="bfaux" @click={$b = false}>2</button>',
    '<button class="afaux" @click={$a = false}>3</button>',
  ].join('\n'),
  'entites-mixtes': [
    '<script>',
    '$x = "ok"',
    '$p = Promise.resolve({ x: "ok" })',
    '</script>',
    '<p class="m1" title="caf&eacute; {$x}">1</p>',
    '<p class="m3" title="caf&eacute; $x">3</p>',
    '<p class="m5" title="&#36;&#123;x} {$x}">5</p>',
    '{for r in [1]}<i class="m4" title="caf&eacute; {r}">4</i>{end}',
    '{await $p}<i>attente</i>{success v}<p class="m2" title="caf&eacute; {v.x}">2</p>{end}',
  ].join('\n'),
}

const attributs = (el: any): Record<string, string> => Object.fromEntries(Array.from(el.attributes as any[]).map((a: any) => [a.name, a.value]))

describe('générateur — étalements, boucles sur Map et Set, bascules de classe, entités des attributs mêlés (happy-dom)', function () {
  this.timeout(120000)
  let app: any
  before(async () => {
    const root = mjsTmp('generateur-etalements-boucles')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(root, 'src', `${nom}.mjs`), source + '\n')
    app = await createHarness({ root })
  })
  after(async () => {
    await app?.destroy()
    await terminateSharedWorkerPool()
  })

  it('deux étalements qui posent la même clé : retirée seulement quand aucun ne la pose plus, le dernier qui la pose gagne', async () => {
    const m = await app.mount('deux-etalements')
    assert.deepEqual(attributs(m.find('.d')), { class: 'd', title: 'B', 'data-a': '1' }, 'première pose : le dernier étalement gagne')
    await m.click('.perd')
    assert.deepEqual(attributs(m.find('.d')), { class: 'd', title: 'B', 'data-a': '2' }, 'le premier perd title, le second le pose encore')
    await m.click('.b2')
    assert.equal(m.find('.d').getAttribute('title'), 'B2')
    await m.click('.a3')
    assert.equal(m.find('.d').getAttribute('title'), 'B2', 'le premier reprend title, le second le pose encore et reste devant')
    assert.equal(m.find('.d').hasAttribute('data-a'), false, 'data-a, que plus personne ne pose, est retiré')
    await m.click('.bvide')
    assert.equal(m.find('.d').getAttribute('title'), 'A3', 'le second lâche title : la valeur du premier revient')
  })

  it('une clé retirée par un étalement remet la valeur fixe écrite par l\'auteur', async () => {
    const m = await app.mount('etalement-statique')
    assert.deepEqual(attributs(m.find('div')), { title: 'dyn', class: 'k', 'data-fixe': '', hidden: '' })
    await m.click('.vide')
    assert.deepEqual(attributs(m.find('div')), { title: 'café', class: 'st', 'data-fixe': '', hidden: '' })
    await m.click('.fixe')
    assert.equal(m.find('div').getAttribute('data-fixe'), 'x')
    await m.click('.montre')
    assert.deepEqual(attributs(m.find('div')), { title: 'café', class: 'st', 'data-fixe': '' }, 'hidden: false le retire, data-fixe reprend sa valeur fixe')
    await m.click('.rien')
    assert.deepEqual(attributs(m.find('div')), { title: 'café', class: 'st', 'data-fixe': '', hidden: '' }, 'objet nul : toutes les valeurs fixes reviennent, attribut booléen nu compris')
  })

  it('{for} sur une Map et un Set : un gestionnaire et une liaison deux sens de la ligne reçoivent sa valeur', async () => {
    const m = await app.mount('boucle-map-set')
    const w = app.window
    assert.equal(m.find('.m1').textContent, 'y')
    await m.click('.m1')
    assert.deepEqual(JSON.parse(JSON.stringify(w.__m)), [1, ['y', 2]])
    await m.click('.s1')
    assert.deepEqual(JSON.parse(JSON.stringify(w.__s)), [1, 'q'])
    await m.type('.n1', 'Z')
    assert.equal(m.state.mo.get('b').nom, 'Z', 'la liaison écrit dans l\'objet de la deuxième entrée')
    assert.equal(m.state.mo.get('a').nom, 'A')
  })

  it('bascules qui partagent une partie de leurs classes : une classe est présente si l\'une des bascules qui la contiennent est vraie', async () => {
    const m = await app.mount('classes-partagees')
    const classes = () => [m.find('.q').className, m.find('.w').className]
    assert.deepEqual(classes(), ['q on', 'w on'], 'au montage, $a vrai')
    await m.click('.bvrai')
    assert.deepEqual(classes(), ['q on big', 'w on big'])
    await m.click('.bfaux')
    assert.deepEqual(classes(), ['q on', 'w on'], '$b repasse à faux, $a reste vrai : on reste')
    await m.click('.afaux')
    assert.deepEqual(classes(), ['q', 'w'])
  })

  it('attribut mêlé : les entités de ses parties fixes sont décodées, à la racine, dans une ligne et dans une branche {await}', async () => {
    const m = await app.mount('entites-mixtes')
    for (let i = 0; i < 4; i++) await m.tick()
    const titre = (q: string) => m.find(q)?.getAttribute('title')
    assert.deepEqual({ m1: titre('.m1'), m3: titre('.m3'), m4: titre('.m4'), m5: titre('.m5'), m2: titre('.m2') },
      { m1: 'café ok', m3: 'café ok', m4: 'café 1', m5: '${x} ok', m2: 'café ok' })
  })
})
