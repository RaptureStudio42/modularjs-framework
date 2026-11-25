// `bin/mjs` ouvre le cache de compilation de Node (`module.enableCompileCache`, Node 22.8 et plus) avant de charger la CLI : au lancement
// suivant, ses modules sont relus déjà compilés. Le dossier est `mjs-node-cache-<uid>` du dossier temporaire, créé et vérifié selon les
// règles de `mjs-server-cache-<uid>` : 0700, à l'utilisateur, jamais un lien. Un dossier refusé ou un dossier temporaire absent : pas de
// cache, sans erreur, rien de créé. Un ouvrier de la construction reçoit le même dossier. NODE_DISABLE_COMPILE_CACHE=1 le coupe, un
// NODE_COMPILE_CACHE déjà posé est suivi. Seulement pour les commandes ponctuelles : `dev`, `ws` et `server` restent lancés et
// rechargent leurs fichiers par `?v=n`, Node y garderait une entrée par rechargement, jamais purgée ; la commande se lit comme la CLI la
// lit. Sur un Node sans cette fonction, ces tests sont sautés ; ils lancent la CLI construite (`dist/`).

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import module from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const MJS      = join(repoRoot, 'bin', 'mjs')
const CACHE    = `mjs-node-cache-${process.getuid?.() ?? 'nouid'}`

// l'environnement de la CLI : ce dossier temporaire, sans réglage de cache venu du lanceur des tests
function envFor(tmp: string, extra: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = { ...process.env, TMPDIR: tmp, NO_COLOR: '1' }
  delete env.NODE_COMPILE_CACHE
  delete env.NODE_DISABLE_COMPILE_CACHE
  return { ...env, ...extra }
}

function run(tmp: string, args: string[], extra: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [MJS, ...args], { encoding: 'utf-8', env: envFor(tmp, extra) })
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}

// fichiers d'un dossier, à toute profondeur
function filesIn(dir: string): number {
  if (!existsSync(dir)) return 0
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).length
}

describe('bin/mjs : cache de compilation de Node, dans un dossier sûr', function () {
  this.timeout(90000)

  before(function () {
    if (typeof (module as { enableCompileCache?: unknown }).enableCompileCache !== 'function') this.skip()
    if (!existsSync(join(repoRoot, 'dist', 'cli.js'))) this.skip()
  })

  it('premier lancement : `mjs-node-cache-<uid>` créé en 0700 et rempli ; le second le relit, même sortie', function () {
    const tmp    = mjsTmp('cache-compilation')
    const first  = run(tmp, ['--version'])
    const dir    = join(tmp, CACHE)
    assert.equal(first.status, 0, first.err)
    assert.equal(lstatSync(dir).mode & 0o777, 0o700)
    const filled = filesIn(dir)
    assert.ok(filled > 0, 'aucun module en cache après le premier lancement')
    const second = run(tmp, ['--version'])
    assert.equal(second.out, first.out)
    assert.equal(filesIn(dir), filled)
    assert.equal(existsSync(join(tmp, 'node-compile-cache')), false)
  })

  it('lien planté à la place du dossier : jamais suivi, pas de cache, sans erreur', function () {
    const tmp    = mjsTmp('cache-compilation-lien')
    const target = join(tmp, 'ailleurs')
    mkdirSync(target)
    symlinkSync(target, join(tmp, CACHE))
    symlinkSync(target, join(tmp, 'node-compile-cache'))
    const r = run(tmp, ['--version'])
    assert.equal(r.status, 0, r.err)
    assert.equal(filesIn(target), 0, 'le cache a écrit au bout du lien')
  })

  it('dossier temporaire absent : rien de créé, pas d\'erreur', function () {
    const tmp = join(mjsTmp('cache-compilation-absent'), 'absent')
    const r   = run(tmp, ['--version'])
    assert.equal(r.status, 0, r.err)
    assert.equal(existsSync(tmp), false)
  })

  it('deux `mjs` lancés en même temps : tous deux sortent bien, le dossier reste en 0700', async function () {
    const tmp  = mjsTmp('cache-compilation-ensemble')
    const once = () => new Promise<{ code: number | null, out: string }>((done) => {
      const child = spawn(process.execPath, [MJS, '--version'], { env: envFor(tmp) })
      let out     = ''
      child.stdout.on('data', (d) => { out += d })
      child.on('close', (code) => done({ code, out }))
    })
    const [a, b] = await Promise.all([once(), once()])
    assert.equal(a.code, 0)
    assert.equal(b.code, 0)
    assert.equal(a.out, b.out)
    assert.equal(lstatSync(join(tmp, CACHE)).mode & 0o777, 0o700)
  })

  it('NODE_DISABLE_COMPILE_CACHE=1 : aucun cache ; NODE_COMPILE_CACHE déjà posé : suivi', function () {
    const tmp = mjsTmp('cache-compilation-reglages')
    const off = run(tmp, ['--version'], { NODE_DISABLE_COMPILE_CACHE: '1' })
    assert.equal(off.status, 0, off.err)
    assert.equal(existsSync(join(tmp, CACHE)), false)
    const own = join(tmp, 'le-mien')
    const set = run(tmp, ['--version'], { NODE_COMPILE_CACHE: own })
    assert.equal(set.status, 0, set.err)
    assert.ok(filesIn(own) > 0)
    assert.equal(existsSync(join(tmp, CACHE)), false)
  })

  it('`dev`, `ws` et `server`, qui restent lancés : aucun cache de compilation de Node', function () {
    for (const command of ['dev', 'ws', 'server']) {
      const tmp = mjsTmp(`cache-compilation-${command}`)
      // projet absent : la commande s'arrête aussitôt ; le délai borne une commande restée lancée
      const r   = spawnSync(process.execPath, [MJS, command, '--root', join(tmp, 'absent')], { encoding: 'utf-8', env: envFor(tmp), timeout: 20000 })
      assert.equal(existsSync(join(tmp, CACHE)), false, `\`mjs ${command}\` a ouvert le cache (code ${r.status}, signal ${r.signal})`)
    }
  })

  it('la valeur de `--root` n\'est jamais la commande : `build --root dev` et `--root server` ouvrent le cache', function () {
    for (const args of [['build', '--root', 'dev'], ['--root', 'server']]) {
      const tmp = mjsTmp('cache-compilation-valeur')
      mkdirSync(join(tmp, args[args.length - 1]))
      const r   = spawnSync(process.execPath, [MJS, ...args], { cwd: tmp, encoding: 'utf-8', env: envFor(tmp), timeout: 20000 })
      assert.ok(filesIn(join(tmp, CACHE)) > 0, `\`mjs ${args.join(' ')}\` n'a pas ouvert le cache (code ${r.status}, signal ${r.signal})`)
    }
  })

  it('construction par les ouvriers : chacun lit le même cache', function () {
    const tmp  = mjsTmp('cache-compilation-ouvriers')
    const root = join(tmp, 'projet')
    mkdirSync(join(root, 'src'), { recursive: true })
    // au-delà de 40 composants, la construction passe par les ouvriers
    for (let i = 1; i <= 41; i++) writeFileSync(join(root, 'src', `carte${i}.mjs`), `<script>\n$n = ${i}\n</script>\n<p>{$n}</p>\n`)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
    const r = run(tmp, ['build', '--root', root], { NODE_DEBUG_NATIVE: 'COMPILE_CACHE' })
    assert.equal(r.status, 0, r.out + r.err)
    assert.match(r.err, new RegExp(`\\[compile cache\\][^\\n]*${CACHE}[^\\n]*\\/dist\\/worker\\.js`))
  })
})
