// auto-déclaration du script — `from`, `of`, `async`, `then` et `when` se déclarent comme n'importe quel nom. La passe
// d'auto-déclaration les rangeait parmi les mots réservés : aucune déclaration posée, et le module compilé (toujours
// strict) levait « ReferenceError: from is not defined » à l'exécution dans une fonction, un µeffect ou un module
// partagé, sans rien dire à la construction ; au premier niveau du <script>, un faux « nom jamais déclaré »

import assert from 'node:assert/strict'
import { transpile, applyMjsSugarToScript } from '../src/transpiler/index.js'
import { autoDeclareTopLevelBareAssignments } from '../src/bundler/index.js'
import { getAdapter } from '../src/languages/index.js'

const NOMS = ['from', 'of', 'async', 'then', 'when']

// une déclaration `let`/`var` de ce nom dans le code produit
function declare(js: string, nom: string): boolean {
  return new RegExp(`\\b(?:let|var)\\s+${nom}\\b`).test(js)
}

// module `.civet` partagé : le chemin du bundler (sucre, Civet, déclaration des affectations nues du premier niveau)
async function modulePartage(src: string): Promise<string> {
  const pre = applyMjsSugarToScript(src, 'civet', undefined, '<script module>', 1)
  const js  = (await getAdapter('civet').compileToJs(pre, { fileName: 'partage.civet.mjs', bare: true })).code
  return autoDeclareTopLevelBareAssignments(js, 'partage.civet.mjs')
}

// exécute le module produit (module ES, donc strict, comme dans le navigateur) et rend `f()`
async function executer(js: string): Promise<unknown> {
  const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
  return mod.f()
}

describe('auto-déclaration — from, of, async, then et when déclarés comme les autres noms', () => {
  for (const nom of NOMS) {
    describe(`« ${nom} »`, () => {
      it('premier niveau du <script>', async () => {
        const { output } = await transpile(`<script>\n${nom} = 1\nsuite := ${nom} + 1\n</script>\n<div>x</div>\n`, { moduleName: 'essai' })
        assert.ok(declare(output, nom), output)
      })

      it('premier niveau du <script module>', async () => {
        const { output } = await transpile(`<script module>\n${nom} = 1\nsuite := ${nom} + 1\n</script>\n<script>\n$x = 1\n</script>\n<div>{$x}</div>\n`, { moduleName: 'essai' })
        assert.ok(declare(output, nom), output)
      })

      it('dans une méthode', async () => {
        const { output } = await transpile(`<script>\n@go = ->\n  ${nom} = 2\n  ${nom} + 1\n</script>\n<div>x</div>\n`, { moduleName: 'essai' })
        assert.ok(declare(output, nom), output)
      })

      it('dans un µeffect', async () => {
        const { output } = await transpile(`<script>\n$x = 1\nµeffect ->\n  ${nom} = $x\n  ${nom} + 1\n</script>\n<div>{$x}</div>\n`, { moduleName: 'essai' })
        assert.ok(declare(output, nom), output)
      })

      it('module .civet partagé : la fonction s’exécute sans ReferenceError', async () => {
        const js = await modulePartage(`export f = ->\n  ${nom} = 2\n  ${nom} + 1`)
        assert.ok(declare(js, nom), js)
        assert.equal(await executer(js), 3)
      })
    })
  }

  it('« from » lié par un paramètre déstructuré : réaffecté, jamais redéclaré', async () => {
    const js = await modulePartage('g = ({from, to}) ->\n  from = from + to\n  from\nexport f = -> g({from: 1, to: 2})')
    assert.ok(!declare(js, 'from'), js)
    assert.equal(await executer(js), 3)
  })

  it('« from » affecté en ligne après `then` : hissé et déclaré', async () => {
    const js = await modulePartage('export f = ->\n  if true then from = 2\n  from + 1')
    assert.ok(declare(js, 'from'), js)
    assert.equal(await executer(js), 3)
  })

  it('CoffeeScript déclare déjà « from » et « async »', async () => {
    for (const nom of ['from', 'async']) {
      const { output } = await transpile(`<script lang="coffee">\n${nom} = 1\nsuite = ${nom} + 1\n</script>\n<div>x</div>\n`, { moduleName: 'essai' })
      assert.ok(declare(output, nom), output)
    }
  })
})
