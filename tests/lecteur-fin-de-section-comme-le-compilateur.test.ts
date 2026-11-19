// le lecteur du fichier (src/reader) referme une section <script> ou <style> là où le compilateur la referme (extractSections) : à sa
// fermante exacte hors de ses chaînes et de ses commentaires, lus dans la langue du script (celle du `lang`, sinon celle du projet).
// Un `</script >`, `</scripts>`, `</script-x>`, `</style >`, ou un `</script>` exact écrit dans une chaîne ou un commentaire ne la
// ferme pas : la suite n'est pas lue comme du gabarit, un exemple `<@@img>` cité plus bas n'est pas une balise. Dans un bloc <@head>
// ou <@failed> (émis tel quel), un <script> ou un <style> se lit jusqu'à sa première fermante exacte, et un `<script src="…" />`
// auto-fermé n'est qu'une balise ; un <script> écrit dans un commentaire HTML ou en milieu de ligne n'est pas une section

import assert from 'node:assert/strict'
import { readFile, traverse, type Node } from '../src/reader/index.js'
import { extractSections } from '../src/transpiler/sections.js'
import { scanImgTags } from '../src/transpiler/img-tag.js'

const EX  = '<@@img src="a.png">'
const IMG = '<@@img src="b.png" alt="b">'

// [nom, texte, langue du projet] : la section se referme sur la dernière fermante du texte, le compilateur lit l'exemple dans son corps
const SECTIONS: Array<[string, string, string?]> = [
  ['js, chaîne </script >', `<script lang="js">\nconst fin = '</script >'\nconst ex = '${EX}'\n</script>\n${IMG}\n`],
  ['js, chaîne </scripts>', `<script lang="js">\nconst fin = '</scripts>'\nconst ex = '${EX}'\n</script>\n${IMG}\n`],
  ['js, chaîne </script-x>', `<script lang="js">\nconst fin = '</script-x>'\nconst ex = '${EX}'\n</script>\n${IMG}\n`],
  ['js, chaîne </script> exacte', `<script lang="js">\nconst fin = '</script>'\nconst ex = '${EX}'\n</script>\n${IMG}\n`],
  ['ts, commentaire // </scripts>', `<script lang="ts">\n// voir </scripts>\nconst ex: string = '${EX}'\n</script>\n${IMG}\n`],
  ['civet, commentaire # </script >', `<script>\n# fin </script > ici\nex := '${EX}'\n</script>\n${IMG}\n`],
  ['civet, commentaire ### </scripts> ###', `<script lang="civet">\n### </scripts> ###\nex := '${EX}'\n</script>\n${IMG}\n`],
  ['coffee, bloc ### </script > ###', `<script lang="coffee">\n###\n</script >\n###\nex = '${EX}'\n</script>\n${IMG}\n`],
  ['coffee, commentaire collé #voir </script>', `<script lang="coffee">\nx = 1 #voir </script>\nex = '${EX}'\n</script>\n${IMG}\n`],
  ['projet coffee, commentaire collé #voir </script>', `<script>\nx = 1 #voir </script>\nex = '${EX}'\n</script>\n${IMG}\n`, 'coffee'],
  ['<script module>, chaîne </script >', `<script module>\nexport const fin = '</script >'\nexport const ex = '${EX}'\n</script>\n${IMG}\n`],
  ['style css, commentaire </style >', `<style lang="css">\n/* fin </style > */\n.a { content: '${EX}' }\n</style>\n${IMG}\n`],
  ['style sass, commentaire // </styles>', `<style>\n// fin </styles>\n.a\n  content: '${EX}'\n</style>\n${IMG}\n`],
  ['style scss, commentaire // </style >', `<style lang="scss">\n// fin </style >\n.a { content: '${EX}'; }\n</style>\n${IMG}\n`],
]

