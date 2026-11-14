// une fermante dont le nom ne commence pas par une lettre (`</3>`, `</-a>`), écrite au milieu d'un texte, est du texte pour le
// compilateur : il la lit dans la suite de caractères du texte et l'emporte telle quelle (le navigateur n'y voit aucune balise, il
// en fait un commentaire). En tête d'un nœud (au début d'un contenu, après une balise, une accolade, un commentaire, une section
// <![CDATA[), elle reste une fermante, refusée quand elle ne ferme rien. Les textes lus sont ceux que le compilateur a toujours
// lus, nœud pour nœud

import { strict as assert } from 'node:assert'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, type Node } from '../src/parser/index.js'
import { lireFichier } from '../src/reader/index.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// les textes de l'arbre lu, dans l'ordre du gabarit
function textes(html: string): string[] {
  const vus: string[] = []
  const visiter = (n: Node): void => {
    if (n.type === 'text') vus.push(n.content!)
    for (const c of n.children) visiter(c)
    for (const b of n.branches) for (const c of b.children) visiter(c)
  }
  visiter(parse(html))
  return vus
}

// le refus d'un gabarit, ses avertissements de console retenus
function refus(html: string): string {
  const garde = { log: console.log, warn: console.warn, error: console.error }
  console.log = console.warn = console.error = () => {}
  try {
    parse(html)
  }
  catch (e) {
    return (e as Error).message
  }
  finally {
    Object.assign(console, garde)
  }
  return 'aucun refus'
}

// [gabarit, ses textes]
const DANS_UN_TEXTE: Array<[string, string[]]> = [
  ['<p>a </3> b</p>', ['a </3> b']],
  ['<p>a</-a>b</p>', ['a</-a>b']],
  ['<div>\n  </3>\n  <img src="a.png" alt="a">\n</div>', ['\n  </3>\n  ', '\n']],
  ['<div> </3><img src="a.png" alt="a"><img src="a.png" alt="a"></div>', [' </3>']],
  ['a </3>', ['a </3>']],
  ['<p>a </3></4> b</p>', ['a </3></4> b']],
  ['<p>a </3x> b</p>', ['a </3x> b']],
  ['<p>a </3 > b</p>', ['a </3 > b']],
  ['<p>a </-> b</p>', ['a </-> b']],
  ['<div>{if $x}a </3>{else}b{end}</div>', ['a </3>', 'b']],
  ['<ul>{for i in $l}<li>{i} </3></li>{end}</ul>', [' </3>']],
  ['<p>{$m} </3></p>', [' </3>']],
  ['<textarea>a </3> b</textarea>', ['a </3> b']],
  ['<title>a </-a> b</title>', ['a </-a> b']],
  ['<svg><text>a </3> b</text></svg>', ['a </3> b']],
  ['<svg><text><![CDATA[x]]> </3></text></svg>', ['<![CDATA[x]]>', ' </3>']],
  ['<div><@carte>a </3> b</@carte></div>', ['a </3> b']],
  ['<div><@carte>a </3> b</div>', ['a </3> b']],
  ['<div><@carte>a </3></div>', ['a </3>']],
  ['<p>a<!-- c --> </3></p>', ['a', ' </3>']]
]

// [gabarit, la fermante refusée]
const EN_TETE: Array<[string, string]> = [
  ['<div><b>x</b></3></div>', '</3>'],
  ['<p>a </3><b>x</b></-1> c</p>', '</-1>'],
  ['<p>{$m}</3></p>', '</3>'],
  ['<p>a<!-- c --></3></p>', '</3>'],
  ['<textarea></3></textarea>', '</3>'],
  ['<textarea>a<b></3></textarea>', '</3>'],
  ['<svg><text><![CDATA[x]]></3></text></svg>', '</3>'],
  ['<p>a </@x> b</p>', '</@x>'],
  ['<p>a </a-b> b</p>', '</a-b>']
]

describe('gabarit — une fermante dont le nom ne commence pas par une lettre, au milieu d\'un texte, est du texte', () => {
  for (const [html, attendus] of DANS_UN_TEXTE) {
    it(`${JSON.stringify(html)} : lue dans le texte qui la précède`, () => {
      assert.deepEqual(textes(html), attendus)
    })
  }

  it('le lecteur ne relève aucune faute, dans le gabarit seul comme dans le fichier entier', () => {
    assert.deepEqual(lireFichier('<p>a </3> b</p>', { gabarit: true }).diagnostics, [])
    assert.deepEqual(lireFichier('<p>a</-a>b</p>', { gabarit: true }).diagnostics, [])
    assert.deepEqual(lireFichier('<script>\n$x = 1\n</script>\n<p>a </3> b</p>\n<div> </-a><img src="a.png" alt="a"></div>\n').diagnostics, [])
  })

  it('l\'arbre est celui du même texte écrit sans `<` : seul le caractère change', () => {
    for (const [html] of DANS_UN_TEXTE) {
      const lu     = JSON.stringify(parse(html))
      const neutre = JSON.stringify(parse(html.replace(/<\/([0-9-][^<>]*>)/g, 'x/$1')))
      assert.equal(lu.replace(/<\/([0-9-][^<>]*>)/g, 'x/$1'), neutre, html)
    }
  })

  it('compilée : la sortie porte le texte tel qu\'écrit, dans le gabarit comme dans un partiel', async () => {
    const dir = mjsTmp('fermante-nom-invalide')
    writeFileSync(join(dir, '_texte.mjs'), '<p>a </3> b</p>\n<p>c</-a>d</p>\n')
    const { output } = await transpile('<script>\n$x = true\n</script>\n<div>{if $x}si </3>{end}<@include texte></div>\n', { moduleName: 'essai-fermante', baseDir: dir })
    assert.match(output, /si <\/3>/)
    assert.match(output, /<p>a <\/3> b<\/p>/)
    assert.match(output, /<p>c<\/-a>d<\/p>/)
  })
})

describe('gabarit — en tête d\'un nœud, la même fermante reste une fermante', () => {
  for (const [html, fermante] of EN_TETE) {
    it(`${JSON.stringify(html)} : ${fermante} ne ferme aucune balise, refusée`, () => {
      const message = refus(html)
      assert.match(message, /BALISE FERMANTE ORPHELINE/)
      assert.ok(message.includes('`' + fermante + '`'), message)
    })
  }
})
