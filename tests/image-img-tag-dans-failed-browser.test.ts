// une <@@img> écrite dans le repli d'un <@failed> s'y affiche comme partout ailleurs : la balise du module cœur
// (<mjs-core-img>), ses attributs, l'image préparée (empreinte, copie, adresse) et chargée. Le repli part dans la page par
// innerHTML, hors du compilateur du gabarit : la balise y sortait telle qu'écrite et le navigateur affichait le texte
// `<@@img src="/out/b-….png" …>`. Repli déclenché pour de bon (le rendu du composant lève), en développement et en
// production, dans un composant et dans un partiel <@include>, dans Chromium, Firefox et WebKit

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const MOTEURS = ['chromium', 'firefox', 'webkit']
const TYPES: Record<string, string> = { '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css' }

// le repli, avant le gabarit qui lève à son premier rendu
const CAS = '<@failed err reset>\n  <p class="repli">repli</p>\n  <@@img src="b.png" alt="b">\n</@failed>\n<p>{jette()}</p>\n<script>\n  jette = -> throw new Error(\'boum\')\n</script>\n'

// la construction du composant `page.mjs`, ou d'une page qui inclut le partiel `_cas.mjs` : erreurs, dossier servi, code compilé
async function construire(prod: boolean, partiel: boolean): Promise<{ erreurs: string[], root: string, js: string }> {
  const root = mjsTmp('img-failed-nav')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  mkdirSync(out)
  writeFileSync(join(src, 'b.png'), validPng(40, 30))
  if (partiel) writeFileSync(join(src, '_cas.mjs'), CAS)
  writeFileSync(join(src, 'page.mjs'), partiel ? '<div><@include cas></div>\n' : CAS)
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><script type="module" src="/out/bundle.js"></script></head><body><mjs-page></mjs-page></body></html>')
  const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: prod ? 'prod' : 'dev' })
  const stats = await b.compile()
  await b.close()
  const js = readdirSync(out).filter(f => /^page-.*\.js$/.test(f)).map(f => readFileSync(join(out, f), 'utf-8')).join('\n')
  return { erreurs: stats.errors.map(e => e.message.split('\n')[0]), root, js }
}

