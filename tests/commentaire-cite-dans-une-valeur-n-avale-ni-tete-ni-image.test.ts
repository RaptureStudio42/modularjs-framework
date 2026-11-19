// un `<!--` écrit dans une valeur d'attribut n'ouvre aucun commentaire, et un `-->` écrit plus bas dans une autre valeur n'en ferme
// aucun : le <@head> posé entre les deux reste l'en-tête de la page, le texte posé entre les deux reste dans le gabarit, la vraie
// <@@img> qui suit se prépare (copie, adresse), en développement et en production. Le compilateur retirait tout ce qui séparait les deux
// valeurs, pris pour un commentaire qui cite une balise du langage : en-tête et texte perdus en silence. Le même gabarit dont le texte
// entre les deux ouvre une accolade jamais fermée est refusé à sa ligne, avec ou sans <@head> : l'image n'y est plus perdue en silence

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const IMG     = '<@@img src="b.png" alt="b">'
const ENTRE   = '<p title="<!--">premier-texte</p>\n<@head>\n  <title>Titre-de-page</title>\n</@head>\n<p title="-->">second-texte</p>\n' + IMG + '\n'
const FAUX    = '<p title="<!--">t</p>\n<pre>\n<p>a</p><style lang="css">\n  /* { */\n</style>\n</pre><@head>\n  <title>t</title>\n</@head>\n<p title="-->">t</p>\n' + IMG + '\n'
const SANS    = '<p title="<!--">t</p>\n<pre>\n<p>a</p><style lang="css">\n  /* { */\n</style>\n</pre>\n<p title="-->">t</p>\n' + IMG + '\n'

interface Construit {
  erreurs: string[]
  copies:  string[]
  code:    string
}

async function construire(page: string, prod: boolean): Promise<Construit> {
  const root = mjsTmp('commentaire-valeur')
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

describe('un commentaire cité dans une valeur d\'attribut n\'avale ni l\'en-tête ni l\'image', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    const mode = prod ? 'production' : 'développement'

    it(`${mode} : <@head> et texte entre les deux valeurs gardés, image préparée`, async () => {
      const r = await construire(ENTRE, prod)
      assert.deepEqual(r.erreurs, [])
      assert.match(r.code, /Titre-de-page/, 'l\'en-tête de la page reste')
      assert.match(r.code, /premier-texte/, 'le texte entre les deux valeurs reste')
      assert.match(r.code, /second-texte/)
      assert.equal(r.copies.length, 1, 'image copiée')
      assert.match(r.code, /b-[0-9a-f]+\.png/, 'adresse de l\'image préparée')
    })

    for (const [nom, page] of [['avec <@head>', FAUX], ['sans <@head>', SANS]] as const) {
      it(`${mode} : accolade jamais fermée entre les deux valeurs, ${nom} : refusée à sa ligne`, async () => {
        const r = await construire(page, prod)
        assert.equal(r.erreurs.length, 1, r.erreurs.join('\n'))
        assert.match(r.erreurs[0], /EXPRESSION NON FERMÉE\] `\{` ouvert ligne 4/)
        assert.doesNotMatch(r.code, /src=\\?["']b\.png/, 'jamais d\'image laissée sans préparation')
      })
    }
  }
})
