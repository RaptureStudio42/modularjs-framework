// Table à segments facultatifs : la correspondance du routeur (µ.Router._matchSegs) essaie chaque segment facultatif présent,
// puis absent si la suite échoue. Sans mémoire, chaque segment facultatif doublait les essais de la suite : vingt-quatre segments
// facultatifs devant un lien que la table ne prend pas figeaient la page près de deux minutes, trente pendant des heures. Les
// correspondances, paramètres compris, restent celles d'avant. La résolution tourne dans un fil à part, borné : un retour du
// défaut fait échouer le test au lieu de geler la suite.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Worker } from 'node:worker_threads'

const __dirname  = dirname(fileURLToPath(import.meta.url))
const ROUTER_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_router.ts'), 'utf-8')

// le fil charge le routeur, garde la première route de la table qui prend le lien, dans l'ordre du routeur, et chronomètre
// cette seule résolution
const FIL = `
const { parentPort, workerData } = require('node:worker_threads')
const µ = { _mjs_logger: () => null, _mjs_txt: (_k, _p, f) => f, log() {}, warn() {}, error() {} }
new Function('µ', workerData.src)(µ)
// une fusion de JSON portant __proto__ pose ses clés sur Object.prototype : même geste, avant la résolution
Object.assign(Object.prototype, workerData.pollution)
const t0   = performance.now()
let route  = null
let params = null
for (const r of µ.Router._mjs_sortedPaths(workerData.table)) {
  const m = µ.Router._mjs_matchRoute(workerData.lien, r)
  if (m.ok) { route = r; params = m.params; break }
}
parentPort.postMessage({ ms: performance.now() - t0, route, params })
`
const BORNE_MS  = 5000
const RAPIDE_MS = 100
const COURT_MS  = 1000

interface Resolution { fini: boolean, ms: number, route: string | null, params: any }

function resoudre(table: Record<string, string>, lien: string, pollution: Record<string, number> = {}): Promise<Resolution> {
  return new Promise((ok, ko) => {
    const fil   = new Worker(FIL, { eval: true, workerData: { src: ROUTER_SRC, table, lien, pollution } })
    const borne = setTimeout(() => { fil.terminate(); ok({ fini: false, ms: Infinity, route: null, params: null }) }, BORNE_MS)
    fil.once('message', (r) => { clearTimeout(borne); fil.terminate(); ok({ fini: true, ...r }) })
    fil.once('error', (e) => { clearTimeout(borne); ko(e) })
  })
}

// n segments facultatifs `(:p0)` … `(:pn-1)`, puis le littéral `fin`
function longue(n: number): string {
  return '/' + Array.from({ length: n }, (_v, i) => '(:p' + i + ')').join('/') + '/fin'
}

// n segments facultatifs entrelacés de littéraux `(:p0)/x/(:p1)/x/…`, puis le littéral `fin`
function entrelacee(n: number): string {
  return '/' + Array.from({ length: n }, (_v, i) => '(:p' + i + ')/x').join('/') + '/fin'
}

// quinze segments, sans `fin` : la longue route ne le prend pas
const SEGMENTS = Array.from({ length: 15 }, (_v, i) => 's' + i)
const LIEN_NON = '/' + SEGMENTS.join('/')

function rapide(r: Resolution): void {
  assert.ok(r.fini, 'pas résolu en ' + BORNE_MS + ' ms : sans mémoire, chaque segment facultatif double les essais de la suite')
  assert.ok(r.ms < RAPIDE_MS, 'résolu en ' + Math.round(r.ms) + ' ms, plus de ' + RAPIDE_MS + ' ms')
}

