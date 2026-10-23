// `Reflect.set(@, 'children', …)` sur une propriété en lecture seule de la balise ne lève pas : il rend `false`.
// Le build ne le refuse donc plus avec « l'écriture lève », comme `Object.defineProperty` qui ne lève pas non
// plus. Les écritures qui lèvent vraiment (`@children = …`, `Object.assign @, { children: … }`) restent
// refusées, les méthodes de la balise que le cadre appelle restent refusées sous toutes les formes, et un reflet
// (`@title`) écrit par `Reflect.set` avertit toujours.

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

const lectureSeule = (nom: string) => (e: Error) => e.message.includes(`@${nom} = …`) && e.message.includes('lecture seule')
const refus        = (nom: string) => (e: Error) => e.message.includes(`@${nom} = …`) && e.message.includes(`${nom}()`) && e.message.includes('Renommez')

describe('Reflect.set sur une propriété en lecture seule de la balise', () => {
  const LECTURE_SEULE = ['children', 'childNodes', 'attributes', 'dataset', 'firstChild', 'parentNode', 'offsetWidth', 'clientHeight', 'isConnected', 'shadowRoot', 'tagName']

  for (const nom of LECTURE_SEULE) {
    it(`Reflect.set(@, '${nom}', …) : rien n'est levé, le build passe sans avertissement`, async () => {
      assert.deepEqual(await avertissements(`Reflect.set(@, '${nom}', 1)`), [])
    })
  }

  it('par un alias de @ : le build passe aussi', async () => {
    assert.deepEqual(await avertissements('self = @\nReflect.set(self, \'children\', 1)'), [])
  })

  it('la clé entre guillemets doubles ou en gabarit : le build passe', async () => {
    assert.deepEqual(await avertissements('Reflect.set(@, "children", 1)\nReflect.set(@, `dataset`, 1)'), [])
  })

  it('Reflect.defineProperty reste libre, comme avant', async () => {
    assert.deepEqual(await avertissements('Reflect.defineProperty(@, \'children\', { value: 1 })'), [])
  })

  for (const nom of ['children', 'dataset', 'offsetWidth']) {
    it(`@${nom} = … reste refusé : l'écriture lève`, async () => {
      await assert.rejects(compile(`@${nom} = 1`), lectureSeule(nom))
    })
    it(`Object.assign @, { ${nom}: … } reste refusé : l'écriture lève`, async () => {
      await assert.rejects(compile(`Object.assign @, { ${nom}: 1 }`), lectureSeule(nom))
    })
    it(`@['${nom}'] = … reste refusé : l'écriture lève`, async () => {
      await assert.rejects(compile(`@['${nom}'] = 1`), lectureSeule(nom))
    })
  }

  it('les vingt méthodes de la balise sont refusées par Reflect.set, comme par les autres formes', async () => {
    const noms = ['setAttribute', 'getAttribute', 'removeAttribute', 'hasAttribute', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'appendChild', 'insertBefore', 'removeChild', 'replaceChild', 'replaceChildren', 'querySelector', 'querySelectorAll', 'getRootNode', 'getBoundingClientRect', 'getClientRects', 'getAnimations', 'setPointerCapture', 'cloneNode']
    assert.equal(noms.length, 20)
    for (const nom of noms) {
      await assert.rejects(compile(`Reflect.set(@, '${nom}', (n, v) -> 1)`), refus(nom), `Reflect.set : ${nom}`)
      await assert.rejects(compile(`self = @\nReflect.set(self, '${nom}', (n, v) -> 1)`), refus(nom), `Reflect.set par un alias : ${nom}`)
    }
  })

  it('un reflet écrit par Reflect.set avertit toujours, comme une écriture directe', async () => {
    const vus = await avertissements('Reflect.set(@, \'title\', \'x\')')
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /title/)
  })

  it('Reflect.set sur un autre objet que le composant : libre', async () => {
    assert.deepEqual(await avertissements('o = {}\nReflect.set(o, \'children\', 1)\nReflect.set(o, \'setAttribute\', 1)'), [])
  })
})
