// un magasin `$$x` (ou un chemin dedans) passé en argument à une fonction importée d'un module que MJS copie tel
// quel (`@import f 'chemin.js'`) : l'objet part brut, et si la fonction ÉCRIT dans le paramètre qui le reçoit, la
// valeur change sans rien redessiner (build et tests restent verts). le build le dit — avertissement `reactivity`
// (coupable par `lint.reactivity: false`), une ligne par magasin écrit, jamais une erreur — mais seulement quand il
// LIT l'écriture dans le fichier .js (acorn) : une fonction qui ne fait que lire se tait, comme une fonction qui
// délègue à une autre, une fonction introuvable ou un fichier illisible, de plus de 1 Mo, ou dont le chemin réel
// (lien symbolique compris) sort du dossier des sources (on ne devine pas). clear, add, delete et set ne comptent
// que sous la forme d'une collection : `env.clear(recount)` est une horloge, pas un vidage
// jamais signalés non plus : un module .civet / .coffee (l'écriture y est suivie quand `$$x` est écrit en clair),
// une fonction locale, un argument qui n'est pas pris dans le magasin (état `$x`, littéral, `µread $$x`, `µlang`),
// un magasin rangé dans un objet ou un tableau littéral, une adresse https://

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, statSync, utimesSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

// espionne console.warn le temps d'un transpile (motif tests/lint-types-avertissements.test.ts)
async function warningsFor(src: string, moduleName: string, opts: Record<string, unknown> = {}): Promise<string[]> {
  const orig = console.warn
  const caught: string[] = []
  console.warn = (...a: unknown[]) => { caught.push(String(a[0])) }
  try { await transpile(src, { moduleName, ...opts }) } finally { console.warn = orig }
  return caught
}

// le code émis par un transpile, avertissements tus
async function outputOf(src: string, moduleName: string, opts: Record<string, unknown> = {}): Promise<string> {
  const orig = console.warn
  console.warn = () => {}
  try { return (await transpile(src, { moduleName, ...opts })).output } finally { console.warn = orig }
}

// les seules lignes qui parlent d'un module .js qui écrit dans le magasin reçu (les deux langues)
const MOTIF = /reçu en argument \(ligne \d+ de|received as an argument \(line \d+ of/

async function lignesDe(src: string, nom: string, opts: Record<string, unknown> = {}): Promise<string[]> {
  return (await warningsFor(src, nom, opts)).filter(m => MOTIF.test(m))
}

// `imports` en tête (une ligne chacun), une ligne vide, `<script>` ; la première ligne du script est donc
// la ligne `imports.length + 3` du fichier
function composant(imports: string[], script: string[], html: string[]): string {
  const bloc = script.length === 0 ? [] : ['<script>', ...script.map(l => '  ' + l), '</script>', '']
  return [...imports, '', ...bloc, ...html].join('\n') + '\n'
}

// un dossier de sources (`sourceDir`) avec les modules .js du jeu d'essai : le build les relit pour savoir ce
// qu'ils écrivent
function sources(fichiers: Record<string, string>): string {
  const root = mjsTmp('mv-src')
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(root, chemin)), { recursive: true })
    writeFileSync(join(root, chemin), contenu)
  }
  return root
}

// la ligne (à partir de 1) du premier passage de `motif` dans un module d'essai
function ligneDe(contenu: string, motif: string): number {
  const i = contenu.indexOf(motif)
  assert.ok(i >= 0, motif)
  return contenu.slice(0, i).split('\n').length
}

const FX_JS    = ['export function raiseFx(ui, spec) {', '  ui.coinFx = spec', '}', '', 'export default {', '  raise(ui) {', '    ui.coinFx = 1', '  },', '}', '', 'export class Fx {', '  constructor(ui) {', '    ui.coinFx = 2', '  }', '}', ''].join('\n')
const FMT_JS   = ['export function fmt(ui) {', '  ui.seen = true', '  return String(ui.a)', '}', ''].join('\n')
const LISTE_JS = ['export function listOf(ui) {', '  ui.items.push(0)', '  return ui.items', '}', ''].join('\n')
const DUO_JS   = ['export function lire(ui) {', '  return ui.a', '}', '', 'export function ecrire(ui) {', '  ui.a = 1', '}', ''].join('\n')

const FX     = "@import raiseFx 'shared/fx.js'"
const LISTE  = "@import listOf 'shared/liste.js'"
const FMT    = "@import fmt 'shared/fmt.js'"
const BOUTON = '<button @click={@go()}>go</button>'

