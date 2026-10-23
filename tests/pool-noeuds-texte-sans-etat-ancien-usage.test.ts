// un nœud texte rendu au pool (`µ._mjs_recycleTextLeaves`) puis servi de nouveau (`µ._mjs_getTextNode`) ne porte plus rien de son ancien usage : ni le choix d'un `{if}`
// (`_mjs_old_branch`), ni la clé d'un `{key}` (`_mjs_old_key`) ni son repère de clé posée (`_mjs_key_set`), trois repères de bloc que le code émis pose sur l'ancre elle-même. Un bloc construit sur ce nœud lirait sinon un choix
// qui n'est pas le sien. La remise à zéro se fait au service, pas au retour : une écriture tardive pendant le sommeil du nœud dans le pool (l'effet d'une branche détruite qui
// tient encore son ancre) ne survit pas non plus.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// `runtime: ['textpool']` : le composant d'essai n'émet jamais `._mjs_getTextNode(` lui-même, le pool est demandé au bundler
async function charger() {
  const root   = mjsTmp('pool-etat')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'pool-etat.mjs'), '<script>$show = true</script>\n{if $show}<p>x</p>{end}\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtime: ['textpool'] })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const window = new Window({ url: 'http://localhost/' })
  const files  = readdirSync(outDir)
  const coeur  = files.find((f) => /^mjs_core-/.test(f))
  const comp   = files.find((f) => /^pool-etat-/.test(f))
  assert.ok(coeur && comp)
  const sansEsm = (s: string) => s
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/\bexport\s+default\s+/g, '')
    .replace(/\bexport\s+/g, '')
    .replace(/import\.meta\.url/g, "'http://localhost/'")
  window.eval(`${sansEsm(readFileSync(join(outDir, coeur!), 'utf-8'))}\nglobalThis.µ = µ;\n${sansEsm(readFileSync(join(outDir, comp!), 'utf-8'))}`)
  return window
}

describe('pool de nœuds texte — un nœud servi ne porte rien de son ancien usage', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le choix d\'un {if} et la clé d\'un {key} ne suivent pas le nœud réattribué', async () => {
    const window = await charger()
    const lu = window.eval(`(() => {
      const p = document.createElement('p')
      const t = document.createTextNode('x')
      t._mjs_old_branch = 2
      t._mjs_old_key    = 'k'
      t._mjs_key_set    = 1
      p.appendChild(t)
      µ._mjs_recycleTextLeaves(p)
      const n = µ._mjs_getTextNode('')
      return { meme: n === t, branche: n._mjs_old_branch, cle: n._mjs_old_key, pose: n._mjs_key_set, pooled: n._mjs_pooled, data: n.data }
    })()`)
    assert.equal(lu.meme, true, 'le nœud servi est celui qui vient d\'être rendu au pool (le test lui-même est à revoir sinon)')
    assert.equal(lu.branche, undefined, 'le choix d\'un {if} reste sur le nœud réattribué')
    assert.equal(lu.cle, undefined, 'la clé d\'un {key} reste sur le nœud réattribué')
    assert.equal(lu.pose, undefined, 'le repère de clé posée d\'un {key} reste sur le nœud réattribué (un {key} de valeur undefined ne construirait rien)')
    assert.equal(lu.pooled, false)
    assert.equal(lu.data, '')
  })

  it('une écriture tardive pendant le sommeil du nœud dans le pool est effacée au service', async () => {
    const window = await charger()
    const lu = window.eval(`(() => {
      const p = document.createElement('p')
      const t = document.createTextNode('x')
      p.appendChild(t)
      µ._mjs_recycleTextLeaves(p)
      t._mjs_old_branch = 3
      t._mjs_old_key    = 'tard'
      t._mjs_key_set    = 1
      const n = µ._mjs_getTextNode('')
      return { meme: n === t, branche: n._mjs_old_branch, cle: n._mjs_old_key, pose: n._mjs_key_set }
    })()`)
    assert.equal(lu.meme, true)
    assert.equal(lu.branche, undefined)
    assert.equal(lu.cle, undefined)
    assert.equal(lu.pose, undefined)
  })

  it('un nœud sans état est servi comme avant : texte demandé ou vide, drapeau levé', async () => {
    const window = await charger()
    const lu = window.eval(`(() => {
      const p = document.createElement('p')
      p.appendChild(document.createTextNode('a'))
      p.appendChild(document.createTextNode('b'))
      µ._mjs_recycleTextLeaves(p)
      const vide    = µ._mjs_getTextNode('')
      const demande = µ._mjs_getTextNode('salut')
      const neuf    = µ._mjs_getTextNode('neuf')
      return { vide: vide.data, demande: demande.data, pooledVide: vide._mjs_pooled, pooledDemande: demande._mjs_pooled, neuf: neuf.data, type: neuf.nodeType }
    })()`)
    // l'objet vient du monde de happy-dom : sa comparaison profonde passe par le texte
    assert.deepEqual(JSON.parse(JSON.stringify(lu)), { vide: '', demande: 'salut', pooledVide: false, pooledDemande: false, neuf: 'neuf', type: 3 })
  })
})
