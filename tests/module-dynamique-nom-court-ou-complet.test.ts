// POURQUOI CE FICHIER EXISTE
// Le défaut d'origine : la documentation de `<@module $comp>` promettait « une chaîne kebab-case
// désignant un composant MJS enregistré (`'tuto-card-a'` → `<mjs-tuto-card-a>`) », mais le code
// faisait `document.createElement(<chaîne telle quelle>)`. Écrire le nom court (`'fx-famille-text'`)
// créait donc une balise `<fx-famille-text>` que rien ne définit : rien ne se montait, sans erreur.
// Il fallait donner le nom COMPLET (`'mjs-fx-famille-text'`), alors que partout ailleurs l'auteur
// écrit le nom SANS préfixe (`<@card>`, `<@@code>`, nom de fichier).
// Rencontré en refaisant une page à onglets qui choisit son composant par une variable.
// Ce que ces tests gardent : le nom court ET le nom complet montent le même composant, en
// développement (la production et le chargement à la demande : fichier -browser) ; une balise HTML native (`div`) et une classe/un constructeur
// restent traités comme avant ; une valeur vide ne monte rien ; changer de composant démonte
// l'ancien. Le composant pas encore chargé (chargement à la demande) est gardé dans
// tests/module-dynamique-nom-court-ou-complet-browser.test.ts.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterModule, pause, balises, textes } from './helpers/module-dynamique.js'
import { assertAbsent } from './helpers/dom-assert.js'

const CARTE_A = '<script>\n$titre = \'\'\n</script>\n<p class="a">A:{$titre}</p>\n'
const CARTE_B = '<script>\n$titre = \'\'\n</script>\n<p class="b">B:{$titre}</p>\n'

const hote = (init: string) => `<script>\n$comp = ${init}\n@choisir = (c) -> $comp = c\n</script>\n<@module $comp titre="Démo"></@module>\n`

describe('<@module> — nom court ou nom complet du composant', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  // happy-dom ne charge pas un découpage minifié : la production se vérifie dans Chromium (fichier -browser)
  for(const env of ['dev'] as const) {
    describe(`build ${env}`, () => {
      it('nom COMPLET (`mjs-tuto-card-a`) : monte le composant, comme avant', async () => {
        const { hote: h, erreurs } = await monterModule({ hote: hote('\'mjs-tuto-card-a\''), 'tuto-card-a': CARTE_A }, { env })
        assert.deepEqual(balises(h), ['mjs-tuto-card-a'])
        assert.deepEqual(textes(h._shadow.querySelector('mjs-tuto-card-a'), 'p'), ['A:Démo'])
        assert.deepEqual(erreurs(), [])
      })

      it('nom COURT (`tuto-card-a`) : monte le même composant — AVANT le correctif, `<tuto-card-a>` restait inerte', async () => {
        const { hote: h, erreurs } = await monterModule({ hote: hote('\'tuto-card-a\''), 'tuto-card-a': CARTE_A }, { env })
        assert.deepEqual(balises(h), ['mjs-tuto-card-a'], 'la balise créée porte le préfixe mjs-')
        assert.deepEqual(textes(h._shadow.querySelector('mjs-tuto-card-a'), 'p'), ['A:Démo'])
        assert.deepEqual(erreurs(), [])
      })

      it('nom court puis nom complet du MÊME composant : pas de re-montage (l\'état du composant est gardé)', async () => {
        const { hote: h } = await monterModule({ hote: hote('\'tuto-card-a\''), 'tuto-card-a': CARTE_A }, { env })
        const avant = h._shadow.querySelector('mjs-tuto-card-a')
        h.choisir('mjs-tuto-card-a')
        await pause(60)
        assert.equal(h._shadow.querySelector('mjs-tuto-card-a') === avant, true, 'même nœud')
      })

      it('changer de composant par nom court : l\'ancien est démonté, le neuf monté', async () => {
        const { hote: h } = await monterModule({ hote: hote('\'tuto-card-a\''), 'tuto-card-a': CARTE_A, 'tuto-card-b': CARTE_B }, { env })
        h.choisir('tuto-card-b')
        await pause(80)
        assert.deepEqual(balises(h), ['mjs-tuto-card-b'])
        assert.deepEqual(textes(h._shadow.querySelector('mjs-tuto-card-b'), 'p'), ['B:Démo'])
      })

      it('nom court puis valeur vide : le composant est masqué, sans erreur', async () => {
        const { hote: h, erreurs } = await monterModule({ hote: hote('\'tuto-card-a\''), 'tuto-card-a': CARTE_A }, { env })
        h.choisir('')
        await pause(60)
        assert.equal(h._shadow.querySelector('mjs-tuto-card-a').style.display, 'none', 'le composant est masqué')
        assert.deepEqual(erreurs(), [])
      })
    })
  }

  it('valeur vide dès le départ (`null`) : rien de monté, sans erreur ni avertissement', async () => {
    const { hote: h, erreurs, warns } = await monterModule({ hote: hote('null'), 'tuto-card-a': CARTE_A })
    assert.deepEqual(balises(h), [])
    assert.deepEqual([erreurs(), warns()], [[], []])
  })

  it('balise HTML native (`section`) : créée telle quelle, pas préfixée (comportement gardé)', async () => {
    const { hote: h } = await monterModule({ hote: hote('\'section\'') })
    assert.equal(h._shadow.querySelector('section') !== null, true)
    assertAbsent(h._shadow.querySelector('mjs-section'))
  })

  it('élément personnalisé tiers déjà défini sous son nom brut (`mon-widget`) : gardé tel quel, jamais préfixé', async () => {
    const { hote: h, window } = await monterModule({ hote: hote('null') })
    window.eval('customElements.define(\'mon-widget\', class extends HTMLElement {})')
    h.choisir('mon-widget')
    await pause(60)
    assert.equal(h._shadow.querySelector('mon-widget') !== null, true)
    assertAbsent(h._shadow.querySelector('mjs-mon-widget'))
  })

  it('classe passée en valeur : instanciée, ni nom ni préfixe à deviner (comportement gardé)', async () => {
    const { hote: h, window } = await monterModule({ hote: hote('null') })
    window.eval('globalThis.Classe = class extends HTMLElement {}; customElements.define(\'une-classe\', globalThis.Classe)')
    h.choisir(window.Classe)
    await pause(60)
    assert.equal(h._shadow.querySelector('une-classe') !== null, true)
  })
})
