// Les suites d'une boucle sur les moteurs jouées ensemble (tests/helpers/engines-together.ts) : un faux fichier de
// tests, sans navigateur, joué par un mocha à part, l'une après l'autre (MJS_ENSEMBLE=0) puis ensemble. Chaque
// moteur garde son verdict, test par test (vert, rouge, sauté, délai dépassé, `before` en échec) ; ensemble, les corps
// se chevauchent vraiment et le `after` d'une suite attend la fin des autres ; une suite que l'ensemble ne sait pas
// jouer est refusée tout haut

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { playTogether } from './helpers/engines-together.js'

const ROOT  = fileURLToPath(new URL('..', import.meta.url))
const AIDE  = join(ROOT, 'tests/helpers/engines-together.ts')
const MOCHA = join(ROOT, 'node_modules/mocha/bin/mocha.js')

// trois moteurs pour rire : un vert partout qui dure, un rouge sous firefox, un sauté sous webkit, un délai dépassé sous
// chromium ; AVANT_ROUGE fait échouer le `before` de webkit
const FAUX = `
import { writeFileSync } from 'node:fs'
import { playTogether } from ${JSON.stringify(AIDE)}
const journal = []
const pause   = (ms) => new Promise((r) => setTimeout(r, ms))
describe('faux moteurs', function () {
  after(() => { writeFileSync(process.env.JOURNAL, JSON.stringify(journal)) })
  for (const nom of ['chromium', 'firefox', 'webkit']) playTogether(describe(nom, function () {
    let pret = false
    before(async function () {
      await pause(100)
      if (nom === 'webkit' && process.env.AVANT_ROUGE) throw new Error('before rouge sous webkit')
      pret = true
    })
    after(async () => { journal.push(['after', nom, Date.now()]) })
    it('vert partout', async function () {
      journal.push(['debut', nom, Date.now()])
      await pause(300)
      journal.push(['fin', nom, Date.now()])
      if (!pret) throw new Error('before pas joué')
    })
    it('rouge sous firefox', async function () { if (nom === 'firefox') throw new Error('rouge sous firefox') })
    it('sauté sous webkit', async function () { if (nom === 'webkit') this.skip() })
    it('délai dépassé sous chromium', async function () { this.timeout(100); await pause(nom === 'chromium' ? 400 : 5) })
    it('vert à la fin', function () {})
  }))
})
`

type Passage = { verdicts: string[], journal: [string, string, number][] }

function jouer(dir: string, ensemble: boolean, avantRouge: boolean): Passage {
  const sortie  = join(dir, `sortie-${ensemble}-${avantRouge}.json`)
  const journal = join(dir, `journal-${ensemble}-${avantRouge}.json`)
  const env: Record<string, string | undefined> = { ...process.env, JOURNAL: journal, MJS_ENSEMBLE: ensemble ? '1' : '0', AVANT_ROUGE: avantRouge ? '1' : '' }
  delete env.MJS_MOTEURS
  const r = spawnSync(process.execPath, [MOCHA, '--require', 'tsx/esm', '--reporter', 'json', '--reporter-option', `output=${sortie}`, join(dir, 'faux.test.mjs')], { cwd: ROOT, env, encoding: 'utf-8', timeout: 60000 })
  assert.ok(r.status !== null, `mocha à part arrêté : ${r.signal} ${r.stderr}`)
  const rapport = JSON.parse(readFileSync(sortie, 'utf-8'))
  const etat    = (t: any) => (rapport.failures.some((f: any) => f.fullTitle === t.fullTitle) ? 'rouge ' + String(t.err?.message ?? '').split('\n')[0].replace(/\(.*\)$/, '') : rapport.pending.some((p: any) => p.fullTitle === t.fullTitle) ? 'sauté' : 'vert')
  const verdicts = [...rapport.tests.map((t: any) => `${t.fullTitle} : ${etat(t)}`), ...rapport.failures.filter((f: any) => /hook/.test(f.title)).map((f: any) => `${f.fullTitle} : ${f.err.message}`)].sort()
  return { verdicts, journal: JSON.parse(readFileSync(journal, 'utf-8')) }
}

describe('harnais : trois moteurs joués ensemble dans un fichier de tests', function () {
  this.timeout(120000)
  let dir = ''

  before(() => {
    dir = mjsTmp('moteurs-ensemble')
    writeFileSync(join(dir, 'faux.test.mjs'), FAUX)
  })

  it('mêmes verdicts que l\'un après l\'autre, moteur par moteur ; ensemble, les corps se chevauchent et chaque after attend la fin des autres', () => {
    const avant = jouer(dir, false, false)
    const apres = jouer(dir, true, false)
    assert.deepEqual(apres.verdicts, avant.verdicts)
    assert.equal(avant.verdicts.filter((v) => / : rouge /.test(v)).length, 2, avant.verdicts.join('\n'))
    assert.ok(avant.verdicts.includes('faux moteurs webkit sauté sous webkit : sauté'), avant.verdicts.join('\n'))
    const lire = (p: Passage, quoi: string) => p.journal.filter((e) => e[0] === quoi).map((e) => e[2])
    assert.ok(Math.max(...lire(avant, 'debut')) >= Math.min(...lire(avant, 'fin')), 'l\'un après l\'autre, les corps ne se chevauchent pas')
    assert.ok(Math.max(...lire(apres, 'debut')) < Math.min(...lire(apres, 'fin')), 'ensemble, les trois corps se chevauchent')
    assert.ok(Math.min(...lire(apres, 'after')) >= Math.max(...lire(apres, 'fin')), 'chaque after attend la fin des autres suites')
  })

  it('un before en échec sous webkit : le même rouge, ses tests pas joués, les autres moteurs inchangés', () => {
    const avant = jouer(dir, false, true)
    const apres = jouer(dir, true, true)
    assert.deepEqual(apres.verdicts, avant.verdicts)
    assert.ok(avant.verdicts.some((v) => /webkit "before all" hook.*before rouge sous webkit/.test(v)), avant.verdicts.join('\n'))
  })

  it('une suite avec un beforeEach est refusée tout haut', () => {
    const suite = { title: 'firefox', file: 'x.test.ts', parent: {}, suites: [], tests: [], _beforeAll: [], _afterAll: [], _beforeEach: [{ fn: () => {} }], _afterEach: [] }
    assert.throws(() => playTogether(suite), /la suite « firefox » a un beforeEach/)
  })
})
