// garde du HARNAIS, pas du produit : la file commune de script/test-enclos.sh (MJS_TEST_JETONS runs à la fois pour toute la machine, un
// jeton = un fichier verrouillé par flock sous MJS_TEST_JETONS_DIR, tenu par le script ET par mocha), sa garde calculée (MJS_TEST_MAXSEC=auto :
// 3 × la durée relevée + 60 s, 300 s au moins) et DISPLAY retiré pour mocha. Motif : les tests des aides partaient tous à la fois sur une machine
// de 8 cœurs chargée à 15, des gardes fixes y coupaient du vert, et un DISPLAY hérité privait Chromium de WebGL (faux rouges) ; un script tué
// seul ne doit pas laisser entrer un second run à côté d'un mocha qui tourne encore. Chaque cas lance le vrai script sur une suite témoin, avec
// un dossier de jetons à lui : il ne prend ni ne bloque les jetons des autres runs de la machine

import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const script   = join(repoRoot, 'script', 'test-enclos.sh')
const sleep    = (ms: number) => new Promise((r) => setTimeout(r, ms))

// suite témoin écrite sous le dossier du cas
function prepare(tmp: string, source: string, name = 'temoin.spec.mjs'): string {
  const spec = join(tmp, 'spec', name)
  mkdirSync(dirname(spec), { recursive: true })
  mkdirSync(join(tmp, 'tmp'), { recursive: true })
  writeFileSync(spec, source)
  return spec
}

// réglages du run par-dessus ceux du processus, sauf son réglage de moteurs : le harnais joué sous MJS_MOTEURS=chromium (les voisins d'un lot) le
// passerait aux runs témoins, et le cas « auto » lirait la durée de Chromium là où il attend celle des trois moteurs ; jetons sous le dossier du
// cas, jamais ceux de la machine
function envOf(tmp: string, env: Record<string, string>) {
  const inherited = { ...process.env }
  delete inherited.MJS_MOTEURS
  return { ...inherited, MJS_TEST_MEM: '600M', TMPDIR: join(tmp, 'tmp'), MJS_TEST_JETONS_DIR: join(tmp, 'jetons'), ...env }
}

// le vrai script sur la suite témoin, aucune config implicite (jamais la suite entière)
function runScript(tmp: string, spec: string, env: Record<string, string>) {
  const t0 = Date.now()
  const r  = spawnSync('bash', [script, '--no-config', '--no-package', spec], { cwd: repoRoot, env: envOf(tmp, env), encoding: 'utf-8', timeout: 150000 })
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), ms: Date.now() - t0 }
}

const isFree = (file: string): boolean => spawnSync('flock', ['-n', file, 'true']).status === 0

// vivant = présent et pas zombie (cf. harness-test-enclos-guard.test.ts)
const alive = (pid: number): boolean => {
  try { return !/^\d+ \(.*\) [ZX]/s.test(readFileSync(`/proc/${pid}/stat`, 'utf-8')) }
  catch (e: any) { if(e.code === 'ENOENT') return false; throw e }
}

// un voisin tient le jeton n du dossier pendant `seconds` s (`flock <jeton> sleep`)
async function holdToken(dir: string, n: number, seconds: number): Promise<ChildProcess> {
  mkdirSync(dir, { recursive: true })
  const file  = join(dir, `jeton-${n}`)
  const child = spawn('flock', [file, 'sleep', String(seconds)], { stdio: 'ignore' })
  for(let i = 0; i < 100 && isFree(file); i++) await sleep(50)
  assert.equal(isFree(file), false, `le voisin n'a pas pris ${file}`)
  return child
}

