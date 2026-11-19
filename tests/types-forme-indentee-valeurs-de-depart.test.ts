// Types — une règle nommée d'objet s'écrit sans accolades : son nom seul sur sa ligne, puis un champ par
// ligne en retrait (`id  int 1..`). Un champ peut porter sa valeur de départ après sa règle (`= 0`) : un
// champ absent (clé manquante ou `undefined`) la prend, `null` suit la règle ; la valeur de départ passe
// elle-même la règle, telle quelle, vérifiée à la construction. La forme entre accolades est refusée.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRule, parseVarsBlock, parseTypesBlock, resolveRule, ruleText, emitRuntimeRule } from '../src/transpiler/var-types.js'
import { collectTypeDefs } from '../src/bundler/types-files.js'
import { poserMessages } from './helpers/messages-stub.js'

const ICI = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(ICI, '../src/runtime/mjs_types.ts'), 'utf-8')
const OU  = { block: '<vars>', line: 1 }

// Reward ligne 2, id 3, title 4, price 5, surprise 6
const CORPS = ['', '  Reward', '    id int 1..', '    title string 1..80', '    price = 0 int 0..', '    surprise = false bool', ''].join('\n')

function makeMu(mode?: 'warn' | 'error'): any {
  const µ: any = {
    warnings: [] as string[],
    warn(m: string) { this.warnings.push(m) },
    _mjs_toRaw: (x: any) => x,
    _mjs_interpolatorSet: new WeakSet(),
    _mjs_storeRaw: {},
    _mjs_storeNotifyKey() {},
    _mjs_storeNotifyDeep() {},
    _runtimeLabelsLang: 'fr',
  }
  if (mode) µ._typesMode = mode
  poserMessages(µ)
  new Function('µ', SRC)(µ)
  return µ
}

// la règle d'un usage (`Reward[]`), résolue sur les règles d'un bloc <types> et compilée comme le fait le build
function regleCompilee(corps: string, usage: string): any {
  const defs: Record<string, any> = {}
  for (const d of parseTypesBlock(corps, 1)) defs[d.name] = d.rule
  return new Function(`return ${emitRuntimeRule(resolveRule(parseRule(usage, OU), defs, OU), true)}`)()
}

describe('types — une règle d\'objet sans accolades, un champ par ligne en retrait', () => {
  it('le nom seul sur sa ligne, puis ses champs : la même règle que la forme entre accolades, valeurs de départ en plus', () => {
    const [d] = parseTypesBlock(CORPS, 1)
    assert.equal(d.name, 'Reward')
    assert.equal(d.line, 2)
    assert.equal(ruleText(d.rule), '\n  id  int 1..\n  title  string 1..80\n  price = 0  int 0..\n  surprise = false  bool')
    assert.deepEqual((d.rule as any).fields.filter((f: any) => 'def' in f).map((f: any) => [f.key, f.def]), [['price', 0], ['surprise', false]])
    // sous une variable du <vars>, la même règle, valeurs de départ comprises
    const sousVariable = parseVarsBlock(['', '$r', ...CORPS.split('\n').slice(2, -1).map(l => '  ' + l.trim())].join('\n'), 1)[0].rule
    assert.equal(ruleText(sousVariable), ruleText(d.rule))
  })

  it('champ facultatif, objet imbriqué en retrait, commentaires et lignes vides', () => {
    const [d] = parseTypesBlock(['', 'Track', '  name string', '  # la durée, quand on la connaît', '  length? int 1..', '', '  meta', '    year int 1900..', '    tags = [] string[]'].join('\n'), 1)
    assert.equal(ruleText(d.rule), '\n  name  string\n  length?  int 1..\n  meta\n    year  int 1900..\n    tags = []  string[]')
  })

  it('plusieurs règles à la suite, en retrait ou sur une ligne', () => {
    const defs = parseTypesBlock(['', '  Percent int 0..100', '  Reward', '    id int 1..', '    vol = 50 Percent', '  Nick string 3..20'].join('\n'), 1)
    assert.deepEqual(defs.map(d => [d.name, d.line]), [['Percent', 2], ['Reward', 3], ['Nick', 6]])
  })

  it('une faute dans un champ cite la ligne du champ', () => {
    assert.throws(() => parseTypesBlock(CORPS.replace('title string 1..80', 'title strin 1..80'), 1), /ligne 4/)
    assert.throws(() => parseTypesBlock(['', 'Reward', '  id', '  title string'].join('\n'), 1), /ligne 3[\s\S]*id/)
    assert.throws(() => parseTypesBlock(['', 'Reward', '  id int', '  id string'].join('\n'), 1), /ligne 4[\s\S]*id/)
  })

  it('une règle nommée inconnue dans un champ : la ligne du champ, avec une suggestion', () => {
    const lire = () => ['<types>', '  Percent int 0..100', '  Reward', '    id int 1..', '    vol = 50 Percnt', '</types>', ''].join('\n')
    assert.throws(() => collectTypeDefs(['app.types.mjs'], lire), /ligne 5[\s\S]*Percent/)
  })
})