// la page servie dans un moteur, repli affiché : son texte, et chaque image de la page (ombres comprises) avec la balise qui la porte
async function afficher(moteur: string, root: string): Promise<{ texte: string, images: Array<{ hote: string, src: string, alt: string, largeur: string, hauteur: string, chargee: number }> }> {
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
  const browser = await playwright[moteur].launch()
  try {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${(serveur.address() as { port: number }).port}/`)
    await page.waitForFunction(() => (document.querySelector('mjs-page') as any)?._shadow?.querySelector('.repli') != null, null, { timeout: 15000 })
    // l'image chargée, ou 8 s au plus : un échec se lit dans ce qui est relevé
    await page.waitForFunction(() => {
      const hote = (document.querySelector('mjs-page') as any)._shadow.querySelector('mjs-core-img')
      const img  = hote?._shadow?.querySelector?.('img') ?? hote?.shadowRoot?.querySelector('img')
      return img != null && img.complete && img.naturalWidth > 0
    }, null, { timeout: 8000 }).catch(() => {})
    return await page.evaluate(() => {
      const racine = (document.querySelector('mjs-page') as any)._shadow
      const images: Array<{ hote: string, src: string, alt: string, largeur: string, hauteur: string, chargee: number }> = []
      const voir = (r: any, hote: string): void => {
        for (const e of r.querySelectorAll('*')) {
          if (e.localName === 'img') images.push({ hote, src: e.getAttribute('src'), alt: e.getAttribute('alt'), largeur: e.getAttribute('width'), hauteur: e.getAttribute('height'), chargee: e.complete ? e.naturalWidth : -1 })
          const ombre = e.shadowRoot ?? (e._shadow && e._shadow !== e ? e._shadow : null)
          if (ombre) voir(ombre, e.localName)
        }
      }
      voir(racine, 'mjs-page')
      return { texte: racine.textContent, images }
    })
  }
  finally {
    await browser.close()
    serveur.close()
  }
}

// toutes les formes dans un repli : jamais refermée, en capitales, auto-fermée, refermée ; un exemple dans <pre> et un exemple cité
// dans le code d'un <script> posé hors de la tête de ligne, après une fermante inexacte citée (lu jusqu'à sa fermante exacte, comme
// le relevé des images), ou dans une section posée après un commentaire, restent tels qu'écrits
const FORMES = '<@failed err reset>\n  <p class="repli">repli</p>\n  <@@img src="b.png" alt="jamais">\n  <@@IMG src="b.png" alt="casse">\n  <@@img src="b.png" alt="auto" />\n  <@@img src="b.png" alt="fermee"></@@img>\n  <pre><@@img src="b.png" alt="exemple"></pre>\n  <p>a</p> <script>\n    fin = \'</script >\'\n    ex = \'<@@img src="a.png" alt="citee">\'\n  </script>\n  <!-- c --><vars>\n    d: \'<@@img src="a.png" alt="vars">\'\n  </vars>\n</@failed>\n<p>{jette()}</p>\n<script>\n  jette = -> throw new Error(\'boum\')\n</script>\n'

describe('<@@img> dans le repli d\'un <@failed> : le code compilé du repli, toutes les formes', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    for (const partiel of [false, true]) {
      it(`${prod ? 'production' : 'développement'}, ${partiel ? 'dans un partiel <@include>' : 'dans un composant'}`, async () => {
        const root = mjsTmp('img-failed-formes')
        const src  = join(root, 'src')
        const out  = join(root, 'out')
        mkdirSync(src, { recursive: true })
        writeFileSync(join(src, 'b.png'), validPng(40, 30))
        if (partiel) writeFileSync(join(src, '_cas.mjs'), FORMES)
        writeFileSync(join(src, 'page.mjs'), partiel ? '<div><@include cas></div>\n' : FORMES)
        const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: prod ? 'prod' : 'dev' })
        const stats = await b.compile()
        await b.close()
        assert.deepEqual(stats.errors.map(e => e.message), [])
        const sortie = readdirSync(out)
        const js     = sortie.filter(f => /^page-.*\.js$/.test(f)).map(f => readFileSync(join(out, f), 'utf-8')).join('\n').replace(/\\(['"])/g, '$1').replace(/b-[a-f0-9]{8}\.png/g, 'b-<empreinte>.png')
        const ecrit  = (alt: string, fin: string): string => `<mjs-core-img src="/out/b-<empreinte>.png" alt="${alt}" width="40" height="30"${fin}</mjs-core-img>`
        for (const forme of [ecrit('jamais', '>'), ecrit('casse', '>'), ecrit('auto', ' >'), ecrit('fermee', '>'), '<pre><@@img src="b.png" alt="exemple"></pre>', 'ex = \'<@@img src="a.png" alt="citee">\'', 'd: \'<@@img src="a.png" alt="vars">\'']) assert.ok(js.includes(forme), `${forme}\n${js.slice(js.indexOf('_mjs_fallback'), js.indexOf('_mjs_fallback') + 900)}`)
        assert.equal(sortie.filter(f => /^core-img-.*\.js$/.test(f)).length, 1, `le module cœur img est livré : ${sortie.join(' ')}`)
      })
    }
  }
})

describe('<@@img> dans le repli d\'un <@failed> : l\'image s\'affiche (trois moteurs)', function () {
  this.timeout(240000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    for (const partiel of [false, true]) {
      it(`${prod ? 'production' : 'développement'}, ${partiel ? 'dans un partiel <@include>' : 'dans un composant'}`, async () => {
        const { erreurs, root, js } = await construire(prod, partiel)
        assert.deepEqual(erreurs, [])
        // un navigateur à la fois
        const vus: string[] = []
        for (const moteur of MOTEURS) {
          const vu = await afficher(moteur, root)
          vus.push(`${moteur} ${vu.texte.includes('<@@img') ? 'texte de la balise affiché' : 'aucun texte de balise'} ${JSON.stringify(vu.images.map(i => ({ ...i, src: i.src.replace(/b-[a-f0-9]{8}\.png$/, 'b-<empreinte>.png') })))}`)
        }
        const attendu = JSON.stringify([{ hote: 'mjs-core-img', src: '/out/b-<empreinte>.png', alt: 'b', largeur: '40', hauteur: '30', chargee: 40 }])
        assert.deepEqual(vus, MOTEURS.map(m => `${m} aucun texte de balise ${attendu}`))
        assert.ok(!js.includes('<@@img'), 'aucune balise <@@img> laissée telle quelle dans le code compilé')
      })
    }
  }
})
