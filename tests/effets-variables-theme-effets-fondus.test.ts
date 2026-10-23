// les variables de thème d'un effet fondu dans un autre avant la 3.0 (`$$shimmer-color`, `$$aurora-blur`…) ne sont plus lues : posées
// dans un `<style>`, un `<theme>` ou un fichier de thème, elles ne changeaient plus rien, sans un mot. La construction avertit
// maintenant (`lint.legacy`) et nomme la variable qui la remplace (`$$shine-ink`), ou dit qu'il n'y en a pas ; une appli qui a son
// propre effet de ce nom (`*aurora(…) =`) n'est pas avertie, ses réglages sont ses variables.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { replacedThemeVar } from '../src/effects/catalog.js'
import { mjsTmp } from './helpers/tmp.js'

async function avertissements(nom: string, fichiers: Record<string, string>): Promise<string[]> {
  const root = mjsTmp(nom)
  mkdirSync(join(root, 'src'), { recursive: true })
  for (const [f, src] of Object.entries(fichiers)) writeFileSync(join(root, 'src', f), src)
  const b = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
  const stats = await b.compile()
  await b.close()
  assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [], nom)
  return stats.warnings.map(String)
}

const style = (decl: string) => `<p class="b" *shine.shimmer>x</p>\n<style>\n.b\n  ${decl}\n</style>\n`

describe('variables de thème des effets fondus : la construction avertit', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  it('la table : chaque ancienne variable, sa remplaçante', () => {
    assert.deepEqual(replacedThemeVar('shimmer-color'), { effet: 'shimmer', alias: '*shine.shimmer', nouveau: 'shine-ink' })
    assert.equal(replacedThemeVar('shimmer-shine')?.nouveau, 'shine-color')
    assert.equal(replacedThemeVar('wiggle-angle')?.nouveau, 'attention-angle')
    assert.equal(replacedThemeVar('aurora-colors')?.nouveau, 'mesh-colors')
    assert.equal(replacedThemeVar('knockout-outline')?.nouveau, 'gradient-outline')
    assert.equal(replacedThemeVar('texture-speed')?.nouveau, 'gradient-speed')
    assert.equal(replacedThemeVar('typing-delay')?.nouveau, 'cycle-delay')
    assert.equal(replacedThemeVar('lens-size')?.nouveau, '')
    assert.equal(replacedThemeVar('typing-indicator'), undefined)
    assert.equal(replacedThemeVar('shine-ink'), undefined)
  })

  it('$$shimmer-color posée dans un <style> : avertissement qui nomme $$shine-ink', async () => {
    const w = await avertissements('theme-fondu-shimmer', { 'p-a.mjs': style('$$shimmer-color: #ff0000') })
    const l = w.find(x => x.includes('$$shimmer-color'))
    assert.ok(l, w.join('\n'))
    assert.match(l!, /\[lint\.legacy\]/)
    assert.match(l!, /\$\$shine-ink/)
  })

  it('$$lens-size : avertissement, sans variable qui la remplace', async () => {
    const w = await avertissements('theme-fondu-lens', { 'p-a.mjs': style('$$lens-size: 80px') })
    const l = w.find(x => x.includes('$$lens-size'))
    assert.ok(l, w.join('\n'))
    assert.match(l!, /\*filter\.lens/)
  })

  it('les variables qui remplacent ne sont pas averties', async () => {
    const w = await avertissements('theme-fondu-neuves', { 'p-a.mjs': style('$$shine-ink: #ff0000') })
    assert.ok(!w.some(x => x.includes('[lint.legacy]')), w.join('\n'))
  })

  it('une appli qui a son propre *aurora n\'est pas avertie pour ses variables', async () => {
    const w = await avertissements('theme-fondu-appli', {
      'app.effects.mjs': '<effects>\n*aurora(speed: 1s) =\n  transition: opacity $speed\n</effects>\n',
      'p-a.mjs': '<p class="b" *aurora>x</p>\n<style>\n.b\n  $$aurora-speed: 2s\n</style>\n'
    })
    assert.ok(!w.some(x => x.includes('$$aurora-speed')), w.join('\n'))
  })
})
