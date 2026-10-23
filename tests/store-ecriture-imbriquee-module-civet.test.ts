// Une écriture imbriquée d'un store `$$` (`$$droits.compte.n = 5`) faite depuis un module Civet importé
// prévient les lecteurs du store, comme la même écriture faite dans un composant `.mjs`

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await pause(10)
}

async function monter(prefixe: string, fichiers: Record<string, string>) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(fichiers)) {
    mkdirSync(join(srcDir, nom, '..'), { recursive: true })
    writeFileSync(join(srcDir, nom), source)
  }
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  return window
}

const QUOTAS = `export poseImbrique = (n) ->
  $$droits.compte.n = n

export incremente = ->
  $$droits.compte.n += 2

export ajoute = (x) ->
  $$droits.compte.liste.push(x)

export poseEntier = (n) ->
  $$droits = Object.assign({}, $$droits, { compte: { n: n, liste: [] } })
`

const LECTEUR = `@import poseImbrique 'quota-store.civet'
@import poseEntier 'quota-store.civet'
@import incremente 'quota-store.civet'
@import ajoute 'quota-store.civet'

<script>
  $$droits = { compte: { n: 0, liste: [] } }
  @incr   = -> incremente()
  @ajout  = (x) -> ajoute(x)
  @civet  = (n) -> poseImbrique(n)
  @entier = (n) -> poseEntier(n)
  @mjs    = (n) -> $$droits.compte.n = n
</script>

<p class="n">{$$droits.compte.n}</p>
<p class="l">{$$droits.compte.liste.join(',')}</p>
`

describe('store $$ : écriture imbriquée depuis un module Civet importé', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const [mode, valeur] of [['mjs', 3], ['civet', 5], ['entier', 7]] as const) {
    it(`écriture « ${mode} » : le lecteur du store est prévenu`, async () => {
      const window = await monter('store-imbrique-' + mode, { 'quota-store.civet': QUOTAS, 'lecteur-droits.mjs': LECTEUR })
      try {
        window.document.body.innerHTML = '<mjs-lecteur-droits></mjs-lecteur-droits>'
        const c = window.document.querySelector('mjs-lecteur-droits')
        const texte = () => c._shadow?.querySelector('.n')?.textContent
        await attendre(() => texte() === '0')
        window.eval(`document.querySelector('mjs-lecteur-droits').${mode === 'mjs' ? 'mjs' : mode === 'civet' ? 'civet' : 'entier'}(${valeur})`)
        await pause(60)
        assert.equal(texte(), String(valeur), `affiché après écriture ${mode} (${texte()})`)
      }
      finally {
        window.close()
      }
    })
  }

  it('opérateur composé et méthode mutative d\'un module Civet préviennent aussi le lecteur', async () => {
    const window = await monter('store-imbrique-composes', { 'quota-store.civet': QUOTAS, 'lecteur-droits.mjs': LECTEUR })
    try {
      window.document.body.innerHTML = '<mjs-lecteur-droits></mjs-lecteur-droits>'
      const c = window.document.querySelector('mjs-lecteur-droits')
      const texte = (s: string) => c._shadow?.querySelector(s)?.textContent
      await attendre(() => texte('.n') === '0')
      c.incr()
      c.ajout('a')
      await pause(60)
      assert.equal(texte('.n'), '2', `+= affiché (${texte('.n')})`)
      assert.equal(texte('.l'), 'a', `push affiché (${texte('.l')})`)
    }
    finally {
      window.close()
    }
  })
})
