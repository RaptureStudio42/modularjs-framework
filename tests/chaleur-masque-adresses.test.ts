// *heatmap : le masque des jetons dans l'adresse de la page — LA MÊME règle au navigateur (mjs_fx_heatmap.ts, avant
// l'envoi) et au serveur (mjs-ws/heatmap.ts, qui ne croit pas le client) : sur une même liste d'adresses, les deux rendent
// la même chose. Un UUID, un JWT, un e-mail, un segment de 16 caractères alphanumériques ou plus mêlant lettres et chiffres
// et un nombre de 6 chiffres ou plus partent remplacés par `_SECRET_ID_` ; un slug à tirets, une date, une version, un numéro
// court restent en clair (la page garde son nom, l'aperçu de la page d'admin la retrouve). Le motif de route du routeur
// n'est plus envoyé : le masque par segment suffit. Les jetons plus larges (base64url, extension, `;jsessionid=`, téléphone,
// jeton court d'une route…) : chaleur-masque-jetons-etroits.test.ts.

import assert from 'node:assert/strict'
import { cleanPoint } from '../src/mjs-ws/heatmap.js'
import { heatmapSrc } from './helpers/chaleur-visite.js'

const SITE = 'https://site.fr'

// le serveur : l'adresse gardée pour un point qui arrive avec cette adresse
const serveur = (url: string) => cleanPoint({ url, ev: 'click', z: [['document', 0.5, 0.5, 1, 1]] })?.url

// le navigateur : l'adresse qu'il envoie quand la page est à ce chemin (et cette route)
const navigateur = (() => {
  const loc: any = { origin: SITE, pathname: '/', hash: '', href: SITE + '/' }
  const µ: any = { _mjs_fxDefs: {} }
  const ex: any = new Function('µ', 'location', heatmapSrc + '\n;return { url: _mjsHeatmapUrl }')(µ, loc)
  return (pathname: string, hash = '') => { loc.pathname = pathname; loc.hash = hash; return ex.url() }
})()

// la page est à ce chemin : ce que rendent le navigateur et le serveur (le serveur reçoit ce que le navigateur envoie)
const rendus = (pathname: string, hash = '') => ({ navigateur: navigateur(pathname, hash), serveur: serveur(SITE + pathname + hash) })

const JWT   = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVP'
const UUID  = '550e8400-e29b-41d4-a716-446655440000'
const HEX32 = '0123456789abcdef0123456789abcdef'

// des pages qui se lisent : le chemin reste tel quel
const EN_CLAIR = [
  '/', '/tarifs', '/blog/top-10-des-meilleurs-outils', '/articles/comment-installer-php-8', '/produit/chaussures-running-nike-air-max-270',
  '/products/iphone-15-pro-max-256gb', '/docs/mjs-ws-4-5-la-carte-de-chaleur', '/2026/10/03/mon-article', '/fr/blog/5-astuces-pour-reussir',
  '/docs/38-effets', '/user/12345', '/page/2', '/produits/12', '/wiki/Linux_kernel_6.1', '/wiki/2026_FIFA_World_Cup', '/v1.2.3/docs',
  '/blog/2026-10-03-bonne-annee', '/categorie/telephones-portables-5g', '/promo/black-friday-2026', '/vid%C3%A9os/%C3%A9t%C3%A9-vacances',
  '/assets/jquery.min.js', '/reset/abcd1234efgh567'
]

// des jetons et des données personnelles : le segment part remplacé par _SECRET_ID_
const MASQUES: Array<[string, string]> = [
  ['/reset/' + HEX32, '/reset/_SECRET_ID_'],
  ['/reset/AbCd1234EfGh5678', '/reset/_SECRET_ID_'],
  ['/u/0123456789abcdef', '/u/_SECRET_ID_'],
  ['/t/A1b2C3d4E5f6G7h8I9j0Kl', '/t/_SECRET_ID_'],
  ['/confirm/' + UUID, '/confirm/_SECRET_ID_'],
  ['/confirm/' + UUID.toUpperCase(), '/confirm/_SECRET_ID_'],
  ['/s/' + JWT, '/s/_SECRET_ID_'],
  ['/s/eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjM0In0.', '/s/_SECRET_ID_'],
  ['/unsubscribe/jean.dupont@example.com', '/unsubscribe/_SECRET_ID_'],
  ['/unsubscribe/jean.dupont%40example.com', '/unsubscribe/_SECRET_ID_'],
  ['/orders/20261003', '/orders/_SECRET_ID_'],
  ['/orders/123456/suivi', '/orders/_SECRET_ID_/suivi'],
  ['/' + UUID + '/' + HEX32, '/_SECRET_ID_/_SECRET_ID_'],
  ['/blog/mon-article/' + JWT, '/blog/mon-article/_SECRET_ID_'],
  ['/Aa1-Bb2-Cc3-Dd4-Ee5-Ff6', '/_SECRET_ID_']
]