// [nom, texte] : un <script> ou un <style> que le compilateur ne lit pas comme une section du composant
const HORS_SECTION: Array<[string, string]> = [
  ['<@head>, script : chaîne </script > puis exemple', `<script>\n  x = 1\n</script>\n<@head>\n  <script>\n  const fin = '</script >'\n  const ex = '${EX}'\n  </script>\n</@head>\n<p>a</p>\n${IMG}\n`],
  ['<@failed>, style : commentaire </style > puis exemple', `<@failed err reset>\n  <style>\n  /* fin </style > */\n  /* ${EX} */\n  </style>\n  <p>oups</p>\n</@failed>\n<p>a</p>\n${IMG}\n`],
  ['<@head>, style d\'une ligne avec //', `<script>\n  x = 1\n</script>\n<@head>\n  <style>body { margin: 0 } // remise à zéro</style>\n</@head>\n${IMG}\n<style>\n  p\n    color: blue\n</style>\n`],
  ['<@failed>, script auto-fermé', `<@failed err reset>\n  <script src="/x.js" />\n  ${IMG}\n</@failed>\n<p>ok</p>\n<script>\n  x = 1\n</script>\n`],
  ['<@head>, script auto-fermé, script en bas', `<@head>\n  <script src="/x.js" />\n</@head>\n<p>a</p>\n${IMG}\n<script>\n  x = 1\n</script>\n`],
  ['commentaire HTML', `<!--\n<script>\nconst ex = '${EX}'\n</script>\n-->\n${IMG}\n`],
  ['milieu de ligne', `<p>a</p><script>const ex = '${EX}'</script>\n${IMG}\n`],
]

const sectionsDe = (noeuds: Node[]): Node[] => noeuds.filter(n => n.kind === 'script' || n.kind === 'style')

describe('lecteur du fichier : une section se referme où le compilateur la referme', () => {
  for (const [nom, texte, langue] of SECTIONS) {
    it(nom, () => {
      const fermante = texte.includes('<style') ? '</style>' : '</script>'
      const lu       = sectionsDe(readFile(texte, { compiler: false, directives: false, lang: langue ?? 'civet' }).children)
      assert.equal(lu.length, 1, nom)
      assert.equal(lu[0].end, texte.lastIndexOf(fermante) + fermante.length, 'la section se referme sur sa vraie fermante')
      const s = extractSections(texte, { defaultScriptLang: (langue ?? 'civet') as 'civet' })
      assert.ok([s.script.raw, s.module.raw, s.style.raw].some(r => r.includes('a.png')), 'le compilateur lit la section entière')
      assert.deepEqual(scanImgTags(texte, langue).map(t => t.text), [IMG])
    })
  }

  for (const [nom, texte] of HORS_SECTION) {
    it(nom, () => {
      assert.deepEqual(scanImgTags(texte).map(t => t.text), [IMG])
      const vraie            = texte.indexOf(IMG)
      const sections: Node[] = []
      traverse(readFile(texte, { compiler: false, directives: false }), (n) => {
        if (n.kind === 'script' || n.kind === 'style') sections.push(n)
      })
      assert.ok(!sections.some(n => n.start < vraie && vraie < n.end), 'aucune section n\'avale la vraie balise')
    })
  }

  it('<@head> : le <script> du bloc se referme à sa première fermante exacte, le <script src /> auto-fermé n\'est qu\'une balise', () => {
    const texte = `<@head>\n  <script src="/x.js" />\n  <script>\n  const fin = '</script >'\n  </script>\n</@head>\n${IMG}\n<script>\n  x = 1\n</script>\n`
    const lu    = readFile(texte, { compiler: false, directives: false })
    const tete  = lu.children.find(n => n.kind === 'tag' && n.name === '@head')
    assert.ok(tete !== undefined && tete.kind === 'tag', 'le bloc <@head> est lu')
    const dedans = tete.children.filter(n => n.kind !== 'text')
    assert.deepEqual(dedans.map(n => n.kind === 'tag' ? `balise ${n.name}${n.selfClosing ? ' /' : ''}` : n.kind), ['balise script /', 'script'])
    assert.equal(dedans[1].end, texte.indexOf('</script>') + '</script>'.length)
  })
})