// un run long lancé en tâche de fond : son test note le numéro de mocha, attend `ms`, puis note sa fin
function longRun(tmp: string, ms: number) {
  const pid  = join(tmp, 'mocha.pid')
  const end  = join(tmp, 'premier.fin')
  const run  = join(tmp, 'serie.txt')
  const spec = prepare(tmp, [
    "import { writeFileSync } from 'node:fs'",
    "import { tmpdir } from 'node:os'",
    "describe('run témoin', function () {",
    "  it('long', async function () {",
    '    this.timeout(0)',
    `    writeFileSync(${JSON.stringify(run)}, tmpdir())`,
    `    writeFileSync(${JSON.stringify(pid)}, String(process.pid))`,
    `    await new Promise((r) => setTimeout(r, ${ms}))`,
    `    writeFileSync(${JSON.stringify(end)}, String(Date.now()))`,
    '  })',
    '})',
  ].join('\n'), 'long.spec.mjs')
  const child  = spawn('bash', [script, '--no-config', '--no-package', spec], { cwd: repoRoot, env: envOf(tmp, { MJS_TEST_JETONS: '1', MJS_TEST_MAXSEC: '90' }), stdio: 'ignore' })
  const exited = new Promise<number | null>((r) => child.once('exit', (code) => r(code)))
  const started = async () => {
    for(let i = 0; i < 600 && !existsSync(pid); i++) await sleep(100)
    assert.ok(existsSync(pid), 'mocha n\'a jamais démarré')
    return Number(readFileSync(pid, 'utf-8'))
  }
  return { child, exited, started, end, pid, run }
}

const UNE_SECONDE = "describe('run témoin', function () { it('une seconde', function (done) { setTimeout(done, 1000) }) })"

