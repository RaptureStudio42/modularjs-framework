// Les méthodes de la balise que ModularJS appelle lui-même (`setAttribute`, `addEventListener`…) sont
// refusées quand le <script> les écrit sur le composant (`@setAttribute = f`). Le refus se contournait :
// clé entre crochets (`@['setAttribute'] = f`), `Object.assign @, { setAttribute: f }`,
// `Object.defineProperty(@, 'setAttribute', …)`, déstructuration, écriture dans `µmount ->` ou dans une
// méthode, alias (`self = @` puis `self.setAttribute = f`). Toutes ces écritures, qui posent le même nom
// sur la balise, sont refusées avec le même message. Ce qui ne se voit pas au build reste libre : une clé
// calculée à l'exécution (`@[nom] = f`), un objet construit ailleurs (`Object.assign @, reglages`), le
// composant passé à une fonction. Les mêmes formes sont lues pour les propriétés de la balise.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const compile = (script: string) => transpile(`<script>\n${script}\n</script>\n<p>x</p>\n`, { moduleName: 'carte' })

// avertissements `[lint.naming]` d'une compilation qui doit passer
async function avertissements(script: string): Promise<string[]> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await compile(script) } finally { console.warn = orig }
  return vus.filter(m => m.includes('[lint.naming]'))
}

const refus = (nom: string) => (e: Error) => e.message.includes(`@${nom} = …`) && e.message.includes(`${nom}()`) && e.message.includes('Renommez')

describe('<script> — une méthode de la balise masquée par un chemin détourné', () => {
  const F = '(n, v) -> 1'
  const detournees: Array<[string, string]> = [
    ['clé entre guillemets simples', `@['setAttribute'] = ${F}`],
    ['clé entre guillemets doubles', `@["setAttribute"] = ${F}`],
    ['clé en gabarit sans expression', `@[\`setAttribute\`] = ${F}`],
    ['Object.assign @, { nom: f }', `Object.assign @, { setAttribute: ${F} }`],
    ['Object.assign avec une clé texte', `Object.assign @, { 'setAttribute': ${F} }`],
    ['Object.assign avec un autre objet avant', `Object.assign @, { a: 1 }, { setAttribute: ${F} }`],
    ['Object.assign avec un spread qui précède', `autre = {}\nObject.assign @, { ...autre, setAttribute: ${F} }`],
    ['Object.defineProperty(@, nom, …)', `Object.defineProperty(@, 'setAttribute', { value: ${F} })`],
    ['Object.defineProperties(@, { nom: … })', `Object.defineProperties(@, { setAttribute: { value: ${F} } })`],
    ['Reflect.set(@, nom, f)', `Reflect.set(@, 'setAttribute', ${F})`],
    ['déstructuration d\'un tableau', `[@setAttribute] = [${F}]`],
    ['déstructuration d\'un objet', `{ f: @setAttribute } = { f: ${F} }`],
    ['déstructuration avec le reste', `[a, ...@setAttribute] = [1, ${F}]`],
    ['dans µmount ->', `µmount ->\n  @setAttribute = ${F}`],
    ['dans une méthode du composant', `@brancher = ->\n  @setAttribute = ${F}`],
    ['dans une fonction du <script>', `brancher = ->\n  @setAttribute = ${F}\nbrancher()`],
    ['variable d\'une boucle for…of', `for (@setAttribute of [${F}]) { break }`],
    ['variable d\'une boucle for…in', 'for (@setAttribute in { a: 1 }) { break }'],
    ['par un alias de @', `self = @\nself.setAttribute = ${F}`],
    ['par un alias constant', `self := @\nself.setAttribute = ${F}`],
    ['par un alias posé dans une méthode', `@brancher = ->\n  self = @\n  self.setAttribute = ${F}`],
    ['par la clé d\'un alias', `self = @\nself['setAttribute'] = ${F}`],
    ['Object.assign sur un alias', `self = @\nObject.assign self, { setAttribute: ${F} }`],
  ]
  for (const [nom, script] of detournees) {
    it(`${nom} : refusé comme @setAttribute = f`, async () => {
      await assert.rejects(compile(script), refus('setAttribute'))
    })
  }

  it('les vingt noms techniques sont refusés par la clé entre crochets et par Object.assign', async () => {
    const noms = ['setAttribute', 'getAttribute', 'removeAttribute', 'hasAttribute', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'appendChild', 'insertBefore', 'removeChild', 'replaceChild', 'replaceChildren', 'querySelector', 'querySelectorAll', 'getRootNode', 'getBoundingClientRect', 'getClientRects', 'getAnimations', 'setPointerCapture', 'cloneNode']
    for (const nom of noms) {
      await assert.rejects(compile(`@['${nom}'] = ${F}`), refus(nom), `clé : ${nom}`)
      await assert.rejects(compile(`Object.assign @, { ${nom}: ${F} }`), refus(nom), `assign : ${nom}`)
    }
  })

  it('libres, sans avertissement : ce qui ne touche pas la balise du composant', async () => {
    const libres = [
      'class Faux\n  constructor(url)\n    @setAttribute = -> url\n    @addEventListener = => url',
      'class Faux\n  brancher()\n    @setAttribute = 1',
      'o = {}\no.setAttribute = -> 1',
      'o = {}\nObject.assign o, { setAttribute: -> 1 }',
      'o = {}\nObject.defineProperty(o, \'setAttribute\', { value: 1 })',
      'o = { setAttribute: -> 1, getRootNode: -> 2 }',
      'autre = {}\nautre.setAttribute = 1',
      '$setAttribute = 1',
      '@titre = 1\n@[\'titre2\'] = 2\nObject.assign @, { cache: true }',
      'µmount ->\n  @remove = -> 1\n  @focus = (x) -> x',
      'o = {}\n[o.setAttribute] = [1]',
      'class Autre\n  static\n    @addEventListener = -> 1',
      'class Faux\n  champ = (@addEventListener = -> 1)',
    ]
    for (const script of libres) assert.deepEqual(await avertissements(script), [], script)
  })

  it('ce qui ne se voit pas au build reste libre : clé calculée, objet construit ailleurs', async () => {
    assert.deepEqual(await avertissements('nom = \'set\' + \'Attribute\'\n@[nom] = -> 1'), [])
    assert.deepEqual(await avertissements('reglages = { a: 1 }\nObject.assign @, reglages'), [])
    assert.deepEqual(await avertissements('poser = (o) -> o.setAttribute = -> 1\nposer @'), [])
  })
})

