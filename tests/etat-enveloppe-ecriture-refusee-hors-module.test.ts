// Une écriture faite par un nom que le moteur refuse (champ de plus dans un objet gelé ou scellé, propriété en lecture seule, accesseur
// sans `set`, suppression d'une propriété qui ne se supprime pas) lève par l'enveloppe l'erreur que lève la même écriture faite sur
// l'objet lui-même en mode strict, et ne prévient personne — que le cœur soit chargé en module ou évalué comme un script (rendu côté
// serveur, tests sous happy-dom) : les pièges de l'enveloppe sont stricts où qu'ils tournent. Cœur construit, évalué ici comme un script
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')

// les mêmes écritures, sur l'objet lui-même : ce fichier est un module, donc strict
const GESTES: Record<string, [string, () => any, (t: any) => void]> = {
  ajout:    ['un champ de plus dans un objet gelé', () => Object.freeze({ n: 1 }), (t) => { t.k = 2 }],
  ecrit:    ['une propriété d\'un objet gelé', () => Object.freeze({ n: 1 }), (t) => { t.n = 2 }],
  retire:   ['la suppression d\'un champ d\'un objet gelé', () => Object.freeze({ n: 1 }), (t) => { delete t.n }],
  scelle:   ['un champ de plus dans un objet scellé', () => Object.seal({ n: 1 }), (t) => { t.k = 2 }],
  ferme:    ['un champ de plus dans un objet fermé aux ajouts', () => Object.preventExtensions({ n: 1 }), (t) => { t.k = 2 }],
  taille:   ['l\'accesseur sans `set` d\'une Map', () => new Map([['a', 1]]), (t) => { t.size = 5 }],
  longueur: ['la suppression de `length` d\'une liste', () => [1, 2], (t) => { delete t.length }],
}
const erreur = (f: (t: any) => void, x: any) => { try { f(x); return 'aucune erreur' } catch (e: any) { return e.constructor.name + ': ' + e.message } }

const SOURCES: Record<string, string> = {
  'er-refus.mjs': js([
    '$ajout = Object.freeze({ n: 1 }); $ecrit = Object.freeze({ n: 1 }); $retire = Object.freeze({ n: 1 }); $scelle = Object.seal({ n: 1 }); $ferme = Object.preventExtensions({ n: 1 }); $taille = new Map([["a", 1]]); $longueur = [1, 2];',
    'let rendus = 0;',
    '@vu = function(x) { rendus++; return JSON.stringify(x); };',
    '@rendus = function() { return rendus; };',
    'const essai = function(f, x) { try { f(x); return "aucune erreur"; } catch (e) { return e.constructor.name + ": " + e.message; } };',
    '@ajout = function() { return essai((t) => { t.k = 2; }, $ajout); };',
    '@ecrit = function() { return essai((t) => { t.n = 2; }, $ecrit); };',
    '@retire = function() { return essai((t) => { delete t.n; }, $retire); };',
    '@scelle = function() { return essai((t) => { t.k = 2; }, $scelle); };',
    '@ferme = function() { return essai((t) => { t.k = 2; }, $ferme); };',
    '@taille = function() { return essai((t) => { t.size = 5; }, $taille); };',
    '@longueur = function() { return essai((t) => { delete t.length; }, $longueur); };',
  ], '<p>{@vu($ajout)}{@vu($ecrit)}{@vu($retire)}{@vu($scelle)}{@vu($ferme)}{@vu($taille.size)}{@vu($longueur)}</p>'),
}

for (const [nom, opts] of [['développement', {}], ['production', { env: 'prod' }]] as Array<[string, any]>) describe(`enveloppe : écriture refusée par le moteur, cœur évalué comme un script (${nom})`, function () {
  this.timeout(120000)
  let code = ''
  const fenetres: any[] = []

  before(async () => {
    const root   = mjsTmp('ecriture-refusee')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
    code = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  for (const [geste, [quoi, objet, ecriture]] of Object.entries(GESTES)) it(`${quoi} : l'erreur de la même écriture faite sur l'objet lui-même, et personne n'est prévenu`, async () => {
    const win: any = new Window({ url: 'http://localhost/' })
    fenetres.push(win)
    // évalué comme un script, sans mode strict : ce que font le rendu côté serveur et les tests sous happy-dom
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = '<mjs-er-refus></mjs-er-refus>'
    await tic()
    const el    = win.document.querySelector('mjs-er-refus')
    const avant = el.rendus()
    const attendu = erreur(ecriture, objet())
    assert.match(attendu, /^TypeError: /, 'le témoin : la même écriture sur l\'objet lui-même lève en mode strict')
    assert.equal(el[geste](), attendu)
    await tic()
    assert.equal(el.rendus() - avant, 0, 'une écriture refusée a prévenu le composant')
  })
})
