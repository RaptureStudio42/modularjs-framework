// la table des lignes du gabarit versé : processIncludes dit, pour chaque ligne du HTML où les partiels sont recollés, le
// fichier et la ligne d'où elle vient. Une faute écrite dans le composant après un partiel de plusieurs lignes cite sa ligne
// du composant (le HTML recollé a les lignes du partiel en plus) ; une faute écrite dans un partiel cite sa ligne dans ce
// partiel, avec son fichier, le parseur compris

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { newIncludeAccumulator, processIncludes } from '../src/transpiler/macros.js'
import { mjsTmp } from './helpers/tmp.js'

const dir = mjsTmp('table-lignes')
writeFileSync(join(dir, '_trois.mjs'), '<p>1</p>\n<p>2</p>\n<p>3</p>\n')
writeFileSync(join(dir, '_relais.mjs'), '<p>r</p>\n<@include trois>\n<p>s</p>\n')
writeFileSync(join(dir, '_tete.mjs'), '<p>1</p>\n<@head>\n<meta name="a" content=a{$x}b>\n</@head>\n')
writeFileSync(join(dir, '_image.mjs'), '<p>1</p>\n\n<img src="a.png">\n')
writeFileSync(join(dir, '_ouvert.mjs'), '<p>1</p>\n<section>\n')

const compile = (src: string) => transpile(src, { moduleName: 'hote', baseDir: dir })
const SCRIPT  = '<script>\n$x = 1\n</script>\n'

// la faute levée par la compilation
async function faute(src: string): Promise<string> {
  try {
    await compile(src)
  }
  catch (e) {
    return (e as Error).message
  }
  return ''
}

// les messages imprimés pendant la compilation
async function imprimes(src: string): Promise<string[]> {
  const garde = { log: console.log, warn: console.warn, error: console.error }
  const vus: string[] = []
  console.log = console.warn = console.error = (...a: unknown[]) => { vus.push(a.map(String).join(' ')) }
  try {
    await compile(src)
  }
  finally {
    Object.assign(console, garde)
  }
  return vus
}

describe('processIncludes : la table des lignes du HTML versé', () => {
  it('chaque ligne garde son fichier (null : le composant), sa ligne dans ce fichier et la ligne du composant qui la verse', () => {
    const acc  = newIncludeAccumulator()
    const html = processIncludes('<div>\n<@include relais>\n</div>\n', dir, acc, undefined, { firstLine: 4 })
    const lignes = html.split('\n')
    const place  = (texte: string) => {
      const p = acc.places![lignes.indexOf(texte)]
      return `${p.file === null ? 'hote' : basename(p.file)}:${p.line}:${p.host}`
    }
    assert.equal(acc.places!.length, lignes.length)
    assert.equal(place('<div>'), 'hote:4:4')
    assert.equal(place('<p>r</p>'), '_relais.mjs:1:5')
    assert.equal(place('<p>1</p>'), '_trois.mjs:1:5')
    assert.equal(place('<p>3</p>'), '_trois.mjs:3:5')
    assert.equal(place('<p>s</p>'), '_relais.mjs:3:5')
    assert.equal(place('</div>'), 'hote:6:6')
  })

  it('sans partiel, la table suit les lignes du composant', () => {
    const acc = newIncludeAccumulator()
    processIncludes('<p>a</p>\n<p>b</p>', dir, acc, undefined, { firstLine: 2 })
    assert.deepEqual(acc.places, [{ file: null, line: 2, host: 2 }, { file: null, line: 3, host: 3 }])
  })
})

describe('une faute écrite après un partiel de plusieurs lignes', () => {
  it('<@head> : la première ligne de son contenu est celle du composant', async () => {
    const { data } = await compile(`${SCRIPT}<p>a</p>\n<@include trois>\n<@head>\n<meta name="a" content=a{$x}b>\n</@head>\n`)
    assert.equal(data.macroErrors.length, 1, JSON.stringify(data.macroErrors))
    assert.match(data.macroErrors[0], /<@head> ligne 7 :/)
  })

  it('<@failed> : de même', async () => {
    const { data } = await compile(`${SCRIPT}<p>a</p>\n<@include trois>\n<@failed>\n<meta name="a" content=a{$x}b>\n</@failed>\n`)
    assert.equal(data.macroErrors.length, 1, JSON.stringify(data.macroErrors))
    assert.match(data.macroErrors[0], /<@failed> ligne 7 :/)
  })

  it('le parseur cite la ligne du composant', async () => {
    const message = await faute(`${SCRIPT}<p>a</p>\n<@include trois>\n<section>\n`)
    assert.match(message, /<section>/)
    assert.match(message, /ligne 6\b/)
  })

  it('le contrôle d\'accessibilité cite la ligne du composant', async () => {
    const vus = (await imprimes(`${SCRIPT}<@include trois>\n<img src="a.png">\n`)).filter(m => m.includes('<img> sans attribut alt'))
    assert.equal(vus.length, 1, vus.join(' | '))
    assert.match(vus[0], /\(ligne 5\)/)
  })

  it('un gestionnaire introuvable cite la ligne du composant', async () => {
    const message = await faute(`${SCRIPT}<@include trois>\n<button @click=inconnu>x</button>\n`)
    assert.match(message, /inconnu/)
    assert.match(message, /ligne 5\b/)
  })
})

describe('une faute écrite dans un partiel', () => {
  it('<@head> : sa ligne dans le partiel, avec le fichier', async () => {
    const { data } = await compile(`${SCRIPT}<p>a</p>\n<@include tete>\n`)
    assert.equal(data.macroErrors.length, 1, JSON.stringify(data.macroErrors))
    assert.match(data.macroErrors[0], /<@head> ligne 3 de _tete\.mjs :/)
  })

  it('le contrôle d\'accessibilité : sa ligne dans le partiel, avec le fichier', async () => {
    const vus = (await imprimes(`${SCRIPT}<p>a</p>\n<@include image>\n`)).filter(m => m.includes('<img> sans attribut alt'))
    assert.equal(vus.length, 1, vus.join(' | '))
    assert.match(vus[0], /\(ligne 3 de _image\.mjs\)/)
  })

  it('le parseur cite la ligne du partiel qui écrit la balise, avec son fichier, jamais une ligne du HTML recollé', async () => {
    const message = await faute(`${SCRIPT}<p>a</p>\n\n<@include ouvert>\n`)
    assert.match(message, /<section>/)
    assert.match(message, /ligne 2 de _ouvert\.mjs\b/)
  })
})
