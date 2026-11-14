// Classes globales `Nom.class.mjs` — le build : une classe n'est pas un composant ; `µNom` (et `µ.Nom`) se lit partout sans import —
// gabarit, script, module, autre classe — et la classe part seulement avec le code de ceux qui la citent, chargée avant lui ; la
// sortie `node/` la charge sous Node, sans navigateur ; un nom du framework, un nom en double ou un fichier mal formé arrête le build

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { APP, SOURCES } from './helpers/classes-globales.js'

const IMPORTE_APP = /import\s*["'][^"']*App\.class-[0-9a-z]+\.js["']/

function projet(etiquette: string, fichiers: Record<string, string>) {
  const root   = mjsTmp(`classes-${etiquette}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  for (const [nom, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(srcDir, nom)), { recursive: true })
    writeFileSync(join(srcDir, nom), contenu)
  }
  const bundler = (opts: Record<string, unknown> = {}) => new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts })
  const sortie  = (prefixe: string) => {
    const f = readdirSync(outDir).find(n => n.startsWith(prefixe) && n.endsWith('.js'))
    return f ? readFileSync(join(outDir, f), 'utf-8') : `(aucune sortie ${prefixe}…)`
  }
  return { root, srcDir, outDir, bundler, sortie }
}

const erreurs = (stats: any) => stats.errors.map((e: any) => e.message).join('\n')

describe('classes globales `Nom.class.mjs` — le build', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('développement : chaque fichier qui cite la classe l’importe (composant, module, autre classe), les autres non', async () => {
    const p     = projet('dev', SOURCES)
    const b     = p.bundler()
    const stats = await b.compile()
    await b.close()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    const classe = p.sortie('App.class-')
    assert.match(classe, /µ\.App = App/)
    assert.match(classe, /export default App/)
    for (const nom of ['p-home-', 'brand-', 'Card.class-']) assert.match(p.sortie(nom), IMPORTE_APP, `${nom} importe la classe`)
    assert.doesNotMatch(p.sortie('other-'), /App\.class|µ\.App/, 'un composant qui ne la cite pas ne la charge pas')
    for (const f of readdirSync(p.outDir).filter(n => n.endsWith('.js') && !n.startsWith('App.class-'))) assert.doesNotMatch(readFileSync(join(p.outDir, f), 'utf-8'), /Heartwork/, `${f} n’embarque pas la classe`)
    assert.doesNotMatch(readFileSync(join(p.root, 'bundle.js'), 'utf-8'), /Heartwork|mjs-app-class|mjs-card-class/, 'ni dans le manifeste, ni en composant')
  })

  it('une modification de la classe la recompile, et ceux qui la citent importent la nouvelle', async () => {
    const p = projet('modif', SOURCES)
    const b = p.bundler()
    assert.equal((await b.compile()).errors.length, 0)
    const avant = IMPORTE_APP.exec(p.sortie('p-home-'))![0]
    writeFileSync(join(p.srcDir, 'App.class.mjs'), APP.replace('Heartwork', 'Rapture'))
    const stats = await b.compile()
    await b.close()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    const apres = IMPORTE_APP.exec(p.sortie('p-home-'))![0]
    assert.notEqual(apres, avant)
    assert.match(readFileSync(join(p.outDir, apres.match(/App\.class-[0-9a-z]+\.js/)![0]), 'utf-8'), /Rapture/)
  })

  it('production en fichiers séparés : la classe a son fichier, chargé seulement par ceux qui la citent', async () => {
    const p     = projet('prod', SOURCES)
    const b     = p.bundler({ env: 'prod', js: 'split', urlPrefix: '/out' })
    const stats = await b.compile()
    await b.close()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.match(p.sortie('App.class-'), /Heartwork/)
    assert.match(p.sortie('p-home-'), /App\.class-[0-9a-z]+\.js/)
    assert.doesNotMatch(p.sortie('other-'), /App\.class|Heartwork/)
    assert.doesNotMatch(readFileSync(join(p.root, 'bundle.js'), 'utf-8'), /Heartwork/)
  })

  it('sous Node, sans navigateur : la sortie node/ se charge par import, et une classe y lit l’autre', async () => {
    const p     = projet('node', SOURCES)
    const b     = p.bundler()
    const stats = await b.compile()
    await b.close()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    const code = `import App from ${JSON.stringify(join(p.outDir, 'node', 'App.js'))}; import Card from ${JSON.stringify(join(p.outDir, 'node', 'Card.js'))}; console.log(JSON.stringify([App.NAME, App.fullName(), Card.title(), globalThis.µ.App === App]))`
    const vu   = execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf-8' }).trim()
    assert.equal(vu, JSON.stringify(['Heartwork', 'Heartwork — Love, Deeper.', 'Carte Heartwork', true]))
  })

  it('refus à la construction : nom du framework, nom en double, nom sans majuscule, fichier sans sa classe, fichier avec un bloc, classes en boucle', async () => {
    const cas: Array<[string, Record<string, string>, RegExp]> = [
      ['framework', { 'Router.class.mjs': 'class Router\n  x = 1\n' }, /µRouter/],
      ['double', { 'a/App.class.mjs': APP, 'b/App.class.mjs': APP }, /a\/App\.class\.mjs.*b\/App\.class\.mjs/],
      ['casse', { 'app.class.mjs': 'class app\n  x = 1\n' }, /app\.class\.mjs.*[A-Z]/],
      ['sans-classe', { 'App.class.mjs': 'class Autre\n  x = 1\n' }, /App\.class\.mjs.*class App/],
      ['bloc', { 'App.class.mjs': '<script>\nclass App\n</script>\n' }, /App\.class\.mjs.*<script>/],
      ['boucle', { 'A.class.mjs': 'class A\n  x = -> µB.y()\n', 'B.class.mjs': 'class B\n  y = -> µA.x()\n' }, /µA → µB → µA/],
    ]
    for (const [etiquette, fichiers, attendu] of cas) {
      const p     = projet(etiquette, { ...fichiers, 'other.mjs': '<p>autre</p>\n' })
      const b     = p.bundler()
      const stats = await b.compile()
      await b.close()
      assert.match(erreurs(stats), attendu, etiquette)
    }
  })
})
