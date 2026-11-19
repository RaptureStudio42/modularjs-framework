// un SVG qui écrit des éléments HTML (espace de noms de XHTML : racine `<html>`, ou `<h:meta>`, `<form>` sous un autre espace de noms)
// est refusé à la construction, comme un SVG qui porte un script : ouvert à son adresse, le navigateur en fait un vrai document, où
// `<meta http-equiv="refresh">` envoie la page ailleurs et `<form action>` poste vers une autre adresse, sans aucun script. L'espace de
// noms écrit avec une entité est vu de même ; un SVG ordinaire passe

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const AILLEURS = 'https://ailleurs.test/'
const REFUSES: Array<[string, string]> = [
  ['racine <html>', `<html xmlns="http://www.w3.org/1999/xhtml"><head><meta http-equiv="refresh" content="0;url=${AILLEURS}"/></head><body/></html>`],
  ['<h:meta> sous un préfixe', `<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml"><h:meta http-equiv="refresh" content="0;url=${AILLEURS}"/></svg>`],
  ['<form action> sous l\'espace de noms par défaut', `<svg xmlns="http://www.w3.org/2000/svg"><g><form xmlns="http://www.w3.org/1999/xhtml" action="${AILLEURS}"><input name="p"/><button>ok</button></form></g></svg>`],
  ['espace de noms écrit avec une entité', `<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http&#58;//www.w3.org/1999/xhtml"><h:meta http-equiv="refresh" content="0;url=${AILLEURS}"/></svg>`]
]
const ORDINAIRE = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><title>été</title><rect width="10" height="10"/></svg>'

async function construire(svg: string, prod: boolean): Promise<{ erreurs: string[], copies: string[] }> {
  const root = mjsTmp('svg-xhtml')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'x.svg'), svg)
  writeFileSync(join(src, 'page.mjs'), '<p>y</p>\n<@@img src="x.svg" alt="x">\n')
  const garde = { warn: console.warn, log: console.log, error: console.error }
  console.warn = console.log = console.error = () => {}
  let erreurs: string[]
  try {
    const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: prod ? 'prod' : 'dev', keepFailedComponents: false })
    const stats = await b.compile()
    await b.close()
    erreurs = stats.errors.map(e => e.message)
  }
  finally {
    Object.assign(console, garde)
  }
  return { erreurs, copies: existsSync(out) ? readdirSync(out).filter(f => f.endsWith('.svg')) : [] }
}

describe('SVG : l\'espace de noms de XHTML refusé', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    const mode = prod ? 'production' : 'développement'

    for (const [nom, svg] of REFUSES) {
      it(`${mode} : ${nom} — refusé, le fichier nommé, rien de copié`, async () => {
        const r = await construire(svg, prod)
        assert.equal(r.erreurs.length, 1, r.erreurs.join('\n'))
        assert.match(r.erreurs[0], /x\.svg : SVG refusé — contient XHTML/)
        assert.deepEqual(r.copies, [])
      })
    }

    it(`${mode} : un SVG ordinaire passe`, async () => {
      const r = await construire(ORDINAIRE, prod)
      assert.deepEqual(r.erreurs, [])
      assert.equal(r.copies.length, 1)
    })
  }
})