describe('*heatmap — le masque des adresses : la même règle au navigateur et au serveur', function () {
  this.timeout(30000)

  it('des pages qui se lisent restent en clair, des deux côtés (slugs à tirets, dates, versions, numéros courts)', () => {
    for (const chemin of EN_CLAIR) {
      assert.deepEqual(rendus(chemin), { navigateur: SITE + chemin, serveur: SITE + chemin }, chemin)
    }
  })

  it('un UUID, un JWT, un e-mail, un jeton sans tiret de 16 caractères ou plus mêlant lettres et chiffres, un nombre de 6 chiffres et plus : _SECRET_ID_, des deux côtés', () => {
    for (const [chemin, attendu] of MASQUES) {
      assert.deepEqual(rendus(chemin), { navigateur: SITE + attendu, serveur: SITE + attendu }, chemin)
    }
  })

  it('la route du routeur MJS (#/…) : la même règle ; ni requête ni ancre ne partent', () => {
    assert.deepEqual(rendus('/', '#/reset/' + HEX32), { navigateur: SITE + '/#/reset/_SECRET_ID_', serveur: SITE + '/#/reset/_SECRET_ID_' })
    assert.deepEqual(rendus('/', '#/blog/top-10-des-meilleurs-outils'), { navigateur: SITE + '/#/blog/top-10-des-meilleurs-outils', serveur: SITE + '/#/blog/top-10-des-meilleurs-outils' })
    assert.deepEqual(rendus('/app', '#/s/' + JWT + '?x=1'), { navigateur: SITE + '/app#/s/_SECRET_ID_', serveur: SITE + '/app#/s/_SECRET_ID_' })
    assert.deepEqual(rendus('/app', '#ancre'), { navigateur: SITE + '/app', serveur: SITE + '/app' })
  })

  it('le serveur ne croit pas le client : une adresse qui arrive avec un jeton en clair le perd quand même', () => {
    assert.equal(serveur(SITE + '/reset/' + HEX32 + '?x=1#/a/' + UUID), SITE + '/reset/_SECRET_ID_#/a/_SECRET_ID_')
    assert.equal(serveur(SITE + '/reset/' + HEX32 + '?x=1#ancre'), SITE + '/reset/_SECRET_ID_')
    assert.equal(serveur(SITE + '/unsubscribe/jean.dupont@example.com'), SITE + '/unsubscribe/_SECRET_ID_')
  })

  it('le masque est stable : une adresse déjà masquée par le navigateur ne change plus au serveur', () => {
    for (const [chemin] of MASQUES) {
      const envoyee = navigateur(chemin)
      assert.equal(serveur(envoyee), envoyee, chemin)
    }
  })

  it('1 500 segments au hasard (hexadécimaux, base64url, slugs, UUID, JWT, e-mails, nombres) : le navigateur et le serveur ne divergent jamais', () => {
    let graine = 20261003
    // mulberry32 : le même hasard à chaque passage
    const hasard = () => { graine |= 0; graine = graine + 0x6D2B79F5 | 0; let t = Math.imul(graine ^ graine >>> 15, 1 | graine); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
    const entier = (n: number) => Math.floor(hasard() * n)
    const piocher = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[entier(alphabet.length)]).join('')
    const HEX = '0123456789abcdef'
    const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const B64 = ALNUM + '-_'
    const MOTS = ['top', 'blog', '10', 'iphone', '15', 'pro', 'max', '256gb', 'la', 'carte', 'de', 'chaleur', 'mjs', 'ws', '4']
    const genres: Array<() => string> = [
      () => piocher(HEX, 6 + entier(43)),
      () => piocher(ALNUM, 1 + entier(40)),
      () => piocher(B64, 5 + entier(46)),
      () => Array.from({ length: 1 + entier(7) }, () => MOTS[entier(MOTS.length)]).join('-'),
      () => [8, 4, 4, 4, 12].map((n) => piocher(HEX, n)).join('-'),
      () => 'eyJ' + piocher(B64, entier(20)) + '.' + piocher(B64, 1 + entier(30)) + '.' + piocher(B64, entier(30)),
      () => piocher(ALNUM + '.', 1 + entier(12)) + (hasard() < 0.5 ? '@' : '%40') + piocher(ALNUM, 1 + entier(8)) + '.' + piocher('abcdefghij', 2 + entier(3)),
      () => piocher('0123456789', 1 + entier(12)),
      () => piocher(ALNUM + '._~%-', 1 + entier(40))
    ]
    let comparees = 0
    let masquees  = 0
    for (let i = 0; i < 1500; i++) {
      const segment = genres[i % genres.length]()
      // l'adresse doit passer l'analyse d'une URL sans changer : un `.` ou un `..` seul, un `%` seul… se normalisent
      if (new URL(SITE + '/a/' + segment).pathname !== '/a/' + segment) continue
      const v = rendus('/a/' + segment)
      assert.equal(v.serveur, v.navigateur, '/a/' + segment)
      comparees++
      if (v.serveur !== SITE + '/a/' + segment) masquees++
    }
    assert.ok(comparees > 1200, 'assez de segments comparés : ' + comparees)
    assert.ok(masquees > 100 && masquees < comparees - 100, 'des segments masqués et des segments laissés : ' + masquees + ' sur ' + comparees)
  })
})
