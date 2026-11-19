// un `<!--` écrit dans une expression `{ … }` du texte (dans une chaîne ou non) n'ouvre aucun commentaire, et un `-->` écrit plus bas
// dans une autre expression n'en ferme aucun, comme dans une valeur d'attribut : le <@head> posé entre les deux reste l'en-tête de la
// page, le texte entre les deux reste dans le gabarit, la vraie <@@img> qui suit se prépare (copie, adresse), en développement et en
// production. Le compilateur retirait en silence tout ce qui séparait les deux expressions, pris pour un commentaire qui cite une
// balise du langage. Un vrai commentaire du texte qui cite une image, accolade comprise, part toujours avec elle

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const IMG    = '<@@img src="b.png" alt="b">'
const TETE   = '<@head>\n  <title>Titre-de-page</title>\n</@head>\n'
const PAGES  = {
  'chaînes simples':      "<p>{ '<!--' } premier-texte</p>\n" + TETE + "<p>{ '-->' } second-texte</p>\n" + IMG + '\n',
  'chaînes doubles':      '<p>{ "<!--" } premier-texte</p>\n' + TETE + '<p>{ "-->" } second-texte</p>\n' + IMG + '\n',
  'chaîne à accolade':    "<p>{ '} <!--' } premier-texte</p>\n" + TETE + "<p>{ '-->' } second-texte</p>\n" + IMG + '\n',
  'tête d\'un bloc {if}': "{if '<!--'}<p>premier-texte</p>{end}\n" + TETE + "{if '-->'}<p>second-texte</p>{end}\n" + IMG + '\n'
}
const VRAI   = '<p>premier-texte</p>\n<!-- ancien { : <@@img src="absent.png" alt="v"> -->\n<p>second-texte</p>\n' + IMG + '\n'

interface Construit {
  erreurs: string[]
  copies:  string[]
  code:    string
}

async function construire(page: string, prod: boolean): Promise<Construit> {
  const root = mjsTmp('commentaire-expression')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'b.png'), validPng(40, 30))
  writeFileSync(join(src, 'page.mjs'), page)
  const garde = { warn: console.warn, log: console.log, error: console.error }
  console.warn = console.log = console.error = () => {}
  let erreurs: string[]
  try {
    const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(root, 'bundle.js'), env: prod ? 'prod' : 'dev' })
    const stats = await b.compile()
    await b.close()
    erreurs = stats.errors.map(e => e.message)
  }
  finally {
    Object.assign(console, garde)
  }
  const fichiers = existsSync(out) ? readdirSync(out) : []
  const textes   = [...fichiers.filter(f => f.endsWith('.js')).map(f => join(out, f)), join(root, 'bundle.js')].filter(f => existsSync(f))
  return { erreurs, copies: fichiers.filter(f => /^b-[0-9a-f]+\.png$/.test(f)), code: textes.map(f => readFileSync(f, 'utf-8')).join('\n') }
}

describe('un commentaire cité dans une expression n\'avale ni l\'en-tête ni l\'image', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    const mode = prod ? 'production' : 'développement'

    for (const [nom, page] of Object.entries(PAGES)) {
      it(`${mode}, ${nom} : <@head> et texte entre les deux expressions gardés, image préparée`, async () => {
        const r = await construire(page, prod)
        assert.deepEqual(r.erreurs, [])
        assert.match(r.code, /Titre-de-page/, 'l\'en-tête de la page reste')
        assert.match(r.code, /premier-texte/, 'le texte entre les deux expressions reste')
        assert.match(r.code, /second-texte/)
        assert.equal(r.copies.length, 1, 'image copiée')
        assert.match(r.code, /b-[0-9a-f]+\.png/, 'adresse de l\'image préparée')
      })
    }

    it(`${mode} : un vrai commentaire du texte qui cite une image part avec elle, accolade comprise`, async () => {
      const r = await construire(VRAI, prod)
      assert.deepEqual(r.erreurs, [])
      assert.doesNotMatch(r.code, /absent\.png/, 'l\'image du commentaire n\'est pas lue')
      assert.match(r.code, /second-texte/)
      assert.equal(r.copies.length, 1, 'la vraie image est copiée')
    })
  }
})
