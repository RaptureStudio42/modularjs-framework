// Une méthode appelée par une clé calculée (`$o.m[push]()`, la clé tenue par une variable qui s'appelle comme une méthode
// qui modifie un tableau) appelle la méthode que nomme la VALEUR de la variable, comme en JavaScript. Le compilateur lisait
// le nom écrit entre les crochets sans voir qu'il était calculé : l'appel devenait celui de la méthode `push`, quelle que
// soit la clé demandée, pour l'état comme pour le magasin. Vérifié sur le code compilé et en marche, développement et
// production
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { applyPathTracking } from '../src/generator/path-tracker.js'
import { mjsTmp } from './helpers/tmp.js'

const BALISE = 'mjs-appel-calcule'
const SOURCE = `<script>
$o = { m: { push: (-> 'methode push'), autre: (-> 'methode autre') }, l: [1] }
$$cfg = { m: { push: (-> 'methode push'), autre: (-> 'methode autre') }, l: [1] }
$$liste = [{ id: 1, m: { push: (-> 'methode push'), autre: (-> 'methode autre') } }]
@appelLocal = (push) -> $o.m[push]()
@appelMagasin = (push) -> $$cfg.m[push]()
@appelTrouve = (push) -> $$liste.find((x) -> x.id is 1).m[push]()
@pousser = ->
  $o.l.push(2)
  $$cfg.l.push(2)
  [$o.l.length, $$cfg.l.length]
</script>
<p class="rendu">{$o.l.length}-{$$cfg.l.length}</p>
`

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root = mjsTmp(prefixe), srcDir = join(root, 'src'), outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'appel-calcule.mjs'), SOURCE)
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

describe('compilateur : appel d\'une méthode par une clé calculée', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le code compilé garde l\'appel par la clé calculée (état et magasin), un appel nommé reste suivi', () => {
    const local = applyPathTracking('$.o.m[push]();')
    assert.equal(local.includes('_mjs_deepCall'), false, local)
    const magasin = applyPathTracking('µ.store.cfg.m[push](1);')
    assert.equal(magasin.includes('_mjs_storeDeepCall'), false, magasin)
    assert.match(applyPathTracking('µ.store.cfg.l.push(1);'), /µ\._mjs_storeDeepCall\("cfg", \["l"\], 'push', \[1\]\)/)
    // suppression et affectation composée : la clé calculée reste la variable, lue à l'exécution
    assert.match(applyPathTracking('delete µ.store.cfg.a[push];'), /µ\._mjs_storeDeepDelete\("cfg", \["a", push\]\)/)
    assert.match(applyPathTracking('µ.store.cfg.a[push] += 1;'), /µ\._mjs_storeDeepSet\("cfg", \["a", push\], /)
    assert.match(applyPathTracking('delete $.o.a[push];'), /µ\._mjs_deepDelete\(_mjsThis, \["o", "a", push\]\)/)
  })

  for (const mode of ['developpement', 'production']) {
    it(mode + ' : la clé demandée est celle qu\'on appelle', async () => {
      const code = await construire('appel-calcule-' + mode, mode === 'production')
      const window: any = new Window({ url: 'http://localhost/' })
      try {
        window.eval(code)
        window.document.body.innerHTML = `<${BALISE}></${BALISE}>`
        const c = window.document.querySelector(BALISE)
        const fin = Date.now() + 5000
        while (!c._shadow?.querySelector('.rendu') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
        assert.equal(c.appelLocal('autre'), 'methode autre', 'état local')
        assert.equal(c.appelMagasin('autre'), 'methode autre', 'magasin')
        assert.equal(c.appelTrouve('autre'), 'methode autre', 'élément trouvé dans le magasin')
        assert.deepEqual(Array.from(c.pousser()), [2, 2], 'un appel nommé modifie toujours le tableau')
        const fin2 = Date.now() + 2000
        while (c._shadow.querySelector('.rendu').textContent !== '2-2' && Date.now() < fin2) await new Promise((r) => setTimeout(r, 10))
        assert.equal(c._shadow.querySelector('.rendu').textContent, '2-2', 'et prévient l\'affichage')
      }
      finally { await window.happyDOM.close() }
    })
  }
})
