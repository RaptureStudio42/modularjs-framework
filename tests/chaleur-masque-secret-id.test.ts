// *heatmap : le morceau d'adresse masqué s'écrit `_SECRET_ID_`. Un segment (ou la partie d'un segment) qui ressemble à un jeton
// ou à une donnée personnelle part remplacé par `_SECRET_ID_`, au navigateur (mjs_fx_heatmap.ts, avant l'envoi) comme au serveur
// (mjs-ws/heatmap.ts, qui re-masque toute adresse reçue) : `/commande/8F3K-29XQ-77LM` → `/commande/_SECRET_ID_`, `<jeton>.pdf` →
// `_SECRET_ID_.pdf`, `;jsessionid=<jeton>` → `;jsessionid=_SECRET_ID_`. Le texte `_SECRET_ID_` n'est jamais pris pour un jeton : une
// adresse déjà masquée ressort identique des deux masqueurs, et le serveur range telle quelle l'adresse masquée que le navigateur
// lui envoie — à la réception comme à la relecture de son fichier. Le nom d'un paramètre de chemin `nom=valeur` est jugé comme un
// segment, que la valeur soit masquée ou en clair : `;v2session=<jeton>` → `;v2session=_SECRET_ID_` des deux côtés, `;<jeton>=<jeton>`
// → `;_SECRET_ID_=_SECRET_ID_`, `;<uuid>=fr` → `;_SECRET_ID_=fr`, `;<jeton>.pdf=<jeton>` → `;_SECRET_ID_.pdf=_SECRET_ID_`

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { cleanPoint, heatmapPackage } from '../src/mjs-ws/heatmap.js'
import { heatmapSrc, visite, attendre } from './helpers/chaleur-visite.js'
import { mjsTmp } from './helpers/tmp.js'

const SITE  = 'https://site.fr'
const UUID  = '550e8400-e29b-41d4-a716-446655440000'
const JETON = 'A1b2C3d4E5f6G7h8I9j0Kl'
const HEX32 = '0123456789abcdef0123456789abcdef'
const JWT   = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVP'

// le serveur : l'adresse gardée pour un point qui arrive avec cette adresse
const serveur = (url: string) => cleanPoint({ url, ev: 'click', z: [['document', 0.5, 0.5, 1, 1]] })?.url

// le navigateur : l'adresse qu'il envoie quand la page est à ce chemin (et cette route)
const navigateur = (() => {
  const loc: any = { origin: SITE, pathname: '/', hash: '', href: SITE + '/' }
  const µ: any   = { _mjs_fxDefs: {} }
  const ex: any  = new Function('µ', 'location', heatmapSrc + '\n;return { url: _mjsHeatmapUrl }')(µ, loc)
  return (pathname: string, hash = '') => { loc.pathname = pathname; loc.hash = hash; return ex.url() as string }
})()

// ce que rendent le navigateur et le serveur pour la page à ce chemin (et cette route)
const rendus = (pathname: string, hash = '') => ({ navigateur: navigateur(pathname, hash), serveur: serveur(SITE + pathname + hash) })
const pareil = (attendu: string) => ({ navigateur: SITE + attendu, serveur: SITE + attendu })

// un segment entier : une clé de commande, un UUID, un jeton, un hexadécimal, un JWT, un e-mail, un numéro
const SEGMENTS: Array<[string, string]> = [
  ['/commande/8F3K-29XQ-77LM', '/commande/_SECRET_ID_'],
  ['/confirm/' + UUID, '/confirm/_SECRET_ID_'],
  ['/confirm/' + UUID.toUpperCase(), '/confirm/_SECRET_ID_'],
  ['/t/' + JETON, '/t/_SECRET_ID_'],
  ['/reset/' + HEX32, '/reset/_SECRET_ID_'],
  ['/s/' + JWT, '/s/_SECRET_ID_'],
  ['/unsubscribe/jean.dupont%40example.com', '/unsubscribe/_SECRET_ID_'],
  ['/orders/123456/suivi', '/orders/_SECRET_ID_/suivi'],
  ['/' + UUID + '/' + HEX32, '/_SECRET_ID_/_SECRET_ID_']
]

