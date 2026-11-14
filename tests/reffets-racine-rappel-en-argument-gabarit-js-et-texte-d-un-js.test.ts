// Contrôle des reffets à la construction et relevé des fichiers `.js`. Dans une racine `µeffect.root` entre accolades, un reffet écrit dans
// un argument d'appel du corps d'une fonction écrite dans la racine (`.then((r) => arrets.push(µeffect(…)))`) est dans un rappel : refusé,
// comme écrit sur trois lignes ; une fonction refermée avant lui ne l'enveloppe pas. Un gestionnaire d'un gabarit en "js" est compilé par
// CoffeeScript, il se contrôle comme du CoffeeScript : une racine écrite sur deux lignes y est permise comme sur une, et une fonction
// écrite sur une ligne y continue après un `;`. Le texte d'un fichier `.js` (commentaire, chaîne) n'emmène rien au cœur ; un `.effect(`
// appelé sur µ reçu sous un autre nom emmène le module des reffets
import assert from 'node:assert/strict'
import { lintEffectTopLevel } from '../src/transpiler/lint.js'
import { transpile } from '../src/transpiler/index.js'
import { scanJsReffets } from '../src/bundler/features.js'

const refus = (src: string, lang: string): string => {
  try {
    lintEffectTopLevel(src, false, 1, lang)
  }
  catch (e) {
    return String((e as Error).message)
  }
  return ''
}

describe('µeffect.root entre accolades : reffet dans un argument d\'appel d\'une fonction écrite dans la racine', () => {
  const REFUSES: [string, string, string][] = [
    ['then, push', 'js', '@o = function() {\n  µeffect.root(() => {\n    charger().then((r) => arrets.push(µeffect(() => µ.log(r))))\n  })\n}'],
    ['microtâche, appel', 'js', '@o = function() {\n  µeffect.root(() => {\n    queueMicrotask(() => g(µeffect(() => 1)))\n  })\n}'],
    ['forEach, push', 'js', '@o = function() {\n  µeffect.root(() => {\n    liste.forEach((x) => arrets.push(µeffect(() => x)))\n  })\n}'],
    ['map, tableau', 'js', '@o = function() {\n  µeffect.root(() => {\n    const l = liste.map((x) => [x, µeffect(() => x)])\n  })\n}'],
    ['flèche, virgule', 'js', '@o = function() {\n  µeffect.root(() => {\n    queueMicrotask(() => (a = 1, µeffect(() => 1)))\n  })\n}'],
    ['flèche, argument sur la ligne suivante', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = (x) => g(x,\n      µeffect(() => x))\n  })\n}'],
    ['minuterie, function, return', 'js', '@o = function() {\n  µeffect.root(() => {\n    setTimeout(function () { return g(µeffect(() => 1)) })\n  })\n}'],
    ['civet, then, push', 'civet', '@o = ->\n  µeffect.root(() => {\n    charger().then((r) => arrets.push(µeffect(-> µ.log r)))\n  })'],
    ['civet, forEach, push', 'civet', '@o = ->\n  µeffect.root(() => {\n    liste.forEach((x) => arrets.push(µeffect(-> µ.log x)))\n  })'],
    ['coffee, then, push', 'coffee', '@o = ->\n  µeffect.root(=>\n    charger().then((r) -> arrets.push(µeffect(-> µ.log r)))\n  )'],
    ['js, fonction concise puis ligne qui commence par une parenthèse (elle l\'appelle)', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = (x) => x\n    (µeffect(() => 1))\n  })\n}'],
    ['js, fonction concise puis ligne qui commence par un crochet', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = (x) => x\n    [µeffect(() => 1)]\n  })\n}'],
  ]
  for (const [nom, lang, src] of REFUSES) it('refusé : ' + nom, () => assert.match(refus(src, lang), /premier niveau de la racine/))

  const ACCEPTES: [string, string, string][] = [
    ['push, reffet directement dans la racine', 'js', '@o = function() {\n  µeffect.root(() => {\n    arrets.push(µeffect(() => 1))\n  })\n}'],
    ['fonction refermée, puis push sur la ligne', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = (x) => x; arrets.push(µeffect(() => f(1)))\n  })\n}'],
    ['fonction refermée sur la ligne d\'avant, puis push', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = (x) => x\n    arrets.push(µeffect(() => f(1)))\n  })\n}'],
    ['fonction concise, même ligne', 'js', '@o = function() { µeffect.root(() => { const f = () => 1; µeffect(() => {}) }) }'],
    ['fonction concise, ligne d\'avant', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = () => 1\n    µeffect(() => {})\n  })\n}'],
    ['js, fonction concise refermée par un point-virgule, puis parenthèse', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = (x) => x;\n    (µeffect(() => 1))\n  })\n}'],
    ['civet, fonction concise puis ligne qui commence par une parenthèse (instruction neuve)', 'civet', '@o = ->\n  µeffect.root(() => {\n    f = (x) => x\n    (µeffect(-> µ.log 1))\n  })'],
    ['sous un if entre accolades', 'js', '@o = function() {\n  µeffect.root(() => {\n    const f = (x) => x\n    if (ok(f)) {\n      arrets.push(µeffect(() => 1))\n    }\n  })\n}'],
  ]
  for (const [nom, lang, src] of ACCEPTES) it('accepté : ' + nom, () => assert.equal(refus(src, lang), ''))

  it('gestionnaire du gabarit : rappel de then dans la racine, refusé', async () => {
    const src = '<script>\n$n = 0\narrets = []\ncharger = -> Promise.resolve(1)\n</script>\n<button @click={µeffect.root(() => { charger().then((r) => arrets.push(µeffect(-> µ.log r))) })}>a</button>\n<p>{$n}</p>\n'
    await assert.rejects(transpile(src, { moduleName: 'rg-then' }), /premier niveau de la racine/)
  })
})

describe('fichier .js : relevé des reffets sur le code seul', () => {
  it('la racine citée dans un commentaire ou une chaîne : rien au cœur', () => {
    assert.deepEqual(scanJsReffets('// voir µ.effect.root(() => { µ.effect(() => 1) })\nexport const aide = \'µ.effect.before(() => 1)\'\n'), [])
    assert.deepEqual(scanJsReffets('/* m.effect(() => 1) */\nexport const gabarit = `µ.effect.root(() => 1)`\nexport const motif = /\\.effect\\(/\n'), [])
  })
  it('µ reçu sous un autre nom : m.effect( emmène le module des reffets', () => {
    assert.deepEqual(scanJsReffets('export const suivre = (m, salon) => m.effect(() => { window.__v = salon.data.v })\n'), ['effect'])
    assert.deepEqual(scanJsReffets('export const suivre = (m) => m?.effect (() => 1)\n'), ['effect'])
  })
  it('écrit dans le code : la racine, le reffet d\'avant l\'écran', () => {
    assert.deepEqual(scanJsReffets('export const o = (m) => m.effect.root(() => { m.effect(() => 1) })\n').sort(), ['effect', 'effect_root', 'effect_store'].sort())
    assert.ok(scanJsReffets('export const o = (µ) => µ.effect.before(() => 1)\n').includes('effect'))
  })
})
