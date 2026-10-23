// `Object.defineProperty(@, 'children', …)` redéfinit la propriété sur le composant : rien n'est écrit,
// rien ne lève, et la propriété n'est pas un reflet qui pose un attribut ; la liste des propriétés en lecture
// seule ne s'applique donc pas à defineProperty, defineProperties, Reflect.defineProperty. Les vingt méthodes
// de la balise que ModularJS appelle lui-même restent refusées sous ces trois formes, et Object.assign
// (qui lève sur une propriété en lecture seule) garde son refus

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

const refus   = (nom: string) => (e: Error) => e.message.includes(`@${nom} = …`) && e.message.includes(`${nom}()`) && e.message.includes('Renommez')
const lecture = (nom: string) => (e: Error) => e.message.includes(`@${nom} = …`) && e.message.includes('lecture seule')

describe('defineProperty sur le composant : la lecture seule ne s\'applique pas', () => {
  const libres: Array<[string, string]> = [
    ['Object.defineProperty(@, nom, …)', 'Object.defineProperty(@, \'children\', { get: -> [] })'],
    ['Object.defineProperties(@, { nom: … })', 'Object.defineProperties(@, { children: { get: -> [] }, dataset: { value: 1 } })'],
    ['Reflect.defineProperty(@, nom, …)', 'Reflect.defineProperty(@, \'children\', { get: -> [] })'],
    ['par un alias de @', 'self = @\nObject.defineProperty(self, \'dataset\', { value: 1 })'],
  ]
  for (const [nom, script] of libres) {
    it(`${nom} : compile`, async () => {
      await compile(script)
    })
  }

  it('une propriété à reflet : aucun avertissement non plus, aucun attribut n\'est posé', async () => {
    assert.deepEqual(await avertissements('Object.defineProperty(@, \'title\', { get: -> \'x\' })'), [])
    assert.deepEqual(await avertissements('Object.defineProperties(@, { id: { value: \'x\' } })'), [])
  })

  it('les vingt méthodes de la balise restent refusées sous les trois formes', async () => {
    const noms = ['setAttribute', 'getAttribute', 'removeAttribute', 'hasAttribute', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'appendChild', 'insertBefore', 'removeChild', 'replaceChild', 'replaceChildren', 'querySelector', 'querySelectorAll', 'getRootNode', 'getBoundingClientRect', 'getClientRects', 'getAnimations', 'setPointerCapture', 'cloneNode']
    for (const nom of noms) {
      await assert.rejects(compile(`Object.defineProperty(@, '${nom}', { value: -> 1 })`), refus(nom), `defineProperty : ${nom}`)
      await assert.rejects(compile(`Object.defineProperties(@, { ${nom}: { value: -> 1 } })`), refus(nom), `defineProperties : ${nom}`)
      await assert.rejects(compile(`Reflect.defineProperty(@, '${nom}', { value: -> 1 })`), refus(nom), `Reflect.defineProperty : ${nom}`)
    }
  })

  it('Object.assign et l\'écriture directe lèvent sur une propriété en lecture seule : refusés', async () => {
    await assert.rejects(compile('Object.assign @, { children: [] }'), lecture('children'))
    await assert.rejects(compile('@children = []'), lecture('children'))
  })
})