describe('lint reactivity — un module .js qui écrit dans le magasin reçu en argument', function () {
  this.timeout(60000)
  let SRC = ''
  before(() => { SRC = sources({ 'shared/fx.js': FX_JS, 'shared/fmt.js': FMT_JS, 'shared/liste.js': LISTE_JS, 'shared/duo.js': DUO_JS }) })
  afterEach(() => setMessagesLang('fr'))

  describe('avertit, une ligne par magasin écrit, avec le fichier et les deux lignes', () => {
    it("le cas d'origine, dans une méthode du script : raiseFx($$ui, spec) avec `ui.coinFx = spec` dans le .js", async () => {
      const src = composant([FX], ['$$ui ?= { coinFx: null }', '@go = ->', "  raiseFx($$ui, 'depuis-js')"], [BOUTON])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 1, JSON.stringify(w))
      assert.match(w[0], /'essai\.mjs' \(ligne 6\)/)
      assert.ok(w[0].includes(`raiseFx écrit dans $$ui, reçu en argument (ligne ${ligneDe(FX_JS, 'ui.coinFx = spec')} de 'shared/fx.js')`), w[0])
      assert.match(w[0], /change la valeur du magasin mais ne redessine rien/)
      assert.match(w[0], /Écrivez dans le magasin depuis le composant, ou faites renvoyer la valeur par raiseFx et écrivez-la dans le composant\./)
      assert.doesNotMatch(w[0], /sans objet|ne fait que lire/)
      assert.ok(w[0].endsWith('[lint.reactivity]'), w[0])
    })

    it('le même cas dans un gestionnaire du HTML : @click={raiseFx($$ui, 1)}, avec la ligne de la balise', async () => {
      const src = composant([FX], ['$$ui ?= { coinFx: null }'], ['<p>un</p>', '<button @click={raiseFx($$ui, 1)}>go</button>'])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 1, JSON.stringify(w))
      assert.match(w[0], /'essai\.mjs' \(ligne 8\)/)
      assert.match(w[0], /raiseFx écrit dans \$\$ui, reçu en argument \(ligne 2 de 'shared\/fx\.js'\)/)
    })

    it('le même cas dans une interpolation du HTML : {raiseFx($$ui)}', async () => {
      const src = composant([FX], ['$$ui ?= { coinFx: null }'], ['<p>{raiseFx($$ui)}</p>'])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 1, JSON.stringify(w))
      assert.match(w[0], /raiseFx écrit dans \$\$ui, reçu en argument \(ligne 2 de 'shared\/fx\.js'\)/)
    })

    it('le même cas dans le <script module>', async () => {
      const src = ["@import raiseFx 'shared/fx.js'", '', '<script module>', '  ouvre = -> raiseFx($$ui, 1)', '</script>', '', '<p>x</p>', ''].join('\n')
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 1, JSON.stringify(w))
      assert.match(w[0], /raiseFx écrit dans \$\$ui, reçu en argument \(ligne 2 de 'shared\/fx\.js'\)/)
    })

    it('un chemin dans le magasin : fmt($$ui.a.b)', async () => {
      const src = composant([FMT], ['$$ui ?= { a: { b: 1 } }', '@go = ->', '  fmt($$ui.a.b)'], [BOUTON])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 1, JSON.stringify(w))
      assert.match(w[0], /\(ligne 6\)/)
      assert.ok(w[0].includes(`fmt écrit dans $$ui.a.b, reçu en argument (ligne ${ligneDe(FMT_JS, 'ui.seen = true')} de 'shared/fmt.js')`), w[0])
    })

    it('un élément de tableau du magasin : fmt($$ui.items[0])', async () => {
      const src = composant([FMT], ['$$ui ?= { items: [] }', '@go = ->', '  fmt($$ui.items[0])'], [BOUTON])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 1, JSON.stringify(w))
      assert.match(w[0], /fmt écrit dans \$\$ui\.items\[0\], reçu en argument/)
    })

    it("le magasin en deuxième argument : la fonction écrit son premier paramètre, qui reçoit autre chose, rien n'est dit", async () => {
      const src = composant([FX], ['$$ui ?= { a: 1 }', '@go = ->', "  raiseFx({ ok: 1 }, $$ui)"], [BOUTON])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: SRC }), [])
    })

    it("le magasin reçu par le paramètre qui est écrit, quand un autre argument vient aussi du magasin : seul celui-là est nommé", async () => {
      const src = composant(["@import ecrire 'shared/duo.js'"], ['$$ui ?= { a: 1 }', '$$cfg ?= {}', '@go = ->', '  ecrire($$ui, $$cfg.a)'], [BOUTON])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 1, JSON.stringify(w))
      assert.match(w[0], /ecrire écrit dans \$\$ui, reçu en argument \(ligne 6 de 'shared\/duo\.js'\)/)
      assert.doesNotMatch(w[0], /\$\$cfg/)
    })

    it("deux arguments du magasin écrits tous les deux : une ligne pour chacun", async () => {
      const dir = sources({ 'shared/deux.js': ['export function deux(a, b) {', '  a.x = 1', '  b.y = 2', '}', ''].join('\n') })
      const src = composant(["@import deux 'shared/deux.js'"], ['$$a ?= {}', '$$b ?= {}', '@go = ->', '  deux($$a, $$b)'], [BOUTON])
      const w = await lignesDe(src, 'essai', { sourceDir: dir })
      assert.equal(w.length, 2, JSON.stringify(w))
      assert.match(w[0], /deux écrit dans \$\$a, reçu en argument \(ligne 2 de 'shared\/deux\.js'\)/)
      assert.match(w[1], /deux écrit dans \$\$b, reçu en argument \(ligne 3 de 'shared\/deux\.js'\)/)
    })

    it('un argument étalé : raiseFx(...$$ui.args)', async () => {
      const src = composant([FX], ['$$ui ?= { args: [] }', '@go = ->', '  raiseFx(...$$ui.args)'], [BOUTON])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 1, JSON.stringify(w))
      assert.match(w[0], /raiseFx écrit dans \$\$ui\.args, reçu en argument/)
    })

    it("un objet importé par défaut : fx.raise($$ui) (l'appel passe par la méthode de l'objet exporté)", async () => {
      const src = composant(["@import default fx 'shared/fx.js'"], ['$$ui ?= {}', '@go = ->', '  fx.raise($$ui)'], [BOUTON])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 1, JSON.stringify(w))
      assert.ok(w[0].includes(`fx.raise écrit dans $$ui, reçu en argument (ligne ${ligneDe(FX_JS, 'ui.coinFx = 1')} de 'shared/fx.js')`), w[0])
    })

    it("une classe importée : new Fx($$ui) (le constructeur écrit son paramètre)", async () => {
      const src = composant(["@import Fx 'shared/fx.js'"], ['$$ui ?= {}', '@go = ->', '  new Fx($$ui)'], [BOUTON])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 1, JSON.stringify(w))
      assert.ok(w[0].includes(`Fx écrit dans $$ui, reçu en argument (ligne ${ligneDe(FX_JS, 'ui.coinFx = 2')} de 'shared/fx.js')`), w[0])
    })

    it('plusieurs noms sur un @import : chacun est suivi', async () => {
      const src = composant(["@import lire ecrire 'shared/duo.js'"], ['$$ui ?= {}', '@go = ->', '  lire($$ui)', '  ecrire($$ui)'], [BOUTON])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 1, JSON.stringify(w))
      assert.match(w[0], /ecrire écrit dans \$\$ui, reçu en argument \(ligne 6 de 'shared\/duo\.js'\)/)
    })

    it("dans la valeur d'un attribut du HTML : title={fmt($$ui.a)}", async () => {
      const src = composant([FMT], ['$$ui ?= { a: 1 }'], ['<p title={fmt($$ui.a)}>x</p>'])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 1, JSON.stringify(w))
    })

    it("dans la condition d'un bloc {if} et dans la liste d'un {for}", async () => {
      const src = composant([FMT, LISTE], ['$$ui ?= { ok: true, items: [] }'], ['{if fmt($$ui.ok)}', '  <p>oui</p>', '{end}', '{for x in listOf($$ui.items)}', '  <i>{x}</i>', '{end}'])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 2, JSON.stringify(w))
      assert.ok(w.some(m => /fmt écrit dans/.test(m)) && w.some(m => /listOf écrit dans/.test(m)), JSON.stringify(w))
    })

    it('une ligne par appel : deux appels, deux lignes ; le même texte à deux endroits du script, deux lignes', async () => {
      const src = composant([FX], ['$$ui ?= { a: null }', '@go = ->', '  raiseFx($$ui, 1)', '  raiseFx($$ui.a, 2)', '@stop = ->', '  raiseFx($$ui, 1)'], [BOUTON])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 3, JSON.stringify(w))
      assert.deepEqual(w.map(m => /\(ligne (\d+)\)/.exec(m)?.[1]), ['6', '7', '9'])
    })

    it("le même appel écrit deux fois dans le HTML ne fait qu'une ligne (le build range chaque expression une fois)", async () => {
      const src = composant([FMT], ['$$ui ?= { a: 1 }'], ['<p>{fmt($$ui.a)}</p>', '<p>{fmt($$ui.a)}</p>'])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 1, JSON.stringify(w))
    })

    it('les gestionnaires compilés par groupes (un nom du HTML recouvre un nom du <script>) gardent leur ligne', async () => {
      const src = composant([FX], ['item = 0', '$$ui ?= {}', '$list = [1, 2]', '@go = -> item'], ['<button @click={raiseFx($$ui, 1)}>a</button>', '{for item in $list}', '  <button @click={raiseFx($$ui, item)}>b</button>', '{end}'])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 2, JSON.stringify(w))
      assert.deepEqual(w.map(m => /\(ligne (\d+)\)/.exec(m)?.[1]).sort(), ['10', '12'])
    })

    it('le message existe en anglais, avec des guillemets anglais et sans « »', async () => {
      setMessagesLang('en')
      const src = composant([FX], ['$$ui ?= { coinFx: null }', '@go = ->', "  raiseFx($$ui, 'x')"], [BOUTON])
      const w = await lignesDe(src, 'essai', { sourceDir: SRC })
      assert.equal(w.length, 1, JSON.stringify(w))
      assert.match(w[0], /'essai\.mjs' \(line 6\): raiseFx writes to \$\$ui, received as an argument \(line 2 of 'shared\/fx\.js'\)\. MJS/)
      assert.match(w[0], /changes the store value but redraws nothing/)
      assert.match(w[0], /Write to the store from the component, or have raiseFx return the value and write it in the component\./)
      assert.doesNotMatch(w[0], /[«»]|does not apply|only reads/)
      assert.ok(w[0].endsWith('[lint.reactivity]'), w[0])
    })
  })

  describe("avertit pour chaque forme d'écriture dans le paramètre (la ligne du .js est celle de l'écriture)", () => {
    // chaque forme est écrite sur la ligne 2 du module ; `f(p, v, k)` écrit dans `p`
    // clear, add, delete et set ne comptent que sous la forme d'une collection (Map, Set) : leurs arguments sont donnés en regard
    const MUTATEURS   = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']
    const COLLECTIONS = [['clear', ''], ['add', 'v'], ['delete', 'v'], ['set', 'k, v']]
    const ECRITURES: Array<[string, string]> = [
      ['affectation à un membre', 'p.x = v'],
      ['affectation à une clé calculée', 'p[k] = v'],
      ['affectation à un membre profond', 'p.a.b = v'],
      ['affectation composée', 'p.n += v'],
      ['incrément', 'p.n++'],
      ['décrément préfixé', '--p.a.n'],
      ['delete', 'delete p.x'],
      ['méthode qui modifie, sur le paramètre', 'p.push(v)'],
      ['Object.assign', 'Object.assign(p, { x: v })'],
      ['Object.assign sur un membre', 'Object.assign(p.sub, { x: v })'],
      ['Object.defineProperty', "Object.defineProperty(p, 'x', { value: v })"],
      ['écriture en chaîne optionnelle', 'p.list?.push(v)'],
      ...MUTATEURS.map((m): [string, string] => [`${m}() sur un membre`, `p.list.${m}(v)`]),
      ...COLLECTIONS.map(([m, args]): [string, string] => [`${m}(${args}) sur un membre`, `p.list.${m}(${args})`]),
    ]
    ECRITURES.forEach(([nom, ecriture], i) => {
      it(nom + ' : ' + ecriture, async () => {
        const fichier = `shared/w-${i}.js`
        const dir     = sources({ [fichier]: `export function f(p, v, k) {\n  ${ecriture}\n}\n` })
        const src     = composant([`@import f '${fichier}'`], ['$$ui ?= {}', '@go = ->', "  f($$ui, 1, 'k')"], [BOUTON])
        const w       = await lignesDe(src, 'essai', { sourceDir: dir })
        assert.equal(w.length, 1, JSON.stringify(w))
        assert.ok(w[0].includes(`f écrit dans $$ui, reçu en argument (ligne 2 de '${fichier}')`), w[0])
      })
    })

    // forme de la fonction exportée → [nom, lignes du module, ligne de l'@import, appel, ligne de l'écriture]
    const FORMES: Array<[string, string[], string, string, number]> = [
      ['export function', ['export function f(p) {', '  p.x = 1', '}'], "@import f 'shared/s.js'", 'f($$ui)', 2],
      ['export async function', ['export async function f(p) {', '  p.x = 1', '}'], "@import f 'shared/s.js'", 'f($$ui)', 2],
      ['export function*', ['export function* f(p) {', '  p.x = 1', '}'], "@import f 'shared/s.js'", 'f($$ui)', 2],
      ['export const, flèche', ['export const f = (p) => {', '  p.x = 1', '}'], "@import f 'shared/s.js'", 'f($$ui)', 2],
      ['export const, flèche sans accolades', ['export const f = (p) =>', '  p.x = 1'], "@import f 'shared/s.js'", 'f($$ui)', 2],
      ['export const, flèche à un paramètre sans parenthèses', ['export const f = p => {', '  p.x = 1', '}'], "@import f 'shared/s.js'", 'f($$ui)', 2],
      ['export const, function', ['export const f = function (p) {', '  p.x = 1', '}'], "@import f 'shared/s.js'", 'f($$ui)', 2],
      ['export { f }', ['function f(p) {', '  p.x = 1', '}', 'export { f }'], "@import f 'shared/s.js'", 'f($$ui)', 2],
      ['export { g as f }', ['function g(p) {', '  p.x = 1', '}', 'export { g as f }'], "@import f 'shared/s.js'", 'f($$ui)', 2],
      ['export { f } d\'une constante', ['const f = (p) => {', '  p.x = 1', '}', 'export { f }'], "@import f 'shared/s.js'", 'f($$ui)', 2],
      ['export default function', ['export default function (p) {', '  p.x = 1', '}'], "@import default f 'shared/s.js'", 'f($$ui)', 2],
      ['export default function nommée', ['export default function g(p) {', '  p.x = 1', '}'], "@import default f 'shared/s.js'", 'f($$ui)', 2],
      ['export default, flèche', ['export default (p) => {', '  p.x = 1', '}'], "@import default f 'shared/s.js'", 'f($$ui)', 2],
      ['export default f', ['const f = (p) => {', '  p.x = 1', '}', 'export default f'], "@import default f 'shared/s.js'", 'f($$ui)', 2],
      ["méthode d'un objet exporté par défaut", ['export default {', '  raise(p) {', '    p.x = 1', '  },', '}'], "@import default fx 'shared/s.js'", 'fx.raise($$ui)', 3],
      ["propriété flèche d'un objet exporté par son nom", ['export const fx = {', '  raise: (p) => {', '    p.x = 1', '  },', '}'], "@import fx 'shared/s.js'", 'fx.raise($$ui)', 3],
      ['méthode dans un objet imbriqué', ['export const fx = {', '  ui: {', '    raise(p) {', '      p.x = 1', '    },', '  },', '}'], "@import fx 'shared/s.js'", 'fx.ui.raise($$ui)', 4],
      ["méthode d'un objet exporté par un identifiant", ['const fx = {', '  raise(p) {', '    p.x = 1', '  },', '}', 'export default fx'], "@import default fx 'shared/s.js'", 'fx.raise($$ui)', 3],
      ['méthode appelée en chaîne optionnelle', ['export const fx = {', '  raise(p) {', '    p.x = 1', '  },', '}'], "@import fx 'shared/s.js'", 'fx?.raise($$ui)', 3],
      ["constructeur d'une classe", ['export class Fx {', '  constructor(p) {', '    p.x = 1', '  }', '}'], "@import Fx 'shared/s.js'", 'new Fx($$ui)', 3],
      ['paramètre déstructuré', ['export const f = ({ list }) => list.push(1)'], "@import f 'shared/s.js'", 'f($$ui)', 1],
      ['paramètre déstructuré, renommé et profond', ['export function f({ a: { items: rows } }) {', '  rows.push(1)', '}'], "@import f 'shared/s.js'", 'f($$ui)', 2],
      ['paramètre avec valeur par défaut', ['export function f(p = {}) {', '  p.x = 1', '}'], "@import f 'shared/s.js'", 'f($$ui)', 2],
      ['alias local du paramètre', ['export function f(p) {', '  const u = p', '  u.x = 1', '}'], "@import f 'shared/s.js'", 'f($$ui)', 3],
      ["alias local d'un membre", ['export function f(p) {', '  const list = p.list', '  list.push(1)', '}'], "@import f 'shared/s.js'", 'f($$ui)', 3],
      ["alias d'un alias", ['export function f(p) {', '  const u = p', '  const w = u.sub', '  w.x = 1', '}'], "@import f 'shared/s.js'", 'f($$ui)', 4],
      ['déstructuration locale', ['export function f(p) {', '  const { list } = p', '  list.push(1)', '}'], "@import f 'shared/s.js'", 'f($$ui)', 3],
      ['écriture dans une fonction interne', ['export function f(p, items) {', '  items.forEach(() => {', '    p.n++', '  })', '}'], "@import f 'shared/s.js'", 'f($$ui, [])', 3],
      ['première écriture quand il y en a plusieurs', ['export function f(p) {', '  p.a = 1', '  p.b = 2', '}'], "@import f 'shared/s.js'", 'f($$ui)', 2],
    ]
    FORMES.forEach(([nom, js, importe, appel, ligne]) => {
      it(nom + ' : ' + appel, async () => {
        const dir = sources({ 'shared/s.js': js.join('\n') + '\n' })
        const src = composant([importe], ['$$ui ?= {}', '@go = ->', '  ' + appel], [BOUTON])
        const w   = await lignesDe(src, 'essai', { sourceDir: dir })
        assert.equal(w.length, 1, JSON.stringify(w))
        assert.match(w[0], new RegExp(`reçu en argument \\(ligne ${ligne} de 'shared/s\\.js'\\)`), w[0])
      })
    })
  })

  describe("clear, add, delete et set : le nom ne suffit pas, la forme d'une collection est exigée (clear() sans argument, add(x) et delete(x) à un argument, set(k, v) à deux)", () => {
    // [raison, lignes du module] ; `f` reçoit le magasin dans son premier paramètre
    const SIGNALES: Array<[string, string[]]> = [
      ['clear() sans argument, sur un membre', ['export function f(p) {', '  p.list.clear()', '}']],
      ['add(x) à un argument, sur un membre', ['export function f(p, x) {', '  p.ids.add(x)', '}']],
      ['delete(x) à un argument, sur un membre', ['export function f(p, x) {', '  p.ids.delete(x)', '}']],
      ['set(k, v) à deux arguments, sur un membre', ['export function f(p, k, v) {', '  p.map.set(k, v)', '}']],
      ['clear() sur le paramètre lui-même', ['export function f(p) {', '  p.clear()', '}']],
      ['add(x) sur un membre profond, en chaîne optionnelle', ['export function f(p, x) {', '  p.a.b?.ids.add(x)', '}']],
      ['set avec des expressions pour arguments', ['export function f(p, k, v) {', "  p.map.set(k + '-1', { n: v })", '}']],
      ['un alias de la collection', ['export function f(p, x) {', '  const ids = p.ids', '  ids.add(x)', '}']],
      ["les méthodes de tableau ne dépendent pas des arguments : push(a, b)", ['export function f(p, a, b) {', '  p.list.push(a, b)', '}']],
      ['pop() sans argument', ['export function f(p) {', '  p.list.pop()', '}']],
      ['sort() sans argument', ['export function f(p) {', '  p.list.sort()', '}']],
      ['splice(0, 1, x)', ['export function f(p, x) {', '  p.list.splice(0, 1, x)', '}']],
    ]
    SIGNALES.forEach(([raison, js]) => {
      it('signalé : ' + raison, async () => {
        const dir = sources({ 'shared/c.js': js.join('\n') + '\n' })
        const src = composant(["@import f 'shared/c.js'"], ['$$ui ?= {}', '@go = ->', "  f($$ui, 1, 'k', 2)"], [BOUTON])
        const w   = await lignesDe(src, 'essai', { sourceDir: dir })
        assert.equal(w.length, 1, JSON.stringify(w))
        assert.match(w[0], /reçu en argument \(ligne \d+ de 'shared\/c\.js'\)/)
      })
    })

    const MUETS: Array<[string, string[]]> = [
      ["une horloge injectée : env.clear(recount) n'est pas une collection", ['export function f(env, recount) {', '  env.clear(recount)', '}']],
      ["la même horloge dans une fonction interne (un module qui reçoit son environnement)", ['export function f(env) {', '  let recount = null', '  function signal() {', '    if (recount) env.clear(recount)', '    recount = env.later(signal, 10)', '  }', '  return { signal }', '}']],
      ['clear(x) à un argument, sur un membre', ['export function f(p, x) {', '  p.timers.clear(x)', '}']],
      ['clear(x) à un argument, sur le paramètre lui-même', ['export function f(p, x) {', '  p.clear(x)', '}']],
      ['add() sans argument', ['export function f(p) {', '  p.ids.add()', '}']],
      ['add(x, y) à deux arguments', ['export function f(p, x, y) {', '  p.ids.add(x, y)', '}']],
      ['delete() sans argument', ['export function f(p) {', '  p.ids.delete()', '}']],
      ['delete(x, y) à deux arguments', ['export function f(p, x, y) {', '  p.ids.delete(x, y)', '}']],
      ['set(k) à un seul argument', ['export function f(p, k) {', '  p.map.set(k)', '}']],
      ['set(k, v, w) à trois arguments', ['export function f(p, k, v, w) {', '  p.map.set(k, v, w)', '}']],
      ["un argument étalé : le nombre d'arguments ne se lit pas, on ne devine pas", ['export function f(p, xs) {', '  p.ids.add(...xs)', '  p.map.set(...xs)', '}']],
    ]
    MUETS.forEach(([raison, js]) => {
      it('muet : ' + raison, async () => {
        const dir = sources({ 'shared/c.js': js.join('\n') + '\n' })
        const src = composant(["@import f 'shared/c.js'"], ['$$ui ?= {}', '@go = ->', "  f($$ui, 1, 'k', 2)"], [BOUTON])
        assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: dir }), [])
      })
    })
  })

  describe("n'avertit pas : la fonction du .js n'écrit pas dans ce qu'elle reçoit", () => {
    // [raison, lignes du module] ; `f(p)` reçoit le magasin
    const MUETS: Array<[string, string[]]> = [
      ['elle ne fait que lire', ['export function f(p) {', '  return p.a + p.b.c', '}']],
      ['elle lit et trie une copie', ['export function f(p) {', '  return [...p.list].sort()', '}']],
      ['elle trie une tranche', ['export function f(p) {', '  return p.list.slice().sort()', '}']],
      ['elle écrit dans le résultat de filter', ['export function f(p) {', '  const r = p.list.filter(Boolean)', '  r.push(1)', '  return r', '}']],
      ['elle écrit dans une copie par étalement', ['export function f(p) {', '  const c = { ...p }', '  c.x = 1', '  return c', '}']],
      ['elle écrit dans une copie profonde', ['export function f(p) {', '  const c = structuredClone(p)', '  c.x = 1', '  return c', '}']],
      ['elle écrit dans un objet neuf', ['export function f(p) {', '  const out = {}', '  out.x = p.x', '  return out', '}']],
      ['elle rebranche son paramètre sur une copie avant d\'écrire', ['export function f(p) {', '  p = { ...p }', '  p.x = 1', '  return p', '}']],
      ["elle écrit dans l'élément d'un rappel qui porte le même nom que le paramètre", ['export function f(p, autres) {', '  return autres.map(p => { p.x = 1; return p })', '}']],
      ['elle écrit dans son second paramètre seulement', ['export function f(p, q) {', '  q.x = 1', '}']],
      ['elle réaffecte seulement la variable locale', ['export function f(p) {', '  p = 1', '  return p', '}']],
      ['elle compte avec un alias reçu deux fois (liaison ambiguë)', ['export function f(p) {', '  const u = p', '  { const u = {}; u.x = 1 }', '  return u', '}']],
      ['elle rend une valeur neuve sans rien écrire (le remède)', ['export function f(p, v) {', '  return { ...p, n: v }', '}']],
      ['elle délègue à une autre fonction', ['function aide(q) {', '  q.x = 1', '}', 'export function f(p) {', '  return aide(p)', '}']],
      ['elle délègue à une autre fonction importée', ["import { aide } from './aide.js'", 'export function f(p) {', '  return aide(p)', '}']],
      ['elle passe son paramètre à une méthode', ['export function f(p) {', '  return JSON.stringify(p)', '}']],
      ["elle écrit dans une variable du module (l'alias sort de la fonction)", ['let dernier = null', 'export function f(p) {', '  dernier = p', '  return dernier', '}']],
    ]
    MUETS.forEach(([raison, js]) => {
      it(raison, async () => {
        const dir = sources({ 'shared/s.js': js.join('\n') + '\n' })
        const src = composant(["@import f 'shared/s.js'"], ['$$ui ?= {}', '@go = ->', '  f($$ui, 1)'], [BOUTON, '<p>{f($$ui)}</p>'])
        assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: dir }), [])
      })
    })

    it('le remède $$ui = regler($$ui, v) : la fonction rend une valeur neuve, rien à dire', async () => {
      const dir = sources({ 'shared/regler.js': 'export function regler(ui, v) {\n  return { ...ui, n: v }\n}\n' })
      const src = composant(["@import regler 'shared/regler.js'"], ['$$ui ?= { n: 0 }', '@go = ->', "  $$ui = regler($$ui, 'x')"], [BOUTON])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: dir }), [])
    })

    it("le remède dans un gestionnaire du HTML : @click={$$ui = regler($$ui, 1)}", async () => {
      const dir = sources({ 'shared/regler.js': 'export function regler(ui, v) {\n  return { ...ui, n: v }\n}\n' })
      const src = composant(["@import regler 'shared/regler.js'"], ['$$ui ?= { n: 0 }'], ['<button @click={$$ui = regler($$ui, 1)}>go</button>'])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: dir }), [])
    })

    it('lire seulement, dans le HTML : {lire($$ui)}', async () => {
      const src = composant(["@import lire 'shared/duo.js'"], ['$$ui ?= {}'], ['<p>{lire($$ui)}</p>'])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: SRC }), [])
    })
  })

  describe("n'avertit pas : on ne devine pas (fichier ou fonction qu'on ne peut pas lire)", () => {
    const appel = (importe: string) => composant([importe], ['$$ui ?= {}', '@go = ->', '  f($$ui)'], [BOUTON])

    it('un fichier absent', async () => {
      assert.deepEqual(await lignesDe(appel("@import f 'shared/absent.js'"), 'essai', { sourceDir: SRC }), [])
    })

    it("un fichier qui n'est pas du JavaScript valide", async () => {
      const dir = sources({ 'shared/casse.js': 'export function f(p) {\n  p.x = \n' })
      assert.deepEqual(await lignesDe(appel("@import f 'shared/casse.js'"), 'essai', { sourceDir: dir }), [])
    })

    it('un fichier hors du dossier des sources', async () => {
      const dehors = sources({ 'hors.js': 'export function f(p) {\n  p.x = 1\n}\n' })
      const dir    = join(dehors, 'src')
      mkdirSync(dir)
      assert.deepEqual(await lignesDe(appel("@import f '../hors.js'"), 'essai', { sourceDir: dir }), [])
    })

    it('un dossier à la place du fichier', async () => {
      const dir = sources({ 'shared/dossier.js/index.js': 'export function f(p) {\n  p.x = 1\n}\n' })
      assert.deepEqual(await lignesDe(appel("@import f 'shared/dossier.js'"), 'essai', { sourceDir: dir }), [])
    })

    it('sans dossier des sources (transpile appelé seul)', async () => {
      assert.deepEqual(await lignesDe(appel(FX.replace('raiseFx', 'f')), 'essai'), [])
    })

    it("une fonction que le fichier n'exporte pas", async () => {
      assert.deepEqual(await lignesDe(appel("@import f 'shared/fmt.js'"), 'essai', { sourceDir: SRC }), [])
    })

    it('une fonction ré-exportée depuis un autre fichier (non suivie)', async () => {
      const dir = sources({ 'shared/ecrit.js': 'export function f(p) {\n  p.x = 1\n}\n', 'shared/relais.js': "export { f } from './ecrit.js'\n", 'shared/tout.js': "export * from './ecrit.js'\n" })
      assert.deepEqual(await lignesDe(appel("@import f 'shared/relais.js'"), 'essai', { sourceDir: dir }), [])
      assert.deepEqual(await lignesDe(appel("@import f 'shared/tout.js'"), 'essai', { sourceDir: dir }), [])
    })

    it("une valeur exportée qui n'est pas une fonction qu'on sache lire (appel de fabrique)", async () => {
      const dir = sources({ 'shared/usine.js': 'const fabrique = (n) => (p) => { p.x = n }\nexport const f = fabrique(1)\n' })
      assert.deepEqual(await lignesDe(appel("@import f 'shared/usine.js'"), 'essai', { sourceDir: dir }), [])
    })

    it("un autre fichier que du .js (copié tel quel aussi, jamais lu)", async () => {
      const dir = sources({ 'shared/donnees.json': '{"f": 1}\n' })
      assert.deepEqual(await lignesDe(appel("@import f 'shared/donnees.json'"), 'essai', { sourceDir: dir }), [])
    })
  })

  describe('un lien symbolique du dossier des sources : le fichier réel doit être sous ce dossier', () => {
    const ECRIT = 'export function f(p) {\n  p.x = 1\n}\n'
    const appel = (importe: string) => composant([importe], ['$$ui ?= {}', '@go = ->', '  f($$ui)'], [BOUTON])

    it("un lien vers un fichier hors du dossier des sources : rien, comme un chemin .. (le même contenu écrit en dur est dit)", async () => {
      const dehors = sources({ 'cible.js': ECRIT })
      const dir    = sources({ 'shared/dedans.js': ECRIT })
      symlinkSync(join(dehors, 'cible.js'), join(dir, 'shared/lien.js'))
      assert.equal((await lignesDe(appel("@import f 'shared/dedans.js'"), 'essai', { sourceDir: dir })).length, 1)
      assert.deepEqual(await lignesDe(appel("@import f 'shared/lien.js'"), 'essai', { sourceDir: dir }), [])
    })

    it('un dossier lié vers l\'extérieur : shared/dossier-lien/cible.js, rien', async () => {
      const dehors = sources({ 'cible.js': ECRIT })
      const dir    = sources({ 'shared/dedans.js': ECRIT })
      symlinkSync(dehors, join(dir, 'shared/dossier-lien'))
      assert.equal((await lignesDe(appel("@import f 'shared/dedans.js'"), 'essai', { sourceDir: dir })).length, 1)
      assert.deepEqual(await lignesDe(appel("@import f 'shared/dossier-lien/cible.js'"), 'essai', { sourceDir: dir }), [])
    })

    it('un lien vers un fichier du dossier des sources : le fichier réel est lu, l\'écriture est dite', async () => {
      const dir = sources({ 'shared/reel.js': ECRIT })
      symlinkSync(join(dir, 'shared/reel.js'), join(dir, 'shared/lien.js'))
      const w = await lignesDe(appel("@import f 'shared/lien.js'"), 'essai', { sourceDir: dir })
      assert.equal(w.length, 1, JSON.stringify(w))
      assert.match(w[0], /reçu en argument \(ligne 2 de 'shared\/lien\.js'\)/)
    })

    it('un dossier lié vers un autre dossier des sources : les fichiers y sont lus', async () => {
      const dir = sources({ 'vrai/cible.js': ECRIT, 'shared/vide.txt': '' })
      symlinkSync(join(dir, 'vrai'), join(dir, 'shared/dossier-lien'))
      const w = await lignesDe(appel("@import f 'shared/dossier-lien/cible.js'"), 'essai', { sourceDir: dir })
      assert.equal(w.length, 1, JSON.stringify(w))
    })

    it('le dossier des sources est lui-même un lien : ses fichiers sont lus', async () => {
      const reel = sources({ 'shared/dedans.js': ECRIT })
      const hote = sources({})
      symlinkSync(reel, join(hote, 'src'))
      const w = await lignesDe(appel("@import f 'shared/dedans.js'"), 'essai', { sourceDir: join(hote, 'src') })
      assert.equal(w.length, 1, JSON.stringify(w))
    })

    it('un lien cassé : rien, sans erreur', async () => {
      const dir = sources({ 'shared/dedans.js': ECRIT })
      symlinkSync(join(dir, 'shared/absent.js'), join(dir, 'shared/casse.js'))
      assert.equal((await lignesDe(appel("@import f 'shared/dedans.js'"), 'essai', { sourceDir: dir })).length, 1)
      assert.deepEqual(await lignesDe(appel("@import f 'shared/casse.js'"), 'essai', { sourceDir: dir }), [])
    })
  })

  describe('un module .js de plus de 1 Mo : jamais lu (silence, comme un fichier illisible)', () => {
    const LIMITE = 1024 * 1024
    const ECRIT  = 'export function f(p) {\n  p.x = 1\n}\n'
    const appel  = composant(["@import f 'shared/g.js'"], ['$$ui ?= {}', '@go = ->', '  f($$ui)'], [BOUTON])
    // le module qui écrit, suivi d'un commentaire qui le porte à la taille voulue (en octets)
    const pese = (octets: number): string => ECRIT + '//' + 'x'.repeat(octets - ECRIT.length - 3) + '\n'

    it('à la limite exacte (1 Mo) : le fichier est lu, l\'écriture est dite', async () => {
      const dir = sources({ 'shared/g.js': pese(LIMITE) })
      assert.equal(statSync(join(dir, 'shared/g.js')).size, LIMITE)
      assert.equal((await lignesDe(appel, 'essai', { sourceDir: dir })).length, 1)
    })

    it('un octet de plus : rien', async () => {
      const dir = sources({ 'shared/g.js': pese(LIMITE + 1) })
      assert.equal(statSync(join(dir, 'shared/g.js')).size, LIMITE + 1)
      assert.deepEqual(await lignesDe(appel, 'essai', { sourceDir: dir }), [])
    })

    it('un module de code ordinaire de 1,3 Mo (des milliers de fonctions, la dernière écrit) : rien', async () => {
      const bloc = (n: number): string => `export function morceau${n}(a) {\n  const o = { a: a, b: [1, 2, 3], c: 'texte' }\n  return o.a + o.b.length\n}\n`
      let code = ''
      for (let i = 0; code.length < 1.3 * LIMITE; i++) code += bloc(i)
      const dir = sources({ 'shared/g.js': code + ECRIT })
      assert.ok(statSync(join(dir, 'shared/g.js')).size > LIMITE)
      assert.deepEqual(await lignesDe(appel, 'essai', { sourceDir: dir }), [])
    })

    it('le même module sous la limite est lu : la fonction qui écrit est dite', async () => {
      const dir = sources({ 'shared/g.js': pese(LIMITE - 1000) })
      assert.equal((await lignesDe(appel, 'essai', { sourceDir: dir })).length, 1)
    })
  })

  describe("n'avertit pas : ce qui n'est pas un module .js copié tel quel", () => {
    it("une fonction importée d'un module .civet : l'écriture sur $$x y est suivie", async () => {
      const src = composant(["@import raiseFx 'shared/fx.civet'"], ['$$ui ?= {}', '@go = ->', '  raiseFx($$ui, 1)'], [BOUTON, '<p>{raiseFx($$ui)}</p>'])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: SRC }), [])
    })

    it("une fonction importée d'un module .coffee", async () => {
      const src = composant(["@import raiseFx 'shared/fx.coffee'"], ['$$ui ?= {}', '@go = ->', '  raiseFx($$ui, 1)'], [BOUTON])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: SRC }), [])
    })

    it('une fonction locale du <script>', async () => {
      const src = composant([], ['$$ui ?= {}', 'raiseFx = (ui, spec) -> ui.coinFx = spec', '@go = ->', "  raiseFx($$ui, 'x')"], [BOUTON])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: SRC }), [])
    })

    it("une fonction inconnue du build (rien n'est importé sous ce nom)", async () => {
      const src = composant([FX], ['$$ui ?= {}', '@go = ->', '  autre($$ui)'], [BOUTON])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: SRC }), [])
    })

    it("un nom d'import masqué par un paramètre : la fonction appelée n'est plus l'import", async () => {
      const src = composant([FX], ['$$ui ?= {}', '@go = (raiseFx) ->', '  raiseFx($$ui)'], [BOUTON])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: SRC }), [])
    })

    it("un argument qui n'est pas pris dans le magasin : état $x, littéral, nombre", async () => {
      const src = composant([FX], ['$ui = {}', '@go = ->', "  raiseFx($ui, 'x')", '  raiseFx(3, "x")'], [BOUTON, '<p>{raiseFx($ui)}</p>'])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: SRC }), [])
    })

    it('un magasin lu hors appel : aucun avertissement', async () => {
      const src = composant([FX], ['$$ui ?= { n: 1 }', '@go = ->', '  copie = $$ui.n + 1', '  $$ui.n = copie'], [BOUTON, '<p>{$$ui.n}</p>'])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: SRC }), [])
    })

    it("µread $$ui en argument : l'accès brut est demandé en toutes lettres, rien n'est signalé", async () => {
      const src = composant([FX], ['$$ui ?= {}', '@go = ->', '  raiseFx(µread($$ui), 1)'], [BOUTON])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: SRC }), [])
    })

    it('µlang et µtheme : propriétés du framework (des chaînes), pas un magasin écrit par le développeur', async () => {
      const src = composant([FMT], ['@go = ->', '  a = fmt(1, µlang)', '  b = fmt(µtheme)'], [BOUTON, '<p>{fmt(2, µlang)}</p>'])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: SRC }), [])
    })

    it('un magasin rangé dans un objet ou un tableau littéral, ou copié par étalement : non suivi', async () => {
      const src = composant([FX], ['$$ui ?= {}', '@go = ->', '  raiseFx({ ui: $$ui })', '  raiseFx([$$ui])', '  raiseFx({ ...$$ui })'], [BOUTON])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: SRC }), [])
    })

    it("une adresse https:// : ce n'est pas un module du projet", async () => {
      const src = composant(["@import raiseFx 'https://cdn.example.com/fx.js'"], ['$$ui ?= {}', '@go = ->', '  raiseFx($$ui, 1)'], [BOUTON])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: SRC }), [])
    })

    it('un module .js jamais appelé avec un magasin : rien', async () => {
      const src = composant([FX], ['$$ui ?= {}', '@go = ->', "  raiseFx('x', 2)"], [BOUTON])
      assert.deepEqual(await lignesDe(src, 'essai', { sourceDir: SRC }), [])
    })
  })

  it("n'ajoute rien au code émis : la sortie est la même avec et sans l'avertissement", async () => {
    const src = composant([FX], ['$$ui ?= { coinFx: null }', '@go = ->', "  raiseFx($$ui, 'x')"], [BOUTON, '<p>{raiseFx($$ui)}</p>'])
    assert.equal(await outputOf(src, 'essai-sortie', { sourceDir: SRC }), await outputOf(src, 'essai-sortie', { sourceDir: SRC, lint: { reactivity: false } }))
  })

  describe('se coupe comme tout le type', () => {
    const src = composant([FX], ['$$ui ?= { coinFx: null }', '@go = ->', "  raiseFx($$ui, 'x')"], [BOUTON, '<p>{raiseFx($$ui)}</p>'])

    it('lint.reactivity: false : plus rien, ni dans le script ni dans le HTML', async () => {
      assert.ok((await lignesDe(src, 'essai-on', { sourceDir: SRC })).length >= 2)
      assert.deepEqual(await lignesDe(src, 'essai-off', { sourceDir: SRC, lint: { reactivity: false } }), [])
    })

    it('lint.a11y: false ne coupe pas celui-ci', async () => {
      assert.ok((await lignesDe(src, 'essai-autre', { sourceDir: SRC, lint: { a11y: false } })).length >= 2)
    })
  })

  describe("l'analyse d'un module .js est gardée par chemin et date de modification", () => {
    const appel = composant(["@import f 'shared/m.js'"], ['$$ui ?= {}', '@go = ->', '  f($$ui)'], [BOUTON])
    const ECRIT = 'export function f(p) {\n  p.x = 1\n}\n'
    const LIT   = 'export function f(p) {\n  p.x < 1\n}\n'

    it('même chemin, même date, même taille : le verdict gardé sert ; une autre date : le fichier est relu', async () => {
      assert.equal(ECRIT.length, LIT.length)
      const dir  = sources({ 'shared/m.js': ECRIT })
      const file = join(dir, 'shared/m.js')
      // date à la milliseconde : elle se remet à l'identique plus bas
      const date = new Date(Date.now() - 60000)
      utimesSync(file, date, date)
      assert.equal((await lignesDe(appel, 'essai', { sourceDir: dir })).length, 1)
      // le contenu change mais la date et la taille restent : le verdict gardé répond encore (preuve que rien n'est relu)
      writeFileSync(file, LIT)
      utimesSync(file, date, date)
      assert.equal((await lignesDe(appel, 'essai', { sourceDir: dir })).length, 1)
      // la date change : le fichier est relu, il ne fait plus qu'une comparaison
      const plus = new Date(date.getTime() + 5000)
      utimesSync(file, plus, plus)
      assert.deepEqual(await lignesDe(appel, 'essai', { sourceDir: dir }), [])
    })

    it('le fichier devient illisible : plus rien, sans erreur', async () => {
      const dir  = sources({ 'shared/m.js': ECRIT })
      const file = join(dir, 'shared/m.js')
      assert.equal((await lignesDe(appel, 'essai', { sourceDir: dir })).length, 1)
      writeFileSync(file, 'export function f(p) {\n  p.x =\n')
      const plus = new Date(statSync(file).mtime.getTime() + 5000)
      utimesSync(file, plus, plus)
      assert.deepEqual(await lignesDe(appel, 'essai', { sourceDir: dir }), [])
    })
  })
})

