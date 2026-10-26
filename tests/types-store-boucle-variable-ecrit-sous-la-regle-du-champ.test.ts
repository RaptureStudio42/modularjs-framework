// Types — la variable d'un {for} sur un STORE typé est l'élément même de la liste, et elle écrit sous la règle du champ :
// `f.id = 'zz'` sur un champ `int 0..100` est refusé, avec le message de l'écriture par le store, et l'élément garde sa
// valeur d'avant ; une valeur permise (`f.id = 5`) s'écrit. Relire l'élément reste exact (`indexOf` le retrouve,
// `structuredClone(f.tags)` passe). Écrire par le store (`$$flux[1].id = 'zz'`) est refusé de même.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SRC = [
  '<vars>',
  '  $$flux { id: int 0..100, tags: string[] }[]',
  '</vars>',
  '',
  '<script>',
  '$$flux = [{ id: 0, tags: [] }, { id: 1, tags: [] }]',
  'selectionner = (o) ->',
  '  try',
  '    µ.__essai = { indice: $$flux.indexOf(o), tags: structuredClone(o.tags) }',
  '  catch e',
  '    µ.__essai = { erreur: String(e) }',
  '</script>',
  '',
  '<ul>',
  '{for f in $$flux}',
  '<li class="f"><span class="v">{f.id}</span>',
  '<button class="ecrit" @click={f.id = \'zz\'}>ecrit</button>',
  '<button class="permis" @click={f.id = 5}>permis</button>',
  '<button class="range" @click={selectionner(f)}>range</button>',
  '<button class="store" @click={$$flux[1].id = \'zz\'}>store</button>',
  '</li>',
  '{end}',
  '</ul>',
].join('\n')

let code = ''

before(async function() {
  this.timeout(120000)
  const root   = mjsTmp('store-boucle-variable-regle')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'flux.mjs'), SRC)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'dev' } as any)
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  code = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'), { bridgeCore: true })).join('\n')
})

after(async () => { await terminateSharedWorkerPool() })

async function cliquer(bouton: string): Promise<{ messages: string[], id: any, essai: any }> {
  const window: any = new Window({ url: 'http://localhost/' })
  const msgs: string[] = []
  window.structuredClone = structuredClone
  window.eval(`${code}\nglobalThis.µ = µ;`)
  window.µ._typesMode = 'warn'
  window.µ.warn = (m: string) => msgs.push(m)
  window.document.body.innerHTML = '<mjs-flux></mjs-flux>'
  const comp = window.document.querySelector('mjs-flux')
  const fin  = Date.now() + 5000
  while (Date.now() < fin && comp._shadow?.querySelectorAll('.f').length !== 2) await new Promise((r) => setTimeout(r, 10))
  comp._shadow.querySelectorAll('.f')[1].querySelector('.' + bouton).dispatchEvent(new window.Event('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 60))
  const r = { messages: msgs.slice(), id: window.µ._mjs_toRaw(window.µ._mjs_storeRaw.flux[1]).id, essai: window.µ.__essai }
  window.close?.()
  return r
}

describe('types — variable d’un {for} sur un store typé : l’élément de la liste, écriture sous la règle du champ', function() {
  this.timeout(60000)

  it('f.id = zz est refusé : l’élément garde sa valeur d’avant, avec le message de l’écriture par le store', async () => {
    const r = await cliquer('ecrit')
    assert.equal(r.id, 1)
    assert.ok(r.messages.some((m) => m.includes("$$flux[1].id refuse 'zz'")), r.messages.join(' | '))
  })

  it('f.id = 5, une valeur permise, s’écrit sans message', async () => {
    const r = await cliquer('permis')
    assert.equal(r.id, 5)
    assert.deepEqual(r.messages, [])
  })

  it('selectionner(f) reçoit l’élément de la liste (indexOf juste) et structuredClone(f.tags) passe', async () => {
    const r = await cliquer('range')
    assert.deepEqual(r.messages, [])
    assert.equal(r.essai?.erreur, undefined)
    assert.equal(r.essai.indice, 1)
    assert.deepEqual(r.essai.tags, [])
  })

  it('écrire par le store ($$flux[1].id = zz) est refusé, la valeur d’avant reste', async () => {
    const r = await cliquer('store')
    assert.equal(r.id, 1)
    assert.ok(r.messages.some((m) => m.includes("$$flux[1].id refuse 'zz'")), r.messages.join(' | '))
  })
})
