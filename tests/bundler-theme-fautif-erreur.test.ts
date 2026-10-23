// Une faute dans un `*.theme.mjs` est une erreur de construction comme une autre : compile() la rend dans `errors` au lieu
// de rejeter (sinon `mjs dev` ne recevait ni le rappel de recompilation ni l'affichage d'erreur). Et une surveillance dont
// le premier build rejette malgré tout ferme son observateur de fichiers avant de rendre l'erreur : il ne reste aucun
// observateur actif, sans poignée pour le fermer.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const simple = (texte: string) => ['<script>', '  $x = 1', '</script>', `<p>{$x} ${texte}</p>`].join('\n')
const observateurs = () => process.getActiveResourcesInfo().filter(r => r === 'FSEventWrap').length

function projet(prefixe: string) {
  const root = mjsTmp(prefixe)
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'c.mjs'), simple('c'))
  return { src, out: join(root, 'out'), man: join(root, 'out', 'bundle.js') }
}

describe('thème fautif et surveillance qui échoue au démarrage', function () {
  this.timeout(30000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('un *.theme.mjs au nom invalide : compile() résout et rend l\'erreur', async () => {
    const { src, out, man } = projet('theme-fautif-compile')
    writeFileSync(join(src, 'Sombre.theme.mjs'), '<theme>\n  $$fond: #000\n</theme>\n')
    const stats = await new Bundler({ sourceDir: src, outputDir: out, manifestPath: man }).compile()
    assert.equal(stats.errors.length, 1, stats.errors.map(e => e.message).join('\n'))
    assert.match(stats.errors[0].message, /Sombre/)
  })

  it('un *.theme.mjs fautif au démarrage de la surveillance : watch() résout, le rappel reçoit l\'erreur', async () => {
    const { src, out, man } = projet('theme-fautif-watch')
    writeFileSync(join(src, 'Sombre.theme.mjs'), '<theme>\n  $$fond: #000\n</theme>\n')
    const recus: number[] = []
    await new Bundler({ sourceDir: src, outputDir: out, manifestPath: man }).watch({ onRecompile: (_chemin, stats) => recus.push(stats?.errors.length ?? -1) })
    assert.deepEqual(recus, [1])
  })

  it('le premier build de watch() rejette : l\'observateur est fermé avant que l\'erreur ne remonte', async () => {
    const { src, out, man } = projet('watch-rejet-ferme')
    const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: man })
    ;(b as any).compile = async () => { throw new Error('panne simulée du premier build') }
    const avant = observateurs()
    await assert.rejects(b.watch(), /panne simulée du premier build/)
    // Node relâche les observateurs fermés au fil des tours de boucle qui suivent : un observateur resté ouvert, lui, ne part jamais
    const debut = Date.now()
    while (observateurs() > avant && Date.now() - debut < 3000) await new Promise(r => setTimeout(r, 50))
    assert.equal(observateurs(), avant, 'aucun observateur de fichiers laissé actif')
  })
})
