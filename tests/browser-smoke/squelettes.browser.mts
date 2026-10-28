// BANC navigateur RÉEL du squelette des chargements (Chromium + Firefox, via playwright) — hors de
// `npm test`, lancé par `npm run test:browser`. Un projet écrit à la volée, `"effects": { "skeleton":
// ["await", "components"] }`, servi avec du retard (1,5 s) sur un composant et sur un
// fragment de traduction :
//   - un {await} sans branche d'attente montre la silhouette de sa branche {success} (des barres qui
//     ont une taille), puis le contenu ;
//   - un composant qui attend un contenu (un {await}), dont le code arrive : sa balise montre la
//     silhouette de son HTML, qui part avant son premier rendu ;
//   - un module qui demande des barres à la place de ses textes (`@i18nPlaceholder *skeleton`) : en
//     production, un texte traduit en route montre une barre grise (surlignage `mjs-i18n-skel`) à sa
//     place, puis le texte — en développement, la clé ; un texte figé trop tôt (µt dans le <script>,
//     gardé dans une variable) ne laisse pas de barre ni de repeinture à vie ;
//   - un module sans directive attend ses textes comme le défaut le veut (`wait`, doc 29 · i18n § 7) :
//     caché tant que son fragment manque, il paraît d'un coup, complet.
// Puis une page de téléphone (390 px, build prod) : la mise en page, un en-tête fixe, un tiroir hors
// de l'écran, une barre fixe et un bandeau dans le flux n'attendent rien — aucune silhouette pour eux
// (dessinée sans leur style, qui arrive avec leur code, elle n'aurait pas leur place) ; le fil de
// messages, lui, montre la sienne, une fois en place le bandeau qui le précède (avant, il l'aurait
// poussée) ; le texte de la page se voit pendant que leur code est en route ; la page ne saute pas
// (layout-shift, Chromium : moins de 0,01 en tout).
// Enfin une page dont l'en-tête et une carte sont DANS LE FLUX, au-dessus du texte de la page : rien ne
// cache ce qui les suit, qui se voit tout de suite (il descend à leur arrivée) ; la même page servie
// toute faite (un titre et un champ `autofocus` écrits dans le document, sous l'en-tête) : son titre ne
// se cache jamais et reste lu par un lecteur d'écran, le champ garde le focus — trois moteurs.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from 'playwright'
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
    "  $article = Promise.resolve({ titre: 'Un composant lent', texte: 'Son code arrive après les autres.' })",
    '</script>',
    '',
    '<article class="lent">{await $article}{success a}<h3 class="titre">{a.titre}</h3><p class="texte">{a.texte}</p>{end}</article>',
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
                caisse: { visibilite: getComputedStyle(caisse).visibility, boite: barre(caisse) },
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
            // invisible mais à sa place (visibility, jamais display:none) : la page ne saute pas à l'arrivée du texte
            assert.ok(m.caisse.visibilite === 'hidden', `sans directive (wait, le défaut), le module reste invisible tant que son texte n'est pas là : ${JSON.stringify(m.caisse)}`)
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

// la page de téléphone : le code de l'en-tête arrive à 800 ms, celui du tiroir, du bandeau et du dock à 1 s, celui
// du fil de messages à 2 s ; ses messages, 1,2 s après son code (des fenêtres larges : WebKit met du temps à monter sa page)
const RETARDS: [RegExp, number][] = [[/\/entete-[^/]*\.js$/, 800], [/\/(tiroir|bandeau|dock)-[^/]*\.js$/, 1000], [/\/fil-[^/]*\.js$/, 2000]]
const MESURE  = '(() => { window.__decalages = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__decalages.push(e.value) }).observe({ type: "layout-shift", buffered: true }) })()'
// à chaque image, l'état de chaque composant de la page (absent, attente, silhouette, rendu), noté s'il change
const ETATS   = '(() => { window.__etats = []; let prev = ""; const tour = () => { const app = document.querySelector("mjs-app"); const r = app && (app._shadow || app.shadowRoot); if (r) { const e = {}; for (const n of ["entete", "tiroir", "bandeau", "dock", "fil"]) { const el = r.querySelector("mjs-" + n); e[n] = !el ? "absent" : customElements.get("mjs-" + n) ? "rendu" : el.querySelector(":scope > [mjs-skel-zone]") ? "silhouette" : "attente" } const fil = r.querySelector("mjs-fil"); const b = fil && fil.querySelector("[mjs-skel-zone] ul.fil > li.message > b.auteur > i[mjs-skel]"); const rect = b && b.getBoundingClientRect(); e.lignes = fil ? fil.querySelectorAll("[mjs-skel-zone] li.message").length : 0; e.barre = rect ? Math.round(rect.width) + "x" + Math.round(rect.height) : ""; const t = r.querySelector("main > h2.titre"); e.texte = !!t && t.getBoundingClientRect().height > 0 && getComputedStyle(t).visibility === "visible"; const s = JSON.stringify(e); if (s !== prev) { window.__etats.push(e); prev = s } } requestAnimationFrame(tour) }; requestAnimationFrame(tour) })()'

