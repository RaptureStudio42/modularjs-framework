// un guillemet ouvert dans la valeur d'un attribut et jamais refermé jusqu'à la fin du gabarit : la construction s'arrête,
// le message nomme le guillemet, l'attribut, la balise et la place du guillemet ouvrant (`main.mjs:2:9`, partiel compris).
// Le navigateur lirait tout le reste du fichier comme la valeur de cet attribut : aucune valeur n'est devinée. Jamais un
// faux refus : un guillemet dans la valeur entre l'autre guillemet, dans une expression, un gestionnaire, un texte, un
// commentaire HTML, un <pre>, un <textarea>, un <script>, un <style>, un partiel, une valeur refermée qui contient `>`, ou une
// balise écrite dans le contenu d'un élément à texte brut (<xmp>, <iframe>, <noembed>, <noframes>), où le navigateur n'en lit aucune

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../src/parser/index.js'
import { transpileFromMsg } from '../src/bundler/transpile-msg.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

const J      = (...l: string[]) => l.join('\n') + '\n'
const JR     = (...l: string[]) => l.join('\r\n') + '\r\n'
const SCRIPT = J('<script>', '$s = "a>"', "$t = 'b'", '</script>')

// la lecture d'un gabarit seul : son refus, ou rien
function refusDe(html: string): string | null {
  const garde = { warn: console.warn, error: console.error, log: console.log }
  console.warn = console.error = console.log = () => {}
  try {
    parse(html)
    return null
  }
  catch (e) {
    return (e as Error).message
  }
  finally {
    Object.assign(console, garde)
  }
}

// la construction d'un composant (le chemin du bundler) : son refus, ou rien
async function refusALaConstruction(id: string, fichiers: Record<string, string>): Promise<string | null> {
  const dir = mjsTmp(`guillemet-${id}`)
  mkdirSync(dir, { recursive: true })
  for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(dir, nom), texte)
  const garde = { warn: console.warn, error: console.error, log: console.log }
  console.warn = console.error = console.log = () => {}
  try {
    await transpileFromMsg({ type: 'transpile', id: 1, content: fichiers['main.mjs'], moduleName: 'main', baseDir: dir, sourceDir: dir, preResolvedAssets: {} } as any)
    return null
  }
  catch (e) {
    return String((e as Error)?.message ?? e).replace(/\x1b\[[0-9;]*m/g, '')
  }
  finally {
    Object.assign(console, garde)
  }
}

