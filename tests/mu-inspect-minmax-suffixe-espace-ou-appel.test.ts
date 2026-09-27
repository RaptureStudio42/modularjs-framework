// µinspect(...)/µminmax(...) : un espace autour du point (`$x . foo`) ou un appel en suffixe
// (`$x.foo()`) échappaient à la détection du chemin invalide — ni la forme parenthésée ni la
// forme nue ne matchaient, le texte ressortait tel quel puis était recyclé par le sucre `$x`
// général, reproduisant exactement le bug d'origine (parenthèse orpheline / clé hors quotes,
// jamais bornée). Ces formes lèvent désormais la même erreur claire que la forme collée
// (`$x.foo`, cf. mu-inspect-suffixe-jamais-orphelin.test.ts / mu-minmax-suffixe-chemin-imbrique.
// test.ts) ; les formes documentées restent inchangées.
//
// Une INDEXATION entre crochets (`$x[0]`, `$x['a']`, `$x[k]`) échappait de la même façon, dans
// TOUS les cas (clé statique ou dynamique, avec ou sans espace, seule ou mêlée à un chemin) —
// `µminmax($x[k], 0, 10)` ne bornait jamais rien (`µ.minmax(_mjsThis, 'x'[k], 0, 10)`, indexation
// d'un littéral chaîne) et `µinspect($x[k])` suivait la VALEUR au lieu de la clé
// (`µ.inspect($.x[k])`) — sans la moindre erreur. Une clé qui est elle-même une chaîne littérale
// (`$x['a']`) est un cas à part : le découpage en segments code/chaîne (mapCodeSegments), qui
// tourne AVANT la détection, coupait l'appel en deux morceaux disjoints de part et d'autre de la
// chaîne — aucun des deux ne correspondait plus au corps entier de la rune, l'indexation
// ressortait intacte quand même. µinspect et µminmax acceptent désormais un index LITTÉRAL
// (entier ou chaîne, cf. sigils.ts cheminSegments) comme n'importe quel autre chemin FIXE —
// µminmax borne alors cette propriété — et ne refusent plus que le calculé (`$x[k]`, `$x[$k]`). Les arguments
// min/max de µminmax, eux, peuvent librement contenir des crochets (seule la variable bornée,
// le tout premier argument, est concernée).
//
// La détection distingue désormais le chemin invalide par LISTE BLANCHE (ce qui termine
// légitimement l'argument — une parenthèse fermante, une virgule…) plutôt que par une liste noire
// de formes interdites énumérées une à une : une parenthèse ou un crochet IMBRIQUÉ dans le chemin
// (`$o(bar())`, `$o[a[0]]`) contournait justement chaque nouvelle entrée ajoutée à l'ancienne
// liste (rien ne comptait leur profondeur). Même garde pour un appel dont un argument est une
// chaîne littérale (`$x.foo('a')`) : la clé n'a pas besoin d'être entre crochets pour se cacher
// derrière une chaîne qui coupe la détection en deux morceaux disjoints.

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

describe('µminmax($x, min, max) — forme documentée, toujours inchangée', () => {
  it("µminmax($x, 0, 10) → µ.minmax(_mjsThis, 'x', 0, 10)", () => {
    assert.equal(cleanJs('µminmax($x, 0, 10)'), "µ.minmax(_mjsThis, 'x', 0, 10)")
  })
})

describe('µminmax(...) — espace autour du point : refusé, même erreur que la forme collée', () => {
  it('espace autour du point et des parenthèses', () => {
    assert.throws(() => cleanJs('µminmax( $config . volume, 0, 10)'), /µminmax/)
  })

  it('cleanJsExpr : même refus', () => {
    assert.throws(() => cleanJsExpr('µminmax( $config . volume, 0, 10)'), /µminmax/)
  })

  it('dans le <script> d\'un composant : la compilation échoue avec ce message', async () => {
    const src = '<script>\n$config = {volume: 50}\nµminmax( $config . volume, 0, 10)\n</script>\n<p>{$config.volume}</p>'
    await assert.rejects(transpile(src, { moduleName: 'minmax-suffixe-espace' }), /µminmax/)
  })
})

