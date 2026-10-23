// Un effet réglé du fichier `*.effects.mjs` qui donne en réglage un autre effet de l'appli
// (`*vague = *delta(fx: *halo)`, `*vaguetitre = *delta(fx: *titre)`) : le fichier se résout seul, avec
// ses propres effets — la même source passe dans un processus neuf (`mjs build`) comme dans une
// session `mjs dev` déjà lancée, et un effet retiré du fichier ne survit pas d'un tour à l'autre.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { collectEffectDefs } from '../src/bundler/effects-files.js'
import { setProjectEffects } from '../src/effects/catalog.js'
import { mjsTmp } from './helpers/tmp.js'

const EFFETS = '<effects>\n  *halo(color: #0ff) =\n    box-shadow: 0 0 8px $color\n  *titre = *scramble(20)\n  *vague = *delta(fx: *halo)\n  *vaguetitre = *delta(fx: *titre)\n</effects>\n'

function projet(etiquette: string, fichiers: Record<string, string>) {
  const root   = mjsTmp('fx-imbrique-' + etiquette)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const sortie  = (stats: any, nom: string) => readFileSync(join(outDir, basename(stats.manifest[nom])), 'utf-8')
  return { srcDir, bundler, sortie }
}

const erreurs = (stats: any) => stats.errors.map((e: any) => e.message).join('\n')

describe('effets de l\'appli : un effet réglé qui donne en réglage un autre effet du fichier', function () {
  this.timeout(60000)
  // un processus neuf ne connaît aucun effet de l'appli avant la première compilation
  beforeEach(() => { setProjectEffects(undefined) })
  after(async () => { await terminateSharedWorkerPool() })

  it('le fichier se résout seul : l\'effet CSS et l\'effet réglé donnés en réglage sont trouvés', () => {
    const defs = collectEffectDefs(['/x/app.effects.mjs'], () => EFFETS)
    assert.deepEqual(defs.vague.fixed, { fx: { fx: 'halo', s: {} } })
    assert.deepEqual(defs.vaguetitre.fixed, { fx: { fx: 'scramble', s: { speed: 20 } } })
  })

  it('premier build d\'un processus neuf : aucune erreur, le composant pose les effets et la définition de l\'effet CSS', async () => {
    const p = projet('neuf', { 'app.effects.mjs': EFFETS, 'carte.mjs': '<script>\n$n = 1\n</script>\n<p *vague>{$n}</p>\n<p *vaguetitre>{$n}</p>\n<p *halo>A</p>\n' })
    const stats = await p.bundler.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    const carte = p.sortie(stats, 'carte')
    assert.match(carte, /"fx":\{"fx":"halo","s":\{\}\}/)
    assert.match(carte, /"fx":\{"fx":"scramble","s":\{"speed":20\}\}/)
    assert.match(carte, /µ\._mjs_fxCustom\("halo"/)
    await p.bundler.close()
  })

  it('en développement, un effet retiré du fichier ne survit pas : celui qui le donnait en réglage est refusé', async () => {
    const p = projet('retire', { 'app.effects.mjs': EFFETS, 'carte.mjs': '<script>\n$n = 1\n</script>\n<p *vague>{$n}</p>\n<p *halo>A</p>\n' })
    let stats = await p.bundler.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    writeFileSync(join(p.srcDir, 'app.effects.mjs'), '<effects>\n  *vague = *delta(fx: *halo)\n</effects>\n')
    writeFileSync(join(p.srcDir, 'carte.mjs'), '<script>\n$n = 1\n</script>\n<p *vague>{$n}</p>\n')
    stats = await p.bundler.compile()
    assert.match(erreurs(stats), /halo/)
    await p.bundler.close()
  })

  it('deux effets qui se donnent l\'un l\'autre en réglage : refusé, en rond', () => {
    assert.throws(() => collectEffectDefs(['/x/app.effects.mjs'], () => '<effects>\n  *a = *delta(fx: *b)\n  *b = *delta(fx: *a)\n</effects>\n'), /en rond/)
  })

  it('les effets de la compilation en cours sont rendus intacts après la résolution d\'un fichier', async () => {
    const { projectEffect } = await import('../src/effects/catalog.js')
    setProjectEffects({ garde: { params: [['c', 'red']], decls: [['color', '$c']], keyframes: [], file: '/y/b.effects.mjs', line: 1 } })
    collectEffectDefs(['/x/app.effects.mjs'], () => EFFETS)
    assert.equal(projectEffect('garde')?.file, '/y/b.effects.mjs')
    assert.equal(projectEffect('halo'), undefined)
  })
})
