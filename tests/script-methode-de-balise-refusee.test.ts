// `@setAttribute = …`, `@dispatchEvent = …`, `@querySelector = …` dans le <script> : dans un composant,
// `this` EST la balise, et ces noms remplacent des méthodes de la balise (HTMLElement) que ModularJS
// appelle lui-même sur les balises de composant — ses attributs au montage, ses événements, le contenu que
// la page lui confie, ses transitions. La fonction de l'auteur partait à la place de la sienne et le
// composant cessait de marcher, sans que le build ne dise rien : ces noms techniques, que personne ne
// choisit pour autre chose, sont refusés, et le message dit de renommer. Les noms naturels (`@remove`,
// `@contains`, `@focus`, `@animate`…) restent libres et sans avertissement : un auteur les prend pour ses
// propres méthodes, c'est au cadre de ne pas dépendre d'eux. Une classe ou un objet du script, l'état
// `$setAttribute` : rien ne change.

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

// appelées par ModularJS sur une balise de composant, après son <script>
const TECHNIQUES = ['setAttribute', 'getAttribute', 'removeAttribute', 'hasAttribute', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'appendChild', 'insertBefore', 'removeChild', 'replaceChild', 'replaceChildren', 'querySelector', 'querySelectorAll', 'getRootNode', 'getBoundingClientRect', 'getClientRects', 'getAnimations', 'setPointerCapture', 'cloneNode']

describe('<script> — une méthode de la balise que ModularJS appelle, masquée par le composant', () => {
  it('refusée, fonction ou valeur : le message nomme la méthode et dit de renommer', async () => {
    for (const nom of TECHNIQUES) {
      await assert.rejects(compile(`@${nom} = (x) -> x`), (e: Error) => e.message.includes(`@${nom} = …`) && e.message.includes(`${nom}()`) && e.message.includes('Renomme'), nom)
    }
    await assert.rejects(compile('@dispatchEvent = null'), /@dispatchEvent = …/)
  })

  it('@@nom, une flèche ou un bloc du premier niveau : la balise aussi, refusés', async () => {
    await assert.rejects(compile('@@querySelector = -> 1'), /@querySelector = …/)
    await assert.rejects(compile('brancher = => @addEventListener = -> 1'), /@addEventListener = …/)
    await assert.rejects(compile('if true\n  @setAttribute = -> 1'), /@setAttribute = …/)
  })

  it('libres, sans avertissement : les noms naturels, l\'état, une classe ou un objet du script', async () => {
    for (const nom of ['remove', 'contains', 'replaceWith', 'matches', 'closest', 'focus', 'click', 'animate', 'scroll', 'append', 'normalize']) {
      assert.deepEqual(await avertissements(`@${nom} = (x) -> x`), [], nom)
    }
    assert.deepEqual(await avertissements('$setAttribute = 1\n$dispatchEvent = 2'), [])
    assert.deepEqual(await avertissements('class Faux\n  constructor(url)\n    @setAttribute = -> url\n    @addEventListener = => url'), [])
    assert.deepEqual(await avertissements('o = { querySelector: -> 1, getRootNode: -> 2 }'), [])
  })
})
