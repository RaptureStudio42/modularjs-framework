// Registre des variables de thème (`.mjs-theme-vars.json`) : le silence par défaut. Un projet qui ne déclare et ne lit
// rien n'écrit aucun registre ; mais un composant qui LIT une variable avec un défaut (`var(--mjs-nom, défaut)`) en lit
// une, même sans `<theme>` ni `$$` dans le projet : les modules du cœur le font à chaque usage.
// - la case, le radio, l'interrupteur, le sélecteur : chacun, seul dans un projet sans `<theme>` ni `$$`, écrit un registre ;
// - un composant du projet qui lit un nom avec un défaut en écrit un aussi ;
// - un projet sans aucun module, ni aucune lecture, n'en écrit toujours aucun ;
// - ce registre ne déclenche aucun rappel (`lint.themeShared`, `lint.themeUnknown`) : rien n'est déclaré, rien n'est partagé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

type Registre = Record<string, { declarations: { value: string; declaredBy: string; kind: string; line: number; read?: boolean }[]; readBy: string[] }>

async function construire(sources: Record<string, string>): Promise<{ registre: Registre | null; avertissements: string[] }> {
  const root   = mjsTmp('registre-silence')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(srcDir, nom + '.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), stylesheetsDir: join(root, 'styles') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const fichier = join(outDir, '.mjs-theme-vars.json')
  return { registre: existsSync(fichier) ? JSON.parse(readFileSync(fichier, 'utf-8')) : null, avertissements: stats.warnings }
}

const MODULES: [string, string, string, string][] = [
  ['la case',         '<@@checkbox name="a">A</@@checkbox>\n',                                                  'check-size',    'core-checkbox'],
  ['le radio',        '<@@radio name="c" value="x">C</@@radio>\n',                                              'check-size',    'core-radio'],
  ['l\'interrupteur', '<@@switch name="b">B</@@switch>\n',                                                      'switch-width',  'core-switch'],
  ['le sélecteur',    '<@@select name="s"><@@option value="a">A</@@option></@@select>\n',                      'select-radius', 'core-select']
]

describe('registre des variables de thème — le silence par défaut ne cache pas les lectures avec défaut', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [qui, source, variable, lecteur] of MODULES) {
    it(`${qui}, seul, sans <theme> ni $$ : un registre est écrit, avec ses variables et leur lecteur`, async () => {
      const { registre, avertissements } = await construire({ hote: source })
      assert.ok(registre, 'un registre est écrit')
      assert.ok(registre![variable], `${variable} est au registre`)
      assert.equal(registre![variable].declarations.some((d) => d.declaredBy === lecteur && d.read === true), true, `${lecteur} y figure comme lecteur avec son défaut`)
      assert.ok(registre![variable].readBy.includes(lecteur), `${lecteur} est nommé dans readBy`)
      const rappels = avertissements.filter((w) => w.endsWith('[lint.themeShared]') || w.endsWith('[lint.themeUnknown]'))
      assert.deepEqual(rappels, [], 'lire un nom avec un défaut ne déclenche aucun rappel')
    })
  }

  it('un composant du projet qui lit un nom avec un défaut, sans <theme> ni $$ : un registre est écrit', async () => {
    const { registre } = await construire({ carte: '<div>x</div>\n<style>\n  :host\n    gap: var(--mjs-carte-pad, 4px)\n</style>\n' })
    assert.ok(registre, 'un registre est écrit')
    assert.deepEqual(registre!['carte-pad'].declarations.map((d) => `${d.declaredBy}:${d.value}`), ['carte:4px'])
  })

  it('un projet sans aucun module ni aucune lecture n\'écrit aucun registre', async () => {
    const { registre } = await construire({ hote: '<h1>Bonjour</h1>\n', carte: '<div>x</div>\n<style>\n  :host\n    gap: var(--mjs-carte-nu)\n    margin: 0\n</style>\n' })
    assert.equal(registre, null, 'une lecture sans défaut ne suffit pas non plus : elle n\'a rien à afficher')
  })
})
