// *heatmap : l'adresse envoyée ne laisse passer aucun jeton de 16 caractères ou plus fait de lettres, de chiffres, de `-` et
// de `_` — quels que soient ses caractères : sans chiffre (`QwErTyUiOpAsDfGhJkLz`), en minuscules seules
// (`xkqzvbnmwrtplkjhgfds`), avec un tiret ou un soulignement (`dTpkbjlZy_NTPKpx`). Avant, un jeton base64url de 16 à 19
// caractères sur deux restait en clair (lien de réinitialisation, lien magique, lien de partage), et le serveur, qui
// appliquait la même règle, ne rattrapait rien. Seul reste en clair ce qui se lit : des mots, des nombres, des séparateurs
// (`top-10-des-meilleurs-outils`, `Samsung_Galaxy_S23_Ultra`, `bootstrap5components`). Choix visible : un seul mot de 16
// lettres ou plus, sans tiret ni chiffre (`abcdefghijklmnop`), ne se distingue pas d'un jeton de lettres : il part masqué.
// La MÊME règle au navigateur (mjs_fx_heatmap.ts) et au serveur (mjs-ws/heatmap.ts).

import assert from 'node:assert/strict'
import { cleanPoint } from '../src/mjs-ws/heatmap.js'
import { heatmapSrc } from './helpers/chaleur-visite.js'

const SITE = 'https://site.fr'

const serveur = (url: string) => cleanPoint({ url, ev: 'click', z: [['document', 0.5, 0.5, 1, 1]] })?.url

const navigateur = (() => {
  const loc: any = { origin: SITE, pathname: '/', hash: '', href: SITE + '/' }
  const µ: any = { _mjs_fxDefs: {} }
  const ex: any = new Function('µ', 'location', heatmapSrc + '\n;return { url: _mjsHeatmapUrl, chemin: _mjsHeatmapSegments }')(µ, loc)
  return {
    url: (pathname: string, hash = '') => { loc.pathname = pathname; loc.hash = hash; return ex.url() as string },
    chemin: (pathname: string) => ex.chemin(pathname) as string
  }
})()

const rendus = (pathname: string, hash = '') => ({ navigateur: navigateur.url(pathname, hash), serveur: serveur(SITE + pathname + hash) })
const pareil = (attendu: string) => ({ navigateur: SITE + attendu, serveur: SITE + attendu })

