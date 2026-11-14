// dans le repli d'un <@failed>, toute balise raccourcie se rend comme partout ailleurs dans le gabarit : `<@@nom>` devient la balise
// du module cœur (<mjs-core-nom>), livré par la construction, `<@nom>` celle du composant du projet (<mjs-nom>), chargé ; mêmes
// attributs, fermantes comprises, balise sur plusieurs lignes, auto-fermée ou jamais refermée comprises. Le repli part dans la page
// par innerHTML, hors du compilateur du gabarit : ces balises y sortaient telles qu'écrites et le navigateur affichait leur texte
// (`<@@progress value="3" max="10"> <@carte titre="x">`). Repli déclenché pour de bon (le rendu du composant lève), en
// développement et en production, dans un composant et dans un partiel, dans Chromium, Firefox et WebKit, et au rendu serveur

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { renderToString } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const MOTEURS = ['chromium', 'firefox', 'webkit']
const TYPES: Record<string, string> = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css' }

const CARTE = '<p class="carte">carte {$titre}</p>\n<script>\n  $titre = \'\'\n</script>\n'

// le contenu du repli : chaque forme d'une balise raccourcie, et une balise jamais refermée dans un composant, refermée par la fermante de celui-ci
const REPLI = '  <p class="repli">repli</p>\n  <@@progress value="3" max="10"></@@progress>\n  <@carte titre="x"></@carte>\n  <@carte\n    titre="z"\n  ></@carte\n  >\n  <@carte titre="w"/>\n  <@carte titre="v">\n  <@@PROGRESS value="5" max="10"></@@PROGRESS>\n  <@carte titre="n"><@@progress value="7" max="10"></@carte>\n'
const LEVE  = '<p>{jette()}</p>\n<script>\n  jette = -> throw new Error(\'boum\')\n</script>\n'
const CAS   = `<@failed err reset>\n${REPLI}</@failed>\n${LEVE}`

// les trois façons d'écrire le cas : dans le composant, le bloc entier dans un partiel, le contenu du repli dans un partiel
type Facon = 'composant' | 'partiel' | 'partiel dans le repli'
function ecrire(src: string, facon: Facon): void {
  writeFileSync(join(src, 'carte.mjs'), CARTE)
  if (facon === 'composant') writeFileSync(join(src, 'ko.mjs'), CAS)
  else if (facon === 'partiel') {
    writeFileSync(join(src, '_cas.mjs'), CAS)
    writeFileSync(join(src, 'ko.mjs'), '<div><@include cas></div>\n')
  }
  else {
    writeFileSync(join(src, '_cas.mjs'), REPLI)
    writeFileSync(join(src, 'ko.mjs'), `<@failed err reset>\n<@include cas>\n</@failed>\n${LEVE}`)
  }
  writeFileSync(join(src, 'page.mjs'), '<@ko></@ko>\n')
}

async function construire(prod: boolean, facon: Facon): Promise<{ erreurs: string[], root: string, sortie: string[], js: string }> {
  const root = mjsTmp('failed-raccourcis')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  ecrire(src, facon)
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><script type="module" src="/out/bundle.js"></script></head><body><mjs-page></mjs-page></body></html>')
  const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: prod ? 'prod' : 'dev' })
  const stats = await b.compile()
  await b.close()
  const sortie = readdirSync(out)
  const js     = sortie.filter(f => /^ko-.*\.js$/.test(f)).map(f => readFileSync(join(out, f), 'utf-8')).join('\n')
  return { erreurs: stats.errors.map(e => e.message.split('\n')[0]), root, sortie, js }
}

// la page servie dans un moteur, repli affiché : son texte, la valeur de chaque barre du module cœur, le texte de chaque carte
async function afficher(moteur: string, root: string): Promise<{ texte: string, barres: string[], cartes: string[] }> {
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
    const repli = () => (document.querySelector('mjs-page') as any)?._shadow?.querySelector('mjs-ko')?._shadow
    await page.waitForFunction(`(${repli.toString()})()?.querySelector('.repli') != null`, null, { timeout: 15000 })
    // chaque balise rendue, ou 8 s au plus : un échec se lit dans ce qui est relevé
    const ombre = (e: any) => e.shadowRoot ?? (e._shadow && e._shadow !== e ? e._shadow : null)
    const releve = `(() => { const r = (${repli.toString()})(); const ombre = ${ombre.toString()}; return { texte: r.textContent.replace(/\\s+/g, ' ').trim(), barres: Array.from(r.querySelectorAll('mjs-core-progress')).map(e => ombre(e)?.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') ?? 'inerte'), cartes: Array.from(r.querySelectorAll('mjs-carte')).map(e => ombre(e)?.textContent.trim() ?? 'inerte') } })()`
    await page.waitForFunction(`(() => { const v = ${releve}; return v.barres.length === 3 && v.cartes.length === 5 && !v.barres.includes('inerte') && !v.barres.includes('0') && v.cartes.every(c => /^carte \\w$/.test(c)) })()`, null, { timeout: 8000 }).catch(() => {})
    return await page.evaluate(releve)
  }
  finally {
    await browser.close()
    serveur.close()
  }
}