// devant une extension : la partie qui précède part, l'extension reste
const EXTENSIONS: Array<[string, string]> = [
  ['/f/' + JETON + '.pdf', '/f/_SECRET_ID_.pdf'],
  ['/factures/' + HEX32 + '.pdf', '/factures/_SECRET_ID_.pdf'],
  ['/photos/' + UUID + '.jpeg', '/photos/_SECRET_ID_.jpeg']
]

// après un `;` : la valeur d'un paramètre de chemin part, son nom reste
const PARAMETRES: Array<[string, string]> = [
  ['/panier;jsessionid=' + JETON, '/panier;jsessionid=_SECRET_ID_'],
  ['/panier;jsessionid=' + HEX32 + '/suite', '/panier;jsessionid=_SECRET_ID_/suite'],
  ['/f/' + JETON + '.pdf;jsessionid=' + UUID, '/f/_SECRET_ID_.pdf;jsessionid=_SECRET_ID_']
]

// des adresses déjà masquées : elles ne changent plus
const DEJA_MASQUEES = [
  '/commande/_SECRET_ID_', '/f/_SECRET_ID_.pdf', '/_SECRET_ID_', '/_SECRET_ID_/_SECRET_ID_', '/panier;jsessionid=_SECRET_ID_',
  '/f/_SECRET_ID_.pdf;jsessionid=_SECRET_ID_', '/commande/_SECRET_ID_/facture/_SECRET_ID_.pdf', '/photos/_SECRET_ID_.jpeg'
]

// un paramètre `nom=valeur` dont la valeur est un jeton, ou déjà masquée : la valeur masquée, le nom jugé seul — la partie entière
// n'est pas rejugée (la règle base64 prenait `v2session=_SECRET_ID_` pour un jeton, et le serveur avalait le nom)
const PARAMETRES_NOMMES: Array<[string, string]> = [
  ['/x;v2session=' + JETON, '/x;v2session=_SECRET_ID_'],
  ['/x;x9k2m4p7=' + JETON, '/x;x9k2m4p7=_SECRET_ID_'],
  ['/x;v2session=' + JETON + '.pdf', '/x;v2session=_SECRET_ID_.pdf'],
  ['/x;jsessionid=' + JETON, '/x;jsessionid=_SECRET_ID_'],
  ['/x;token=aB3dE5gH7jK9mN1pQr2sT12=', '/x;token=_SECRET_ID_'],
  ['/x;' + JETON + '=' + UUID, '/x;_SECRET_ID_=_SECRET_ID_'],
  ['/x;' + HEX32 + '=' + JETON + '.pdf', '/x;_SECRET_ID_=_SECRET_ID_.pdf'],
  ['/x;jean.dupont%40example.com=' + JETON, '/x;_SECRET_ID_=_SECRET_ID_'],
  ['/x;' + JETON + '=_SECRET_ID_', '/x;_SECRET_ID_=_SECRET_ID_']
]

// un nom qui est un jeton part masqué, que la valeur soit masquée ou en clair — jugé comme un segment, extension comprise
const NOMS_JETONS: Array<[string, string]> = [
  ['/x;' + UUID + '=fr', '/x;_SECRET_ID_=fr'],
  ['/x;' + JETON + '=fr', '/x;_SECRET_ID_=fr'],
  ['/x;' + HEX32 + '=1', '/x;_SECRET_ID_=1'],
  ['/x;' + JWT + '=1', '/x;_SECRET_ID_=1'],
  ['/x;0612345678=fr', '/x;_SECRET_ID_=fr'],
  ['/x;' + UUID + '=', '/x;_SECRET_ID_='],
  ['/x;' + JETON + '.pdf=' + JETON, '/x;_SECRET_ID_.pdf=_SECRET_ID_'],
  ['/x;' + JETON + '.pdf=fr', '/x;_SECRET_ID_.pdf=fr']
]

