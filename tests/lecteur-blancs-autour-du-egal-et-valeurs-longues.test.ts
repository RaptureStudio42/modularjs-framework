// Le lecteur lit les blancs autour du `=` d'un attribut, une valeur nue et une directive de racine sur le texte entier, sans
// fenêtre : 60 blancs avant ou après le `=` (sur la même ligne ou à la ligne suivante), une valeur nue de 600 signes et une
// ligne `@import` de plus de 200 signes se lisent en entier, en développement comme en production

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { readFile, traverse, type Node } from '../src/reader/index.js'

const B = ' '.repeat(60)

async function sortie(src: string, dev: boolean): Promise<string> {
  const r: any = await transpile(src, { moduleName: 'cas', devWarnings: dev })
  return String(r.output)
}

describe('lecteur : blancs autour du = et valeurs longues lus sans fenêtre', function () {
  this.timeout(60000)

  for (const dev of [true, false]) {
    const mode = dev ? 'développement' : 'production'

    it(`60 blancs avant le = : la valeur est lue (${mode})`, async () => {
      assert.match(await sortie(`<div class${B}="a>b">t</div>\n`, dev), /<div class='a(?:>|&gt;)b'>/)
    })

    it(`un saut de ligne et 60 blancs après le = : la valeur est lue (${mode})`, async () => {
      assert.match(await sortie(`<div class=\n${B}"a>b">t</div>\n`, dev), /<div class='a(?:>|&gt;)b'>/)
    })

    it(`une valeur nue de 600 signes est lue en entier (${mode})`, async () => {
      const v = 'x'.repeat(600)
      assert.ok((await sortie(`<div data-k=${v}>t</div>\n`, dev)).includes(`data-k='${v}'`))
    })
  }

  it('une ligne @import de plus de 200 signes reste une seule directive, jusqu\'au bout de sa ligne', () => {
    const ligne = '@import { ' + Array.from({ length: 40 }, (_, k) => 'nom' + k).join(', ') + " } './m.js'"
    assert.ok(ligne.length > 200)
    const f = readFile(ligne + '\n<p>a</p>\n', { file: 'd.mjs' })
    const directives: Node[] = []
    traverse(f, (n) => { if (n.kind === 'directive') directives.push(n) })
    assert.equal(directives.length, 1)
    assert.equal((directives[0] as any).end - (directives[0] as any).start, ligne.length)
  })
})
