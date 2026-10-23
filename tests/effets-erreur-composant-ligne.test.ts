// Une faute d'effet dans un composant (`<p *titre>` qui n'existe pas, `*scramble(on: bogus)`) nomme sa ligne
// dans le fichier, comme les fautes des fichiers d'effets : le message cite la ligne de la balise fautive (le
// générateur la lit sur la balise, même quand le même effet s'écrit à plusieurs endroits). Rien de plus quand
// l'effet ne s'écrit pas dans le fichier lui-même (un partiel inclus) : jamais une ligne devinée.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

async function erreurs(prefixe: string, fichiers: Record<string, string>): Promise<string[]> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  return stats.errors.map((e: any) => e.message)
}

describe('une faute d\'effet dans un composant cite la ligne', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('effet inconnu : la ligne où il est écrit, avec le nom du fichier', async () => {
    const [m, ...autres] = await erreurs('effet-ligne-inconnu', { 'carte.mjs': '<script>\n$a = 1\n</script>\n\n<p class="x">ok</p>\n<p *titre>ABC</p>\n' })
    assert.equal(autres.length, 0)
    assert.match(m, /carte\.mjs/)
    assert.match(m, /\*titre \(ligne 6\) : effet inconnu/)
  })

  it('réglage faux : la ligne de la balise', async () => {
    const [m] = await erreurs('effet-ligne-reglage', { 'carte.mjs': '<div>\n<p *scramble(on: bogus)>ABC</p>\n</div>\n' })
    assert.match(m, /\*scramble \(ligne 2\) : on = bogus/)
  })

  it('effet donné en réglage d\'un autre : la ligne de la balise qui l\'écrit', async () => {
    const [m] = await erreurs('effet-ligne-imbrique', { 'carte.mjs': '<div>\n\n<p *delta(fx: *zzz)>1</p>\n</div>\n' })
    assert.match(m, /\*zzz \(ligne 3\) : effet inconnu/)
  })

  it('le même effet écrit à plusieurs endroits : la ligne de la balise fautive, pas toutes celles où il est écrit', async () => {
    const [m] = await erreurs('effet-ligne-plusieurs', { 'carte.mjs': '<p *scramble(on: click)>a</p>\n<p>b</p>\n<p *scramble(on: bogus)>c</p>\n' })
    assert.match(m, /\*scramble \(ligne 3\) : on = bogus/)
    assert.doesNotMatch(m, /lignes/)
  })

  it('un effet qui ne s\'écrit pas dans le fichier : le message reste tel quel, sans ligne', async () => {
    const [m] = await erreurs('effet-ligne-partiel', { 'carte.mjs': '<@include bloc>\n', '_bloc.mjs': '<p *titre>x</p>\n' })
    assert.match(m, /\*titre : effet inconnu/)
    assert.doesNotMatch(m, /\(lignes? \d/)
  })
})
