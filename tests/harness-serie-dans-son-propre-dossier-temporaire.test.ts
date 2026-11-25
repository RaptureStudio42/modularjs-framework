// garde du HARNAIS, pas du produit : chaque série de tests travaille dans son propre dossier temporaire, créé sous le TMPDIR reçu et retiré
// à la fin, et rien d'autre de ce TMPDIR n'est touché. Le balai de fin de série effaçait tout dossier mjs-* apparu pendant la série, quel
// qu'en soit le propriétaire : toutes les conversations du bac à sable partagent le même TMPDIR, et une série a ainsi vidé le dossier de
// travail d'une construction d'appli en cours (mjs-build.XXXXXX : 16 classes perdues, construction dite réussie) ; au démarrage, il
// retirait aussi les mjs-<nom>-<6 car.> muets depuis 1 h, d'où qu'ils viennent ; et un verrou orphelin d'un run voisin, jugé vivant parce
// que son numéro de processus existait ici, bloquait le ménage des séries suivantes. Chaque cas lance le vrai script (ou mocha seul, comme
// `npm run test:brut`) sur une suite témoin, dans un TMPDIR à lui

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const script   = join(repoRoot, 'script', 'test-enclos.sh')
const mocha    = join(repoRoot, 'node_modules', 'mocha', 'bin', 'mocha.js')
const hook     = join(repoRoot, 'tests', 'helpers', 'tmp-sweep.ts')
const sleep    = (ms: number) => new Promise((r) => setTimeout(r, ms))

// le dossier de la série naît sous le TMPDIR reçu, ou sous /tmp quand la socket de tsx n'y tiendrait pas (107 octets au plus, cf. test-enclos.sh)
const expectedParent = (received: string): string => Buffer.byteLength(join(received, 'tests-XXXXXX', `tsx-${process.getuid?.() ?? 0}`, '4194304.pipe')) <= 107 ? received : '/tmp'

// suite témoin écrite dans un dossier à elle, hors du TMPDIR reçu
function writeSpec(tmp: string, lines: string[]): string {
  const specPath = join(tmp, 'spec', 'temoin.spec.mjs')
  mkdirSync(dirname(specPath), { recursive: true })
  writeFileSync(specPath, lines.join('\n'))
  return specPath
}

// environnement des runs témoins : TMPDIR reçu à eux, sans file commune ni relevé (jamais la suite entière)
function runEnv(received: string, maxsec = '0'): NodeJS.ProcessEnv {
  mkdirSync(received, { recursive: true })
  return { ...process.env, MJS_TEST_MEM: '600M', MJS_TEST_MAXSEC: maxsec, MJS_TEST_JETONS: '0', MJS_TEST_TRACE: '0', TMPDIR: received }
}

