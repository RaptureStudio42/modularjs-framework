// Anciens fragments de traduction après un nouveau build — pourquoi ce test existe.
//
// En production, un fragment de traduction est un fichier `outputDir/i18n/<langue>/<empreinte>.json`
// nommé d'après son contenu ; en développement, il porte le nom de sa section. Un texte qui change
// donne en production un NOUVEAU nom : l'ancien fichier n'est plus cité par aucun fichier de langue.
//
// Règle gardée ici : le build ne retire dans `i18n/<langue>/` que des fichiers qu'IL a écrits, par le
// même geste et au même moment que la purge des autres sorties orphelines (`pruneOrphans`), et il ne
// retire rien quand la purge n'est pas demandée (`"prune": false` : `mjs build` n'appelle alors pas
// `pruneOrphans`, les anciens fichiers restent à disposition des onglets restés ouverts). Il sait
// qu'un fichier est à lui parce qu'il en tient la liste dans `.mjs-outputs.json` (à côté du
// manifeste), jamais d'après la forme du nom : un `.json` posé là par l'utilisateur (`notes.json`, un
// nom à forme d'empreinte, un nom de section) survit à tous les builds.
//
// Avant : `compile()` supprimait tous les `.json` de `i18n/<langue>/` avant de réécrire — un fichier
// étranger était effacé, et `"prune": false` n'était pas respecté pour ce dossier. Deux cas de ce
// fichier figeaient cet ancien comportement (retrait par `compile()` seul ; ancien nom de 32
// caractères retiré d'après sa forme) : ils sont réécrits ci-dessous.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync, unlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

interface Projet { root: string; srcDir: string; outDir: string }

function projet(prefix: string, textes: Record<string, string>): Projet {
  const root = mjsTmp(prefix)
  const srcDir = join(root, 'app')
  const outDir = join(root, 'out')
  const d = join(srcDir, 'i18n')
  mkdirSync(join(d, 'fr'), { recursive: true })
  writeFileSync(join(d, 'fr.json'), JSON.stringify({ titre: 'Bienvenue' }))
  ecrire({ root, srcDir, outDir }, textes)
  return { root, srcDir, outDir }
}
function ecrire(p: Projet, textes: Record<string, string>): void {
  for (const [section, texte] of Object.entries(textes)) writeFileSync(join(p.srcDir, 'i18n', 'fr', `${section}.json`), JSON.stringify({ k: texte }))
}
// un build COMPLET dans le dossier de sortie, par un bundler neuf (comme deux lancements du CLI)
async function construire(p: Projet) {
  const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: join(p.root, 'bundle.js'), i18n: { default: 'fr' }, forceMinify: true })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))
  const purge = bundler.pruneOrphans()
  return { bundler, purge }
}
const fragments = (p: Projet): string[] => readdirSync(join(p.outDir, 'i18n', 'fr')).sort()

