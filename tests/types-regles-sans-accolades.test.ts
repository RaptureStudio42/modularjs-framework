// Types — une règle d'objet ne s'écrit jamais entre accolades : en retrait, un champ par ligne, dans un bloc <types> comme dans
// <vars> ; une liste d'objets, ou un objet qui peut valoir null, passe par un type nommé. Un `{` qui ouvre un objet arrête la
// construction, en développement comme en production, avec sa ligne et la forme à écrire ; aucun message ne montre une règle
// entre accolades

import assert from 'node:assert/strict'
import { parseRule, parseVarsBlock, parseTypesBlock, resolveRule, ruleText, emitRuntimeRule, compileVars, storeRuleShown } from '../src/transpiler/var-types.js'
import { rule, rules } from '../src/rules/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { fr } from '../src/messages/fr.js'
import { en } from '../src/messages/en.js'

const VARS = (lignes: string[]): string => ['', ...lignes, ''].join('\n')

function refus(f: () => unknown): string {
  try {
    f()
  }
  catch (e: any) {
    return e.message
  }
  return assert.fail('la construction aurait dû s\'arrêter')
}

describe('types — plus d\'accolades dans les règles : un objet en retrait, un champ par ligne', () => {
  afterEach(() => setMessagesLang('fr'))

  it('<vars> : un objet entre accolades arrête la construction, avec sa ligne et la forme en retrait à écrire (fr, en)', () => {
    const texte = VARS(['  $volume  int 0..100', '  $user  { name: string 1..40, age?: int 0.. }'])
    assert.equal(refus(() => parseVarsBlock(texte, 10)), "[ModularJS] <vars>, ligne 12 : une règle d'objet ne s'écrit pas entre accolades — écrivez-la en retrait, un champ par ligne :\n  $user\n    name  string 1..40\n    age?  int 0..")
    for (const mode of [true, false, 'names'] as const) assert.match(refus(() => compileVars({ raw: texte, startLine: 10 }, {}, mode)), /ligne 12 : une règle d'objet ne s'écrit pas entre accolades/)
    setMessagesLang('en')
    assert.equal(refus(() => parseVarsBlock(texte, 10)), '[ModularJS] <vars>, line 12: an object rule is not written between braces — write it indented, one field per line:\n  $user\n    name  string 1..40\n    age?  int 0..')
  })

  it('liste d\'objets, objet ou null, strict : le type nommé à déclarer, puis la ligne qui s\'en sert (fr, en)', () => {
    assert.equal(refus(() => parseVarsBlock(VARS(['$items  { id: int 1.., title: string }[] ..50']), 1)), "[ModularJS] <vars>, ligne 2 : une règle d'objet ne s'écrit pas entre accolades ; dans une liste, une union ou avec strict, elle passe par un type nommé — déclarez-le dans un fichier *.types.mjs, en retrait, un champ par ligne :\n  Item\n    id  int 1..\n    title  string\npuis servez-vous de son nom :\n  $items  Item[] ..50")
    assert.match(refus(() => parseVarsBlock(VARS(['$challenge  { id: int } | null']), 1)), /:\n {2}Challenge\n {4}id {2}int\n[^\n]+\n {2}\$challenge {2}Challenge \| null$/)
    assert.match(refus(() => parseVarsBlock(VARS(['$$cart  { qty: int 1..99 } strict']), 1)), /\n {2}Cart\n {4}qty {2}int 1\.\.99\n[^\n]+\n {2}\$\$cart {2}Cart strict$/)
    setMessagesLang('en')
    assert.equal(refus(() => parseVarsBlock(VARS(['$items  { id: int }[]']), 1)), '[ModularJS] <vars>, line 2: an object rule is not written between braces; in a list, a union or with strict, it goes through a named type — declare it in a *.types.mjs file, indented, one field per line:\n  Item\n    id  int\nthen use its name:\n  $items  Item[]')
  })

  it('<types> : sur sa ligne, dans un champ en retrait, sur plusieurs lignes, avec une valeur de départ — la ligne du {', () => {
    assert.equal(refus(() => parseTypesBlock(VARS(['Reward  { id: int 1.., price = 0: int 0.. }']), 1)), "[ModularJS] <types>, ligne 2 : une règle d'objet ne s'écrit pas entre accolades — écrivez-la en retrait, un champ par ligne :\n  Reward\n    id  int 1..\n    price = 0  int 0..")
    assert.match(refus(() => parseTypesBlock(VARS(['User', '  name  string', '  address  { city: string, zip?: string /^[0-9]{5}$/ }']), 1)), /<types>, ligne 4 : [^\n]+:\n {2}address\n {4}city {2}string\n {4}zip\? {2}string \/\^\[0-9\]\{5\}\$\/$/)
    assert.match(refus(() => parseTypesBlock(VARS(['User', '  tags  { name: string }[]']), 1)), /<types>, ligne 3 : [^\n]+\n {2}Tag\n {4}name {2}string\n[^\n]+\n {2}tags {2}Tag\[\]$/)
    assert.match(refus(() => parseVarsBlock(VARS(['$user  {', '    name: string,', '    age: int', '  }']), 1)), /^\[ModularJS\] <vars>, ligne 2 : [^\n]+\n {2}\$user\n {4}name {2}string\n {4}age {2}int$/)
  })

  it('objet vide, objet mal fermé : refusés aussi, le message dit la forme en mots', () => {
    assert.match(refus(() => parseVarsBlock(VARS(['$x  {}']), 1)), /<vars>, ligne 2 : une règle d'objet ne s'écrit pas entre accolades, et un objet sans champ ne s'écrit pas/)
    assert.match(refus(() => parseVarsBlock(VARS(['$x  { a: int']), 1)), /<vars>, ligne 2 : une règle d'objet ne s'écrit pas entre accolades — écrivez-la en retrait sous son nom/)
  })

  it('pas de faux refus : une accolade dans une forme /…/, un texte, un commentaire, une valeur de départ', () => {
    const ok = parseVarsBlock(VARS(['$code  string /^[a-z]{2,4}$/', "$tag  '{x}' | 'y'", '$n  int 0..  # { a: int }']), 1)
    assert.deepEqual(ok.map(e => e.name), ['code', 'tag', 'n'])
    const [d] = parseTypesBlock(VARS(['Tpl', "  motif = '{nom}'  string", '  code  string /^x{3}$/']), 1)
    assert.equal((d.rule as any).fields[0].def, '{nom}')
  })

  it('<vars> : un objet en retrait sous sa variable, valeurs de départ comprises — compilé en développement comme en production', () => {
    const section = { raw: VARS(['  $volume  int 0..100', '  $user', '    name  string 1..40', '    age = 18  int 0..', '    adr', '      city  string', '  $$cart', '    qty = 1  int 1..99']), startLine: 5 }
    const [vol, user, cart] = parseVarsBlock(section.raw, section.startLine)
    assert.deepEqual([vol.name, user.name, cart.name, cart.store], ['volume', 'user', 'cart', true])
    assert.equal(user.line, 7)
    assert.deepEqual((user.rule as any).fields.map((f: any) => [f.key, f.def]), [['name', undefined], ['age', 18], ['adr', undefined]])
    for (const mode of [true, false, 'names'] as const) {
      const c      = compileVars(section, {}, mode)
      const vars   = new Function(`return {${c.vars.join(',')}}`)()
      const stores = new Function(`return {${c.stores.join(',')}}`)()
      assert.equal(vars.user.t, 'o')
      assert.deepEqual(vars.user._mjs_z, { age: 18 })
      assert.equal(vars.user.f.adr.f.city.t, 's')
      assert.deepEqual(stores.cart._mjs_z, { qty: 1 })
      assert.equal(vars.user.d, mode === true ? '\n  name  string 1..40\n  age = 18  int 0..\n  adr\n    city  string' : undefined)
    }
    assert.match(refus(() => compileVars({ raw: VARS(['$user', '  name  strin']), startLine: 1 }, {}, true)), /ligne 3/)
  })

  it('rules() : une règle nommée d\'objet s\'écrit en retrait dans opts.types ; un { y est refusé, avec la forme à écrire', () => {
    const r  = rules({ user: 'User' }, { types: { User: 'name  string 1..40\nage = 18  int 0..' } })
    const ok = r.user['~standard'].validate({ name: 'Ana' }) as any
    assert.equal(ok.issues, undefined)
    assert.equal(ok.value.age, 18)
    assert.ok((r.user['~standard'].validate({ name: 'Ana', age: -1 }) as any).issues)
    assert.match(refus(() => rule('{ age: int }')), /une règle d'objet ne s'écrit pas entre accolades[\s\S]*\n {2}Item\n {4}age {2}int\n[^\n]+\n {2}Item$/)
  })

  it('aucun message ne montre une règle entre accolades : texte des règles, textes du développement, magasins, catalogues fr et en', () => {
    const defs: Record<string, any> = {}
    for (const e of parseTypesBlock(VARS(['Item', '  id  int 1..', '  meta', '    tags = []  string[]', 'Items  Item[] ..10']), 1)) defs[e.name] = e.rule
    const ou = { block: '<vars>', line: 1 }
    for (const usage of ['Item', 'Item[]', 'Item | null', 'Items']) {
      const r = resolveRule(parseRule(usage, ou), defs, ou)
      for (const opts of [{}, { names: true }, { sorted: true }]) assert.doesNotMatch(storeRuleShown(ruleText(r, opts)), /[{}]/, usage)
      assert.doesNotMatch(emitRuntimeRule(r, true).match(/d:"(?:[^"\\]|\\.)*"/g)!.join(' '), /[{}]/, usage)
    }
    assert.equal(ruleText(resolveRule(parseRule('Item[]', ou), defs, ou)), 'Item[]')
    assert.equal(ruleText(defs.Item), '\n  id  int 1..\n  meta\n    tags = []  string[]')
    for (const cat of [fr, en]) {
      for (const [cle, m] of Object.entries(cat)) {
        if (!/^types\.|^bundler\.types/.test(cle)) continue
        let texte: string
        try {
          texte = typeof m === 'function' ? (m as any)(new Proxy({}, { get: () => 'X' })) : String(m)
        }
        catch {
          continue
        }
        assert.doesNotMatch(texte, /\{ *['"]?[A-Za-z_]+['"]?\?? *:/, cle)
      }
    }
  })
})
