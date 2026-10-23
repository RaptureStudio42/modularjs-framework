// magasin `$$` — une écriture à travers un objet (variable qui le garde, élément trouvé, chemin) prévient la clé
// racine ET les clés qui rangent l'OBJET ÉCRIT : `$$pb = $$pa`, puis `sb := $$pa`, `$$pa = { x: 100 }`, `sb.x = 12`
// écrit l'ancien objet, celui que range encore `pb` — son lecteur suit ; `$$autre = $$cfg.a`, puis une écriture dans
// `$$cfg.a` (par une variable, par le chemin, `delete`), ou sous lui par le chemin (`$$cfg.a.l.push(x)`) — le lecteur
// de `$$autre` suit ; en Civet et en CoffeeScript, en développement comme en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'm2-ecrit.mjs': `<script>
  $$pa = { x: 1 }
  $$pb = $$pa
  $$la = [0]
  $$lb = $$la
  $$cfg = { a: { b: 0, l: [] } }
  $$autre = $$cfg.a
  @parAlias = ->
    sb := $$pa
    $$pa = { x: 100 }
    sb.x = 12
  @methodeAlias = ->
    sl := $$la
    $$la = [9]
    sl.push(1)
  @sousAlias = ->
    sous := $$cfg.a
    sous.b = 1
  @sousChemin = -> $$cfg.a.b = 2
  @sousMethode = -> $$cfg.a.l.push(3)
  @sousEfface = ->
    se := $$cfg.a
    delete se.b
</script>

<p class="etat">{JSON.stringify($$pa)} {JSON.stringify($$la)} {JSON.stringify($$cfg)}</p>
`,
  'm2-ecrit-coffee.mjs': `<script lang="coffee">
$$qa = { x: 1 }
$$qb = $$qa
@parAlias = ->
  sq = $$qa
  $$qa = { x: 100 }
  sq.x = 12
</script>

<p class="etat">{JSON.stringify($$qa)}</p>
`,
  'm2-lit-pb.mjs': `<p class="v">{JSON.stringify($$pb)}</p>
`,
  'm2-lit-lb.mjs': `<p class="v">{JSON.stringify($$lb)}</p>
`,
  'm2-lit-autre.mjs': `<p class="v">{JSON.stringify($$autre)}</p>
`,
  'm2-lit-qb.mjs': `<p class="v">{JSON.stringify($$qb)}</p>
`,
}
const BALISES = ['mjs-m2-ecrit', 'mjs-m2-ecrit-coffee', 'mjs-m2-lit-pb', 'mjs-m2-lit-lb', 'mjs-m2-lit-autre', 'mjs-m2-lit-qb']

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

describe('magasin $$ : une écriture à travers un objet prévient les clés qui rangent l\'objet écrit', function () {
  this.timeout(180000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('cles-objet-ecrit', false)
    codes.prod = await construire('cles-objet-ecrit-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    it(`${mode === 'dev' ? 'développement' : 'production'} : le lecteur d'une autre clé qui range l'objet écrit suit, par une variable, par le chemin, par une méthode, par delete`, async () => {
      const window: any = new Window({ url: 'http://localhost/' })
      try {
        window.eval(codes[mode])
        window.document.body.innerHTML = BALISES.map((b) => `<${b}></${b}>`).join('')
        const el    = (b: string) => window.document.querySelector(b)
        const texte = (b: string, s = '.v') => el(b)._shadow?.querySelector(s)?.textContent
        const fin   = Date.now() + 3000
        while (!BALISES.every((b) => texte(b, b.includes('ecrit') ? '.etat' : '.v')?.trim()) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
        const pause = () => new Promise((r) => setTimeout(r, 40))
        assert.equal(texte('mjs-m2-lit-pb'), '{"x":1}')
        el('mjs-m2-ecrit').parAlias()
        await pause()
        assert.equal(texte('mjs-m2-lit-pb'), '{"x":12}', '$$pb = $$pa, puis l\'alias de l\'ancien objet de pa l\'écrit')
        el('mjs-m2-ecrit').methodeAlias()
        await pause()
        assert.equal(texte('mjs-m2-lit-lb'), '[0,1]', 'méthode par l\'alias de l\'ancien objet')
        el('mjs-m2-ecrit').sousAlias()
        await pause()
        assert.equal(texte('mjs-m2-lit-autre'), '{"b":1,"l":[]}', '$$autre = $$cfg.a, écrit par une variable')
        el('mjs-m2-ecrit').sousChemin()
        await pause()
        assert.equal(texte('mjs-m2-lit-autre'), '{"b":2,"l":[]}', 'écrit par le chemin')
        el('mjs-m2-ecrit').sousMethode()
        await pause()
        assert.equal(texte('mjs-m2-lit-autre'), '{"b":2,"l":[3]}', 'méthode par le chemin')
        el('mjs-m2-ecrit').sousEfface()
        await pause()
        assert.equal(texte('mjs-m2-lit-autre'), '{"l":[3]}', 'delete par une variable')
        el('mjs-m2-ecrit-coffee').parAlias()
        await pause()
        assert.equal(texte('mjs-m2-lit-qb'), '{"x":12}', 'CoffeeScript')
        assert.equal(texte('mjs-m2-ecrit', '.etat'), '{"x":100} [9] {"a":{"l":[3]}}')
      }
      finally {
        window.close()
      }
    })
  }
})