function ecrireTelephone(dir: string): void {
  mkdirSync(join(dir, 'composants'), { recursive: true })
  writeFileSync(join(dir, 'mjs.config.json'), JSON.stringify({ sourceDir: 'composants', outputDir: 'sortie', manifestPath: 'sortie/bundle.js', defaultScriptLang: 'civet', effects: { skeleton: ['await', 'components'] } }))
  writeFileSync(join(dir, 'index.html'), '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>MJS — page de téléphone</title>\n<style>html,body{margin:0;background:#fff;color:#111;font-family:sans-serif}</style>\n</head>\n<body>\n<mjs-app></mjs-app>\n<script type="module" src="bundle.js"></script>\n</body>\n</html>\n')
  const liens = "  $liens = [{ nom: 'Accueil', href: '#accueil' }, { nom: 'Messages', href: '#messages' }, { nom: 'Rendez-vous', href: '#rdv' }, { nom: 'Réglages', href: '#reglages' }]"
  const w = (nom: string, lignes: string[]) => writeFileSync(join(dir, 'composants', nom), lignes.join('\n') + '\n')
  w('app.mjs', ['<div class="app"><@entete></@entete><@tiroir></@tiroir><main class="contenu"><h2 class="titre">Votre fil</h2><p class="intro">Les derniers messages de vos contacts, du plus récent au plus ancien.</p><@bandeau></@bandeau><@fil></@fil></main><@dock></@dock></div>', '', '<style>', '  .contenu', '    padding: 68px 12px 72px', '</style>'])
  w('entete.mjs', ['<script>', liens, '</script>', '', '<header class="entete"><h1 class="titre">Atelier des liens</h1><nav class="liens">{for l in $liens}<a class="lien" href={l.href}>{l.nom}</a>{end}</nav></header>', '', '<style>', '  .entete', '    position: fixed', '    top: 0', '    left: 0', '    right: 0', '    height: 56px', '    box-sizing: border-box', '    padding: 8px 16px', '    background: #1f2937', '    color: #fff', '  .titre', '    margin: 0 0 6px', '    font-size: 22px', '  .liens', '    display: flex', '    gap: 14px', '  .lien', '    color: #fff', '</style>'])
  w('tiroir.mjs', ['<script>', liens, '</script>', '', '<aside class="tiroir"><h2 class="titre">Menu</h2><ul class="liste">{for l in $liens}<li class="ligne"><a class="lien" href={l.href}>{l.nom}</a></li>{end}</ul></aside>', '', '<style>', '  .tiroir', '    position: fixed', '    top: 0', '    bottom: 0', '    left: 0', '    width: 280px', '    transform: translateX(-100%)', '    background: #fff', '</style>'])
  w('bandeau.mjs', ['<script>', "  $nom = 'Zora'", '</script>', '', '<div class="bandeau"><b class="bonjour">Bonjour {$nom}</b><span class="nouveaux">3 messages non lus</span></div>', '', '<style>', '  .bandeau', '    display: flex', '    justify-content: space-between', '    padding: 14px', '    margin: 0 0 12px', '    border-radius: 10px', '    background: #eef2ff', '</style>'])
  w('dock.mjs', ['<nav class="dock"><a class="onglet" href="#fil">Fil</a><a class="onglet" href="#carte">Carte</a><a class="onglet" href="#reglages">Réglages</a></nav>', '', '<style>', '  .dock', '    position: fixed', '    left: 0', '    right: 0', '    bottom: 0', '    height: 56px', '    display: flex', '    align-items: center', '    justify-content: space-around', '    background: #f3f4f6', '</style>'])
  w('fil.mjs', ['<script>', "  $messages = new Promise((ok) -> setTimeout((-> ok([{ nom: 'Ana', mot: 'Un premier message, assez long pour tenir deux lignes au téléphone.' }, { nom: 'Bob', mot: 'Un second message.' }, { nom: 'Cyd', mot: 'Un troisième message.' }])), 1200))", '</script>', '', '<ul class="fil">{await $messages}{success l}{for m in l}<li class="message"><b class="auteur">{m.nom}</b><p class="mot">{m.mot}</p></li>{end}{end}</ul>', '', '<style>', '  .fil', '    list-style: none', '    margin: 0', '    padding: 0', '  .message', '    padding: 12px 0', '    border-bottom: 1px solid #eee', '  .mot', '    margin: 4px 0 0', '</style>'])
}

