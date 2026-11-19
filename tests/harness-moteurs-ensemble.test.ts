// Les suites d'une boucle sur les moteurs jouées ensemble (tests/helpers/engines-together.ts) : un faux fichier de
// tests, sans navigateur, joué par un mocha à part, l'une après l'autre (MJS_ENSEMBLE=0) puis ensemble. Chaque
// moteur garde son verdict, test par test (vert, rouge, sauté, délai dépassé, `before` en échec) ; ensemble, les corps
// se chevauchent vraiment et le `after` d'une suite attend la fin des autres ; `beforeEach`, `afterEach` et describe
// imbriqués se jouent dans le même ordre, moteur par moteur, avec les mêmes rouges ; une suite que l'ensemble ne sait
// pas jouer est refusée tout haut

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

// les formes à crochets de chaque test : deux suites sœurs par moteur (une boucle sur `env` sous celle des moteurs), un
// `beforeEach` et un `afterEach` qui lisent `this.currentTest`, un describe imbriqué à ses crochets, un autre plus bas ;
// CASSE pose des rouges : un `beforeEach` imbriqué rouge sous firefox dev, un `afterEach` rouge sous webkit prod, un
// `beforeEach` qui saute un test sous chromium
const FORMES = `
import { writeFileSync } from 'node:fs'
import { playTogether } from ${JSON.stringify(AIDE)}
const journal = []
const pause   = (ms) => new Promise((r) => setTimeout(r, ms))
const casse   = (process.env.CASSE || '').split(',')
describe('formes', function () {
  after(() => { writeFileSync(process.env.JOURNAL, JSON.stringify(journal)) })
  for (const nom of ['chromium', 'firefox', 'webkit']) for (const env of ['dev', 'prod']) playTogether(describe(\`\${nom}, \${env}\`, function () {
    const note = (quoi) => journal.push([quoi, nom + ' ' + env, Date.now()])
    before(async () => { await pause(50); note('before') })
    beforeEach(async function () {
      note('beforeEach ' + this.currentTest.title)
      if (casse.includes('saut') && nom === 'chromium' && this.currentTest.title === 'deux') this.skip()
      await pause(20)
    })
    afterEach(function () {
      note('afterEach ' + this.currentTest.title + ' ' + this.currentTest.state)
      if (casse.includes('apres') && nom === 'webkit' && env === 'prod' && this.currentTest.title === 'deux') throw new Error('afterEach rouge sous webkit prod')
    })
    after(async () => { note('after') })
    it('un', async function () { note('debut'); await pause(300); note('fin') })
    it('deux', async function () { note('deux'); if (nom === 'firefox') throw new Error('rouge sous firefox') })
    describe('imbriqué', function () {
      before(() => note('before imbriqué'))
      beforeEach(function () {
        note('beforeEach imbriqué ' + this.currentTest.title)
        if (casse.includes('avant') && nom === 'firefox' && env === 'dev' && this.currentTest.title === 'i2') throw new Error('beforeEach imbriqué rouge sous firefox dev')
      })
      afterEach(() => note('afterEach imbriqué'))
      after(() => note('after imbriqué'))
      it('i1', async function () { await pause(30); note('i1') })
      it('i2', function () { note('i2') })
      it('i3', function () { if (nom === 'webkit') this.skip(); note('i3') })
      describe('plus bas', function () {
        it('p1', async function () { this.timeout(100); note('p1'); await pause(nom === 'chromium' ? 400 : 5) })
      })
    })
    it('trois', function () { note('trois') })
  }))
})
`

type Passage = { verdicts: string[], journal: [string, string, number][] }

