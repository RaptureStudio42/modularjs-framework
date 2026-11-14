// Contrôle des reffets à la construction. Une fonction refermée avant un reffet, dans une racine `µeffect.root` entre accolades
// (`const f = (x) => x` sur sa ligne, en JavaScript), ne l'enveloppe pas : le reffet est accepté ; en Civet et en CoffeeScript, une
// fonction écrite sur une ligne continue après un `;`, le reffet écrit après lui y reste refusé. Le refus d'un reffet écrit dans un
// rappel du premier niveau (forEach) dit ce qui est vrai pour lui. Un reffet écrit dans un gestionnaire du gabarit, qui ne tournerait
// jamais, est refusé avec la forme qui marche ; celui écrit directement dans une racine y reste permis
import assert from 'node:assert/strict'
import { lintEffectGestionnaire, lintEffectTopLevel } from '../src/transpiler/lint.js'
import { transpile } from '../src/transpiler/index.js'

const refus = (src: string, lang = 'js'): string => {
  try {
    lintEffectTopLevel(src, false, 1, lang)
  }
  catch (e) {
    return String((e as Error).message)
  }
  return ''
}

describe('µeffect.root : une fonction refermée avant le reffet ne l\'enveloppe pas', () => {
  const ACCEPTES: [string, string, string][] = [
    ['const, flèche à corps en ligne, ligne d\'avant', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = (x) => x\n    µeffect(() => f(1))\n  })\n}'],
    ['let, flèche à corps en ligne', 'js', '@o = function() {\n  µeffect.root(() => {\n    let f = (x) => x * 2\n    µeffect(() => f(1))\n  })\n}'],
    ['flèche sans parenthèses', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = x => x\n    µeffect(() => f(1))\n  })\n}'],
    ['deux flèches, une ligne vide', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = (x) => x\n    const g = (y) => y\n\n    µeffect(() => f(g(1)))\n  })\n}'],
    ['même ligne, après un point-virgule', 'js', '@o = function() { µeffect.root(() => { const f = (x) => x; µeffect(() => f(1)) }) }'],
    ['function nommée', 'js', '@o = function() {\n  µeffect.root(() => {\n    function f(x) { return x }\n    µeffect(() => f(1))\n  })\n}'],
    ['flèche à accolades sur plusieurs lignes', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = (x) => {\n      return x\n    }\n    µeffect(() => f(1))\n  })\n}'],
    ['typescript', 'ts', '@o = function() {\n  µeffect.root(() => {\n    const f = (x: number): number => x\n    µeffect(() => f(1))\n  })\n}'],
    ['civet, accolades', 'civet', '@ouvrir = ->\n  µeffect.root(() => {\n    f = (x) => x * 2\n    µeffect(() => µ.log f($a))\n  })'],
    ['civet, retrait', 'civet', '@ouvrir = ->\n  µeffect.root ->\n    f = (x) -> x * 2\n    µeffect -> µ.log f($a)'],
    ['coffee, retrait', 'coffee', '@ouvrir = ->\n  µeffect.root ->\n    f = (x) -> x * 2\n    µeffect -> µ.log f($a)'],
  ]
  for (const [nom, lang, src] of ACCEPTES) it('accepté : ' + nom, () => assert.equal(refus(src, lang), ''))

  const REFUSES: [string, string, string][] = [
    ['corps de la flèche sur la ligne suivante', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = (x) =>\n      µeffect(() => x)\n  })\n}'],
    ['corps de la flèche après une ligne vide', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = (x) =>\n\n      µeffect(() => x)\n  })\n}'],
    ['reffet dans la flèche, même ligne', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = (x) => µeffect(() => x)\n  })\n}'],
    ['corps continué par un opérateur', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = (x) => x +\n      µeffect(() => x)\n  })\n}'],
    ['rappel de forEach sur deux lignes', 'js', '@o = function() {\n  µeffect.root(() => {\n    l.forEach((x) =>\n      µeffect(() => x))\n  })\n}'],
    ['rappel de minuterie', 'js', '@o = function() {\n  µeffect.root(() => {\n    setTimeout(() =>\n      µeffect(() => 1), 10)\n  })\n}'],
    ['civet : la fonction continue après un point-virgule', 'civet', '@ouvrir = -> µeffect.root(() => { f = (x) => x; µeffect(-> µ.log $a) })'],
    ['coffee : la fonction continue après un point-virgule', 'coffee', '@ouvrir = -> µeffect.root -> f = (x) -> x; µeffect(-> µ.log $a)'],
  ]
  for (const [nom, lang, src] of REFUSES) it('refusé : ' + nom, () => assert.match(refus(src, lang), /imbriqué/))
})

