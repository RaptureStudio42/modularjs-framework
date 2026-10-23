// *heatmap : le masque des jetons dans l'adresse de la page ne laisse plus passer les jetons que sa règle étroite
// (`[a-z\d]{16,}` : ni tiret, ni majuscule mêlée, ni extension) oubliait — base64url de 22 et de 43 caractères (la moitié
// et les trois quarts en clair), base64 standard, un jeton suivi de `.pdf` ou `.json`, un paramètre `;jsessionid=…`, un
// e-mail encodé deux fois, un JWT sans `eyJ`, un téléphone, un jeton court dans une route en ancre — sans rien masquer
// de ce qui se lit : un slug, une date, `/page/12`, `v2`, un code court, une route du site. La MÊME règle au navigateur
// (mjs_fx_heatmap.ts, avant l'envoi) et au serveur (mjs-ws/heatmap.ts, qui ne croit pas le client).

import assert from 'node:assert/strict'
import { cleanPoint } from '../src/mjs-ws/heatmap.js'
import { heatmapSrc } from './helpers/chaleur-visite.js'

const SITE = 'https://site.fr'

// le serveur : l'adresse gardée pour un point qui arrive avec cette adresse
const serveur = (url: string) => cleanPoint({ url, ev: 'click', z: [['document', 0.5, 0.5, 1, 1]] })?.url

// le navigateur : l'adresse qu'il envoie quand la page est à ce chemin (et cette route), et son masque de chemin seul
const navigateur = (() => {
  const loc: any = { origin: SITE, pathname: '/', hash: '', href: SITE + '/' }
  const µ: any = { _mjs_fxDefs: {} }
  const ex: any = new Function('µ', 'location', heatmapSrc + '\n;return { url: _mjsHeatmapUrl, chemin: _mjsHeatmapSegments }')(µ, loc)
  return {
    url: (pathname: string, hash = '') => { loc.pathname = pathname; loc.hash = hash; return ex.url() as string },
    chemin: (pathname: string) => ex.chemin(pathname) as string
  }
})()

// ce que rendent le navigateur et le serveur pour la page à ce chemin (et cette route)
const rendus = (pathname: string, hash = '') => ({ navigateur: navigateur.url(pathname, hash), serveur: serveur(SITE + pathname + hash) })
const pareil = (attendu: string) => ({ navigateur: SITE + attendu, serveur: SITE + attendu })