// une valeur qui n'est ni un jeton ni le remplaçant : la partie telle qu'elle partirait (`nomMasqué=valeur`) est jugée entière, comme
// avant — un base64 coupé par un `=` part entier ; un `=` de remplissage seul (`…sT12=`, `…==`) : la partie écrite est jugée
const PARTIES_ENTIERES: Array<[string, string]> = [
  ['/x;page=2', '/x;page=2'],
  ['/x/q=iphone-15', '/x/q=iphone-15'],
  ['/reset/aB3dE5gH7jK9mN1pQr2sT12=', '/reset/_SECRET_ID_'],
  ['/x/aB3dE5gH7jK9mN1pQr2sT1==', '/x/_SECRET_ID_'],
  ['/x;session=Ab3De5Gh7Jk9Mn', '/x;_SECRET_ID_'],
  ['/x;' + JETON + '=Ab3De5Gh7Jk9Mn', '/x;_SECRET_ID_']
]

// les écarts d'une liste : ce que rendent le navigateur et le serveur pour l'adresse, puis pour l'adresse attendue (déjà masquée)
function ecarts(cas: Array<[string, string]>) {
  const faux: string[] = []
  for (const [chemin, attendu] of cas) {
    for (const [entree, quoi] of [[chemin, ''], [attendu, 'déjà masquée : ']]) {
      const v = rendus(entree)
      if (v.navigateur !== SITE + attendu || v.serveur !== SITE + attendu) faux.push(quoi + entree + ' → navigateur ' + v.navigateur.slice(SITE.length) + ', serveur ' + v.serveur?.slice(SITE.length) + ' (attendu ' + attendu + ')')
    }
  }
  return faux
}

// un point d'une page à cette adresse
const point = (url: string) =>({ url, ev: 'click', z: [['document', 0.5, 0.5, 100, 100]] })

// le paquet sur une appli réduite à ce qu'il touche (une trame se joue par `recoit`), son fichier à cet endroit
function demarre(file: string) {
  const journal: Array<[string, string]> = []
  const handlers: any                    = {}
  const app: any                         = { on(type: string, h: (p: unknown, c: unknown) => void) { handlers[type] = h }, stop: async () => {} }
  const pkg: any                         = heatmapPackage({ origins: [SITE], file, onLog: (niveau: string, message: string) => journal.push([niveau, message]) })
  pkg.installer(app)
  const recoit = (p: unknown) => handlers['heatmap:point'](p, { meta: { origin: SITE } })
  const urls   = () => (app.heatmap().pages as Array<{ url: string }>).map((p) => p.url).sort()
  return { app, journal, recoit, urls }
}

describe('*heatmap — le morceau d\'adresse masqué s\'écrit _SECRET_ID_, des deux côtés', function () {
  this.timeout(30000)

  it('un segment qui est un jeton, un UUID, un JWT, un e-mail, une clé ou un numéro : _SECRET_ID_ au navigateur et au serveur', () => {
    for (const [chemin, attendu] of SEGMENTS) assert.deepEqual(rendus(chemin), pareil(attendu), chemin)
  })

  it('un jeton devant une extension : _SECRET_ID_.pdf, l\'extension reste', () => {
    for (const [chemin, attendu] of EXTENSIONS) assert.deepEqual(rendus(chemin), pareil(attendu), chemin)
  })

  it('la valeur d\'un paramètre de chemin : ;jsessionid=_SECRET_ID_, le nom reste', () => {
    for (const [chemin, attendu] of PARAMETRES) assert.deepEqual(rendus(chemin), pareil(attendu), chemin)
  })

  it('la route du routeur MJS (#/…) : la même règle', () => {
    assert.deepEqual(rendus('/', '#/commande/8F3K-29XQ-77LM'), pareil('/#/commande/_SECRET_ID_'))
    assert.deepEqual(rendus('/app', '#/f/' + JETON + '.pdf?x=1'), pareil('/app#/f/_SECRET_ID_.pdf'))
  })

  it('une adresse déjà masquée ressort identique des deux masqueurs : _SECRET_ID_ n\'est jamais pris pour un jeton', () => {
    for (const chemin of DEJA_MASQUEES) assert.deepEqual(rendus(chemin), pareil(chemin), chemin)
    assert.deepEqual(rendus('/app', '#/commande/_SECRET_ID_'), pareil('/app#/commande/_SECRET_ID_'))
    // ce que le navigateur envoie, repassé aux deux masqueurs, ne bouge plus
    for (const [chemin] of [...SEGMENTS, ...EXTENSIONS, ...PARAMETRES]) {
      const envoyee = navigateur(chemin).slice(SITE.length)
      assert.deepEqual(rendus(envoyee), pareil(envoyee), chemin)
    }
  })
})