describe('µeffect dans un rappel du premier niveau du script : le refus dit ce qui est vrai', () => {
  it('forEach : refusé même appelé tout de suite, avec la boucle dans le reffet', () => {
    for (const [lang, src] of [['civet', 'liste.forEach (x) ->\n  µeffect -> µ.log x'], ['js', 'liste.forEach((x) => {\n  µeffect(() => µ.log(x))\n})']]) {
      const m = refus(src, lang)
      assert.match(m, /« µeffect » imbriqué \(ligne 2\)/)
      assert.match(m, /premier niveau du <script>/)
      assert.match(m, /appelé tout de suite, comme celui d'un forEach, est refusé de même/)
      assert.match(m, /µeffect -> liste\.forEach \(x\) -> …/)
      assert.doesNotMatch(m, /rappel \(minuterie, boucle\), appelés plus tard/)
    }
  })
})

describe('µeffect dans un gestionnaire du gabarit', function () {
  this.timeout(30000)
  const composant = (gabarit: string, script = '$n = 0'): string => `<script>\n${script}\n</script>\n${gabarit}\n<p>{$n}</p>\n`
  const REFUSES: [string, string, RegExp][] = [
    ['reffet nu', '<button @click={µeffect -> µ.log $n}>a</button>', /« µeffect » dans le gestionnaire @click \(ligne 4\)/],
    ['reffet dans une flèche', '<button @click={-> µeffect -> µ.log $n}>b</button>', /« µeffect » dans le gestionnaire @click \(ligne 4\)/],
    ['reffet sur plusieurs lignes', '<button @click={(e) ->\n  µeffect ->\n    µ.log $n\n}>c</button>', /« µeffect » dans le gestionnaire @click \(ligne 4\)/],
    ['balise globale', '<@window @resize={µeffect -> µ.log $n}></@window>', /« µeffect » dans le gestionnaire @resize \(ligne 4\)/],
  ]
  for (const [nom, gabarit, motif] of REFUSES) it('refusé : ' + nom, async () => {
    await assert.rejects(transpile(composant(gabarit), { moduleName: 'rg-refus' }), (e: Error) => {
      assert.match(e.message, motif)
      assert.match(e.message, /µeffect\.root -> µeffect -> …/)
      return true
    })
  })
  it('refusé : reffet dans un rappel écrit dans la racine d\'un gestionnaire (la règle de la racine)', async () => {
    await assert.rejects(transpile(composant('<button @click={µeffect.root -> [1].forEach((x) -> µeffect(-> µ.log x))}>e</button>'), { moduleName: 'rg-racine-rappel' }), /premier niveau de la racine/)
  })
  const ACCEPTES: [string, string][] = [
    ['racine, reffet écrit dedans', composant('<button @click={µeffect.root -> µeffect -> µ.log $n}>o</button>')],
    ['racine, deux reffets sur la ligne', composant('<button @click={µeffect.root -> µeffect(-> µ.log $n); µeffect(-> µ.log $n)}>o</button>')],
    ['script en JavaScript, racine entre accolades dans le gestionnaire', `<script lang="js">\n$n = 0;\n</script>\n<button @click={void (window.__arret = µeffect.root(() => { µeffect(() => { window.__g = $n; }); }))}>o</button>\n<p>{$n}</p>\n`],
    ['nom µeffect dans une chaîne', composant('<button @click={µ.log "µeffect -> x"}>o</button>')],
    ['µinspect, que ce contrôle ne regarde pas', composant('<button @click={µinspect $n}>o</button>')],
  ]
  for (const [nom, src] of ACCEPTES) it('accepté : ' + nom, async () => {
    await transpile(src, { moduleName: 'rg-ok' })
  })
  it('gestionnaire écrit en CoffeeScript, lu en Civet : refusé hors d\'une racine, accepté dans la racine', () => {
    for (const code of ['µeffect(-> µ.log($n))', '-> µeffect(-> 1)', 'go(); µ.effect(-> 1)']) assert.throws(() => lintEffectGestionnaire(code, '@click', 7), /dans le gestionnaire @click \(ligne 7\)/)
    for (const code of ['void (window.__a = µeffect.root(-> µeffect(-> 1)))', 'µeffect.root ->\n  f = (x) -> x\n  µeffect(-> f(1))', 'µ.log("µeffect(-> 1)")']) assert.doesNotThrow(() => lintEffectGestionnaire(code, '@click', 7))
  })
})
