// types : la variable d'une boucle du `<script>` sur un store typé (Civet `for f of $$flux` et `for f in $$flux`,
// JavaScript `for (const f of $$flux)`) écrit sous la règle du champ, comme la boucle CoffeeScript `for f in $$flux` :
// `f.id = 'zz'` dans un champ `int 0..100` est refusé, l'élément garde sa valeur, et une valeur permise est convertie
// (`'42'` → `42`). Développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<vars>
  $$fluxa { id: int 0..100 }[]
</vars>

<script>
$$fluxa = [{ id: 0 }, { id: 1 }]
@refus = ->
  for f of $$fluxa
    f.id = 'zz'
  return
@refusIn = ->
  for f in $$fluxa
    f.id = 'zz'
  return
@permis = ->
  for f of $$fluxa
    f.id = '42'
  return
@lu = -> JSON.stringify($$fluxa)
</script>

<p class="v">{JSON.stringify($$fluxa)}</p>
`

const JS = `<vars>
  $$fluxc { id: int 0..100 }[]
</vars>

<script lang="js">
$$fluxc = [{ id: 0 }, { id: 1 }]
@refus = function() { for (const f of $$fluxc) f.id = 'zz' }
@refusIn = function() { let f; for (f of $$fluxc) f.id = 'zz' }
@permis = function() { for (const f of $$fluxc) f.id = '42' }
@lu = function() { return JSON.stringify($$fluxc) }
</script>

<p class="v">{JSON.stringify($$fluxc)}</p>
`

const COFFEE = `<vars>
  $$fluxb { id: int 0..100 }[]
</vars>

<script lang="coffee">
$$fluxb = [{ id: 0 }, { id: 1 }]
@refus = ->
  for f in $$fluxb
    f.id = 'zz'
  return
@refusIn = ->
  for f from $$fluxb
    f.id = 'zz'
  return
@permis = ->
  for f in $$fluxb
    f.id = '42'
  return
@lu = -> JSON.stringify($$fluxb)
</script>

<p class="v">{JSON.stringify($$fluxb)}</p>
`

const BALISES = ['mjs-typ-boucle-civet', 'mjs-typ-boucle-js', 'mjs-typ-boucle-coffee']

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'typ-boucle-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'typ-boucle-js.mjs'), JS)
  writeFileSync(join(srcDir, 'typ-boucle-coffee.mjs'), COFFEE)
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

describe('types : la variable d\'une boucle Civet ou JavaScript du script écrit sous la règle du champ', function () {
  this.timeout(240000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('typ-boucle', false)
    codes.prod = await construire('typ-boucle-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    it(`${mode} : 'zz' refusé dans un champ int 0..100, '42' converti, pour les trois langues`, async () => {
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
          const n = msgs.length
          q(b).refus()
          q(b).refusIn()
          const apresRefus = q(b).lu()
          const avertis    = msgs.slice(n).filter((m) => m.includes("refuse 'zz'")).length
          q(b).permis()
          await pause(60)
          releves.push(`${b} : refus=${apresRefus} avis=${avertis} permis=${q(b).lu()} vue=${q(b)._shadow.querySelector('.v').textContent}`)
        }
        console.log(`      ${releves.join('\n      ')}`)
        for (const b of BALISES) {
          const r = releves.find((l) => l.startsWith(b + ' '))!
          assert.match(r, /refus=\[\{"id":0\},\{"id":1\}\]/, r)
          assert.match(r, /permis=\[\{"id":42\},\{"id":42\}\] vue=\[\{"id":42\},\{"id":42\}\]/, r)
          if (!prod) assert.doesNotMatch(r, /avis=0 /, r)
        }
      }
      finally {
        window.close()
      }
    })
  }
})
