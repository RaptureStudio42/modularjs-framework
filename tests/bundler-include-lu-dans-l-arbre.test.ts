// le bundler cherche les partiels d'un composant dans l'arbre de son gabarit, comme le transpileur qui les verse : un
// `<@include x>` écrit dans une valeur d'attribut ou dans une chaîne d'expression reste du texte, le bundler ne lit pas
// les adresses de ce partiel ; une vraie balise, dans le composant ou dans un partiel, les lit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const dir = mjsTmp('bundler-include-arbre')
mkdirSync(join(dir, 'sortie'))
writeFileSync(join(dir, 'logo.png'), 'png')
writeFileSync(join(dir, '_logo.mjs'), '<img src={µasset(\'logo.png\')} alt="logo">\n')
writeFileSync(join(dir, '_relais.mjs'), '<div>\n<@include logo>\n</div>\n')

// les adresses que le bundler résout d'avance pour ce composant
async function adresses(src: string): Promise<string[]> {
  const bundler = new Bundler({ sourceDir: dir, outputDir: join(dir, 'sortie'), manifestPath: join(dir, 'bundle.js') }) as unknown as { preResolveAssets: (content: string, baseDir?: string) => Promise<{ dict: Record<string, string> }> }
  return Object.keys((await bundler.preResolveAssets(src, dir)).dict)
}

describe('bundler : les <@include> lus dans l\'arbre du gabarit', () => {
  it('une vraie balise, dans le composant ou dans un partiel : les adresses du partiel sont résolues', async () => {
    assert.ok((await adresses('<p>a</p>\n<@include logo>\n')).includes('logo.png'))
    assert.ok((await adresses('<p>a</p>\n<@include relais>\n')).includes('logo.png'))
  })

  it('écrit dans une valeur d\'attribut : du texte, le partiel n\'est pas lu', async () => {
    assert.deepEqual(await adresses('<p title="<@include logo>">a</p>\n'), [])
  })

  it('écrit dans une chaîne d\'expression : du texte, le partiel n\'est pas lu', async () => {
    assert.deepEqual(await adresses('<p>{\'<@include logo>\'}</p>\n'), [])
  })
})
