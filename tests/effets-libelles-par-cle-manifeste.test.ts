// les libellés par défaut des effets (groupe `fx` de src/runtime-labels.ts) partent au manifeste clé par clé, comme ceux des
// modules du cœur : chaque effet qui écrit un texte n'emporte que SES clés, en français et en anglais. Une appli qui n'a que
// *flipcard ne paie pas les textes de *guard, de *offline ni de *loader. La table « effet → ses clés » est gardée sur le texte
// des effets (src/runtime/mjs_fx_<nom>.ts lus comme du texte) : une clé appartient à un seul effet, qui la lit lui-même.
// Faits inconnus (API directe, effets absents) : le groupe part entier, comme avant. Build RÉEL pour les cas détectés.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import * as libelles from '../src/runtime-labels.js'
import { mjsTmp } from './helpers/tmp.js'

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')
const LABELS: any = libelles.RUNTIME_LABELS
const TABLE = (): Record<string, string[]> => (libelles as any).FX_LABEL_EFFECTS
const runtimeLabelsFor = libelles.runtimeLabelsFor as (prod: boolean, groups?: ReadonlySet<string>, coreModules?: ReadonlySet<string>, fxEffects?: ReadonlySet<string>) => any

const CLES_GUARD = ['range', 'atLeast', 'atMost', 'chars', 'charsMin', 'charsMax', 'or', 'except', 'invalid']

async function construire(nom: string, gabarit: string, prod = false): Promise<Record<string, any>> {
  const root = mjsTmp('libelles-fx-par-cle-' + nom)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), gabarit + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), runtime: 'core', ...(prod ? { env: 'prod' } : {}) } as any)
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const ligne = readFileSync(join(root, 'bundle.js'), 'utf-8').split('\n').map((l) => l.trim()).find((l) => l.startsWith('µ._runtimeLabels = '))
  assert.ok(ligne, 'le manifeste doit poser µ._runtimeLabels')
  return JSON.parse(ligne!.slice('µ._runtimeLabels = '.length).replace(/;$/, ''))
}

// les clés du groupe fx d'une langue du manifeste, dans l'ordre ; les textes doivent être ceux de la table du framework
function clesFx(t: Record<string, any>, lang: 'fr' | 'en'): string[] {
  assert.ok(t[lang], `la langue ${lang} doit rester servie`)
  const fx = t[lang].fx ?? {}
  for (const [k, v] of Object.entries(fx)) assert.equal(v, LABELS[lang].fx[k], `${lang}.fx.${k}`)
  return Object.keys(fx)
}

