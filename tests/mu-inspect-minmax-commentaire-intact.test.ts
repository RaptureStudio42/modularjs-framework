// µinspect($x.foo) / µminmax($x.foo, …) lèvent une erreur de compilation claire (cf.
// mu-inspect-suffixe-jamais-orphelin.test.ts / mu-minmax-suffixe-chemin-imbrique.test.ts) — mais
// cette garde tournait sur le texte BRUT, commentaires compris : un commentaire qui CITE la forme
// refusée en PROSE (documentation, exemple) faisait échouer la compilation d'un composant par
// ailleurs valide. Portée volontairement ÉTROITE : seule l'ERREUR est évitée dans un commentaire
// (`//`, `/* */`, `#` Civet, tête ou fin de ligne) ; le sucre cosmétique déjà appliqué aux
// commentaires AILLEURS dans le fichier (µinspect → µ.inspect, $x → $.x) reste inchangé — un
// commentaire de FIN de ligne qui cite un HOOK (µmount, µderived…) doit d'ailleurs continuer à
// être refusé (cf. gardes-hors-script-commentaires.test.ts, comportement voulu, pas cette garde).
// Le code RÉEL voisin d'un commentaire n'est, lui, jamais affecté.

import assert from 'node:assert/strict'
import { cleanJs, cleanJsExpr } from '../src/generator/utils.js'
import { transpile } from '../src/transpiler/index.js'

describe('un commentaire qui cite µinspect/µminmax ne casse jamais la compilation (cleanJs)', () => {
  it('commentaire // en tête de ligne : ne lève pas, le code voisin reste intact', () => {
    const src = '// µinspect($x.foo) est refuse ici\ndoStuff()'
    assert.doesNotThrow(() => cleanJs(src))
    assert.equal(cleanJs(src).endsWith('\ndoStuff()'), true)
  })

  it('commentaire /* */ : ne lève pas, le code voisin reste intact', () => {
    const src = '/* µminmax($config.volume, 0, 10) est refuse ici */\ndoStuff()'
    assert.doesNotThrow(() => cleanJs(src))
    assert.equal(cleanJs(src).endsWith('\ndoStuff()'), true)
  })

  it('commentaire # Civet : ne lève pas, le code voisin reste intact', () => {
    const src = '# µinspect($x.foo) est refuse ici\ndoStuff()'
    assert.doesNotThrow(() => cleanJs(src))
    assert.equal(cleanJs(src).endsWith('\ndoStuff()'), true)
  })

  it('commentaire // en FIN de ligne (pas seulement en tête) : ne lève pas', () => {
    const src = 'doStuff() // µminmax($config.volume, 0, 10) est refuse ici'
    assert.doesNotThrow(() => cleanJs(src))
    assert.equal(cleanJs(src).startsWith('doStuff() '), true)
  })

  it('le code RÉEL voisin d\'un commentaire continue de fonctionner à l\'identique', () => {
    const src = '// rien ici\n$x'
    assert.equal(cleanJs(src), '// rien ici\n$.x')
  })
})

describe('un commentaire qui cite µinspect/µminmax ne casse jamais la compilation (cleanJsExpr)', () => {
  it('commentaire # Civet en fin d\'expression : intact, ne lève pas', () => {
    assert.doesNotThrow(() => cleanJsExpr('$config.volume # note ici µminmax($config.volume, 0, 10) leve une erreur'))
  })

  it('commentaire /* */ dans une expression : ne lève pas', () => {
    assert.doesNotThrow(() => cleanJsExpr('$x /* µinspect($x.foo) est refuse ici */'))
  })
})

describe('un commentaire qui cite µinspect/µminmax ne casse jamais la compilation (bout en bout)', () => {
  it('gestionnaire @click={ // … } citant µinspect : le composant compile', async () => {
    const src = '<button @click={\n  // µinspect($x.foo) est refuse ici\n  $x = 1\n}>go</button>\n<script>\n$x = 0\n</script>'
    await assert.doesNotReject(transpile(src, { moduleName: 'inspect-commentaire-handler' }))
  })

  // Pas de ':' dans le texte du commentaire : Civet natif bute déjà dessus SANS aucune rune
  // (limite préexistante et hors périmètre de ce correctif, vérifiée par sonde directe sur
  // civet.compile — même échec avec un commentaire ordinaire, aucune rune citée).
  it('interpolation avec commentaire Civet # citant µminmax : le composant compile', async () => {
    const src = '<script>\n$config = {volume: 5}\n</script>\n<p>{$config.volume # note µminmax($config.volume, 0, 10) leve une erreur\n}</p>'
    await assert.doesNotReject(transpile(src, { moduleName: 'minmax-commentaire-interpolation' }))
  })
})
