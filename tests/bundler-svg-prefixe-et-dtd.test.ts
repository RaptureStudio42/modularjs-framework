// Un SVG copié tel quel est servi depuis l'origine du site : le filtre qui refuse un SVG porteur de script lit aussi les
// balises écrites avec un préfixe d'espace de noms (`<svg:script>`), refuse toute DTD interne (ses entités reconstituent
// `javascript:` sans jamais l'écrire), et une entité numérique hors plage donne une erreur qui nomme le fichier.

import assert from 'node:assert/strict'
import { Bundler } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SVG = 'xmlns="http://www.w3.org/2000/svg"'

function filtre(contenu: string, fichier = 'icone.svg'): Error | null {
  const b: any = new Bundler({ sourceDir: mjsTmp('svg-filtre-src'), outputDir: mjsTmp('svg-filtre-out') })
  try {
    b.assertSafeSvg(contenu, fichier)
    return null
  }
  catch (e: any) {
    return e
  }
}

describe('filtre des SVG : préfixe d\'espace de noms, DTD interne, entité hors plage', function () {
  it('<svg:script> est refusé', () => {
    const e = filtre(`<svg ${SVG} xmlns:svg="http://www.w3.org/2000/svg"><svg:script>document.title='x'</svg:script></svg>`)
    assert.ok(e, 'le SVG doit être refusé')
    assert.match(e!.message, /icone\.svg/)
  })

  it('un préfixe quelconque (<foo:script>, <x:foreignObject>, <h:iframe>) est refusé', () => {
    assert.ok(filtre(`<svg ${SVG} xmlns:foo="http://www.w3.org/2000/svg"><foo:script>1</foo:script></svg>`))
    assert.ok(filtre(`<svg ${SVG} xmlns:x="http://www.w3.org/2000/svg"><x:foreignObject><p>a</p></x:foreignObject></svg>`))
    assert.ok(filtre(`<svg ${SVG} xmlns:h="http://www.w3.org/1999/xhtml"><h:iframe src="https://ailleurs.test"></h:iframe></svg>`))
  })

  it('une DTD interne avec des entités qui reconstituent javascript: est refusée', () => {
    const svg = `<?xml version="1.0"?>\n<!DOCTYPE svg [\n  <!ENTITY j "java">\n  <!ENTITY s "script:document.title='x'">\n]>\n<svg ${SVG} xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="&j;&s;"><rect width="10" height="10"/></a></svg>`
    const e = filtre(svg)
    assert.ok(e, 'le SVG doit être refusé')
    assert.match(e!.message, /icone\.svg/)
    assert.match(e!.message, /DOCTYPE/)
  })

  it('un DOCTYPE sans sous-ensemble interne reste accepté, un SVG ordinaire aussi', () => {
    assert.equal(filtre(`<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg ${SVG}><rect width="1" height="1"/></svg>`), null)
    assert.equal(filtre(`<svg ${SVG}><desc>scripts et iframes</desc><circle r="2"/></svg>`), null)
  })

  it('&#x110000; donne une erreur de construction qui nomme le fichier, jamais un RangeError', () => {
    for (const ent of ['&#x110000;', '&#1114112;', '&#xFFFFFFFFFFFF;']) {
      const e = filtre(`<svg ${SVG}><text>${ent}</text></svg>`, 'logo.svg')
      assert.ok(e, `${ent} doit être refusé`)
      assert.ok(!(e instanceof RangeError), `${ent} : RangeError brut`)
      assert.match(e!.message, /logo\.svg/)
    }
  })
})
