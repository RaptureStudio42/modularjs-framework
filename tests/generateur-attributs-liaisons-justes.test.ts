// Le code que le générateur écrit pour les attributs, les liaisons et les gestionnaires suit la même règle partout :
// - un objet étalé sur une balise native (`<button {...$o}>`) retire un attribut faux, nul ou absent, et retire de la
//   balise une clé qui a quitté l'objet ; avant, `{disabled: false, hidden: null}` désactivait et cachait le bouton
// - une liaison à deux sens sur un attribut ordinaire (`href=!{$u}`) filtre les adresses `javascript:` comme la liaison
//   à sens unique, et `null` retire l'attribut au lieu d'écrire « null »
// - dans un `{for}`, `@style.color={r.id === $sel ? 'red' : null}` retire la couleur de la ligne qui perd la sélection
// - les variables de travail des gestionnaires portent un nom que l'auteur n'écrit pas : une variable du `<script>`
//   nommée comme elles autrefois (`__val`, `__grp_v`, `__arr_0`…) garde sa valeur après chaque événement
// - deux `{for}` imbriqués sans index nommé et une liaison `clientWidth=!{$w}` se construisent
// - deux bascules de la même classe (`@class{$a}="on" @class{$b}="on"`) donnent la même classe pour le même état
// - dans un `{for}` sur un objet, la valeur de la ligne est la bonne dans un `@click` et dans une liaison `!{…}`
// - un composant auto-fermé dont un attribut contient `>` (`<mjs-x v={$n > 1} />`) se construit
// - `@in=*knockout` (effet fondu dans un autre) donne le message de l'effet posé directement

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

// les tableaux lus dans la page viennent d'un autre domaine JavaScript (celui de la fenêtre simulée) : comparés par leur texte
const egal = (lu: unknown, attendu: unknown, message?: string) => assert.equal(JSON.stringify(lu), JSON.stringify(attendu), message)

async function harnais(prefixe: string, composants: Record<string, string>): Promise<any> {
  const root = mjsTmp(prefixe)
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  for (const [nom, code] of Object.entries(composants)) writeFileSync(join(src, `${nom}.mjs`), code)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
  return createHarness({ root })
}

const VIVANTS: Record<string, string> = {
  'g-etale': [
    '<script>',
    '$o = { disabled: false, hidden: null, title: "t" }',
    '</script>',
    '<button class="s" {...$o}>s</button>',
    '<button class="c" @click={$o = { id: "nouveau" }}>c</button>',
  ].join('\n'),
  'g-lien': [
    '<script>',
    '$u = "javascript:alert(1)"',
    '$t = null',
    '</script>',
    '<a class="l" href=!{$u}>l</a><p class="t" title=!{$t}>t</p>',
  ].join('\n'),
  'g-style': [
    '<script>',
    '$rows = [{id: 1}, {id: 2}]',
    '$sel = 1',
    '</script>',
    '{for r in $rows by id}<li class="r{r.id}" @style.color={r.id === $sel ? \'red\' : null}>{r.id}</li>{end}',
    '<button class="go" @click={$sel = 2}>go</button>',
  ].join('\n'),
  'g-fils': [
    '<script>',
    '$valeur ?= 0',
    '</script>',
    '<button class="inc" @click={$valeur = 5}>+</button>',
  ].join('\n'),
  'g-noms': [
    '<script>',
    '$n = 1',
    '$c = "a"',
    '$cs = []',
    '$m = 0',
    '$xs = [{id: 1}, {id: 2}]',
    '$p = Promise.resolve({n: 7})',
    '__val = "auteur-val"',
    '__grp_v = "auteur-gv"',
    '__grp_arr = "auteur-ga"',
    '__arr_0 = "auteur-arr"',
    '__idx_0 = "auteur-idx"',
    '__cst_1 = "auteur-cst"',
    '__aw_0 = "auteur-aw"',
    '__mjsCast = "auteur-cast"',
    '</script>',
    '<input class="n" type="text" value.number=!{$n} aria-label="n">',
    '<input class="ra" type="radio" value="a" @group=!{$c} aria-label="a"><input class="rb" type="radio" value="b" @group=!{$c} aria-label="b">',
    '<input class="ca" type="checkbox" value="a" @group=!{$cs} aria-label="ca">',
    '{for x in $xs by id}{const nom = x.id + "!"}<button class="x{x.id}" @click={window.__clic = [x.id, nom]}>x</button>{end}',
    '{await $p}<i>attente</i>{success d}<button class="aw" @click={window.__aw = d.n}>a</button>{end}',
    '<mjs-g-fils class="fils" valeur.number=!{$m}></mjs-g-fils>',
    '<button class="lire" @click={window.__lu = [__val, __grp_v, __grp_arr, __arr_0, __idx_0, __cst_1, __aw_0, __mjsCast]}>l</button>',
  ].join('\n'),
  'g-classes': [
    '<script>',
    '$a = true',
    '$b = false',
    '</script>',
    '<p class="p" @class{$a}="on" @class{$b}="on">p</p>',
    '<button class="ta" @click={$a = not $a}>a</button><button class="tb" @click={$b = not $b}>b</button>',
  ].join('\n'),
  'g-objet': [
    '<script>',
    '$obj = {a: 10, b: 20}',
    '$fiches = {a: {x: "A"}, b: {x: "B"}}',
    '</script>',
    '{for k, v in $obj}<button class="b{k}" @click={window.__v = [k, v]}>{k}={v}</button>{end}',
    '{for k, f in $fiches}<input class="i{k}" value=!{f.x} aria-label="{k}">{end}',
    '<p class="lu">{$fiches.b.x}</p>',
  ].join('\n'),
}

