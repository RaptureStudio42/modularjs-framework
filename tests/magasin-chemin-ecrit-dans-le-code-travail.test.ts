// magasin `$$` — le travail d'une écriture profonde, compté (pas chronométré) : un chemin, que ses clés soient écrites
// dans le code (`$$o.a.b = i`) ou calculées (`$$o[k].b = i`), ne passe par aucune garde de clé, ne copie aucun chemin
// (`concat`), ne cherche dans l'index des objets partagés que les objets qu'il traverse sous la racine, et prévient la
// clé une fois

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SRC = `<script>
  $$o = { a: { b: 0, c: { d: 0 } } }
  @ecrit = (n) ->
    i .= 0
    while i < n
      $$o.a.b = i
      i++
    0
  @ecritProfond = (n) ->
    i .= 0
    while i < n
      $$o.a.c.d = i
      i++
    0
  @ecritCle = (n, k) ->
    i .= 0
    while i < n
      $$o[k].b = i + 1000
      i++
    0
</script>

<p class="v">{$$o.a.b} {$$o.a.c.d}</p>
`

async function construire(): Promise<string> {
  const root   = mjsTmp('chemin-rapide-travail')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'travail-ecrit.mjs'), SRC)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') } as any)
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

describe('magasin $$ : le travail d\'une écriture profonde, compté', function () {
  this.timeout(180000)
  let code = ''

  before(async function () {
    this.timeout(240000)
    code = await construire()
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('clés écrites dans le code ou calculées : aucune copie, une notification par écriture', async () => {
    const window: any = new Window({ url: 'http://localhost/' })
    try {
      window.eval(`${code}\nglobalThis.µ = µ;`)
      window.document.body.innerHTML = '<mjs-travail-ecrit></mjs-travail-ecrit>'
      const comp  = window.document.querySelector('mjs-travail-ecrit')
      const texte = () => comp._shadow?.querySelector('.v')?.textContent
      const fin   = Date.now() + 3000
      while (!texte() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      const µ = window.µ
      // compteurs posés après le montage : seules les boucles sont comptées
      const n = { copies: 0, index: 0, prevenues: 0 }
      const concat = window.Array.prototype.concat
      window.Array.prototype.concat = function(this: any, ...args: any[]) {
        n.copies++
        return concat.apply(this, args)
      }
      const idx = µ._mjs_storeIdx
      idx.has = function(o: any) {
        n.index++
        return window.WeakMap.prototype.has.call(idx, o)
      }
      const prevenir = µ._mjs_storeNotifyKey
      µ._mjs_storeNotifyKey = function(k: string) {
        n.prevenues++
        return prevenir(k)
      }
      const compter = (f: () => void) => {
        for (const k of Object.keys(n)) (n as any)[k] = 0
        f()
        return { ...n }
      }
      const N = 100
      try {
        assert.deepEqual(compter(() => comp.ecrit(N)), { copies: 0, index: 0, prevenues: N - 1 }, '$$o.a.b = i (la 1re écriture, 0, ne change rien)')
        assert.deepEqual(compter(() => comp.ecritProfond(N)), { copies: 0, index: N, prevenues: N - 1 }, '$$o.a.c.d = i : l\'objet `a`, traversé sous la racine, cherché dans l\'index')
        assert.deepEqual(compter(() => comp.ecritCle(N, 'a')), { copies: 0, index: 0, prevenues: N }, '$$o[k].b = i : la clé calculée lue comme JavaScript la lit')
      }
      finally {
        window.Array.prototype.concat = concat
      }
      await new Promise((r) => setTimeout(r, 40))
      assert.equal(texte(), `${1000 + N - 1} ${N - 1}`, 'les écritures sont faites et prévenues')
    }
    finally {
      window.close()
    }
  })
})