describe('harnais — test-enclos.sh : file commune (MJS_TEST_JETONS), MJS_TEST_MAXSEC=auto, DISPLAY', function () {
  this.timeout(180000)

  it('jeton tenu 20 s par un voisin, garde de 15 s, test d\'une seconde : le run attend sans que sa garde coure, le dit, puis passe vert', async function () {
    const tmp    = mjsTmp('enclos-jeton-attente')
    const spec   = prepare(tmp, UNE_SECONDE)
    const voisin = await holdToken(join(tmp, 'jetons'), 1, 20)
    try {
      const r = runScript(tmp, spec, { MJS_TEST_JETONS: '1', MJS_TEST_MAXSEC: '15' })
      assert.equal(r.code, 0, r.out)
      assert.match(r.out, /file commune : tous les jetons de la machine sont pris/)
      assert.match(r.out, /jeton 1 sur 1 pris après \d+ s d'attente/)
      assert.ok(r.ms >= 18000, `run fini en ${r.ms} ms : il n'a pas attendu le jeton\n${r.out}`)
      assert.doesNotMatch(r.out, /garde-temps : plus de|run tué/)
    }
    finally {
      voisin.kill('SIGKILL')
    }
  })

  it('MJS_TEST_JETONS=0 : sans file, le run part même si tous les jetons sont pris', async function () {
    const tmp    = mjsTmp('enclos-jeton-sans-file')
    const spec   = prepare(tmp, UNE_SECONDE)
    const voisin = await holdToken(join(tmp, 'jetons'), 1, 40)
    try {
      const r = runScript(tmp, spec, { MJS_TEST_JETONS: '0' })
      assert.equal(r.code, 0, r.out)
      assert.doesNotMatch(r.out, /file commune/)
      assert.ok(r.ms < 35000, `run fini en ${r.ms} ms : il a attendu le jeton\n${r.out}`)
    }
    finally {
      voisin.kill('SIGKILL')
    }
  })

  it('script tué seul (KILL) : mocha garde le jeton, un second run n\'entre qu\'à la fin de ce mocha', async function () {
    const tmp    = mjsTmp('enclos-jeton-tue')
    const run    = longRun(tmp, 8000)
    const debut  = join(tmp, 'second.debut')
    const second = prepare(tmp, `import { writeFileSync } from 'node:fs'\ndescribe('second run', function () { it('note son départ', function () { writeFileSync(${JSON.stringify(debut)}, String(Date.now())) }) })`, 'second.spec.mjs')
    try {
      await run.started()
      run.child.kill('SIGKILL')
      await run.exited
      assert.equal(isFree(join(tmp, 'jetons', 'jeton-1')), false, 'jeton rendu alors que mocha tourne encore')
      const r = runScript(tmp, second, { MJS_TEST_JETONS: '1' })
      assert.equal(r.code, 0, r.out)
      assert.match(r.out, /file commune : tous les jetons de la machine sont pris/)
      assert.ok(existsSync(run.end), 'le premier mocha n\'est pas allé au bout')
      assert.ok(Number(readFileSync(debut, 'utf-8')) >= Number(readFileSync(run.end, 'utf-8')), 'le second run est entré avant la fin du premier mocha')
    }
    finally {
      try { process.kill(Number(readFileSync(run.pid, 'utf-8')), 'SIGKILL') } catch { /* déjà parti */ }
      // tué par KILL, le script n'a pas joué son piège EXIT : son dossier de série reste, à même /tmp quand ce TMPDIR imbriqué est trop long
      // pour la socket de tsx ; ce test le rend
      const serie = existsSync(run.run) ? readFileSync(run.run, 'utf-8') : ''
      if(serie && basename(serie).startsWith('tests-')) rmSync(serie, { recursive: true, force: true })
    }
  })

  it('script arrêté (TERM) : il arrête mocha avant de sortir (code 143), le jeton tombe avec eux', async function () {
    const tmp = mjsTmp('enclos-jeton-term')
    const run = longRun(tmp, 60000)
    try {
      const mocha = await run.started()
      const t0    = Date.now()
      run.child.kill('SIGTERM')
      assert.equal(await run.exited, 143)
      for(let i = 0; i < 50 && alive(mocha); i++) await sleep(100)
      assert.equal(alive(mocha), false, 'mocha a survécu à l\'arrêt du script')
      for(let i = 0; i < 20 && !isFree(join(tmp, 'jetons', 'jeton-1')); i++) await sleep(100)
      assert.equal(isFree(join(tmp, 'jetons', 'jeton-1')), true, 'jeton gardé 2 s après l\'arrêt')
      assert.ok(Date.now() - t0 < 15000, `arrêt en ${Date.now() - t0} ms`)
      assert.equal(existsSync(run.end), false, 'le test long est allé au bout malgré l\'arrêt')
    }
    finally {
      try { process.kill(Number(readFileSync(run.pid, 'utf-8')), 'SIGKILL') } catch { /* déjà parti */ }
      run.child.kill('SIGKILL')
    }
  })

  it('un run lancé par un test passe sans file : pas d\'interblocage avec le jeton que son parent tient', function () {
    const tmp   = mjsTmp('enclos-jeton-imbrique')
    const inner = prepare(tmp, "describe('run imbriqué', function () { it('rien', function () {}) })", 'interieur.spec.mjs')
    const vu    = join(tmp, 'interieur.txt')
    const outer = prepare(tmp, [
      "import { spawnSync } from 'node:child_process'",
      "import { writeFileSync } from 'node:fs'",
      "describe('run témoin', function () {",
      "  it('lance un run sous lui', function () {",
      '    this.timeout(90000)',
      `    const r = spawnSync('bash', [${JSON.stringify(script)}, '--no-config', '--no-package', ${JSON.stringify(inner)}], { encoding: 'utf-8', timeout: 80000 })`,
      `    writeFileSync(${JSON.stringify(vu)}, String(r.status) + '\\n' + r.stdout + r.stderr)`,
      "    if(r.status !== 0) throw new Error('run imbriqué : code ' + r.status)",
      '  })',
      '})',
    ].join('\n'))
    const r = runScript(tmp, outer, { MJS_TEST_JETONS: '1' })
    assert.equal(r.code, 0, `${r.out}\n${existsSync(vu) ? readFileSync(vu, 'utf-8') : '(run imbriqué sans trace)'}`)
    assert.doesNotMatch(readFileSync(vu, 'utf-8'), /file commune/)
  })

  it('MJS_TEST_JETONS illisible : annoncé, run lancé sans file', function () {
    const tmp = mjsTmp('enclos-jeton-illisible')
    const r   = runScript(tmp, prepare(tmp, UNE_SECONDE), { MJS_TEST_JETONS: 'trois' })
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /MJS_TEST_JETONS « trois » illisible/)
  })

  it('dossier des jetons impossible à créer : annoncé, run lancé sans file, ses tests joués', function () {
    const tmp  = mjsTmp('enclos-jeton-dossier')
    const plat = join(tmp, 'un-fichier')
    writeFileSync(plat, '')
    const r = runScript(tmp, prepare(tmp, UNE_SECONDE), { MJS_TEST_JETONS: '1', MJS_TEST_JETONS_DIR: join(plat, 'jetons') })
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /file commune impossible \(.+\) — tests lancés SANS file commune/)
    assert.match(r.out, /1 passing/)
  })

  it('MJS_TEST_MAXSEC=auto : 3 × la durée relevée + 60 s, celle du réglage de moteurs du run d\'abord, 300 s au moins', function () {
    const tmp    = mjsTmp('enclos-maxsec-auto')
    const spec   = prepare(tmp, "describe('run témoin', function () { it('rien', function () {}) })", 'temoin.test.ts')
    const trace  = join(tmp, 'releve')
    const releve = (ms: Record<string, number>) => writeFileSync(join(trace, 'releve.json'), JSON.stringify({ version: 1, files: { [spec]: { ms } } }))
    mkdirSync(trace, { recursive: true })
    releve({ tous: 200000, chromium: 100000 })
    const tous = runScript(tmp, spec, { MJS_TEST_MAXSEC: 'auto', MJS_TEST_TRACE: trace, MJS_TEST_JETONS: '0' })
    assert.equal(tous.code, 0, tous.out)
    assert.match(tous.out, /MJS_TEST_MAXSEC=auto : 3 × 200 s .*→ 660 s/)
    const chromium = runScript(tmp, spec, { MJS_TEST_MAXSEC: 'auto', MJS_TEST_TRACE: trace, MJS_TEST_JETONS: '0', MJS_MOTEURS: 'chromium' })
    assert.equal(chromium.code, 0, chromium.out)
    assert.match(chromium.out, /MJS_TEST_MAXSEC=auto : 3 × 100 s .*→ 360 s/)
    releve({ tous: 10000 })
    const court = runScript(tmp, spec, { MJS_TEST_MAXSEC: 'auto', MJS_TEST_TRACE: trace, MJS_TEST_JETONS: '0' })
    assert.equal(court.code, 0, court.out)
    assert.match(court.out, /MJS_TEST_MAXSEC=auto : 3 × 10 s .*→ 300 s/)
  })

  it('DISPLAY retiré pour mocha (et annoncé), gardé avec MJS_TEST_DISPLAY=1', function () {
    const tmp  = mjsTmp('enclos-display')
    const vu   = join(tmp, 'display.txt')
    const spec = prepare(tmp, `import { writeFileSync } from 'node:fs'\ndescribe('run témoin', function () { it('lit DISPLAY', function () { writeFileSync(${JSON.stringify(vu)}, process.env.DISPLAY ?? '(absent)') }) })`)
    const sans = runScript(tmp, spec, { DISPLAY: ':99', MJS_TEST_JETONS: '0' })
    assert.equal(sans.code, 0, sans.out)
    assert.equal(readFileSync(vu, 'utf-8'), '(absent)')
    assert.match(sans.out, /DISPLAY=:99 retiré pour mocha/)
    const garde = runScript(tmp, spec, { DISPLAY: ':99', MJS_TEST_DISPLAY: '1', MJS_TEST_JETONS: '0' })
    assert.equal(garde.code, 0, garde.out)
    assert.equal(readFileSync(vu, 'utf-8'), ':99')
  })
})
