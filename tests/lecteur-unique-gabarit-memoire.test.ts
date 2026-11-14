// une balise raccourci jamais refermée est rendue vide à la fermeture de son parent (ou à la fin du gabarit) : chaque
// nœud de son contenu déplacé une seule fois, la lecture par l'arbre reste linéaire en mémoire, à 20 000 comme à
// 100 000 balises. Mesuré dans un processus à part, au tas plafonné : une lecture qui garde une copie du contenu à
// chaque niveau y meurt faute de mémoire. Une fermante citée plus loin, dans un <title>, est cherchée pour toutes les
// balises en un seul balayage : une seule est avertie (celle que l'ancienne lecture refermait), en temps linéaire

import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
const PARSER = pathToFileURL(join(RACINE, 'src', 'parser', 'index.ts')).href
// plafond du tas du processus mesuré et borne du tas gardé par 100 000 balises lues (avec leur arbre de Node) ; borne
// du temps de lecture de 100 000 balises (linéaire : une seconde ; relire la suite pour chacune : plus d'une minute)
const PLAFOND_MO = 512
const BORNE_MO   = 200
const BORNE_MS   = 30000

// le processus mesuré : chaque gabarit lu par l'arbre, le tas gardé (arbre vivant, après un ramasse-miettes complet) ;
// une ligne JSON par gabarit
const SONDE = `
const p = await import(${JSON.stringify(PARSER)})
const ecrire = console.log
for (const [n, motif] of [[20000, 'div'], [100000, 'div'], [20000, 'fin'], [100000, 'fin'], [20000, 'citee'], [100000, 'citee']]) {
  const corps = '<@x a="1">t '.repeat(n)
  const html  = motif === 'fin' ? corps : '<div>' + corps + '</div>' + (motif === 'citee' ? '<title></@x></title>' : '')
  let avertissements = 0
  globalThis.gc()
  const avant  = process.memoryUsage().heapUsed
  const t0     = performance.now()
  console.log = console.warn = console.error = () => { avertissements++ }
  const racine = p.parse(html, [])
  console.log = console.warn = console.error = ecrire
  const ms     = performance.now() - t0
  globalThis.gc()
  const tas    = process.memoryUsage().heapUsed - avant
  const liste  = motif === 'fin' ? racine.children : racine.children[0].children
  const vides  = liste.filter((x) => x.name === 'mjs-x' && x.children.length === 0).length
  ecrire(JSON.stringify({ n, motif, enfants: liste.length, vides, avertissements, tasMo: Math.round(tas / 2 ** 20), ms: Math.round(ms) }))
}
`

describe('balises raccourci non refermées : la lecture par l\'arbre linéaire en mémoire', () => {
  it(`20 000 et 100 000 balises, dans un <div>, en fin de gabarit et suivies d'une fermante citée : lues sous un tas de ${PLAFOND_MO} Mo, ${BORNE_MO} Mo gardés au plus`, function () {
    this.timeout(120000)
    const r = spawnSync(process.execPath, ['--import', 'tsx', `--max-old-space-size=${PLAFOND_MO}`, '--expose-gc', '--input-type=module', '-e', SONDE], { cwd: RACINE, encoding: 'utf-8', timeout: 110000 })
    assert.equal(r.status, 0, `le processus mesuré a échoué (signal ${r.signal}) : ${(r.stderr ?? '').slice(-600)}`)
    const mesures = r.stdout.trim().split('\n').map((l) => JSON.parse(l) as { n: number, motif: string, enfants: number, vides: number, avertissements: number, tasMo: number, ms: number })
    assert.equal(mesures.length, 6, r.stdout)
    for (const m of mesures) {
      assert.equal(m.enfants, 2 * m.n, `${m.n} ${m.motif} : chaque balise suivie de son texte`)
      assert.equal(m.vides, m.n, `${m.n} ${m.motif} : chaque balise rendue vide`)
      assert.ok(m.tasMo <= BORNE_MO, `${m.n} ${m.motif} : ${m.tasMo} Mo gardés`)
      assert.equal(m.avertissements, m.motif === 'citee' ? 1 : 0, `${m.n} ${m.motif} : ${m.avertissements} avertissements`)
      assert.ok(m.ms <= BORNE_MS, `${m.n} ${m.motif} : lu en ${m.ms} ms`)
    }
  })
})