// bout en bout, vraie CLI lancée depuis les sources (motif de tests/lint-types-avertissements.test.ts)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function cli(commande: string, root: string): { code: number | null, sortie: string } {
  const r = spawnSync('npx', ['tsx', 'src/cli.ts', commande, '--root', root], {
    cwd: repoRoot, encoding: 'utf-8', timeout: 120000, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: undefined },
  })
  return { code: r.status, sortie: (r.stdout ?? '') + (r.stderr ?? '') }
}

function projet(prefixe: string, config: Record<string, unknown> = {}): string {
  const root = mjsTmp(prefixe)
  mkdirSync(join(root, 'src', 'shared'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...config }))
  writeFileSync(join(root, 'src', 'shared', 'fx.js'), 'export function raiseFx(ui, spec) {\n  ui.coinFx = spec;\n}\n')
  writeFileSync(join(root, 'src', 'shared', 'fx.civet'), 'export function raiseFx(ui, spec) {\n  ui.coinFx = spec\n}\n')
  writeFileSync(join(root, 'src', 'shared', 'lit.js'), 'export function lire(ui) {\n  return ui.coinFx;\n}\n')
  writeFileSync(join(root, 'src', 'carte-js.mjs'), composant([FX], ['$$ui ?= { coinFx: null }', '@go = ->', "  raiseFx($$ui, 'depuis-js')"], [BOUTON, '<p class="out">[{$$ui.coinFx}]</p>']))
  writeFileSync(join(root, 'src', 'carte-civet.mjs'), composant(["@import raiseFx 'shared/fx.civet'"], ['$$ui ?= { coinFx: null }', '@go = ->', "  raiseFx($$ui, 'depuis-civet')"], [BOUTON]))
  writeFileSync(join(root, 'src', 'carte-lit.mjs'), composant(["@import lire 'shared/lit.js'"], ['$$ui ?= { coinFx: null }', '@go = ->', '  lire($$ui)'], [BOUTON]))
  return root
}

