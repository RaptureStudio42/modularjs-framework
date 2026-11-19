// Rechargement à chaud sous `mjs dev` : un tour qui s'arrête avant d'écrire ses fichiers (cœur introuvable, feuille de mise en page
// qui tomberait sur un fichier de l'auteur) a déjà relu les composants changés. Ce qu'il a changé part avec le tour réussi suivant :
// un script changé pendant ce tour ne passe pas, au tour d'après, pour un simple changement de style (la page garderait l'ancien script)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const COMP_V1 = [
  '<script>',
  '$count = 0',
  'inc = -> $count++',
  '</script>',
  '<button class="plus" @click={inc}>+</button>',
  '<p class="t">v1 {$count}</p>',
  '<style>',
  '.t',
  '  color: red',
  '</style>',
  '<style name="large">',
  '.t',
  '  font-size: 2em',
  '</style>'
].join('\n')

// script et gabarit changés ; puis, au tour suivant, le style seul
const COMP_V2       = COMP_V1.replace('v1 {$count}', 'v2 {$count}').replace('$count++', '$count += 10')
const COMP_V2_STYLE = COMP_V2.replace('color: red', 'color: blue')

function projet(prefixe: string, surPlace = false) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = surPlace ? srcDir : join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'comp.mjs'), COMP_V1)
  const b = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'dev', keepFailedComponents: true } as any)
  ;(b as any).cssOnlyTracking = true
  return { b, root, srcDir, outDir }
}

const messages = (s: any) => s.errors.map((e: Error) => e.message).join('\n')

// le tour d'après l'arrêt : le style seul a changé depuis ce que l'arrêt a lu, le script depuis ce que la page a reçu
async function apresArret(b: Bundler, srcDir: string, outDir: string): Promise<void> {
  writeFileSync(join(srcDir, 'comp.mjs'), COMP_V2_STYLE)
  const stats: any = await b.compile()
  assert.equal(stats.errors.length, 0, messages(stats))
  assert.equal(stats.cssOnly, null, 'le script changé pendant le tour arrêté passe pour un simple changement de style')
  assert.deepEqual(Object.keys(stats.hot?.components ?? {}), ['mjs-comp'], 'le composant part à chaud')
  assert.match(readFileSync(join(outDir, basename(stats.hot.components['mjs-comp'])), 'utf-8'), /v2 /, 'le fichier échangé porte le nouveau gabarit')
}

describe('mjs dev : un tour arrêté avant d\'écrire ses fichiers, puis le style seul — le script changé part quand même', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  it('cœur introuvable pendant le changement du script : le tour suivant échange le composant, il ne garde pas l\'ancien script', async () => {
    const { b, root, srcDir, outDir } = projet('chaud-arret-coeur')
    const premier: any = await b.compile()
    assert.equal(premier.errors.length, 0, messages(premier))
    const runtimeDir = (b as any).runtimeDir
    ;(b as any).runtimeDir = join(root, 'coeur-absent')
    writeFileSync(join(srcDir, 'comp.mjs'), COMP_V2)
    const arrete: any = await b.compile()
    assert.ok(arrete.errors.length > 0 && /runtime/i.test(messages(arrete)), messages(arrete) || 'aucune erreur')
    ;(b as any).runtimeDir = runtimeDir
    await apresArret(b, srcDir, outDir)
  })

  it('feuille de mise en page sur un fichier de l\'auteur pendant le changement du script : de même', async () => {
    const { b, srcDir } = projet('chaud-arret-feuille', true)
    const premier: any = await b.compile()
    assert.equal(premier.errors.length, 0, messages(premier))
    rmSync(join(srcDir, 'comp.large.css'), { force: true })
    writeFileSync(join(srcDir, 'comp.large.css'), '.t { font-size: 3em }\n')
    writeFileSync(join(srcDir, 'comp.mjs'), COMP_V2)
    const arrete: any = await b.compile()
    assert.ok(arrete.errors.some((e: Error) => e.message.includes('comp.large.css')), messages(arrete) || 'aucune erreur')
    rmSync(join(srcDir, 'comp.large.css'), { force: true })
    await apresArret(b, srcDir, srcDir)
  })
})
