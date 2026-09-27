// src/mask — LE masqueur commun : `maskNonCode` (déplacée depuis transpiler/split-rune.ts,
// réexportée là-bas pour compatibilité), `maskInertSameLength` (réexportée depuis le lexer) et
// `maskHtmlComments` (neuve). Les trois gardent la MÊME LONGUEUR que l'entrée : un match trouvé
// sur la vue masquée reste à la bonne position sur le texte d'origine.

import assert from 'node:assert/strict'
import { maskNonCode, maskInertSameLength, maskHtmlComments } from '../src/mask.js'

// masqué ? — vrai si la sous-chaîne `needle` de `src` a été blanchie par `fn`
function estMasque(fn: (s: string) => string, src: string, needle: string): boolean {
  const at = src.indexOf(needle)
  assert.notEqual(at, -1, `motif absent de la source de test : ${needle}`)
  return fn(src).slice(at, at + needle.length).trim() === ''
}

describe('mask.ts — maskNonCode : même longueur, retours à la ligne gardés', () => {
  it('longueur et nombre de lignes préservés', () => {
    const src    = 'a = "x"\nb = 2\n'
    const masked = maskNonCode(src)
    assert.equal(masked.length, src.length)
    assert.equal((masked.match(/\n/g) ?? []).length, 2)
  })

  it('chaîne simple (guillemet simple) masquée', () => {
    assert.equal(estMasque(maskNonCode, "a = 'secret'\nb = 2\n", 'secret'), true)
  })

  it('chaîne double masquée', () => {
    assert.equal(estMasque(maskNonCode, 'a = "secret"\nb = 2\n', 'secret'), true)
  })

  it('gabarit imbriqué `${`…${…}…`}` : le code de CHAQUE interpolation reste lisible, le texte littéral masqué', () => {
    const src    = 'a = `dehors ${ `interne ${x}` } fin`\n'
    const masked = maskNonCode(src)
    assert.equal(estMasque(maskNonCode, src, 'dehors'), true)
    assert.equal(estMasque(maskNonCode, src, 'interne'), true)
    assert.equal(estMasque(maskNonCode, src, 'fin'), true)
    assert.ok(masked.includes('x'), 'le code x de l\'interpolation la plus interne reste visible')
  })

  it('interpolation Civet `#{}` (guillemets doubles) : code lisible, guillemets simples : texte littéral', () => {
    assert.ok(maskNonCode('a = "v #{x}"\n').includes('x'), 'guillemet double : #{} interpole, x visible')
    assert.equal(estMasque(maskNonCode, "a = 'v #{x}'\n", 'x'), true, 'guillemet simple : #{} est du texte, x masqué')
  })

  it('heredocs Civet/Coffee `\'\'\'…\'\'\'`/`"""…"""` masqués', () => {
    assert.equal(estMasque(maskNonCode, "a = '''\nbloc entier\n'''\n", 'bloc entier'), true)
    assert.equal(estMasque(maskNonCode, 'a = """\nbloc entier\n"""\n', 'bloc entier'), true)
  })

  it('commentaires // et /* */ masqués', () => {
    assert.equal(estMasque(maskNonCode, 'x = 1 // ligne js\n', 'ligne js'), true)
    assert.equal(estMasque(maskNonCode, 'x = 1 /* bloc */\n', 'bloc'), true)
  })

  it('commentaire # (Civet/Coffee) masqué, champ privé JS #nom non masqué', () => {
    assert.equal(estMasque(maskNonCode, 'x = 1 # note ici\n', 'note ici'), true)
    assert.equal(estMasque((s) => maskNonCode(s, 'js'), 'this.#nom = 1\n', 'nom'), false)
  })

  it('bloc ###…### masqué', () => {
    assert.equal(estMasque(maskNonCode, '###\nbloc entier\n###\nx = 1\n', 'bloc entier'), true)
  })

  it('regex littéral masqué, division NON masquée', () => {
    assert.equal(estMasque(maskNonCode, 'x = /motif secret/\n', 'motif secret'), true)
    assert.equal(estMasque(maskNonCode, 'x = a / b / c\n', 'b'), false)
  })

  // divergence ASSUMÉE avec maskInertSameLength (cf. describe suivant) : ici, une chaîne jamais
  // refermée blanchit tout ce qui suit jusqu'à la fin du source (repli conservateur d'un lint
  // qui doit ignorer tout ce qui vient après un littéral cassé, pas le laisser fuiter en code)
  it('littéral (chaîne) non terminé : masqué jusqu\'à la fin du source (repli du lint)', () => {
    assert.equal(estMasque(maskNonCode, 'x = "jamais fermee\ny = suite\n', 'jamais fermee'), true)
    assert.equal(estMasque(maskNonCode, 'x = "jamais fermee\ny = suite\n', 'suite'), true)
  })
})

describe('mask.ts — maskInertSameLength : réexport du lexer, gabarit blanchi en bloc', () => {
  it('réexporte la même fonction que le lexer (identité)', async () => {
    const lexer = await import('../src/lexer/index.js')
    assert.equal(maskInertSameLength, lexer.maskInertSameLength)
  })

  it('gabarit entier masqué, interpolation comprise', () => {
    assert.equal(estMasque(maskInertSameLength, 'a = `x ${y} z`\nb = 2\n', 'y'), true)
  })

  // contraste avec maskNonCode (describe précédent) : ici, le garde-fou reste lucide sur un
  // littéral cassé — rien n'est masqué, le reste du texte garde ses positions réelles
  it('littéral non terminé : rien n\'est masqué (garde-fou reliquats de sections.ts)', () => {
    assert.equal(estMasque(maskInertSameLength, 'a = "jamais fermee\nb = suite\n', 'suite'), false)
  })
})

describe('mask.ts — maskHtmlComments : commentaires HTML `<!-- … -->`', () => {
  it('longueur et nombre de lignes préservés', () => {
    const src    = '<p>x</p>\n<!--\nc\n-->\n<p>y</p>\n'
    const masked = maskHtmlComments(src)
    assert.equal(masked.length, src.length)
    assert.equal((masked.match(/\n/g) ?? []).length, (src.match(/\n/g) ?? []).length)
  })

  it('contenu du commentaire masqué, HTML autour intact', () => {
    const src = '<p>avant</p>\n<!-- <script>secret()</script> -->\n<p>apres</p>\n'
    assert.equal(estMasque(maskHtmlComments, src, 'secret()'), true)
    assert.equal(estMasque(maskHtmlComments, src, 'avant'), false)
    assert.equal(estMasque(maskHtmlComments, src, 'apres'), false)
  })

  it('commentaire jamais refermé : rien n\'est masqué (motif LAZY, même tolérance que le HTML natif)', () => {
    assert.equal(estMasque(maskHtmlComments, '<!-- jamais ferme\n<p>reste</p>\n', 'reste'), false)
  })
})