describe('un guillemet jamais refermé dans un attribut : la lecture du gabarit s\'arrête', () => {
  // gabarit, guillemet, attribut, balise, ligne, colonne du guillemet ouvrant
  const refuses: Array<[string, string, string, string, number, number]> = [
    ['<a href="/contact>Nous écrire</a>\n<p>x</p>\n', '"', 'href', 'a', 1, 9],
    ['<p class="a>b</p>\n<p>c</p>\n', '"', 'class', 'p', 1, 10],
    ["<p title='x>b</p>\n<p>c</p>\n", "'", 'title', 'p', 1, 10],
    ['<input value="{$v}>\n<p>b</p>\n', '"', 'value', 'input', 1, 14],
    ['<a title="Nous écrire>x</a>\n', '"', 'title', 'a', 1, 10],
    ["<b title='y>", "'", 'title', 'b', 1, 10],
    ['<div>\r\n  <p>a</p>\r\n  <a href="/x>lien</a>\r\n</div>\r\n', '"', 'href', 'a', 3, 11],
    ['<ul>\n  <li class="a" title="l\'été">x</li>\n  <li class="b>y</li>\n</ul>\n', '"', 'class', 'li', 3, 13],
    // un navigateur sans JavaScript lit des balises dans un <noscript> ; dans un dessin, un <style> n'est pas à texte brut
    ['<noscript><a href="x></noscript>\n', '"', 'href', 'a', 1, 19],
    ['<svg><style><a href="x></style></svg>\n', '"', 'href', 'a', 1, 21],
    ['<xmp>a</xmp>\n<a href="x>b</a>\n', '"', 'href', 'a', 2, 9],
  ]
  for (const [html, guillemet, attribut, balise, ligne, colonne] of refuses) {
    it(`refusé : ${JSON.stringify(html)}`, () => {
      const m = refusDe(html)
      assert.ok(m !== null, 'accepté')
      assert.ok(m.includes('[GUILLEMET JAMAIS REFERMÉ]'), m)
      assert.ok(m.includes(`ligne ${ligne}, colonne ${colonne}`), m)
      assert.ok(m.includes(`le guillemet ${guillemet} qui ouvre la valeur de \`${attribut}\` sur <${balise}>`), m)
      assert.ok(m.includes('Refermez le guillemet'), m)
    })
  }

  it('le message en anglais', () => {
    setMessagesLang('en')
    try {
      const m = refusDe('<a href="/contact>Nous écrire</a>\n') ?? ''
      assert.ok(m.includes('[UNCLOSED QUOTE] line 1, column 9: the quote " that opens the value of `href` on <a> is never closed'), m)
      assert.ok(m.includes('Close the quote'), m)
    }
    finally {
      setMessagesLang('fr')
    }
  })

  const acceptes: string[] = [
    '<p title="l\'été">x</p>\n',
    '<p title=\'il dit "oui"\'>x</p>\n',
    '<p title={"a" + $b}>x</p>\n',
    '<button @click={f("a>")}>x</button>\n',
    '<a href="/x" title=\'a > b\'>l</a>\n',
    '<p>l\'été "x</p>\n<p>y</p>\n',
    '<!-- <a href="/x> -->\n<p>a</p>\n',
    '<pre>"a> l\'été</pre>\n',
    '<textarea>"a></textarea>\n',
    '<p title="a\r\nb">x</p>\r\n<p class=\'c\'>d</p>\r\n',
    '<xmp><a href="x></xmp>\n<p>a</p>\n',
    '<iframe><a href="x></iframe>\n<p>a</p>\n',
    '<noembed><b title=\'x>y</b></noembed>\n',
    '<noframes><a href="x></noframes>\n',
    '<div><script type="text/template"><a href="x></script></div>\n',
  ]
  for (const html of acceptes) {
    it(`accepté : ${JSON.stringify(html)}`, () => {
      const m = refusDe(html)
      assert.ok(m === null, m ?? '')
    })
  }
})

describe('un guillemet jamais refermé dans un attribut : la construction s\'arrête à sa place dans le fichier', function () {
  this.timeout(120000)

  const refuses: Array<[string, Record<string, string>, string]> = [
    ['milieu', { 'main.mjs': J('<p>a</p>', '<a href="/contact>Nous écrire</a>', '<p>b</p>') }, 'main.mjs:2:9 :'],
    ['apres-script', { 'main.mjs': SCRIPT + J('<p>{$s}</p>', '  <p class="a>b</p>') }, 'main.mjs:6:12 :'],
    ['crlf', { 'main.mjs': JR('<p>a</p>', '<p title=\'x>b</p>', '<p>c</p>') }, 'main.mjs:2:10 :'],
    ['partiel', { 'main.mjs': J('<p>0</p>', '<@include bas>', '<p>1</p>'), '_bas.mjs': J('<p>a</p>', '<a href="/x>lien</a>') }, '_bas.mjs:2:9 :'],
  ]
  for (const [id, fichiers, position] of refuses) {
    it(`refusé, ${position} (${id})`, async () => {
      const m = await refusALaConstruction(id, fichiers)
      assert.ok(m !== null, 'construit')
      assert.ok(m.includes(`[GUILLEMET JAMAIS REFERMÉ] ${position}`), m)
    })
  }

  const acceptes: Array<[string, Record<string, string>]> = [
    ['script-style', { 'main.mjs': SCRIPT + J('<p title="l\'été">{$s}</p>', '<style>', 'p::before', '  content: "x>"', '</style>') }],
    ['partiel', { 'main.mjs': J('<p>0</p>', '<@include q>'), '_q.mjs': J('<p title="l\'été">a</p>', '<p>"b</p>') }],
    ['crlf', { 'main.mjs': JR('<p title="a">b</p>', '<p class=\'c\'>d</p>') }],
    ['xmp', { 'main.mjs': SCRIPT + J('<p>{$s}</p>', '<xmp><a href="/x>lien</xmp>', '<iframe><b title=\'y>z</b></iframe>') }],
  ]
  for (const [id, fichiers] of acceptes) {
    it(`construit (${id})`, async () => {
      const m = await refusALaConstruction(`ok-${id}`, fichiers)
      assert.ok(m === null, m ?? '')
    })
  }
})