function serveTelephone(dir: string, port: number, retards = RETARDS): Promise<any> {
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
    const retard = retards.find(([re]) => re.test(url.pathname))
    if (retard) setTimeout(envoyer, retard[1])
    else envoyer()
  })
  return new Promise((ok, ko) => {
    server.on('error', ko)
    server.listen(port, '127.0.0.1', () => ok(server))
  })
}

describe('banc navigateur réel : page de téléphone (390 px) — pas de silhouette pour ce qui n\'attend rien, la page ne saute pas', function () {
  this.timeout(600000)

  let dir = ''
  let server: any = null
  let port = 0

  before(async function () {
    assertDistFrais(MODULARJS_ROOT)
    dir  = mjsTmp('banc-squelettes-telephone')
    port = await freePort()
    ecrireTelephone(dir)
    const r = spawnSync(process.execPath, [BIN_MJS, 'build', '--root', dir, '--prod'], { encoding: 'utf-8', timeout: 120000 })
    assert.equal(r.status, 0, `mjs build --prod en échec :\n${r.stdout}\n${r.stderr}`)
    copyFileSync(join(dir, 'index.html'), join(dir, 'sortie', 'index.html'))
    server = await serveTelephone(dir, port)
  })

  after(async function () {
    if (server) await new Promise<void>((r) => server.close(() => r()))
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  for (const engine of [chromium, firefox, webkit]) {
    describe(`moteur ${engine.name()}`, function () {
      let browser: any = null
      let m: any = null
      const issues: string[] = []

      // la page relève elle-même, à chaque image, ce qui est dessiné (sans la latence d'un sondage depuis le banc) ;
      // relu une fois tout arrivé
      before(async function () {
        browser = await engine.launch()
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
        page.on('console', (msg: any) => { if (msg.type() === 'error') issues.push(`[${engine.name()}] console.error: ${msg.text()}`) })
        page.on('pageerror', (e: any) => { issues.push(`[${engine.name()}] pageerror: ${e.message}`) })
        if (engine === chromium) await page.addInitScript({ content: MESURE })
        await page.addInitScript({ content: ETATS })
        await page.goto(`http://127.0.0.1:${port}/sortie/index.html`, { waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => {
          const app: any = document.querySelector('mjs-app')
          const r = app && (app._shadow || app.shadowRoot)
          const fil: any = r && r.querySelector('mjs-fil')
          const rf = fil && (fil._shadow || fil.shadowRoot)
          const mot: any = rf && rf.querySelector('li.message .mot')
          return !!(mot && mot.textContent.length > 0)
        }, null, { timeout: 60000 })
        await page.waitForTimeout(400)
        m = await page.evaluate(() => {
          const app: any = document.querySelector('mjs-app')
          const fil: any = (app._shadow || app.shadowRoot).querySelector('mjs-fil')
          return { etats: (window as any).__etats, zones: fil.querySelectorAll('[mjs-skel-zone]').length + (fil._shadow || fil.shadowRoot).querySelectorAll('[mjs-skel-zone]').length, decalages: (window as any).__decalages || null }
        })
      })

      after(async function () {
        if (browser) await browser.close()
      })

      it('leur code en route : aucune silhouette pour l\'en-tête, le tiroir, le bandeau ni le dock ; aucune pour le fil tant que le bandeau, avant lui, n\'est pas en place', function () {
        assert.ok(m.etats.some((e: any) => e.bandeau === 'attente' && e.fil === 'attente'), `l'attente du bandeau et du fil a été vue : ${JSON.stringify(m.etats)}`)
        const structure = m.etats.filter((e: any) => ['entete', 'tiroir', 'bandeau', 'dock'].some((n) => e[n] === 'silhouette'))
        assert.deepEqual(structure, [], 'rendus dès que leur code arrive : pas de silhouette')
        const tot = m.etats.filter((e: any) => e.fil === 'silhouette' && (e.bandeau !== 'rendu' || e.tiroir !== 'rendu' || e.entete !== 'rendu'))
        assert.deepEqual(tot, [], 'la silhouette du fil attend que ce qui le précède soit en place')
        // rien ne cache le texte de la page pendant que leur code est en route
        assert.ok(m.etats.some((e: any) => e.texte && e.entete === 'attente' && e.tiroir === 'attente'), `le texte de la page se voit pendant l'attente de l'en-tête et du tiroir : ${JSON.stringify(m.etats)}`)
      })

      it('le bandeau en place, le code du fil en route : sa silhouette, avec ses barres (le rendu des silhouettes de contenu ne change pas)', function () {
        const vue = m.etats.find((e: any) => e.fil === 'silhouette')
        assert.ok(vue, `la silhouette du fil a été vue : ${JSON.stringify(m.etats)}`)
        assert.equal(vue.lignes, 3, 'un {for} : trois fois son contenu')
        const [w, h] = vue.barre.split('x').map(Number)
        assert.ok(w > 30 && h > 8, `la barre du nom a une taille : ${vue.barre}`)
      })

      it('tout arrivé : les messages, plus aucune silhouette ; la page n\'a pas sauté (Chromium : layout-shift)', function () {
        assert.equal(m.zones, 0, 'plus aucune silhouette')
        if (engine === chromium) {
          const total = m.decalages.reduce((a: number, v: number) => a + v, 0)
          assert.ok(total < 0.01, `décalage de mise en page : ${total.toFixed(4)} (${JSON.stringify(m.decalages)})`)
        }
      })

      it('aucune erreur console ni pageerror', function () {
        assert.deepEqual(issues, [])
      })
    })
  }
})

// la page dont l'en-tête et la carte sont DANS LE FLUX, au-dessus du texte de la page : le code de l'en-tête arrive à 600 ms, celui de
// la carte à 800 ms, celui du fil à 1 s, ses messages 1,2 s après ; la même page servie toute faite (`structure.html` : l'en-tête puis,
// écrits dans le document, un titre et un champ `autofocus`)
const RETARDS_FLUX: [RegExp, number][] = [[/\/entete-[^/]*\.js$/, 600], [/\/carte-[^/]*\.js$/, 800], [/\/fil-[^/]*\.js$/, 1000]]
// à chaque image : l'état de l'en-tête, de la carte et du fil, et si le texte de la page (sous l'en-tête) se voit, noté s'il change
const ETATS_FLUX = '(() => { window.__etats = []; let prev = ""; const tour = () => { const app = document.querySelector("mjs-app"); const r = app && (app._shadow || app.shadowRoot); if (r) { const e = {}; for (const n of ["entete", "carte", "fil"]) { const el = r.querySelector("mjs-" + n); e[n] = !el ? "absent" : customElements.get("mjs-" + n) ? "rendu" : el.querySelector(":scope > [mjs-skel-zone]") ? "silhouette" : "attente" } const t = r.querySelector("main > h2.titre"); const b = t && t.getBoundingClientRect(); e.texte = !!b && b.height > 0 && getComputedStyle(t).visibility === "visible"; e.y = b ? Math.round(b.y) : -1; const s = JSON.stringify(e); if (s !== prev) { window.__etats.push(e); prev = s } } requestAnimationFrame(tour) }; requestAnimationFrame(tour) })()'
// à chaque image, dans la page servie toute faite : la visibilité de son titre et l'élément qui a le focus, notés s'ils changent
const TRACE_SERVIE = '(() => { window.__trace = []; let prev = ""; const tour = () => { const t = document.querySelector("main > h2.titre"); const a = document.activeElement; const s = (t ? getComputedStyle(t).visibility : "absent") + " " + (a ? a.localName : "aucun"); if (s !== prev) { window.__trace.push(s); prev = s } requestAnimationFrame(tour) }; requestAnimationFrame(tour) })()'

function ecrireFlux(dir: string): void {
  mkdirSync(join(dir, 'composants'), { recursive: true })
  writeFileSync(join(dir, 'mjs.config.json'), JSON.stringify({ sourceDir: 'composants', outputDir: 'sortie', manifestPath: 'sortie/bundle.js', defaultScriptLang: 'civet', effects: { skeleton: ['await', 'components'] } }))
  writeFileSync(join(dir, 'index.html'), '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>MJS — en-tête dans le flux</title>\n<style>html,body{margin:0;background:#fff;color:#111;font-family:sans-serif}</style>\n</head>\n<body>\n<mjs-app></mjs-app>\n<script type="module" src="bundle.js"></script>\n</body>\n</html>\n')
  writeFileSync(join(dir, 'structure.html'), '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>MJS — page servie, en-tête dans le flux</title>\n<style>html,body{margin:0;background:#fff;color:#111;font-family:sans-serif}</style>\n</head>\n<body>\n<mjs-entete></mjs-entete>\n<main class="contenu"><h2 class="titre">Votre espace</h2><input class="champ" autofocus aria-label="Recherche"></main>\n<script type="module" src="bundle.js"></script>\n</body>\n</html>\n')
  const w = (nom: string, lignes: string[]) => writeFileSync(join(dir, 'composants', nom), lignes.join('\n') + '\n')
  w('app.mjs', ['<div class="app"><@entete></@entete><main class="contenu"><h2 class="titre">Votre espace</h2><p class="intro">Vos messages, vos rendez-vous et vos réglages, au même endroit.</p><@carte></@carte><@fil></@fil></main></div>', '', '<style>', '  .contenu', '    padding: 12px', '</style>'])
  w('entete.mjs', ['<header class="entete"><h1 class="titre">Atelier des liens</h1><nav class="liens"><a class="lien" href="#accueil">Accueil</a><a class="lien" href="#messages">Messages</a><a class="lien" href="#profil">Profil</a></nav></header>', '', '<style>', '  .entete', '    padding: 14px 16px', '    background: #1f2937', '    color: #fff', '  .titre', '    margin: 0 0 6px', '    font-size: 22px', '  .liens', '    display: flex', '    gap: 14px', '  .lien', '    color: #fff', '</style>'])
  w('carte.mjs', ['<script>', "  $titre = 'Bonjour Zora'", "  $texte = 'Trois messages non lus et un rendez-vous demain.'", '</script>', '', '<section class="carte"><h3 class="nom">{$titre}</h3><p class="texte">{$texte}</p></section>', '', '<style>', '  .carte', '    border: 1px solid #ddd', '    border-radius: 12px', '    padding: 16px', '    margin-bottom: 12px', '  .nom', '    margin: 0 0 8px', '  .texte', '    margin: 0', '</style>'])
  w('fil.mjs', ['<script>', "  $messages = new Promise((ok) -> setTimeout((-> ok([{ nom: 'Ana', mot: 'Un premier message, assez long pour tenir deux lignes au téléphone.' }, { nom: 'Bob', mot: 'Un second message.' }, { nom: 'Cyd', mot: 'Un troisième message.' }])), 1200))", '</script>', '', '<ul class="fil">{await $messages}{success l}{for m in l}<li class="message"><b class="auteur">{m.nom}</b><p class="mot">{m.mot}</p></li>{end}{end}</ul>', '', '<style>', '  .fil', '    list-style: none', '    margin: 0', '    padding: 0', '  .message', '    padding: 12px 0', '    border-bottom: 1px solid #eee', '  .mot', '    margin: 4px 0 0', '</style>'])
}

describe('banc navigateur réel : en-tête et carte dans le flux — rien ne cache ce qui les suit, le focus reste', function () {
  this.timeout(600000)

  let dir = ''
  let server: any = null
  let port = 0

  before(async function () {
    assertDistFrais(MODULARJS_ROOT)
    dir  = mjsTmp('banc-squelettes-flux')
    port = await freePort()
    ecrireFlux(dir)
    const r = spawnSync(process.execPath, [BIN_MJS, 'build', '--root', dir, '--prod'], { encoding: 'utf-8', timeout: 120000 })
    assert.equal(r.status, 0, `mjs build --prod en échec :\n${r.stdout}\n${r.stderr}`)
    for (const f of ['index.html', 'structure.html']) copyFileSync(join(dir, f), join(dir, 'sortie', f))
    server = await serveTelephone(dir, port, RETARDS_FLUX)
  })

  after(async function () {
    if (server) await new Promise<void>((r) => server.close(() => r()))
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  for (const engine of [chromium, firefox, webkit]) {
    describe(`moteur ${engine.name()}`, function () {
      let browser: any = null
      let m: any = null
      let s: any = null
      const issues: string[] = []
      const ecoute = (page: any) => {
        page.on('console', (msg: any) => { if (msg.type() === 'error') issues.push(`[${engine.name()}] console.error: ${msg.text()}`) })
        page.on('pageerror', (e: any) => { issues.push(`[${engine.name()}] pageerror: ${e.message}`) })
      }

      before(async function () {
        browser = await engine.launch()
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
        ecoute(page)
        await page.addInitScript({ content: ETATS_FLUX })
        await page.goto(`http://127.0.0.1:${port}/sortie/index.html`, { waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => {
          const app: any = document.querySelector('mjs-app')
          const r = app && (app._shadow || app.shadowRoot)
          const fil: any = r && r.querySelector('mjs-fil')
          const rf = fil && (fil._shadow || fil.shadowRoot)
          const mot: any = rf && rf.querySelector('li.message .mot')
          return !!(mot && mot.textContent.length > 0)
        }, null, { timeout: 60000 })
        await page.waitForTimeout(400)
        m = await page.evaluate(() => ({ etats: (window as any).__etats }))
        await page.close()
        // la page servie toute faite : son titre cherché comme un lecteur d'écran le trouve (l'arbre d'accessibilité) pendant que le code
        // de l'en-tête est en route, puis la trace de ses images une fois l'en-tête rendu
        const servie = await browser.newPage({ viewport: { width: 390, height: 844 } })
        ecoute(servie)
        await servie.addInitScript({ content: TRACE_SERVIE })
        await servie.goto(`http://127.0.0.1:${port}/sortie/structure.html`)
        await servie.waitForTimeout(250)
        const lu      = await servie.getByRole('heading', { name: 'Votre espace' }).count()
        const enRoute = await servie.evaluate(() => !customElements.get('mjs-entete'))
        await servie.waitForFunction(() => !!customElements.get('mjs-entete'), null, { timeout: 60000 })
        await servie.waitForTimeout(400)
        s = { lu, enRoute, trace: await servie.evaluate(() => (window as any).__trace) }
      })

      after(async function () {
        if (browser) await browser.close()
      })

      it('leur code en route : le texte de la page, sous l\'en-tête, se voit tout de suite et ne se cache plus', function () {
        assert.ok(m.etats.some((e: any) => e.texte && e.entete === 'attente'), `le texte se voit pendant l'attente de l'en-tête : ${JSON.stringify(m.etats)}`)
        const k = m.etats.findIndex((e: any) => e.texte)
        assert.deepEqual(m.etats.slice(k).filter((e: any) => !e.texte), [], `une fois vu, il ne se cache plus : ${JSON.stringify(m.etats)}`)
      })

      it('la page servie toute faite, le code de l\'en-tête en route : son titre ne se cache jamais et reste lu par un lecteur d\'écran, le champ `autofocus` garde le focus', function () {
        assert.ok(s.enRoute, 'lu pendant que le code de l\'en-tête est en route')
        assert.equal(s.lu, 1, 'le titre est dans l\'arbre d\'accessibilité pendant l\'attente')
        assert.deepEqual(s.trace.filter((l: string) => l.startsWith('hidden ')), [], `le titre se voit à chaque image : ${JSON.stringify(s.trace)}`)
        const k = s.trace.findIndex((l: string) => l.endsWith(' input'))
        assert.ok(k >= 0, `le champ reçoit le focus : ${JSON.stringify(s.trace)}`)
        assert.deepEqual(s.trace.slice(k).filter((l: string) => !l.endsWith(' input')), [], `il le garde : ${JSON.stringify(s.trace)}`)
      })

      it('aucune erreur console ni pageerror', function () {
        assert.deepEqual(issues, [])
      })
    })
  }
})
