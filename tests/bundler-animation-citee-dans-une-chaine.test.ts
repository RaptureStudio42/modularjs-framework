// Un `µ.anim.x` écrit dans une chaîne ou un commentaire du script d'un composant comptait comme un usage : la
// détection par l'AST tournait sur le JS brut du composant, qui échoue toujours au parse (marqueur d'asset non résolu),
// et le repli par motif lisait le texte. Faux avertissement « Animation inconnue », ou animation embarquée pour rien.
// Un vrai appel reste vu.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

async function construire(nom: string, fichiers: Record<string, string>) {
  const root = mjsTmp(nom)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const [f, texte] of Object.entries(fichiers)) writeFileSync(join(src, f), texte)
  const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js') } as any)
  const s = await b.compile()
  await b.close()
  return { s, anims: readdirSync(out).filter(f => f.startsWith('mjs_anims-') && f.endsWith('.js')) }
}

describe('animations : un nom cité dans une chaîne n\'est pas un usage', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('µ.anim.x dans une chaîne : aucun avertissement, aucun fichier d\'animations', async () => {
    const { s, anims } = await construire('anim-chaine', {
      'a.mjs': "<script>\n  µ.log('voir µ.anim.zoomzoom dans la doc')\n</script>\n<p>a</p>\n",
      'b.mjs': "<script>\n  aide = 'exemple : µ.anim.fade(el)'\n</script>\n<p>{aide}</p>\n",
    })
    assert.equal(s.errors.length, 0, s.errors.map((e: any) => e.message).join('\n'))
    assert.deepEqual(s.warnings.filter((w: string) => w.includes('zoomzoom')), [])
    assert.deepEqual(anims, [])
  })

  it('vrai appel µ.anim.fade : l\'animation est embarquée', async () => {
    const { s, anims } = await construire('anim-appel', {
      'c.mjs': "<script>\n  montrer = (el) -> µ.anim.fade(el)\n</script>\n<p @click={montrer}>c</p>\n",
    })
    assert.equal(s.errors.length, 0, s.errors.map((e: any) => e.message).join('\n'))
    assert.equal(anims.length, 1)
  })
})
