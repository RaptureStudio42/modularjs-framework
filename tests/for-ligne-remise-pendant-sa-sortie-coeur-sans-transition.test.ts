// Construction : le retour d'une sortie en cours (blocs balisés `<exit-reverse>` de runtime/mjs_for.ts et runtime/mjs_easing.ts — la ligne
// de `{for}` remise pendant sa sortie revient, ses balises intérieures avec elle ; une transition partagée reprise repart de là où elle en
// était) n'entre au cœur que si l'appli écrit `:in`, `:out` ou `:transition`. Une appli qui joint les crochets de destruction pour
// `:attach`, `:this=!`, `:flip` ou un effet posé sur la balise n'en porte rien ; développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import * as features from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const LISTE = (attrs: string) => `<script>\n  $l     = [{ id: 1 }, { id: 2 }]\n  @noter = (n) -> -> n\n</script>\n<ul>{for r in $l by id}<li ${attrs}>{r.id}</li>{end}</ul>\n`
const SANS: Record<string, string> = {
  ':attach': LISTE(':attach={@noter(_node)}'),
  ':this=!': LISTE(':this=!{r.el}'),
  ':flip': LISTE(':flip=200'),
  'effet posé sur la balise': LISTE('*fade(duration: 300ms)')
}
const AVEC: Record<string, string> = {
  ':out': LISTE(':out=*fade(duration: 300ms)'),
  ':in': LISTE(':in=*fade(duration: 300ms)'),
  ':transition': LISTE(':transition=*fade(duration: 300ms)')
}

// le cœur construit (non minifié) d'une appli
async function coeur(nom: string, source: string, env: 'dev' | 'prod'): Promise<string> {
  const root   = mjsTmp('retour-sortie-' + nom.replace(/\W+/g, '') + '-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'liste.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env, minify: false } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const fichier = readdirSync(outDir).find((f) => /^mjs_core/.test(f) && f.endsWith('.js'))
  assert.ok(fichier, `cœur introuvable dans ${readdirSync(outDir).join(', ')}`)
  return readFileSync(join(outDir, fichier), 'utf-8')
}

describe('{for} : le retour d\'une ligne remise pendant sa sortie n\'entre au cœur qu\'avec :in, :out ou :transition', function () {
  this.timeout(180000)

  after(async () => { await terminateSharedWorkerPool() })

  it('signal : posé par :in, :out et :transition, jamais par :attach, :this=!, :flip ni un effet posé sur la balise', async () => {
    const signal = (features as any).TRANSITION_DIRECTIVES
    assert.equal(typeof signal, 'string', 'le signal est publié par le module des signaux')
    const sortie = async (source: string) => (await transpile(source, { moduleName: 'mjs-liste' })).output
    for (const [nom, source] of Object.entries(AVEC)) assert.equal(features.scanCompiledFeatures(await sortie(source)).has(signal), true, nom)
    for (const [nom, source] of Object.entries(SANS)) assert.equal(features.scanCompiledFeatures(await sortie(source)).has(signal), false, nom)
  })

  it('cœur de production : crochets de destruction sans transition, rien du retour ; avec :out, le retour des lignes et la reprise partagée', async () => {
    for (const [nom, source] of Object.entries(SANS)) {
      const c = await coeur(nom, source, 'prod')
      assert.equal(c.includes('_mjs_destroyWithHooks = async function'), true, nom + ' : les crochets de destruction sont au cœur')
      assert.equal(c.includes('_mjs_outRows'), false, nom + ' : rien du retour des lignes')
      assert.equal(c.includes('_mjs_txBack'), false, nom + ' : ni celui de leurs balises intérieures')
      assert.equal(c.includes('_mjsDyingRuns'), false, nom + ' : ni le numéro des retraits')
      assert.equal(c.includes('<exit-reverse>'), false, nom + ' : le bloc balisé est retiré')
    }
    const avec = await coeur(':out', AVEC[':out'], 'prod')
    assert.equal(avec.includes('const _mjs_outRows = new WeakMap()'), true, ':out : le retour des lignes est au cœur')
    assert.equal(avec.includes('_mjs_txBack = function(row, own)'), true, ':out : celui de leurs balises intérieures aussi')
    assert.equal(avec.includes('var _mjsDyingRuns = new WeakMap()'), true, ':out : le numéro des retraits')
    assert.equal(avec.includes('if (prev && node._mjs_anim_mode === \'shared\')'), true, ':out : et la reprise d\'une transition partagée')
  })

  it('cœur de développement : la même règle', async () => {
    const sans = await coeur(':attach', SANS[':attach'], 'dev')
    assert.equal(sans.includes('_mjs_outRows'), false, ':attach : rien du retour des lignes')
    assert.equal(sans.includes('<exit-reverse>'), false, ':attach : le bloc balisé est retiré')
    const avec = await coeur(':transition', AVEC[':transition'], 'dev')
    assert.equal(avec.includes('const _mjs_outRows = new WeakMap()'), true, ':transition : le retour des lignes est au cœur')
  })
})
