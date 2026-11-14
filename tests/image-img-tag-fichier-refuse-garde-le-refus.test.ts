// un composant ou un partiel que le compilateur refuse parce que ses sections ne se lisent pas (`</script>` orphelin) n'a aucune
// `<@@img>` à préparer : la construction échoue sur le refus du compilateur, jamais sur l'image introuvable d'un exemple `<@@img>`
// cité dans un script, en développement et en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const EX  = '<@@img src="a.png">'
const IMG = '<@@img src="b.png" alt="b">'

// [nom, gabarit, écrit dans un partiel] : l'exemple `a.png`, absent du disque, cité dans un script que le compilateur refuse
const CAS: Array<[string, string, boolean]> = [
  ['script en milieu de ligne qui cite </script > puis un exemple', `<p>a</p><script>const fin = '</script >'; const ex = '${EX}'</script>\n${IMG}\n`, false],
  ['le même dans un partiel', `<p>a</p><script>const fin = '</script >'; const ex = '${EX}'</script>\n${IMG}\n`, true],
  ['chaîne jamais refermée qui cite </script> puis un exemple', `<script>\nconst s = '</script>\nconst ex = '${EX}'\n</script>\n${IMG}\n`, false],
]

async function erreurs(gabarit: string, prod: boolean, partiel: boolean): Promise<string[]> {
  const root = mjsTmp('img-fichier-refuse')
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
  return stats.errors.map(e => e.message.split('\n')[0])
}

describe('<@@img> d\'un fichier que le compilateur refuse : son refus reste l\'erreur', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    for (const [nom, gabarit, partiel] of CAS) {
      it(`${prod ? 'production' : 'développement'} : ${nom}`, async () => {
        const vues = await erreurs(gabarit, prod, partiel)
        assert.equal(vues.length, 1, vues.join('\n'))
        assert.match(vues[0], /<\/script> orphelin/)
        assert.doesNotMatch(vues[0], /introuvable/)
      })
    }
  }
})
