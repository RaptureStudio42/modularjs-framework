// STYLE_INERT_RE (extraction des sections <style>/<theme>/<routes>) traitait tout `//`
// comme un commentaire SASS, y compris CELUI d'une URL (`url(https://…)`) hors chaîne : sur
// la même ligne que `</style>`, ce faux commentaire masquait la fermeture jusqu'à la fin de
// la ligne — « balise orpheline » refusée sur un composant pourtant valide. Un `//` n'est un
// commentaire ni dans une chaîne (déjà protégé), ni dans `url( )` (protégé ici).

import assert from 'node:assert/strict'
import { extractSections } from '../src/transpiler/sections.js'

describe('extractSections — url(https://…) sur la même ligne que </style>', () => {
  it('ne masque plus la fermeture : compile, </style> retrouvée', () => {
    const src = '<style>\n.a { background: url(https://example.com/img.png); }</style>\n<p>x</p>\n'
    assert.doesNotThrow(() => extractSections(src))
    const r = extractSections(src)
    assert.ok(r.style.raw.includes('url(https://example.com/img.png)'), r.style.raw)
  })

  it('témoin : même style, </style> SUR SA PROPRE LIGNE — fonctionnait déjà', () => {
    const src = '<style>\n.a { background: url(https://example.com/img.png); }\n</style>\n<p>x</p>\n'
    assert.doesNotThrow(() => extractSections(src))
  })

  it('même trou sur <theme>, url() sans protocole (`//cdn…`) collé à </theme>', () => {
    const src = '<theme>\n$$bg: url(//cdn.example.test/x.png);</theme>\n<p>x</p>\n'
    assert.doesNotThrow(() => extractSections(src))
    assert.equal(extractSections(src).themes[0].raw.includes('url(//cdn.example.test/x.png)'), true)
  })

  it('non-régression : un vrai commentaire `//` (hors url()) masque toujours jusqu\'à la fin de ligne', () => {
    const src = '<style>\n.a { color: red; } // commentaire avec </style> dedans\n</style>\n<p>x</p>\n'
    assert.doesNotThrow(() => extractSections(src))
    assert.equal(extractSections(src).style.raw.includes('color: red'), true)
  })

  it('non-régression : un `//` dans une chaîne reste protégé par les guillemets, pas par url()', () => {
    const src = '<style>\n.a::before { content: "http://x"; }</style>\n<p>x</p>\n'
    assert.doesNotThrow(() => extractSections(src))
    assert.equal(extractSections(src).style.raw.includes('content: "http://x"'), true)
  })
})
