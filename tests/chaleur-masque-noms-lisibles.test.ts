// *heatmap : le masque des jetons laisse en clair les noms de page qui se lisent — noms de produit (`Samsung_Galaxy_S23_Ultra`,
// `MacBook-Pro-M3-Max-Review`), noms de fichier d'appareil photo (`IMG20241003123456.jpg`), dates compactes (`20241003T101500Z`),
// slugs à version (`bootstrap5components`), mots écrits en hexadécimal (`added2023`, `face2face`) — sans rien perdre sur les vrais
// jetons (base64url, hexadécimal, alphanumérique). Choix visible : un hexadécimal de 8 caractères reste un jeton court, même
// quand il se lit (`abc12345` est masqué). La MÊME règle au navigateur et au serveur.

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { cleanPoint } from '../src/mjs-ws/heatmap.js'
import { heatmapSrc } from './helpers/chaleur-visite.js'

const SITE = 'https://site.fr'

const serveur = (url: string) => cleanPoint({ url, ev: 'click', z: [['document', 0.5, 0.5, 1, 1]] })?.url

const navigateur = (() => {
  const loc: any = { origin: SITE, pathname: '/', hash: '', href: SITE + '/' }
  const µ: any = { _mjs_fxDefs: {} }
  const ex: any = new Function('µ', 'location', heatmapSrc + '\n;return { url: _mjsHeatmapUrl }')(µ, loc)
  return { url: (pathname: string) => { loc.pathname = pathname; return ex.url() as string } }
})()

const rendus = (pathname: string) => ({ navigateur: navigateur.url(pathname), serveur: serveur(SITE + pathname) })
const pareil = (attendu: string) => ({ navigateur: SITE + attendu, serveur: SITE + attendu })

// les 13 noms de page lisibles, puis leurs familles
const LISIBLES = [
  'Samsung_Galaxy_S23_Ultra', 'MacBook-Pro-M3-Max-Review', 'How-To-Use-iPhone15-Pro-Max', 'IMG20241003123456.jpg', 'screenshot20241003.png',
  'added2023', 'face2face', 'decaf2024', '20241003T101500Z', 'bootstrap5components', 'internationalization2024guide', 'MaterialDesign3Guidelines',
  // noms de produit
  'Samsung_Galaxy_S24_Ultra', 'Apple_iPhone_15_Pro_Max', 'Google-Pixel-8-Pro-Review', 'MacBook-Air-M2-Review', 'Nintendo_Switch_OLED_Model',
  // dates compactes et noms de fichier d'appareil photo
  'IMG20241003123456', 'IMG_20241003_123456.jpg', 'DSC20241003123456.jpg', 'PXL20241003123456789.jpg', 'screenshot20241003123456.png', 'Screenshot_20241003-101500.png',
  '20241003T101500Z', '20241003T101500', 'rapport20241003final', 'compteRendu20241003',
  // slugs à version, mots avec un chiffre
  'bootstrap5components', 'tailwindcss3configuration', 'angular17migrationguide', 'react18concurrentfeatures', 'MaterialDesign3Guidelines', 'internationalization2024guide',
  'WebAssembly2Introduction', 'Python3Tutorial_ForBeginners',
  // mots écrits en hexadécimal
  'added2023', 'face2face', 'decaf2024', 'deface2024', 'facade2024', 'beaded2024'
]

const AVEC_EXTENSION = (s: string) => /\.(jpg|png)$/.test(s)

describe('*heatmap — le masque des jetons : les noms de page lisibles restent en clair', function () {
  this.timeout(60000)

  it('13 noms de page lisibles et leurs familles (produits, dates compactes, fichiers d\'appareil photo, slugs à version, mots en hexadécimal) restent en clair, des deux côtés', () => {
    const ecarts: string[] = []
    for (const nom of LISIBLES) {
      const chemin = '/p/' + nom
      const v = rendus(chemin)
      if (v.navigateur !== SITE + chemin || v.serveur !== SITE + chemin) ecarts.push(nom + ' → navigateur ' + v.navigateur.replace(SITE, '') + ', serveur ' + v.serveur?.replace(SITE, ''))
    }
    assert.deepEqual(ecarts, [], ecarts.length + ' noms sur ' + LISIBLES.length + ' masqués à tort')
    assert.ok(LISIBLES.some(AVEC_EXTENSION))
  })

  it('le choix visible : un hexadécimal de 8 caractères reste un jeton court, même quand il se lit (`abc12345`) ; les jetons voisins restent masqués', () => {
    const jetons = ['abc12345', '5f3a9c2e', 'deadbeef1234', '0123456789abcdef0123456789abcdef', 'AbCdEf0123456789AbCdEf', 'aB3dE5gH7jK9mN1pQr2sT', '550e8400-e29b-41d4-a716-446655440000']
    for (const jeton of jetons) {
      const v = rendus('/reset/' + jeton)
      assert.deepEqual(v, pareil('/reset/_SECRET_ID_'), jeton)
    }
  })

  it('20 000 jetons tirés de chaque famille (hasard du système) : la part laissée en clair reste au niveau d\'avant', () => {
    const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const B36 = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const piocher = (alphabet: string, n: number) => { const r = randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += alphabet[r[i] % alphabet.length]; return s }
    // [fabrique, plafond en part de jetons laissés en clair] — les plafonds suivent l'ancienne règle, avec une marge de hasard
    const familles: Array<[string, () => string, number]> = [
      ['base64url 22', () => randomBytes(16).toString('base64url'), 0.037],
      ['base64url 43', () => randomBytes(32).toString('base64url'), 0.003],
      ['hexadécimal 12', () => randomBytes(6).toString('hex'), 0.0015],
      ['hexadécimal 32', () => randomBytes(16).toString('hex'), 0.0005],
      ['hexadécimal 10', () => randomBytes(5).toString('hex'), 0.006],
      ['alphanumérique 32', () => piocher(ALNUM, 32), 0.008],
      ['alphanumérique 20', () => piocher(ALNUM, 20), 0.045],
      ['minuscules et chiffres 24', () => piocher(B36, 24), 0.006],
      ['minuscules et chiffres 16', () => piocher(B36, 16), 0.02],
      ['uuid', () => [4, 2, 2, 2, 6].map((n) => randomBytes(n).toString('hex')).join('-'), 0]
    ]
    for (const [nom, fabrique, plafond] of familles) {
      let enClair = 0
      for (let i = 0; i < 20000; i++) if (!navigateur.url('/x/' + fabrique()).includes('_SECRET_ID_')) enClair++
      const part = enClair / 20000
      assert.ok(part <= plafond, nom + ' : ' + (100 * part).toFixed(2) + ' % en clair, plafond ' + (100 * plafond).toFixed(2) + ' %')
    }
  })

  it('le navigateur et le serveur ne divergent jamais sur les noms lisibles, leurs variantes et des jetons proches', () => {
    const variantes = [...LISIBLES, ...LISIBLES.map((s) => s.toUpperCase()), ...LISIBLES.map((s) => s.toLowerCase()), 'abc12345', 'face2face9', 'aaaaaaaa1', 'abcdef123456', 'Qxzjvkwqxzjv1234']
    for (const nom of variantes) {
      const v = rendus('/p/' + nom)
      assert.equal(v.serveur, v.navigateur, nom)
    }
  })
})
