// une appli dont la seule écriture gardée part de la valeur de `sort` (`$l.sort(f)[0].x = v`, avec l'enveloppe) : le compilateur
// écrit `µ._mjs_deepSame(`, que le bundler doit reconnaître pour garder le bloc `<deep-guard>` au cœur — sinon l'aide manque et
// l'écriture lève « µ._mjs_deepSame is not a function ». Production, happy-dom

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCE = `<script lang="js">
  $l = [{ n: 3, x: '' }, { n: 1, x: '' }, { n: 2, x: '' }];
  @trier = function() { $l.sort((p, q) => p.n - q.n)[0].x = 'T'; };
</script>
<p class="etat">{$l.length}|{$l[0].x || '-'}</p>
`

describe('bundler : la seule écriture qui part de la valeur de `sort` garde son aide au cœur', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  it('production : `$l.sort(f)[0].x = v` écrit sans erreur et l\'écran le montre', async () => {
    const root   = mjsTmp('deep-same-seule')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'sz-tri.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', js: 'bundle', urlPrefix: '/out' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    const code   = readFileSync(join(outDir, 'bundle.js'), 'utf-8')
    const w: any = new Window({ url: 'http://localhost/' })
    const fautes: string[] = []
    w.addEventListener('error', (e: any) => fautes.push(String(e.error?.message ?? e.message)))
    w.eval(code.replace(/import\.meta\.url/g, '\'http://localhost/\'').replace(/export\s*\{[^}]*\}\s*;?/g, ''))
    w.document.body.innerHTML = '<mjs-sz-tri></mjs-sz-tri>'
    const c = w.document.querySelector('mjs-sz-tri')
    for (let i = 0; i < 300 && !c._shadow?.querySelector('.etat')?.textContent; i++) await new Promise((r) => setTimeout(r, 10))
    let leve = ''
    try { c.trier() } catch (e: any) { leve = String(e?.message ?? e) }
    await new Promise((r) => setTimeout(r, 50))
    const ecran = c._shadow.querySelector('.etat').textContent
    await w.happyDOM.close()
    assert.deepEqual({ leve, fautes, ecran }, { leve: '', fautes: [], ecran: '3|T' })
  })
})
