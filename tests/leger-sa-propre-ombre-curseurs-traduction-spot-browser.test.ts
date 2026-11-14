// un composant léger n'a pas d'ombre : son `_shadow` est l'élément lui-même ; plusieurs parcours le prenaient pour une racine d'ombre.
// Chromium, Firefox et WebKit réels, vrais composants compilés :
//   - *cursors, la sélection de la page : partie de l'ombre d'un composant ordinaire et arrêtée juste après un léger (ou partie
//     juste avant lui), elle est envoyée telle quelle ; le léger donné à `getComposedRanges` parmi les racines d'ombre, rien n'était
//     envoyé, sous les trois moteurs ;
//   - les barres de la traduction (surlignage `mjs-i18n-skel`) : douze légers imbriqués, une plage par texte ; le texte d'un léger
//     était repris par chaque léger qui le contient ; 3 000 légers à plat, une peinture qui lit `parentNode` au plus trois fois par
//     léger (remonter tous les parents de chaque léger, chacun cherché dans toute la liste, coûtait comme le carré de leur nombre) ;
//     des lectures comptées plutôt qu'un temps : le verdict ne dépend pas de la charge de la machine ;
//   - *filter(…, spot) dans un parent qui rogne : chaque léger de la scène lu autant de fois que le premier ; chaque étage léger
//     doublait la lecture

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MOTEURS, monterComposants, type Composants } from './helpers/composants-navigateur.js'

const L      = (...l: string[]) => l.join('\n') + '\n'
const IMAGE  = 'data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='300' height='120'><rect width='300' height='120' fill='#f00'/></svg>")
const LEGERS = Array.from({ length: 12 }, (_, i) => `mjs-l${i + 1}`)
// la zone des curseurs : un ordinaire, un léger, un ordinaire ; la scène qui rogne : douze légers imbriqués, puis l'image du spot
const SOURCES: Record<string, string> = {
  hote: L('<script>', "@sock = µsocket 'wss://x.fr/ws'", '</script>', '<div class="z" *cursors(cursor: none, selection: false)><mjs-o></mjs-o><mjs-x mjs-light></mjs-x><mjs-o2></mjs-o2></div>', `<div class="scene"><mjs-l1 mjs-light></mjs-l1><img class="a" *filter(grayscale, spot: 100, soft: 0, smooth: 1) src="${IMAGE}" alt="a"></div>`, '<style>', '.scene', '  width: 300px', '  overflow: hidden', '.a', '  display: block', '  width: 300px', '  height: 120px', '</style>'),
  o:    '<p class="t">ombre de o</p>\n',
  x:    '<p class="t">contenu du léger</p>\n',
  o2:   '<p class="t">ombre de o2</p>\n'
}
for (let i = 1; i <= 12; i++) SOURCES[`l${i}`] = `<p class="t">l${i}</p>` + (i < 12 ? `<mjs-l${i + 1} mjs-light></mjs-l${i + 1}>` : '') + '\n'

const ici    = dirname(fileURLToPath(import.meta.url))
const source = (f: string) => readFileSync(join(ici, '../src/runtime', f), 'utf-8')

const PRET = `(() => { const sh = document.querySelector('mjs-hote')._shadow; return ['mjs-o', 'mjs-x', 'mjs-o2', ...${JSON.stringify(LEGERS)}].every(s => { const e = sh.querySelector(s); return e && e._mjs_is_mounted }) && !!sh.querySelector('img.a') && typeof µ._mjs_fxCursorKit === 'function' })()`

