// Registre des variables de thème (`.mjs-theme-vars.json`) : une déclaration d'un module du cœur nommait son fichier par un
// chemin relatif à la racine du projet, qui remontait jusqu'à l'installation du framework (`../../<installation>/src/
// core-modules/<nom>.mjs`) — un chemin de la machine de build publié dans le dossier de sortie, et qui change d'une
// installation à l'autre. Un module du cœur est maintenant nommé par un identifiant stable, `modularjs/core-modules/<nom>.mjs`,
// quel que soit l'endroit où le framework est installé ; les fichiers de l'application gardent leur chemin relatif au projet.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

type Decl = { value: string; declaredBy: string; kind: string; file: string; line: number }
type Registre = Record<string, { declarations: Decl[]; readBy: string[] }>

describe('registre des variables de thème — un module du cœur est nommé sans chemin de la machine', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('catalogue du cœur hors du projet : `modularjs/core-modules/<nom>.mjs`, le fichier de l\'application reste relatif', async () => {
    const root   = mjsTmp('registre-coeur-chemin')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    // le catalogue vit ailleurs que le projet, comme un framework installé dans un autre dossier
    const coeur  = join(mjsTmp('registre-coeur-installation'), 'src', 'core-modules')
    mkdirSync(srcDir, { recursive: true })
    mkdirSync(coeur, { recursive: true })
    writeFileSync(join(coeur, 'pastille.mjs'), '<theme>\n  $$pastille-fond: red\n</theme>\n<span class="p"><slot></slot></span>\n')
    const hote = join(srcDir, 'hote.mjs')
    writeFileSync(hote, '<theme>\n  $$hote-gap: 12px\n</theme>\n<@@pastille>x</@@pastille>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), stylesheetsDir: join(root, 'styles'), coreModulesDir: coeur })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const fichier = join(outDir, '.mjs-theme-vars.json')
    assert.ok(existsSync(fichier), 'un registre est écrit')
    const texte    = readFileSync(fichier, 'utf-8')
    const registre = JSON.parse(texte) as Registre

    const duCoeur = registre['pastille-fond']?.declarations ?? []
    assert.equal(duCoeur.length, 1, texte)
    assert.equal(duCoeur[0].kind, 'module')
    assert.equal(duCoeur[0].file, 'modularjs/core-modules/pastille.mjs')
    // aucune déclaration, lecture comprise, ne nomme le catalogue par son chemin sur le disque
    const duCatalogue = Object.values(registre).flatMap(v => v.declarations).filter(d => d.declaredBy === 'core-pastille')
    assert.ok(duCatalogue.length > 0, texte)
    assert.deepEqual([...new Set(duCatalogue.map(d => d.file))], ['modularjs/core-modules/pastille.mjs'])
    assert.ok(!texte.includes(relative(process.cwd(), coeur)) && !texte.includes(coeur), 'le dossier d\'installation n\'apparaît nulle part')

    const delApplication = registre['hote-gap']?.declarations ?? []
    assert.equal(delApplication.length, 1, texte)
    assert.equal(delApplication[0].file, relative(process.cwd(), hote), 'le fichier de l\'application garde son chemin relatif au projet')
  })
})