const CONSTRUITS: Record<string, string> = {
  'g-dims': [
    '<script>',
    '$as = [{id: 1, bs: [{id: 1}, {id: 2}]}]',
    '$w = 0',
    '</script>',
    '{for a in $as}{for b in a.bs}<div class="d{b.id}" clientWidth=!{$w}>d</div>{end}{end}',
  ].join('\n'),
  'g-kid': [
    '<script>',
    '$v ?= false',
    '</script>',
    '<b class="kid">k{$v}</b>',
  ].join('\n'),
  'g-auto': [
    '<script>',
    '$n = 2',
    '</script>',
    '<mjs-g-kid v={$n > 1} /><p class="apres">après</p>',
  ].join('\n'),
}

describe('générateur — attributs, liaisons et gestionnaires justes', function () {
  this.timeout(120000)
  let app: any

  before(async () => { app = await harnais('generateur-attributs-liaisons-justes', VIVANTS) })
  after(async () => { await app?.destroy() })

  it('objet étalé sur une balise native : faux et nul retirés, clé disparue retirée', async () => {
    const c = await app.mount('g-etale')
    const s = c.find('.s')
    assert.equal(s.hasAttribute('disabled'), false, 'disabled: false ne désactive pas le bouton')
    assert.equal(s.hasAttribute('hidden'), false, 'hidden: null ne cache pas le bouton')
    assert.equal(s.getAttribute('title'), 't')
    await c.click('.c')
    const s2 = c.find('.s')
    assert.equal(s2.getAttribute('id'), 'nouveau')
    assert.equal(s2.hasAttribute('title'), false, 'la clé title a quitté l\'objet : l\'attribut part avec elle')
  })

  it('liaison à deux sens sur un attribut ordinaire : adresse javascript: filtrée, null retiré', async () => {
    const c = await app.mount('g-lien')
    assert.doesNotMatch(c.find('.l').getAttribute('href') ?? '', /javascript/i, 'href=!{$u} filtre javascript: comme href={$u}')
    assert.equal(c.find('.t').getAttribute('title'), null, 'title=!{$t} avec $t = null : pas de texte « null »')
  })

  it('style filtré dans un {for} : la ligne qui perd la sélection perd sa couleur', async () => {
    const c = await app.mount('g-style')
    assert.equal(c.find('.r1').style.color, 'red')
    await c.click('.go')
    assert.equal(c.find('.r1').style.color, '', 'null retire la couleur')
    assert.equal(c.find('.r2').style.color, 'red')
  })

  it('variables de travail des gestionnaires : celles du script gardent leur valeur', async () => {
    const c = await app.mount('g-noms')
    for (let i = 0; i < 4; i++) await c.tick()
    await c.type('.n', '7')
    await c.click('.rb')
    await c.click('.ca')
    await c.click('.x2')
    await c.click('.aw')
    c.find('.fils')._shadow.querySelector('.inc').click()
    for (let i = 0; i < 2; i++) await c.tick()
    assert.equal(c.state.n, 7, 'la frappe arrive dans $n')
    assert.equal(c.state.c, 'b', 'le clic radio arrive dans $c')
    egal(c.state.cs, ['a'], 'la case arrive dans $cs')
    assert.equal(c.state.m, 5, 'la valeur du composant enfant remonte, convertie')
    egal(app.window.__clic, [2, '2!'], 'le clic de la ligne lit sa ligne et son {const}')
    assert.equal(app.window.__aw, 7, 'le clic de la branche lit la valeur chargée')
    await c.click('.lire')
    egal(app.window.__lu, ['auteur-val', 'auteur-gv', 'auteur-ga', 'auteur-arr', 'auteur-idx', 'auteur-cst', 'auteur-aw', 'auteur-cast'])
  })

  it('deux bascules de la même classe : la classe ne dépend que de l\'état', async () => {
    const c = await app.mount('g-classes')
    assert.ok(c.find('.p').classList.contains('on'), 'a vrai au montage : la classe est là')
    await c.click('.ta')
    assert.ok(!c.find('.p').classList.contains('on'), 'a et b faux : la classe part')
    await c.click('.ta')
    assert.ok(c.find('.p').classList.contains('on'), 'a revenu à vrai : la classe revient')
    await c.click('.tb')
    await c.click('.ta')
    assert.ok(c.find('.p').classList.contains('on'), 'b vrai seul : la classe reste')
  })

  it('{for} sur un objet : la valeur de la ligne est la bonne dans un @click et une liaison', async () => {
    const c = await app.mount('g-objet')
    await c.click('.bb')
    egal(app.window.__v, ['b', 20])
    await c.click('.ba')
    egal(app.window.__v, ['a', 10])
    await c.type('.ib', 'Z')
    assert.equal(c.find('.lu').textContent, 'Z', 'la frappe arrive dans la fiche de sa ligne')
  })
})

