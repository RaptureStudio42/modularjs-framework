// Effets : en développement, une valeur de réglage tenue par une variable et ramenée à sa plage, ou refusée, est signalée
// (`*neon : size = … ramené à …`). Cet avis est du développement : le code de production d'une appli qui pose un effet n'en porte ni
// l'appel, ni la clé, ni le texte, en aucune langue — il ne s'y écrirait jamais, le réglage des types n'y existe pas. Le catalogue
// des messages de la production reste complet, comme pour tous les autres messages. Le développement envoie le moteur en entier.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PAGE   = '<script>\n$s = 3\n</script>\n<p class="t" *neon(size: $s)>Bonjour</p>\n'
const CLES   = ['fxRefused', 'fxBrought']
const TEXTES = ['refusé, valeur par défaut', 'ramené à {to}', 'refused, default value', 'brought back to {to}']

describe('effets — l\'avis d\'une valeur ramenée ou refusée ne part pas en production', function () {
  this.timeout(600000)
  after(async () => { await terminateSharedWorkerPool() })

  // un build RÉEL : le code qu'il écrit (les .js et le manifeste), lisible ou minifié
  async function construire(nom: string, env: 'dev' | 'prod', minify: boolean): Promise<string> {
    const root   = mjsTmp('valeur-refusee-avis-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'p.mjs'), PAGE)
    const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify }
    if (env === 'prod') options.env = 'prod'
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8'))
    if (existsSync(join(root, 'bundle.js'))) fichiers.push(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    return fichiers.join('\n')
  }

  for (const minify of [false, true]) {
    it(`production ${minify ? 'minifiée' : 'lisible'} : ni l'appel, ni la clé, ni le texte ; l'effet est là`, async () => {
      const sortie = await construire(`prod-${minify}`, 'prod', minify)
      assert.ok(sortie.includes('neon'), 'témoin : *neon est bien dans la sortie')
      for (const c of CLES) assert.equal(sortie.includes(c), false, `la clé ${c} est du développement`)
      for (const t of TEXTES) assert.equal(sortie.includes(t), false, `« ${t} » est du développement`)
    })
  }

  it('le développement envoie le moteur en entier : les deux appels', async () => {
    const sortie = await construire('dev', 'dev', false)
    for (const c of CLES) assert.ok(sortie.includes('µ._mjs_msg(\'' + c + '\''), `l'appel de ${c}`)
  })
})