// un hasard qui se rejoue : mulberry32
function hasard(graine: number) {
  let g = graine
  return () => { g |= 0; g = g + 0x6D2B79F5 | 0; let t = Math.imul(g ^ g >>> 15, 1 | g); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const B64URL = ALNUM + '-_'
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const HEX = '0123456789abcdef'

// les jetons que les bibliothèques fabriquent, tirés avec la graine donnée
function familles(rnd: () => number): Record<string, () => string> {
  const piocher = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('')
  const b64std = (n: number) => {
    const brut = Array.from({ length: n }, () => Math.floor(rnd() * 256))
    return Buffer.from(brut).toString('base64')
  }
  const uuid = () => [8, 4, 4, 4, 12].map((n) => piocher(HEX, n)).join('-')
  return {
    'base64url de 22 caractères (token_urlsafe(16))': () => piocher(B64URL, 22),
    'base64url de 43 caractères (token_urlsafe(32))': () => piocher(B64URL, 43),
    'base64 standard de 24 caractères, encodé (%3D, %2B, %2F)': () => encodeURIComponent(b64std(16)),
    'hexadécimal de 32 caractères': () => piocher(HEX, 32),
    'hexadécimal de 64 caractères (sha256)': () => piocher(HEX, 64),
    'hexadécimal de 8 caractères (jeton court)': () => piocher(HEX, 8),
    'UUID': uuid,
    'base58 de 24 caractères': () => piocher(B58, 24),
    'alphanumérique de 32 caractères': () => piocher(ALNUM, 32),
    'hexadécimal de 32 caractères + .pdf': () => piocher(HEX, 32) + '.pdf',
    'UUID + .json': () => uuid() + '.json',
    'base64url de 22 caractères + .html': () => piocher(B64URL, 22) + '.html'
  }
}

// la part des jetons qui reste en clair, que `navigateur.chemin` laisse passer (un jeton masqué porte `_SECRET_ID_`)
function fuite(fabrique: () => string, tirages: number) {
  let enClair = 0
  for (let i = 0; i < tirages; i++) if (!navigateur.chemin('/x/' + fabrique()).includes('_SECRET_ID_')) enClair++
  return enClair / tirages
}

const JWT  = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVP'
const UUID = '550e8400-e29b-41d4-a716-446655440000'
const HEX32 = '0123456789abcdef0123456789abcdef'

// les cas que le masque étroit laissait passer : [chemin, route, ce que le navigateur et le serveur gardent]
const MASQUES: Array<[string, string, string]> = [
  ['/reset/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde', '', '/reset/_SECRET_ID_'],
  ['/reset/aB3dE5gH7jK9mN1p_Qr2sT', '', '/reset/_SECRET_ID_'],
  ['/reset/aB3dE5gH7jK9mN1p-Qr2sT', '', '/reset/_SECRET_ID_'],
  ['/reset/aB3dE5gH7jK9mN1p+Qr2sT', '', '/reset/_SECRET_ID_'],
  ['/reset/aB3dE5gH7jK9mN1pQr2sT12%3D', '', '/reset/_SECRET_ID_'],
  ['/reset/aB3dE5gH7jK9mN1pQr2sT12=', '', '/reset/_SECRET_ID_'],
  ['/reset/aB3dE5gH7jK9mN1p%2BQr2sT', '', '/reset/_SECRET_ID_'],
  ['/files/' + HEX32 + '.pdf', '', '/files/_SECRET_ID_.pdf'],
  ['/confirm/' + UUID + '.json', '', '/confirm/_SECRET_ID_.json'],
  ['/dl/AbCd1234EfGh5678IjKl9012.pdf', '', '/dl/_SECRET_ID_.pdf'],
  ['/s/' + HEX32 + '.html', '', '/s/_SECRET_ID_.html'],
  ['/commande/123456.pdf', '', '/commande/_SECRET_ID_.pdf'],
  ['/reset;jsessionid=' + HEX32, '', '/reset;jsessionid=_SECRET_ID_'],
  ['/reset;token=AbCd1234EfGh5678IjKl9012', '', '/reset;token=_SECRET_ID_'],
  ['/reset/' + HEX32 + ';jsessionid=1', '', '/reset/_SECRET_ID_;jsessionid=1'],
  ['/unsubscribe/jean.dupont%2540example.com', '', '/unsubscribe/_SECRET_ID_'],
  ['/unsubscribe/jean%40example.com.html', '', '/unsubscribe/_SECRET_ID_'],
  ['/s/Zm9vYmFy.YmF6cXV4.c2lnbmF0dXJl', '', '/s/_SECRET_ID_'],
  ['/s/abcdefgh.ijklmnop.qrstuvwx', '', '/s/_SECRET_ID_'],
  ['/s/' + JWT + '.html', '', '/s/_SECRET_ID_'],
  ['/call/+33612345678', '', '/call/_SECRET_ID_'],
  ['/call/%2B33612345678', '', '/call/_SECRET_ID_'],
  ['/call/06%2012%2034%2056%2078', '', '/call/_SECRET_ID_'],
  // le même numéro écrit avec des tirets : 10 chiffres, comme les deux autres
  ['/call/06-12-34-56-78', '', '/call/_SECRET_ID_'],
  ['/confirm/%7B' + UUID + '%7D', '', '/confirm/_SECRET_ID_'],
  ['/', '#/reset/5f3a9c2e', '/#/reset/_SECRET_ID_'],
  ['/app', '#/reset/5f3a9c2e1b?x=1', '/app#/reset/_SECRET_ID_'],
  ['/reset/5f3a9c2e', '', '/reset/_SECRET_ID_'],
  ['/reset/5F3A9C2E', '', '/reset/_SECRET_ID_'],
  ['/files/5f3a9c2e.pdf', '', '/files/_SECRET_ID_.pdf']
]

// ce qui se lit reste en clair : slugs, dates, numéros courts, versions, codes courts, titres à majuscules
const EN_CLAIR = [
  '/', '/blog/2026-10-03', '/blog/2026-10-03-bonne-annee-a-tous', '/page/12', '/api/v2/users', '/docs/v2.1.0/intro', '/promo/SUMMER2026', '/dp/B08N5WRWNW',
  '/watch/dQw4w9WgXcQ', '/magasin/75001', '/id/12345', '/commit/da39a3e', '/r/abc123def456ghi',
  '/unsubscribe/jean@localhost', '/blog/top-10-des-meilleurs-outils', '/products/iphone-15-pro-max-256gb',
  '/wiki/Linux_kernel_6.1', '/wiki/2026_FIFA_World_Cup', '/wiki/1998_FIFA_World_Cup_squads', '/wiki/List_of_Presidents_of_the_United_States', '/Windows_11_Home_Edition_2026',
  '/assets/jquery.min.js', '/assets/bootstrap.bundle.min.js', '/docs/v1.2.3', '/files/rapport-annuel.pdf', '/files/rapport-2026.pdf', '/v2.1.0.zip', '/archive.tar.gz'
]

// les routes du site (config/routes.rb et chemins des composants) : aucune ne devient _SECRET_ID_
const ROUTES_DU_SITE = [
  '/30ans-elodie/12', '/30ans-elodie@update!', '/30ans-elodie@update!/', '/about', '/account', '/admin', '/api/me', '/api/messages', '/api/posts', '/api/posts/42', '/api/profil/42', '/app', '/archives',
  '/assets/hero-3f2a91c8.jpg', '/assets/search-index-doc.json', '/assets/search-index-tuto.json', '/ateliers/encre.html', '/ateliers/filtres.html', '/blog', '/cart', '/cart/clear', '/charte', '/checkout',
  '/connexion', '/contact', '/cv', '/deconnexion', '/demo/3', '/doc', '/doc/rt-routes', '/doc/mjs-ws/heatmap', '/effets', '/export.csv', '/heatmap', '/inscription', '/jeux/test-oeil', '/login', '/logout',
  '/maintenance', '/mentions-legales', '/messages', '/mjs-preview.html', '/mjs-server/persist', '/modularjs/bundle.js', '/modularjs/button-abc123.js', '/modularjs/card-def456.js', '/msr', '/my_admin',
  '/my_admin/error/log-2026-10-03/view', '/my_admin/errors', '/my_admin/errors/all', '/my_admin/maintenance', '/my_admin/script/syncro_pub_nb', '/my_admin/users/12/page', '/paiement/retry', '/panier',
  '/panier/12', '/panier/vider', '/photos', '/posts', '/posts/42', '/products', '/products/42', '/produit/12', '/produits', '/produits/42', '/profil', '/realisations/mon-projet', '/services/DVO/map',
  '/services/test/pokemon', '/signup', '/sons/ok.mp3', '/sons/victoire.mp3', '/success', '/switch_up/3', '/tableau-de-bord', '/tarifs', '/test', '/tuto', '/tuto-themes/', '/tutorial/image.gif', '/ws',
  '/.well-known/acme-challenge/12'
]

describe('*heatmap — le masque des jetons : ceux que la règle étroite laissait passer', function () {
  this.timeout(60000)

  it('base64url, base64, jeton + extension, ;jsessionid=, e-mail encodé deux fois, JWT sans eyJ, téléphone, jeton court d\'une route en ancre : _SECRET_ID_, des deux côtés', () => {
    const ecarts: string[] = []
    for (const [chemin, hash, attendu] of MASQUES) {
      const v = rendus(chemin, hash)
      if (v.navigateur !== SITE + attendu || v.serveur !== SITE + attendu) ecarts.push(chemin + hash + ' → navigateur ' + v.navigateur.replace(SITE, '') + ', serveur ' + v.serveur?.replace(SITE, '') + ' (attendu ' + attendu + ')')
    }
    assert.deepEqual(ecarts, [], ecarts.length + ' cas sur ' + MASQUES.length + ' mal masqués')
  })

  it('ce qui se lit reste en clair, des deux côtés : slugs, dates, numéros courts, versions, codes courts, titres à majuscules', () => {
    for (const chemin of EN_CLAIR) {
      assert.deepEqual(rendus(chemin), pareil(chemin), chemin)
    }
  })

  it('aucune route du site (84 chemins relevés dans config/routes.rb et les composants) ne devient _SECRET_ID_', () => {
    for (const chemin of ROUTES_DU_SITE) {
      assert.deepEqual(rendus(chemin), pareil(chemin), chemin)
    }
  })

  it('le chemin secret d\'une route du site (25 caractères mêlant lettres et chiffres) part masqué', () => {
    assert.deepEqual(rendus('/services/euromillion/D593GFtg0EGg5rg5rk1lgCgPi'), pareil('/services/euromillion/_SECRET_ID_'))
  })

  it('20 000 jetons tirés par famille : la part laissée en clair ne dépasse pas celle de l\'ancienne règle (2,8 % pour 22 caractères, rien pour les autres)', () => {
    const rnd = hasard(20261003)
    const fabriques = familles(rnd)
    // ce qui ne se masque pas parce que le jeton n'a aucun chiffre ou aucune majuscule : une règle ne peut pas le distinguer d'un mot
    const plafonds: Record<string, number> = {
      'base64url de 22 caractères (token_urlsafe(16))': 0.04,
      'base64url de 43 caractères (token_urlsafe(32))': 0.005,
      'base64 standard de 24 caractères, encodé (%3D, %2B, %2F)': 0.04,
      'hexadécimal de 32 caractères': 0.0005,
      'hexadécimal de 64 caractères (sha256)': 0.0005,
      'hexadécimal de 8 caractères (jeton court)': 0.003,
      'UUID': 0,
      'base58 de 24 caractères': 0.03,
      'alphanumérique de 32 caractères': 0.005,
      'hexadécimal de 32 caractères + .pdf': 0.0005,
      'UUID + .json': 0,
      'base64url de 22 caractères + .html': 0.04
    }
    const mesures: string[] = []
    for (const [nom, fabrique] of Object.entries(fabriques)) {
      const part = fuite(fabrique, 20000)
      mesures.push(nom + ' : ' + (100 * part).toFixed(2) + ' % en clair')
      assert.ok(part <= plafonds[nom], nom + ' : ' + (100 * part).toFixed(2) + ' % en clair, plafond ' + (100 * plafonds[nom]).toFixed(2) + ' %')
    }
    assert.equal(mesures.length, Object.keys(plafonds).length)
  })

  it('le navigateur et le serveur ne divergent jamais : 3 000 jetons de chaque famille, et des segments au hasard', () => {
    const rnd = hasard(31102026)
    let comparees = 0
    for (const [nom, fabrique] of Object.entries(familles(rnd))) {
      for (let i = 0; i < 3000; i++) {
        const segment = fabrique()
        // l'adresse doit passer l'analyse d'une URL sans changer : un `.` ou un `..` seul se normalise
        if (new URL(SITE + '/a/' + segment).pathname !== '/a/' + segment) continue
        const v = rendus('/a/' + segment)
        assert.equal(v.serveur, v.navigateur, nom + ' : /a/' + segment)
        comparees++
      }
    }
    const caracteres = ALNUM + '._~%-+=;@'
    const morceaux = ['eyJ', 'jean', '%40', '%2540', '.pdf', '.json', '.', ';token=', 'a1', 'Zm9v', '5f3a9c2e', '0123456789', '-', '_', '+33', '06', ' ', '%20']
    for (let i = 0; i < 6000; i++) {
      const n = 1 + Math.floor(rnd() * 6)
      let segment = ''
      for (let j = 0; j < n; j++) segment += rnd() < 0.5 ? morceaux[Math.floor(rnd() * morceaux.length)] : Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => caracteres[Math.floor(rnd() * caracteres.length)]).join('')
      if (/[%]/.test(segment.replace(/%[0-9a-f]{2}/gi, ''))) continue
      let u: URL
      try { u = new URL(SITE + '/a/' + segment) }
      catch { continue }
      if (u.pathname !== '/a/' + segment) continue
      const v = rendus('/a/' + segment)
      assert.equal(v.serveur, v.navigateur, '/a/' + segment)
      comparees++
    }
    assert.ok(comparees > 30000, 'assez d\'adresses comparées : ' + comparees)
  })

  it('un segment hostile de 2 000 caractères (ou d\'un million) se masque vite : aucune règle ne s\'emballe', () => {
    const hostiles = ['a@'.repeat(1000), 'a.'.repeat(1000) + '!', 'x@' + 'a.'.repeat(1000) + '!', 'eyJ' + 'a.'.repeat(1000), '0'.repeat(2000) + '!', 'a1'.repeat(1000) + '-', '%'.repeat(2000), '%C3%A9'.repeat(300), '-'.repeat(2000), ';'.repeat(2000), '='.repeat(2000), 'aB1'.repeat(700) + '.pdf', 'a.'.repeat(300000)]
    const debut = Date.now()
    for (const s of hostiles) navigateur.chemin('/x/' + s)
    const duree = Date.now() - debut
    assert.ok(duree < 1500, hostiles.length + ' segments hostiles en ' + duree + ' ms')
  })
})
