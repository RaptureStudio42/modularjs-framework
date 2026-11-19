// `####…` (quatre dièses ou plus, en tête de ligne ou après du code) est un commentaire d'une ligne, en CoffeeScript comme en
// Civet : seul `###` suivi d'autre chose qu'un `#` ouvre un bloc, refermé au premier `###` — lu comme un bloc, `#### Section`
// emportait le code qui suit (rune `µ$x` d'un module CoffeeScript jamais réécrite : « µ$x is not defined » ; module Civet vide).
// Entre deux titres `####`, le code du milieu reste du code pour chaque lecture du compilateur : son masque commun, son lexeur,
// le retrait des commentaires d'un composant (le script y perdait son code) et la découpe des régions
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { maskNonCode } from '../src/mask.js'
import { scanInertAt } from '../src/lexer/index.js'
import { regionEnd } from '../src/reader/index.js'

// commentaire posé avant le code : ligne de titre, ligne de dièses, fin de ligne, six dièses, vrai bloc
const FORMES: Record<string, string> = {
  titre:    '#### Section\n',
  ligne:    '##########\n',
  finligne: 'x = 1 #### fin\n',
  six:      '######\n',
  bloc:     "###\n  L'etat du panier\n###\n"
}

// un module autonome construit seul : son code produit
async function moduleConstruit(nom: string, source: string): Promise<string> {
  const root   = mjsTmp('dieses-module')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const sortie = readdirSync(outDir).find((f) => f.startsWith(nom.split('.')[0] + '-') && f.endsWith('.js'))
  assert.ok(sortie, 'module construit')
  return readFileSync(join(outDir, sortie!), 'utf-8')
}

describe('commentaires de quatre dièses ou plus : une ligne, pas un bloc', function () {
  this.timeout(120_000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [forme, commentaire] of Object.entries(FORMES)) {
    it(`module CoffeeScript, ${forme} : la rune qui suit est réécrite`, async () => {
      const code = await moduleConstruit(`zq${forme}.coffee.mjs`, `${commentaire}µ$zq${forme} = { n: 2 }\nexport lire = -> µ$zq${forme}.n\n`)
      assert.ok(code.includes(`µ_state.zq${forme}.n`), code)
      assert.ok(!code.includes(`µ$zq${forme}`), code)
    })

    it(`module Civet, ${forme} : le code qui suit est construit`, async () => {
      const code = await moduleConstruit(`zv${forme}.civet.mjs`, `${commentaire}export lire = -> 'vu'\n`)
      assert.match(code, /lire = function\(\) \{\s*return 'vu'/, code)
    })
  }

  it('module CoffeeScript entre deux titres `####` : la rune du milieu est réécrite', async () => {
    const code = await moduleConstruit('zqentre.coffee.mjs', '#### État\nµ$zqentre = { n: 2 }\n#### Lecture\nexport lire = -> µ$zqentre.n\n')
    assert.ok(code.includes('µ_state.zqentre.n'), code)
    assert.ok(!code.includes('µ$zqentre'), code)
  })

  it('composant entre deux titres `####` : le code du script est construit, jamais retiré comme un commentaire', async () => {
    const code = await moduleConstruit('zcentre.mjs', '<script>\n#### État\n$zcentre = \'vu-entre\'\n#### Fin\n</script>\n<div>{$zcentre}</div>\n')
    assert.ok(code.includes('vu-entre'), code)
  })

  it('lectures du compilateur entre deux titres `####` : le masque commun, le lexeur et la découpe des régions gardent le code du milieu', () => {
    const src = '#### titre\nx = 1\n####\ny = 2\n'
    assert.equal(maskNonCode(src, 'civet'), '          \nx = 1\n    \ny = 2\n')
    assert.equal(maskNonCode(src, 'coffee'), '          \nx = 1\n    \ny = 2\n')
    assert.equal(scanInertAt(src, 0, true), src.indexOf('\n'))
    const region = '{ a #### note\n b }\n####\n}'
    assert.equal(regionEnd(region, 1, '}'), region.indexOf('}'))
  })
})