// un hasard qui se rejoue : mulberry32
function hasard(graine: number) {
  let g = graine
  return () => { g |= 0; g = g + 0x6D2B79F5 | 0; let t = Math.imul(g ^ g >>> 15, 1 | g); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}

const MIN = 'abcdefghijklmnopqrstuvwxyz'
const MAJ = MIN.toUpperCase()
const B64URL = MIN + MAJ + '0123456789-_'

describe('*heatmap — le masque des jetons : 16 caractères ou plus de lettres, chiffres, - et _, quels que soient les caractères', function () {
  this.timeout(120000)

  it('20 000 jetons base64url de 16 et de 22 caractères : aucun en clair, au navigateur comme au serveur', () => {
    const rnd = hasard(19102026)
    const piocher = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('')
    const enClair: string[] = []
    for (const n of [16, 22]) {
      for (let i = 0; i < 20000; i++) {
        const jeton = piocher(B64URL, n)
        const v = rendus('/reset/' + jeton)
        if (v.navigateur !== SITE + '/reset/_SECRET_ID_' || v.serveur !== SITE + '/reset/_SECRET_ID_') enClair.push(jeton)
      }
    }
    assert.deepEqual(enClair.slice(0, 10), [], enClair.length + ' jetons sur 40 000 en clair')
  })

  it('les autres familles de 16 à 20 caractères — lettres seules à casse mêlée, minuscules seules, majuscules seules, alphanumériques : aucune en clair (5 000 chacune)', () => {
    const rnd = hasard(20261019)
    const piocher = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('')
    const familles: Array<[string, string, number]> = [['lettres', MIN + MAJ, 16], ['minuscules', MIN, 16], ['minuscules', MIN, 20], ['majuscules', MAJ, 16], ['alphanumériques', MIN + MAJ + '0123456789', 16]]
    for (const [nom, alphabet, n] of familles) {
      let enClair = 0
      for (let i = 0; i < 5000; i++) if (!navigateur.chemin('/r/' + piocher(alphabet, n)).includes('_SECRET_ID_')) enClair++
      assert.equal(enClair, 0, nom + ' de ' + n + ' caractères : ' + enClair + ' en clair')
    }
  })

  it('les jetons relevés : sans chiffre, en lettres seules, avec - ou _, en valeur de paramètre, devant une extension, dans une route : _SECRET_ID_, des deux côtés', () => {
    const cas: Array<[string, string, string]> = [
      ['/reset/dTpkbjlZy_NTPKpx', '', '/reset/_SECRET_ID_'],
      ['/reset/A5TXp-4gNA8EIaud', '', '/reset/_SECRET_ID_'],
      ['/s/QwErTyUiOpAsDfGhJkLz', '', '/s/_SECRET_ID_'],
      ['/share/AbCdEfGhIjKlMnOpQrStUv', '', '/share/_SECRET_ID_'],
      ['/magic/xkqzvbnmwrtplkjhgfds', '', '/magic/_SECRET_ID_'],
      ['/magic/XKQZVBNMWRTPLKJH', '', '/magic/_SECRET_ID_'],
      ['/k/AbCdEf-GhIj_KlMn1', '', '/k/_SECRET_ID_'],
      ['/reset/abcdefghijklmnop', '', '/reset/_SECRET_ID_'],
      ['/reset/abcdefghijklmnopqrst', '', '/reset/_SECRET_ID_'],
      ['/reset/abcdefghijklmnopqrstuvwxyzabcdefghijklmn', '', '/reset/_SECRET_ID_'],
      ['/reset;token=dTpkbjlZy_NTPKpx', '', '/reset;token=_SECRET_ID_'],
      ['/dl/dTpkbjlZy_NTPKpx.pdf', '', '/dl/_SECRET_ID_.pdf'],
      ['/', '#/reset/dTpkbjlZy_NTPKpx', '/#/reset/_SECRET_ID_']
    ]
    const ecarts: string[] = []
    for (const [chemin, hash, attendu] of cas) {
      const v = rendus(chemin, hash)
      if (v.navigateur !== SITE + attendu || v.serveur !== SITE + attendu) ecarts.push(chemin + hash + ' → navigateur ' + v.navigateur.replace(SITE, '') + ', serveur ' + v.serveur?.replace(SITE, ''))
    }
    assert.deepEqual(ecarts, [])
  })

  it('ce qui se lit reste en clair, des deux côtés : slugs, noms de produit, dates compactes, mots avec un chiffre', () => {
    const lisibles = [
      '/blog/top-10-des-meilleurs-outils', '/blog/2026-10-03-bonne-annee-a-tous', '/products/iphone-15-pro-max-256gb', '/docs/mjs-ws-4-5-la-carte-de-chaleur',
      '/articles/comment-installer-php-8', '/wiki/2026_FIFA_World_Cup', '/wiki/List_of_Presidents_of_the_United_States', '/mentions-legales', '/assets/search-index-doc.json',
      '/p/Samsung_Galaxy_S23_Ultra', '/p/MacBook-Pro-M3-Max-Review', '/p/Nintendo_Switch_OLED_Model', '/p/bootstrap5components', '/p/20241003T101500Z',
      '/p/IMG20241003123456.jpg', '/p/compteRendu20241003', '/p/Python3Tutorial_ForBeginners', '/promo/black-friday-2026'
    ]
    for (const chemin of lisibles) assert.deepEqual(rendus(chemin), pareil(chemin), chemin)
  })
})
