// Noms de fragments de traduction COURTS (12 hex) — le nom sert de nom de fichier servi
// (`i18n/<langue>/<nom>.json`) : deux contenus différents ne doivent jamais le partager,
// une collision de préfixe est détectée au build et résolue en allongeant le second nom.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool, nommerFragmentI18n } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('i18n — noms de fragments courts', function () {
  this.timeout(20000)
  after(async () => { await terminateSharedWorkerPool() })

  it('nommerFragmentI18n : 12 hex par défaut, même contenu = même nom', () => {
    const pris = new Map<string, string>()
    const a = nommerFragmentI18n('{"a":"x"}', pris)
    const b = nommerFragmentI18n('{"a":"x"}', pris)
    const c = nommerFragmentI18n('{"a":"y"}', pris)
    assert.match(a, /^[a-f0-9]{12}$/)
    assert.equal(a, b)
    assert.notEqual(a, c)
  })

  it('collision forcée : le second contenu reçoit un nom plus long, jamais le même nom', () => {
    const pris = new Map<string, string>()
    const hacher = (s: string) => 'abcdef012345' + (s === 'un' ? '1' : '2').repeat(20)
    const a = nommerFragmentI18n('un', pris, hacher)
    const b = nommerFragmentI18n('deux', pris, hacher)
    assert.equal(a.length, 12)
    assert.ok(b.length > 12 && b.startsWith(a), `nom allongé attendu, reçu ${b}`)
    assert.equal(nommerFragmentI18n('deux', pris, hacher), b, 'stable pour le même contenu')
    assert.equal(nommerFragmentI18n('un', pris, hacher), a)
  })

  it('collision totale (empreinte entière identique) : erreur claire', () => {
    const pris = new Map<string, string>()
    const hacher = () => 'a'.repeat(32)
    for (let n = 12; n <= 32; n++) pris.set('a'.repeat(n), 'un')
    assert.throws(() => nommerFragmentI18n('deux', pris, hacher), /même empreinte complète/)
  })

  it('build prod : noms à 12 hex, contenu identique partagé, contenus différents distincts', async () => {
    const root = mjsTmp('i18n-noms-courts')
    const srcDir = join(root, 'app')
    const outDir = join(root, 'out')
    const d = join(srcDir, 'i18n')
    mkdirSync(join(d, 'fr'), { recursive: true })
    writeFileSync(join(d, 'fr.json'), JSON.stringify({ titre: 'Bienvenue' }))
    writeFileSync(join(d, 'fr/a.json'), JSON.stringify({ k: 'même' }))
    writeFileSync(join(d, 'fr/b.json'), JSON.stringify({ k: 'même' }))
    writeFileSync(join(d, 'fr/c.json'), JSON.stringify({ k: 'autre' }))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), i18n: { default: 'fr' }, forceMinify: true })
    try {
      const stats = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))
      const f = readdirSync(outDir).find(n => /^mjs_i18n-fr-/.test(n))!
      const t = JSON.parse(readFileSync(join(outDir, f), 'utf-8').replace(/^export default /, '').replace(/;\s*$/, '')).sections
      for (const n of ['a', 'b', 'c']) assert.match(t[n], /^[a-f0-9]{12}$/)
      assert.equal(t.a, t.b)
      assert.notEqual(t.a, t.c)
    } finally {
      await bundler.close()
    }
  })
})