function runScript(specPath: string, env: NodeJS.ProcessEnv) {
  const r = spawnSync('bash', [script, '--no-config', '--no-package', specPath], { cwd: repoRoot, env, encoding: 'utf-8', timeout: 120000 })
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

// run lancé en tâche de fond : le test agit PENDANT la série, puis attend sa fin
function launch(cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(cmd, args, { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out     = ''
  child.stdout.on('data', (d) => out += d)
  child.stderr.on('data', (d) => out += d)
  const done = new Promise<{ code: number | null, out: string }>((resolve) => child.on('close', (code) => resolve({ code, out })))
  return { child, done, out: () => out }
}

async function waitFor(ok: () => boolean, ms: number): Promise<boolean> {
  for(const end = Date.now() + ms; Date.now() < end; await sleep(100)) if(ok()) return true
  return ok()
}

// témoin qui note le TMPDIR qu'il voit, ouvre un banc dedans comme tout test, puis attend le signal du test extérieur
const WAITING = (seen: string, go: string) => [
  "import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'",
  "import { join } from 'node:path'",
  "import { tmpdir } from 'node:os'",
  'const sleep = (ms) => new Promise((r) => setTimeout(r, ms))',
  "describe('série témoin', function () {",
  "  it('attend le dossier étranger', async function () {",
  '    this.timeout(0)',
  "    writeFileSync(join(mkdtempSync(join(tmpdir(), 'mjs-banc-')), 'trace.txt'), 'en cours')",
  `    writeFileSync(${JSON.stringify(seen)}, tmpdir())`,
  `    for(let i = 0; i < 600 && !existsSync(${JSON.stringify(go)}); i++) await sleep(100)`,
  `    if(!existsSync(${JSON.stringify(go)})) throw new Error('signal du test extérieur jamais reçu')`,
  '  })',
  '})',
]

// la construction voisine : son dossier de travail apparaît dans le TMPDIR reçu pendant la série, une classe dedans
function foreignBuild(received: string): string {
  const dir = join(received, 'mjs-build.'+ randomBytes(3).toString('hex'))
  mkdirSync(dir)
  writeFileSync(join(dir, 'classe.mjs'), 'export default 1')
  return dir
}

// pendant la série, la construction voisine pose son dossier ; la série finie, il doit être intact, et le dossier de la série parti
async function foreignDuringRun(tmp: string, received: string, start: (specPath: string) => ReturnType<typeof launch>) {
  const seen = join(tmp, 'tmpdir-vu.txt')
  const go   = join(tmp, 'go')
  const run  = start(writeSpec(tmp, WAITING(seen, go)))
  try {
    assert.ok(await waitFor(() => existsSync(seen), 90000), `la série témoin n'a jamais démarré :\n${run.out()}`)
    const foreign = foreignBuild(received)
    writeFileSync(go, '')
    const r = await run.done
    return { r, foreign, serie: readFileSync(seen, 'utf-8') }
  }
  finally {
    if(run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGTERM')
  }
}

function assertSerieGone(serie: string, received: string, out: string): void {
  assert.equal(dirname(serie), expectedParent(received), `la série doit travailler dans un dossier à elle sous le TMPDIR reçu (${received}), pas dans ${serie}\n${out}`)
  assert.equal(existsSync(serie), false, `dossier de la série ${serie} laissé après la sortie\n${out}`)
}

describe('harnais — chaque série de tests travaille dans son propre dossier temporaire, et ne touche à rien d\'autre du TMPDIR reçu', function () {
  this.timeout(180000)

  it('test-enclos.sh : un mjs-build.<x> posé dans le TMPDIR reçu PENDANT la série, et un mjs-render-<6 car.> muet depuis 2 h posé avant, survivent ; le dossier de la série est retiré', async function () {
    const tmp      = mjsTmp('serie')
    const received = join(tmp, 't')
    const env      = runEnv(received)
    const old      = join(received, 'mjs-render-Ab12Cd')
    const past     = new Date(Date.now() - 7200000)
    mkdirSync(old)
    writeFileSync(join(old, 'page.html'), '<p>rendu</p>')
    utimesSync(join(old, 'page.html'), past, past)
    utimesSync(old, past, past)
    const { r, foreign, serie } = await foreignDuringRun(tmp, received, (specPath) => launch('bash', [script, '--no-config', '--no-package', specPath], env))
    assert.equal(r.code, 0, r.out)
    assert.ok(existsSync(join(foreign, 'classe.mjs')), `le dossier de la construction voisine (${foreign}) a été vidé sous elle\n${r.out}`)
    assert.ok(existsSync(join(old, 'page.html')), `le dossier muet d'un autre (${old}) a été retiré\n${r.out}`)
    assertSerieGone(serie, received, r.out)
    assert.deepEqual(readdirSync(received).sort(), [basename(foreign), basename(old)].sort(), 'la série a laissé autre chose dans le TMPDIR reçu')
  })

  it('mocha lancé seul avec le crochet commun, comme `npm run test:brut` : un mjs-build.<x> posé pendant la série survit, et la série a eu son dossier, retiré à la fin', async function () {
    const tmp      = mjsTmp('serie')
    const received = join(tmp, 't')
    const env      = runEnv(received)
    delete env.MJS_TEST_RUN_DIR
    const { r, foreign, serie } = await foreignDuringRun(tmp, received, (specPath) => launch(process.execPath, [mocha, '--no-config', '--no-package', '--require', 'tsx/esm', '--require', hook, '--exit', specPath], env))
    assert.equal(r.code, 0, r.out)
    assert.ok(existsSync(join(foreign, 'classe.mjs')), `le dossier de la construction voisine (${foreign}) a été vidé sous elle\n${r.out}`)
    assertSerieGone(serie, received, r.out)
    assert.deepEqual(readdirSync(received).filter((n) => !n.startsWith('tsx-')), [basename(foreign)], 'la série a laissé autre chose dans le TMPDIR reçu que le cache de tsx, chargé avant le crochet')
  })

  it('série tuée par la garde-temps (MJS_TEST_MAXSEC=10 pour 60 s d\'attente) : son dossier part avec elle, le banc qu\'un test y avait ouvert compris', function () {
    const tmp      = mjsTmp('serie')
    const received = join(tmp, 't')
    const seen     = join(tmp, 'tmpdir-vu.txt')
    const r        = runScript(writeSpec(tmp, WAITING(seen, join(tmp, 'jamais'))), runEnv(received, '10'))
    assert.ok(r.code !== null && r.code >= 128, `code ${r.code}, attendu ≥ 128 :\n${r.out}`)
    assert.match(r.out, /garde-temps/)
    assert.ok(existsSync(seen), `le témoin n'a jamais démarré : mocha tué avant de charger la suite ?\n${r.out}`)
    assertSerieGone(readFileSync(seen, 'utf-8'), received, r.out)
    assert.deepEqual(readdirSync(received), [], 'la série tuée a laissé des dossiers dans le TMPDIR reçu')
  })

  it('série en échec : son code de sortie est rendu tel quel, et son dossier retiré', function () {
    const tmp      = mjsTmp('serie')
    const received = join(tmp, 't')
    const seen     = join(tmp, 'tmpdir-vu.txt')
    const r        = runScript(writeSpec(tmp, [
      "import { writeFileSync } from 'node:fs'",
      "import { tmpdir } from 'node:os'",
      "describe('série témoin', function () {",
      "  it('échoue', function () {",
      `    writeFileSync(${JSON.stringify(seen)}, tmpdir())`,
      "    throw new Error('échec voulu')",
      '  })',
      '})',
    ]), runEnv(received))
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /échec voulu/)
    assertSerieGone(readFileSync(seen, 'utf-8'), received, r.out)
    assert.deepEqual(readdirSync(received), [], 'la série en échec a laissé des dossiers dans le TMPDIR reçu')
  })

  it('verrou orphelin d\'un ancien balai, muet depuis 1 h, au numéro d\'un processus vivant d\'ici : il ne bloque plus le ménage, et il reste, n\'étant pas à la série', function () {
    const tmp      = mjsTmp('serie')
    const received = join(tmp, 't')
    const env      = runEnv(received)
    const lock     = join(received, `mjs-sweep-${process.pid}-0badc0de.lock`)
    const past     = new Date(Date.now() - 3600000)
    writeFileSync(lock, String(process.pid))
    utimesSync(lock, past, past)
    const go = join(tmp, 'go')
    writeFileSync(go, '')
    const seen = join(tmp, 'tmpdir-vu.txt')
    const r    = runScript(writeSpec(tmp, WAITING(seen, go)), env)
    assert.equal(r.code, 0, r.out)
    assert.deepEqual(readdirSync(received), [basename(lock)], 'la série a laissé ses dossiers dans le TMPDIR reçu : le verrou orphelin a bloqué son ménage')
    assertSerieGone(readFileSync(seen, 'utf-8'), received, r.out)
  })
})
