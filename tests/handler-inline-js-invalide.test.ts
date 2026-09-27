// LOT `_mjs_inline` INVALIDE — les gestionnaires d'événement d'un composant partent d'un SEUL
// bloc dans le fichier émis : un gestionnaire qui compile en JavaScript invalide fait refuser
// le fichier entier par le navigateur (SyntaxError au chargement, page morte) alors que le
// build était vert. Le lot est donc tranché à la compilation, en citant la ligne produite.
//
// Cause mesurée : Civet referme une fin de corps de flèche à accolades sur une expression
// bancale quand ce bloc ne contient QU'UN `if` lui-même à accolades — `() => { if (1) { z = 5 } }`
// ressort en `() =>( { if (1) { return z = 5 } })`, que rien n'exécute. Les écritures
// équivalentes (corps indenté, `if … then …`, corps à plusieurs instructions) compilent juste.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const composant = (script: string, html: string) => `<script>\n${script}\n</script>\n${html}\n`

describe('gestionnaires inline — lot refusé quand le JavaScript compilé ne s’analyse pas', function () {
  const CASSE = '<button @click={() => { if (1) { z = 5 } }}>go</button>\n'

  it('if à accolades seul dans le corps, aucune constante en jeu', async function () {
    await assert.rejects(
      () => transpile(composant('z .= 0', CASSE), { moduleName: 'card' }),
      /JavaScript invalide/,
    )
  })

  it('le refus cite la ligne fautive du JavaScript produit', async function () {
    await assert.rejects(
      () => transpile(composant('z .= 0', CASSE), { moduleName: 'card' }),
      /if \(1\) \{ return z = 5 \}/,
    )
  })

  it('lot mixte : un gestionnaire valide à côté ne fait pas refuser pour constante', async function () {
    // le gestionnaire sain déclare sa PROPRE liaison homonyme de la constante : c'est la
    // recherche du nom dans le texte du lot entier qui le refusait à tort
    const html = '<button @click={() => { let z = 1; z = 5 }}>a</button>\n' + CASSE
    const err: any = await transpile(composant('z := 0', html), { moduleName: 'card' }).then(() => null, (e: any) => e)
    assert.ok(err, 'le lot doit être refusé')
    assert.match(String(err.message), /JavaScript invalide/)
    assert.doesNotMatch(String(err.message), /CONSTANT/)
  })

  describe('ACCEPTÉS — écritures équivalentes qui compilent juste', function () {
    it('corps indenté, sans accolades englobantes', async function () {
      await transpile(composant('z .= 0', '<button @click={() =>\n  if (1)\n    z = 5\n}>go</button>\n'), { moduleName: 'card' })
    })

    it('if … then …', async function () {
      await transpile(composant('z .= 0', '<button @click={() => if (1) then z = 5}>go</button>\n'), { moduleName: 'card' })
    })

    it('corps à deux instructions', async function () {
      await transpile(composant('z .= 0', '<button @click={() => { let a = 1; if (1) { z = 5 + a } }}>go</button>\n'), { moduleName: 'card' })
    })
  })
})
