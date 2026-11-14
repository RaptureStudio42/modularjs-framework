// un partiel écrit avec des fins de ligne `\r\n` (Windows) se lit comme le composant, ses fins de ligne ramenées à `\n` : une
// faute de son script est citée à sa ligne et sa colonne (`_pr.mjs:3:5`), marque d'ordre en tête comprise, et le code produit
// est celui du même partiel écrit avec des `\n`

import { strict as assert } from 'node:assert'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpileFromMsg } from '../src/bundler/transpile-msg.js'
import { mjsTmp } from './helpers/tmp.js'

const LF   = (...l: string[]): string => l.join('\n') + '\n'
const CRLF = (...l: string[]): string => l.join('\r\n') + '\r\n'
const MAIN = LF('<script>', '$n = 1', '</script>', '<p>{$n}</p>', '<@include pr>')

async function construire(prefixe: string, partiel: string): Promise<{ sortie?: string, erreur?: string }> {
  const dir = mjsTmp(prefixe)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'main.mjs'), MAIN)
  writeFileSync(join(dir, '_pr.mjs'), partiel)
  const garde = { log: console.log, warn: console.warn, error: console.error }
  console.log = console.warn = console.error = () => {}
  try {
    const r: any = await transpileFromMsg({ type: 'transpile', id: 1, content: MAIN, moduleName: 'main', baseDir: dir, sourceDir: dir, preResolvedAssets: {} } as any)
    return { sortie: String(r.output ?? '') }
  }
  catch (e: any) {
    return { erreur: String(e?.message ?? e).replace(/\x1b\[[0-9;]*m/g, '') }
  }
  finally {
    Object.assign(console, garde)
  }
}

describe('partiel écrit en \\r\\n : lu comme le composant', function () {
  this.timeout(60000)

  it('une faute de son script est citée à sa ligne et sa colonne, avec ou sans marque d\'ordre', async () => {
    for (const [nom, partiel] of [['crlf', CRLF('<script>', 'a = 1', 'b = )', '</script>', '<p>p</p>')], ['bom-crlf', '\uFEFF' + CRLF('<script>', 'a = 1', 'b = )', '</script>', '<p>p</p>')]]) {
      const r = await construire(`partiel-crlf-${nom}`, partiel)
      assert.ok(r.erreur?.includes('_pr.mjs:3:5 '), `${nom} : ${r.erreur ?? 'construit sans faute'}`)
    }
  })

  it('le code produit est celui du même partiel écrit avec des \\n', async () => {
    const parties = ['<script>', 'a = 1', '</script>', '<p>p</p>', '<p>', '  q', '</p>']
    const lf   = await construire('partiel-lf-sortie', LF(...parties))
    const crlf = await construire('partiel-crlf-sortie', CRLF(...parties))
    assert.equal(lf.erreur, undefined)
    assert.equal(crlf.erreur, undefined)
    assert.ok(lf.sortie!.length > 0, 'code produit')
    assert.ok(crlf.sortie === lf.sortie, 'même code produit')
  })
})