describe('<script> — une propriété de la balise écrite par déstructuration', () => {
  it('lecture seule : [@children] = … et { a: @dataset } = … refusées comme @children = …', async () => {
    const lecture = (nom: string) => (e: Error) => e.message.includes(`@${nom} = …`) && e.message.includes(`$${nom}`) && e.message.includes('lecture seule')
    await assert.rejects(compile('[@children] = [1]'), lecture('children'))
    await assert.rejects(compile('{ a: @children } = { a: 1 }'), lecture('children'))
    await assert.rejects(compile('{ a: @dataset } = { a: 1 }'), lecture('dataset'))
    await assert.rejects(compile('[a, ...@offsetWidth] = [1, 2]'), lecture('offsetWidth'))
    await assert.rejects(compile('self = @\nself.children = 1'), lecture('children'))
  })

  it('reflet : [@title] = … avertit une fois, comme @title = …', async () => {
    for (const script of ['[@title] = [\'x\']', '{ a: @title } = { a: \'x\' }', '[@title] = [\'x\']\n[@title] = [\'y\']', '@title = \'x\'\n[@title] = [\'y\']']) {
      const vus = await avertissements(script)
      assert.equal(vus.length, 1, `${script} : ${vus.join(' | ')}`)
      assert.ok(vus[0].includes('@title') && vus[0].includes('$title'), vus[0])
    }
  })

  it('rien : dans µmount, une méthode, un autre nom, l\'état', async () => {
    assert.deepEqual(await avertissements('µmount ->\n  [@title] = [\'x\']'), [])
    assert.deepEqual(await avertissements('@montrer = -> [@hidden] = [false]'), [])
    assert.deepEqual(await avertissements('[@titre, @cache] = [\'x\', true]'), [])
    assert.deepEqual(await avertissements('[$title] = [\'x\']'), [])
  })
})
