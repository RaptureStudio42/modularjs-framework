// *heatmap : un segment d'adresse fait de mots en minuscules séparés par des tirets (un slug) reste en clair, même quand UN de ses mots
// a une paire de lettres que la table des mots courants ne connaît pas — un nom de marque, un mot composé, un mot rare (`workflow`,
// `nodejs`, `jquery`, `postgresql`, `svelte`, `chatgpt`, `macbook`, `aujourd`…) : 10 lettres au plus, une voyelle, jamais cinq consonnes
// de suite, une seule paire hors table (deux pour un mot de 6 lettres au plus : `nextjs`). Un jeton reste masqué : base64url,
// hexadécimal, chiffres et lettres mêlés, longue suite sans voyelles, un seul mot de lettres de 16 caractères ou plus, et les jetons de
// minuscules à séparateurs (`tok_` + 16 lettres, `invite-` + 12 lettres, `xxxxx-xxxxx-…`, `xxxxxx_xxxxxx_xxxxxx`) : un morceau tiré au
// hasard ne se distingue plus d'un tel mot au-delà de 10 lettres, ni quand deux mots du slug manquent à la table ; `_` lie les morceaux
// d'un identifiant, pas les mots d'un slug. Un mot court (4 lettres au plus) entre deux séparateurs se prononce, ou c'est un sigle
// (`php`, `vs`, `IMG`, `json`) : les sigles font moins d'un cinquième du segment, et un sigle de 4 lettres veut un mot de 5 lettres ou
// plus, ou un nombre, à côté — une clé de licence (`xxxx-xxxx-xxxx-xxxx`, des groupes de lettres tirées au hasard) se masque.
// Une clé de trois groupes ou plus de 4 à 6 lettres ou chiffres, tous de la même longueur, séparés par `-` ou `_`, en capitales comme en
// minuscules, seule ou au bout du segment derrière un mot (`xxxxx-xxxxx-xxxxx-xxxxx`, `XXXX_XXXX_XXXX_XXXX`, `key-xxxxx-xxxxx-xxxxx`), se
// masque : à chiffres quelle que soit sa longueur (`1234-5678-9012`, 14 caractères) ; de lettres, elle ne se lit qu'en quatre groupes ou plus,
// chacun un mot qui se prononce, à deux voyelles au moins (`salut-monde-pomme-poire`) ; trois mots de même longueur se masquent même quand ils
// se lisent (`react-hooks-guide`, `the-black-white-photo`), sauf trois mots de 4 lettres seuls, sous 16 caractères, lus comme un slug
// (`best-food-ever` ; `html-form-tips`, dont un mot ne se prononce pas, se masque).
// La MÊME règle au navigateur (mjs_fx_heatmap.ts) et au serveur (mjs-ws/heatmap.ts).

import assert from 'node:assert/strict'
import { cleanPoint } from '../src/mjs-ws/heatmap.js'
import { heatmapSrc } from './helpers/chaleur-visite.js'

const SITE = 'https://site.fr'

const serveur = (url: string) => cleanPoint({ url, ev: 'click', z: [['document', 0.5, 0.5, 1, 1]] })?.url

const navigateur = (() => {
  const loc: any = { origin: SITE, pathname: '/', hash: '', href: SITE + '/' }
  const µ: any = { _mjs_fxDefs: {} }
  const ex: any = new Function('µ', 'location', heatmapSrc + '\n;return { chemin: _mjsHeatmapSegments }')(µ, loc)
  return (pathname: string) => ex.chemin(pathname) as string
})()

const rendus = (chemin: string) => ({ navigateur: navigateur(chemin), serveur: serveur(SITE + chemin)?.replace(SITE, '') })

