// Plusieurs sections par module (`@i18n 'accueil' 'onglets-admin'`) et le cœur du runtime — pourquoi ce test existe.
//
// Le code qui demande ensemble les sections d'un module et cherche une clé dans chacune est un bloc balisé de mjs_i18n.ts
// (`<i18n-paquets>`), auquel s'ajoutent deux lignes balisées de même, dans `__i18nAskSection` (`<i18n-paquets-lecture>`, la lecture
// d'une section en plus) et dans le rejeu du démarrage de `__i18nBoot` (`<i18n-paquets-demarrage>`, une section en plus encore en
// route) : ils n'entrent au cœur que si un module du build écrit plusieurs sections. Une appli qui n'en écrit
// aucune doit recevoir le cœur qu'elle recevait avant ces blocs, À L'OCTET PRÈS — en développement comme en production. En
// production la minification retire les commentaires repères : c'est la taille et la comparaison avec un runtime qui n'a jamais
// porté les blocs qui le gardent, pas la recherche du nom du repère.

import assert from 'node:assert/strict'
import { cpSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI    = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(ICI, '..', 'src', 'runtime', 'mjs_i18n.ts')

const PAGE = (entete: string) => [entete, '<script>', '  $n = 7', '</script>', "<p class=\"t\">{µt('resume')}</p>", '<p class="n">{$n}</p>'].join('\n')

type Sortie = { fichiers: Map<string, string>, coeur: string }

// une petite appli i18n (racine fr/en, sections `panier` et `ailleurs`) construite avec la page donnée
async function construire(nom: string, conf: Record<string, unknown>, page: string): Promise<Sortie> {
  const root   = mjsTmp('i18n-paquets-coeur-' + nom)
  const srcDir = join(root, 'app')
  const outDir = join(root, 'out')
  const dicos  = join(srcDir, 'i18n')
  mkdirSync(join(dicos, 'fr'), { recursive: true })
  mkdirSync(join(dicos, 'en'), { recursive: true })
  writeFileSync(join(dicos, 'fr.yml'), 'titre: Bienvenue\n')
  writeFileSync(join(dicos, 'en.json'), JSON.stringify({ titre: 'Welcome' }))
  writeFileSync(join(dicos, 'fr', 'panier.yml'), 'resume: Résumé du panier\n')
  writeFileSync(join(dicos, 'en', 'panier.json'), JSON.stringify({ resume: 'Cart summary' }))
  writeFileSync(join(dicos, 'fr', 'ailleurs.yml'), 'resume: Autre résumé\n')
  writeFileSync(join(dicos, 'en', 'ailleurs.json'), JSON.stringify({ resume: 'Other summary' }))
  writeFileSync(join(srcDir, 'pagepaq.mjs'), page + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), i18n: { default: 'fr' }, ...conf } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  // tout le JavaScript émis : le cœur, les unités, et le fichier unique d'un build `js: 'bundle'`
  const fichiers = new Map<string, string>()
  for (const f of readdirSync(outDir).filter((n) => n.endsWith('.js'))) fichiers.set(f, readFileSync(join(outDir, f), 'utf-8'))
  try { fichiers.set('bundle.js', readFileSync(join(root, 'bundle.js'), 'utf-8')) } catch { /* pas de fichier unique */ }
  const nomCoeur = [...fichiers.keys()].find((f) => /^mjs_core-/.test(f))
  return { fichiers, coeur: nomCoeur ? fichiers.get(nomCoeur)! : '' }
}

// les blocs balisés du source du runtime, tels qu'ils sont écrits : repères compris, le grand avec la ligne vide qui le suit ;
// chaque plage va de la ligne du repère de début à celle qui suit la fin (exclue)
function blocs(): { lignes: string[], plages: Array<[number, number]> } {
  const lignes = readFileSync(SOURCE, 'utf-8').split('\n')
  const plages: Array<[number, number]> = []
  for (const [nom, ligneVide] of [['i18n-paquets', true], ['i18n-paquets-lecture', false], ['i18n-paquets-demarrage', false]] as Array<[string, boolean]>) {
    const debut = lignes.findIndex((l) => l.trim() === `// <${nom}>`)
    const fin   = lignes.findIndex((l) => l.trim() === `// </${nom}>`)
    assert.ok(debut > 0 && fin > debut, `le bloc ${nom} est balisé dans le source du runtime`)
    if (ligneVide) assert.equal(lignes[fin + 1], '', 'une ligne vide suit le repère de fin')
    plages.push([debut, fin + 1 + (ligneVide ? 1 : 0)])
  }
  return { lignes, plages }
}

