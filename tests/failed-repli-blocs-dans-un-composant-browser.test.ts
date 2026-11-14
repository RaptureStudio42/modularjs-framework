// le repli d'un <@failed> ne porte ni bloc ni balise dynamique (la construction les refuse) : ce qu'elle propose à la place s'y
// affiche. Une expression calcule un texte selon l'erreur ; un composant posé dans le repli reçoit le message de l'erreur et porte
// ses propres blocs ({if}, {for}) ; une balise raccourcie de même casse des deux côtés (`<@Carte>…</@Carte>`) est appariée. Repli
// déclenché pour de bon (le rendu du composant lève), en développement et en production, dans un composant et dans un partiel

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const TYPES: Record<string, string> = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css' }

const CARTE  = '<p class="carte">carte {$titre}</p>\n<script>\n  $titre = \'\'\n</script>\n'
const DETAIL = '<p class="detail">{if $message}<b>{$message}</b>{else}<i>aucun</i>{end}</p>\n<ul>{for c in $message.split(\'\')}<li>{c}</li>{end}</ul>\n<script>\n  $message = \'\'\n</script>\n'
const REPLI  = '  <p class="repli">repli</p>\n  <p class="t">{err.message ? \'oui\' : \'non\'}</p>\n  <@detail message="{err.message}"></@detail>\n  <@Carte titre="c"></@Carte>\n'
const CAS    = `<@failed err reset>\n${REPLI}</@failed>\n<p>{jette()}</p>\n<script>\n  jette = -> throw new Error('boum')\n</script>\n`

async function construire(prod: boolean, partiel: boolean): Promise<{ erreurs: string[], root: string }> {
  const root = mjsTmp('failed-repli-composant')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'carte.mjs'), CARTE)
  writeFileSync(join(src, 'detail.mjs'), DETAIL)
  if (partiel) writeFileSync(join(src, '_cas.mjs'), CAS)
  writeFileSync(join(src, 'ko.mjs'), partiel ? '<div><@include cas></div>\n' : CAS)
  writeFileSync(join(src, 'page.mjs'), '<@ko></@ko>\n')
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><script type="module" src="/out/bundle.js"></script></head><body><mjs-page></mjs-page></body></html>')
  const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: prod ? 'prod' : 'dev' })
  const stats = await b.compile()
  await b.close()
  return { erreurs: stats.errors.map(e => e.message.split('\n')[0]), root }
}

// la page servie dans Chromium, repli affiché : le texte de l'expression, ce que montre le composant qui reçoit l'erreur, la carte
async function afficher(root: string): Promise<{ texte: string, detail: string, lettres: number, carte: string }> {
  const serveur = createServer((req, res) => {
    const u = decodeURIComponent((req.url ?? '/').split('?')[0])
    const p = join(root, u === '/' ? 'index.html' : u)
    if (!p.startsWith(root) || !existsSync(p)) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' })
    res.end(readFileSync(p))
  })
  await new Promise<void>(ok => serveur.listen(0, '127.0.0.1', () => ok()))
  const playwright: any = await import('playwright')
  const browser = await playwright.chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${(serveur.address() as { port: number }).port}/`)
    const repli = () => (document.querySelector('mjs-page') as any)?._shadow?.querySelector('mjs-ko')?._shadow
    await page.waitForFunction(`(${repli.toString()})()?.querySelector('.repli') != null`, null, { timeout: 15000 })
    const ombre  = (e: any) => e?.shadowRoot ?? (e?._shadow && e._shadow !== e ? e._shadow : null)
    const releve = `(() => { const r = (${repli.toString()})(); const ombre = ${ombre.toString()}; const d = ombre(r.querySelector('mjs-detail')); return { texte: r.querySelector('.t')?.textContent ?? '', detail: d?.querySelector('.detail')?.textContent ?? 'inerte', lettres: d?.querySelectorAll('li').length ?? 0, carte: ombre(r.querySelector('mjs-carte'))?.textContent.trim() ?? 'inerte' } })()`
    // ce qui est attendu, ou 8 s au plus : un échec se lit dans ce qui est relevé
    await page.waitForFunction(`(() => { const v = ${releve}; return v.detail === 'boum' && v.lettres === 4 && v.carte === 'carte c' })()`, null, { timeout: 8000 }).catch(() => {})
    return await page.evaluate(releve)
  }
  finally {
    await browser.close()
    serveur.close()
  }
}

describe('<@failed> : ce qui remplace un bloc dans le repli s\'y affiche (Chromium)', function () {
  this.timeout(180000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    for (const partiel of [false, true]) {
      it(`${prod ? 'production' : 'développement'}, ${partiel ? 'partiel' : 'composant'}`, async () => {
        const { erreurs, root } = await construire(prod, partiel)
        assert.deepEqual(erreurs, [])
        assert.deepEqual(await afficher(root), { texte: 'oui', detail: 'boum', lettres: 4, carte: 'carte c' })
      })
    }
  }
})
