// Les imports nus d'une entrée serveur restent nus dans le JS compilé : c'est Node qui les résout, comme pour un fichier du projet
// — ses conditions (`node-addons`, celles de `--conditions` dans NODE_OPTIONS), jamais les `paths` de tsconfig.json, et une seule
// instance d'un paquet que l'entrée et un fichier du projet importent tous deux. Le cache vit sous `<root>/node_modules`, d'où Node
// trouve les paquets en remontant ; dans le repli du dossier temporaire (node_modules en lecture seule, ou absent avec des paquets
// dans un dossier parent), des liens `node_modules` y rendent à Node les mêmes dossiers, dans le même ordre.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { compileServerFile } from '../src/cli/server-entry.js'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

after(() => sweepRegistered())

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
const ATTENDU = ['addons', 'vrai-npm', 'addons', 'def', true]

const ENTREE = `@import default a 'cond-addons'
@import id 'cond-addons'
@import default v 'vrai'
@import default h './aide.js'
@import default d 'cond-dev'

export default { v: [a, v, h.a, d, id is h.id] }
`

const esm = (v: string) => `export default ${JSON.stringify(v)}\n`
// un objet propre à chaque instance du module : deux instances du paquet ne le partagent pas
const esmId = (v: string) => `${esm(v)}export const id = {}\n`

function paquet(nm: string, nom: string, pj: object, fichiers: Record<string, string>) {
  mkdirSync(join(nm, nom), { recursive: true })
  writeFileSync(join(nm, nom, 'package.json'), JSON.stringify({ name: nom, ...pj }))
  for (const [f, c] of Object.entries(fichiers)) writeFileSync(join(nm, nom, f), c)
}

// `ou` : les paquets dans le node_modules du projet ('ici'), le même en lecture seule ('lecture'), dans celui du dossier parent
// ('parent'), ou partagés entre les deux, celui du projet en lecture seule ('deux')
function projet(ou: 'ici' | 'lecture' | 'parent' | 'deux') {
  const base   = mjsTmp('imports-nus-node')
  const root   = join(base, 'app')
  const nm     = join(ou === 'parent' ? base : root, 'node_modules')
  const nmDev  = ou === 'deux' ? join(base, 'node_modules') : nm
  mkdirSync(root, { recursive: true })
  paquet(nm, 'cond-addons', { exports: { '.': { 'node-addons': './addons.mjs', import: './imp.mjs', default: './def.mjs' } } }, { 'addons.mjs': esmId('addons'), 'imp.mjs': esmId('imp'), 'def.mjs': esmId('def') })
  paquet(nmDev, 'cond-dev', { exports: { '.': { development: './dev.mjs', default: './def.mjs' } } }, { 'dev.mjs': esm('dev'), 'def.mjs': esm('def') })
  paquet(nm, 'vrai', { exports: './v.mjs' }, { 'v.mjs': esm('vrai-npm') })
  // les `paths` de tsconfig.json : un outil de construction les suivrait, Node jamais
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { vrai: ['./vendor/faux.js'] } } }))
  mkdirSync(join(root, 'vendor'))
  writeFileSync(join(root, 'vendor', 'faux.js'), esm('faux-tsconfig'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'moi', type: 'module' }))
  writeFileSync(join(root, 'aide.js'), "import a, { id } from 'cond-addons'\nexport default { a, id }\n")
  writeFileSync(join(root, 'e.server.mjs'), ENTREE)
  if (ou === 'lecture' || ou === 'deux') chmodSync(nm, 0o555)
  return { base, root, nm, entree: join(root, 'e.server.mjs') }
}

const liste = (d: string) => existsSync(d) ? readdirSync(d, { recursive: true }).map(String).sort() : []

async function charge(p: ReturnType<typeof projet>) {
  const url  = await compileServerFile(p.entree, p.root)
  const code = readFileSync(new URL(url), 'utf8')
  const m    = await import(url)
  return { fichier: fileURLToPath(url), code, v: m.default.v }
}

describe('entrée serveur — les imports nus restent nus, Node les résout comme pour un fichier du projet', () => {
  let avant: string | undefined
  let temp = ''

  beforeEach(() => {
    avant = process.env.TMPDIR
    temp  = mjsTmp('imports-nus-node-temp')
    process.env.TMPDIR = temp
  })

  afterEach(() => {
    // `process.env.X = undefined` écrit la chaîne 'undefined' : tmpdir() rendrait alors un chemin relatif
    if (avant === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = avant
  })

  it('node_modules du projet : import laissé nu, condition node-addons de Node, paths de tsconfig ignorés, une seule instance du paquet', async function () {
    this.timeout(30000)
    const p = projet('ici')
    const r = await charge(p)
    assert.ok(r.fichier.startsWith(join(p.nm, '.cache', 'mjs', 'server')), r.fichier)
    assert.match(r.code, /from\s*["']cond-addons["']/)
    assert.match(r.code, /from\s*["']vrai["']/)
    assert.deepEqual(r.v, ATTENDU)
  })

  for (const [ou, titre] of [['lecture', 'node_modules du projet en lecture seule'], ['parent', 'projet sans node_modules, paquets dans celui du dossier parent'], ['deux', 'paquets dans le node_modules du projet, en lecture seule, et dans celui du parent']] as const) {
    it(`${titre} : repli au dossier temporaire, Node y résout les mêmes paquets, même instance ; rien n'est écrit dans un node_modules`, async function () {
      this.timeout(30000)
      const p        = projet(ou)
      const parent   = join(p.base, 'node_modules')
      const avantNm  = liste(p.nm)
      const avantPar = liste(parent)
      try {
        const r = await charge(p)
        assert.ok(r.fichier.startsWith(join(temp, `mjs-server-cache-${process.getuid?.() ?? 'nouid'}`)), r.fichier)
        assert.match(r.code, /from\s*["']cond-addons["']/)
        assert.deepEqual(r.v, ATTENDU)
        assert.deepEqual(liste(p.nm), avantNm)
        assert.deepEqual(liste(parent), avantPar)
      }
      finally {
        if (existsSync(p.nm)) chmodSync(p.nm, 0o755)
      }
    })
  }

  it('NODE_OPTIONS=--conditions=development : Node prend la condition development, cache dans le projet comme dans le dossier temporaire', function () {
    this.timeout(60000)
    for (const ou of ['ici', 'parent'] as const) {
      const p    = projet(ou)
      const code = `const { compileServerFile } = await import(${JSON.stringify(pathToFileURL(join(RACINE, 'src/cli/server-entry.ts')).href)})\nconst m = await import(await compileServerFile(${JSON.stringify(p.entree)}, ${JSON.stringify(p.root)}))\nprocess.stdout.write(JSON.stringify(m.default.v))\n`
      const env  = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --conditions=development`.trim() }
      const r    = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { cwd: RACINE, env, encoding: 'utf8' })
      assert.equal(r.status, 0, r.stderr)
      assert.deepEqual(JSON.parse(r.stdout), ['addons', 'vrai-npm', 'addons', 'dev', true], ou)
    }
  })
})
