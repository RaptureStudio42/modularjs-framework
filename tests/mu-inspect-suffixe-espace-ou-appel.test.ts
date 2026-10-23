// µinspect(...) : un espace autour du point (`$x . foo`) ou un appel en suffixe (`$x.foo()`)
// échappaient à la détection du chemin invalide — ni la forme parenthésée ni la forme nue ne
// matchaient, le texte ressortait tel quel puis était recyclé par le sucre `$x` général (parenthèse
// orpheline, clé hors quotes). Ces formes lèvent la même erreur claire que la forme collée
// (`$x.foo`, cf. mu-inspect-suffixe-jamais-orphelin.test.ts) ; les formes documentées restent
// inchangées.
//
// Une INDEXATION entre crochets (`$x[0]`, `$x['a']`, `$x[k]`) échappait de la même façon — une clé
// en chaîne littérale (`$x['a']`) coupait même l'appel en deux morceaux disjoints (découpage
// code/chaîne, mapCodeSegments, AVANT la détection). µinspect accepte un index LITTÉRAL (entier ou
// chaîne, cf. sigils.ts cheminSegments) comme n'importe quel chemin FIXE et ne refuse que le calculé
// (`$x[k]`, `$x[$k]`).
//
// La détection distingue le chemin invalide par LISTE BLANCHE (ce qui termine légitimement
// l'argument) plutôt que par une liste noire de formes interdites : une parenthèse ou un crochet
// IMBRIQUÉ (`$o(bar())`, `$o[a[0]]`) contournait chaque entrée ajoutée à l'ancienne liste. Même
// garde pour un appel dont un argument est une chaîne littérale (`$x.foo('a')`). Les commentaires
// qui citent une forme refusée — µinspect, ou l'ancien µminmax — ne lèvent jamais rien.

import assert from 'node:assert/strict'
import { cleanJs, cleanJsExpr } from '../src/generator/utils.js'
import { transpile } from '../src/transpiler/index.js'

describe('µinspect($x) — formes documentées, toujours inchangées', () => {
  it("forme parenthésée : µinspect($x) → µ.inspect('x')", () => {
    assert.equal(cleanJs('µinspect($x)'), "µ.inspect('x')")
  })

  it("forme nue : µinspect $x → µ.inspect('x')", () => {
    assert.equal(cleanJs('µinspect $x'), "µ.inspect('x')")
  })

  it('un accès APRÈS l\'appel (µinspect($x).foo) reste un appel valide', () => {
    assert.equal(cleanJs('µinspect($x).foo'), "µ.inspect('x').foo")
  })
})

describe('µinspect(...) — espace autour du point : refusé, même erreur que la forme collée', () => {
  it('forme parenthésée avec espaces autour du point et des parenthèses', () => {
    assert.throws(() => cleanJs('µinspect( $x . foo )'), /µinspect/)
  })

  it('forme nue avec espaces autour du point', () => {
    assert.throws(() => cleanJs('µinspect $x . foo'), /µinspect/)
  })

  it('cleanJsExpr : même refus', () => {
    assert.throws(() => cleanJsExpr('µinspect( $x . foo )'), /µinspect/)
  })

  it('dans le <script> d\'un composant : la compilation échoue avec ce message', async () => {
    const src = '<script>\n$x = {foo: 1}\nµinspect( $x . foo )\n</script>\n<p>{$x.foo}</p>'
    await assert.rejects(transpile(src, { moduleName: 'inspect-suffixe-espace' }), /µinspect/)
  })
})

describe('µinspect(...) — appel en suffixe : refusé, même erreur que la forme collée', () => {
  it('µinspect($x.foo()) — appel sur le chemin', () => {
    assert.throws(() => cleanJs('µinspect($x.foo())'), /µinspect/)
  })

  it('cleanJsExpr : même refus', () => {
    assert.throws(() => cleanJsExpr('µinspect($x.foo())'), /µinspect/)
  })

  it('dans le <script> d\'un composant : la compilation échoue avec ce message', async () => {
    const src = '<script>\n$x = {foo: () => 1}\nµinspect($x.foo())\n</script>\n<p>{$x}</p>'
    await assert.rejects(transpile(src, { moduleName: 'inspect-suffixe-appel' }), /µinspect/)
  })
})

