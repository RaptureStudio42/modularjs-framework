// Une balise `<@@img>` écrite sur plusieurs lignes garde son nombre de lignes une fois réécrite : les avertissements et les refus
// qui la suivent citent la ligne du fichier (ils citaient une ligne trop haute, d'autant de lignes que la balise en prenait)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

async function construire(nom: string, source: string): Promise<{ erreurs: string[], dits: string[] }> {
  const root   = mjsTmp('img-lignes-' + nom)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'a.png'), PNG)
  writeFileSync(join(srcDir, nom + '.mjs'), source)
  const dits: string[] = []
  const w = console.warn, e = console.error, l = console.log
  console.warn = console.error = console.log = (...a: any[]) => { dits.push(a.join(' ')) }
  try {
    const stats = await new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') }).compile()
    return { erreurs: stats.errors.map((x: any) => x.message), dits }
  }
  finally {
    console.warn = w
    console.error = e
    console.log = l
  }
}

describe('<@@img> sur plusieurs lignes : lignes citées après elle justes', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('avertissements : <img> sans alt ligne 10, <div @click> ligne 11, <form> ligne 12', async () => {
    const r = await construire('img', ['<script>', '  $n = 0', '</script>', '', '<@@img', '  src="a.png"', '  alt="x"', '  class="k">', '<p>{$n}</p>', '<img src="/b.png">', '<div @click={$n++}>x</div>', '<form></form>'].join('\n'))
    assert.deepEqual(r.erreurs, [])
    const lignes = r.dits.filter((d) => /lint\./.test(d)).map((d) => (/\[lint\.(\w+)\]/.exec(d)![1]) + ':' + (/ligne (\d+)|img:(\d+)/.exec(d) ?? []).slice(1).find(Boolean)).sort()
    assert.deepEqual(lignes, ['a11y:10', 'a11y:11', 'ujsForm:12'], r.dits.join('\n'))
  })

  it('refus : le gestionnaire introuvable est cité à sa ligne (9)', async () => {
    const r = await construire('ref', ['<script>', '  $n = 0', '</script>', '<@@img', '  src="a.png"', '  alt="x"', '', '  class="k" />', '<button @click=absent>y</button>'].join('\n'))
    assert.equal(r.erreurs.length, 1, r.erreurs.join('\n'))
    assert.match(r.erreurs[0], /\(ligne 9\)/, r.erreurs[0])
  })
})
