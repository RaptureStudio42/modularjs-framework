// une faute du <script>, du <script module> ou d'un bloc <vars> écrite après un ou plusieurs blocs <@head> / <@failed> de
// plusieurs lignes est citée à sa ligne et à sa colonne du fichier : le compilateur masque ces blocs avant de chercher ses
// sections, chacun par un jeton d'une ligne, et leurs lignes comptent quand même. Fins de ligne LF ou CRLF, en développement
// et en production, dans un composant et dans un partiel <@include> ; sans bloc, la position citée ne change pas. Le style
// cite sa faute dans son bloc (`4:4  root stylesheet`, dans le style fusionné pour un partiel), la même avec ou sans ces blocs

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { extractSections } from '../src/transpiler/sections.js'
import { mjsTmp } from './helpers/tmp.js'

const HEAD   = '<@head>\n  <meta name="a" content="1">\n  <script src="/x.js"></script>\n</@head>\n'
const FAILED = '<@failed err reset>\n  <p>oups</p>\n  <p>encore</p>\n</@failed>\n'

// [nom, ce qui précède le gabarit et la section fautive]
const AVANT: Array<[string, string]> = [
  ['sans bloc', ''],
  ['un <@head> de 4 lignes', HEAD],
  ['un <@failed> de 4 lignes', FAILED],
  ['un <@head> puis un <@failed>', HEAD + '<p>t</p>\n' + FAILED],
  ['un <@failed> d\'une ligne puis un <@head>', '<@failed err reset><p>oups</p></@failed>\n' + HEAD],
]

// [nom, section fautive, texte de la faute, colonne de la faute, partiel permis]
const FAUTES: Array<[string, string, string, number, boolean]> = [
  ['<script>', '<script>\n  x = 1\n  y = = 2\n</script>\n', 'y = = 2', 7, true],
  ['<script module>', '<script module>\n  x = 1\n  y = = 2\n</script>\n', 'y = = 2', 7, true],
  ['<vars>', '<vars>\n  $a: int\n</vars>\n<script>\n  $a = 1\n</script>\n', '$a: int', 0, false],
]

const STYLE = '<script>\n  x = 1\n</script>\n<style>\n  .a\n    color: red\n  .b {{{\n</style>\n'

// la construction d'un composant `page.mjs`, ou d'une page qui inclut le partiel `_cas.mjs` : le premier message d'erreur, aplati
async function erreur(texte: string, prod: boolean, partiel: boolean): Promise<string> {
  const root = mjsTmp('positions-head-failed')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  if (partiel) writeFileSync(join(src, '_cas.mjs'), texte)
  writeFileSync(join(src, 'page.mjs'), partiel ? '<div><@include cas></div>\n' : texte)
  const b     = new Bundler({ sourceDir: src, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), env: prod ? 'prod' : 'dev' })
  const stats = await b.compile()
  await b.close()
  return stats.errors.map(e => e.message).join('\n').replace(/\s+/g, ' ')
}

describe('positions des fautes après des blocs <@head> / <@failed> de plusieurs lignes', function () {
  this.timeout(240000)

  after(async () => { await terminateSharedWorkerPool() })

  describe('extractSections : la ligne de chaque section est celle du fichier', () => {
    for (const [nom, avant] of AVANT) {
      for (const crlf of [false, true]) {
        it(`${nom}${crlf ? ', CRLF' : ''}`, () => {
          const texte  = avant + '<p>ok</p>\n<vars>\n  $a int\n</vars>\n<script module>\n  m = 1\n</script>\n<routes target="main">\n  / accueil\n</routes>\n<script>\n  x = 1\n</script>\n'
          const lignes = texte.split('\n')
          const ligne  = (debut: string): number => lignes.findIndex(l => l.startsWith(debut)) + 1
          const s      = extractSections(crlf ? texte.replace(/\n/g, '\r\n') : texte)
          assert.deepEqual([s.vars?.startLine, s.module.startLine, s.routes[0].line, s.script.startLine], [ligne('<vars>'), ligne('<script module>'), ligne('<routes'), ligne('<script>')])
        })
        it(`${nom}${crlf ? ', CRLF' : ''} : un <vars> après le <script> est cité à sa ligne`, () => {
          const texte = avant + '<p>ok</p>\n<script>\n  x = 1\n</script>\n<vars>\n  $a int\n</vars>\n'
          const ligne = texte.split('\n').findIndex(l => l.startsWith('<vars>')) + 1
          assert.throws(() => extractSections(crlf ? texte.replace(/\n/g, '\r\n') : texte), (e: Error) => e.message.includes(`<vars> (ligne ${ligne}) après le <script>`))
        })
      }
    }
  })

  for (const prod of [false, true]) {
    for (const partiel of [false, true]) {
      describe(`${prod ? 'production' : 'développement'}, ${partiel ? 'dans un partiel <@include>' : 'dans un composant'}`, () => {
        for (const [nf, section, faute, colonne, partielPermis] of FAUTES) {
          if (partiel && !partielPermis) continue
          for (const [na, avant] of AVANT) {
            for (const crlf of [false, true]) {
              it(`faute du ${nf} après ${na}${crlf ? ', CRLF' : ''}`, async () => {
                const texte = avant + '<p>ok</p>\n' + section
                const ligne = texte.split('\n').findIndex(l => l.includes(faute)) + 1
                const msg   = await erreur(crlf ? texte.replace(/\n/g, '\r\n') : texte, prod, partiel)
                if (colonne > 0) assert.ok(msg.includes(` ${partiel ? '_cas' : 'page'}.mjs:${ligne}:${colonne} `), `attendu ${ligne}:${colonne} — ${msg.slice(0, 300)}`)
                else assert.ok(msg.includes(`ligne ${ligne} `) || msg.includes(`ligne ${ligne},`) || msg.includes(`ligne ${ligne}:`), `attendu ligne ${ligne} — ${msg.slice(0, 300)}`)
              })
            }
          }
        }
        // une <@@img> du repli devient la balise du module cœur : sa fermante écrite sur deux lignes garde ses lignes, les fautes écrites
        // après elle dans le repli sont citées à leur ligne
        it('fautes du repli après une <@@img> dont la fermante tient sur deux lignes', async () => {
          const msg  = await erreur('<@failed err reset>\n  <@@img src="/a.png" alt="a"></@@img\n  >\n  <p {err.message}>t</p>\n  <p @click.zz={reset}>u</p>\n</@failed>\n<p>ok</p>\n', prod, partiel)
          const dans = partiel ? ' de _cas.mjs' : ''
          assert.ok(msg.includes(`<@failed> ligne 4${dans} : « <p {err.message}> »`), msg.slice(0, 400))
          assert.ok(msg.includes(`« @click.zz » (ligne 5${dans})`), msg.slice(0, 400))
        })
        it('faute du <style> : citée dans son bloc, la même après un <@head> et un <@failed>', async () => {
          const sans = await erreur('<p>ok</p>\n' + STYLE, prod, partiel)
          const avec = await erreur(HEAD + '<p>t</p>\n' + FAILED + '<p>ok</p>\n' + STYLE, prod, partiel)
          assert.ok(sans.includes(partiel ? 'root stylesheet' : '4:4 root stylesheet'), sans.slice(0, 300))
          assert.equal(avec.replace(/\/[^ ]*\/src\//g, ''), sans.replace(/\/[^ ]*\/src\//g, ''))
        })
      })
    }
  }
})