// le même dossier runtime que le framework, privé des blocs : le runtime d'avant ces blocs
function runtimeSansBlocs(): string {
  const dir = join(mjsTmp('i18n-paquets-runtime'), 'runtime')
  cpSync(join(ICI, '..', 'src', 'runtime'), dir, { recursive: true })
  const { lignes, plages } = blocs()
  for (const [debut, fin] of [...plages].sort((a, b) => b[0] - a[0])) lignes.splice(debut, fin - debut)
  writeFileSync(join(dir, 'mjs_i18n.ts'), lignes.join('\n'))
  assert.equal(readFileSync(join(dir, 'mjs_i18n.ts'), 'utf-8').includes('i18n-paquets'), false)
  return dir
}

describe('plusieurs sections par module — le cœur du runtime, build RÉEL', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('développement : le cœur avec un module à plusieurs sections est celui sans, plus les blocs du source, ni plus ni moins', async () => {
    const sans = await construire('dev-sans', {}, PAGE("@i18n 'panier'"))
    const avec = await construire('dev-avec', {}, PAGE("@i18n 'panier' 'ailleurs'"))
    const { lignes, plages } = blocs()
    let reste = avec.coeur
    for (const [debut, fin] of plages) {
      const texte = lignes.slice(debut, fin).join('\n') + '\n'
      assert.ok(reste.includes(texte), 'le bloc est dans le cœur, tel qu\'il est écrit :\n' + texte.slice(0, 120))
      reste = reste.replace(texte, '')
    }
    assert.equal(reste, sans.coeur, 'rien d\'autre ne sépare les deux cœurs')
  })

  it('production : le cœur avec un module à plusieurs sections porte le code du bloc ; sans, il est plus petit d\'au moins 400 octets', async () => {
    const sans = await construire('prod-sans', { forceMinify: true }, PAGE("@i18n 'panier'"))
    const avec = await construire('prod-avec', { forceMinify: true }, PAGE("@i18n 'panier' 'ailleurs'"))
    assert.ok(sans.coeur.length > 0 && avec.coeur.length > 0, 'les deux cœurs existent')
    assert.equal(sans.coeur.includes('i18n-paquets'), false)
    assert.ok(avec.coeur.length - sans.coeur.length >= 400, `le bloc minifié pèse ${avec.coeur.length - sans.coeur.length} octets de plus`)
  })

  it('hors des blocs, le source du runtime ne lit ni le 3e élément de `_mjs_i18n` ni rien qui en dépende : le cœur sans les blocs ne sait rien des sections en plus', () => {
    const { lignes, plages } = blocs()
    const dehors = lignes.filter((_, i) => !plages.some(([debut, fin]) => i >= debut && i < fin)).join('\n')
    assert.equal(/_mjs_i18n\[2\]|\binfo\[2\]/.test(dehors), false)
  })

  it('sans module à plusieurs sections, tout ce qui est émis est identique à l\'octet à ce qu\'émet un runtime qui n\'a jamais porté les blocs', async () => {
    const dir = runtimeSansBlocs()
    for (const [nom, conf] of [['dev', {}], ['prod', { forceMinify: true }], ['bundle', { js: 'bundle' }], ['prod-bundle', { forceMinify: true, js: 'bundle' }]] as Array<[string, Record<string, unknown>]>) {
      const avec = await construire('octet-avec-' + nom, conf, PAGE("@i18n 'panier'"))
      const sans = await construire('octet-sans-' + nom, { ...conf, runtimeDir: dir }, PAGE("@i18n 'panier'"))
      assert.ok([...avec.fichiers.values()].join('').length > 100000, 'le cœur fait partie de ce qui est comparé : ' + nom)
      assert.deepEqual([...avec.fichiers.keys()].sort(), [...sans.fichiers.keys()].sort(), 'mêmes fichiers (noms hachés compris) : ' + nom)
      for (const [fichier, texte] of avec.fichiers) assert.equal(texte, sans.fichiers.get(fichier), fichier + ' : ' + nom)
    }
  })
})
