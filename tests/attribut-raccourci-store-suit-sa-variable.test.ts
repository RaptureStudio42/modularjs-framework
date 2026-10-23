// Le raccourci `$$nom` (une variable de store, ou de thème, écrite sans accolades) dans le texte d'un attribut
// suit sa variable comme `{$$nom}` : `title="$$s"` et `title="a $$s b"` montrent la valeur du store et se mettent
// à jour quand elle change, ils ne restent plus le texte « $$s ». Ce qui n'est pas un raccourci reste du texte :
// un `$$` collé à un mot, après un point seul, ou suivi d'un chiffre.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function monter(prefixe: string, fichiers: Record<string, string>) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code   = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  return window
}

const ENTETE = `<script>
  $$s = 'a'
  $n  = 2
</script>
`

const PAGE = ENTETE + `<b class="c" title="$$s">x</b>
<b class="m" title="a $$s b">x</b>
<b class="d" title="$n et $$s">x</b>
<b class="p" title="{$$s}">x</b>
<input class="i" aria-label="i" placeholder="Pour $$s">
<b class="l1" title="a$$s">x</b>
<b class="l2" title="v1.$$s">x</b>
<b class="l3" title="5$$">x</b>
<b class="l4" title="$$9">x</b>
<button class="go" @click={$$s = 'z'}>go</button>
`

describe('raccourci $$nom dans un attribut : la vue suit le store', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('la valeur compilée est celle du store, pas le texte $$s', async () => {
    const { output } = await transpile(ENTETE + '<b title="$$s">x</b>\n<b title="a $$s b">y</b>\n', { moduleName: 'card' } as any)
    assert.ok(output.includes('`${µ.store.s}`'), 'title="$$s" lit µ.store.s : ' + output.split('\n').filter((l) => l.includes('title')).join(' | '))
    assert.ok(output.includes('`a ${µ.store.s} b`'), 'title="a $$s b" lit µ.store.s')
    assert.ok(!output.includes('`$$s`') && !output.includes('`a $$s b`'), 'plus de texte littéral $$s')
  })

  it('un $$ qui n\'est pas un raccourci reste du texte', async () => {
    const { output } = await transpile(ENTETE + '<b title="a$$s">x</b>\n<b title="v1.$$s">x</b>\n<b title="5$$">x</b>\n<b title="$$9">x</b>\n', { moduleName: 'card' } as any)
    assert.ok(!output.includes('µ.store.s`'), 'aucun des quatre ne lit le store : ' + output.split('\n').filter((l) => l.includes('title')).join(' | '))
    assert.ok(!/\$\{µ\.store\.s\}/.test(output), 'aucune interpolation du store')
  })

  it('la vue montre le store au montage, puis le suit quand il change', async () => {
    const window = await monter('raccourci-store-attribut', { 'demo-store.mjs': PAGE })
    try {
      window.document.body.innerHTML = '<mjs-demo-store></mjs-demo-store>'
      const c = window.document.querySelector('mjs-demo-store')
      await attendre(() => !!c._shadow?.querySelector('.c'))
      await pause(40)
      const lire = (cls: string, attr = 'title') => c._shadow.querySelector('.' + cls).getAttribute(attr)
      assert.equal(lire('c'), 'a', 'montage : title="$$s"')
      assert.equal(lire('m'), 'a a b', 'montage : title="a $$s b"')
      assert.equal(lire('d'), '2 et a', 'montage : un $var et un $$store dans le même texte')
      assert.equal(lire('p'), 'a', 'montage : {$$s} (déjà juste)')
      assert.equal(lire('i', 'placeholder'), 'Pour a', 'montage : placeholder="Pour $$s"')
      assert.equal(lire('l1'), 'a$$s', 'un $$ collé à un mot reste du texte')
      assert.equal(lire('l2'), 'v1.$$s', 'un $$ après un point seul reste du texte')
      assert.equal(lire('l3'), '5$$', 'un prix reste du texte')
      assert.equal(lire('l4'), '$$9', 'un $$ suivi d\'un chiffre reste du texte')
      c._shadow.querySelector('.go').click()
      await pause(80)
      assert.equal(lire('c'), 'z', 'le store change : title="$$s" suit')
      assert.equal(lire('m'), 'a z b', 'le store change : title="a $$s b" suit')
      assert.equal(lire('d'), '2 et z', 'le store change : le texte mêlé suit')
      assert.equal(lire('p'), 'z', 'le store change : {$$s} suit')
      assert.equal(lire('i', 'placeholder'), 'Pour z', 'le store change : placeholder suit')
      assert.equal(lire('l1'), 'a$$s', 'le texte figé reste figé')
    }
    finally {
      window.close()
    }
  })
})