function jouer(dir: string, ensemble: boolean, avantRouge: boolean, fichier = 'faux.test.mjs', casse = ''): Passage {
  const sortie  = join(dir, `sortie-${fichier}-${ensemble}-${avantRouge}-${casse.replace(/,/g, '-')}.json`)        //une virgule couperait l'option du rapporteur
  const journal = join(dir, `journal-${fichier}-${ensemble}-${avantRouge}-${casse.replace(/,/g, '-')}.json`)
  const env: Record<string, string | undefined> = { ...process.env, JOURNAL: journal, MJS_ENSEMBLE: ensemble ? '1' : '0', AVANT_ROUGE: avantRouge ? '1' : '', CASSE: casse }
  delete env.MJS_MOTEURS
  const r = spawnSync(process.execPath, [MOCHA, '--require', 'tsx/esm', '--reporter', 'json', '--reporter-option', `output=${sortie}`, join(dir, fichier)], { cwd: ROOT, env, encoding: 'utf-8', timeout: 60000 })
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
    writeFileSync(join(dir, 'formes.test.mjs'), FORMES)
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

  it('beforeEach, afterEach et describe imbriqués : mêmes verdicts et mêmes rouges que l\'un après l\'autre, chaque moteur dans le même ordre ; un env après l\'autre, ses trois moteurs ensemble', () => {
    const suite = (p: Passage) => {
      const parMoteur: Record<string, string[]> = {}
      for (const [quoi, qui] of p.journal) (parMoteur[qui] ??= []).push(quoi)
      return parMoteur
    }
    for (const casse of ['', 'avant', 'apres', 'saut', 'avant,apres,saut']) {
      const avant = jouer(dir, false, false, 'formes.test.mjs', casse)
      const apres = jouer(dir, true, false, 'formes.test.mjs', casse)
      assert.deepEqual(apres.verdicts, avant.verdicts, `CASSE=${casse}`)
      assert.deepEqual(suite(apres), suite(avant), `CASSE=${casse}`)
      assert.equal(Object.keys(suite(avant)).length, 6)
      const rouges = avant.verdicts.filter((v) => / : rouge |hook/.test(v)).join('\n')
      if (casse.includes('avant')) assert.match(rouges, /firefox, dev imbriqué "before each" hook for "i2".*beforeEach imbriqué rouge sous firefox dev/)
      if (casse.includes('apres')) assert.match(rouges, /webkit, prod "after each" hook for "deux".*afterEach rouge sous webkit prod/)
      if (casse.includes('saut')) assert.ok(avant.verdicts.includes('formes chromium, dev deux : sauté'), avant.verdicts.join('\n'))
      if (casse === '') assert.equal(avant.verdicts.filter((v) => / : rouge /.test(v)).length, 4, avant.verdicts.join('\n'))
      const lire = (p: Passage, quoi: string, env: string) => p.journal.filter((e) => e[0] === quoi && e[1].endsWith(env)).map((e) => e[2])
      assert.ok(Math.max(...lire(apres, 'debut', 'dev')) < Math.min(...lire(apres, 'fin', 'dev')), 'ensemble, les trois moteurs de dev se chevauchent')
      assert.ok(Math.min(...lire(apres, 'before', 'prod')) >= Math.max(...lire(apres, 'fin', 'dev')), 'prod part après la fin de dev')
      assert.ok(Math.max(...lire(avant, 'debut', 'dev')) >= Math.min(...lire(avant, 'fin', 'dev')), 'l\'un après l\'autre, rien ne se chevauche')
    }
  })

  it('une suite avec un test à done est refusée tout haut, comme un beforeEach posé au-dessus des suites de moteur', () => {
    const vide  = { suites: [], tests: [], _beforeAll: [], _afterAll: [], _beforeEach: [], _afterEach: [] }
    const done1 = { ...vide, title: 'firefox', file: 'x.test.ts', parent: { root: true }, tests: [{ fn: (fini: () => void) => fini() }] }
    assert.throws(() => playTogether(done1), /la suite « firefox » a un test ou un crochet à done/)
    const parent  = { ...vide, parent: { root: true }, _beforeEach: [{ fn: () => {} }] }
    const dessous = { ...vide, title: 'webkit', file: 'y.test.ts', parent }
    assert.throws(() => playTogether(dessous), /la suite « webkit » a un beforeEach au-dessus d'elle/)
  })
})
