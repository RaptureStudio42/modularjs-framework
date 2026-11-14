// commentaires retirés en premier, avant toute autre lecture : HTML du gabarit, scripts (Civet, Coffee, JS, TS), styles ;
// pièges gardés (chaîne, interpolation, regex, champ privé, adresse, <textarea>, <title>, valeur d'attribut) ; `//!` gardé ;
// lignes des erreurs ; `<@head>` / `<@failed>` cités dans une chaîne ou le texte d'un <style> : aucun jeton, sections justes

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { extractSections } from '../src/transpiler/sections.js'

const JETON  = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(8) + ']|MJSHF')
const sortie = async (src: string, nom = 'cas'): Promise<string> => String((await transpile(src, { moduleName: nom })).output)
const absents = (texte: string, cles: string[]): void => {
  for (const cle of cles) assert.ok(!texte.includes(cle), `« ${cle} » ne devait plus être dans le code produit`)
}
const presents = (texte: string, cles: string[]): void => {
  for (const cle of cles) assert.ok(texte.includes(cle), `« ${cle} » devait rester dans le code produit`)
}

describe('commentaires retirés en premier', function () {
  this.timeout(60000)

  it('Civet : #, ###, // et /* */ retirés ; chaîne, #{…}, regex et adresse gardées', async () => {
    const out = await sortie('<script>\n# c-ligne\n$n = 1 # c-fin\n###\nc-bloc\n###\n$u = "http://x # pas-c #{ 1 + 1 }"\n$r = /a#b/\n/* c-js */\n// c-js-ligne\n</script>\n<p>{$n}{$u}{$r}</p>\n')
    absents(out, ['c-ligne', 'c-fin', 'c-bloc', 'c-js', 'c-js-ligne'])
    presents(out, ['http://x # pas-c', '/a#b/'])
  })

  it('Coffee : # et ### retirés ; // reste la division entière', async () => {
    const out = await sortie('<script lang="coffee">\n# c-ligne\n$n = 7 // 2 # c-fin\n###\nc-bloc\n###\n$s = "a # pas-c"\n</script>\n<p>{$n}{$s}</p>\n')
    absents(out, ['c-ligne', 'c-fin', 'c-bloc'])
    presents(out, ['Math.floor', 'a # pas-c'])
  })

  it('JS : //, /* */, /*! */ et /*#__PURE__*/ retirés ; champ privé et chaîne gardés', async () => {
    const out = await sortie('<script lang="js">\n// c-ligne\n$n = 1 /* c-bloc */\n/*! c-legal */\nclass A { #x = 2; lire() { return this.#x } }\n$s = "// pas-c /* pas-c2 */"\n$p = /*#__PURE__*/ String(new A().lire())\n</script>\n<p>{$n}{$s}{$p}</p>\n')
    absents(out, ['c-ligne', 'c-bloc', 'c-legal', '__PURE__'])
    presents(out, ['#x', '// pas-c /* pas-c2 */'])
  })

  it('TS : // et /* */ retirés', async () => {
    const out = await sortie('<script lang="ts">\n// c-ligne\nlet n: number = 1 /* c-bloc */\n</script>\n<p>x</p>\n')
    absents(out, ['c-ligne', 'c-bloc'])
  })

  it('style : /* */ et /*! */ retirés ; chaîne et url( gardées ; // de SCSS retiré', async () => {
    const css = await sortie('<style lang="css">\n/* c-css */\np { color: red } /*! c-legal-css */\na { background: url(http://x/y.png); content: "/* pas-c */" }\n</style>\n<p>x</p>\n')
    absents(css, ['c-css', 'c-legal-css'])
    presents(css, ['http://x/y.png', '/* pas-c */'])
    absents(await sortie('<style lang="scss">\n// c-scss\np { color: red; }\n</style>\n<p>x</p>\n'), ['c-scss'])
  })

  it('gabarit : commentaire HTML retiré ; <textarea>, <title>, valeur d\'attribut et interpolation gardés', async () => {
    const out = await sortie('<@head>\n<title><!-- ti-garde --></title>\n</@head>\n<script>\n$n = 1\n</script>\n<!-- c-html -->\n<p title="<!-- a-garde -->">{"<!-- i-garde -->"}{$n}</p>\n<textarea><!-- t-garde --></textarea>\n')
    absents(out, ['c-html'])
    presents(out, ['ti-garde', 'a-garde', 'i-garde', 't-garde'])
  })

  it('`//!` gardé dans le code produit, son texte non lu ; dans le gabarit, du texte', async () => {
    presents(await sortie('<script>\n//! garde-civet $x µfoo <@head>\n$n = 1\n</script>\n<p>{$n}</p>\n'), ['//! garde-civet $x µfoo <@head>'])
    presents(await sortie('<script lang="js">\n//! garde-js\n$n = 1\n</script>\n<p>{$n}</p>\n'), ['//! garde-js'])
    presents(await sortie('<script lang="ts">\n//! garde-ts\nlet n = 1\n</script>\n<p>x</p>\n'), ['//! garde-ts'])
    presents(await sortie('<script lang="coffee">\n//! garde-coffee\n$n = 1\n</script>\n<p>{$n}</p>\n'), ['/*! garde-coffee'])
    presents(await sortie('<style lang="css">\n//! garde-css\np { color: red }\n</style>\n<p>x</p>\n'), ['/*! garde-css'])
    presents(await sortie('<p>//! texte-gabarit</p>\n'), ['//! texte-gabarit'])
  })

  it('lignes : une erreur après des commentaires de plusieurs lignes garde la ligne du fichier', async () => {
    await assert.rejects(transpile('<!--\nl2\nl3\n-->\n<script>\n###\nb\n###\n$x = )\n</script>\n<p>x</p>\n', { moduleName: 'lignes' }), (e: any) => /\.mjs:9:/.test(String(e?.message)))
  })

  it('<@head> / <@failed> cités dans une chaîne ou un commentaire du script, du module, le texte d\'un <style> : aucun jeton, sections justes', async () => {
    const CAS: [string, string, (s: any) => string, string][] = [
      ['civet', '<script>\n$a = "<@head><title>x</title></@head>"\n$n = 1\n</script>\n<@head><title>t</title></@head>\n<p>{$n}{$a}</p>\n', (s) => s.script.raw, '"<@head><title>x</title></@head>"'],
      ['civet #', '<script>\n# voir <@failed>\n$n = 1\n</script>\n<@failed><p>r</p></@failed>\n<p>{$n}</p>\n', (s) => s.script.raw, '$n = 1'],
      ['coffee', '<script lang="coffee">\n$f = "<@failed>"\n$n = 1\n</script>\n<@failed><p>r</p></@failed>\n<p>{$n}{$f}</p>\n', (s) => s.script.raw, '$f = "<@failed>"\n$n = 1'],
      ['js', '<script lang="js">\nconst a = \'<@head><title>x</title></@head>\'\n$n = a.length\n</script>\n<p>{$n}</p>\n', (s) => s.script.raw, 'const a = \'<@head><title>x</title></@head>\'\n$n = a.length'],
      ['module', '<script module>\nexport b = "<@failed>"\n</script>\n<script>\n$n = 1\n</script>\n<@failed><p>r</p></@failed>\n<p>{$n}</p>\n', (s) => s.module.raw, 'export b = "<@failed>"'],
      ['style', '<style lang="css">\np::before { content: "<@head>" }\n</style>\n<script>\n$n = 1\n</script>\n<@head><title>t</title></@head>\n<p>{$n}</p>\n', (s) => s.style.raw, 'p::before { content: "<@head>" }'],
    ]
    for (const [nom, src, lu, attendu] of CAS) {
      const s = extractSections(src)
      assert.ok(lu(s).includes(attendu), `${nom} : section lue ${JSON.stringify(lu(s))}`)
      assert.ok(!JETON.test(lu(s)) && !JETON.test(await sortie(src, 'cite' + nom.replace(/\W/g, ''))), `${nom} : jeton interne dans le code produit`)
    }
  })

  it('un vrai <@head> à <style> et <script src>, après un commentaire HTML qui ouvre <script src> : tête intacte', () => {
    const s = extractSections('<!--\n<script src="ancien.js">\n-->\n<@head>\n<style lang="css">\nbody { margin: 0 }\n</style>\n<script src="x.js"></script>\n</@head>\n<script>\n$n = 1\n</script>\n<p>{$n}</p>\n')
    assert.equal(s.style.raw, '')
    assert.ok(s.script.raw.includes('$n = 1') && s.html.includes('body { margin: 0 }') && s.html.includes('x.js'), JSON.stringify(s.html))
  })
})
