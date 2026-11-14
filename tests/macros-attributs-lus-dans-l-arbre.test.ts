// les attributs des balises du langage (`<@window>`, `<@body>`, `<@head>`…) sont lus dans l'arbre du gabarit : un
// gestionnaire se lit en entier (une accolade dans une de ses chaînes ne le coupe pas), un texte écrit dans le corps d'un
// gestionnaire (`class="a"`, `--x={1}`) n'est ni une classe ni une variable CSS, la fermante `</@head>` écrite dans une
// valeur d'attribut ne ferme rien ; un gabarit qui signale une faute ailleurs est lu par son arbre comme les autres

import assert from 'node:assert/strict'
import { processGlobalMacros } from '../src/transpiler/macros.js'
import { transpile } from '../src/transpiler/index.js'

function macros(html: string): ReturnType<typeof processGlobalMacros> {
  const orig = console.error
  console.error = () => {}
  try {
    return processGlobalMacros(html)
  }
  finally {
    console.error = orig
  }
}

describe('les attributs des balises du langage, lus dans l\'arbre du gabarit', () => {
  it('une accolade dans une chaîne d\'un gestionnaire ne le coupe pas', () => {
    const r = macros('<@window @keydown={f(\'}\')}>\n<p>x</p>')
    assert.deepEqual(r.errors, [])
    assert.match(r.setup, /\n {2}f\('\}'\)\n/)
    assert.match(r.setup, /window\.addEventListener\('keydown'/)
    assert.equal(r.html, '\n<p>x</p>')
  })

  it('un class="…" écrit dans le corps d\'un gestionnaire de <@body> n\'est pas une classe', () => {
    const r = macros('<@body @click={s = \'class="a"\'}>')
    assert.deepEqual(r.errors, [])
    assert.doesNotMatch(r.setup, /_glCl/)
    assert.match(r.setup, /s = 'class="a"'/)
  })

  it('un --x={…} écrit dans le corps d\'un gestionnaire de <@body> n\'est pas une variable CSS', () => {
    const r = macros('<@body @click={s = \'--x={1}\'}>')
    assert.deepEqual(r.errors, [])
    assert.doesNotMatch(r.setup, /_glSt/)
    assert.match(r.setup, /s = '--x=\{1\}'/)
  })

  it('une fermante </@head> écrite dans une valeur d\'attribut ne ferme pas le bloc', () => {
    const r = macros('<@head><meta name="a" content="</@head>"></@head><p>x</p>')
    assert.deepEqual(r.errors, [])
    assert.equal(r.html, '<p>x</p>')
    assert.match(r.setup, /_setHead/)
  })

  it('une fermante </@head> citée dans une interpolation d\'un vrai <@head> ne le ferme pas', async () => {
    const { output } = await transpile('<script>\nf = -> 1\n</script>\n<@head><title>{"</@head>"}</title><meta name="a"></@head>\n<p>x</p>\n', { moduleName: 'hote' })
    assert.match(output, /_setHead\(this, '<title>' \+ µ\._esc\("<\/@head>"\) \+ '<\/title><meta name="a">'\)/)
  })

  it('un gabarit qui signale une faute ailleurs : une balise écrite dans un <textarea> reste un texte', () => {
    const r = macros('<textarea><@window @resize={f}></textarea>\n</p>')
    assert.doesNotMatch(r.setup, /addEventListener\('resize'/)
    assert.match(r.html, /<textarea><@window @resize=\{f\}><\/textarea>/)
  })

  it('une vraie balise suivie d\'une faute agit comme avant', () => {
    const r = macros('<@window @resize={f}>\n</p>')
    assert.match(r.setup, /window\.addEventListener\('resize'/)
  })
})