// un hasard qui se rejoue : mulberry32
function hasard(graine: number) {
  let g = graine
  return () => { g |= 0; g = g + 0x6D2B79F5 | 0; let t = Math.imul(g ^ g >>> 15, 1 | g); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}

const MIN = 'abcdefghijklmnopqrstuvwxyz'
const MAJ = MIN.toUpperCase()
const CHIFFRES = '0123456789'

describe('*heatmap — les slugs lisibles restent en clair, les jetons restent masqués', function () {
  this.timeout(120000)

  it('des slugs dont un mot manque à la table des paires de lettres : en clair, au navigateur comme au serveur', () => {
    const lisibles = [
      '/blog/github-actions-workflow', '/blog/nextjs-app-router-guide', '/blog/nodejs-best-practices', '/tutoriels/vuejs-components-guide',
      '/docs/jquery-ui-datepicker', '/recettes/breakfast-ideas-easy', '/tests/macbook-pro-review', '/blog/chatgpt-prompts-guide',
      '/actu/aujourd-hui-en-france', '/blog/postgresql-performance-tips', '/blog/svelte-vs-react-comparison',
      '/blog/webpack-vs-esbuild-vite', '/blog/frontend-backend-fullstack', '/shop/sneakers-nike-airmax-blanc', '/blog/kubernetes-deployment-guide',
      '/blog/awfulness-timidity-knotting', '/blog/surgeons-yummier-powwowing', '/blog/chilly-gewgaws-wingless', '/blog/unconcern-shrapnel-snaking',
      '/blog/filth-huffier-grapnels', '/blog/canticle-finance-halfpence', '/blog/notifiais-goujonnez-approches', '/blog/azurerons-galoperez-recalions',
      '/blog/gressins-chatonnes-abhorrant', '/blog/encharnas-ixai-diptyques', '/blog/annexe-pfennig-mailles', '/blog/conclu-cawcher-redite'
    ]
    const ecarts: string[] = []
    for (const chemin of lisibles) {
      const v = rendus(chemin)
      if (v.navigateur !== chemin || v.serveur !== chemin) ecarts.push(chemin + ' → navigateur ' + v.navigateur + ', serveur ' + v.serveur)
    }
    assert.deepEqual(ecarts, [])
  })

  it('les jetons à tirets restent masqués : longue suite sans voyelles, chiffres et lettres mêlés, base64url, un seul mot', () => {
    const jetons = [
      '/reset/xkcd-qwrtzplmnbvcx', '/reset/bcdfg-hjklmnpqrstvw', '/reset/a1b2c3d4-e5f6g7h8', '/reset/dTpkbjlZy_NTPKpx',
      '/reset/A5TXp-4gNA8EIaud', '/reset/k7f2m9x4-p8q3w6z1', '/reset/abcdefghijklmnop', '/magic/xkqzvbnmwrtplkjhgfds'
    ]
    const ecarts: string[] = []
    for (const chemin of jetons) {
      const attendu = chemin.replace(/[^/]+$/, '_SECRET_ID_')
      const v = rendus(chemin)
      if (v.navigateur !== attendu || v.serveur !== attendu) ecarts.push(chemin + ' → navigateur ' + v.navigateur + ', serveur ' + v.serveur)
    }
    assert.deepEqual(ecarts, [])
  })

  it('5 000 jetons tirés au hasard par famille (base64url, minuscules, hexadécimal ; 16 et 22 caractères) : aucun en clair, des deux côtés', () => {
    const rnd = hasard(20102026)
    const piocher = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('')
    const familles: Array<[string, string]> = [['base64url', MIN + MIN.toUpperCase() + '0123456789-_'], ['minuscules', MIN], ['hexadécimal', '0123456789abcdef']]
    for (const [nom, alphabet] of familles) {
      for (const n of [16, 22]) {
        const enClair: string[] = []
        for (let i = 0; i < 5000; i++) {
          const jeton = piocher(alphabet, n)
          const v = rendus('/r/' + jeton)
          if (v.navigateur !== '/r/_SECRET_ID_' || v.serveur !== '/r/_SECRET_ID_') enClair.push(jeton)
        }
        assert.deepEqual(enClair.slice(0, 5), [], nom + ' de ' + n + ' caractères : ' + enClair.length + ' en clair')
      }
    }
  })

  it('5 000 jetons de minuscules à séparateurs tirés au hasard par forme : moins de 1 pour 100 en clair, 0,2 pour une clé à groupes de même longueur, des deux côtés', () => {
    const rnd = hasard(19102026)
    const piocher = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('')
    const groupes = (k: number, n: number, sep: string) => Array.from({ length: k }, () => piocher(MIN, n)).join(sep)
    // `invite-` + 12 lettres : 2 pour 100 au plus — un tirage de 12 lettres dont toutes les paires sont dans la table se lit comme un mot
    // (environ 1,5 pour 100, la règle des mots qui se prononcent, slugs mis à part)
    // une clé à groupes de même longueur séparés par `-` (de 4 à 6 lettres) : 0,2 pour 100 au plus
    const formes: Array<[string, () => string, number]> = [
      ['tok_ + 16 lettres', () => 'tok_' + piocher(MIN, 16), 1],
      ['invite- + 12 lettres', () => 'invite-' + piocher(MIN, 12), 2],
      ['5 × 5 lettres à tirets', () => groupes(5, 5, '-'), 0.2],
      ['3 × 6 lettres à soulignés', () => groupes(3, 6, '_'), 1],
      ['16 caractères parmi a-z et _', () => piocher(MIN + '_', 16), 1],
      ['4 × 4 lettres à tirets (une clé de licence)', () => groupes(4, 4, '-'), 0.2],
      ['4 × 4 lettres à soulignés', () => groupes(4, 4, '_'), 1],
      ['5 × 4 lettres à tirets', () => groupes(5, 4, '-'), 0.2],
      ['4 × 5 lettres à tirets (une clé de produit)', () => groupes(4, 5, '-'), 0.2],
      ['3 × 5 lettres à tirets', () => groupes(3, 5, '-'), 0.2],
      ['4 × 6 lettres à tirets', () => groupes(4, 6, '-'), 0.2],
      ['3 × 6 lettres à tirets', () => groupes(3, 6, '-'), 0.2],
      ['5 × 6 lettres à tirets', () => groupes(5, 6, '-'), 0.2]
    ]
    const ecarts: string[] = []
    for (const [nom, tirer, plafond] of formes) {
      const enClair: string[] = []
      let desaccords = 0
      for (let i = 0; i < 5000; i++) {
        const jeton = tirer()
        const v = rendus('/r/' + jeton)
        if (v.navigateur !== '/r/_SECRET_ID_' || v.serveur !== '/r/_SECRET_ID_') enClair.push(jeton)
        if (v.navigateur !== v.serveur) desaccords++
      }
      if (enClair.length * 100 >= 5000 * plafond) ecarts.push(nom + ' : ' + (enClair.length / 50).toFixed(2) + ' % en clair (' + enClair.slice(0, 3).join(', ') + '…)')
      if (desaccords) ecarts.push(nom + ' : ' + desaccords + ' rendus différents du navigateur au serveur')
    }
    assert.deepEqual(ecarts, [])
  })

  it('5 000 clés tirées au hasard par forme, des groupes de chiffres ou de minuscules et chiffres mêlés (3 à 5 groupes de 4 à 6, à tirets, trois groupes de 4 compris) : moins de 0,2 pour 100 en clair, le même rendu des deux côtés', () => {
    const rnd = hasard(19102026)
    const piocher = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('')
    const ecarts: string[] = []
    for (const [nom, alphabet] of [['chiffres', '0123456789'], ['minuscules et chiffres', MIN + '0123456789']]) {
      for (const k of [3, 4, 5]) {
        for (const n of [4, 5, 6]) {
          let enClair = 0
          let desaccords = 0
          for (let i = 0; i < 5000; i++) {
            const cle = Array.from({ length: k }, () => piocher(alphabet, n)).join('-')
            const v = rendus('/r/' + cle)
            if (v.serveur !== '/r/_SECRET_ID_') enClair++
            if (v.navigateur !== v.serveur) desaccords++
          }
          if (enClair * 100 >= 5000 * 0.2 || desaccords) ecarts.push(nom + ', ' + k + ' × ' + n + ' : ' + (enClair / 50).toFixed(2) + ' % en clair, ' + desaccords + ' rendus différents')
        }
      }
    }
    assert.deepEqual(ecarts, [])
  })

  it('5 000 clés tirées au hasard par forme, à soulignés comme à tirets, en capitales, seules ou derrière un mot (key-…) : moins de 0,2 pour 100 en clair, le même rendu des deux côtés', () => {
    const rnd = hasard(19102026)
    const piocher = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('')
    const alphabets: Array<[string, string]> = [['minuscules', MIN], ['chiffres', CHIFFRES], ['minuscules et chiffres', MIN + CHIFFRES], ['capitales', MAJ], ['capitales et chiffres', MAJ + CHIFFRES]]
    const ecarts: string[] = []
    for (const [nom, alphabet] of alphabets) {
      for (const sep of ['-', '_']) {
        for (const devant of ['', 'key' + sep]) {
          // seules à tirets, minuscules et chiffres : mesurées plus haut
          if (!devant && sep === '-' && !/[A-Z]/.test(alphabet)) continue
          for (const [k, n] of [[3, 4], [3, 5], [4, 4], [4, 5], [5, 4]]) {
            // trois groupes de 4 lettres seuls (14 caractères) se lisent comme un slug : hors de cette mesure
            if (!devant && k === 3 && n === 4 && !/\d/.test(alphabet)) continue
            let enClair = 0
            let desaccords = 0
            for (let i = 0; i < 5000; i++) {
              const cle = devant + Array.from({ length: k }, () => piocher(alphabet, n)).join(sep)
              const v = rendus('/r/' + cle)
              if (v.navigateur !== '/r/_SECRET_ID_' || v.serveur !== '/r/_SECRET_ID_') enClair++
              if (v.navigateur !== v.serveur) desaccords++
            }
            if (enClair * 100 >= 5000 * 0.2 || desaccords) ecarts.push(devant + nom + ' (' + sep + '), ' + k + ' × ' + n + ' : ' + (enClair / 50).toFixed(2) + ' % en clair, ' + desaccords + ' rendus différents')
          }
        }
      }
    }
    assert.deepEqual(ecarts, [])
  })

  it('une clé derrière un mot, à soulignés, en capitales, trois groupes de 4 à chiffres : masquée, des deux côtés', () => {
    const masques = [
      '/p/1234-5678-9012', '/r/ab12-cd34-ef56', '/r/AB12-CD34-EF56', '/r/1234_5678_9012_3456', '/r/ABCDE-FGHIJ-KLMNO-PQRST',
      '/r/key-abcde-fghij-klmno', '/r/key-12345-67890-12345', '/r/order-1234-5678-9012', '/r/key_ABCDE_FGHIJ_KLMNO'
    ]
    const ecarts: string[] = []
    for (const chemin of masques) {
      const attendu = chemin.replace(/[^/]+$/, '_SECRET_ID_')
      const v = rendus(chemin)
      if (v.navigateur !== attendu || v.serveur !== attendu) ecarts.push(chemin + ' → navigateur ' + v.navigateur + ', serveur ' + v.serveur)
    }
    assert.deepEqual(ecarts, [])
  })

  it('par prudence, trois mots de même longueur au bout d\'un slug, et trois mots de 4 lettres dont un ne se prononce pas : masqués, des deux côtés', () => {
    const masques = ['/blog/the-black-white-photo', '/blog/how-to-make-your-site-fast', '/blog/2024-best-tips', '/blog/html-form-tips']
    const ecarts: string[] = []
    for (const chemin of masques) {
      const attendu = chemin.replace(/[^/]+$/, '_SECRET_ID_')
      const v = rendus(chemin)
      if (v.navigateur !== attendu || v.serveur !== attendu) ecarts.push(chemin + ' → navigateur ' + v.navigateur + ', serveur ' + v.serveur)
    }
    assert.deepEqual(ecarts, [])
  })

  it('des mots courts et des sigles (php, vs, IMG, json) à côté de mots qui se lisent ou de nombres : en clair, des deux côtés', () => {
    const lisibles = [
      '/docs/mjs-ws-4-5-la-carte-de-chaleur', '/articles/comment-installer-php-8', '/blog/how-to-use-git-in-vs-code', '/blog/how-to-use-css-grid',
      '/docs/api-v2-rest-json-guide', '/p/IMG_20241003_123456', '/blog/the-best-of-2024-so-far', '/blog/je-suis-la-pour-toi-ce-soir',
      '/blog/seo-tips-for-wp-sites', '/wiki/2026_FIFA_World_Cup', '/p/MacBook-Pro-M3-Max-Review', '/p/Nintendo_Switch_OLED_Model',
      '/blog/Mon_Article_Du_Jour', '/blog/top-10-des-cafes', '/blog/release-2-5-0'
    ]
    const ecarts: string[] = []
    for (const chemin of lisibles) {
      const v = rendus(chemin)
      if (v.navigateur !== chemin || v.serveur !== chemin) ecarts.push(chemin + ' → navigateur ' + v.navigateur + ', serveur ' + v.serveur)
    }
    assert.deepEqual(ecarts, [])
  })

  it('des slugs de mots de 4 à 6 lettres, de même longueur en quatre mots ou plus qui se prononcent : en clair, des deux côtés', () => {
    const lisibles = [
      '/blog/apres-midi-entre-amis', '/blog/salut-monde-pomme-poire', '/blog/belle-route-entre-alpes', '/blog/house-music-radio-guide',
      '/recettes/tarte-pomme-poire-maison', '/blog/salut_monde_pomme_poire', '/blog/Salut-Monde-Pomme-Poire', '/blog/best-food-ever'
    ]
    const ecarts: string[] = []
    for (const chemin of lisibles) {
      const v = rendus(chemin)
      if (v.navigateur !== chemin || v.serveur !== chemin) ecarts.push(chemin + ' → navigateur ' + v.navigateur + ', serveur ' + v.serveur)
    }
    assert.deepEqual(ecarts, [])
  })

  it('trois mots de même longueur, des groupes de chiffres : une clé, masquée même quand elle se lit', () => {
    const masques = ['/blog/react-hooks-guide', '/blog/salut-monde-pomme', '/p/1234-5678-9012-3456', '/r/12345-67890-12345']
    const ecarts: string[] = []
    for (const chemin of masques) {
      const attendu = chemin.replace(/[^/]+$/, '_SECRET_ID_')
      const v = rendus(chemin)
      if (v.navigateur !== attendu || v.serveur !== attendu) ecarts.push(chemin + ' → navigateur ' + v.navigateur + ', serveur ' + v.serveur)
    }
    assert.deepEqual(ecarts, [])
  })

  it('un mot hors table de plus de 10 lettres, deux mots hors table, des soulignés : le segment se masque', () => {
    const masques = ['/blog/jsonwebtoken-explained', '/docs/mon_projet_nodejs_express', '/blog/nodejs-vuejs-tips', '/r/invite-gkuletawsain']
    const ecarts: string[] = []
    for (const chemin of masques) {
      const attendu = chemin.replace(/[^/]+$/, '_SECRET_ID_')
      const v = rendus(chemin)
      if (v.navigateur !== attendu || v.serveur !== attendu) ecarts.push(chemin + ' → navigateur ' + v.navigateur + ', serveur ' + v.serveur)
    }
    assert.deepEqual(ecarts, [])
  })
})