describe('effets — les libellés du groupe fx partent clé par clé, avec leur effet', function () {
  this.timeout(90000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('la table effet → ses clés', () => {
    it('le groupe fx a les mêmes clés en français et en anglais', () => {
      assert.deepEqual(Object.keys(LABELS.en.fx).sort(), Object.keys(LABELS.fr.fx).sort())
    })

    it('chaque clé du groupe fx appartient à exactement un effet de la table, et chaque clé de la table est au groupe', () => {
      const table = TABLE()
      assert.ok(table, 'FX_LABEL_EFFECTS absente de runtime-labels.ts')
      const proprietaires = new Map<string, string[]>()
      for (const [effet, cles] of Object.entries(table)) for (const cle of cles) proprietaires.set(cle, [...(proprietaires.get(cle) ?? []), effet])
      for (const cle of Object.keys(LABELS.fr.fx)) assert.equal((proprietaires.get(cle) ?? []).length, 1, `${cle} : ${(proprietaires.get(cle) ?? []).join(', ') || 'aucun effet'}`)
      for (const cle of proprietaires.keys()) assert.ok(cle in LABELS.fr.fx, `${cle} est dans la table et pas dans le groupe fx`)
    })

    it('chaque effet de la table a son fichier, lit ses libellés par l\'aide commune et y nomme chacune de ses clés', () => {
      const table = TABLE()
      assert.ok(table, 'FX_LABEL_EFFECTS absente de runtime-labels.ts')
      for (const [effet, cles] of Object.entries(table)) {
        const f = join(RUNTIME, 'mjs_fx_' + effet + '.ts')
        assert.ok(existsSync(f), `${effet} n'a pas de fichier dans src/runtime`)
        const src = readFileSync(f, 'utf-8')
        assert.match(src, /µ\._mjs_fxLabel\b/, `${effet} ne lit pas ses libellés par µ._mjs_fxLabel`)
        for (const cle of cles) assert.ok(src.includes(`'${cle}'`), `${effet} ne nomme pas sa clé ${cle}`)
      }
    })

    it('chaque effet qui lit un libellé par l\'aide commune a sa ligne dans la table', () => {
      const table = TABLE()
      assert.ok(table, 'FX_LABEL_EFFECTS absente de runtime-labels.ts')
      const lecteurs = readdirSync(RUNTIME).filter((f) => /^mjs_fx_[a-z0-9_]+\.ts$/.test(f) && f !== 'mjs_fx_toollabel.ts' && /µ\._mjs_fxLabel\b/.test(readFileSync(join(RUNTIME, f), 'utf-8')))
      assert.ok(lecteurs.length >= 5, 'lecteurs trouvés : ' + lecteurs.join(', '))
      for (const f of lecteurs) assert.ok(Object.hasOwn(table, f.slice(7, -3)), `${f} lit le groupe fx sans ligne dans la table`)
    })
  })

  describe('runtimeLabelsFor (pur)', () => {
    const GROUPES = new Set(['fx'])

    it('un effet : ses clés seules, en français et en anglais, textes intacts', () => {
      const t = runtimeLabelsFor(false, GROUPES, undefined, new Set(['flipcard']))
      assert.deepEqual(clesFx(t, 'fr'), ['flip'])
      assert.deepEqual(clesFx(t, 'en'), ['flip'])
      const g = runtimeLabelsFor(true, GROUPES, undefined, new Set(['guard']))
      assert.deepEqual(clesFx(g, 'fr'), CLES_GUARD)
      assert.deepEqual(clesFx(g, 'en'), CLES_GUARD)
    })

    it('deux effets : l\'union, dans l\'ordre du groupe', () => {
      const t = runtimeLabelsFor(false, GROUPES, undefined, new Set(['flipcard', 'loader']))
      assert.deepEqual(clesFx(t, 'fr'), ['loading', 'flip'])
    })

    it('aucun effet à libellé (ou un nom hérité d\'Object) : le groupe fx ne part pas', () => {
      for (const effets of [new Set<string>(), new Set(['fade', 'constructor', 'toollabel'])]) {
        const t = runtimeLabelsFor(false, GROUPES, undefined, effets)
        assert.equal('fx' in t.fr, false)
        assert.equal('fx' in t.en, false)
      }
    })

    it('effets inconnus (faits manquants) : tout le groupe, comme avant', () => {
      const t = runtimeLabelsFor(false, GROUPES)
      assert.deepEqual(clesFx(t, 'fr'), Object.keys(LABELS.fr.fx))
    })
  })

  describe('build RÉEL', () => {
    it('*flipcard seul : fx.flip seul au manifeste, en français et en anglais', async () => {
      const t = await construire('carte', '<div *flipcard(on: click)><div>recto</div><div>verso</div></div>')
      assert.deepEqual(clesFx(t, 'fr'), ['flip'])
      assert.deepEqual(clesFx(t, 'en'), ['flip'])
    })

    it('*flipcard seul, en production : fx.flip seul aussi', async () => {
      const t = await construire('carte-prod', '<div *flipcard(on: click)><div>recto</div><div>verso</div></div>', true)
      assert.deepEqual(clesFx(t, 'fr'), ['flip'])
      assert.deepEqual(clesFx(t, 'en'), ['flip'])
    })

    it('*guard seul : ses clés seules', async () => {
      const t = await construire('garde', '<input type="number" min="1" max="10" aria-label="nombre" *guard>')
      assert.deepEqual(clesFx(t, 'fr'), CLES_GUARD)
      assert.deepEqual(clesFx(t, 'en'), CLES_GUARD)
    })

    it('*offline et *loader ensemble : les clés des deux, rien d\'autre', async () => {
      const t = await construire('reseau', '<@document *offline(delay: 0s)></@document>\n<p>notes <span *loader></span></p>')
      assert.deepEqual(clesFx(t, 'fr').sort(), ['loading', 'offline', 'pending1', 'pendingN'])
      assert.deepEqual(clesFx(t, 'en').sort(), ['loading', 'offline', 'pending1', 'pendingN'])
    })
  })
})
