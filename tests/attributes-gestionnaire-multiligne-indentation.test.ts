// Gestionnaire d'événement inline MULTI-LIGNES (`@click={\n  $a = 10\n  $b = 20\n}`,
// sur un élément normal — pas une macro globale `<@window>`) : le retrait
// commun (indentation) doit être calculé sur le corps BRUT, avant tout trim
// qui ne mangerait QUE la 1re ligne — sinon Civet/Coffee (sensible à
// l'indentation) lit la 2e ligne comme un ARGUMENT de la 1re.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

describe('gestionnaire inline multi-lignes préserve l\'indentation', function () {
  this.timeout(15000)

  it('deux instructions SŒURS (même niveau) : les deux sont émises, aucune avalée', async () => {
    const src = [
      '<script>$a = 1\n$b = 2</script>',
      '<button @click={\n  $a = 10\n  $b = 20\n}>go</button>',
      '<p>{$a} {$b}</p>',
    ].join('\n')
    const { output } = await transpile(src, { moduleName: 'mjs-handler-siblings' })
    assert.match(output, /µ\._set\(_mjsThis,\s*'a',\s*10\)/, 'première instruction sœur présente')
    assert.match(output, /µ\._set\(_mjsThis,\s*'b',\s*20\)/, 'deuxième instruction sœur présente, pas avalée par un appel fantôme')
  })

  it('if postfix structuré : la mutation reste À L\'INTÉRIEUR du if (pas inconditionnelle)', async () => {
    const src = [
      '<script>$open = true</script>',
      "<button @click={\n  if e.type is 'click'\n    $open = false\n}>go</button>",
      '<p>{$open}</p>',
    ].join('\n')
    const { output } = await transpile(src, { moduleName: 'mjs-handler-if-nested' })
    assert.match(
      output,
      /if\s*\(e\.type\s*===\s*'click'\)\s*\{[^}]*µ\._set\(_mjsThis,\s*'open',\s*false\)/,
      'la mutation $open=false doit être nichée dans le corps du if'
    )
  })

  it('handler mono-ligne (cas nominal) reste inchangé', async () => {
    const src = [
      '<script>$n = 0</script>',
      '<button @click={$n = $n + 1}>go</button>',
      '<p>{$n}</p>',
    ].join('\n')
    const { output } = await transpile(src, { moduleName: 'mjs-handler-oneline' })
    assert.match(output, /µ\._set\(_mjsThis,\s*'n'/)
  })
})