describe('*heatmap — le serveur range telle quelle l\'adresse masquée qu\'il reçoit', function () {
  this.timeout(30000)

  it('de l\'effet au paquet, par une vraie connexion : l\'adresse envoyée porte _SECRET_ID_, le serveur la garde ainsi', async () => {
    const v = await visite()
    try {
      v.va('/commande/8F3K-29XQ-77LM', '#/f/' + JETON + '.pdf')
      v.pose(v.el)
      v.clic(0)
      await attendre(() => v.recus.length > 0, 3000)
      const attendue = SITE + '/commande/_SECRET_ID_#/f/_SECRET_ID_.pdf'
      const trame    = v.trames[v.trames.length - 1]
      assert.equal(trame?.url ?? trame?.pts?.[0]?.url, attendue, 'l\'adresse telle que le navigateur l\'envoie')
      assert.equal(v.recus[0]?.url, attendue, 'l\'adresse telle que le serveur la garde (onPoint)')
      assert.deepEqual(v.app.heatmap().pages.map((p: { url: string }) => p.url), [attendue], 'la carte range la page sous cette adresse')
    }
    finally {
      await v.fermer()
    }
  })

  it('aucune garde de forme ne refuse une adresse masquée : reçue, gardée, écrite, relue au redémarrage', async () => {
    const dir      = mjsTmp('chaleur-secret-id')
    const file     = join(dir, 'carte.json')
    const adresses = [SITE + '/commande/_SECRET_ID_', SITE + '/f/_SECRET_ID_.pdf;jsessionid=_SECRET_ID_', SITE + '/app#/commande/_SECRET_ID_']
    for (const url of adresses) assert.equal(cleanPoint(point(url), SITE)?.url, url, url)
    const a = demarre(file)
    for (const url of adresses) a.recoit(point(url))
    assert.deepEqual(a.urls(), [...adresses].sort(), 'reçues telles quelles')
    await a.app.stop()
    const b = demarre(file)
    assert.deepEqual(b.urls(), [...adresses].sort(), 'relues telles quelles : ' + JSON.stringify(b.journal))
    assert.ok(!b.journal.some(([niveau]) => niveau !== 'info'), JSON.stringify(b.journal))
  })
})