// la trousse des curseurs posée sur la zone, son envoi relevé : chaque sélection rend ce que désigne le chemin envoyé
const CURSEURS = `(async () => {
  const z      = document.querySelector('mjs-hote')._shadow.querySelector('.z')
  const [o, x, o2] = z.children
  const to     = o._shadow.querySelector('.t').firstChild
  const to2    = o2._shadow.querySelector('.t').firstChild
  const ix     = Array.prototype.indexOf.call(z.childNodes, x)
  const envois = []
  const kit    = µ._mjs_fxCursorKit(z, { text: true }, e => envois.push(e.t))
  const noeud  = chemin => { let n = z; for (const i of chemin) n = n && (i === -1 ? n._shadow : n.childNodes[i]); return n }
  const nom    = n => n === to ? 'texte de o' : n === to2 ? 'texte de o2' : n === z ? 'zone' : n ? n.nodeName : String(n)
  const essai  = async (a, ao, b, bo) => {
    getSelection().removeAllRanges()
    await new Promise(r => setTimeout(r, 60))
    envois.length = 0
    getSelection().setBaseAndExtent(a, ao, b, bo)
    await new Promise(r => setTimeout(r, 150))
    const t = envois[envois.length - 1]
    return t ? nom(noeud(t.a)) + '@' + t.ao + ' / ' + nom(noeud(t.b)) + '@' + t.bo : 'rien envoyé'
  }
  const envoye = {
    'témoin, entre deux ordinaires': await essai(to, 1, to2, 2),
    'fin juste après le léger': await essai(to, 1, z, ix + 1),
    'début juste avant le léger': await essai(z, ix, to2, 2)
  }
  getSelection().removeAllRanges()
  kit.destroy()
  return { ix, envoye }
})()`

// les barres peintes par le module de la traduction, joué dans la page : un texte à barres dans chacun des douze légers imbriqués
const BARRES = `(() => {
  const sh     = document.querySelector('mjs-hote')._shadow
  const chaine = ${JSON.stringify(LEGERS)}.map(s => sh.querySelector(s))
  const H      = window.Highlight
  let peint    = null
  window.Highlight = class extends H { constructor() { super(); peint = this } }
  try {
    for (const l of chaine) {
      l.querySelector(':scope > .t').firstChild.data = __i18nSkel
      µ._mjs_i18nComps.add(l)
    }
    __i18nSkelPaint()
  }
  finally {
    window.Highlight = H
    clearTimeout(__i18nSkelTimer)
    for (const l of chaine) µ._mjs_i18nComps.delete(l)
  }
  return peint ? { plages: peint.size, textes: new Set([...peint].map(r => r.startContainer)).size } : null
})()`

// les lectures de `parentNode` pendant une peinture des barres : 3 000 légers à plat sous un ordinaire sans traduction, vingt-quatre
// étages de div plus bas (remonter tous les parents de chaque léger les lirait tous), un texte à barres sur dix ; l'accesseur de
// `Node.prototype` enveloppé le temps de la peinture seule, rendu en `finally`
const COUT = `(() => {
  const sh  = document.querySelector('mjs-hote')._shadow
  const H   = window.Highlight
  const lu  = Object.getOwnPropertyDescriptor(Node.prototype, 'parentNode')
  const o   = sh.appendChild(document.createElement('div'))
  let p     = o._shadow = o.attachShadow({ mode: 'open' })
  let peint = null
  let lus   = 0
  for (let i = 0; i < 24; i++) p = p.appendChild(document.createElement('div'))
  const legers = []
  for (let i = 0; i < 3000; i++) {
    const l = p.appendChild(document.createElement('div'))
    l._shadow = l
    l.appendChild(document.createElement('p')).textContent = i % 10 ? 'texte' : 'a' + __i18nSkel
    legers.push(l)
  }
  window.Highlight = class extends H { constructor() { super(); peint = this } }
  try {
    for (const l of legers) µ._mjs_i18nComps.add(l)
    Object.defineProperty(Node.prototype, 'parentNode', { ...lu, get() { lus++; return lu.get.call(this) } })
    __i18nSkelPaint()
  }
  finally {
    Object.defineProperty(Node.prototype, 'parentNode', lu)
    window.Highlight = H
    clearTimeout(__i18nSkelTimer)
    for (const l of legers) µ._mjs_i18nComps.delete(l)
    o.remove()
  }
  return { legers: legers.length, lus, plages: peint ? peint.size : 0 }
})()`

// les lectures de style des légers de la scène, comptées pendant le survol de l'image
const COMPTE = `(() => {
  const g = window.getComputedStyle
  window.__lus = {}
  window.getComputedStyle = function (e, p) {
    if (e && /^mjs-l\\d+$/.test(e.localName)) window.__lus[e.localName] = (window.__lus[e.localName] || 0) + 1
    return g.call(window, e, p)
  }
  const r = document.querySelector('mjs-hote')._shadow.querySelector('img.a').getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`

