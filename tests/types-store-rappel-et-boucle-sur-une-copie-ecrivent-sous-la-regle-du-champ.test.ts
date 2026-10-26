// types : le paramètre d'un rappel sur un store typé (`$$flux.forEach((f) -> f.id = 'zz')`), la variable d'une boucle
// sur une copie (`for f of $$flux.filter(…)`) et l'élément d'une copie (`$$flux.slice()[0].id = 'zz'`) écrivent sous la
// règle du champ, dans les trois langues : `'zz'` dans un champ `int 0..100` est refusé, l'élément garde sa valeur, et
// une valeur permise est convertie (`'42'` → `42`) puis redessinée. Développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<vars>
  $$trappa { id: int 0..100 }[]
</vars>

<script>
$$trappa = [{ id: 0 }, { id: 1 }]
@refusRappel = ->
  $$trappa.forEach((f) -> f.id = 'zz')
  return
@refusCopie = ->
  for g of $$trappa.filter((x) -> true)
    g.id = 'zz'
  return
@refusIndice = ->
  $$trappa.slice()[0].id = 'zz'
  return
@permisRappel = ->
  $$trappa.forEach((f) -> f.id = '42')
  return
@permisCopie = ->
  for g of Array.from($$trappa)
    g.id = '43'
  return
@lu = -> JSON.stringify($$trappa)
</script>

<p class="v">{JSON.stringify($$trappa)}</p>
`

const JS = `<vars>
  $$trappc { id: int 0..100 }[]
</vars>

<script lang="js">
$$trappc = [{ id: 0 }, { id: 1 }]
@refusRappel = function() { $$trappc.forEach((f) => { f.id = 'zz' }) }
@refusCopie = function() { for (const g of $$trappc.filter(() => true)) g.id = 'zz' }
@refusIndice = function() { $$trappc.slice()[0].id = 'zz' }
@permisRappel = function() { $$trappc.forEach(function (f) { f.id = '42' }) }
@permisCopie = function() { for (const g of [...$$trappc]) g.id = '43' }
@lu = function() { return JSON.stringify($$trappc) }
</script>

<p class="v">{JSON.stringify($$trappc)}</p>
`

const COFFEE = `<vars>
  $$trappb { id: int 0..100 }[]
</vars>

<script lang="coffee">
$$trappb = [{ id: 0 }, { id: 1 }]
@refusRappel = ->
  $$trappb.forEach (f) -> f.id = 'zz'
  return
@refusCopie = ->
  for g in $$trappb.filter((x) -> true)
    g.id = 'zz'
  return
@refusIndice = ->
  $$trappb.slice()[0].id = 'zz'
  return
@permisRappel = ->
  $$trappb.forEach (f) -> f.id = '42'
  return
@permisCopie = ->
  for g in $$trappb.slice()
    g.id = '43'
  return
@lu = -> JSON.stringify($$trappb)
</script>

<p class="v">{JSON.stringify($$trappb)}</p>
`

const BALISES = ['mjs-typ-rappel-civet', 'mjs-typ-rappel-js', 'mjs-typ-rappel-coffee']

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'typ-rappel-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'typ-rappel-js.mjs'), JS)
  writeFileSync(join(srcDir, 'typ-rappel-coffee.mjs'), COFFEE)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'), { bridgeCore: true } as any)).join('\n')
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('types : le paramètre d\'un rappel et la variable d\'une boucle sur une copie écrivent sous la règle du champ', function () {
  this.timeout(240000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('typ-rappel', false)
    codes.prod = await construire('typ-rappel-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    it(`${mode} : 'zz' refusé dans un champ int 0..100 par un rappel, une copie, l'élément d'une copie ; '42' et '43' convertis et redessinés, pour les trois langues`, async () => {
      const prod   = mode === 'prod'
      const window: any = new Window({ url: 'http://localhost/' })
      const msgs: string[] = []
      try {
        window.eval(prod ? codes.prod : `${codes.dev}\nglobalThis.µ = µ;`)
        if (!prod) {
          window.µ._typesMode = 'warn'
          window.µ.warn = (m: string) => msgs.push(String(m))
        }
        window.document.body.innerHTML = BALISES.map((b) => `<${b}></${b}>`).join('')
        const q   = (b: string) => window.document.querySelector(b)
        const fin = Date.now() + 3000
        while (!BALISES.every((b) => q(b)._shadow?.querySelector('.v')) && Date.now() < fin) await pause(10)
        await pause(60)
        const releves: string[] = []
        for (const b of BALISES) {
          const refus: string[] = []
          for (const m of ['refusRappel', 'refusCopie', 'refusIndice']) {
            const n = msgs.length
            q(b)[m]()
            refus.push(`${m}=${q(b).lu()} avis=${msgs.slice(n).filter((x) => x.includes("refuse 'zz'")).length}`)
          }
          q(b).permisRappel()
          await pause(60)
          const rappel = `${q(b).lu()} vue=${q(b)._shadow.querySelector('.v').textContent}`
          q(b).permisCopie()
          await pause(60)
          releves.push(`${b} : ${refus.join(' ')} permisRappel=${rappel} permisCopie=${q(b).lu()} vue=${q(b)._shadow.querySelector('.v').textContent}`)
        }
        console.log(`      ${releves.join('\n      ')}`)
        for (const b of BALISES) {
          const r = releves.find((l) => l.startsWith(b + ' '))!
          for (const m of ['refusRappel', 'refusCopie', 'refusIndice']) assert.match(r, new RegExp(`${m}=\\[\\{"id":0\\},\\{"id":1\\}\\]`), r)
          assert.match(r, /permisRappel=\[\{"id":42\},\{"id":42\}\] vue=\[\{"id":42\},\{"id":42\}\]/, r)
          assert.match(r, /permisCopie=\[\{"id":43\},\{"id":43\}\] vue=\[\{"id":43\},\{"id":43\}\]/, r)
          if (!prod) assert.doesNotMatch(r, /avis=0/, r)
        }
      }
      finally {
        window.close()
      }
    })
  }
})
