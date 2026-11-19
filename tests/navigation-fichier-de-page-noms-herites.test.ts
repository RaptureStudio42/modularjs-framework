// Fichier de page relu par la navigation (`µ._mjs_navPageFile`) : chaque nom de la fiche garde son chemin d'origine dans
// `µ._mjs_pagePrev`, que l'Autoloader reprend si le fichier de page n'arrive pas (404). Le test « chemin déjà gardé ? »
// ne doit voir que les noms PROPRES de cette table : un nom que l'objet hérite (`constructor`, `toString`, ou un nom posé
// sur un prototype pollué) passait pour déjà gardé, son chemin n'était jamais retenu et le composant restait sans repli.
//
// Méthode : extraction réelle de la fonction (marqueurs `extrait-test`), happy-dom pour de vrais documents
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { extractMarked } from './helpers/extract-marked.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC   = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')
const propre    = (o: any, n: string) => Object.prototype.hasOwnProperty.call(o, n)

function monter(paths: Record<string, string>) {
  const win: any = new Window({ url: 'http://x/a' })
  const µ: any   = { paths }
  new Function('µ', 'document', extractMarked(UJS_SRC, '_mjs_navPageFile'))(µ, win.document)
  const recue = (names: string[]) => new win.DOMParser().parseFromString('<html><head></head><body><script type="application/json" id="__mjs_page">' + JSON.stringify({ file: 'mjs_page-doc-aaaaaaaa.js', names }) + '</script></body></html>', 'text/html')
  return { µ, recue }
}

describe('navigation — le chemin d\'origine d\'un nom de la fiche est gardé même quand l\'objet hérite ce nom', () => {
  for (const nom of ['constructor', 'toString', 'valueOf']) {
    it('nom `' + nom + '`, hérité de tout objet : son chemin d\'origine est gardé', () => {
      const { µ, recue } = monter({ [nom]: nom + '-11111111.js' })
      µ._mjs_navPageFile(recue([nom]))
      assert.equal(µ.paths[nom], 'mjs_page-doc-aaaaaaaa.js')
      assert.ok(propre(µ._mjs_pagePrev, nom), 'aucun chemin gardé pour ' + nom)
      assert.equal(µ._mjs_pagePrev[nom], nom + '-11111111.js')
    })
  }

  it('prototype pollué qui porte le nom : le chemin d\'origine est gardé quand même', () => {
    const { µ, recue } = monter({ carte: 'carte-11111111.js' })
    ;(Object.prototype as any).carte = 'https://tiers.example/piege.js'
    try {
      µ._mjs_navPageFile(recue(['carte']))
    }
    finally {
      delete (Object.prototype as any).carte
    }
    assert.ok(propre(µ._mjs_pagePrev, 'carte'), 'aucun chemin gardé pour carte')
    assert.equal(µ._mjs_pagePrev.carte, 'carte-11111111.js')
  })

  it('un nom déjà gardé ne bouge pas : la page suivante ne remplace pas le chemin d\'origine', () => {
    const { µ, recue } = monter({ constructor: 'constructor-11111111.js' })
    µ._mjs_navPageFile(recue(['constructor']))
    µ._mjs_navPageFile(recue(['constructor']))
    assert.equal(µ._mjs_pagePrev.constructor, 'constructor-11111111.js')
  })
})
