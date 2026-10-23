// *crossfade : en développement, une pose d'un groupe qui écrit d'autres réglages que sa première pose est signalée (une fois par
// groupe). Cet avertissement est du développement : la production n'en porte ni l'appel, ni la clé, ni le texte, en aucune langue — la
// vérification ne servirait à rien, `µ.instances` n'y existe pas. Le développement envoie le fichier en entier : l'appel y est.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PAGE   = '<script>\n$l = [{ id: 1 }, { id: 2 }]\n$m = [{ id: 3 }]\n</script>\n<ul>{for x in $l by id}<li @transition=*crossfade(key: x.id, group: g)>{x.id}</li>{end}</ul>\n<ul>{for x in $m by id}<li @transition=*crossfade(key: x.id, group: g, duration: 900ms)>{x.id}</li>{end}</ul>\n'
const AVIS   = 'crossfadeGroup'
const TEXTES = ['garde les réglages de sa première pose', 'keeps the settings of its first placement']

describe('effets — *crossfade, l\'avertissement du groupe ne part pas en production', function () {
  this.timeout(600000)
  after(async () => { await terminateSharedWorkerPool() })

  // un build RÉEL : tout ce qu'il écrit (les .js, les catalogues de messages .json, le manifeste), le code lisible ou minifié
  async function construire(nom: string, env: 'dev' | 'prod', minify: boolean): Promise<string> {
    const root   = mjsTmp('crossfade-avis-' + nom)
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
    const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js') || f.endsWith('.json')).map((f) => readFileSync(join(outDir, f), 'utf-8'))
    if (existsSync(join(root, 'bundle.js'))) fichiers.push(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    return fichiers.join('\n')
  }

  for (const minify of [false, true]) {
    it(`production ${minify ? 'minifiée' : 'lisible'} : ni l'appel, ni la clé, ni le texte ; la transition est là`, async () => {
      const sortie = await construire(`prod-${minify}`, 'prod', minify)
      assert.ok(sortie.includes('mjsxf-'), 'témoin : la paire de *crossfade est bien dans la sortie')
      assert.equal(sortie.includes(AVIS), false, 'la clé de l\'avertissement est du développement')
      for (const t of TEXTES) assert.equal(sortie.includes(t), false, `« ${t}… » est du développement`)
    })
  }

  it('le développement envoie le fichier en entier : l\'appel et le texte', async () => {
    const sortie = await construire('dev', 'dev', false)
    assert.ok(sortie.includes('µ._mjs_msg(\'dev.' + AVIS + '\''), 'l\'appel')
    for (const t of TEXTES) assert.ok(sortie.includes(t), `développement : le texte « ${t}… » est au manifeste`)
  })
})
