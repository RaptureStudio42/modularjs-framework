// Les textes racine de la graine et le cœur du runtime — pourquoi ce test existe.
//
// Le relevé des clés racine lues par une page rendue (`µ._i18nTrackRoot`, `__i18nNoteRoot`), leur reprise par le navigateur (`seed.root`,
// `__i18nFill`) et le rendu immédiat d'un composant enfant d'un hôte de page rendue (`__i18nSousHote`) sont dans le cœur de TOUTE application
// traduite. Le build du client ne peut pas savoir d'où viendra sa graine : une page rendue par l'API du serveur (`renderToString`,
// `createSSRRenderer`), ou une graine écrite à la main, porte `root` sans que l'application déclare un bloc `render` ni `runtime: [..., 'hydrate']`.
// Sans cette reprise, un module qui lit un texte racine clignoterait sur une telle page, le temps que le fichier de langue arrive. Le cœur d'une
// application traduite n'est donc plus identique, à l'octet, à celui d'avant ce code (il pèse environ 100 octets gzip de plus) : ce que ce test
// garde, c'est que le code est là quelle que soit la configuration du rendu, en développement comme en production, découpé comme en fichier unique.
// Une application sans traduction n'embarque pas le module i18n : son cœur ne dépend pas de lui.

import assert from 'node:assert/strict'
import { cpSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI = dirname(fileURLToPath(import.meta.url))

const PAGE = ['<script>', '  $n = 7', '</script>', "<p class=\"t\">{µt('titre')}</p>", '<p class="n">{$n}</p>'].join('\n')

type Sortie = { fichiers: Map<string, string>, coeur: string }

// une petite appli (racine fr/en si elle est traduite) construite avec la config donnée
async function construire(nom: string, conf: Record<string, unknown>, avecI18n = true): Promise<Sortie> {
  const root   = mjsTmp('i18n-graine-coeur-' + nom)
  const srcDir = join(root, 'app')
  const outDir = join(root, 'out')
  const dicos  = join(srcDir, 'i18n')
  mkdirSync(avecI18n ? dicos : srcDir, { recursive: true })
  if (avecI18n) {
    writeFileSync(join(dicos, 'fr.yml'), 'titre: Bienvenue\n')
    writeFileSync(join(dicos, 'en.json'), JSON.stringify({ titre: 'Welcome' }))
  }
  writeFileSync(join(srcDir, 'pagegraine.mjs'), (avecI18n ? PAGE : PAGE.replace("{µt('titre')}", 'Bienvenue')) + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(avecI18n ? { i18n: { default: 'fr' } } : {}), ...conf } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = new Map<string, string>()
  for (const f of readdirSync(outDir).filter((n) => n.endsWith('.js'))) fichiers.set(f, readFileSync(join(outDir, f), 'utf-8'))
  try { fichiers.set('bundle.js', readFileSync(join(root, 'bundle.js'), 'utf-8')) } catch { /* pas de fichier unique */ }
  const nomCoeur = [...fichiers.keys()].find((f) => /^mjs_core-/.test(f))
  return { fichiers, coeur: nomCoeur ? fichiers.get(nomCoeur)! : '' }
}

// le même dossier runtime que le framework, dont le module i18n est remplacé par un texte qui n'a rien à faire dans un cœur : si l'application l'embarquait,
// ce texte sortirait dans le cœur
const INTRUS = '/* mjs_i18n intrus : ne doit pas être embarqué par une application sans traduction */\n'
function runtimeAvecIntrus(): string {
  const dir = join(mjsTmp('i18n-graine-runtime'), 'runtime')
  cpSync(join(ICI, '..', 'src', 'runtime'), dir, { recursive: true })
  writeFileSync(join(dir, 'mjs_i18n.ts'), INTRUS)
  return dir
}

const SOUS_FORMES: Array<[string, Record<string, unknown>]> = [['dev', {}], ['prod', { forceMinify: true }], ['bundle', { js: 'bundle' }], ['prod-bundle', { forceMinify: true, js: 'bundle' }]]

// la configuration du rendu n'y change rien : aucun bloc render, des pages en csr seulement, ou rendues par le serveur
const RENDUS: Array<[string, Record<string, unknown>]> = [
  ['aucun bloc render', {}],
  ['csr seul', { render: { default: 'csr' } }],
  ['routes en csr', { render: { default: 'csr', routes: { '/a': { mode: 'csr' } } } }],
  ['prerender', { render: { default: 'prerender' } }],
  ['ssr', { render: { default: 'ssr' } }],
  ['ssr:markers', { render: { default: 'ssr:markers' } }],
  ['une route en ssr sous un défaut csr', { render: { default: 'csr', routes: { '/a': { mode: 'ssr' } } } }],
  ['bloc render sans mode', { render: {} }],
  ['runtime hydrate', { runtime: ['hydrate', 'i18n'] }]
]

describe('graine : textes racine et cœur du runtime — build RÉEL', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, conf] of RENDUS) {
    it(`application traduite (${nom}) : le cœur garde le relevé et la reprise des textes racine (développement)`, async () => {
      const avec = await construire('garde-' + nom.replace(/\W+/g, ''), conf)
      assert.ok(avec.coeur.length > 0)
      for (const mot of ['__i18nNoteRoot', '__i18nFill', '__i18nSousHote', 'seed.root', '_i18nTrackRoot']) assert.ok(avec.coeur.includes(mot), mot)
      assert.equal(avec.coeur.includes('i18n-graine'), false, 'aucune balise de bloc ne reste dans le cœur')
    })
  }

  for (const [nom, conf] of SOUS_FORMES) {
    it(`application traduite sans bloc render (${nom}) : le relevé du rendu serveur et la reprise de la graine sont dans le fichier émis`, async () => {
      const avec  = await construire('forme-' + nom, conf)
      const texte = [...avec.fichiers.values()].join('\n')
      assert.ok(texte.includes('_i18nTrackRoot'), 'le relevé des clés racine lues')
      assert.ok(/\.root\b/.test(texte), 'la reprise de `root` dans la graine')
      assert.equal(texte.includes('i18n-graine'), false)
    })
  }

  it('une application sans traduction n\'embarque rien du module i18n : le même cœur, à l\'octet, quoi qu\'il contienne', async () => {
    const dir = runtimeAvecIntrus()
    for (const [nom, conf] of SOUS_FORMES) {
      const avec = await construire('nt-avec-' + nom, conf, false)
      const sans = await construire('nt-sans-' + nom, { ...conf, runtimeDir: dir }, false)
      assert.ok([...avec.fichiers.values()].join('').length > 10000, 'le cœur fait partie de ce qui est comparé : ' + nom)
      assert.deepEqual([...avec.fichiers.keys()].sort(), [...sans.fichiers.keys()].sort(), nom)
      for (const [fichier, texte] of avec.fichiers) assert.equal(texte, sans.fichiers.get(fichier), fichier + ' : ' + nom)
      assert.equal([...avec.fichiers.values()].join('').includes('_i18nTrackRoot'), false, 'aucun code de traduction : ' + nom)
      assert.equal([...sans.fichiers.values()].join('').includes('mjs_i18n intrus'), false, 'le module i18n n\'est pas lu : ' + nom)
    }
  })
})
