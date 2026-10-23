// Quels ancêtres RETIENNENT une balise fixe ou absolue (transformation — `transform`, mais aussi `translate`, `rotate`,
// `scale` et `offset-path` —, perspective, filtre, filtre de fond, confinement de la mise en page ou du dessin,
// `transform-style` autre que `flat`, `content-visibility` autre que `visible`, `will-change` de ces propriétés, `contain` compris) : les effets *cursors et *longshadow (la zone de sa lampe) disent exactement la même
// chose que le moteur des effets (`_mjsFxHoldsFixed`, mjs_fx.ts). Aucun ne compte `container-type`, que Chromium,
// Firefox et WebKit ne traitent pas comme un bloc englobant (une balise fixe ou absolue sous lui reste à la fenêtre
// ou à la page). Chaque effet est un fichier à part, livré seul : il appelle la règle du moteur, publiée
// (`µ._mjs_fxHoldsFixed`), sans en garder de copie — ce test le garde (une copie finissait par dériver).
// Le comportement, lui, est mesuré dans les navigateurs (effets-ancetres-retenus-browser, curseurs-navigateur-browser,
// effets-ombre-longue-browser).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')

// l'expression que rend la fonction `nom(cs)`, espaces ramenés à un
const regle = (fichier: string, nom: string): string | null => {
  const source = readFileSync(join(RUNTIME, fichier), 'utf8')
  const m      = new RegExp('function ' + nom + '\\(cs\\) \\{\\s*return ([^;]+);\\s*\\}').exec(source)
  return m ? m[1].replace(/\s+/g, ' ').trim() : null
}

// le motif que la règle applique à `will-change` (ce qu'il nomme), tel que le navigateur le lira
const motifWillChange = (expression: string | null): RegExp | null => {
  const m = expression ? /\/([^/]+)\/\.test\(cs\.willChange/.exec(expression) : null
  return m ? new RegExp(m[1]) : null
}

const FICHIERS: Array<[string, string, string]> = [
  ['mjs_fx.ts', '_mjsFxHoldsFixed', 'le moteur']
]

describe('les ancêtres qui retiennent une balise fixe ou absolue — la même règle que le moteur des effets', () => {
  const moteur = regle('mjs_fx.ts', '_mjsFxHoldsFixed')

  it('la règle du moteur est trouvée, elle lit ses propriétés, et ne compte pas le conteneur de requêtes', () => {
    assert.ok(moteur, 'la fonction du moteur est introuvable : le test doit suivre son nom')
    for (const propriete of ['transform', 'translate', 'rotate', 'scale', 'offsetPath', 'perspective', 'filter', 'backdropFilter', 'transformStyle', 'contentVisibility', 'contain', 'willChange']) {
      assert.ok(moteur!.includes('cs.' + propriete), `la règle du moteur ne lit plus ${propriete}`)
    }
    assert.ok(!moteur!.includes('containerType'), 'un conteneur de requêtes ne retient aucune balise fixe ou absolue (mesuré dans Chromium, Firefox et WebKit)')
  })

  for (const [fichier, nom, qui] of FICHIERS) {
    it(`${qui} : le motif de \`will-change\` nomme transform, translate, rotate, scale, offset-path, perspective, filter et contain — et pas offset-rotate`, () => {
      const motif = motifWillChange(regle(fichier, nom))
      assert.ok(motif, `la règle de ${qui} ne lit plus will-change par un motif`)
      for (const retient of ['transform', 'translate', 'rotate', 'scale', 'offset-path', 'perspective', 'filter', 'backdrop-filter', 'contain', 'opacity, contain', 'contain, opacity', 'opacity, rotate', 'offset-rotate, scale']) {
        assert.ok(motif!.test(retient), `will-change: ${retient} retient une balise fixe ou absolue (mesuré dans Chromium, Firefox et WebKit)`)
      }
      for (const neRetientPas of ['auto', 'opacity', 'offset-rotate', 'offset-distance', 'offset-anchor', 'container-type', 'contain-intrinsic-size']) {
        assert.ok(!motif!.test(neRetientPas), `will-change: ${neRetientPas} ne retient aucune balise fixe ou absolue (mesuré dans Chromium, Firefox et WebKit)`)
      }
    })
  }

  // la règle du moteur, publiée, appelée par chaque effet ; aucune copie (une fonction qui lit `cs.willChange`)
  for (const [fichier, qui] of [['mjs_fx_cursors.ts', '*cursors'], ['mjs_fx_longshadow.ts', 'la lampe de *longshadow']]) {
    it(`${qui} appelle la règle du moteur, sans en garder de copie`, () => {
      const source = readFileSync(join(RUNTIME, fichier), 'utf8')
      assert.match(readFileSync(join(RUNTIME, 'mjs_fx.ts'), 'utf8'), /µ\._mjs_fxHoldsFixed = _mjsFxHoldsFixed;/)
      assert.match(source, /µ\._mjs_fxHoldsFixed\(cs\)/)
      assert.ok(!/cs\.willChange/.test(source), `${qui} garde une copie de la règle`)
    })
  }
})
