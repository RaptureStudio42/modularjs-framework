// Un gros .js cité par plusieurs composants (une bibliothèque minifiée, 1,8 Mo) n'est analysé qu'une
// fois par chemin et par empreinte : la copie, la réécriture de ses imports voisins et le suivi de ses
// dépendances partagent la même lecture. Sans `import` ni `export`, rien à réécrire ni à suivre : aucune
// analyse des imports. Mesuré en comptant les analyses d'un texte repéré par une marque, jamais le temps.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Parser } from 'acorn'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const MARQUE = '/* vendeur-marque-analyse */'
const CORPS  = Array.from({ length: 200 }, (_, i) => `a.push(function f${i}(x){return x*${i}+${i % 7}});`).join('\n')
const AVEC   = `${MARQUE}\nimport { z } from './z.js'\nexport const q = z\nvar a=[];\n${CORPS}\n`
const SANS   = `${MARQUE}\n(function(){var a=[];\n${CORPS}\n})();\n`

/** nombre d'analyses (acorn) du texte qui porte la marque, le temps de `travail` */
async function analyses(travail: () => Promise<unknown>): Promise<number> {
  const proto: any = Parser.prototype
  const origine    = proto.parse
  let nombre       = 0
  proto.parse = function (this: any, ...args: unknown[]) {
    if (typeof this.input === 'string' && this.input.includes(MARQUE)) nombre++
    return origine.apply(this, args)
  }
  try {
    await travail()
  }
  finally {
    proto.parse = origine
  }
  return nombre
}

function projet(prefixe: string, gros: string, composants: number) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  mkdirSync(join(srcDir, 'vendor'), { recursive: true })
  writeFileSync(join(srcDir, 'vendor/gros.js'), gros)
  writeFileSync(join(srcDir, 'vendor/z.js'), 'export const z = 1\n')
  writeFileSync(join(srcDir, 'vendor/w.js'), 'export const z = 2\n')
  for (let i = 0; i < composants; i++) writeFileSync(join(srcDir, `comp-${i}.mjs`), `<script>\n  go = -> µasset('vendor/gros.js')\n</script>\n<p>${i}</p>\n`)
  return { srcDir, outDir: join(root, 'out'), manifest: join(root, 'bundle.js') }
}

describe('bundler — un .js cité par plusieurs composants est analysé une fois par chemin et par empreinte', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('12 composants citent le même .js qui a des imports : au plus deux analyses (validité, puis imports), pas trente-six', async () => {
    const p = projet('js-analyse-avec', AVEC, 12)
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      let erreurs: string[] = []
      const nombre = await analyses(async () => { erreurs = (await bundler.compile()).errors.map((e: any) => e.message) })
      assert.deepEqual(erreurs, [])
      assert.ok(nombre <= 2, `${nombre} analyses du même fichier pour 12 composants`)
      assert.ok(readdirSync(p.outDir).some(f => /^z-[a-f0-9]{8}\.js$/.test(f)), 'le voisin z.js est publié')
    }
    finally {
      await bundler.close()
    }
  })

  it('un .js sans import ni export : une seule analyse (sa validité), aucune de ses imports', async () => {
    const p = projet('js-analyse-sans', SANS, 12)
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      let erreurs: string[] = []
      const nombre = await analyses(async () => { erreurs = (await bundler.compile()).errors.map((e: any) => e.message) })
      assert.deepEqual(erreurs, [])
      assert.ok(nombre <= 1, `${nombre} analyses d'un fichier sans import ni export`)
      assert.ok(readdirSync(p.outDir).some(f => /^gros-[a-f0-9]{8}\.js$/.test(f)), 'le fichier est publié')
    }
    finally {
      await bundler.close()
    }
  })

  it('l\'empreinte garde le mémo honnête : le .js modifié entre deux compilations est ré-analysé et ses nouveaux imports suivis', async () => {
    const p = projet('js-analyse-fraicheur', AVEC, 3)
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [])
      writeFileSync(join(p.srcDir, 'vendor/gros.js'), AVEC.replace("'./z.js'", "'./w.js'"))
      assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [])
      const gros = readdirSync(p.outDir).filter(f => /^gros-[a-f0-9]{8}\.js$/.test(f))
      assert.equal(gros.length, 1, `une seule version de gros.js : ${gros.join(', ')}`)
      const imports = [...readFileSync(join(p.outDir, gros[0]), 'utf8').matchAll(/from '(\.\/[^']+)'/g)].map(m => m[1])
      assert.equal(imports.length, 1)
      assert.match(imports[0], /^\.\/w-[a-f0-9]{8}\.js$/, 'le nouvel import vise w.js publié')
      assert.ok(existsSync(join(p.outDir, imports[0])), 'et ce fichier est là')
    }
    finally {
      await bundler.close()
    }
  })
})
