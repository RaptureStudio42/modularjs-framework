// Paquet npm publié : construction de dist/ et contenu livré.
// dist/ se construit en une seule passe esbuild (`npm run build:self`) : les six entrées (cli, index, worker, testing, mjs-ws,
// mjs-server) partagent leurs modules communs par des morceaux, chaque module livré une fois. Construites séparément, quatre
// d'entre elles portaient chacune une copie complète du compilateur. Les morceaux se posent dans dist/ même, à côté des
// entrées : le code y retrouve ses fichiers par des chemins relatifs à son propre fichier (../package.json, le worker.js
// voisin, ../src/runtime/).
// Le paquet livre tout src/ sauf les sources .ts compilées dans dist/ : le compilateur lit à l'exécution src/runtime,
// src/core-modules, src/assets et les visionneuses src/server/*.mjs ; les types publics sont des déclarations .d.ts
// (tsconfig.types.json, émises avant chaque `npm pack`). Les images de docs/img ne partent pas : le README les charge
// depuis GitHub.
// `npm publish --ignore-scripts` saute prepack, donc build:types : sans un `npm run build:types` préalable, le paquet
// partirait sans dist/types, en silence. `npm run check:publish` (script/check-publish.ts) relit la liste que npm
// enverrait et refuse un paquet sans ses déclarations, sans une entrée de build:self ou un morceau qu'elle charge, sans
// un fichier que le dépôt suit sous « files » (runtime, modules du cœur, images : sans mjs_ajax.ts, `mjs build --prod`
// échoue chez l'utilisateur), dont le bin n'est pas exécutable, ou dont dist/ n'est plus ce que build:self tire des
// sources ; un échec du contrôle lui-même rend 2, jamais 1. Les déclarations s'émettent avec strictNullChecks : un champ
// qui peut valoir undefined le dit ; elles ne citent que des paquets que l'utilisateur installe avec celui-ci (pas
// @types/ws) et les types de Node, que package.json déclare en dépendance pair facultative (@types/node, toute version :
// npm ne refuse jamais une installation pour elle). Chaque sous-chemin exporté a ses types, `/cli` compris.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE  = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG     = JSON.parse(readFileSync(join(RACINE, 'package.json'), 'utf8'))
const ENTREES = { 'cli.js': 'src/cli.ts', 'index.js': 'src/index.ts', 'worker.js': 'src/bundler/worker.ts', 'testing.js': 'src/testing/index.ts', 'mjs-ws.js': 'src/mjs-ws/index.ts', 'mjs-server.js': 'src/mjs-server/index.ts' }

// fichiers d'un dossier, chemins relatifs à la racine du paquet
function fichiers(dossier: string): string[] {
  return readdirSync(join(RACINE, dossier), { withFileTypes: true }).flatMap(e => e.isDirectory() ? fichiers(dossier + '/' + e.name) : [dossier + '/' + e.name])
}

// sorties de dist/ qu'une entrée charge : le fichier et les morceaux qu'il importe, de proche en proche
function chargees(entree: string): string[] {
  const vues = new Set<string>()
  const pile = [entree]
  while (pile.length) {
    const f = pile.pop()!
    if (vues.has(f)) continue
    vues.add(f)
    for (const m of readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*\(?\s*"(\.\/[^"]+)"/g)) pile.push(join(dirname(f), m[1]))
  }
  return [...vues]
}

