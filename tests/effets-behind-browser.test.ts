// *behind dans Chromium et Firefox réels : des pixels d'une capture et des styles calculés. Le sujet détouré passe devant le contenu de la
// balise et derrière rien ; il hérite de la taille et de la place du fond (même quand un dégradé précède la photo dans la liste
// des fonds) ou les prend de la balise `size`/`position` ; il suit aussi son `background-origin`, son `background-clip` et son
// `background-repeat` ; il ne s'empile pas plus haut que le contenu positionné de la balise (un menu à z-index reste devant lui,
// un menu qui déborde reste au-dessus de la suite de la page) ; au repos, avec ou sans `depth`, le fond (sa copie) et le sujet tombent
// là où ils tombent sans `depth` (avec edge: blur ou une couleur), au pixel, et y reviennent quand la souris s'en va ; le relief décale le sujet et la copie du fond en sens contraires,
// la balise rogne le débord ; le bord que le relief découvre (`edge`) : par défaut le fond et le sujet agrandis ensemble de 1 + 2 × depth / le petit côté de la balise (jamais de bande, le sujet ne
// sort pas de son image, calés l'un sur l'autre au pixel au repos, relu quand la balise change de taille), `blur` (la même photo, floue et agrandie, sous la copie : sans reprise nette de la photo),
// une couleur unie ; un fond cover ne se répète pas dans la copie, un motif en tuiles continue ; la boucle s'arrête quand tout est posé (aucun requestAnimationFrame au repos), les doigts et
// « réduire les animations » n'en ont pas ; une image introuvable le dit ; le retrait ne laisse rien ; le relief ne repeint rien par image (l'image du sujet est posée en littéral sur son calque, jamais derrière une
// variable que le mouvement réécrit ; la trace de Chromium compte moins d'une peinture par dix images, pour le zoom, le flou et la couleur). Aucune attente d'une
// durée pour un mouvement : un état se guette (une marque qui paraît puis s'en va, une valeur qui se pose).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// une image dessinée : étirée (preserveAspectRatio="none") aux dimensions que lui donne le fond
const svg = (w: number, h: number, corps: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${corps}</svg>`).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29')
const ROUGE  = svg(400, 200, '<rect width="400" height="200" fill="#ff0000"/>')
// le sujet : un rectangle bleu qui couvre la moitié gauche de l'image, le reste transparent
const MOITIE = svg(400, 200, '<rect width="200" height="200" fill="#0000ff"/>')
const CARRE  = svg(100, 100, '<rect width="100" height="100" fill="#0000ff"/>')
// un essai de cadrage : la photo est rouge avec un carré bleu, son sujet est le même carré en vert ; au pixel, le vert doit recouvrir
// exactement le bleu de la photo d'une balise sans effet
const PHOTO  = svg(400, 200, '<rect width="400" height="200" fill="#ff0000"/><rect x="100" y="50" width="120" height="100" fill="#0000ff"/>')
const SUJET  = svg(400, 200, '<rect x="100" y="50" width="120" height="100" fill="#00ff00"/>')
// le même carré, collé au bord gauche : une part tombe dans le cadre que `background-clip: content-box` ne peint pas
const PHOTOG = svg(400, 200, '<rect width="400" height="200" fill="#ff0000"/><rect x="0" y="50" width="120" height="100" fill="#0000ff"/>')
const SUJETG = svg(400, 200, '<rect x="0" y="50" width="120" height="100" fill="#00ff00"/>')
// deux moitiés, rouge et verte : la couture se déplace quand la copie du fond bouge ; un petit sujet dans le coin, qui ne gêne pas
const COUTURE = svg(400, 200, '<rect width="200" height="200" fill="#ff0000"/><rect x="200" width="200" height="200" fill="#00ff00"/>')
const COIN    = svg(400, 200, '<rect width="10" height="10" fill="#0000ff"/>')
// le repos : une photo CARRÉE (200 × 200) dans des balises de 400 × 160, donc d'une autre proportion qu'elles ; des bandes verticales et des filets
// horizontaux, pour qu'un écart d'échelle ou de place, même d'un pixel, se voie sur chaque arête ; un sujet de deux rectangles pleins. Tout est en
// multiples de 10 : aux échelles de l'essai (2 en cover, 0,8 en contain, 0,6 × 0,4 en tuiles) chaque arête tombe sur un pixel entier, donc la mesure
// ne voit que la place et l'échelle, pas le lissage des arêtes (que le moteur fait autrement quand il peint une zone plus grande)
const BANDES   = svg(200, 200, Array.from({ length: 10 }, (_, i) => `<rect x="${i * 20}" width="20" height="200" fill="${['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#1d3557', '#ffb703'][i % 6]}"/>`).join('') + Array.from({ length: 5 }, (_, i) => `<rect y="${20 + i * 40}" width="200" height="10" fill="#ff7f11"/>`).join('') + '<rect x="80" y="90" width="40" height="30" fill="#2a9d8f"/>')
const FORMES   = svg(200, 200, '<rect x="50" y="80" width="50" height="50" fill="#ff00ff"/><rect x="130" y="70" width="40" height="40" fill="#ffff00"/>')
// le bord : une photo de 300 × 150 aux quatre bords de couleurs différentes (ciel en haut, sol en bas, rouge à gauche, jaune à droite) dans des balises de la même
// taille (le `cover` ne dépasse pas la balise), un motif de 60 × 40 pour les tuiles, un sujet entièrement transparent (seule la copie du fond se regarde). Tout est en
// multiples de 10 : à l'échelle 1, chaque arête tombe sur un pixel entier
const PAYSAGE = svg(300, 150, '<rect width="300" height="150" fill="#2a9d8f"/><rect width="300" height="20" fill="#87ceeb"/><rect y="130" width="300" height="20" fill="#6b4423"/><rect y="20" width="20" height="110" fill="#e63946"/><rect x="280" y="20" width="20" height="110" fill="#ffb703"/><rect x="130" y="60" width="40" height="30" fill="#1d3557"/>')
const MOTIF   = svg(60, 40, '<rect width="60" height="40" fill="#1d3557"/><rect width="30" height="20" fill="#f1faee"/><rect x="30" y="20" width="30" height="20" fill="#e63946"/><rect x="10" y="10" width="10" height="10" fill="#ffb703"/>')
const VIDE    = svg(300, 150, '')
// le zoom : des boîtes de 200 × 100 et depth: 10 — le zoom vaut 1 + 2 × 10 / 100 = 1,2 (la photo passe de 200 × 100 à 240 × 120). La photo est faite de bandes de couleur et d'un carré bleu que le sujet
// reprend en vert ; tout est en multiples de 5 (de 6 une fois agrandi) : chaque arête tombe sur un pixel entier, la mesure ne voit que la place et l'échelle
const PHOTOZ  = svg(200, 100, Array.from({ length: 8 }, (_, i) => `<rect x="${i * 25}" width="25" height="100" fill="${['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#1d3557', '#ffb703', '#2a9d8f', '#e76f51'][i]}"/>`).join('') + '<rect x="60" y="30" width="80" height="40" fill="#0000ff"/>')
const SUJETZ  = svg(200, 100, '<rect x="60" y="30" width="80" height="40" fill="#00ff00"/>')
const PLEIN   = svg(200, 100, '<rect width="200" height="100" fill="#00ff00"/>')
// le flou : des filets de 10 px sur noir (rouge à gauche, bleu à droite), assez larges pour qu'un flou trop faible les laisse lisibles : une reprise nette de la photo se voit à leurs arêtes (un écart de 255 entre deux
// pixels voisins), une photo assez floue n'en a plus
const FILETS  = svg(300, 150, '<rect width="300" height="150" fill="#000"/>' + Array.from({ length: 15 }, (_, i) => `<rect x="${i * 20}" width="10" height="150" fill="${i < 8 ? '#ff0000' : '#0000ff'}"/>`).join(''))

// la peinture : un paysage et son sujet, des aplats et des filets (le contenu change d'un pixel à l'autre : une re-trame ne passe pas inaperçue)
const PAYSAGEP = svg(600, 300, '<rect width="600" height="300" fill="#2a9d8f"/><rect width="600" height="60" fill="#87ceeb"/><rect y="240" width="600" height="60" fill="#6b4423"/>' + Array.from({ length: 12 }, (_, i) => `<rect x="${i * 50 + 10}" y="${70 + (i % 4) * 30}" width="30" height="${40 + (i % 3) * 20}" fill="${['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#1d3557', '#ffb703'][i % 6]}"/>`).join(''))
const SUJETP   = svg(600, 300, '<rect x="220" y="60" width="160" height="200" fill="#00ff00"/><circle cx="300" cy="50" r="40" fill="#ff00ff"/>')

const SOURCES: Record<string, string> = {
  'fb-behind.mjs': [
    `<header class="a" *behind('${MOITIE}')><div class="mur"></div></header>`,
    `<header class="s0" *behind('${MOITIE}')><div class="mur"></div></header>`,
    `<header class="s1" *behind('${MOITIE}', size: contain, position: top-left)><div class="mur"></div></header>`,
    `<header class="c" *behind('${CARRE}')><div class="mur"></div></header>`,
    `<header class="r" *behind('${MOITIE}', depth: 14)><div class="mur"></div></header>`
  ].join('\n') + `\n<style>\nbody\n  margin: 0\nheader\n  display: grid\n  place-items: center\n  width: 400px\n  height: 200px\n  margin: 0 0 20px 20px\n  background: url("${ROUGE}") center / cover\n.mur\n  width: 300px\n  height: 100px\n  background: #fff\n.c\n  width: 300px\n  background: linear-gradient(rgba(0, 0, 0, .5), rgba(0, 0, 0, .5)), url("${ROUGE}") 10% 20% / 80% 60% no-repeat\n</style>\n`,
  // l'empilement : un menu à z-index qui déborde de la balise, sous une suite à z-index 1 ; et trois blocs dans une balise (non positionné,
  // positionné sans z-index, positionné à z-index 5)
  'fb-behind-pile.mjs': [
    `<div class="pile"><header class="e" *behind('${MOITIE}')><div class="menu"></div></header><div class="suite"></div></div>`,
    `<header class="t" *behind('${MOITIE}')><div class="mur"></div><div class="pos"></div><div class="haut"></div></header>`
  ].join('\n') + `\n<style>\nbody\n  margin: 0\n.pile\n  width: 400px\n  margin: 0 0 20px 20px\nheader\n  display: block\n  width: 400px\n  background: url("${ROUGE}") 0 0 / 100% 100% no-repeat\n.e\n  position: relative\n  height: 100px\n.menu\n  position: absolute\n  left: 20px\n  top: 80px\n  width: 160px\n  height: 100px\n  background: #ffaa00\n  z-index: 10\n.suite\n  position: relative\n  z-index: 1\n  height: 120px\n  background: #003366\n.t\n  height: 330px\n  margin: 0 0 20px 20px\n.mur, .pos, .haut\n  width: 300px\n  height: 100px\n  margin-left: 50px\n  background: #fff\n.pos\n  position: relative\n.haut\n  position: relative\n  z-index: 5\n  background: #ffff00\n</style>\n`,
  // le cadrage du sujet sur le fond : l'origine (content-box et un padding), le rognage (content-box), la répétition ; chaque balise a son
  // témoin sans effet, au même style
  'fb-behind-fond.mjs': [
    `<header class="o" *behind('${SUJET}')></header><header class="o0"></header>`,
    `<header class="c" *behind('${SUJETG}')></header><header class="c0"></header>`,
    `<header class="r" *behind('${SUJET}')></header><header class="r0"></header>`
  ].join('\n') + `\n<style>\nbody\n  margin: 0\nheader\n  box-sizing: border-box\n  width: 400px\n  height: 200px\n  margin: 0 0 20px 20px\n  padding: 30px\n.o, .o0\n  background: url("${PHOTO}") center / cover no-repeat\n  background-origin: content-box\n.c, .c0\n  background: url("${PHOTOG}") 0 0 / 100% 100% no-repeat\n  background-clip: content-box\n.r, .r0\n  padding: 0\n  background: url("${PHOTO}") 0 0 / 200px 100px repeat\n</style>\n`,
  // le relief : la couture rouge et verte de la photo bouge avec la copie du fond ; un bloc blanc de contenu au milieu
  'fb-behind-relief.mjs': `<header class="k" *behind('${COIN}', depth: 14)><div class="mur"></div></header>\n<style>\nbody\n  margin: 0\nheader\n  display: grid\n  place-items: center\n  width: 400px\n  height: 200px\n  margin: 0 0 20px 20px\n  background: url("${COUTURE}") center / cover\n.mur\n  width: 100px\n  height: 100px\n  background: #fff\n</style>\n`,
  // le repos : quatre fonds, chacun sur deux balises jumelles (sans `depth`, puis `depth: 18`), de même style, de même photo, de même sujet
  'fb-behind-repos.mjs': [
    `<header class="cv0" *behind('${FORMES}')><div class="mur"></div></header>`,
    `<header class="cv18" *behind('${FORMES}', depth: 18, edge: blur)><div class="mur"></div></header>`,
    `<header class="ct0" *behind('${FORMES}')><div class="mur"></div></header>`,
    `<header class="ct18" *behind('${FORMES}', depth: 18, edge: blur)><div class="mur"></div></header>`,
    `<header class="cc0" *behind('${FORMES}')><div class="mur"></div></header>`,
    `<header class="cc18" *behind('${FORMES}', depth: 18, edge: '#101014')><div class="mur"></div></header>`,
    `<header class="ec0" *behind('${FORMES}', size: contain, position: top-left)><div class="mur"></div></header>`,
    `<header class="ec18" *behind('${FORMES}', size: contain, position: top-left, depth: 18, edge: '#101014')><div class="mur"></div></header>`,
    `<header class="px0" *behind('${FORMES}')><div class="mur"></div></header>`,
    `<header class="px18" *behind('${FORMES}', depth: 18, edge: blur)><div class="mur"></div></header>`
  ].join('\n') + `\n<style>\nbody\n  margin: 0\nheader\n  display: grid\n  place-items: center\n  width: 400px\n  height: 160px\n  margin: 0 0 10px 20px\n  background-color: #222\n.mur\n  width: 100px\n  height: 60px\n  background: #fff\n.cv0, .cv18\n  background-image: url("${BANDES}")\n  background-position: center\n  background-size: cover\n.ct0, .ct18, .cc0, .cc18\n  background: #222 url("${BANDES}") 20% 70% / contain no-repeat\n.ec0, .ec18\n  background-image: url("${BANDES}")\n  background-position: center\n  background-size: cover\n.px0, .px18\n  background: #222 url("${BANDES}") 10px 5px / 120px 80px repeat\n</style>\n`,
  // le bord, une couleur : le relief mené au coin découvre depth px à droite et en bas, que la couleur remplit. cv : un fond cover de la proportion de la balise, son témoin sans effet (0) et son témoin
  // décalé de depth (S : ce que la copie du fond montre là où elle couvre encore) ; px : un motif en tuiles (taille en px, répété) et son témoin décalé ; ws : un fond `100% auto` (pas un cover pour le
  // style) avec `size: cover` écrit sur l'effet ; ml : deux fonds (un motif, puis la photo en cover) ; col : la couleur unie que la bande doit montrer, au lieu de la photo en place ou du bord opposé
  'fb-behind-bord.mjs': [
    `<header class="cv0"></header>`,
    `<header class="cvS"></header>`,
    `<header class="cv18" *behind('${VIDE}', depth: 18, edge: '#101014')></header>`,
    `<header class="pxS"></header>`,
    `<header class="px18" *behind('${VIDE}', depth: 18, edge: '#101014')></header>`,
    `<header class="ws18" *behind('${VIDE}', size: cover, depth: 18, edge: '#101014')></header>`,
    `<header class="ml18" *behind('${VIDE}', depth: 18, edge: '#101014')></header>`,
    `<header class="col"></header>`
  ].join('\n') + `\n<style>\nbody\n  margin: 0\nheader\n  display: block\n  width: 300px\n  height: 150px\n  margin: 0 0 10px 20px\n.cv0, .cvS, .cv18\n  background: url("${PAYSAGE}") center / cover\n.cvS\n  background-position: -18px -18px\n.pxS, .px18\n  background: #222 url("${MOTIF}") 10px 5px / 60px 40px repeat\n.pxS\n  background-position: -8px -13px\n.ws18\n  background: url("${PAYSAGE}") 0 0 / 100% auto\n.ml18\n  background: url("${MOTIF}") 0 0 / 60px 40px, url("${PAYSAGE}") center / cover\n.col\n  background: #101014\n</style>\n`,
  // le bord, le zoom (le défaut) : za au repos et sa jumelle zaT, qui montre le fond et le sujet agrandis de 1,2 ; zb (la souris au coin) et zbT, qui les montre agrandis ET décalés de 10 px (le sujet vers
  // le coin, le fond à l'opposé) ; zc : un sujet qui remplit toute son image, et zv (vert uni) ; zr : une balise que l'on redimensionne, et sa jumelle zrT à la taille d'arrivée (1 + 2 × 10 / 50 = 1,4 : 280 × 140)
  'fb-behind-zoom.mjs': [
    `<header class="za" *behind('${SUJETZ}', depth: 10)></header>`,
    `<header class="zaT"></header>`,
    `<header class="zb" *behind('${SUJETZ}', depth: 10)></header>`,
    `<header class="zbT"></header>`,
    `<header class="zc" *behind('${PLEIN}', depth: 10)></header>`,
    `<header class="zv"></header>`,
    `<header class="zr" *behind('${VIDE}', depth: 10)></header>`,
    `<header class="zrT"></header>`
  ].join('\n') + `\n<style>\nbody\n  margin: 0\nheader\n  display: block\n  width: 200px\n  height: 100px\n  margin: 0 0 10px 20px\n.za, .zb, .zc, .zr\n  background: url("${PHOTOZ}") center / cover\n.zaT\n  background: url("${SUJETZ}") center / 240px 120px no-repeat, url("${PHOTOZ}") center / 240px 120px no-repeat\n.zbT\n  background: url("${SUJETZ}") -10px 0 / 240px 120px no-repeat, url("${PHOTOZ}") -30px -20px / 240px 120px no-repeat\n.zv\n  background: #00ff00\n.zrT\n  height: 50px\n  background: url("${PHOTOZ}") center / 280px 140px no-repeat\n</style>\n`,
  // le bord, le flou : fl18 (le relief, edge: blur) et fl0 (la même balise sans l'effet : la photo en place, nette)
  'fb-behind-flou.mjs': [
    `<header class="fl18" *behind('${VIDE}', depth: 18, edge: blur)></header>`,
    `<header class="fl0"></header>`
  ].join('\n') + `\n<style>\nbody\n  margin: 0\nheader\n  display: block\n  width: 300px\n  height: 150px\n  margin: 0 0 10px 20px\n  background: url("${FILETS}") center / cover\n</style>\n`,
  // le bord tenu par une variable : un mot que le navigateur ne connaît pas comme couleur (retombe sur le zoom), une couleur valide
  'fb-behind-variable.mjs': `<script>\n$mauvais = 'zom'\n$bonne = '#101014'\n</script>\n<header class="v1" *behind('${VIDE}', depth: 10, edge: $mauvais)></header>\n<header class="v2" *behind('${VIDE}', depth: 10, edge: $bonne)></header>\n<style>\nbody\n  margin: 0\nheader\n  display: block\n  width: 200px\n  height: 100px\n  margin: 0 0 10px 20px\n  background: url("${PHOTOZ}") center / cover\n</style>\n`,
  // le bord par un nom de couleur : nm (edge: black) et son témoin noir uni (nm0)
  'fb-behind-nom.mjs': [
    `<header class="nm" *behind('${VIDE}', depth: 18, edge: black)></header>`,
    `<header class="nm0"></header>`
  ].join('\n') + `\n<style>\nbody\n  margin: 0\nheader\n  display: block\n  width: 300px\n  height: 150px\n  margin: 0 0 10px 20px\n.nm\n  background: url("${PAYSAGE}") center / cover\n.nm0\n  background: #000\n</style>\n`,
  // la faute de frappe : fa (edge: zooom) et fz (edge: zoom), de même photo et de même sujet
  'fb-behind-faute.mjs': [
    `<header class="fa" *behind('${SUJETZ}', depth: 10, edge: zooom)></header>`,
    `<header class="fz" *behind('${SUJETZ}', depth: 10, edge: zoom)></header>`
  ].join('\n') + `\n<style>\nbody\n  margin: 0\nheader\n  display: block\n  width: 200px\n  height: 100px\n  margin: 0 0 10px 20px\n  background: url("${PHOTOZ}") center / cover\n</style>\n`,
  // le bord tenu par une variable qui passe de black à une faute de frappe (zooom) puis à blur
  'fb-behind-nom-variable.mjs': `<script>\n$e = 'black'\n</script>\n<header class="v" *behind('${VIDE}', depth: 10, edge: $e)></header>\n<button class="n" @click={$e = 'black'}>n</button>\n<button class="x" @click={$e = 'zooom'}>x</button>\n<button class="f" @click={$e = 'blur'}>f</button>\n<style>\nbody\n  margin: 0\nheader\n  display: block\n  width: 200px\n  height: 100px\n  margin: 0 0 10px 20px\n  background: url("${PHOTOZ}") center / cover\n</style>\n`,
  // la peinture pendant le relief : trois balises de 600 × 300, une par bord (zoom, flou, couleur), un fond et un sujet faits de grands aplats
  'fb-behind-peinture.mjs': [
    `<header class="pz" *behind('${SUJETP}', depth: 18)></header>`,
    `<header class="pb" *behind('${SUJETP}', depth: 18, edge: blur)></header>`,
    `<header class="pc" *behind('${SUJETP}', depth: 18, edge: '#101014')></header>`
  ].join('\n') + `\n<style>\nbody\n  margin: 0\nheader\n  display: block\n  width: 600px\n  height: 300px\n  margin: 0 0 20px 20px\n  background: url("${PAYSAGEP}") center / cover\n</style>\n`,
  'fb-behind-absente.mjs': `<header class="a" *behind('/absente.png')><div class="mur"></div></header>\n<style>\nheader\n  width: 400px\n  height: 200px\n.mur\n  width: 100px\n  height: 100px\n</style>\n`,
  'fb-behind-retrait.mjs': `<script>\n$on = true\n</script>\n{if $on}<header class="a" *behind('${MOITIE}', depth: 10)><div class="mur"></div></header>{end}\n{if $on}<header class="b" *behind('${MOITIE}', depth: 10, edge: blur)><div class="mur"></div></header>{end}\n<button class="t" @click={$on = !$on}>t</button>\n<style>\nheader\n  width: 400px\n  height: 200px\n.mur\n  width: 100px\n  height: 100px\n</style>\n`
}