for (const moteur of MOTEURS) describe(`composant léger, sa propre ombre : lu une fois, jamais donné comme une ombre — ${moteur}`, function () {
  this.timeout(180000)
  let c: Composants | null = null

  before(async function () {
    c = await monterComposants(SOURCES, moteur)
    if (!c) { console.log(`  ℹ️  ${moteur} non installé : test sauté. Activer : \`npx playwright install ${moteur}\``); this.skip() }
  })

  after(async function () {
    if (c) await c.fermer()
  })

  async function ouvrir() {
    const page    = await c!.client('hote', 'mjs-l12')
    const erreurs = [] as string[]
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    await page.waitForFunction(PRET, null, { timeout: 15000 })
    return { page, erreurs }
  }

  it('*cursors : une sélection partie de l\'ombre d\'un ordinaire et arrêtée juste après un léger (ou partie juste avant lui) est envoyée telle quelle', async () => {
    const { page, erreurs } = await ouvrir()
    try {
      const { ix, envoye } = await page.evaluate(CURSEURS) as { ix: number, envoye: Record<string, string> }
      assert.deepEqual(envoye, {
        'témoin, entre deux ordinaires': 'texte de o@1 / texte de o2@2',
        'fin juste après le léger': `texte de o@1 / zone@${ix + 1}`,
        'début juste avant le léger': `zone@${ix} / texte de o2@2`
      }, 'AVANT, sous les trois moteurs : le léger donné comme racine d\'ombre, rien n\'était envoyé')
      assert.deepEqual(erreurs, [])
    }
    finally { await page.close() }
  })

  it('traduction : douze légers imbriqués, une plage de barres par texte', async () => {
    const { page, erreurs } = await ouvrir()
    try {
      await page.evaluate(source('mjs_i18n.ts') + '\n;0')
      assert.deepEqual(await page.evaluate(BARRES), { plages: 12, textes: 12 }, 'AVANT : le texte d\'un léger repris par chaque léger qui le contient (78 plages pour 12 textes)')
      assert.deepEqual(erreurs, [])
    }
    finally { await page.close() }
  })

  it('traduction : 3 000 légers à plat, une peinture lit `parentNode` au plus trois fois par léger', async () => {
    const { page, erreurs } = await ouvrir()
    try {
      await page.evaluate(source('mjs_i18n.ts') + '\n;0')
      const { legers, lus, plages } = await page.evaluate(COUT) as { legers: number, lus: number, plages: number }
      console.log(`  une peinture, ${legers} légers à plat : ${lus} lectures de parentNode`)
      assert.equal(plages, 300, 'une plage de barres par texte à barres')
      assert.ok(lus <= 3 * legers, `${lus} lectures de parentNode pour ${legers} légers, au plus trois par léger : les parents traversés gardent leur réponse, le léger suivant s'arrête au premier déjà connu ; remonter tous les parents de chaque léger, chacun cherché dans toute la liste, en lit vingt-six par léger ici (le coût croissait comme le carré)`)
      assert.deepEqual(erreurs, [])
    }
    finally { await page.close() }
  })

  it('*filter(…, spot) dans un parent qui rogne : chaque léger de la scène lu autant de fois que le premier', async () => {
    const { page, erreurs } = await ouvrir()
    try {
      const centre = await page.evaluate(COMPTE) as { x: number, y: number }
      await page.mouse.move(centre.x, centre.y, { steps: 3 })
      await page.waitForTimeout(300)
      const lus = await page.evaluate('window.__lus') as Record<string, number>
      assert.ok(lus['mjs-l1'] >= 1, `la scène est lue au survol : ${JSON.stringify(lus)}`)
      assert.deepEqual(LEGERS.map(n => lus[n]), LEGERS.map(() => lus['mjs-l1']), 'AVANT : chaque étage léger doublait la lecture, le douzième lu 2 048 fois plus que le premier')
      assert.deepEqual(erreurs, [])
    }
    finally { await page.close() }
  })
})
