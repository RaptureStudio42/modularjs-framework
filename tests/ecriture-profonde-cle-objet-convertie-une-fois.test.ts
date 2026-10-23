// Une écriture profonde dont la dernière clé est un objet (`$o.a[k] = 1`, `$$cfg.a[k] = 1`) convertit cette clé
// une seule fois, comme JavaScript : un objet dont `toString` ne rend pas toujours le même texte écrivait sous le
// texte de la seconde conversion (la comparaison à l'ancienne valeur, puis l'écriture, convertissaient chacune la clé)
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const BALISE = 'mjs-cle-objet-une-fois'
const SOURCE = `<script>
$$cfg = { a: {} }
$o = { a: {} }
@ecrireLocal = (k) -> $o.a[k] = 1
@ecrireMagasin = (k) -> $$cfg.a[k] = 1
@clesLocal = -> Object.keys($o.a).join(',')
@clesMagasin = -> Object.keys($$cfg.a).join(',')
</script>
<p class="rendu">{$$cfg.a.x}{$o.a.x}</p>
`

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root = mjsTmp(prefixe), srcDir = join(root, 'src'), outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'cle-objet-une-fois.mjs'), SOURCE)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

// une clé dont le texte change à chaque conversion : k0, puis k1…
const cle = () => ({ n: 0, toString() { return 'k' + (this.n++) } })

describe('écriture profonde : une clé objet est convertie une fois, comme JavaScript', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('témoin : JavaScript convertit la clé une fois', () => {
    const j: any = {}, k = cle()
    j[k] = 1
    assert.deepEqual([Object.keys(j).join(','), k.n], ['k0', 1])
  })

  for (const mode of ['dev', 'prod']) {
    it((mode === 'dev' ? 'développement' : 'production') + ' : $o.a[k] = 1 et $$cfg.a[k] = 1 écrivent sous k0', async () => {
      const code = await construire('cle-objet-une-fois-' + mode, mode === 'prod')
      const window: any = new Window({ url: 'http://localhost/' })
      try {
        window.eval(code)
        window.document.body.innerHTML = `<${BALISE}></${BALISE}>`
        const c = window.document.querySelector(BALISE)
        const fin = Date.now() + 3000
        while (!c._shadow?.querySelector('.rendu') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
        const k1 = cle()
        c.ecrireLocal(k1)
        assert.deepEqual([c.clesLocal(), k1.n], ['k0', 1], 'état local : clé écrite, conversions')
        const k2 = cle()
        c.ecrireMagasin(k2)
        assert.deepEqual([c.clesMagasin(), k2.n], ['k0', 1], 'magasin : clé écrite, conversions')
      }
      finally { await window.happyDOM.close() }
    })
  }
})