describe('µminmax(...) — appel en suffixe : refusé, même erreur que la forme collée', () => {
  it('µminmax($config.volume(), 0, 10) — appel sur le chemin', () => {
    assert.throws(() => cleanJs('µminmax($config.volume(), 0, 10)'), /µminmax/)
  })

  it('cleanJsExpr : même refus', () => {
    assert.throws(() => cleanJsExpr('µminmax($config.volume(), 0, 10)'), /µminmax/)
  })

  it('µminmax($config(), 0, 10) — appel SANS point devant (aucun \'.\' à détecter)', () => {
    assert.throws(() => cleanJs('µminmax($config(), 0, 10)'), /µminmax/)
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

describe('µminmax(...) — index LITTÉRAL entre crochets : accepté (chemin fixe)', () => {
  it("clé statique numérique : µminmax($x[0], 0, 10) → µ.minmax(_mjsThis, ['x', '0'], 0, 10)", () => {
    assert.equal(cleanJs('µminmax($x[0], 0, 10)'), "µ.minmax(_mjsThis, ['x', '0'], 0, 10)")
  })

  it("clé statique en chaîne : µminmax($x['a'], 0, 10) → µ.minmax(_mjsThis, ['x', 'a'], 0, 10)", () => {
    assert.equal(cleanJs("µminmax($x['a'], 0, 10)"), "µ.minmax(_mjsThis, ['x', 'a'], 0, 10)")
  })

  it("chemin puis indexation : µminmax($x.a[0], 0, 10) → ['x', 'a', '0']", () => {
    assert.equal(cleanJs('µminmax($x.a[0], 0, 10)'), "µ.minmax(_mjsThis, ['x', 'a', '0'], 0, 10)")
  })

  it("indexation puis chemin : µminmax($x[0].a, 0, 10) → ['x', '0', 'a']", () => {
    assert.equal(cleanJs('µminmax($x[0].a, 0, 10)'), "µ.minmax(_mjsThis, ['x', '0', 'a'], 0, 10)")
  })

  it('cleanJsExpr : même acceptation (clé numérique, clé en chaîne)', () => {
    assert.equal(cleanJsExpr('µminmax($x[0], 0, 10)'), "µ.minmax(_mjsThis, ['x', '0'], 0, 10)")
    assert.equal(cleanJsExpr("µminmax($x['a'], 0, 10)"), "µ.minmax(_mjsThis, ['x', 'a'], 0, 10)")
  })

  it('dans le <script> d\'un composant : compile', async () => {
    const src = '<script>\n$x = [1, 2, 3]\nµminmax($x[0], 0, 10)\n</script>\n<p>{$x}</p>'
    await assert.doesNotReject(transpile(src, { moduleName: 'minmax-indexation' }))
  })
})

describe('µminmax(...) — index CALCULÉ ou espacé : refusé, même erreur que la forme collée', () => {
  it('clé dynamique (identifiant) : µminmax($x[k], 0, 10)', () => {
    assert.throws(() => cleanJs('µminmax($x[k], 0, 10)'), /µminmax/)
  })

  it('clé dynamique (symbole $) : µminmax($x[$k], 0, 10)', () => {
    assert.throws(() => cleanJs('µminmax($x[$k], 0, 10)'), /µminmax/)
  })

  it('espace avant le crochet : µminmax($x [k], 0, 10)', () => {
    assert.throws(() => cleanJs('µminmax($x [k], 0, 10)'), /µminmax/)
  })

  it('cleanJsExpr : même refus (clé dynamique)', () => {
    assert.throws(() => cleanJsExpr('µminmax($x[k], 0, 10)'), /µminmax/)
  })

  it('dans le <script> d\'un composant : la compilation échoue avec ce message', async () => {
    const src = '<script>\n$x = [1, 2, 3]\nµminmax($x[k], 0, 10)\n</script>\n<p>{$x}</p>'
    await assert.rejects(transpile(src, { moduleName: 'minmax-indexation-calculee' }), /µminmax/)
  })

  it('parenthèse IMBRIQUÉE dans un appel : µminmax($o(bar()), 0, 10)', () => {
    assert.throws(() => cleanJs('µminmax($o(bar()), 0, 10)'), /µminmax[\s\S]*\$o\(bar\(\)\)/)
  })

  it('crochet IMBRIQUÉ dans une indexation : µminmax($o[a[0]], 0, 10)', () => {
    assert.throws(() => cleanJs('µminmax($o[a[0]], 0, 10)'), /µminmax[\s\S]*\$o\[a\[0\]\]/)
  })
})

describe('µinspect(...)/µminmax(...) — appel dont un argument est une chaîne : même garde', () => {
  it("µinspect($x.foo('a')) : la clé en chaîne au milieu de l'appel n'échappe pas à la détection", () => {
    assert.throws(() => cleanJs("µinspect($x.foo('a'))"), /µinspect/)
  })

  it("µminmax($config.volume('a'), 0, 10) : même garde", () => {
    assert.throws(() => cleanJs("µminmax($config.volume('a'), 0, 10)"), /µminmax/)
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

describe('µminmax($x, min, max) — les arguments min/max PEUVENT contenir des crochets', () => {
  it("seule la variable bornée (1er argument) est concernée : µminmax($x, $bornes[0], $bornes[1])", () => {
    assert.equal(
      cleanJs('µminmax($x, $bornes[0], $bornes[1])'),
      "µ.minmax(_mjsThis, 'x', $.bornes[0], $.bornes[1])"
    )
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

  it('gestionnaire @click={µminmax($x[0], 0, 10)} : la compilation réussit (index littéral accepté)', async () => {
    const src = '<button @click={µminmax($x[0], 0, 10)}>go</button>\n<script>\n$x = [1, 2, 3]\n</script>'
    const { output } = await transpile(src, { moduleName: 'minmax-indexation-handler' })
    assert.match(output, /µ\.minmax\(_mjsThis, \['x', '0'\], 0, 10\)/)
  })

  it('gestionnaire @click={µminmax($x[k], 0, 10)} : index calculé, la compilation échoue avec ce message', async () => {
    const src = '<button @click={µminmax($x[k], 0, 10)}>go</button>\n<script>\n$x = [1, 2, 3]\n</script>'
    await assert.rejects(transpile(src, { moduleName: 'minmax-indexation-handler-calculee' }), /µminmax/)
  })

  it('interpolation {µinspect($x[0])} : la compilation réussit (index littéral accepté)', async () => {
    const src = '<script>\n$x = [1, 2, 3]\n</script>\n<p>{µinspect($x[0])}</p>'
    const { output } = await transpile(src, { moduleName: 'inspect-indexation-interpolation' })
    assert.match(output, /µ\.inspect\(\s*'x'\s*,\s*'0'\s*\)/)
  })

  it('attribut lié value={µminmax($x[k], 0, 10)} : index calculé, la compilation échoue avec ce message', async () => {
    const src = '<script>\n$x = [1, 2, 3]\n</script>\n<input aria-label="v" value={µminmax($x[k], 0, 10)}>'
    await assert.rejects(transpile(src, { moduleName: 'minmax-indexation-attribut' }), /µminmax/)
  })
})

// un gabarit collé au nom (`` $x`t` ``, appel de fonction « étiquetée » en JavaScript) disparaît
// dans la vue masquée où chaînes et gabarits deviennent des espaces : sans contrôle sur le texte
// réel, il passait pour un simple espacement et échappait à la garde
describe('µinspect(...)/µminmax(...) — gabarit collé au nom : refusé, même erreur que la forme collée', () => {
  it('µinspect($x`t`) lève une erreur claire', () => {
    assert.throws(() => cleanJs('µinspect($x`t`)'), /µinspect/)
  })

  it('µinspect $x`t` (forme nue) lève une erreur claire', () => {
    assert.throws(() => cleanJs('µinspect $x`t`'), /µinspect/)
  })

  it('µminmax($config`x`, 0, 10) lève une erreur claire', () => {
    assert.throws(() => cleanJs('µminmax($config`x`, 0, 10)'), /µminmax/)
  })

  it('gabarit avec interpolation ou vide : même erreur', () => {
    assert.throws(() => cleanJs('µminmax($x`${f()}`, 0, 10)'), /µminmax/)
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
