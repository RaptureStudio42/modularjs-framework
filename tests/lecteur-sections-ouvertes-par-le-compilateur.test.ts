// le lecteur du fichier (src/reader) lit une section partout où le compilateur en ouvre une (bornesDesSections, la recherche
// d'extractSections), en tête de ligne ou non : après un commentaire HTML posé avant elle sur sa ligne (le compilateur retire les
// commentaires d'abord), après un séparateur de ligne U+2028 / U+2029 (une fin de ligne pour ses expressions), dans un <textarea>
// ou un <title>, dans un fichier en CRLF ou qui commence par un BOM. La section se referme où le compilateur la referme : un exemple
// <@@img> cité dans son code n'est pas une balise, la vraie <@@img> qui suit en est une ; les images des effets se lisent dans la
// langue du script du projet, comme le compilateur

import assert from 'node:assert/strict'
import { readFile, traverse } from '../src/reader/index.js'
import { sectionBounds, extractSections } from '../src/transpiler/sections.js'
import { scanImgTags } from '../src/transpiler/img-tag.js'
import { scanEffectImages } from '../src/transpiler/effect-images.js'

const IMG   = '<@@img src="b.png" alt="b">'
const EX    = '<@@img src="a.png">'
const L2028 = String.fromCharCode(0x2028)
const L2029 = String.fromCharCode(0x2029)
const BOM   = String.fromCharCode(0xfeff)

// [nom, texte, langue du projet]
const CAS: Array<[string, string, string?]> = [
  ['commentaire + script', `<!-- logique --><script>\n  fin = '</script >'\n  ex = '${EX}'\n</script>\n<p>ok</p>\n${IMG}\n`],
  ['deux commentaires + script lang="js"', `  <!-- a --> <!-- b --><script lang="js">\n  const fin = '</script >'\n  const ex = '${EX}'\n</script>\n${IMG}\n`],
  ['commentaire de plusieurs lignes + script', `<!--\n  logique\n--><script>\n  fin = '</script >'\n  ex = '${EX}'\n</script>\n${IMG}\n`],
  ['commentaire + script module', `<!-- m --><script module>\n  export fin := '</script >'\n  export ex := '${EX}'\n</script>\n${IMG}\n`],
  ['commentaire + style sass', `<!-- c --><style>\n  p::after\n    content: '</style >'\n  p::before\n    content: '${EX}'\n</style>\n${IMG}\n`],
  ['commentaire + vars', `<!-- c --><vars>\n  a: '</vars >'\n  b: '${EX}'\n</vars>\n${IMG}\n<script>\n  x = 1\n</script>\n`],
  ['U+2029 + script', `<p>a</p>${L2029}<script>\n  fin = '</script >'\n  ex = '${EX}'\n</script>\n${IMG}\n`],
  ['U+2028 + style sass', `<p>a</p>${L2028}<style>\n  p::after\n    content: '</style >'\n  p::before\n    content: '${EX}'\n</style>\n${IMG}\n`],
  ['textarea + script', `<textarea>\n<script>\n  fin = '</textarea>'\n  ex = '${EX}'\n</script>\n</textarea>\n${IMG}\n`],
  ['title + script', `<title>\n<script>\n  fin = '</title>'\n  ex = '${EX}'\n</script>\n</title>\n${IMG}\n`],
  ['textarea + commentaire + style', `<textarea>\n<!-- c --><style>\n  p::after\n    content: '</textarea>'\n  p::before\n    content: '${EX}'\n</style>\n</textarea>\n${IMG}\n`],
  ['CRLF, commentaire + script', `<!-- logique --><script>\r\n  fin = '</script >'\r\n  ex = '${EX}'\r\n</script>\r\n${IMG}\r\n`],
  ['BOM, commentaire + script', `${BOM}<!-- logique --><script>\n  fin = '</script >'\n  ex = '${EX}'\n</script>\n${IMG}\n`],
  ['projet coffee, commentaire + script', `<!-- c --><script>\nfin = '</script >'\nex = '${EX}'\n</script>\n${IMG}\n`, 'coffee'],
]

// les sections que le compilateur lit (hors des blocs <@head> / <@failed>, émis tels quels) et celles du lecteur, à toute profondeur
function sectionsDe(texte: string, langue: string): { compilateur: string[], lecteur: string[] } {
  const lu                = readFile(texte, { compiler: false, directives: false, lang: langue })
  const bornes            = sectionBounds(lu.source, langue)
  const lecteur: string[] = []
  traverse(lu, (n) => {
    if (n.kind === 'script' || n.kind === 'style' || n.kind === 'section') lecteur.push(`${n.start}-${n.body.start}-${n.body.end}-${n.end}`)
  })
  return { compilateur: bornes.sections.map(b => `${b.start}-${b.body.start}-${b.body.end}-${b.end}`), lecteur }
}

describe('lecteur du fichier : une section se lit partout où le compilateur en ouvre une', () => {
  for (const [nom, texte, langue] of CAS) {
    it(nom, () => {
      assert.doesNotThrow(() => extractSections(texte, { defaultScriptLang: (langue ?? 'civet') as 'civet' }), 'le compilateur accepte le composant')
      const { compilateur, lecteur } = sectionsDe(texte, langue ?? 'civet')
      assert.ok(compilateur.length > 0, 'le compilateur lit une section')
      assert.deepEqual(lecteur, compilateur)
      assert.deepEqual(scanImgTags(texte, langue).map(t => t.text), [IMG])
    })
  }

  it('images des effets d\'un projet CoffeeScript : un `#voir </script>` ne referme pas le script, l\'exemple qui suit n\'est pas lu', () => {
    const texte = `<script>\nx = 1 #voir </script>\ny = '<p *behind("absent.jpg")>t</p>'\n</script>\n<p *behind('b.png')>ok</p>\n`
    assert.deepEqual(scanEffectImages(texte, 'coffee').map(e => e.path), ['b.png'])
  })

  it('images des effets : un commentaire HTML avant le script sur sa ligne, l\'exemple cité dans le script n\'est pas lu', () => {
    const texte = `<!-- c --><script>\n  fin = '</script >'\n  y = '<p *behind("absent.jpg")>t</p>'\n</script>\n<p *behind('b.png')>ok</p>\n`
    assert.deepEqual(scanEffectImages(texte).map(e => e.path), ['b.png'])
  })
})
