// BANC navigateur RÉEL du squelette des chargements (Chromium + Firefox, via playwright) — hors de
// `npm test`, lancé par `npm run test:browser`. Un projet écrit à la volée, `"effects": { "skeleton":
// ["await", "components"] }`, servi avec du retard (1,5 s) sur un composant et sur un
// fragment de traduction :
//   - un {await} sans branche d'attente montre la silhouette de sa branche {success} (des barres qui
//     ont une taille), puis le contenu ;
//   - un composant dont le code arrive : sa balise montre la silhouette de son HTML, qui part avant
//     son premier rendu ;
//   - un module qui demande des barres à la place de ses textes (`@i18nPlaceholder *skeleton`) : en
//     production, un texte traduit en route montre une barre grise (surlignage `mjs-i18n-skel`) à sa
//     place, puis le texte — en développement, la clé ; un texte figé trop tôt (µt dans le <script>,
//     gardé dans une variable) ne laisse pas de barre ni de repeinture à vie ;
//   - un module sans directive attend ses textes comme le défaut le veut (`wait`, doc 29 · i18n § 7) :
//     caché tant que son fragment manque, il paraît d'un coup, complet.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox } from 'playwright'
import { assertDistFrais } from '../helpers/dist-frais.js'
import { mjsTmp } from '../helpers/tmp.js'

const __dirname      = dirname(fileURLToPath(import.meta.url))
const MODULARJS_ROOT = join(__dirname, '..', '..')
const BIN_MJS        = join(MODULARJS_ROOT, 'bin', 'mjs')
const RETARD         = 1500

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json',
}

function freePort(): Promise<number> {
  return new Promise((ok, ko) => {
    const srv = createServer()
    srv.on('error', ko)
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address()
      const p = a && typeof a === 'object' ? a.port : 0
      srv.close(() => ok(p))
    })
  })
}

function ecrireFixture(dir: string): void {
  mkdirSync(join(dir, 'composants', 'i18n', 'fr'), { recursive: true })
  writeFileSync(join(dir, 'mjs.config.json'), JSON.stringify({ sourceDir: 'composants', outputDir: 'sortie', manifestPath: 'sortie/bundle.js', defaultScriptLang: 'civet', i18n: { default: 'fr' }, effects: { skeleton: ['await', 'components'] } }))
  writeFileSync(join(dir, 'index.html'), '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<title>MJS — squelettes</title>\n<style>html,body{margin:0;background:#fff;color:#111;font-family:sans-serif}</style>\n</head>\n<body>\n<mjs-page></mjs-page>\n<mjs-lent></mjs-lent>\n<script type="module" src="bundle.js"></script>\n</body>\n</html>\n')
  writeFileSync(join(dir, 'composants', 'i18n', 'fr.yml'), 'titre: Bienvenue\n')
  writeFileSync(join(dir, 'composants', 'i18n', 'fr', 'panier.yml'), 'resume: Résumé du panier\n')
  writeFileSync(join(dir, 'composants', 'page.mjs'), [
    '<script>',
    `  $profil = new Promise((ok) -> setTimeout((-> ok({ nom: 'Zora', bio: 'Une bio assez longue pour une ligne entière.' })), ${RETARD}))`,
    '</script>',
    '',
    '<div id="attente" class="attente">{await $profil}{success p}<h3 class="nom">{p.nom}</h3><p class="bio">{p.bio}</p>{end}</div>',
    '<@panier id="panier"></@panier>',
    '<@caisse id="caisse"></@caisse>',
    '',
    '<style>',
    '  .attente',
    '    width: 420px',
    '</style>',
  ].join('\n'))
  // panier : des barres à la place des textes en route ; caisse : aucune directive, le défaut (wait) — même section, même fragment
  writeFileSync(join(dir, 'composants', 'panier.mjs'), "@i18n 'panier'\n@i18nPlaceholder *skeleton\n\n<script>\n  $fige = µt('resume')\n</script>\n\n<p id=\"resume\" class=\"resume\">{µt('resume')}</p>\n<p id=\"fige\" class=\"fige\">{$fige}</p>\n")
  writeFileSync(join(dir, 'composants', 'caisse.mjs'), "@i18n 'panier'\n\n<p id=\"resume\" class=\"resume\">{µt('resume')}</p>\n")
  writeFileSync(join(dir, 'composants', 'lent.mjs'), [
    '<script>',
    "  $titre = 'Un composant lent'",
    "  $texte = 'Son code arrive après les autres.'",
    '</script>',
    '',
    '<article class="lent"><h3 class="titre">{$titre}</h3><p class="texte">{$texte}</p></article>',
  ].join('\n'))
}

