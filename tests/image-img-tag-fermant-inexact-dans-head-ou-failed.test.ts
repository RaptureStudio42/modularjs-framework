// un <script> ou un <style> écrit dans un bloc <@head> ou <@failed> (émis tel quel par le compilateur, jamais lu comme une section du
// composant) dont une chaîne ou un commentaire cite une fermante inexacte (`</script >`, `</scripts>`, `</style >`) se lit jusqu'à sa
// fermante exacte : son exemple `<@@img>` n'est pas une image, la construction reste verte et la vraie balise du gabarit se prépare,
// en développement et en production, dans un composant et dans un partiel `<@include>`

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const IMG = '<@@img src="b.png" alt="b">'
const SCR = '<script>\n  x = 1\n</script>\n'
const CAS: Array<[string, string]> = [
  ['<@head>, script : chaîne </script > puis exemple', `${SCR}<@head>\n  <script>\n  const fin = '</script >'\n  const ex = '<@@img src="a.png">'\n  </script>\n</@head>\n<p>a</p>\n${IMG}\n`],
  ['<@head>, script : commentaire // </scripts> puis exemple', `${SCR}<@head>\n  <script>\n  // voir </scripts>\n  const ex = '<@@img src="a.png">'\n  </script>\n</@head>\n<p>a</p>\n${IMG}\n`],
  ['<@head>, style : commentaire </style > puis exemple', `${SCR}<@head>\n  <style>\n  /* fin </style > */\n  /* <@@img src="a.png"> */\n  </style>\n</@head>\n<p>a</p>\n${IMG}\n`],
  ['<@failed>, script : chaîne </script > puis exemple', `${SCR}<@failed err reset>\n  <script>\n  const fin = '</script >'\n  const ex = '<@@img src="a.png">'\n  </script>\n  <p>oups</p>\n</@failed>\n<p>a</p>\n${IMG}\n`],
]

async function construire(gabarit: string, prod: boolean, partiel: boolean): Promise<{ erreurs: string[]; balises: string[]; copies: string[] }> {
  const root = mjsTmp('img-head-fermant-inexact')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  mkdirSync(out)
  writeFileSync(join(src, 'b.png'), validPng(40, 30))
  if (partiel) writeFileSync(join(src, '_cas.mjs'), gabarit)
  writeFileSync(join(src, 'page.mjs'), partiel ? '<div><@include cas></div>\n' : gabarit)
  const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(root, 'bundle.js'), env: prod ? 'prod' : 'dev' })
  const stats = await b.compile()
  await b.close()
  const sortie = readdirSync(out)
  const js     = sortie.filter(f => /^page-.*\.js$/.test(f)).map(f => readFileSync(join(out, f), 'utf-8')).join('\n')
  return { erreurs: stats.errors.map(e => e.message.split('\n')[0]), balises: js.match(/<mjs-core-img\b[^>]*>/g) ?? [], copies: sortie.filter(f => /\.png$/.test(f)) }
}

describe('<@@img> après un <script> ou un <style> d\'un bloc <@head> ou <@failed> qui cite une fermante inexacte', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const prod of [false, true]) for (const partiel of [false, true]) for (const [nom, gabarit] of CAS) {
    it(`${prod ? 'production' : 'développement'}, ${partiel ? 'partiel' : 'composant'} : ${nom}`, async () => {
      const vu = await construire(gabarit, prod, partiel)
      assert.deepEqual(vu.erreurs, [], 'la construction reste verte')
      assert.equal(vu.copies.length, 1, JSON.stringify(vu.copies))
      assert.ok(vu.balises.some(t => /src=.\/out\/b-[a-f0-9]{8}\.png/.test(t)), vu.balises.join('\n'))
    })
  }
})