describe('*heatmap — un paramètre de chemin nom=valeur : le nom jugé seul, le serveur garde ce que le navigateur envoie', function () {
  this.timeout(60000)

  it('une valeur jeton ou déjà masquée : le nom reste s\'il n\'est pas un jeton, part sinon, et la partie entière n\'est pas rejugée', () => {
    assert.deepEqual(ecarts(PARAMETRES_NOMMES), [])
    assert.deepEqual(rendus('/', '#/x;v2session=' + JETON), pareil('/#/x;v2session=_SECRET_ID_'))
    assert.deepEqual(rendus('/', '#/x;v2session=_SECRET_ID_'), pareil('/#/x;v2session=_SECRET_ID_'))
  })

  it('un nom qui est un jeton part masqué devant une valeur en clair aussi, extension comprise : ;_SECRET_ID_=fr, ;_SECRET_ID_.pdf=_SECRET_ID_', () => {
    assert.deepEqual(ecarts(NOMS_JETONS), [])
  })

  it('une valeur qui n\'est ni un jeton ni le remplaçant : la partie telle qu\'elle partirait est jugée entière, comme avant', () => {
    assert.deepEqual(ecarts(PARTIES_ENTIERES), [])
  })

  it('20 000 paramètres aux noms tirés parmi des jetons (UUID, hexadécimal, JWT, téléphone, base64 mêlé, avec ou sans extension) : aucun nom en clair, aucun re-masquage', () => {
    let graine = 23102026
    // mulberry32 : le même hasard à chaque passage
    const hasard  = () => { graine |= 0; graine = graine + 0x6D2B79F5 | 0; let t = Math.imul(graine ^ graine >>> 15, 1 | graine); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
    const piocher = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(hasard() * alphabet.length)]).join('')
    const un      = <T>(liste: T[]) => liste[Math.floor(hasard() * liste.length)]
    const HEX     = '0123456789abcdef'
    const ALNUM   = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const B64URL  = ALNUM + '-_'
    const noms    = [
      () => [8, 4, 4, 4, 12].map((n) => piocher(HEX, n)).join('-'),
      () => piocher(HEX, 32),
      () => 'eyJ' + piocher(B64URL, 10) + '.' + piocher(B64URL, 20) + '.' + piocher(B64URL, 12),
      () => '06' + piocher('0123456789', 8),
      () => piocher(ALNUM, 22)
    ]
    const valeurs = [() => 'fr', () => '1', () => 'en-US', () => 'true', () => '', () => '=', () => piocher(ALNUM, 1 + Math.floor(hasard() * 12)), () => piocher('abcdefghijklmnopqrstuvwxyz0123456789', 8), () => JETON, () => UUID + '.pdf', () => '_SECRET_ID_', () => '_SECRET_ID_.pdf']
    const faux: string[] = []
    let jugees           = 0
    let jetons           = 0
    let mauvais          = 0
    for (let i = 0; i < 20000; i++) {
      const corps  = un(noms)()
      const nom    = corps + (hasard() < 0.3 ? un(['.pdf', '.json', '.jpg']) : '')
      const chemin = '/x;' + nom + '=' + un(valeurs)()
      if (new URL(SITE + chemin).pathname !== chemin) continue
      jugees++
      const envoyee = navigateur(chemin)
      const ecart   = [
        serveur(SITE + chemin) !== envoyee ? 'le serveur rend ' + serveur(SITE + chemin)?.slice(SITE.length) : '',
        serveur(envoyee) !== envoyee ? 'le serveur re-masque en ' + serveur(envoyee)?.slice(SITE.length) : '',
        navigateur(envoyee.slice(SITE.length)) !== envoyee ? 'le navigateur re-masque en ' + navigateur(envoyee.slice(SITE.length)).slice(SITE.length) : ''
      ].filter(Boolean)
      // un nom qui est un jeton, jugé comme un segment, ne sort jamais en clair
      if (navigateur('/' + nom) !== SITE + '/' + nom) {
        jetons++
        if (envoyee.includes(corps)) ecart.push('le nom sort en clair')
      }
      if (ecart.length) {
        mauvais++
        if (faux.length < 5) faux.push(chemin + ' → ' + envoyee.slice(SITE.length) + ' : ' + ecart.join(', '))
      }
    }
    assert.deepEqual({ mauvais, faux }, { mauvais: 0, faux: [] })
    assert.ok(jugees > 19000 && jetons > jugees * 0.95, 'assez de noms-jetons jugés : ' + jetons + ' sur ' + jugees)
  })

  it('20 000 noms de paramètre tirés au hasard (8 à 12 caractères, a-z0-9) devant un jeton : le nom jugé seul, aucun re-masquage au serveur', () => {
    let graine = 22102026
    // mulberry32 : le même hasard à chaque passage
    const hasard = () => { graine |= 0; graine = graine + 0x6D2B79F5 | 0; let t = Math.imul(graine ^ graine >>> 15, 1 | graine); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
    const ALPHABET       = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const faux: string[] = []
    let remasquees       = 0
    let nomsMasques      = 0
    for (let i = 0; i < 20000; i++) {
      const nom = Array.from({ length: 8 + Math.floor(hasard() * 5) }, () => ALPHABET[Math.floor(hasard() * ALPHABET.length)]).join('')
      // le nom jugé seul, comme un segment
      const juge    = navigateur('/' + nom).slice(SITE.length + 1)
      const envoyee = navigateur('/x;' + nom + '=' + JETON)
      const gardee  = serveur(envoyee)
      if (juge !== nom) nomsMasques++
      if (envoyee !== SITE + '/x;' + juge + '=_SECRET_ID_' && faux.length < 5) faux.push('navigateur : ' + envoyee.slice(SITE.length))
      if (gardee !== envoyee) {
        remasquees++
        if (faux.length < 5) faux.push('serveur : ' + envoyee.slice(SITE.length) + ' → ' + gardee?.slice(SITE.length))
      }
    }
    assert.deepEqual({ remasquees, faux }, { remasquees: 0, faux: [] })
    assert.ok(nomsMasques < 100, 'les noms restent, sauf ceux qui sont des jetons : ' + nomsMasques + ' masqués sur 20 000')
  })
})
