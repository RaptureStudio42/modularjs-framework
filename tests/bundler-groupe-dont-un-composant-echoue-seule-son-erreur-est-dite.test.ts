// Groupe de fichiers (`bundles`) dont une racine, ou un composant de son « except », ne se compile pas : la construction ne dit
// que l'erreur du composant, plus « n'est pas un composant du projet » sur le groupe (le composant existe, il est seulement en
// échec) ; une ligne d'avertissement dit qu'il n'a pas pu être construit et renvoie à son erreur. Un nom vraiment absent garde
// son refus.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// une minuterie posée à la main : refusée dans un composant
const EN_ECHEC = '<script>\n$n = 1\nsetTimeout((-> $n = 2), 100)\n</script>\n<p>{$n}</p>\n'
const LIGNE    = "[bundler] groupe 'couple' (bundles) : 'join-page' n'a pas pu être construit"

async function construire(nom: string, fichiers: Record<string, string>, bundles: Record<string, unknown>): Promise<{ erreurs: string[]; avertissements: string[] }> {
  const root = mjsTmp(nom)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const [f, texte] of Object.entries(fichiers)) writeFileSync(join(src, f), texte)
  const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: 'prod', bundles } as any)
  const s = await b.compile()
  await b.close()
  return { erreurs: s.errors.map(e => e.message), avertissements: s.warnings }
}

describe('groupe de fichiers dont un composant échoue : seule son erreur est dite', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('racine en échec : son erreur, aucune erreur sur le groupe, une ligne dit qu\'elle n\'a pas pu être construite', async () => {
    const { erreurs, avertissements } = await construire('groupe-racine-en-echec', { 'join-page.mjs': EN_ECHEC, 'menu.mjs': '<div><@join-page /></div>\n' }, { couple: ['join-page'] })
    assert.ok(erreurs.some(e => /join-page\.mjs/.test(e) && /setTimeout/.test(e)), 'l\'erreur du composant est dite : ' + erreurs.join(' | '))
    assert.deepEqual(erreurs.filter(e => /groupe 'couple'/.test(e)), [], 'aucune erreur sur le groupe')
    assert.equal(avertissements.filter(w => w.startsWith(LIGNE)).length, 1, avertissements.join(' | '))
  })

  it('composant de « except » en échec : même règle', async () => {
    const { erreurs, avertissements } = await construire('groupe-except-en-echec', { 'join-page.mjs': EN_ECHEC, 'menu.mjs': '<div><@join-page /></div>\n' }, { couple: { roots: ['menu'], except: ['join-page'] } })
    assert.ok(erreurs.some(e => /join-page\.mjs/.test(e)), 'l\'erreur du composant est dite : ' + erreurs.join(' | '))
    assert.deepEqual(erreurs.filter(e => /groupe 'couple'/.test(e)), [], 'aucune erreur sur le groupe')
    assert.equal(avertissements.filter(w => w.startsWith(LIGNE)).length, 1, avertissements.join(' | '))
  })

  it('nom vraiment absent : le refus d\'aujourd\'hui', async () => {
    const { erreurs, avertissements } = await construire('groupe-racine-absente', { 'menu.mjs': '<p>menu</p>\n' }, { couple: ['absente'] })
    assert.ok(erreurs.some(e => e.startsWith("[bundler] groupe 'couple' (bundles) : 'absente' n'est pas un composant du projet")), erreurs.join(' | '))
    assert.deepEqual(avertissements.filter(w => w.includes("n'a pas pu être construit")), [])
  })
})
