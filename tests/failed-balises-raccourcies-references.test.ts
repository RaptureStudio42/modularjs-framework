// le repli d'un <@failed> nomme ses balises comme le gabarit : chaque balise raccourcie ou littérale y est une référence du
// composant, vérifiée par la construction (composant inconnu, module cœur inconnu, ancienne notation <@mjs-nom> : la même erreur
// que dans le gabarit, au lieu d'un texte affiché sans un mot) ; une balise du langage que le repli ne peut pas porter (il part tel
// quel, une seule fois, après l'erreur) arrête la construction à sa ligne, avec ce qu'il faut écrire ; un exemple montré dans
// <pre> reste du texte

import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CARTE = '<p class="carte">carte {$titre}</p>\n<script>\n  $titre = \'\'\n</script>\n'
const LEVE  = '<p>{jette()}</p>\n<script>\n  f = -> 1\n  jette = -> throw new Error(\'boum\')\n</script>\n'

// la construction d'un composant dont le repli porte `corps` (sa troisième ligne), ou d'une page qui inclut ce bloc par un partiel
async function construire(corps: string, partiel = false): Promise<{ erreurs: string[], sortie: string[] }> {
  const root = mjsTmp('failed-refs')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'carte.mjs'), CARTE)
  const cas = `<@failed err reset>\n  <p class="repli">repli</p>\n${corps}</@failed>\n${LEVE}`
  if (partiel) writeFileSync(join(src, '_cas.mjs'), cas)
  writeFileSync(join(src, 'page.mjs'), partiel ? '<div><@include cas></div>\n' : cas)
  const garde = { warn: console.warn, log: console.log, error: console.error }
  console.warn = console.log = console.error = () => {}
  try {
    const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: 'dev' })
    const stats = await b.compile()
    await b.close()
    return { erreurs: stats.errors.flatMap(e => e.message.split('\n')).filter(l => l.trim()).map(l => l.replace(/^.*?page\.mjs ?: ?/, '').replace(/^\[bundler\] /, '')), sortie: readdirSync(out) }
  }
  finally {
    Object.assign(console, garde)
  }
}

describe('<@failed> : une balise du langage dans le repli arrête la construction à sa ligne', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  const CAS: Array<[string, string]> = [
    ['@slot', '  <@slot></@slot>\n'],
    ['@view', '  <@view></@view>\n'],
    ['@window', '  <@window @resize=f></@window>\n'],
    ['@document', '  <@document @click=f></@document>\n'],
    ['@body', '  <@body class="x"></@body>\n'],
    ['@html', '  <@html class="x"></@html>\n'],
    ['@head', '  <@head><title>t</title></@head>\n'],
    ['@failed', '  <@failed err>x</@failed>\n'],
    ['@fill', '  <@carte titre="x"><@fill name="a">x</@fill></@carte>\n']
  ]
  for (const [nom, corps] of CAS) {
    it(`<${nom}>`, async () => {
      const { erreurs } = await construire(corps)
      assert.equal(erreurs.length, 1, erreurs.join('\n'))
      assert.match(erreurs[0], new RegExp(`<@failed> ligne 3 : la balise <${nom}> ne peut pas vivre dans le repli d'un <@failed>.* Écrivez-la hors du <@failed>`))
    })
  }

  it('dans un partiel : la ligne de son fichier', async () => {
    const { erreurs } = await construire('  <p>a</p>\n  <@slot></@slot>\n', true)
    assert.equal(erreurs.length, 1, erreurs.join('\n'))
    assert.match(erreurs[0], /<@failed> ligne 4 de _cas\.mjs : la balise <@slot> ne peut pas vivre/)
  })
})

describe('<@failed> : les références du repli sont vérifiées comme celles du gabarit', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('un composant inconnu', async () => {
    const { erreurs } = await construire('  <@cartee titre="x"></@cartee>\n')
    assert.equal(erreurs.length, 1, erreurs.join('\n'))
    assert.match(erreurs[0], /balise <@cartee> inconnue/)
  })

  it('un module cœur inconnu', async () => {
    const { erreurs } = await construire('  <@@progres value="1"></@@progres>\n')
    assert.equal(erreurs.length, 1, erreurs.join('\n'))
    assert.match(erreurs[0], /« <@@progres> » : aucun module cœur « progres »/)
  })

  it('l\'ancienne notation <@mjs-nom>', async () => {
    const { erreurs } = await construire('  <@mjs-carte></@mjs-carte>\n')
    assert.equal(erreurs.length, 1, erreurs.join('\n'))
    assert.match(erreurs[0], /« <@mjs-carte> » est retirée — écrivez « <@carte> »/)
  })

  it('une balise littérale d\'un module cœur : le module est livré', async () => {
    const { erreurs, sortie } = await construire('  <mjs-core-progress value="2"></mjs-core-progress>\n')
    assert.deepEqual(erreurs, [])
    assert.equal(sortie.filter(f => /^core-progress-.*\.js$/.test(f)).length, 1, sortie.join(' '))
  })

  it('un exemple montré dans <pre> reste du texte, sans référence', async () => {
    const { erreurs, sortie } = await construire('  <pre><@inconnu></@inconnu> <@@progress></@@progress></pre>\n')
    assert.deepEqual(erreurs, [])
    assert.equal(sortie.filter(f => /^core-progress-.*\.js$/.test(f)).length, 0, sortie.join(' '))
  })
})
