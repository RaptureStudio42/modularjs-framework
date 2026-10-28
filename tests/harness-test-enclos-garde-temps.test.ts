// garde du HARNAIS, pas du produit : script/test-enclos.sh, avec ou sans systemd utilisateur. MJS_TEST_MAXSEC (garde-temps du run, en
// secondes) ne valait que sous l'enclos cgroup : sans systemd (CI, conteneur, bac à sable), un run trop long n'était arrêté par rien ; la
// garde de repli tue désormais l'arbre de mocha au-delà de la limite, plafond mémoire ou non. Un TMPDIR trop long pour une socket Unix
// (107 octets au plus, celle de tsx comprise : `tsx-<uid>/<pid>.pipe`) faisait échouer par `listen EINVAL` chaque test qui lance tsx ;
// le run prend un dossier court à lui sous /tmp, le dit, et le retire à la fin. Chaque cas lance le vrai script sur une suite témoin,
// dans un TMPDIR à lui ; là où l'enclos cgroup existe, c'est lui qui arrête le run trop long : les assertions valent pour les deux
// chemins, sauf la limite illisible

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const script   = join(repoRoot, 'script', 'test-enclos.sh')
const tsx      = join(repoRoot, 'node_modules', '.bin', 'tsx')

// suite témoin passée au vrai script, aucune config implicite (jamais la suite entière)
function runScript(tmp: string, source: string, env: { mem: string, maxsec: string, tmpdir: string }) {
  const specPath = join(tmp, 'spec', 'temoin.spec.mjs')
  mkdirSync(dirname(specPath), { recursive: true })
  mkdirSync(env.tmpdir, { recursive: true })
  writeFileSync(specPath, source)
  const t0 = Date.now()
  const r  = spawnSync('bash', [script, '--no-config', '--no-package', specPath], { cwd: repoRoot, env: { ...process.env, MJS_TEST_MEM: env.mem, MJS_TEST_MAXSEC: env.maxsec, TMPDIR: env.tmpdir }, encoding: 'utf-8', timeout: 120000 })
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), ms: Date.now() - t0 }
}

// vivant = présent et pas zombie (cf. harness-test-enclos-guard.test.ts)
const alive = (pid: number): boolean => {
  try { return !/^\d+ \(.*\) [ZX]/s.test(readFileSync(`/proc/${pid}/stat`, 'utf-8')) }
  catch (e: any) { if(e.code === 'ENOENT') return false; throw e }
}

const enclosAvailable = (): boolean => spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--', '/bin/true'], { stdio: 'ignore' }).status === 0

const TROP_LONG = (pidFile: string) => [
  "import { spawn } from 'node:child_process'",
  "import { writeFileSync } from 'node:fs'",
  'const sleep = (ms) => new Promise((r) => setTimeout(r, ms))',
  "describe('run témoin', function () {",
  "  it('trop long', async function () {",
  '    this.timeout(0)',
  "    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 90000)'], { stdio: 'ignore' })",
  `    writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
  '    await sleep(60000)',
  '  })',
  '})',
].join('\n')

describe('harnais — test-enclos.sh : MJS_TEST_MAXSEC et TMPDIR long, enclos cgroup ou non', function () {
  this.timeout(180000)

  it('run plus long que MJS_TEST_MAXSEC (10 s pour 60 s d\'attente, de quoi démarrer mocha sur une machine chargée) : tué bien avant la fin, son enfant avec lui', function () {
    const tmp = mjsTmp('enclos-temps')
    const pid = join(tmp, 'enfant.pid')
    const r   = runScript(tmp, TROP_LONG(pid), { mem: '600M', maxsec: '10', tmpdir: join(tmp, 'tmp') })
    assert.ok(r.code !== null && r.code >= 128, `code ${r.code}, attendu ≥ 128 :\n${r.out}`)
    assert.ok(r.ms < 40000, `run arrêté en ${r.ms} ms : la garde-temps n'a rien arrêté\n${r.out}`)
    assert.match(r.out, /garde-temps/)
    assert.ok(existsSync(pid), `le témoin n'a jamais démarré : mocha tué avant de charger la suite ?\n${r.out}`)
    const enfant = Number(readFileSync(pid, 'utf-8'))
    assert.equal(alive(enfant), false, `l'enfant ${enfant} a survécu au run`)
  })

  it('sans plafond mémoire (MJS_TEST_MEM=infinity), MJS_TEST_MAXSEC tient encore', function () {
    const tmp = mjsTmp('enclos-temps-infini')
    const r   = runScript(tmp, TROP_LONG(join(tmp, 'enfant.pid')), { mem: 'infinity', maxsec: '10', tmpdir: join(tmp, 'tmp') })
    assert.ok(r.code !== null && r.code >= 128, `code ${r.code}, attendu ≥ 128 :\n${r.out}`)
    assert.ok(r.ms < 40000, `run arrêté en ${r.ms} ms : la garde-temps n'a rien arrêté\n${r.out}`)
    assert.match(r.out, /garde-temps/)
  })

  it('sans enclos, MJS_TEST_MAXSEC illisible : annoncé, run lancé quand même', function () {
    if(enclosAvailable()) this.skip()
    const tmp = mjsTmp('enclos-temps-illisible')
    const r   = runScript(tmp, "describe('run témoin', function () { it('rien', function () {}) })", { mem: '600M', maxsec: 'cinq-minutes', tmpdir: join(tmp, 'tmp') })
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /MJS_TEST_MAXSEC « cinq-minutes » illisible/)
  })

  it('TMPDIR trop long pour une socket Unix : tsx démarre quand même, le dossier court est annoncé puis retiré', function () {
    const tmp    = mjsTmp('enclos-tmpdir-long')
    const long   = join(tmp, 'tmp-' + 'x'.repeat(90))
    const vu     = join(tmp, 'tmpdir-vu.txt')
    const r      = runScript(tmp, [
      "import { spawnSync } from 'node:child_process'",
      "import { writeFileSync } from 'node:fs'",
      "import { tmpdir } from 'node:os'",
      "describe('run témoin', function () {",
      "  it('tsx ouvre sa socket sous TMPDIR', function () {",
      '    this.timeout(60000)',
      `    writeFileSync(${JSON.stringify(vu)}, tmpdir())`,
      `    const r = spawnSync(${JSON.stringify(tsx)}, ['-e', "console.log('tsx ok')"], { encoding: 'utf-8' })`,
      "    if(r.status !== 0 || !r.stdout.includes('tsx ok')) throw new Error('tsx : code ' + r.status + '\\n' + r.stderr)",
      '  })',
      '})',
    ].join('\n'), { mem: '600M', maxsec: '0', tmpdir: long })
    assert.ok(Buffer.byteLength(long) + '/tsx-1000/4194304.pipe'.length > 107, 'le TMPDIR du cas doit être trop long')
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /TMPDIR trop long pour une socket Unix/)
    const court = readFileSync(vu, 'utf-8')
    assert.ok(court !== long && Buffer.byteLength(court) + '/tsx-4294967295/4194304.pipe'.length <= 107, `dossier pris : ${court}`)
    assert.ok(r.out.includes(court), `dossier court non annoncé (${court}) :\n${r.out}`)
    assert.equal(existsSync(court), false, `dossier court ${court} laissé après le run`)
  })
})