describe('µinspect(...) — index LITTÉRAL entre crochets : accepté (chemin fixe)', () => {
  it('clé statique numérique, forme parenthésée : µinspect($x[0]) → µ.inspect(\'x\', \'0\')', () => {
    assert.equal(cleanJs('µinspect($x[0])'), "µ.inspect('x', '0')")
  })

  it("clé statique en chaîne : µinspect($x['a']) → µ.inspect('x', 'a')", () => {
    assert.equal(cleanJs("µinspect($x['a'])"), "µ.inspect('x', 'a')")
  })

  it('chemin puis indexation : µinspect($x.a[0]) → µ.inspect(\'x\', \'a.0\')', () => {
    assert.equal(cleanJs('µinspect($x.a[0])'), "µ.inspect('x', 'a.0')")
  })

  it('indexation puis chemin : µinspect($x[0].a) → µ.inspect(\'x\', \'0.a\')', () => {
    assert.equal(cleanJs('µinspect($x[0].a)'), "µ.inspect('x', '0.a')")
  })

  it('forme nue, clé numérique : µinspect $x[0] → µ.inspect(\'x\', \'0\')', () => {
    assert.equal(cleanJs('µinspect $x[0]'), "µ.inspect('x', '0')")
  })

  it('cleanJsExpr : même acceptation (clé numérique)', () => {
    assert.match(cleanJsExpr('µinspect($x[0])'), /µ\.inspect\(\s*'x'\s*,\s*'0'\s*\)/)
  })

  it('cleanJsExpr : même acceptation (clé en chaîne)', () => {
    assert.match(cleanJsExpr("µinspect($x['a'])"), /µ\.inspect\(\s*'x'\s*,\s*'a'\s*\)/)
  })
})

describe('µinspect(...) — index CALCULÉ ou espacé : refusé, même erreur que la forme collée', () => {
  it('clé dynamique (identifiant) : µinspect($x[k])', () => {
    assert.throws(() => cleanJs('µinspect($x[k])'), /µinspect/)
  })

  it('clé dynamique (symbole $) : µinspect($x[$k])', () => {
    assert.throws(() => cleanJs('µinspect($x[$k])'), /µinspect/)
  })

  it('espace avant le crochet : µinspect($x [k])', () => {
    assert.throws(() => cleanJs('µinspect($x [k])'), /µinspect/)
  })

  it('forme nue, avec espace : µinspect $x [k]', () => {
    assert.throws(() => cleanJs('µinspect $x [k]'), /µinspect/)
  })

  it('cleanJsExpr : même refus (clé dynamique)', () => {
    assert.throws(() => cleanJsExpr('µinspect($x[k])'), /µinspect/)
  })

  it('parenthèse IMBRIQUÉE dans un appel : µinspect($x(bar()))', () => {
    assert.throws(() => cleanJs('µinspect($x(bar()))'), /µinspect/)
  })

  it('crochet IMBRIQUÉ dans une indexation : µinspect($x[a[0]])', () => {
    assert.throws(() => cleanJs('µinspect($x[a[0]])'), /µinspect[\s\S]*\$x\[a\[0\]\]/)
  })
})

describe('µinspect(...) — appel dont un argument est une chaîne : même garde', () => {
  it("µinspect($x.foo('a')) : la clé en chaîne au milieu de l'appel n'échappe pas à la détection", () => {
    assert.throws(() => cleanJs("µinspect($x.foo('a'))"), /µinspect/)
  })

  it("commentaire citant µinspect($x.foo('a')) : ne lève pas, le code voisin reste intact", () => {
    const src = "// µinspect($x.foo('a')) est refuse ici\ndoStuff()"
    assert.doesNotThrow(() => cleanJs(src))
    assert.equal(cleanJs(src).endsWith('\ndoStuff()'), true)
  })
})

describe('µinspect $x (forme nue) — terminateurs valides au-delà des exemples documentés', () => {
  it('point-virgule après la variable : reste un appel valide, la suite du handler est intacte', () => {
    assert.equal(cleanJs('µinspect $x; doStuff()'), "µ.inspect('x'); doStuff()")
  })

  it('fin de ligne après la variable : reste un appel valide, la ligne suivante est intacte', () => {
    assert.equal(cleanJs('µinspect $x\ndoStuff()'), "µ.inspect('x')\ndoStuff()")
  })
})

