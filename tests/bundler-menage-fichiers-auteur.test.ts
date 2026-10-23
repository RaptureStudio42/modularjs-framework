// Le ménage du build (anciennes empreintes remplacées pendant compile(), purge des orphelins par pruneOrphans()) ne retire
// que des fichiers qu'un build de ce constructeur a lui-même écrits, tels que le registre `.mjs-outputs.json` les consigne :
// jamais un fichier sur la seule forme de son nom. Un fichier de l'auteur posé dans le dossier de sortie, qu'il s'appelle
// `card-utils.js` (même base qu'un composant `card.mjs`), `logo-white.png` (même base qu'une image `logo.png` copiée) ou
// `vendor-0123abcd.js` (forme d'une copie à huit hexadécimaux), survit à deux constructions et à la purge. Dossier de sortie
// égal au dossier source : aucun fichier source n'est retiré. `prune: false` : rien n'est retiré du tout.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const carte = (texte: string) => ['<script>', "  chemin = µasset('logo.png')", '</script>', `<img src={chemin}> ${texte}`].join('\n')
const simple = (texte: string) => ['<script>', '  $x = 1', '</script>', `<p>{$x} ${texte}</p>`].join('\n')

const AUTEUR = ['card-utils.js', 'logo-white.png', 'logo-small.png', 'card-0123abcd.js', 'vendor-0123abcd.js', 'photo-0123abcd.webp', 'style-0123abcd.css', 'readme.txt']

describe('le ménage du build ne retire que ce qu\'un build a écrit', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('les fichiers de l\'auteur posés dans le dossier de sortie survivent à deux constructions et à la purge ; les anciennes sorties du build partent', async () => {
    const root = mjsTmp('menage-auteur')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(src, { recursive: true })
    mkdirSync(out, { recursive: true })
    writeFileSync(join(src, 'card.mjs'), carte('v1'))
    writeFileSync(join(src, 'logo.png'), Buffer.from([1, 2, 3]))
    for (const f of AUTEUR) writeFileSync(join(out, f), 'AUTEUR\n')

    const opts = { sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js') }
    const b1 = new Bundler(opts)
    const s1 = await b1.compile()
    assert.deepEqual(s1.errors.map(e => e.message), [])
    await b1.close()
    // `card-utils.js` a lui-même la forme `<base>-<5 caractères>.js` : seule la liste de l'auteur le distingue
    const premieres = readdirSync(out).filter(f => !AUTEUR.includes(f) && (/^card-[0-9a-z]{5}\.js$/.test(f) || /^logo-[a-f0-9]{8}\.png$/.test(f)))
    assert.equal(premieres.length, 2, `une sortie du composant et une copie de l'image au 1er build : ${readdirSync(out).join(', ')}`)

    // 2e construction (nouveau processus) : le composant et l'image changent, leurs anciennes sorties sont remplacées
    writeFileSync(join(src, 'card.mjs'), carte('v2'))
    writeFileSync(join(src, 'logo.png'), Buffer.from([4, 5, 6]))
    const b2 = new Bundler(opts)
    const s2 = await b2.compile()
    assert.deepEqual(s2.errors.map(e => e.message), [])
    const purge = b2.pruneOrphans()
    await b2.close()

    const perdus = AUTEUR.filter(f => !existsSync(join(out, f)) || readFileSync(join(out, f), 'utf-8') !== 'AUTEUR\n')
    assert.deepEqual(perdus, [], `fichiers de l'auteur retirés ou réécrits — purge : ${JSON.stringify(purge)}`)
    for (const f of premieres) assert.ok(!existsSync(join(out, f)), `l'ancienne sortie ${f} du 1er build est remplacée et retirée`)
  })

  it('dossier de sortie égal au dossier source : aucun fichier source ne disparaît', async () => {
    const root = mjsTmp('menage-sortie-source')
    const app  = join(root, 'app')
    mkdirSync(app, { recursive: true })
    writeFileSync(join(app, 'card.mjs'), carte('v1'))
    writeFileSync(join(app, 'card-intro.mjs'), simple('intro'))
    writeFileSync(join(app, 'card-utils.js'), 'export const util = 1\n')
    writeFileSync(join(app, 'logo.png'), Buffer.from([1, 2, 3]))
    writeFileSync(join(app, 'logo-white.png'), Buffer.from([7, 8, 9]))
    const sources = readdirSync(app).sort()

    const opts = { sourceDir: app, outputDir: app, manifestPath: join(app, 'bundle.js') }
    const s1 = await new Bundler(opts).compile()
    assert.deepEqual(s1.errors.map(e => e.message), [])
    writeFileSync(join(app, 'card.mjs'), carte('v2'))
    const b2 = new Bundler(opts)
    const s2 = await b2.compile()
    assert.deepEqual(s2.errors.map(e => e.message), [])
    b2.pruneOrphans()

    assert.deepEqual(sources.filter(f => !existsSync(join(app, f))), [], 'aucun fichier source retiré')
    assert.deepEqual([...readFileSync(join(app, 'logo-white.png'))], [7, 8, 9], 'logo-white.png intact')
  })

  it('`prune: false` : le build ne retire rien, pas même l\'ancienne sortie d\'un composant modifié', async () => {
    const root = mjsTmp('menage-prune-false')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'a.mjs'), simple('v1'))

    const opts = { sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), prune: false }
    const b = new Bundler(opts)
    const s1 = await b.compile()
    assert.deepEqual(s1.errors.map(e => e.message), [])
    const ancienne = readdirSync(out).find(f => /^a-[0-9a-z]{5}\.js$/.test(f))
    assert.ok(ancienne, 'sortie du composant au 1er tour')

    writeFileSync(join(src, 'a.mjs'), simple('v2'))
    const s2 = await b.compile()
    assert.deepEqual(s2.errors.map(e => e.message), [])
    assert.ok(readdirSync(out).filter(f => /^a-[0-9a-z]{5}\.js$/.test(f)).length === 2, `nouvelle sortie écrite, l'ancienne gardée : ${readdirSync(out).join(', ')}`)
    assert.ok(existsSync(join(out, ancienne!)), 'l\'ancienne sortie reste')
    assert.deepEqual(b.pruneOrphans().removed, [], 'pruneOrphans() ne retire rien non plus')
    assert.ok(existsSync(join(out, ancienne!)), 'l\'ancienne sortie reste après pruneOrphans()')
  })
})
