// Ce que ce test garantit : `mjs build` écrit chaque avertissement de la compilation UNE fois, dans son bilan. Le prérendu
// recompile le même projet pour rendre ses pages : les avertissements de cette seconde compilation revenaient avec chaque
// rendu, et la passe les répétait sous les pages, avec une seconde étiquette (`… [lint.emptyComponent] [lint.prerender]`) :
// sur le site, les 21 lignes du bilan sortaient deux fois. Le prérendu garde ce qui lui est propre (un rendu non stabilisé,
// avec sa page) et ce que le bilan n'a pas dit ; une ligne déjà étiquetée par la compilation garde sa seule étiquette.
// Vrai sous-processus pour la commande (cli.ts lance `run(process.argv)` dès son chargement).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { prerenderPages } from '../src/server/prerender.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function projet(): string {
  const root = mjsTmp('prerender-bilan')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'accueil.mjs'), '<script>\n$titre = \'Accueil\'\n</script>\n<h1>{$titre}</h1>\n')
  // promesse jamais résolue : le rendu de CETTE page ne se stabilise pas, avertissement propre au prérendu
  writeFileSync(join(root, 'src', 'lente.mjs'), '<script>\n$p = new Promise(->)\n</script>\n{await $p}<span>attente</span>{success v}<span>{v}</span>{end}\n')
  // composant sans HTML : avertissement de la compilation, au bilan
  writeFileSync(join(root, 'src', 'vide.mjs'), '<script>\nx = 1\n</script>\n')
  const render = { default: 'prerender', engine: { prerender: 'happy-dom' }, routes: { '/': { component: 'mjs-accueil' }, '/lente': { component: 'mjs-lente', settleMs: 30 } } }
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/out', render }, null, 2))
  return root
}

const etiquettes = (ligne: string): number => (ligne.match(/\[lint\.[a-zA-Z0-9]+\]/g) ?? []).length

describe('mjs build — un avertissement de la compilation sort une fois, au bilan', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('le prérendu ne répète pas le bilan, et garde ce qui lui est propre', () => {
    const root   = projet()
    const result = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', root], { cwd: repoRoot, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } })
    const sortie = (result.stdout ?? '') + (result.stderr ?? '')
    assert.equal(result.status, 0, sortie)
    const lignes = sortie.split('\n')
    const vide   = lignes.filter(l => l.includes('vide.mjs'))
    const lente  = lignes.filter(l => /<mjs-lente>.*30 ?ms/.test(l))
    assert.equal(vide.length, 1, `l'avertissement de la compilation sort une fois, au bilan, pas une seconde fois au prérendu :\n${sortie}`)
    assert.equal(etiquettes(vide[0]), 1, `une seule étiquette :\n${vide[0]}`)
    assert.equal(lente.length, 1, `l'avertissement propre au prérendu reste :\n${sortie}`)
    assert.match(lente[0], /⚠️ {2}\/lente : /, `avec sa page :\n${lente[0]}`)
    assert.deepEqual(lignes.filter(l => etiquettes(l) > 1), [], 'aucune ligne à deux étiquettes')
  })

  it('appel direct, sans bilan avant lui : l\'avertissement de la compilation reste dit, avec sa seule étiquette', async () => {
    const root   = projet()
    const lignes: string[] = []
    const config = { sourceDir: 'src', outputDir: 'public/out', render: { default: 'prerender', engine: { prerender: 'happy-dom' }, routes: { '/': { component: 'mjs-accueil' } } } }
    const report = await prerenderPages(config as any, root, l => lignes.push(l))
    assert.equal(report.skipped.length, 0, lignes.join('\n'))
    const vide = lignes.filter(l => l.includes('vide.mjs'))
    assert.equal(vide.length, 1, `rien ne l'a dit avant le prérendu : il le dit, une fois :\n${lignes.join('\n')}`)
    assert.match(vide[0], /\[lint\.emptyComponent\]$/, `l'étiquette de la compilation, seule :\n${vide[0]}`)
    assert.equal(etiquettes(vide[0]), 1, vide[0])
  })
})
