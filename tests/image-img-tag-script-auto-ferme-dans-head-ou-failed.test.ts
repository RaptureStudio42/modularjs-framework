// une section <script> ou <style> écrite dans un bloc <@head> ou <@failed> n'est pas une section du composant : le compilateur
// masque ces blocs avant de chercher ses sections. Écrite sur une ligne avec un `//` avant sa fermante, ou auto-fermée
// (`<script src="…" />`), elle n'avale pas le gabarit jusqu'à la fermante d'une vraie section plus bas : la vraie <@@img> du
// gabarit se prépare comme toute <@@img> (empreinte, copie, adresse), en développement et en production, dans un composant et dans
// un partiel <@include>

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const IMG = '<@@img src="b.png" alt="b">'

// [nom, gabarit] : un bloc <@head> ou <@failed> qui porte une section d'une ligne ou auto-fermée, la vraie balise, une section du
// même type plus bas
const CAS: Array<[string, string]> = [
  ['<@head>, script auto-fermé ; script en bas', `<@head>\n  <script src="/x.js" />\n</@head>\n<p>a</p>\n${IMG}\n<script>\n  x = 1\n</script>\n`],
  ['<@head>, script auto-fermé ; script en haut, module en bas', `<script>\n  x = 1\n</script>\n<@head>\n  <script src="/x.js" />\n</@head>\n${IMG}\n<script module>\n  y = 2\n</script>\n`],
  ['<@failed>, script auto-fermé et image ; script en bas', `<@failed err reset>\n  <script src="/x.js" />\n  ${IMG}\n</@failed>\n<p>ok</p>\n<script>\n  x = 1\n</script>\n`],
]

type Prepare = { preResolveAssets: (content: string, baseDir?: string) => Promise<{ images: Record<string, string> }> }

interface Construit {
  erreurs: string[]
  balises: string[]
  copies:  string[]
  images:  string[]
}

// la construction d'un gabarit écrit dans le composant ou dans son partiel `_cas.mjs` : erreurs, balises `<@@img>` préparées de la
// page écrite (le repli d'un <@failed> la rend en `<mjs-core-img …>`, comme partout ailleurs), images copiées, balises que
// prépare la construction
async function construire(gabarit: string, prod: boolean, partiel: boolean): Promise<Construit> {
  const root = mjsTmp('img-head-failed')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  const page = partiel ? '<div><@include cas></div>\n' : gabarit
  mkdirSync(src, { recursive: true })
  mkdirSync(out)
  writeFileSync(join(src, 'b.png'), validPng(40, 30))
  if (partiel) writeFileSync(join(src, '_cas.mjs'), gabarit)
  writeFileSync(join(src, 'page.mjs'), page)
  const b      = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(root, 'bundle.js'), env: prod ? 'prod' : 'dev' })
  const stats  = await b.compile()
  const images = Object.keys((await (b as unknown as Prepare).preResolveAssets(page, src)).images)
  await b.close()
  const sortie = readdirSync(out)
  const js     = sortie.filter(f => /^page-.*\.js$/.test(f)).map(f => readFileSync(join(out, f), 'utf-8')).join('\n')
  return { erreurs: stats.errors.map(e => e.message.split('\n')[0]), balises: js.match(/<(?:mjs-core-img|@@img)\b[^>]*>/g) ?? [], copies: sortie.filter(f => /\.png$/.test(f)), images }
}

describe('<@@img> après un <script … /> auto-fermé dans <@head> ou <@failed>', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    for (const partiel of [false, true]) {
      describe(`${prod ? 'production' : 'développement'}, ${partiel ? 'dans un partiel <@include>' : 'dans un composant'}`, () => {
        for (const [nom, gabarit] of CAS) {
          it(nom, async () => {
            const vu = await construire(gabarit, prod, partiel)
            assert.deepEqual(vu.erreurs, [])
            assert.deepEqual(vu.images, [IMG], 'la vraie balise se prépare')
            assert.equal(vu.copies.length, 1, JSON.stringify(vu.copies))
            assert.ok(vu.balises.some(t => /src=.\/out\/b-[a-f0-9]{8}\.png/.test(t)), vu.balises.join('\n'))
          })
        }
      })
    }
  }
})
