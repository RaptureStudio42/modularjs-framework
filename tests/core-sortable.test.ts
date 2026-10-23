// `<@@sortable>` : le module n'entre au bundle que si une balise le référence — une appli qui ne l'écrit pas ne
// porte rien de lui, ni code, ni style, ni libellé (le groupe `core` de la table des libellés part chez toute appli
// qui lit la langue : les textes du module vivent donc dans le module). Build RÉEL (Bundler), sans navigateur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { mjsTmp } from './helpers/tmp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function construire(nom: string, source: string, prod: boolean): Promise<{ erreurs: string[], fichiers: Record<string, string> }> {
  const root   = mjsTmp(`sortable-statique-${nom}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(prod ? { env: 'prod' } : {}) } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  const fichiers: Record<string, string> = { 'bundle.js': readFileSync(join(root, 'bundle.js'), 'utf-8') }
  for (const f of readdirSync(outDir).filter((n) => n.endsWith('.js') || n.endsWith('.css'))) fichiers[f] = readFileSync(join(outDir, f), 'utf-8')
  return { erreurs: stats.errors.map((e: any) => e.message), fichiers }
}

const SANS = '<script>\n  $v = \'a\'\n</script>\n<@@select name="s" value=!{$v}><@@option value="a">Alpha</@@option></@@select>\n<@@number big></@@number>'
const AVEC = '<script>\n  $l = [{ id: 1, t: \'a\' }, { id: 2, t: \'b\' }]\n</script>\n<@@sortable value=!{$l}>\n  {for et in $l by id}\n    <div>{et.t}</div>\n  {end}\n</@@sortable>'

describe('<@@sortable> : un module du cœur qui ne coûte rien à qui ne l\'écrit pas', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le fichier du module est dans le catalogue du cœur', () => {
    assert.ok(existsSync(join(__dirname, '..', 'src', 'core-modules', 'sortable.mjs')))
  })

  it('aucune clé du groupe `core` de la table des libellés ne vient de lui', () => {
    for (const lang of ['fr', 'en'] as const) {
      const cles = Object.keys((RUNTIME_LABELS[lang] as any).core)
      assert.deepEqual(cles.filter((c) => /sortable/i.test(c)), [], `${lang} : ses textes restent dans le module`)
    }
  })

  for (const prod of [false, true]) {
    it(`appli avec select et nombre, sans <@@sortable> (${prod ? 'production' : 'développement'}) : rien du module dans aucun fichier`, async () => {
      const { erreurs, fichiers } = await construire('sans-' + (prod ? 'prod' : 'dev'), SANS, prod)
      assert.deepEqual(erreurs, [])
      for (const [nom, contenu] of Object.entries(fichiers)) assert.doesNotMatch(contenu, /sortable/i, `${nom} ne doit rien porter du module`)
    })

    it(`appli avec <@@sortable> (${prod ? 'production' : 'développement'}) : le build passe, le module entre au bundle`, async () => {
      const { erreurs, fichiers } = await construire('avec-' + (prod ? 'prod' : 'dev'), AVEC, prod)
      assert.deepEqual(erreurs, [])
      assert.ok(Object.values(fichiers).some((c) => /mjs-core-sortable/.test(c)), 'la balise mjs-core-sortable est définie dans un fichier du build')
    })
  }
})
