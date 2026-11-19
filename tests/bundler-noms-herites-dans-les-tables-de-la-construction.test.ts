// Un nom choisi par l'auteur qui est aussi celui d'une propriété héritée d'Object reste une donnée dans les tables de la
// construction : une langue `valueOf` (dossier `i18n/valueOf/`) garde ses sections sans rien écrire dans
// Object.prototype.valueOf du processus ; une clé `__proto__` d'un dictionnaire reste une clé dans le fichier de langue
// (écrite dans un objet littéral, elle en devenait le prototype dans le navigateur) ; un composant `constructor` avec son
// modèle `constructor.compacte` se construit au lieu de faire rejeter compile() par une TypeError.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

function projet(nom: string): { src: string, out: string } {
  const root = mjsTmp(nom)
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  return { src, out: join(root, 'out') }
}

describe('noms hérités dans les tables de la construction', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('une langue nommée valueOf garde ses sections et ne touche pas Object.prototype.valueOf', async () => {
    const { src, out } = projet('i18n-langue-valueof')
    mkdirSync(join(src, 'i18n', 'valueOf'), { recursive: true })
    writeFileSync(join(src, 'i18n', 'fr.json'), '{"salut":"Bonjour"}')
    writeFileSync(join(src, 'i18n', 'valueOf', 'accueil.json'), '{"titre":"X"}')
    writeFileSync(join(src, 'page.mjs'), '<p>{µt "salut"}</p>\n')
    try {
      const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: 'prod', i18n: { default: 'fr' } } as any)
      const s = await b.compile()
      await b.close()
      assert.deepEqual(s.errors.map(e => e.message), [])
      assert.equal((Object.prototype.valueOf as any).accueil, undefined, 'Object.prototype.valueOf du processus ne doit rien recevoir')
      const fichier = readdirSync(out).find(n => n.startsWith('mjs_i18n-valueOf-'))
      assert.ok(fichier, 'la langue valueOf doit avoir son fichier : ' + readdirSync(out).join(', '))
      assert.match(readFileSync(join(out, fichier!), 'utf-8'), /"accueil"/)
    }
    finally {
      delete (Object.prototype.valueOf as any).accueil
    }
  })

  for (const env of ['dev', 'prod'] as const) {
    it(`${env} : une clé __proto__ d'un dictionnaire reste une clé du fichier de langue, jamais son prototype`, async () => {
      const { src, out } = projet('i18n-cle-proto')
      mkdirSync(join(src, 'i18n'), { recursive: true })
      writeFileSync(join(src, 'i18n', 'fr.json'), '{"salut":"Bonjour","__proto__":{"piege":"oui"}}')
      writeFileSync(join(src, 'page.mjs'), '<p>{µt "salut"}</p>\n')
      const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env, i18n: { default: 'fr' } } as any)
      const s = await b.compile()
      await b.close()
      assert.deepEqual(s.errors.map(e => e.message), [])
      const fichier = readdirSync(out).find(n => n.startsWith('mjs_i18n-fr-'))
      assert.ok(fichier && existsSync(join(out, fichier)))
      const texte = readFileSync(join(out, fichier!), 'utf-8')
      const d = (await import('data:text/javascript,' + encodeURIComponent(texte))).default
      assert.equal(d.root.salut, 'Bonjour')
      assert.ok(Object.prototype.hasOwnProperty.call(d.root, '__proto__'), 'la clé __proto__ doit rester une clé : ' + texte.trim())
      assert.equal(Object.getPrototypeOf(d.root), Object.prototype, 'le dictionnaire garde le prototype ordinaire')
      assert.equal(d.root.piege, undefined)
    })
  }

  it('un composant constructor avec son modèle constructor.compacte se construit', async () => {
    const { src, out } = projet('composant-constructor')
    writeFileSync(join(src, 'constructor.mjs'), '<p>c</p>\n')
    writeFileSync(join(src, 'constructor.compacte.mjs'), '<p>m</p>\n')
    writeFileSync(join(src, 'page.mjs'), '<@constructor layout="compacte" />\n')
    const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: 'prod' })
    let s: Awaited<ReturnType<Bundler['compile']>>
    try {
      s = await b.compile()
    }
    finally {
      await b.close()
    }
    assert.deepEqual(s.errors.map(e => e.message), [])
    assert.equal(typeof s.manifest['constructor'], 'string')
    assert.equal(typeof s.manifest['constructor--compacte'], 'string', 'le modèle est publié : ' + Object.keys(s.manifest).join(', '))
  })
})
