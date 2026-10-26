// magasin `$$` : les éléments qu'une copie retire par `splice` (`copie.splice(0, 1)[0]`, une variable qui les tient, une
// boucle sur eux) restent des objets du magasin, comme l'élément d'une copie atteint par `pop` ou `shift` : une écriture
// par eux passe par l'aide gardée — une clé `'__proto__'` venue de données ne pollue pas `Object.prototype`,
// l'avertissement nomme le segment en développement — et une écriture permise prévient la clé du store (vue en
// développement). Civet,
// CoffeeScript et JavaScript, développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $$sliste = [{ id: 1 }, { id: 2 }, { id: 3 }]
  @spliceCopie = (s, k) ->
    copie := $$sliste.slice()
    copie.splice(0, 1)[0][s][k] = 1
    return
  @spliceVariable = (s, k) ->
    copie := $$sliste.slice()
    retires := copie.splice(1, 1)
    retires[0][s][k] = 1
    return
  @spliceBoucle = (s, k) ->
    copie := $$sliste.slice()
    for t of copie.splice(0, 2)
      t[s][k] = 1
    return
  @ecrireRetire = ->
    copie := $$sliste.slice()
    copie.splice(2, 1)[0].m = 4
    return
</script>
<p class="n">{$$sliste.length}</p>
`

const COFFEE = `<script lang="coffee">
  $$cliste = [{ id: 1 }, { id: 2 }, { id: 3 }]
  @spliceCopie = (s, k) ->
    copie = $$cliste.slice()
    copie.splice(0, 1)[0][s][k] = 1
    return
  @spliceVariable = (s, k) ->
    copie = $$cliste.slice()
    retires = copie.splice(1, 1)
    retires[0][s][k] = 1
    return
  @spliceBoucle = (s, k) ->
    copie = $$cliste.slice()
    for t in copie.splice(0, 2)
      t[s][k] = 1
    return
  @ecrireRetire = ->
    copie = $$cliste.slice()
    copie.splice(2, 1)[0].m = 4
    return
</script>
<p class="n">{$$cliste.length}</p>
`

const JS = `<script lang="js">
  $$jliste = [{ id: 1 }, { id: 2 }, { id: 3 }]
  @spliceCopie = function(s, k) { const copie = $$jliste.slice(); copie.splice(0, 1)[0][s][k] = 1 }
  @spliceVariable = function(s, k) { const copie = $$jliste.slice(); const retires = copie.splice(1, 1); retires[0][s][k] = 1 }
  @spliceBoucle = function(s, k) { const copie = $$jliste.slice(); for (const t of copie.splice(0, 2)) t[s][k] = 1 }
  @ecrireRetire = function() { const copie = $$jliste.slice(); copie.splice(2, 1)[0].m = 4 }
</script>
<p class="n">{$$jliste.length}</p>
`

const FORMES: [string, string, string, string][] = [['Civet', 'garde-splice-civet', CIVET, 'sliste'], ['CoffeeScript', 'garde-splice-coffee', COFFEE, 'cliste'], ['JavaScript', 'garde-splice-js', JS, 'jliste']]
const METHODES = ['spliceCopie', 'spliceVariable', 'spliceBoucle']
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function construire(prod: boolean): Promise<string> {
  const root   = mjsTmp('garde-splice')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [, nom, source] of FORMES) writeFileSync(join(srcDir, nom + '.mjs'), source)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

describe('magasin $$ : l\'élément qu\'une copie retire par splice refuse le prototype', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    const mode = prod ? 'production' : 'développement'
    it(`${mode} : aucune forme n'écrit dans Object.prototype ; une écriture permise prévient la clé du store`, async () => {
      const code = await construire(prod)
      const window: any = new Window({ url: 'http://localhost/' })
      const avis: string[] = []
      window.eval(prod ? code : `${code}\nglobalThis.µ = µ;`)
      if (!prod) window.µ.warn = (m: string) => avis.push(String(m))
      window.document.body.innerHTML = FORMES.map(([, b]) => `<mjs-${b}></mjs-${b}>`).join('')
      const q   = (b: string) => window.document.querySelector(`mjs-${b}`)
      const fin = Date.now() + 3000
      while (!FORMES.every(([, b]) => q(b)._shadow?.querySelector('.n')) && Date.now() < fin) await pause(10)
      await pause(40)
      const fautes: string[] = []
      try {
        for (const [langue, balise, , cle] of FORMES) {
          for (const m of METHODES) {
            const k = `pollu_splice_${langue}_${m}`
            const n = avis.length
            let leve = ''
            try {
              q(balise)[m]('__proto__', k)
            }
            catch (e: any) {
              leve = ` (lève ${String(e?.message).slice(0, 60)})`
            }
            if (window.eval(`Object.prototype.hasOwnProperty(${JSON.stringify(k)})`)) fautes.push(`${langue} ${m} : Object.prototype pollué`)
            if (leve) fautes.push(`${langue} ${m}${leve}`)
            if (!prod && avis.length === n) fautes.push(`${langue} ${m} : sans avertissement`)
          }
          // écriture permise : la clé du store est prévenue (espion sur l'aide qui la prévient ; `µ` n'est exposé qu'en développement)
          if (prod) continue
          const vues: string[] = []
          const avant = window.µ._mjs_storeNotifyKey
          window.µ._mjs_storeNotifyKey = function (c: string) { vues.push(c); return avant.call(this, c) }
          try { q(balise).ecrireRetire() }
          finally { window.µ._mjs_storeNotifyKey = avant }
          if (vues.join() !== cle) fautes.push(`${langue} ecrireRetire : clés prévenues ${JSON.stringify(vues)}`)
        }
      }
      finally {
        window.eval(`for (const p of Object.getOwnPropertyNames(Object.prototype)) if (p.startsWith('pollu_')) delete Object.prototype[p]`)
        window.close()
      }
      assert.deepEqual(fautes, [])
    })
  }
})
