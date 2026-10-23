// les libellés par défaut du framework (groupes modal/toast, router, ujs, fx, core) ne partent au
// manifeste que si un fichier du build les lit : une appli qui n'a ni modale, ni routeur, ni effet
// de formulaire, ni module cœur à libellé ne paie pas ces textes dans son fichier de départ.
// Faits inconnus (API directe, `groups` absent) : tout est gardé. Build RÉEL pour les cas détectés.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { runtimeLabelsFor, RUNTIME_LABELS } from '../src/runtime-labels.js'
import { mjsTmp } from './helpers/tmp.js'

const OPTIONNELS = ['modal', 'router', 'toast', 'ujs', 'core', 'fx']

async function construire(nom: string, conf: any, fichiers: Record<string, string>, prod = false): Promise<Record<string, any>> {
  const root = mjsTmp('libelles-manifeste-' + nom)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [n, c] of Object.entries(fichiers)) writeFileSync(join(srcDir, n), c + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), ...(prod ? { env: 'prod' } : {}), ...conf } as any)
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const ligne = readFileSync(join(root, 'bundle.js'), 'utf-8').split('\n').map((l) => l.trim()).find((l) => l.startsWith('µ._runtimeLabels = '))
  assert.ok(ligne, 'le manifeste doit poser µ._runtimeLabels')
  return JSON.parse(ligne!.slice('µ._runtimeLabels = '.length).replace(/;$/, ''))
}

function groupes(table: Record<string, any>, lang = 'fr'): string[] {
  return OPTIONNELS.filter((g) => g in table[lang])
}

describe('libellés du manifeste — seulement les groupes que le build lit', function () {
  this.timeout(90000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('runtimeLabelsFor (pur)', () => {
    it('sans liste de groupes (faits inconnus) : tous les groupes, fr et en', () => {
      const t = runtimeLabelsFor(false) as any
      for (const l of ['fr', 'en']) assert.deepEqual(groupes(t, l), OPTIONNELS.filter((g) => g in (RUNTIME_LABELS as any)[l]))
      assert.equal(groupes(t).length, OPTIONNELS.length)
    })

    it('avec une liste : seuls ces groupes, err/dev intacts hors production', () => {
      const t = runtimeLabelsFor(false, new Set(['fx'])) as any
      assert.deepEqual(groupes(t), ['fx'])
      assert.deepEqual(groupes(t, 'en'), ['fx'])
      assert.equal('err' in t.fr, true)
      assert.equal('dev' in t.fr, true)
    })

    it('liste vide en production : plus aucun groupe optionnel, ni err ni dev', () => {
      const t = runtimeLabelsFor(true, new Set()) as any
      assert.deepEqual(groupes(t), [])
      assert.equal('err' in t.fr, false)
    })
  })

  describe('build RÉEL', () => {
    it("runtime 'core', composant nu : aucun groupe optionnel", async () => {
      const t = await construire('nu', { runtime: 'core' }, { 'hote.mjs': '<p>x</p>' })
      assert.deepEqual(groupes(t), [])
      assert.deepEqual(groupes(t, 'en'), [])
    })

    it("runtime 'all' : modal, toast, router, ujs gardés ; fx et core absents sans signal", async () => {
      const t = await construire('all', { runtime: 'all' }, { 'hote.mjs': '<p>x</p>' })
      assert.deepEqual(groupes(t), ['modal', 'router', 'toast', 'ujs'])
    })

    it("runtime ['modal'] : modal et toast seuls", async () => {
      const t = await construire('modal', { runtime: ['modal'] }, { 'hote.mjs': '<p>x</p>' })
      assert.deepEqual(groupes(t), ['modal', 'toast'])
    })

    it("runtime ['router'] : router seul", async () => {
      const t = await construire('router', { runtime: ['router'] }, { 'hote.mjs': '<p>x</p>' })
      assert.deepEqual(groupes(t), ['router'])
    })

    it("runtime ['ujs'] : ujs et router (le panneau 404 lit les deux)", async () => {
      const t = await construire('ujs', { runtime: ['ujs'] }, { 'hote.mjs': '<p>x</p>' })
      assert.deepEqual(groupes(t), ['router', 'ujs'])
    })

    it("un module cœur à libellé (<@@number>) : groupe core gardé", async () => {
      const t = await construire('core', { runtime: 'core' }, { 'hote.mjs': '<@@number big></@@number>' })
      assert.deepEqual(groupes(t), ['core'])
    })

    it("un effet qui lit les libellés (*offline) : groupe fx gardé", async () => {
      const t = await construire('fx', { runtime: 'core' }, { 'hote.mjs': '<@document *offline(delay: 0s)></@document>\n<p>notes</p>' })
      assert.deepEqual(groupes(t), ['fx'])
    })

    it("un effet qui ne lit aucun libellé (*fade) : groupe fx absent", async () => {
      const t = await construire('fx-sans', { runtime: 'core' }, { 'hote.mjs': '<p *fade>x</p>' })
      assert.deepEqual(groupes(t), [])
    })

    it('en production : mêmes règles, err et dev partis du manifeste', async () => {
      const t = await construire('prod', { runtime: 'core' }, { 'hote.mjs': '<p>x</p>' }, true)
      assert.deepEqual(groupes(t), [])
      assert.equal('err' in t.fr, false)
    })
  })
})