// le code du repli tel que compilé, guillemets échappés et blancs ramenés à une espace
const lu = (js: string): string => js.replace(/\\(['"])/g, '$1').replace(/\\n/g, ' ').replace(/\s+/g, ' ')

describe('<@failed> : balises raccourcies du repli, le code compilé', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    for (const facon of ['composant', 'partiel', 'partiel dans le repli'] as Facon[]) {
      it(`${prod ? 'production' : 'développement'}, ${facon}`, async () => {
        const { erreurs, sortie, js } = await construire(prod, facon)
        assert.deepEqual(erreurs, [])
        const code = lu(js)
        for (const forme of ['<mjs-core-progress value="3" max="10"></mjs-core-progress>', '<mjs-carte titre="x"></mjs-carte>', '<mjs-carte titre="z" ></mjs-carte >', '<mjs-carte titre="w"></mjs-carte>', '<mjs-carte titre="v"></mjs-carte>', '<mjs-core-progress value="5" max="10"></mjs-core-progress>', '<mjs-carte titre="n"><mjs-core-progress value="7" max="10"></mjs-core-progress></mjs-carte>']) assert.ok(code.includes(forme), `${forme}\n${code.slice(code.indexOf('_mjs_fallback'), code.indexOf('_mjs_fallback') + 900)}`)
        for (const brute of ['<@@progress', '</@@progress', '<@@PROGRESS', '</@@PROGRESS', '<@carte', '</@carte']) assert.ok(!code.includes(brute), `${brute} laissée telle quelle dans le repli`)
        assert.equal(sortie.filter(f => /^core-progress-.*\.js$/.test(f)).length, 1, `le module cœur progress est livré : ${sortie.join(' ')}`)
      })
    }
  }
})

describe('<@failed> : balises raccourcies du repli, affichées (trois moteurs)', function () {
  this.timeout(300000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    for (const facon of ['composant', 'partiel'] as Facon[]) {
      it(`${prod ? 'production' : 'développement'}, ${facon}`, async () => {
        const { erreurs, root } = await construire(prod, facon)
        assert.deepEqual(erreurs, [])
        // un navigateur à la fois
        const vus: string[] = []
        for (const moteur of MOTEURS) {
          const vu = await afficher(moteur, root)
          vus.push(`${moteur} ${vu.texte.includes('<@') ? `texte de balise affiché : ${vu.texte}` : 'aucun texte de balise'} barres ${JSON.stringify(vu.barres)} cartes ${JSON.stringify(vu.cartes)}`)
        }
        assert.deepEqual(vus, MOTEURS.map(m => `${m} aucun texte de balise barres ["30","50","70"] cartes ["carte x","carte z","carte w","carte v","carte n"]`))
      })
    }
  }
})

describe('<@failed> : balises raccourcies du repli, rendu serveur', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    for (const facon of ['composant', 'partiel dans le repli'] as Facon[]) {
      it(`${prod ? 'production' : 'développement'}, ${facon}`, async () => {
        const root = mjsTmp('failed-raccourcis-ssr')
        const src  = join(root, 'src')
        const out  = join(root, 'out')
        mkdirSync(src, { recursive: true })
        ecrire(src, facon)
        const garde = { warn: console.warn, log: console.log, error: console.error }
        console.warn = console.log = console.error = () => {}
        let html: string
        try {
          html = String((await renderToString({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), tag: 'mjs-page', env: prod ? 'prod' : 'dev' })).html)
        }
        finally {
          Object.assign(console, garde)
        }
        const repli = html.slice(html.indexOf('class="repli"'))
        assert.ok(html.includes('class="repli"'), `le repli est rendu : ${html.slice(0, 600)}`)
        assert.ok(!/&lt;\/?@|<\/?@/.test(repli), `aucune balise raccourcie en texte : ${repli.slice(0, 900)}`)
        assert.deepEqual(repli.match(/aria-valuenow="\d+"/g), ['aria-valuenow="30"', 'aria-valuenow="50"', 'aria-valuenow="70"'])
        assert.deepEqual(repli.match(/carte [a-z]</g), ['carte x<', 'carte z<', 'carte w<', 'carte v<', 'carte n<'])
      })
    }
  }
})