describe('générateur — formes qui se construisent', function () {
  this.timeout(120000)

  it('{for} imbriqués sans index nommé + clientWidth=!{$w}, composant auto-fermé avec > dans un attribut', async () => {
    const app = await harnais('generateur-formes-construites', CONSTRUITS)
    try {
      const d = await app.mount('g-dims')
      assert.ok(d.find('.d2'), 'les lignes imbriquées sont rendues')
      const a = await app.mount('g-auto')
      const kid = a.find('mjs-g-kid')
      assert.ok(kid, 'le composant est posé')
      assert.ok(!kid.querySelector('.apres'), 'le frère n\'est pas avalé par le composant')
      assert.ok(a.find('.apres'), 'le frère reste à sa place')
    }
    finally {
      await app.destroy()
    }
  })

  it('@in=*knockout : le message dit l\'effet qui le remplace', async () => {
    let message = ''
    try {
      const app = await harnais('generateur-transition-remplacee', { 'g-ko': '<p @in=*knockout>k</p>\n' })
      await app.destroy()
    }
    catch (e: any) {
      message = String(e?.message ?? e)
    }
    assert.match(message, /\*gradient\.knockout/, 'le message propose *gradient.knockout')
    assert.doesNotMatch(message, /transition inconnue/, 'pas « transition inconnue »')
  })
})