describe('mjs_router — table à segments facultatifs : résolue en quelques millisecondes, mêmes correspondances', function () {
  this.timeout(BORNE_MS * 3)

  for (const n of [24, 30]) {
    it(n + ' segments facultatifs, un lien que la table ne prend pas : aucune route', async function () {
      const r = await resoudre({ [longue(n)]: 'longue' }, LIEN_NON)
      rapide(r)
      assert.ok(r.route === null, 'la table ne prend pas ce lien, elle a rendu ' + r.route)
    })
  }

  it('30 segments facultatifs essayés avant un repli `/*` : le repli prend le lien, le joker garde ses segments', async function () {
    const r = await resoudre({ [longue(30)]: 'longue', '/*': 'repli' }, LIEN_NON)
    rapide(r)
    assert.equal(r.route, '/*')
    assert.deepEqual(r.params, { all: SEGMENTS, rest: SEGMENTS.join('/') })
  })

  it('30 segments facultatifs, un lien que la longue route prend : les premiers présents, les suivants absents', async function () {
    const r = await resoudre({ [longue(30)]: 'longue' }, '/a/b/c/fin')
    rapide(r)
    assert.equal(r.route, longue(30))
    const attendu: Record<string, string | undefined> = { p0: 'a', p1: 'b', p2: 'c' }
    for (let i = 3; i < 30; i++) attendu['p' + i] = undefined
    assert.deepEqual(r.params, attendu)
  })

  it('24 segments facultatifs, un lien de quinze segments puis `fin` : chaque segment pris par le premier facultatif venu', async function () {
    const r = await resoudre({ [longue(24)]: 'longue' }, LIEN_NON + '/fin')
    rapide(r)
    assert.equal(r.route, longue(24))
    const attendu: Record<string, string | undefined> = {}
    for (let i = 0; i < 24; i++) attendu['p' + i] = i < 15 ? SEGMENTS[i] : undefined
    assert.deepEqual(r.params, attendu)
  })

  // la mémoire des couples (segment de route, segment du lien) est un tableau d'octets : sous V8, un tableau creux ralentissait
  // d'un coup passé environ 1 200 segments — six cents facultatifs entrelacés de littéraux, cinq secondes au lieu de quelques
  // dizaines de millisecondes
  for (const n of [600, 1200]) {
    it(n + ' segments facultatifs entrelacés de littéraux, un lien de ' + n + ' segments que la table ne prend pas : résolu sans à-coup', async function () {
      const r = await resoudre({ [entrelacee(n)]: 'entrelacée' }, '/' + Array(n).fill('x').join('/'))
      assert.ok(r.fini, 'pas résolu en ' + BORNE_MS + ' ms : la mémoire des couples ralentit d\'un coup sur une grande table')
      assert.ok(r.ms < COURT_MS, 'résolu en ' + Math.round(r.ms) + ' ms, plus de ' + COURT_MS + ' ms')
      assert.ok(r.route === null, 'la table ne prend pas ce lien, elle a rendu ' + r.route)
    })
  }

  // une fusion de JSON portant `__proto__` pose des clés numériques sur Object.prototype : la mémoire ne les lit pas comme des
  // réponses déjà calculées — un tableau ordinaire y trouvait « oui » pour un couple jamais essayé, `/(:x)/a` ne prenait plus `/a`
  const POLLUTION = { 3: 2, 4: 1, 7: 1 }
  const CAS: [string, string, Record<string, string | undefined>][] = [
    ['/(:x)/a', '/a', { x: undefined }],
    ['/posts/(:id)/edit', '/posts/42/edit', { id: '42' }],
    ['/posts/(:id)/edit', '/posts/edit', { id: undefined }],
  ]
  for (const [route, lien, params] of CAS) {
    it('Object.prototype pollué de clés numériques : `' + route + '` prend `' + lien + '`, mêmes paramètres qu\'avec un prototype sain', async function () {
      const r = await resoudre({ [route]: 'route' }, lien, POLLUTION)
      assert.ok(r.fini, 'pas résolu en ' + BORNE_MS + ' ms')
      assert.equal(r.route, route)
      assert.deepEqual(r.params, params)
    })
  }
})