for (const nom of ['chromium', 'firefox'] as const) {
describe(`*behind (${nom} réel) — des pixels`, function () {
  this.timeout(120000)
  let present = false
  let script  = ''

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) {
      console.log(`  ℹ️  ${nom} non installé, test de *behind sauté. Activer : \`npx playwright install ${nom}\``)
      return
    }
    const root   = mjsTmp('effets-behind-browser-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  // la balise `classe` est là ET son calque est posé (un état attendu, pas une durée) ; le reste du délai laisse décoder les images dessinées
  async function ouvre(browser: any, tag: string, classe: string, opts: { calm?: boolean } = {}) {
    const page    = await browser.newPage({ viewport: { width: 700, height: 1800 }, reducedMotion: opts.calm ? 'reduce' : 'no-preference' })
    const journal = { erreurs: [] as string[] }
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') journal.erreurs.push(m.text()) })
    page.on('pageerror', (e: any) => journal.erreurs.push(String(e)))
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() === 'http://t.test/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction(([t, c]: string[]) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.' + c + ' [mjs-fx-layer="behind"]'), [tag, classe], { timeout: 30000 })
    await page.waitForTimeout(500)
    return { page, journal }
  }

  const TAG = 'mjs-fb-behind'
  const boite = (page: any, classe: string, tag = TAG) => page.evaluate(([t, c]: string[]) => {
    const r = (document.querySelector(t) as any)._shadow.querySelector('.' + c).getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }, [tag, classe])

  async function pixels(page: any, points: number[][]): Promise<number[][]> {
    const png = (await page.screenshot()).toString('base64')
    return page.evaluate(async ([b64, ps]: [string, number[][]]) => {
      const im = new Image()
      im.src = 'data:image/png;base64,' + b64
      await im.decode()
      const c = document.createElement('canvas')
      c.width  = im.width
      c.height = im.height
      const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
      x.drawImage(im, 0, 0)
      return ps.map(([px, py]) => Array.from(x.getImageData(px, py, 1, 1).data).slice(0, 3))
    }, [png, points])
  }

  // dans chaque rectangle : les pixels d'un bleu franc et d'un vert franc (les bords adoucis n'en sont pas) — leur nombre et leur boîte
  // [x0, y0, x1, y1] relevée depuis le coin du rectangle
  type Reperes = { n: number, boite: number[] }
  async function reperes(page: any, zones: Array<{ x: number, y: number, w: number, h: number }>): Promise<Array<{ bleu: Reperes, vert: Reperes }>> {
    const png = (await page.screenshot()).toString('base64')
    return page.evaluate(async ([b64, zs]: [string, Array<{ x: number, y: number, w: number, h: number }>]) => {
      const im = new Image()
      im.src = 'data:image/png;base64,' + b64
      await im.decode()
      const c = document.createElement('canvas')
      c.width  = im.width
      c.height = im.height
      const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
      x.drawImage(im, 0, 0)
      return zs.map((z) => {
        const w = Math.round(z.w)
        const d = x.getImageData(Math.round(z.x), Math.round(z.y), w, Math.round(z.h)).data
        const bleu = { n: 0, boite: [1e9, 1e9, -1, -1] }
        const vert = { n: 0, boite: [1e9, 1e9, -1, -1] }
        for (let i = 0; i < d.length; i += 4) {
          const t = d[i + 2] >= 200 && d[i] <= 40 && d[i + 1] <= 40 ? bleu : d[i + 1] >= 200 && d[i] <= 40 && d[i + 2] <= 40 ? vert : null
          if (!t) continue
          const px = (i / 4) % w
          const py = Math.floor(i / 4 / w)
          t.n++
          t.boite = [Math.min(t.boite[0], px), Math.min(t.boite[1], py), Math.max(t.boite[2], px), Math.max(t.boite[3], py)]
        }
        return { bleu, vert }
      })
    }, [png, zones])
  }

  // toutes les balises ont leur calque (ou `calques` sujets et autant de copies du fond, quand des balises témoins n'ont pas l'effet) ET toutes les images de fond (balises et
  // calques) sont décodées avant une capture : un état attendu, pas une durée
  const decodees = async (page: any, tag: string, calques = 0) => {
    await page.waitForFunction(([t, n]: [string, number]) => {
      const sh = (document.querySelector(t) as any)._shadow
      if (n > 0) return sh.querySelectorAll('[mjs-fx-layer="behind"]').length === n && sh.querySelectorAll('[mjs-fx-layer="behind-bg"]').length === n
      return sh.querySelectorAll('header').length > 0 && sh.querySelectorAll('header').length === sh.querySelectorAll('header > [mjs-fx-layer="behind"]').length
    }, [tag, calques], { timeout: 30000 })
    await page.evaluate(async (t: string) => {
      const sh   = (document.querySelector(t) as any)._shadow
      const urls = new Set<string>()
      for (const e of sh.querySelectorAll('header, [mjs-fx-layer]')) for (const m of getComputedStyle(e).backgroundImage.matchAll(/url\("([^"]*)"\)/g)) urls.add(m[1])
      await Promise.all([...urls].map((u) => { const i = new Image(); i.src = u; return i.decode() }))
      await new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(fin)))
    }, tag)
  }

  // deux rectangles de même taille de la MÊME capture, pixel contre pixel : combien de pixels diffèrent de plus de `seuil` (sur un canal), et le plus grand écart
  type Zone = { x: number, y: number, w: number, h: number }
  async function ecarts(page: any, paires: Array<[Zone, Zone]>, seuil: number): Promise<Array<{ n: number, max: number, total: number, couleurs: number }>> {
    const png = (await page.screenshot()).toString('base64')
    return page.evaluate(async ([b64, ps, s]: [string, Array<[Zone, Zone]>, number]) => {
      const im = new Image()
      im.src = 'data:image/png;base64,' + b64
      await im.decode()
      const c = document.createElement('canvas')
      c.width  = im.width
      c.height = im.height
      const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
      x.drawImage(im, 0, 0)
      return ps.map(([a, b]) => {
        const w = Math.round(a.w)
        const h = Math.round(a.h)
        const A = x.getImageData(Math.round(a.x), Math.round(a.y), w, h).data
        const B = x.getImageData(Math.round(b.x), Math.round(b.y), w, h).data
        let n      = 0
        let max    = 0
        const vues = new Set<number>()
        for (let i = 0; i < A.length; i += 4) {
          const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]))
          if (d > s) n++
          if (d > max) max = d
          vues.add(A[i] * 65536 + A[i + 1] * 256 + A[i + 2])
        }
        return { n, max, total: w * h, couleurs: vues.size }
      })
    }, [png, paires, seuil])
  }

  const rouge  = (p: number[]) => p[0] >= 250 && p[1] <= 4 && p[2] <= 4
  const vert   = (p: number[]) => p[1] >= 250 && p[0] <= 4 && p[2] <= 4
  const bleu   = (p: number[]) => p[2] >= 250 && p[0] <= 4 && p[1] <= 4
  const blanc  = (p: number[]) => p.every((v) => v >= 250)
  const noir   = (p: number[]) => p.every((v) => v <= 4)
  const orange = (p: number[]) => p[0] >= 250 && Math.abs(p[1] - 170) <= 6 && p[2] <= 4
  const jaune  = (p: number[]) => p[0] >= 250 && p[1] >= 250 && p[2] <= 4
  // les images d'animation demandées pendant 600 ms (l'absence se compte, elle ne s'attend pas)
  const imagesDemandees = (page: any) => page.evaluate(async () => {
    let k = 0
    const o = window.requestAnimationFrame
    window.requestAnimationFrame = function(f) { k++; return o.call(window, f) }
    await new Promise((res) => setTimeout(res, 600))
    window.requestAnimationFrame = o
    return k
  })
  const lancer = async () => (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-sandbox'] } : {})

  // le mouvement du relief se guette : la marque `mjs-fx-moving` du sujet paraît (avec le will-change qu'elle pose) puis s'en va
  // (will-change rendu) ; chaque passage est noté, un geste en fait deux. On attend ces deux passages, jamais une durée.
  const guette = (page: any, classe: string, tag = 'mjs-fb-behind') => page.evaluate(([c, t]: string[]) => {
    const w   = window as any
    const cut = (document.querySelector(t) as any)._shadow.querySelector('.' + c + ' [mjs-fx-layer="behind"]') as HTMLElement
    w.__passages = []
    new MutationObserver(() => w.__passages.push([cut.hasAttribute('mjs-fx-moving'), getComputedStyle(cut).willChange])).observe(cut, { attributes: true, attributeFilter: ['mjs-fx-moving'] })
  }, [classe, tag])
  const geste = async (page: any, bouge: () => Promise<void>) => {
    await page.evaluate(() => { (window as any).__passages = [] })
    await bouge()
    await page.waitForFunction(() => (window as any).__passages.length >= 2, null, { timeout: 30000 })
    return page.evaluate(() => (window as any).__passages)
  }

  it('le sujet passe devant le contenu de la balise (le texte passe derrière), et laisse voir ce qui est transparent', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, TAG, 'a')
      const a = await boite(page, 'a')
      // le « mot » est un bloc blanc de 300 × 100 au centre ; le sujet couvre la moitié gauche de la balise
      const pts = [[a.x + 100, a.y + 100], [a.x + 300, a.y + 100], [a.x + 100, a.y + 20], [a.x + 300, a.y + 20], [a.x + 380, a.y + 100]]
      const [recouvert, mot, sujet, fond, bord] = await pixels(page, pts)
      assert.ok(bleu(recouvert), 'là où le mot et le sujet se recouvrent : le sujet — ' + recouvert)
      assert.ok(blanc(mot), 'le mot, hors du sujet : visible — ' + mot)
      assert.ok(bleu(sujet), 'le sujet seul, sur le fond — ' + sujet)
      assert.ok(rouge(fond), 'le fond, là où le sujet est transparent — ' + fond)
      assert.ok(rouge(bord), 'le fond, à côté du mot — ' + bord)
      const etat = await page.evaluate(() => {
        const hd = (document.querySelector('mjs-fb-behind') as any)._shadow.querySelector('.a')
        const l = hd.querySelector('[mjs-fx-layer="behind"]')
        const cs = getComputedStyle(l)
        const top = (document.querySelector('mjs-fb-behind') as any)._shadow.elementFromPoint(hd.getBoundingClientRect().left + 100, hd.getBoundingClientRect().top + 100)
        return { dernier: hd.lastElementChild === l, aria: l.getAttribute('aria-hidden'), evenements: cs.pointerEvents, z: cs.zIndex, position: cs.position, isolation: getComputedStyle(hd).isolation, fixe: getComputedStyle(hd).position, sous: top.className, relief: l.hasAttribute('mjs-fx-relief'), copie: !!hd.querySelector('[mjs-fx-layer="behind-bg"]') }
      })
      assert.deepEqual(etat, { dernier: true, aria: 'true', evenements: 'none', z: 'auto', position: 'absolute', isolation: 'auto', fixe: 'relative', sous: 'mur', relief: false, copie: false })
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })

  it('rien de plus haut que le contenu : un menu qui déborde reste au-dessus de la suite de la page, un enfant à z-index reste devant le sujet, le texte (même positionné) passe derrière', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, 'mjs-fb-behind-pile', 'e')
      const e = await boite(page, 'e', 'mjs-fb-behind-pile')
      const t = await boite(page, 't', 'mjs-fb-behind-pile')
      const [debord, devant, mur1, mur2, pos1, pos2, haut1, haut2] = await pixels(page, [
        [e.x + 100, e.y + e.h + 40], [e.x + 100, e.y + 90],
        [t.x + 150, t.y + 50], [t.x + 300, t.y + 50], [t.x + 150, t.y + 150], [t.x + 300, t.y + 150], [t.x + 150, t.y + 250], [t.x + 300, t.y + 250]
      ].map(([x, y]) => [Math.round(x), Math.round(y)]))
      assert.ok(orange(debord), 'le menu (z-index 10) qui déborde sous la balise passe au-dessus de la suite (z-index 1) — ' + debord)
      assert.ok(orange(devant), 'le menu (z-index 10) reste devant le sujet — ' + devant)
      assert.ok(bleu(mur1) && blanc(mur2), 'un bloc non positionné passe derrière le sujet — ' + mur1 + ' / ' + mur2)
      assert.ok(bleu(pos1) && blanc(pos2), 'un bloc positionné sans z-index passe derrière le sujet — ' + pos1 + ' / ' + pos2)
      assert.ok(jaune(haut1) && jaune(haut2), 'un bloc à z-index 5 reste devant le sujet — ' + haut1 + ' / ' + haut2)
      const etat = await page.evaluate(() => {
        const hd = (document.querySelector('mjs-fb-behind-pile') as any)._shadow.querySelector('.e')
        const l = hd.querySelector('[mjs-fx-layer="behind"]')
        return { isolation: getComputedStyle(hd).isolation, zBalise: getComputedStyle(hd).zIndex, zSujet: getComputedStyle(l).zIndex }
      })
      assert.deepEqual(etat, { isolation: 'auto', zBalise: 'auto', zSujet: 'auto' }, 'la balise n\'est pas un contexte d\'empilement')
      // la limite écrite : un enfant positionné (sans z-index) ajouté APRÈS la pose suit le sujet dans l'arbre, donc passe devant lui
      await page.evaluate(() => {
        const hd = (document.querySelector('mjs-fb-behind-pile') as any)._shadow.querySelector('.t') as HTMLElement
        const tard = document.createElement('div')
        tard.style.cssText = 'position:absolute;left:50px;top:305px;width:300px;height:20px;background:#fff'
        hd.appendChild(tard)
      })
      const [tard] = await pixels(page, [[Math.round(t.x + 150), Math.round(t.y + 315)]])
      assert.ok(blanc(tard), 'un enfant positionné ajouté après la pose passe devant le sujet (limite connue) — ' + tard)
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })

  it('le sujet suit aussi background-origin, background-clip et background-repeat du fond : au pixel, comme la photo d\'une balise sans effet', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page } = await ouvre(browser, 'mjs-fb-behind-fond', 'o')
      const classes = ['o', 'o0', 'c', 'c0', 'r', 'r0']
      const zones = []
      for (const k of classes) zones.push(await boite(page, k, 'mjs-fb-behind-fond'))
      const [o, o0, c, c0, r, r0] = await reperes(page, zones)
      const proche = (a: number[], b: number[], quoi: string) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= 1, quoi + ' — le sujet ' + JSON.stringify(a) + ', la photo ' + JSON.stringify(b)))
      assert.ok(o0.bleu.n > 5000, 'le témoin montre sa photo')
      // origin: content-box avec un padding de 30 px : le fond est calé sur la boîte de contenu
      proche(o.vert.boite, o0.bleu.boite, 'background-origin: content-box')
      assert.ok(o.bleu.n <= 20, 'aucun bleu de la photo ne reste à nu (origine) — ' + o.bleu.n)
      // clip: content-box : le sujet n'est pas peint dans le cadre que le fond ne peint pas
      assert.ok(c0.bleu.n > 5000, 'le témoin montre sa photo, rognée')
      proche(c.vert.boite, c0.bleu.boite, 'background-clip: content-box')
      assert.ok(c.bleu.n <= 20, 'aucun bleu de la photo ne reste à nu (rognage) — ' + c.bleu.n)
      // repeat : le fond est en 2 × 2 tuiles, le sujet aussi
      assert.ok(r0.bleu.n > 8000, 'le témoin montre ses quatre tuiles — ' + r0.bleu.n)
      assert.ok(Math.abs(r.vert.n - r0.bleu.n) <= r0.bleu.n * 0.02, 'le sujet pavé couvre autant que la photo pavée — ' + r.vert.n + ' pour ' + r0.bleu.n)
      assert.ok(r.bleu.n <= 40, 'aucun bleu de la photo ne reste à nu (répétition) — ' + r.bleu.n)
    } finally {
      await browser.close()
    }
  })

  it('taille et place : celles du fond de la balise, tant qu\'elles ne sont pas écrites ; size et position les remplacent', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page } = await ouvre(browser, TAG, 'a')
      const lu = (c: string) => page.evaluate(([t, k]: string[]) => {
        const hd = (document.querySelector(t) as any)._shadow.querySelector('.' + k)
        const cs = getComputedStyle(hd.querySelector('[mjs-fx-layer="behind"]'))
        const fond = getComputedStyle(hd)
        return { taille: cs.backgroundSize, place: cs.backgroundPosition, fondTaille: fond.backgroundSize, fondPlace: fond.backgroundPosition }
      }, [TAG, c])
      const h = await lu('s0')
      assert.equal(h.taille, 'cover')
      assert.equal(h.taille, h.fondTaille)
      assert.equal(h.place, h.fondPlace)
      const e = await lu('s1')
      assert.equal(e.taille, 'contain', 'size: contain')
      assert.equal(e.place, '0% 0%', 'position: top-left')
      // le sujet carré (100 × 100 étiré) sur un fond à deux images : dégradé d'abord, photo ensuite (80 % × 60 % à 10 % 20 %)
      const c = await boite(page, 'c')
      const photo = [6, 16, 240, 120]
      const dedans = [[photo[0] + 4, photo[1] + 4], [photo[0] + photo[2] - 5, photo[1] + 4], [photo[0] + 4, photo[1] + photo[3] - 5], [photo[0] + photo[2] - 5, photo[1] + photo[3] - 5]]
      const dehors = [[photo[0] - 4, photo[1] + 60], [photo[0] + photo[2] + 3, photo[1] + 60], [photo[0] + 120, photo[1] - 4], [photo[0] + 120, photo[1] + photo[3] + 3]]
      const vus = await pixels(page, [...dedans, ...dehors].map(([x, y]) => [Math.round(c.x + x), Math.round(c.y + y)]))
      vus.slice(0, 4).forEach((p, i) => assert.ok(bleu(p), 'le sujet couvre exactement la photo (coin ' + i + ') — ' + p))
      vus.slice(4).forEach((p, i) => assert.ok(!bleu(p), 'le sujet ne dépasse pas la photo (côté ' + i + ') — ' + p))
      const liste = await page.evaluate(() => getComputedStyle(((document.querySelector('mjs-fb-behind') as any)._shadow.querySelector('.c') as HTMLElement).querySelector('[mjs-fx-layer="behind"]') as HTMLElement).backgroundImage.replace(/url\("[^"]*"\)/, 'url(…)'))
      assert.equal(liste, 'none, url(…)', 'le sujet prend la place de la photo dans la liste des fonds')
    } finally {
      await browser.close()
    }
  })

  it('depth: 14 — la souris décale le sujet et la copie du fond en sens contraires, de 14 px au bord ; au repos tout est posé', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page } = await ouvre(browser, TAG, 'r')
      const r = await boite(page, 'r')
      const lire = () => page.evaluate(() => {
        const hd = (document.querySelector('mjs-fb-behind') as any)._shadow.querySelector('.r')
        const cut = hd.querySelector('[mjs-fx-layer="behind"]')
        const bg = hd.querySelector('[mjs-fx-layer="behind-bg"]')
        const tx = (n: Element) => { const m = new DOMMatrixReadOnly(getComputedStyle(n).transform); return [Math.round(m.m41 * 100) / 100, Math.round(m.m42 * 100) / 100] }
        // la boîte de mise en page de la copie (le zoom agrandit celle que l'on voit, pas celle-ci)
        const marge = [-bg.offsetLeft, -bg.offsetTop, bg.offsetLeft + bg.offsetWidth - hd.clientWidth, bg.offsetTop + bg.offsetHeight - hd.clientHeight]
        return { cut: tx(cut), bg: tx(bg), wc: getComputedStyle(cut).willChange, marge, zoom: cut.style.getPropertyValue('--mjs-fx-behind-zoom'), rogne: getComputedStyle(hd).overflow, premier: hd.firstElementChild === bg }
      })
      const repos = await lire()
      assert.deepEqual(repos.cut, [0, 0])
      assert.deepEqual(repos.bg, [0, 0])
      assert.equal(repos.wc, 'auto', 'will-change seulement pendant le mouvement')
      assert.deepEqual(repos.marge, [14, 14, 14, 14], 'la copie du fond déborde de depth px de chaque côté')
      assert.equal(repos.zoom, '1.14', 'le zoom par défaut : 1 + 2 × 14 / 200 (le petit côté de la balise)')
      assert.equal(repos.rogne, 'clip', 'la balise rogne le débord')
      assert.equal(repos.premier, true, 'la copie est sous le contenu')
      await guette(page, 'r')
      // un doigt n'agit pas (événement tactile) : la boucle ne part pas, rien ne bouge — relevé dans la tâche même, puis après deux images
      const toucher = await page.evaluate(async ([x, y]: number[]) => {
        const hd  = (document.querySelector('mjs-fb-behind') as any)._shadow.querySelector('.r')
        const cut = hd.querySelector('[mjs-fx-layer="behind"]')
        hd.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: x, clientY: y, bubbles: true }))
        const tout = () => [cut.hasAttribute('mjs-fx-moving'), getComputedStyle(cut).willChange, cut.style.getPropertyValue('--mjs-fx-behind-x')]
        const dans = tout()
        await new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(fin)))
        return { dans, apres: tout() }
      }, [r.x + r.w - 1, r.y + r.h / 2])
      assert.deepEqual(toucher, { dans: [false, 'auto', ''], apres: [false, 'auto', ''] }, 'le toucher ne bouge rien')
      assert.deepEqual((await lire()).cut, [0, 0], 'le toucher ne bouge rien')
      // la souris au bord droit, à mi-hauteur : en mouvement (will-change posé), puis tout est posé (will-change rendu)
      const droit = await geste(page, () => page.mouse.move(r.x + r.w - 1, r.y + r.h / 2))
      assert.deepEqual(droit, [[true, 'transform'], [false, 'auto']], 'en mouvement : will-change posé ; tout est posé : will-change retiré')
      const droite = await lire()
      assert.ok(droite.cut[0] > 13.5 && droite.cut[0] <= 14 && Math.abs(droite.cut[1]) < 0.3, 'le sujet va vers la souris (+14) — ' + droite.cut)
      assert.ok(droite.bg[0] < -13.5 && droite.bg[0] >= -14 && Math.abs(droite.bg[1]) < 0.3, 'la copie du fond va à l\'opposé (-14) — ' + droite.bg)
      assert.equal(droite.wc, 'auto', 'tout est posé : will-change retiré')
      // le débord de la copie ne fuit pas hors de la balise : à 8 px à gauche, le noir de la page
      const [dehors] = await pixels(page, [[Math.round(r.x - 8), Math.round(r.y + r.h / 2)]])
      assert.ok(noir(dehors), 'rogné par la balise — ' + dehors)
      // la souris en bas, au milieu
      await geste(page, () => page.mouse.move(r.x + r.w / 2, r.y + r.h - 1))
      const bas = await lire()
      assert.ok(bas.cut[1] > 13.5 && Math.abs(bas.cut[0]) < 0.3, 'vers le bas : le sujet descend — ' + bas.cut)
      assert.ok(bas.bg[1] < -13.5 && Math.abs(bas.bg[0]) < 0.3, 'vers le bas : le fond monte — ' + bas.bg)
      // la souris s'en va : tout revient à zéro, puis plus aucune image demandée
      await geste(page, () => page.mouse.move(5, 5))
      assert.deepEqual((await lire()).cut, [0, 0])
      assert.deepEqual((await lire()).bg, [0, 0])
      // l'absence se compte (une fenêtre de mesure), elle ne s'attend pas : aucune image demandée pendant ce temps
      assert.equal(await imagesDemandees(page), 0, 'au repos : aucune image demandée')
    } finally {
      await browser.close()
    }
  })

  // quatre fonds, chacun sur deux balises jumelles de même style : sans depth (`0`), puis depth: 18 (`18`) ; un canal qui diffère de plus de SEUIL (2 sur 255 : l'arrondi) est un écart
  const FONDS: Array<[string, string]> = [
    ['cv', 'cover, une photo carrée dans une balise de 400 × 160 (une autre proportion)'],
    ['ct', 'contain à 20% 70%, sans répétition, avec un bord flou'],
    ['cc', 'contain à 20% 70%, sans répétition, avec une couleur au bord'],
    ['ec', 'size: contain et position: top-left écrits sur l\'effet, avec une couleur au bord'],
    ['px', 'une taille et une place en px, répétées, avec un bord flou']
  ]
  const SEUIL = 2
  const TAGR  = 'mjs-fb-behind-repos'

  it('edge: blur ou une couleur, depth: 18 — au repos, le fond (sa copie) et le sujet tombent là où ils tombent sans depth, au pixel, et le bord ne se voit pas : cover d\'une autre proportion, contain à une place écrite (sa marge ne laisse pas voir le bord), size et position écrits, une taille en px répétée', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, TAGR, 'px18')
      await decodees(page, TAGR)
      const releve = async (quand: string) => {
        const paires: Array<[Zone, Zone]> = []
        for (const [k] of FONDS) paires.push([await boite(page, k + '0', TAGR), await boite(page, k + '18', TAGR)])
        paires.forEach(([a, b], i) => assert.deepEqual([a.w, a.h, a.x], [b.w, b.h, b.x], quand + ', ' + FONDS[i][1] + ' : les deux jumelles ont la même taille'))
        const lus = await ecarts(page, paires, SEUIL)
        lus.forEach((e, i) => assert.ok(e.couleurs > 8, quand + ', ' + FONDS[i][1] + ' : la balise montre sa photo (' + e.couleurs + ' couleurs)'))
        // tous les fonds sont relevés avant de conclure : un défaut dit lesquels il touche
        const diffs = lus.map((e, i) => e.n === 0 ? '' : FONDS[i][1] + ' : ' + e.n + ' pixels sur ' + e.total + ' diffèrent de plus de ' + SEUIL + ' de la balise sans depth (écart le plus grand : ' + e.max + ')').filter((m) => m !== '')
        assert.deepEqual(diffs, [], quand + ' : au repos, depth: 18 (flou ou couleur au bord) doit rendre la balise comme depth: 0')
      }
      await releve('à la pose')
      // la balise change de taille : la copie du fond n'en lit rien, le navigateur refait le calcul, les jumelles restent identiques
      await page.evaluate((t: string) => {
        for (const h of (document.querySelector(t) as any)._shadow.querySelectorAll('header')) {
          h.style.width  = '300px'
          h.style.height = '140px'
        }
      }, TAGR)
      await page.evaluate(() => new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(fin))))
      const petite = await boite(page, 'cv18', TAGR)
      assert.deepEqual([petite.w, petite.h], [300, 140], 'la balise a bien changé de taille')
      await releve('la balise redimensionnée à 300 × 140')
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })

  it('depth: 18 — la souris décale le fond et le sujet (la capture ne ressemble plus à la jumelle), et quand elle s\'en va tout revient au repos, au pixel', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, TAGR, 'px18')
      await decodees(page, TAGR)
      const sans = await boite(page, 'cv0', TAGR)
      const avec = await boite(page, 'cv18', TAGR)
      await guette(page, 'cv18', TAGR)
      // la souris au bord droit : la copie du fond et le sujet s'écartent de 18 px chacun dans un sens (la mesure voit bien un décalage)
      await geste(page, () => page.mouse.move(avec.x + avec.w - 1, avec.y + avec.h / 2))
      const [decale] = await ecarts(page, [[sans, avec]], SEUIL)
      assert.ok(decale.n > decale.total / 10, 'au bord droit, le décalage se voit — ' + decale.n + ' pixels sur ' + decale.total)
      // elle s'en va : tout revient là où c'était sans depth
      await geste(page, () => page.mouse.move(5, 5))
      const [repos] = await ecarts(page, [[sans, avec]], SEUIL)
      assert.equal(repos.n, 0, 'la souris partie : ' + repos.n + ' pixels sur ' + repos.total + ' diffèrent de la balise sans depth (écart le plus grand : ' + repos.max + ')')
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })

  const TAGB = 'mjs-fb-behind-bord'

  // le relief mené à fond sans compter sur la vitesse de la machine : un événement de souris loin au-delà du coin (la cible est bornée à 1), puis on guette l'arrivée
  // (les deux variables du relief à 1, plus de marque de mouvement) ; `vers` à 0 : la souris s'en va, tout revient à 0
  const mene = async (page: any, classe: string, vers: 0 | 1, tag = TAGB) => {
    await page.evaluate(([t, c, v]: [string, string, number]) => {
      const hd = (document.querySelector(t) as any)._shadow.querySelector('.' + c) as HTMLElement
      const r  = hd.getBoundingClientRect()
      if (v) hd.dispatchEvent(new PointerEvent('pointermove', { clientX: r.right + 200, clientY: r.bottom + 200, pointerType: 'mouse', bubbles: true }))
      else hd.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
    }, [tag, classe, vers])
    await page.waitForFunction(([t, c, v]: [string, string, number]) => {
      const cut = (document.querySelector(t) as any)._shadow.querySelector('.' + c + ' [mjs-fx-layer="behind"]') as HTMLElement
      return cut.style.getPropertyValue('--mjs-fx-behind-x') === String(v) && cut.style.getPropertyValue('--mjs-fx-behind-y') === String(v) && !cut.hasAttribute('mjs-fx-moving')
    }, [tag, classe, vers], { timeout: 30000 })
  }

  it('edge: une couleur — au bord, la bande que le relief découvre montre la couleur unie (un fond cover ne se répète pas : ni la photo en place, ni le bord opposé) ; un motif en tuiles continue sans coupure', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, TAGB, 'ml18')
      await decodees(page, TAGB, 4)
      const cv0  = await boite(page, 'cv0', TAGB)
      const cvS  = await boite(page, 'cvS', TAGB)
      const cv18 = await boite(page, 'cv18', TAGB)
      const pxS  = await boite(page, 'pxS', TAGB)
      const px18 = await boite(page, 'px18', TAGB)
      const col  = await boite(page, 'col', TAGB)
      const ws18 = await boite(page, 'ws18', TAGB)
      // la souris au coin bas-droit : la copie du fond a glissé de 18 px vers le haut et vers la gauche ; elle ne couvre plus la bande de droite (18 px de large) ni celle du bas
      for (const k of ['cv18', 'px18', 'ws18']) await mene(page, k, 1)
      const droite = (b: Zone): Zone => ({ x: b.x + 282, y: b.y, w: 18, h: 150 })
      const bas    = (b: Zone): Zone => ({ x: b.x, y: b.y + 132, w: 300, h: 18 })
      const corps  = (b: Zone): Zone => ({ x: b.x, y: b.y, w: 282, h: 132 })
      const tout   = (b: Zone): Zone => ({ x: b.x, y: b.y, w: 300, h: 150 })
      const lus = await ecarts(page, [
        [droite(cv18), droite(col)], [bas(cv18), bas(col)], [corps(cv18), corps(cvS)],
        [droite(ws18), droite(col)], [bas(ws18), bas(col)],
        [tout(px18), tout(pxS)]
      ], SEUIL)
      const noms = [
        'cover : la bande de droite (la couleur unie, ni la photo en place ni le bord opposé de la photo)', 'cover : la bande du bas (idem)', 'cover : le reste de la balise (la photo glissée, comme le témoin décalé)',
        'size: cover écrit sur un fond en 100% auto : la bande de droite', 'size: cover écrit sur un fond en 100% auto : la bande du bas',
        'motif en tuiles : toute la balise (le motif continue sans coupure, comme le témoin décalé)'
      ]
      assert.ok(lus[2].couleurs >= 5 && lus[5].couleurs >= 4, 'les balises montrent leur photo et leur motif — ' + lus[2].couleurs + ' et ' + lus[5].couleurs + ' couleurs')
      assert.equal((await ecarts(page, [[droite(col), bas(col)]], 0))[0].couleurs, 1, 'le témoin est d\'une seule couleur')
      // deux fonds : la couche du motif garde la répétition de la balise, la photo en cover ne se répète pas (couche par couche)
      const rep = (await page.evaluate((t: string) => getComputedStyle((document.querySelector(t) as any)._shadow.querySelector('.ml18 [mjs-fx-layer="behind-bg"]')).backgroundRepeat.split(',').map((s: string) => s.trim()), TAGB)).join(', ')
      // tous les relevés avant de conclure : un défaut dit lesquels il touche
      const diffs = lus.map((e, i) => e.n === 0 ? '' : noms[i] + ' : ' + e.n + ' pixels sur ' + e.total + ' diffèrent de plus de ' + SEUIL + ' (écart le plus grand : ' + e.max + ')').filter((m) => m !== '')
      if (rep !== 'repeat, no-repeat') diffs.push('deux fonds, un motif puis la photo en cover : la copie du fond se répète « ' + rep + ' » au lieu de « repeat, no-repeat »')
      assert.deepEqual(diffs, [], 'au coin bas-droit, depth: 18')
      // la souris s'en va : la balise revient là où elle est sans depth
      await mene(page, 'cv18', 0)
      const [repos] = await ecarts(page, [[tout(cv18), tout(cv0)]], SEUIL)
      assert.equal(repos.n, 0, 'la souris partie : ' + repos.n + ' pixels sur ' + repos.total + ' diffèrent de la balise sans depth (écart le plus grand : ' + repos.max + ')')
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })

  const TAGZ = 'mjs-fb-behind-zoom'
  const TAGF = 'mjs-fb-behind-flou'
  // le zoom écrit sur le sujet (une chaîne vide : aucun zoom)
  const lireZoom = (page: any, classe: string, tag: string) => page.evaluate(([t, c]: string[]) => ((document.querySelector(t) as any)._shadow.querySelector('.' + c + ' [mjs-fx-layer="behind"]') as HTMLElement).style.getPropertyValue('--mjs-fx-behind-zoom'), [tag, classe])

  it('edge: zoom (le défaut) — au repos, le fond et le sujet sont agrandis ensemble de 1 + 2 × depth / le petit côté de la balise et restent calés l\'un sur l\'autre, au pixel', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, TAGZ, 'zr')
      await decodees(page, TAGZ, 4)
      const za  = await boite(page, 'za', TAGZ)
      const zaT = await boite(page, 'zaT', TAGZ)
      assert.equal(await lireZoom(page, 'za', TAGZ), '1.2', 'le zoom : 1 + 2 × 10 / 100')
      const [repos] = await ecarts(page, [[za, zaT]], SEUIL)
      assert.ok(repos.couleurs > 8, 'la balise montre sa photo — ' + repos.couleurs + ' couleurs')
      assert.equal(repos.n, 0, 'au repos : ' + repos.n + ' pixels sur ' + repos.total + ' diffèrent du même fond et du même sujet agrandis de 1,2 (écart le plus grand : ' + repos.max + ')')
      // le sujet (vert) recouvre le carré de la photo (bleu), au pixel : aucun bleu franc ne reste, et le vert tient le carré agrandi (96 × 48, à 52 et 26 de la balise)
      const [a] = await reperes(page, [za])
      assert.ok(a.bleu.n <= 20, 'aucun bleu de la photo ne reste à nu — ' + a.bleu.n)
      a.vert.boite.forEach((v, i) => assert.ok(Math.abs(v - [52, 26, 147, 73][i]) <= 1, 'le carré du sujet, agrandi de 1,2 — ' + a.vert.boite))
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })

  it('edge: zoom — la souris au coin : aucune bande, l\'image couvre toute la balise ; le sujet ne sort pas de son image ; la souris partie, tout revient au repos', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, TAGZ, 'zr')
      await decodees(page, TAGZ, 4)
      const zaT = await boite(page, 'zaT', TAGZ)
      const zb  = await boite(page, 'zb', TAGZ)
      const zbT = await boite(page, 'zbT', TAGZ)
      const zc  = await boite(page, 'zc', TAGZ)
      const zv  = await boite(page, 'zv', TAGZ)
      // la souris au coin bas-droit : le fond a glissé de 10 px vers le haut et la gauche, le sujet de 10 px vers le coin — la jumelle les montre agrandis de 1,2 et décalés de même
      for (const k of ['zb', 'zc']) await mene(page, k, 1, TAGZ)
      const lus = await ecarts(page, [[zb, zbT], [zc, zv]], SEUIL)
      assert.ok(lus[0].couleurs > 8, 'la balise montre sa photo — ' + lus[0].couleurs + ' couleurs')
      const noms = ['le fond et le sujet agrandis de 1,2 et décalés de 10 px (aucune bande à droite ni en bas, aucune bande à gauche ni en haut pour le sujet)', 'un sujet qui remplit son image : toute la balise reste verte']
      const diffs = lus.map((e, i) => e.n === 0 ? '' : noms[i] + ' : ' + e.n + ' pixels sur ' + e.total + ' diffèrent (écart le plus grand : ' + e.max + ')').filter((m) => m !== '')
      assert.deepEqual(diffs, [], 'au coin bas-droit, depth: 10')
      // la souris s'en va : la balise revient là où elle est au repos
      await mene(page, 'zb', 0, TAGZ)
      const [repos] = await ecarts(page, [[zb, zaT]], SEUIL)
      assert.equal(repos.n, 0, 'la souris partie : ' + repos.n + ' pixels sur ' + repos.total + ' diffèrent du repos (écart le plus grand : ' + repos.max + ')')
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })

  it('edge: zoom — la balise change de taille : le zoom est relu (1 + 2 × depth / le petit côté), sans image d\'animation au repos', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, TAGZ, 'zr')
      await decodees(page, TAGZ, 4)
      assert.equal(await lireZoom(page, 'zr', TAGZ), '1.2', 'à la pose : 1 + 2 × 10 / 100')
      await page.evaluate((t: string) => { ((document.querySelector(t) as any)._shadow.querySelector('.zr') as HTMLElement).style.height = '50px' }, TAGZ)
      // l'arrivée du zoom se guette : une valeur qui se pose
      await page.waitForFunction((t: string) => ((document.querySelector(t) as any)._shadow.querySelector('.zr [mjs-fx-layer="behind"]') as HTMLElement).style.getPropertyValue('--mjs-fx-behind-zoom') === '1.4', TAGZ, { timeout: 30000 })
      await page.evaluate(() => new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(fin))))
      const zr  = await boite(page, 'zr', TAGZ)
      const zrT = await boite(page, 'zrT', TAGZ)
      assert.deepEqual([zr.w, zr.h], [200, 50], 'la balise a bien changé de taille')
      const [lu] = await ecarts(page, [[zr, zrT]], SEUIL)
      assert.ok(lu.couleurs > 3, 'la balise montre sa photo — ' + lu.couleurs + ' couleurs')
      assert.equal(lu.n, 0, 'la balise redimensionnée : ' + lu.n + ' pixels sur ' + lu.total + ' diffèrent de la photo agrandie de 1,4 (écart le plus grand : ' + lu.max + ')')
      assert.equal(await imagesDemandees(page), 0, 'au repos : aucune image demandée')
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })

  // le flou d'une zone : le plus grand écart entre deux pixels voisins (à droite, en dessous), sur un canal, et la couleur moyenne
  async function lissage(page: any, zones: Zone[]): Promise<Array<{ max: number, moy: number[] }>> {
    const png = (await page.screenshot()).toString('base64')
    return page.evaluate(async ([b64, zs]: [string, Zone[]]) => {
      const im = new Image()
      im.src = 'data:image/png;base64,' + b64
      await im.decode()
      const c = document.createElement('canvas')
      c.width  = im.width
      c.height = im.height
      const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
      x.drawImage(im, 0, 0)
      return zs.map((z) => {
        const w = Math.round(z.w)
        const h = Math.round(z.h)
        const d = x.getImageData(Math.round(z.x), Math.round(z.y), w, h).data
        let max = 0
        const somme = [0, 0, 0]
        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) {
            const p = (j * w + i) * 4
            for (let k = 0; k < 3; k++) {
              somme[k] += d[p + k]
              if (i + 1 < w) max = Math.max(max, Math.abs(d[p + k] - d[p + 4 + k]))
              if (j + 1 < h) max = Math.max(max, Math.abs(d[p + k] - d[p + w * 4 + k]))
            }
          }
        }
        return { max, moy: somme.map((v) => Math.round(v / (w * h))) }
      })
    }, [png, zones])
  }

  it('edge: blur — la souris au coin : la bande montre la même photo, floue et agrandie, sous la copie, sans reprise nette de la photo ; au repos rien ne change', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, TAGF, 'fl18')
      await decodees(page, TAGF, 1)
      const f18 = await boite(page, 'fl18', TAGF)
      const f0  = await boite(page, 'fl0', TAGF)
      const calque = () => page.evaluate((t: string) => {
        const hd = (document.querySelector(t) as any)._shadow.querySelector('.fl18') as HTMLElement
        const e  = hd.querySelector('[mjs-fx-layer="behind-edge"]') as HTMLElement
        const cs = e && getComputedStyle(e)
        return { couches: [...hd.children].map((c) => c.getAttribute('mjs-fx-layer')), z: cs?.zIndex, opacite: cs?.opacity, filtre: (cs?.filter ?? '').replace(/\d+(\.\d+)?px/, 'Npx'), zoom: (hd.querySelector('[mjs-fx-layer="behind"]') as HTMLElement).style.getPropertyValue('--mjs-fx-behind-zoom') }
      }, TAGF)
      // au repos : le calque du bord est sous la copie, invisible ; la balise est la même que sans l'effet, au pixel
      assert.deepEqual(await calque(), { couches: ['behind-bg', 'behind-edge', 'behind'], z: '-2', opacite: '0', filtre: 'blur(Npx)', zoom: '' }, 'le calque du bord, sous la copie du fond, flou, invisible au repos ; aucun zoom')
      const [repos] = await ecarts(page, [[f18, f0]], SEUIL)
      assert.ok(repos.couleurs >= 3, 'la balise montre sa photo (noir, rouge, bleu) — ' + repos.couleurs + ' couleurs')
      assert.equal(repos.n, 0, 'au repos : ' + repos.n + ' pixels sur ' + repos.total + ' diffèrent de la balise sans depth (écart le plus grand : ' + repos.max + ')')
      // la souris au coin bas-droit : la copie du fond a glissé de 18 px, la bande de droite (18 px) et celle du bas montrent la photo floue
      await mene(page, 'fl18', 1, TAGF)
      assert.equal((await calque()).opacite, '1', 'le bord se voit dès que la copie a glissé')
      const droite = (b: Zone): Zone => ({ x: b.x + 288, y: b.y + 10, w: 12, h: 110 })
      const basG   = (b: Zone): Zone => ({ x: b.x + 10, y: b.y + 138, w: 90, h: 12 })
      const basD   = (b: Zone): Zone => ({ x: b.x + 200, y: b.y + 138, w: 90, h: 12 })
      const [d18, g18, b18, d0] = await lissage(page, [droite(f18), basG(f18), basD(f18), droite(f0)])
      assert.ok(d0.max > 150, 'la photo en place est nette : ses filets se voient — ' + d0.max)
      assert.ok(d18.max < 24, 'la bande de droite est floue : aucun filet net, écart entre voisins ' + d18.max + ' (la photo nette : ' + d0.max + ')')
      assert.ok(g18.max < 24 && b18.max < 24, 'la bande du bas est floue — ' + g18.max + ' et ' + b18.max)
      // la même photo : le rouge de sa moitié gauche, le bleu de sa moitié droite
      assert.ok(g18.moy[0] > g18.moy[2] + 30, 'la bande du bas, à gauche : le rouge de la photo — ' + g18.moy)
      assert.ok(b18.moy[2] > b18.moy[0] + 30 && d18.moy[2] > d18.moy[0] + 30, 'la bande du bas à droite et la bande de droite : le bleu de la photo — ' + b18.moy + ' / ' + d18.moy)
      const [autre] = await ecarts(page, [[droite(f18), droite(f0)]], 30)
      assert.ok(autre.n > autre.total * 0.9, 'la bande ne montre pas la photo en place : ' + autre.n + ' pixels sur ' + autre.total + ' diffèrent')
      // la souris s'en va : tout revient au repos, le bord ne se voit plus
      await mene(page, 'fl18', 0, TAGF)
      const [fin] = await ecarts(page, [[f18, f0]], SEUIL)
      assert.equal(fin.n, 0, 'la souris partie : ' + fin.n + ' pixels sur ' + fin.total + ' diffèrent de la balise sans depth (écart le plus grand : ' + fin.max + ')')
      assert.equal((await calque()).opacite, '0')
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })

  it('edge tenu par une variable : une couleur que le navigateur refuse retombe sur le zoom, une couleur valide pose le calque du bord', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, 'mjs-fb-behind-variable', 'v2')
      const etat = await page.evaluate(() => {
        const sh = (document.querySelector('mjs-fb-behind-variable') as any)._shadow
        const lire = (c: string) => {
          const hd = sh.querySelector('.' + c) as HTMLElement
          const e  = hd.querySelector('[mjs-fx-layer="behind-edge"]') as HTMLElement
          return { couches: [...hd.children].map((n) => n.getAttribute('mjs-fx-layer')), couleur: e ? getComputedStyle(e).backgroundColor : null, zoom: (hd.querySelector('[mjs-fx-layer="behind"]') as HTMLElement).style.getPropertyValue('--mjs-fx-behind-zoom') }
        }
        return { v1: lire('v1'), v2: lire('v2') }
      })
      // la mauvaise couleur : le zoom (le zoom se lit à l'arrivée de l'observateur de taille : guetté plus bas) ; la bonne : le calque, sans zoom
      assert.deepEqual(etat.v1.couches, ['behind-bg', 'behind'], 'un mot qui n\'est pas une couleur : pas de calque du bord')
      assert.deepEqual(etat.v2.couches, ['behind-bg', 'behind-edge', 'behind'], 'une couleur valide : le calque du bord')
      assert.equal(etat.v2.couleur, 'rgb(16, 16, 20)')
      assert.equal(etat.v2.zoom, '', 'avec une couleur : aucun zoom')
      await page.waitForFunction(() => ((document.querySelector('mjs-fb-behind-variable') as any)._shadow.querySelector('.v1 [mjs-fx-layer="behind"]') as HTMLElement).style.getPropertyValue('--mjs-fx-behind-zoom') === '1.2', null, { timeout: 30000 })
      // la mauvaise couleur est dite une fois dans la console (la bonne ne dit rien)
      assert.equal(journal.erreurs.length, 1, journal.erreurs.join(' | '))
      assert.match(journal.erreurs[0], /\*behind : edge = zom n'est ni zoom, ni blur, ni une couleur que votre navigateur connaît — le zoom est pris/)
    } finally {
      await browser.close()
    }
  })

  const TAGN = 'mjs-fb-behind-nom'
  const TAGX = 'mjs-fb-behind-faute'
  const TAGV = 'mjs-fb-behind-nom-variable'
  // le message d'un bord refusé, tel que la console le montre
  const ditEdge = (m: string, texte: string) => m.includes('*behind : edge = ' + texte + ' n\'est ni zoom, ni blur, ni une couleur que votre navigateur connaît — le zoom est pris. Vérifiez comment vous l\'avez écrit.')

  it('edge: black — un nom de couleur donne un bord noir au pixel (la bande que le relief découvre), sans aucun avertissement', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, TAGN, 'nm')
      await decodees(page, TAGN, 1)
      const nm  = await boite(page, 'nm', TAGN)
      const nm0 = await boite(page, 'nm0', TAGN)
      await mene(page, 'nm', 1, TAGN)
      // la souris au coin bas-droit : la copie du fond a glissé de 18 px vers le haut et vers la gauche ; les bandes de droite et du bas montrent le bord
      const droite = (b: Zone): Zone => ({ x: b.x + 282, y: b.y, w: 18, h: 150 })
      const bas    = (b: Zone): Zone => ({ x: b.x, y: b.y + 132, w: 300, h: 18 })
      const lus = await ecarts(page, [[droite(nm), droite(nm0)], [bas(nm), bas(nm0)]], SEUIL)
      assert.equal(lus[0].n, 0, 'la bande de droite est noire : ' + lus[0].n + ' pixels sur ' + lus[0].total + ' diffèrent du témoin noir (écart le plus grand : ' + lus[0].max + ')')
      assert.equal(lus[1].n, 0, 'la bande du bas est noire : ' + lus[1].n + ' pixels sur ' + lus[1].total + ' diffèrent du témoin noir (écart le plus grand : ' + lus[1].max + ')')
      assert.equal((await ecarts(page, [[droite(nm0), bas(nm0)]], 0))[0].couleurs, 1, 'le témoin est d\'une seule couleur')
      const photo = await ecarts(page, [[{ x: nm.x, y: nm.y, w: 282, h: 132 }, droite(nm0)]], SEUIL)
      assert.ok(photo[0].n > 1000, 'le reste de la balise montre toujours la photo, pas du noir — ' + photo[0].n + ' pixels sur ' + photo[0].total)
      assert.deepEqual(journal.erreurs, [], 'un nom de couleur que le navigateur connaît : aucun avertissement')
    } finally {
      await browser.close()
    }
  })

  it('edge: zooom (une faute de frappe) — le zoom est pris, au pixel comme edge: zoom, et un seul avertissement le dit dans la console', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, TAGX, 'fa')
      await decodees(page, TAGX, 2)
      // le message part à la pose : on le guette (une durée n'y fait rien sur une machine chargée)
      const fin = Date.now() + 30000
      while (!journal.erreurs.some((m) => ditEdge(m, 'zooom')) && Date.now() < fin) await new Promise((r) => setTimeout(r, 50))
      const fa = await boite(page, 'fa', TAGX)
      const fz = await boite(page, 'fz', TAGX)
      // le zoom de la balise (1 + 2 × 10 / 100 = 1,2) est lu à l'arrivée de l'observateur de taille ; pas de calque du bord
      await page.waitForFunction(() => ((document.querySelector('mjs-fb-behind-faute') as any)._shadow.querySelector('.fa [mjs-fx-layer="behind"]') as HTMLElement).style.getPropertyValue('--mjs-fx-behind-zoom') === '1.2', null, { timeout: 30000 })
      const couches = await page.evaluate(() => [...(document.querySelector('mjs-fb-behind-faute') as any)._shadow.querySelectorAll('.fa [mjs-fx-layer]')].map((n: Element) => n.getAttribute('mjs-fx-layer')))
      assert.deepEqual(couches, ['behind-bg', 'behind'], 'le zoom : pas de calque du bord')
      // au repos puis au coin : la même image que la jumelle edge: zoom
      const repos = await ecarts(page, [[fa, fz]], SEUIL)
      assert.equal(repos[0].n, 0, 'au repos, la faute de frappe donne le zoom : ' + repos[0].n + ' pixels sur ' + repos[0].total + ' diffèrent de edge: zoom (écart le plus grand : ' + repos[0].max + ')')
      await mene(page, 'fa', 1, TAGX)
      await mene(page, 'fz', 1, TAGX)
      const coin = await ecarts(page, [[fa, fz]], SEUIL)
      assert.equal(coin[0].n, 0, 'au coin, la faute de frappe donne le zoom : ' + coin[0].n + ' pixels sur ' + coin[0].total + ' diffèrent de edge: zoom (écart le plus grand : ' + coin[0].max + ')')
      assert.ok(coin[0].couleurs >= 4, 'la balise montre sa photo — ' + coin[0].couleurs + ' couleurs')
      assert.equal(journal.erreurs.length, 1, journal.erreurs.join(' | '))
      assert.ok(ditEdge(journal.erreurs[0], 'zooom'), journal.erreurs[0])
    } finally {
      await browser.close()
    }
  })

  it('edge tenu par une variable : de black à une faute de frappe (un avertissement, le zoom), puis à blur (aucun de plus), puis à black', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, TAGV, 'v')
      const lire = () => page.evaluate(() => {
        const hd = (document.querySelector('mjs-fb-behind-nom-variable') as any)._shadow.querySelector('.v') as HTMLElement
        const e  = hd.querySelector('[mjs-fx-layer="behind-edge"]') as HTMLElement
        return { genre: e ? e.getAttribute('mjs-fx-behind-edge') : null, couleur: e ? getComputedStyle(e).backgroundColor : null, zoom: (hd.querySelector('[mjs-fx-layer="behind"]') as HTMLElement).style.getPropertyValue('--mjs-fx-behind-zoom') }
      })
      const clic = (c: string) => page.evaluate((k: string) => ((document.querySelector('mjs-fb-behind-nom-variable') as any)._shadow.querySelector('.' + k) as HTMLElement).click(), c)
      // l'état attendu se guette (une expression sur e, le calque du bord, et zoom, le zoom du sujet), jamais une durée
      const attend = (cond: string) => page.waitForFunction(`(() => { const hd = document.querySelector('${TAGV}')._shadow.querySelector('.v'); const e = hd.querySelector('[mjs-fx-layer="behind-edge"]'); const zoom = hd.querySelector('[mjs-fx-layer="behind"]').style.getPropertyValue('--mjs-fx-behind-zoom'); return ${cond} })()`, null, { timeout: 30000 })
      assert.deepEqual(await lire(), { genre: 'color', couleur: 'rgb(0, 0, 0)', zoom: '' }, 'black au départ : un bord noir')
      assert.deepEqual(journal.erreurs, [], 'black : aucun avertissement')
      // une faute de frappe : le zoom (lu à l'arrivée de l'observateur), plus de calque du bord, un avertissement
      await clic('x')
      await attend(`!e && zoom === '1.2'`)
      assert.deepEqual(await lire(), { genre: null, couleur: null, zoom: '1.2' })
      assert.equal(journal.erreurs.length, 1, journal.erreurs.join(' | '))
      assert.ok(ditEdge(journal.erreurs[0], 'zooom'), journal.erreurs[0])
      // blur : le calque du flou, plus de zoom, aucun avertissement de plus
      await clic('f')
      await attend(`!!e && e.getAttribute('mjs-fx-behind-edge') === 'blur' && zoom === ''`)
      assert.equal(journal.erreurs.length, 1, 'blur : aucun avertissement de plus — ' + journal.erreurs.join(' | '))
      // black de nouveau : le bord noir, aucun avertissement de plus
      await clic('n')
      await attend(`!!e && e.getAttribute('mjs-fx-behind-edge') === 'color'`)
      assert.deepEqual(await lire(), { genre: 'color', couleur: 'rgb(0, 0, 0)', zoom: '' })
      assert.equal(journal.erreurs.length, 1, 'black : aucun avertissement de plus — ' + journal.erreurs.join(' | '))
    } finally {
      await browser.close()
    }
  })

  it('depth: la copie du fond est vue (au-dessus du fond de la balise) et reste sous le contenu', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page } = await ouvre(browser, 'mjs-fb-behind-relief', 'k')
      const k = await boite(page, 'k', 'mjs-fb-behind-relief')
      // la couture rouge | vert est au milieu de la photo ; à 7 px avant elle, rouge au repos
      const couture = [Math.round(k.x + 193), Math.round(k.y + 20)]
      const bloc    = [Math.round(k.x + 200), Math.round(k.y + 100)]
      const [avant, bloc0] = await pixels(page, [couture, bloc])
      assert.ok(rouge(avant), 'au repos : le rouge de la photo — ' + avant)
      assert.ok(blanc(bloc0), 'le contenu est visible — ' + bloc0)
      await page.evaluate(() => {
        const w   = window as any
        const cut = (document.querySelector('mjs-fb-behind-relief') as any)._shadow.querySelector('.k [mjs-fx-layer="behind"]') as HTMLElement
        w.__passages = []
        new MutationObserver(() => w.__passages.push(cut.hasAttribute('mjs-fx-moving'))).observe(cut, { attributes: true, attributeFilter: ['mjs-fx-moving'] })
      })
      await page.mouse.move(k.x + k.w - 1, k.y + k.h / 2)
      await page.waitForFunction(() => (window as any).__passages.length >= 2, null, { timeout: 30000 })
      // la copie du fond a glissé de 14 px vers la gauche : la couture est à 186 px, le vert de la copie est vu à 193 px — la copie est donc
      // au-dessus du fond de la balise ; et le contenu reste au-dessus de la copie
      const [apres, bloc1] = await pixels(page, [couture, bloc])
      assert.ok(vert(apres), 'la copie du fond (glissée) est vue au-dessus du fond de la balise — ' + apres)
      assert.ok(blanc(bloc1), 'le contenu reste au-dessus de la copie du fond — ' + bloc1)
    } finally {
      await browser.close()
    }
  })

  const TAGP = 'mjs-fb-behind-peinture'
  const BORDS: Array<[string, string]> = [['pz', 'edge: zoom (le défaut)'], ['pb', 'edge: blur'], ['pc', 'edge: une couleur']]

  // les passes de peinture et les tuiles que Chromium compte pendant un relief mené jusqu'à `images` images de la boucle (la trace de Chromium, par le protocole : Firefox n'en a pas).
  // Les images sont celles que la boucle de l'effet demande, comptées par la page elle-même ; la souris tourne autour du centre jusqu'à ce compte, puis s'en va et le relief se pose
  async function peintures(page: any, classe: string, images: number) {
    const cdp   = await page.context().newCDPSession(page)
    const noms: string[] = []
    cdp.on('Tracing.dataCollected', (e: any) => { for (const v of e.value) if (v.ph !== 'E' && (v.name === 'Paint' || v.name === 'RasterTask')) noms.push(v.name) })
    const fini = new Promise((ok) => cdp.once('Tracing.tracingComplete', ok))
    const r    = await boite(page, classe, TAGP)
    await page.evaluate(() => {
      const w = window as any
      w.__raf = w.__raf || window.requestAnimationFrame
      w.__tours = 0
      window.requestAnimationFrame = function(f: FrameRequestCallback) { w.__tours++; return w.__raf.call(window, f) }
    })
    await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'toplevel'] } })
    try {
      const fin = Date.now() + 90000
      let k = 0
      while ((await page.evaluate(() => (window as any).__tours)) < images && Date.now() < fin) {
        k++
        await page.mouse.move(r.x + r.w * (0.5 + 0.42 * Math.sin(k / 7)), r.y + r.h * (0.5 + 0.4 * Math.sin(k / 5 + 1)))
        await page.waitForTimeout(6)
      }
      await page.mouse.move(5, 5)
      await page.waitForFunction(([t, c]: string[]) => {
        const cut = (document.querySelector(t) as any)._shadow.querySelector('.' + c + ' [mjs-fx-layer="behind"]') as HTMLElement
        return cut.style.getPropertyValue('--mjs-fx-behind-x') === '0' && !cut.hasAttribute('mjs-fx-moving')
      }, [TAGP, classe], { timeout: 60000 })
    } finally {
      await cdp.send('Tracing.end')
      await fini
    }
    const tours = await page.evaluate(() => { const w = window as any; const n = w.__tours; window.requestAnimationFrame = w.__raf; return n })
    return { tours, peintures: noms.filter((n) => n === 'Paint').length, tuiles: noms.filter((n) => n === 'RasterTask').length }
  }

  it('le relief ne repeint rien par image, pour le zoom, le flou et la couleur : l\'image du sujet est posée en littéral sur son calque (aucune variable derrière elle, que le mouvement réécrit), et la trace de Chromium compte moins d\'une peinture par dix images', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, TAGP, 'pc')
      await decodees(page, TAGP, 3)
      // l'invariant, dans les deux navigateurs : aucune déclaration de background-image qui touche un calque de l'effet (une règle de la feuille adoptée, le style en ligne) ne passe par var()
      const declarees = await page.evaluate((t: string) => {
        const sh  = (document.querySelector(t) as any)._shadow
        const out: string[] = []
        for (const l of sh.querySelectorAll('[mjs-fx-layer]')) {
          if (l.style.backgroundImage) out.push(l.getAttribute('mjs-fx-layer') + ' en ligne : ' + l.style.backgroundImage)
          for (const feuille of sh.adoptedStyleSheets) for (const regle of feuille.cssRules) if (regle.selectorText && l.matches(regle.selectorText) && regle.style.getPropertyValue('background-image')) out.push(l.getAttribute('mjs-fx-layer') + ' règle : ' + regle.style.getPropertyValue('background-image'))
        }
        return out
      }, TAGP)
      // dans Chromium : la trace du relief mené sur 60 images de la boucle, pour chaque bord (relevée avant de conclure : un défaut dit tout ce qu'il touche)
      const traces: Array<[string, { tours: number, peintures: number, tuiles: number }]> = []
      if (nom === 'chromium') for (const [classe, bord] of BORDS) traces.push([bord, await peintures(page, classe, 60)])
      const defauts: string[] = []
      if (!declarees.some((d: string) => /^behind en ligne : url\(/.test(d))) defauts.push('le sujet ne porte pas son image en littéral — ' + declarees.join(' | '))
      for (const d of declarees.filter((d: string) => /var\(/.test(d))) defauts.push('une image de calque derrière une variable — ' + d)
      for (const [bord, t] of traces) {
        if (t.tours < 60) defauts.push(bord + ' : la boucle n\'a tourné que ' + t.tours + ' images')
        else if (t.peintures > 6 + t.tours / 10 || t.tuiles > 24 + t.tours / 2) defauts.push(bord + ' : ' + t.peintures + ' passes de peinture et ' + t.tuiles + ' tuiles refaites pour ' + t.tours + ' images du relief (au plus une passe pour dix images, plus six pour la pose des calques et leur retour au repos ; une tuile pour deux, plus vingt-quatre)')
      }
      assert.deepEqual(defauts, [], JSON.stringify(traces))
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })

  it('« réduire les animations » : le sujet reste, mais ni copie du fond, ni relief', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page } = await ouvre(browser, TAG, 'r', { calm: true })
      const r = await boite(page, 'r')
      await page.mouse.move(r.x + r.w - 1, r.y + r.h / 2)
      // deux images plus tard : si un mouvement devait partir, il serait parti
      await page.evaluate(() => new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(fin))))
      const etat = await page.evaluate(() => {
        const hd = (document.querySelector('mjs-fb-behind') as any)._shadow.querySelector('.r')
        const cut = hd.querySelector('[mjs-fx-layer="behind"]')
        return { sujet: !!cut, copie: !!hd.querySelector('[mjs-fx-layer="behind-bg"]'), transform: getComputedStyle(cut).transform, x: cut.style.getPropertyValue('--mjs-fx-behind-x') }
      })
      assert.deepEqual(etat, { sujet: true, copie: false, transform: 'none', x: '' })
    } finally {
      await browser.close()
    }
  })

  it('une image introuvable le dit dans la console ; le retrait ne laisse rien', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const absente = await ouvre(browser, 'mjs-fb-behind-absente', 'a')
      // le message part quand la sonde d'image échoue : on le guette (une durée n'y fait rien sur une machine chargée)
      const dit = (m: string) => /\*behind : l'image \/absente\.png est introuvable — le sujet détouré n'apparaît pas/.test(m)
      const fin = Date.now() + 30000
      while (!absente.journal.erreurs.some(dit) && Date.now() < fin) await new Promise((r) => setTimeout(r, 50))
      assert.ok(absente.journal.erreurs.some(dit), absente.journal.erreurs.join(' | '))
      const { page, journal } = await ouvre(browser, 'mjs-fb-behind-retrait', 'a')
      const avant = await page.evaluate(() => {
        const sh = (document.querySelector('mjs-fb-behind-retrait') as any)._shadow
        return { couches: sh.querySelectorAll('[mjs-fx-layer]').length, position: getComputedStyle(sh.querySelector('.a')).position }
      })
      assert.deepEqual(avant, { couches: 5, position: 'relative' }, 'deux balises : le zoom (le sujet, la copie) et le flou (le sujet, la copie, le calque du bord)')
      const apres = await page.evaluate(async () => {
        const sh = (document.querySelector('mjs-fb-behind-retrait') as any)._shadow
        const hd = sh.querySelector('.a')
        const hb = sh.querySelector('.b')
        sh.querySelector('.t').click()
        // les balises et leurs calques s'en vont : on guette cet état, image après image
        const fin = Date.now() + 30000
        while ((sh.querySelector('.a') || sh.querySelector('.b') || sh.querySelectorAll('[mjs-fx-layer]').length) && Date.now() < fin) await new Promise((r) => requestAnimationFrame(r))
        const reste = (n: Element) => ({ attrs: n.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), style: n.getAttribute('style') || '' })
        return { couches: sh.querySelectorAll('[mjs-fx-layer]').length, zoom: reste(hd), flou: reste(hb), ouverte: !!sh.querySelector('.a') || !!sh.querySelector('.b') }
      })
      assert.deepEqual(apres, { couches: 0, zoom: { attrs: [], style: '' }, flou: { attrs: [], style: '' }, ouverte: false })
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })
})
}