describe('indexation entre crochets citée dans un commentaire ou une chaîne — jamais de faux positif', () => {
  it('commentaire // en tête, µinspect, clé en chaîne : ne lève pas, le code voisin reste intact', () => {
    const src = "// µinspect($x['a']) est refuse ici\ndoStuff()"
    assert.doesNotThrow(() => cleanJs(src))
    assert.equal(cleanJs(src).endsWith('\ndoStuff()'), true)
  })

  it('commentaire // en fin de ligne, µminmax, clé en chaîne : ne lève pas', () => {
    const src = "doStuff() // µminmax($x['a'], 0, 10) est refuse ici"
    assert.doesNotThrow(() => cleanJs(src))
    assert.equal(cleanJs(src).startsWith('doStuff() '), true)
  })

  it('commentaire /* */, µminmax, clé en chaîne : ne lève pas', () => {
    const src = "/* µminmax($x['a'], 0, 10) est refuse ici */\ndoStuff()"
    assert.doesNotThrow(() => cleanJs(src))
    assert.equal(cleanJs(src).endsWith('\ndoStuff()'), true)
  })

  it('commentaire # Civet, µinspect, clé en chaîne : ne lève pas', () => {
    const src = "# µinspect($x['a']) est refuse ici\ndoStuff()"
    assert.doesNotThrow(() => cleanJs(src))
    assert.equal(cleanJs(src).endsWith('\ndoStuff()'), true)
  })

  it('chaîne littérale : ne lève pas, le texte ressort intact', () => {
    const src = "texte = 'appelle µinspect($x[0]) pour inspecter'"
    assert.doesNotThrow(() => cleanJs(src))
    assert.equal(cleanJs(src), src)
  })
})

describe('indexation entre crochets — bout en bout (gestionnaire, interpolation, attribut lié)', () => {
  it('gestionnaire @click={µinspect($x[0])} : la compilation réussit (index littéral accepté)', async () => {
    const src = '<button @click={µinspect($x[0])}>go</button>\n<script>\n$x = [1, 2, 3]\n</script>'
    const { output } = await transpile(src, { moduleName: 'inspect-indexation-handler' })
    assert.match(output, /µ\.inspect\(\s*'x'\s*,\s*'0'\s*\)/)
  })

  it('interpolation {µinspect($x[0])} : la compilation réussit (index littéral accepté)', async () => {
    const src = '<script>\n$x = [1, 2, 3]\n</script>\n<p>{µinspect($x[0])}</p>'
    const { output } = await transpile(src, { moduleName: 'inspect-indexation-interpolation' })
    assert.match(output, /µ\.inspect\(\s*'x'\s*,\s*'0'\s*\)/)
  })

})

// un gabarit collé au nom (`` $x`t` ``, appel de fonction « étiquetée » en JavaScript) disparaît
// dans la vue masquée où chaînes et gabarits deviennent des espaces : sans contrôle sur le texte
// réel, il passait pour un simple espacement et échappait à la garde
describe('µinspect(...) — gabarit collé au nom : refusé, même erreur que la forme collée', () => {
  it('µinspect($x`t`) lève une erreur claire', () => {
    assert.throws(() => cleanJs('µinspect($x`t`)'), /µinspect/)
  })

  it('µinspect $x`t` (forme nue) lève une erreur claire', () => {
    assert.throws(() => cleanJs('µinspect $x`t`'), /µinspect/)
  })

  it('gabarit avec interpolation ou vide : même erreur', () => {
    assert.throws(() => cleanJs('µinspect($x`${f()}`)'), /µinspect/)
    assert.throws(() => cleanJsExpr('µinspect($x``)'), /µinspect/)
  })

  it('un commentaire entre le nom et la fin de l\'argument reste accepté (rien d\'exécuté)', () => {
    assert.doesNotThrow(() => cleanJs('µinspect($x /* suivi */)'))
  })

  it('gestionnaire @click={µinspect($x`t`)} : la compilation échoue avec ce message', async () => {
    const src = '<script>\n$x = 1\n</script>\n<button @click={µinspect($x`t`)}>go</button>'
    await assert.rejects(transpile(src, { moduleName: 'inspect-gabarit-gestionnaire' }), /µinspect/)
  })
})
