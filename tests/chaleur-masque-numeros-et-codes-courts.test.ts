// *heatmap : un numéro de 6 chiffres ou plus se masque aussi quand il est écrit en groupes, séparés par des tirets, des points ou
// des espaces, avec un `+` en tête (`555-123-4567`, `06.12.34.56.78`, `+33-6-12-34-56-78`) ; une date reste en clair (`2024-10-20`,
// `20-10-2024`, `2024-10`). Un code court tiré au hasard, de groupes de longueurs inégales qui mêlent lettres et chiffres
// (`A7K2-9QXB4M-P3Z`, `c6h-suf-px7-hnh`), se masque aussi ; un slug qui porte un nombre reste en clair (`release-2-5-0`,
// `ps5-pro-review`). La MÊME règle au navigateur (mjs_fx_heatmap.ts) et au serveur (mjs-ws/heatmap.ts).

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

// les chemins qui ne rendent pas `attendu`, des deux côtés
function ecarts(chemins: string[], attendu: (chemin: string) => string): string[] {
  const out: string[] = []
  for (const chemin of chemins) {
    const r = rendus(chemin)
    if (r.navigateur !== attendu(chemin) || r.serveur !== attendu(chemin)) out.push(`${chemin} → navigateur ${r.navigateur} · serveur ${r.serveur}`)
  }
  return out
}

// un hasard qui se rejoue : mulberry32
function hasard(graine: number) {
  let g = graine
  return () => { g |= 0; g = g + 0x6D2B79F5 | 0; let t = Math.imul(g ^ g >>> 15, 1 | g); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}

describe('*heatmap — numéros en groupes et codes courts masqués, dates et slugs à nombre en clair', () => {
  it('un numéro de 6 chiffres ou plus écrit avec des tirets, des points, des espaces ou un + : _SECRET_ID_, au navigateur comme au serveur', () => {
    const numeros = [
      '/r/555-123-4567', '/r/06-12-34-56-78', '/r/+33-6-12-34-56-78', '/r/123-456-789', '/r/06.12.34.56.78', '/r/555.123.4567',
      '/r/06%2012%2034%2056%2078', '/r/%2B33%206%2012%2034%2056%2078', '/r/1234-5678', '/r/123-456', '/r/+1-555-123-4567'
    ]
    assert.deepEqual(ecarts(numeros, () => '/r/_SECRET_ID_'), [])
    assert.deepEqual(ecarts(['/f/555-123-4567.vcf'], () => '/f/_SECRET_ID_.vcf'), [])
  })

  it('une date, et un nombre de moins de 6 chiffres, restent en clair', () => {
    const clairs = ['/a/2024-10-20', '/a/20-10-2024', '/a/2024-10', '/a/20.10.2024', '/a/2024.10.20', '/a/1-5-2024', '/a/12-345', '/a/2.5.0', '/a/10.15.7']
    assert.deepEqual(ecarts(clairs, (c) => c), [])
  })

  it('un code court de groupes inégaux qui mêlent lettres et chiffres : _SECRET_ID_', () => {
    assert.deepEqual(ecarts(['/r/A7K2-9QXB4M-P3Z', '/r/c6h-suf-px7-hnh', '/r/dms-z7i-9qq-p9r', '/r/A7K2_9QXB4M_P3Z'], () => '/r/_SECRET_ID_'), [])
  })

  it('des codes tirés au hasard (4-6-3 capitales et chiffres, 4 × 3 minuscules et chiffres) : masqués dès qu\'une lettre touche un chiffre', () => {
    const rnd = hasard(20102026)
    const MAJ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const MIN = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const tire = (alpha: string, tailles: number[]) => tailles.map((n) => Array.from({ length: n }, () => alpha[Math.floor(rnd() * alpha.length)]).join('')).join('-')
    for (const [alpha, tailles] of [[MAJ, [4, 6, 3]], [MIN, [3, 3, 3, 3]], [MIN, [4, 4, 5]], [MAJ, [3, 4, 3]]] as Array<[string, number[]]>) {
      const codes = Array.from({ length: 2000 }, () => tire(alpha, tailles)).filter((c) => /[A-Za-z]\d|\d[A-Za-z]/.test(c))
      assert.ok(codes.length > 1000, 'assez de tirages')
      const clairs = ecarts(codes.map((c) => '/r/' + c), () => '/r/_SECRET_ID_')
      assert.ok(clairs.length * 100 <= codes.length, `${tailles.join('-')} : ${clairs.length} sur ${codes.length} en clair (1 pour 100 au plus) : ${clairs.slice(0, 5).join(' | ')}`)
    }
  })

  it('des slugs qui portent un nombre restent en clair', () => {
    const slugs = [
      '/blog/release-2-5-0', '/blog/top-10-des-cafes', '/blog/comment-installer-php-8', '/blog/api-v2-rest-json-guide', '/tests/ps5-pro-review',
      '/tests/rtx-4090-test', '/tests/nvidia-rtx-4090', '/blog/web3-dev-tools', '/blog/h264-codec-guide', '/tests/galaxy-s23-ultra',
      '/blog/mp3-player-test', '/blog/win10-pro-key', '/blog/iphone-15-pro', '/blog/covid-19-vaccin', '/wiki/Samsung_Galaxy_S23_Ultra'
    ]
    assert.deepEqual(ecarts(slugs, (c) => c), [])
  })
})