describe('CLI — mjs build : un module .js qui écrit dans le magasin reçu', function () {
  this.timeout(180000)

  it('la construction réussit et dit une ligne par appel qui écrit, étiquetée [lint.reactivity] ; le module .civet et la fonction qui lit restent muets', () => {
    const r = cli('build', projet('mv-js'))
    assert.equal(r.code, 0, r.sortie)
    const lignes = r.sortie.split('\n').filter(l => MOTIF.test(l))
    assert.equal(lignes.length, 1, r.sortie)
    assert.match(lignes[0], /'carte-js\.mjs' \(ligne 6\)/)
    assert.match(lignes[0], /raiseFx écrit dans \$\$ui, reçu en argument \(ligne 2 de 'shared\/fx\.js'\)/)
    assert.ok(lignes[0].trimEnd().endsWith('[lint.reactivity]'), lignes[0])
    assert.match(r.sortie, /Pour couper un type : "lint"/)
  })

  it('"lint": { "reactivity": false } : plus aucune ligne, la construction réussit toujours', () => {
    const r = cli('build', projet('mv-js-off', { lint: { reactivity: false } }))
    assert.equal(r.code, 0, r.sortie)
    assert.doesNotMatch(r.sortie, /reçu en argument \(ligne/)
    assert.doesNotMatch(r.sortie, /\[lint\.reactivity\]/)
  })
})