describe('paquet npm publié : dist/ en une passe esbuild, contenu livré', function () {
  this.timeout(120000)
  let tmp = ''

  before(() => { tmp = mkdtempSync(join(tmpdir(), 'mjs-paquet-')) })
  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }) })

  it('build:self : une seule passe esbuild, six entrées, aucun module source dans deux fichiers, morceaux à plat dans dist/', () => {
    const passes = PKG.scripts['build:self'].split('&&').map((s: string) => s.trim()).filter((s: string) => s.startsWith('esbuild '))
    assert.equal(passes.length, 1, 'passes esbuild : ' + passes.length)
    const sortie = join(tmp, 'dist')
    const args   = passes[0].split(/\s+/).slice(1).map((a: string) => a === '--outdir=dist' ? '--outdir=' + sortie : a)
    assert.ok(args.includes('--outdir=' + sortie), 'la passe écrit dans dist/')
    const r = spawnSync(join(RACINE, 'node_modules/.bin/esbuild'), [...args, '--metafile=' + join(tmp, 'meta.json'), '--log-level=error'], { cwd: RACINE, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    const meta     = JSON.parse(readFileSync(join(tmp, 'meta.json'), 'utf8'))
    const entrees  = {} as Record<string, string>
    const porteurs = new Map<string, string[]>()
    for (const [fichier, o] of Object.entries<any>(meta.outputs)) {
      const nom = basename(fichier)
      assert.equal(dirname(join(RACINE, fichier)), sortie, 'sortie hors de dist/ : ' + fichier)
      // hors des six entrées, que des morceaux (code partagé, ou cible d'un import() dynamique)
      if (nom in ENTREES) entrees[nom] = o.entryPoint
      else assert.match(nom, /^chunk-[A-Z0-9]+\.js$/, 'sortie qui n\'est ni une entrée ni un morceau')
      for (const [module, i] of Object.entries<any>(o.inputs)) {
        if (i.bytesInOutput > 0) porteurs.set(module, [...(porteurs.get(module) ?? []), basename(fichier)])
      }
    }
    assert.deepEqual(entrees, ENTREES)
    assert.deepEqual([...porteurs].filter(([, f]) => f.length > 1).map(([m, f]) => m + ' → ' + f.join(', ')), [], 'modules livrés plusieurs fois')
  })

  it('npm pack : tout src/ sauf les sources .ts compilées dans dist/, et pas docs/img', () => {
    const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', join(tmp, 'cache-npm')], { cwd: RACINE, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    const livres  = new Set<string>(JSON.parse(r.stdout)[0].files.map((f: { path: string }) => f.path))
    const compile = (f: string) => f.endsWith('.ts') && !f.startsWith('src/runtime/')
    const src     = fichiers('src')
    assert.deepEqual(src.filter(f => !compile(f) && !livres.has(f)), [], 'lus à l\'exécution mais absents du paquet')
    assert.deepEqual(src.filter(f => compile(f) && livres.has(f)), [], 'sources compilées dans dist/ encore livrées')
    assert.deepEqual(['bin/mjs', 'README.md', 'LICENSE', ...fichiers('docs').filter(f => f.endsWith('.md'))].filter(f => !livres.has(f)), [])
    assert.deepEqual([...livres].filter(f => f.startsWith('docs/img/')), [], 'docs/img livré')
  })

  it('exports « types » : des déclarations .d.ts émises par tsconfig.types.json avant chaque npm pack, nommées en premier', () => {
    assert.match(PKG.scripts.prepack ?? '', /\bbuild:types\b/, 'prepack émet les types')
    assert.match(PKG.scripts['build:types'] ?? '', /tsconfig\.types\.json/)
    const cibles = [] as string[]
    for (const [chemin, cible] of Object.entries<any>(PKG.exports)) {
      if (chemin === './package.json') continue
      assert.equal(typeof cible, 'object', chemin + ' : un sous-chemin sans « types » se lit sans déclaration (TS7016 sous strict)')
      assert.equal(Object.keys(cible)[0], 'types', chemin + ' : « types » en premier')
      assert.match(cible.types, /^\.\/dist\/types\/.+\.d\.ts$/, chemin)
      cibles.push(cible.types)
    }
    assert.equal(cibles.length, 5)
    const sortie = join(tmp, 'types')
    const r = spawnSync(process.execPath, [join(RACINE, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.types.json', '--outDir', sortie], { cwd: RACINE, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.deepEqual(cibles.filter(c => !existsSync(join(sortie, relative('./dist/types', c)))), [], 'déclarations absentes')
  })

  it('dist/ construit : les entrées se chargent, retrouvent ../package.json, leurs morceaux existent, aucun orphelin', function () {
    if (!existsSync(join(RACINE, 'dist/cli.js'))) { this.skip(); return }   // dist/ non construit ici
    const version = spawnSync(process.execPath, [join(RACINE, 'bin/mjs'), '--version'], { cwd: tmp, encoding: 'utf8' })
    assert.equal(version.status, 0, version.stderr)
    assert.ok(version.stdout.includes(PKG.version), version.stdout)
    // worker.js refuse de se charger hors d'un fil de travail : ses morceaux sont lus par chargees() ci-dessous
    for (const nom of ['index.js', 'testing.js', 'mjs-ws.js', 'mjs-server.js']) {
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(join(RACINE, 'dist', nom))})`], { cwd: tmp, encoding: 'utf8' })
      assert.equal(r.status, 0, nom + ' : ' + r.stderr)
    }
    const atteintes = new Set(Object.keys(ENTREES).flatMap(e => chargees(join(RACINE, 'dist', e)).map(f => basename(f))))
    assert.deepEqual(readdirSync(join(RACINE, 'dist')).filter(f => f.endsWith('.js') && !atteintes.has(f)), [], 'morceaux orphelins dans dist/')
  })

  // contrôle avant publication, lancé comme à la main : `npm run check:publish -- <dossier du paquet>`
  function checkPublish(dir: string, env: Record<string, string> = {}) {
    return spawnSync('npm', ['run', '--silent', 'check:publish', '--', dir], { cwd: RACINE, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(tmp, 'cache-npm'), ...env } })
  }

  // faux paquet de la forme du vrai : entrées de build:self construites par esbuild (un morceau partagé), un fichier du runtime,
  // un module du cœur et une image que le compilateur lit chez l'utilisateur, des déclarations en deux fichiers, un bin
  // exécutable ; son dépôt git suit tout sauf dist/, comme celui du framework
  function fakePackage(name: string, versioned = true): string {
    const dir   = join(tmp, name)
    const build = 'esbuild cli=src/cli.ts index=src/index.ts worker=src/worker.ts --bundle --splitting --format=esm --platform=node --outdir=dist --chunk-names=chunk-[hash]'
    const files = {
      'package.json': JSON.stringify({ name: 'faux-paquet', version: '1.0.0', type: 'module', bin: { faux: 'bin/faux' }, main: 'dist/index.js', exports: { '.': { types: './dist/types/index.d.ts', import: './dist/index.js' }, './cli': './dist/cli.js' }, scripts: { 'build:self': `rm -f dist/chunk-*.js && ${build}` }, files: ['dist', 'bin', 'src/runtime', 'src/core-modules', 'src/assets'] }),
      '.gitignore': 'dist/\n',
      'bin/faux': '#!/usr/bin/env node\nimport \'../dist/cli.js\'\n',
      'src/partage.ts': 'export const a = 1\n',
      'src/cli.ts': 'import { a } from \'./partage\'\nconsole.log(a)\n',
      'src/index.ts': 'export { a } from \'./partage\'\n',
      'src/worker.ts': 'export const w = 2\n',
      'src/runtime/mjs_ajax.ts': 'export const ajax = 1\n',
      'src/core-modules/select.mjs': '<p>select</p>\n',
      'src/assets/hologram/grain.webp': 'RIFF',
      'dist/types/index.d.ts': 'export { a } from \'./sous/a.js\'\n',
      'dist/types/sous/a.d.ts': 'export declare const a: number\n'
    } as Record<string, string>
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, f)), { recursive: true })
      writeFileSync(join(dir, f), text)
    }
    chmodSync(join(dir, 'bin/faux'), 0o755)
    const built = spawnSync(join(RACINE, 'node_modules/.bin/esbuild'), [...build.split(/\s+/).slice(1), '--log-level=error'], { cwd: dir, encoding: 'utf8' })
    assert.equal(built.status, 0, built.stderr)
    for (const args of versioned ? [['init', '-q'], ['add', '-A']] : []) {
      const g = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      assert.equal(g.status, 0, g.stderr)
    }
    return dir
  }

  const chunkOf = (dir: string) => 'dist/' + readdirSync(join(dir, 'dist')).find((f) => /^chunk-.+\.js$/.test(f))

  it('npm run check:publish : refuse un paquet sans ses types, sans une entrée ou un morceau, ou dont le bin n\'est pas exécutable', () => {
    const complete = checkPublish(fakePackage('complet'))
    assert.equal(complete.status, 0, complete.stdout + complete.stderr)
    const broken = fakePackage('casse')
    const chunk  = chunkOf(broken)
    rmSync(join(broken, 'dist/types'), { recursive: true })
    rmSync(join(broken, chunk))
    rmSync(join(broken, 'dist/worker.js'))
    chmodSync(join(broken, 'bin/faux'), 0o644)
    const r = checkPublish(broken)
    assert.equal(r.status, 1, r.stdout + r.stderr)
    for (const said of ['dist/types/index.d.ts', 'npm run build:types', chunk, 'dist/worker.js', 'npm run build:self', 'bin/faux', 'exécutable']) assert.ok(r.stderr.includes(said), '« ' + said + ' » absent du message : ' + r.stderr)
    assert.doesNotMatch(r.stderr, /ne correspond plus à ses sources/, 'un fichier dit manquant ne se compte pas une deuxième fois')
    const partial = fakePackage('partiel')
    rmSync(join(partial, 'dist/types/sous/a.d.ts'))
    const p = checkPublish(partial)
    assert.equal(p.status, 1, p.stdout + p.stderr)
    assert.ok(p.stderr.includes('dist/types/sous/a.d.ts'), p.stderr)
  })

  it('npm run check:publish : refuse un dist/ qui n\'est plus ce que build:self tire des sources', () => {
    const stale = fakePackage('perime')
    writeFileSync(join(stale, 'src/worker.ts'), 'export const w = 3\n')
    const r = checkPublish(stale)
    assert.equal(r.status, 1, r.stdout + r.stderr)
    for (const said of ['dist/ ne correspond plus à ses sources', 'dist/worker.js', 'npm run build:self']) assert.ok(r.stderr.includes(said), '« ' + said + ' » absent du message : ' + r.stderr)
    // un orphelin d'une construction ancienne : build:self ne l'écrirait pas
    const orphan = fakePackage('orphelin')
    writeFileSync(join(orphan, 'dist/chunk-ANCIEN.js'), 'export const vieux = 1\n')
    const o = checkPublish(orphan)
    assert.equal(o.status, 1, o.stdout + o.stderr)
    assert.ok(o.stderr.includes('dist/chunk-ANCIEN.js'), o.stderr)
  })

  it('npm run check:publish : refuse un paquet sans un fichier du runtime, des modules du cœur ou des images que son dépôt suit', () => {
    const lost = fakePackage('sans-fichiers-lus')
    const gone = ['src/runtime/mjs_ajax.ts', 'src/core-modules/select.mjs', 'src/assets/hologram/grain.webp']
    for (const f of gone) rmSync(join(lost, f))
    const r = checkPublish(lost)
    assert.equal(r.status, 1, r.stdout + r.stderr)
    for (const said of [...gone, 'le dépôt le suit', 'git checkout --']) assert.ok(r.stderr.includes(said), '« ' + said + ' » absent du message : ' + r.stderr)
    // sur le disque, mais écarté du paquet par un .npmignore
    const hidden = fakePackage('ecarte')
    writeFileSync(join(hidden, 'src/core-modules/.npmignore'), 'select.mjs\n')
    const h = checkPublish(hidden)
    assert.equal(h.status, 1, h.stdout + h.stderr)
    assert.ok(h.stderr.includes('src/core-modules/select.mjs') && h.stderr.includes('.npmignore'), h.stderr)
  })

  it('npm run check:publish : hors d\'un dépôt git, ou dans un dépôt qui ne suit pas le paquet, code 2 (échec du contrôle), jamais « Paquet complet »', () => {
    const loose = fakePackage('hors-depot', false)
    const r = checkPublish(loose)
    assert.equal(r.status, 2, r.stdout + r.stderr)
    assert.match(r.stderr, /git ne répond pas|ne suit pas/)
    const inner = join(fakePackage('depot'), 'sous-paquet')
    cpSync(loose, inner, { recursive: true })
    const u = checkPublish(inner)
    assert.equal(u.status, 2, u.stdout + u.stderr)
    assert.match(u.stderr, /le dépôt git ne suit pas/)
  })

  // le noyau refuse un chemin de socket Unix de plus de 107 octets : un lanceur qui ouvre la sienne sous TMPDIR
  // (`tsx-<uid>/<pid>.pipe`) tombe en `listen EINVAL` avant le contrôle, et rend 1, le code d'un paquet incomplet
  it('sous un TMPDIR trop long pour une socket Unix, npm run check:publish contrôle et répond', () => {
    const long = join(tmp, 'un-dossier-temporaire-dont-le-nom-suffit-a-depasser-la-limite-des-sockets-unix-du-noyau')
    mkdirSync(long, { recursive: true })
    assert.ok(Buffer.byteLength(long) > 107, `le TMPDIR du cas doit dépasser 107 octets : ${long}`)
    const r = checkPublish(fakePackage('tmpdir-long'), { TMPDIR: long })
    assert.equal(r.status, 0, `code ${r.status}\n${r.stdout}${r.stderr}`)
    assert.match(r.stdout, /Paquet complet/)
  })

  it('dist/ construit : le paquet que `npm publish --ignore-scripts` enverrait porte ses types et ses fichiers vitaux', function () {
    if (!existsSync(join(RACINE, 'dist/cli.js'))) { this.skip(); return }   // dist/ non construit ici
    const r = checkPublish(RACINE)
    assert.equal(r.status, 0, r.stdout + r.stderr)
  })

  it('types publics lus par un projet TypeScript strict, sans skipLibCheck ni @types/ws : aucune erreur, la nullité gardée, /cli typé', () => {
    const project = join(tmp, 'projet-ts')
    const pkg     = join(project, 'node_modules/modularjs-framework')
    const emit    = spawnSync(process.execPath, [join(RACINE, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.types.json', '--outDir', join(pkg, 'dist/types')], { cwd: RACINE, encoding: 'utf8' })
    assert.equal(emit.status, 0, emit.stdout + emit.stderr)
    writeFileSync(join(pkg, 'package.json'), readFileSync(join(RACINE, 'package.json')))
    // ce qu'un `npm install modularjs-framework` pose à côté : les dépendances dont les déclarations sont lues, `ws` sans ses types
    for (const dep of ['acorn', 'magic-string', 'ws', '@types/node']) {
      mkdirSync(dirname(join(project, 'node_modules', dep)), { recursive: true })
      symlinkSync(join(RACINE, 'node_modules', dep), join(project, 'node_modules', dep), 'junction')
    }
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'projet-ts', private: true, type: 'module' }))
    writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'node16', moduleResolution: 'node16', strict: true, skipLibCheck: false, noEmit: true, types: ['node'] }, files: ['controle.ts'] }))
    // les déclarations citent les modules de Node : package.json le dit, en dépendance pair facultative (un projet JavaScript n'installe rien)
    const dts  = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? dts(join(d, e.name)) : e.name.endsWith('.d.ts') ? [join(d, e.name)] : [])
    const node = dts(join(pkg, 'dist/types')).filter((f) => /from ['"]node:|reference types="node"/.test(readFileSync(f, 'utf8')))
    assert.ok(node.length > 0, 'aucune déclaration ne cite Node : la dépendance pair @types/node peut partir')
    assert.ok(PKG.peerDependencies?.['@types/node'], `${node.length} déclarations citent Node (${relative(pkg, node[0])}…) : @types/node doit figurer dans peerDependencies`)
    assert.equal(PKG.peerDependenciesMeta?.['@types/node']?.optional, true, '@types/node : dépendance pair facultative')
    writeFileSync(join(project, 'controle.ts'), [
      'import type * as cli from \'modularjs-framework/cli\'',
      'import { resolveBundlerOpts, HMRServer } from \'modularjs-framework\'',
      'import { createHarness } from \'modularjs-framework/testing\'',
      'import { mjsWs } from \'modularjs-framework/ws\'',
      'import { mjsServer } from \'modularjs-framework/mjs-server\'',
      'const opts = resolveBundlerOpts({ sourceDir: \'a\', outputDir: \'b\' }, \'/tmp\')',
      '// @ts-expect-error sans la clé stylesheetsDir, le champ vaut undefined',
      'console.log(opts.stylesheetsDir.length, HMRServer, createHarness, mjsWs, mjsServer)',
      'export type Cli = typeof cli',
      ''
    ].join('\n'))
    const r = spawnSync(process.execPath, [join(RACINE, 'node_modules/typescript/bin/tsc'), '-p', project], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stdout + r.stderr)
  })

  it('dist/ construit : les entrées partagent la langue des messages, celle du projet que findConfig a lu', function () {
    if (!existsSync(join(RACINE, 'dist/cli.js'))) { this.skip(); return }   // dist/ non construit ici
    const project = join(tmp, 'projet-en')
    mkdirSync(project)
    writeFileSync(join(project, 'mjs.config.json'), JSON.stringify({ sourceDir: 'a', outputDir: 'b', lang: 'en' }))
    const code = [
      `const index = await import(${JSON.stringify(join(RACINE, 'dist/index.js'))})`,
      `const ws = await import(${JSON.stringify(join(RACINE, 'dist/mjs-ws.js'))})`,
      'const said = () => { try { ws.signToken({}, \'\') } catch (e) { return e.message } }',
      'const before = said()',
      `index.findConfig(${JSON.stringify(project)})`,
      'process.stdout.write(JSON.stringify([before, said()]))'
    ].join('\n')
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: tmp, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    const [before, after] = JSON.parse(r.stdout)
    assert.match(before, /secret manquant ou vide/)
    assert.match(after, /secret missing or empty/)
  })
})