// le composant lent et le fragment de traduction arrivent RETARD ms plus tard
function serveDir(dir: string, port: number): Promise<any> {
  const server = createServer((req, res) => {
    const url  = new URL(req.url || '/', 'http://x')
    const rel  = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = join(dir, rel)
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end('absent'); return }
    const envoyer = () => {
      res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream')
      res.setHeader('Cache-Control', 'no-store')
      createReadStream(file).pipe(res)
    }
    if (/\/lent-[^/]*\.js$|\/i18n\/fr\/[^/]*\.json$/.test(url.pathname)) setTimeout(envoyer, RETARD)
    else envoyer()
  })
  return new Promise((ok, ko) => {
    server.on('error', ko)
    server.listen(port, '127.0.0.1', () => ok(server))
  })
}

describe('banc navigateur réel : le squelette des chargements ({await}, composant, texte traduit) — dev + prod', function () {
  this.timeout(600000)

  let dir = ''
  let server: any = null
  let port = 0

  before(async function () {
    assertDistFrais(MODULARJS_ROOT)
    dir  = mjsTmp('banc-squelettes')
    port = await freePort()
    ecrireFixture(dir)
    server = await serveDir(dir, port)
  })

  after(async function () {
    if (server) await new Promise<void>((r) => server.close(() => r()))
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  for (const mode of ['dev', 'prod'] as const) {
    describe(`build ${mode}`, function () {
      before(function () {
        rmSync(join(dir, 'sortie'), { recursive: true, force: true })
        const r = spawnSync(process.execPath, [BIN_MJS, 'build', '--root', dir, mode === 'prod' ? '--prod' : '--dev'], { encoding: 'utf-8', timeout: 120000 })
        assert.equal(r.status, 0, `mjs build --${mode} en échec :\n${r.stdout}\n${r.stderr}`)
        copyFileSync(join(dir, 'index.html'), join(dir, 'sortie', 'index.html'))
      })

      for (const engine of [chromium, firefox]) {
        describe(`moteur ${engine.name()}`, function () {
          let browser: any = null
          let page: any = null
          const issues: string[] = []

          before(async function () {
            browser = await engine.launch()
            page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
            page.on('console', (m: any) => { if (m.type() === 'error') issues.push(`[${engine.name()}/${mode}] console.error: ${m.text()}`) })
            page.on('pageerror', (e: any) => { issues.push(`[${engine.name()}/${mode}] pageerror: ${e.message}`) })
            await page.goto(`http://127.0.0.1:${port}/sortie/index.html`, { waitUntil: 'domcontentloaded' })
            await page.waitForFunction(() => {
              const el: any = document.querySelector('mjs-page')
              return !!(el && (el._shadow || el.shadowRoot))
            }, null, { timeout: 30000 })
          })

          after(async function () {
            if (browser) await browser.close()
          })

          it('pendant le chargement : la silhouette du {await}, celle du composant lent, la barre du texte traduit (*skeleton) et le module sans directive caché (wait)', async function () {
            // ce que la page montre en attendant est posé en quelques tours (le surlignage de la barre
            // grise part au tour qui suit la racine) : on l'attend, sans jamais atteindre le retard des
            // ressources (1,5 s) — au-delà, c'est un vrai défaut
            await page.waitForFunction((prod: boolean) => {
              const sh: any = document.querySelector('mjs-page')
              const racine = sh && (sh._shadow || sh.shadowRoot)
              const panier: any = racine && racine.querySelector('#panier')
              const caisse: any = racine && racine.querySelector('#caisse')
              const rp = panier && (panier._shadow || panier.shadowRoot)
              const rc = caisse && (caisse._shadow || caisse.shadowRoot)
              if (!rp || !rc || !rp.querySelector('#resume') || !racine.querySelector('#attente [mjs-skel-zone]') || !document.querySelector('mjs-lent [mjs-skel-zone]')) return false
              if (!prod || typeof (window as any).Highlight !== 'function') return true
              const hl = (window as any).CSS && (CSS as any).highlights ? (CSS as any).highlights.get('mjs-i18n-skel') : null
              return !!hl && hl.size >= 1
            }, mode === 'prod', { timeout: 1200 })
            const m = await page.evaluate(() => {
              const sh: any = (document.querySelector('mjs-page') as any)
              const racine = sh._shadow || sh.shadowRoot
              const barre  = (el: any) => { const r = el ? el.getBoundingClientRect() : null; return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null }
              const lent: any = document.querySelector('mjs-lent')
              const panier: any = racine.querySelector('#panier')
              const caisse: any = racine.querySelector('#caisse')
              const rp = panier && (panier._shadow || panier.shadowRoot)
              const hl = (window as any).CSS && (CSS as any).highlights ? (CSS as any).highlights.get('mjs-i18n-skel') : null
              return {
                attente: barre(racine.querySelector('#attente [mjs-skel-zone] h3.nom > i[mjs-skel]')),
                lent: { zone: !!lent.querySelector('[mjs-skel-zone]'), barre: barre(lent.querySelector('[mjs-skel-zone] h3.titre > i[mjs-skel]')), defini: !!customElements.get('mjs-lent') },
                texte: rp ? rp.querySelector('#resume').textContent : null,
                surligne: hl ? hl.size : -1,
                api: typeof (window as any).Highlight === 'function',
                caisse: { affichage: getComputedStyle(caisse).display, boite: barre(caisse) },
              }
            })
            assert.ok(m.attente && m.attente.w > 50 && m.attente.h > 8, `la barre du titre à venir : ${JSON.stringify(m.attente)}`)
            assert.ok(m.lent.zone && !m.lent.defini, `la silhouette du composant lent, avant son code : ${JSON.stringify(m.lent)}`)
            assert.ok(m.lent.barre && m.lent.barre.w > 50, `ses barres ont une taille : ${JSON.stringify(m.lent)}`)
            if (mode === 'dev') assert.equal(m.texte, '⟦panier.resume⟧', 'sous *skeleton, en développement : la clé')
            else {
              assert.equal(m.texte, ' '.repeat(12), 'sous *skeleton, en production : la place du texte (espaces de chiffre)')
              if (m.api) assert.ok(m.surligne >= 1, `la barre grise (surlignage) : ${m.surligne}`)
            }
            assert.ok(m.caisse.affichage === 'none' && m.caisse.boite.w === 0 && m.caisse.boite.h === 0, `sans directive (wait, le défaut), le module reste caché tant que son texte n'est pas là : ${JSON.stringify(m.caisse)}`)
          })

          it('arrivés : le contenu à la place, plus rien de la silhouette ni de la barre, le module en wait montré avec son texte', async function () {
            await page.waitForTimeout(RETARD + 900)
            const m = await page.evaluate(() => {
              const el: any = document.querySelector('mjs-page')
              const racine = el._shadow || el.shadowRoot
              const lent: any = document.querySelector('mjs-lent')
              const rl = lent._shadow || lent.shadowRoot
              const panier: any = racine.querySelector('#panier')
              const caisse: any = racine.querySelector('#caisse')
              const rp = panier._shadow || panier.shadowRoot
              const rc = caisse._shadow || caisse.shadowRoot
              const hl = (window as any).CSS && (CSS as any).highlights ? (CSS as any).highlights.get('mjs-i18n-skel') : null
              return {
                nom: racine.querySelector('#attente h3.nom').textContent,
                zones: racine.querySelectorAll('[mjs-skel-zone]').length + lent.querySelectorAll('[mjs-skel-zone]').length,
                lent: rl ? rl.querySelector('h3.titre').textContent : null,
                texte: rp.querySelector('#resume').textContent,
                surligne: hl ? hl.size : 0,
                caisse: { visible: getComputedStyle(caisse).display !== 'none', texte: rc.querySelector('#resume').textContent },
              }
            })
            assert.deepEqual(m, { nom: 'Zora', zones: 0, lent: 'Un composant lent', texte: 'Résumé du panier', surligne: 0, caisse: { visible: true, texte: 'Résumé du panier' } })
          })

          it('aucune erreur console ni pageerror', function () {
            assert.deepEqual(issues, [])
          })
        })
      }
    })
  }
})
