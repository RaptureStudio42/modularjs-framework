// `@flip` et clés `by` en double (trois moteurs) : la ligne d'une clé que plusieurs éléments portent ne glisse pas (la réconciliation
// ne rend que le premier, l'identité de la ligne n'est pas sûre). La garde reconnaît la clé comme la réconciliation la range : un
// nombre reste un nombre, un texte un texte ; une clé numérique en double est écartée comme une clé texte en double
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createServer } from 'node:http'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANT = `<script>
  $num = [{ id: 1, t: 'a' }, { id: 1, t: 'b' }, { id: 2, t: 'c' }, { id: 3, t: 'd' }]
  $txt = [{ id: 'x1', t: 'a' }, { id: 'x1', t: 'b' }, { id: 'x2', t: 'c' }, { id: 'x3', t: 'd' }]
  @poseNum = (l) -> $num = l
  @poseTxt = (l) -> $txt = l
</script>
<ul class="num">
  {for s in $num by id}
    <li :flip=5000 data-k="{s.t}">{s.t}</li>
  {end}
</ul>
<ul class="txt">
  {for s in $txt by id}
    <li :flip=5000 data-k="{s.t}">{s.t}</li>
  {end}
</ul>`

describe('@flip — la ligne d\'une clé en double ne glisse pas, que la clé soit un nombre ou un texte', function () {
  this.timeout(120000)
  let url = ''
  let server: any = null
  before(async () => {
    const root = mjsTmp('flip-cle-double')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'flipd.mjs'), COMPOSANT)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'dev', runtime: 'all', js: 'split' } as any)
    const stats = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-flipd></mjs-flipd><script type="module" src="/out/bundle.js"></script></body></html>'
    server = createServer((req, res) => {
      const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
      if (chemin === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); return }
      const f = join(root, chemin)
      if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'content-type': extname(f) === '.js' ? 'text/javascript' : extname(f) === '.css' ? 'text/css' : 'application/octet-stream' })
      res.end(readFileSync(f))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    url = `http://127.0.0.1:${server.address().port}/`
  })
  after(async () => { if (server) server.close(); await terminateSharedWorkerPool() })

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    it(`${moteur} : une clé numérique en double est écartée comme une clé texte en double`, async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const browser = await playwright[moteur].launch()
      try {
        const page = await browser.newPage()
        await page.goto(url, { waitUntil: 'load' })
        await page.waitForFunction(() => { const h: any = document.querySelector('mjs-flipd'); return !!(h && h._shadow && h._shadow.querySelectorAll('ul.num li').length === 3 && h._shadow.querySelectorAll('ul.txt li').length === 3) }, null, { timeout: 15000 })
        // réordonne la liste, relève pour chaque ligne le nombre de ses animations, puis les arrête
        const bouger = async (ul: string, pose: string, l: any[]) => {
          await page.evaluate(([p, x]: [string, any]) => { (document.querySelector('mjs-flipd') as any)[p](x) }, [pose, l] as [string, any])
          await page.waitForTimeout(150)
          return page.evaluate((u: string) => {
            const lis = Array.from((document.querySelector('mjs-flipd') as any)._shadow.querySelectorAll(`ul.${u} li`)) as any[]
            const r = lis.map((li) => li.dataset.k + ':' + li.getAnimations().length).join(' ')
            lis.forEach((li) => li.getAnimations().forEach((a: any) => a.cancel()))
            return r
          }, ul)
        }
        const num = await bouger('num', 'poseNum', [{ id: 3, t: 'd' }, { id: 1, t: 'b' }, { id: 1, t: 'a' }, { id: 2, t: 'c' }])
        const txt = await bouger('txt', 'poseTxt', [{ id: 'x3', t: 'd' }, { id: 'x1', t: 'b' }, { id: 'x1', t: 'a' }, { id: 'x2', t: 'c' }])
        assert.match(txt, /b:0/, `la ligne de la clé texte en double ne glisse pas (relevé « ${txt} »)`)
        assert.equal(num, txt, 'la clé numérique en double est traitée comme la clé texte en double')
      }
      finally {
        await browser.close()
      }
    })
  }
})