describe('types — valeur de départ d\'un champ', () => {
  it('la forme compilée porte les valeurs de départ (z)', () => {
    const r = resolveRule(parseTypesBlock(CORPS, 1)[0].rule, {}, OU)
    assert.match(emitRuntimeRule(r, false), /_mjs_z:\{price:0,surprise:false\}/)
    assert.throws(() => parseRule('{ price: int 0.. = 0 }', OU), /accolades[\s\S]*price = 0 {2}int 0\.\./)
  })

  it('une valeur de départ doit passer sa règle telle quelle : refusée à la construction, avec sa ligne', () => {
    const faute = (champ: string) => () => resolveRule(parseTypesBlock(['', 'Reward', '  id int 1..', '  ' + champ].join('\n'), 1)[0].rule, {}, { block: '<types>', line: 2 })
    assert.throws(faute('price = 0 int 1..'), /ligne 4[\s\S]*0[\s\S]*int 1\.\./)
    assert.throws(faute('price = 50 int 0..10'), /ligne 4/)
    assert.throws(faute("price = '5' int"), /ligne 4/)
    assert.throws(faute("color = 'green' 'red' | 'blue'"), /ligne 4/)
    assert.throws(faute('tags = [] string[] 1..'), /ligne 4/)
    assert.throws(faute("nick = 'admin' string ! 'admin'"), /ligne 4/)
    for (const ok of ['price = 0 int 0..', 'note = 0.5 float 0..1', "nick = 'ann' string 1..5", 'n = null int | null', "c = 'b' 'a' | 'b'", 'tags = [] string[] ..3', 'on = true bool'])
      assert.doesNotThrow(faute(ok), ok)
  })

  it('entre accolades, et après une règle nommée : la même vérification', () => {
    assert.throws(() => resolveRule(parseRule('{ id: int,\n price: int 1.. = 0 }', OU), {}, OU), /accolades/)
    assert.throws(() => collectTypeDefs(['app.types.mjs'], () => '<types>\n  Percent int 0..100\n  Reward\n    vol Percent = 150\n</types>\n'), /ligne 4[\s\S]*150/)
  })

  it('`=` sur une variable du <vars> ou une règle d\'une ligne : refusé, la valeur de départ d\'une variable s\'écrit dans le <script>', () => {
    assert.throws(() => parseVarsBlock('$volume int 0..100 = 50', 1), /<script>/)
    assert.throws(() => parseTypesBlock('Percent = 50 int 0..100', 1), /champ/)
  })

  it('à l\'exécution : un champ absent ou undefined prend sa valeur de départ ; null suit la règle', () => {
    const µ  = makeMu('warn')
    const el: any = { localName: 'mjs-shop', _mjs_types: { rewards: regleCompilee(CORPS, 'Reward[]') } }
    const liste: any[] = [{ id: 1, title: 'Thé' }, { id: '2', title: 'Café', price: 3, surprise: undefined }]
    assert.ok(µ._mjs_tset(el, 'rewards', liste) === liste, 'la liste reçue, complétée sur place')
    assert.deepEqual(liste, [{ id: 1, title: 'Thé', price: 0, surprise: false }, { id: 2, title: 'Café', price: 3, surprise: false }])
    assert.equal(µ.warnings.length, 0)
    assert.ok(µ._mjs_tset(el, 'rewards', [{ id: 1, title: 'x', price: null }]) === µ._mjs_TNO, 'null passe par la règle : int 0.. le refuse')
    assert.equal(µ.warnings.length, 1)
    assert.equal(µ._mjs_tdeep(el, el._mjs_treg, liste[1], 'price', undefined), 0)
  })

  it('une liste de départ est neuve pour chaque objet, et suivie par sa règle', () => {
    const µ  = makeMu('warn')
    const el: any = { localName: 'mjs-blog', _mjs_types: { posts: regleCompilee(['', 'Post', '  tags = [] string[] ..2'].join('\n'), 'Post[]') } }
    const posts: any[] = [{}, {}]
    assert.ok(µ._mjs_tset(el, 'posts', posts) === posts)
    assert.deepEqual(posts, [{ tags: [] }, { tags: [] }])
    assert.ok(posts[0].tags !== posts[1].tags, 'deux listes distinctes')
    assert.ok(el._mjs_treg.get(posts[0].tags) !== undefined, 'inscrite au registre : une écriture plus profonde retrouve sa règle')
  })
})