describe('i18n — les anciens fragments de traduction ne s\'accumulent pas dans le dossier de sortie', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('sans purge (`"prune": false`) : l\'ancien fragment reste, le nouveau est écrit à côté', async () => {
    const p = projet('i18n-purge-sans-purge', { a: 'premier texte' })
    await construire(p)
    const avant = fragments(p)
    ecrire(p, { a: 'deuxième texte' })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: join(p.root, 'bundle.js'), i18n: { default: 'fr' }, forceMinify: true })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0)
    const apres = fragments(p)
    assert.equal(apres.length, 2, `l'ancien et le nouveau, vus : ${apres.join(', ')}`)
    assert.ok(apres.includes(avant[0]), 'l\'ancien nom est gardé : un onglet ouvert peut encore le demander')
  })

  it('texte changé entre deux builds avec purge : l\'ancien fragment disparaît, le nouveau est là, l\'inchangé reste', async () => {
    const p = projet('i18n-purge-ancien', { a: 'premier texte', b: 'texte stable' })
    await construire(p)
    const avant = fragments(p)
    assert.equal(avant.length, 2, `deux fragments au premier build, vus : ${avant.join(', ')}`)
    ecrire(p, { a: 'deuxième texte' })
    const { purge } = await construire(p)
    const apres = fragments(p)
    assert.equal(apres.length, 2, `deux fragments au second build, vus : ${apres.join(', ')} (purge : ${JSON.stringify(purge)})`)
    assert.equal(apres.filter(n => avant.includes(n)).length, 1, 'le fragment inchangé garde son nom')
    const retire = avant.filter(n => !apres.includes(n))
    assert.deepEqual(purge.removed.filter(n => n.endsWith('.json')), retire.map(n => `i18n/fr/${n}`), 'la purge nomme le fragment retiré, avec son dossier')
  })

  it('un fichier étranger (notes.json, nom à forme d\'empreinte, nom de section) survit à deux builds ; l\'ancien fragment du build disparaît', async () => {
    const p = projet('i18n-purge-etranger', { a: 'premier texte' })
    await construire(p)
    const avant = fragments(p)
    const etrangers = ['notes.json', 'abcdef012345.json', 'abcdef0123456789abcdef0123456789.json', 'b.json']
    for (const nom of etrangers) writeFileSync(join(p.outDir, 'i18n', 'fr', nom), '{"a":"posé à la main"}')
    ecrire(p, { a: 'deuxième texte' })
    await construire(p)
    ecrire(p, { a: 'troisième texte' })
    await construire(p)
    const apres = fragments(p)
    for (const nom of etrangers) {
      assert.ok(apres.includes(nom), `${nom} est à l'utilisateur : il doit rester (vus : ${apres.join(', ')})`)
      assert.equal(readFileSync(join(p.outDir, 'i18n', 'fr', nom), 'utf-8'), '{"a":"posé à la main"}')
    }
    assert.equal(apres.includes(avant[0]), false, 'l\'ancien fragment du build a disparu')
    assert.equal(apres.length, etrangers.length + 1, `les étrangers et le seul fragment courant, vus : ${apres.join(', ')}`)
  })

  it('en développement (nom = nom de section) : une section retirée perd son fichier, un fichier étranger au nom de section survit', async () => {
    const p = projet('i18n-purge-dev', { a: 'texte a', b: 'texte b' })
    const dev = async () => {
      const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: join(p.root, 'bundle.js'), i18n: { default: 'fr' } })
      const stats = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))
      return bundler.pruneOrphans()
    }
    await dev()
    assert.deepEqual(fragments(p), ['a.json', 'b.json'], 'en développement, le fichier porte le nom de la section')
    writeFileSync(join(p.outDir, 'i18n', 'fr', 'c.json'), '{"a":"à moi"}')
    unlinkSync(join(p.srcDir, 'i18n', 'fr', 'b.json'))
    await dev()
    assert.deepEqual(fragments(p), ['a.json', 'c.json'], 'b.json (écrit par le build, plus servi) part ; c.json (à l\'utilisateur) reste')
  })

  it('une langue retirée des sources : ses fragments écrits par le build partent, un fichier étranger du même dossier reste', async () => {
    const p = projet('i18n-purge-langue-retiree', { a: 'texte' })
    mkdirSync(join(p.srcDir, 'i18n', 'en'), { recursive: true })
    writeFileSync(join(p.srcDir, 'i18n', 'en.json'), JSON.stringify({ titre: 'Welcome' }))
    writeFileSync(join(p.srcDir, 'i18n', 'en', 'a.json'), JSON.stringify({ k: 'text' }))
    await construire(p)
    const en = join(p.outDir, 'i18n', 'en')
    const ecrits = readdirSync(en)
    assert.equal(ecrits.length, 1)
    writeFileSync(join(en, 'notes.json'), '{}')
    rmSync(join(p.srcDir, 'i18n', 'en'), { recursive: true })
    unlinkSync(join(p.srcDir, 'i18n', 'en.json'))
    await construire(p)
    assert.deepEqual(readdirSync(en), ['notes.json'])
  })

  it('un nom de 32 caractères qui n\'est pas au registre du build reste : la forme du nom ne prouve pas qu\'il est à lui', async () => {
    const p = projet('i18n-purge-nom-long', { a: 'texte' })
    await construire(p)
    const etranger = join(p.outDir, 'i18n', 'fr', 'abcdef0123456789abcdef0123456789.json')
    writeFileSync(etranger, '{"k":"ancien contenu"}')
    await construire(p)
    assert.equal(existsSync(etranger), true, 'un fichier de cette forme, absent du registre, est laissé')
    assert.equal(fragments(p).length, 2)
  })

  it('un registre trafiqué (nom avec chemin, `..`) ne fait jamais sortir la purge de `i18n/<langue>/`', async () => {
    const p = projet('i18n-purge-registre-trafique', { a: 'texte' })
    await construire(p)
    const dehors = join(p.root, 'dehors.json')
    writeFileSync(dehors, '{}')
    const registre = join(p.root, '.mjs-outputs.json')
    const lu = JSON.parse(readFileSync(registre, 'utf-8'))
    lu.i18nFragments = { fr: ['../../../dehors.json', '../x.json'], '../..': ['dehors.json'] }
    writeFileSync(registre, JSON.stringify(lu))
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: join(p.root, 'bundle.js'), i18n: { default: 'fr' }, forceMinify: true })
    await bundler.compile()
    bundler.pruneOrphans()
    assert.equal(existsSync(dehors), true)
  })

  it('un sous-dossier ou un fichier d\'une autre langue non écrite par le build n\'est jamais touché', async () => {
    const p = projet('i18n-purge-autre-langue', { a: 'texte' })
    await construire(p)
    mkdirSync(join(p.outDir, 'i18n', 'de'), { recursive: true })
    writeFileSync(join(p.outDir, 'i18n', 'de', 'abcdef012345.json'), '{}')
    mkdirSync(join(p.outDir, 'i18n', 'fr', 'sous'), { recursive: true })
    writeFileSync(join(p.outDir, 'i18n', 'fr', 'sous', 'x.json'), '{}')
    ecrire(p, { a: 'texte revu' })
    await construire(p)
    assert.equal(existsSync(join(p.outDir, 'i18n', 'de', 'abcdef012345.json')), true)
    assert.equal(existsSync(join(p.outDir, 'i18n', 'fr', 'sous', 'x.json')), true)
  })
})
