// garde de l'OUTIL des tests liés (script/related-tests.ts), pas du produit : sur un relevé fabriqué, il choisit les
// tests qui lisent ou importent un fichier changé, le test changé lui-même et ceux sans relevé (signalés) ; pour un
// fichier du cœur, d'un effet ou du runtime, ceux que leur nom désigne puis ceux qui le citent passent devant les liens
// du relevé ; le budget coupe par la fin de l'ordre (« non joué ») en gardant un échantillon par famille ; un rouge se
// rejoue SEUL, après la passe, par priorité, avant d'être cru, et un budget trop court pour rejouer le dit

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { selectTests, planRun, executeRun, buildGraph, distancesTo, familyOf, replayWarning, type TestInfo, type Candidate, type LaneResult } from '../script/related-tests.js'
import { mergeFragment, traceDir, type TraceEntry } from './helpers/test-trace.js'

const info = (file: string, kind: TestInfo['kind'] = 'statique', source = ''): TestInfo => ({ file, kind, cli: false, family: familyOf(file, new Map([['core', 99]])), engines: undefined, source })

const traced = (reads: string[], ms = 1000): TraceEntry => ({ at: '2026-10-26T10:00:00.000Z', ms: { chromium: ms }, reads, dirs: [], spawns: [], tests: 1, failures: 0, pending: 0, skippedEngines: {} })

const cand = (file: string, ms: number, family: string, level: Candidate['level'] = 3): Candidate => ({ file, level, why: '', traced: true, ms, family, kind: 'statique' })

describe('tests liés : le choix sur un relevé fabriqué', function () {
  const tests = [info('tests/for-a.test.ts'), info('tests/if-b.test.ts'), info('tests/ws-c.test.ts'), info('tests/neuf-d.test.ts')]
  const trace = new Map<string, TraceEntry>([
    ['tests/for-a.test.ts', traced(['src/runtime/mjs_for.ts', 'src/runtime/mjs_core.ts'])],
    ['tests/if-b.test.ts', traced(['src/runtime/mjs_if.ts', 'src/runtime/mjs_core.ts'])],
    ['tests/ws-c.test.ts', traced([])]
  ])

  it('un fichier lu pendant le test le lie ; un test qui ne le lit pas n\'est pas choisi', function () {
    const chosen = selectTests({ tests, changes: [{ file: 'src/runtime/mjs_for.ts', state: 'modifié' }], trace, reach: new Map(), engines: 'chromium' })
    const lies   = chosen.filter((c) => c.traced).map((c) => c.file)
    assert.deepEqual(lies, ['tests/for-a.test.ts'])
    assert.equal(chosen.find((c) => c.file === 'tests/for-a.test.ts')!.level, 1, 'son nom porte « for » : il vise mjs_for.ts')
    assert.match(chosen.find((c) => c.file === 'tests/for-a.test.ts')!.why, /mjs_for\.ts/)
  })

  it('le test changé lui-même est choisi en tête', function () {
    const chosen = selectTests({ tests, changes: [{ file: 'tests/ws-c.test.ts', state: 'modifié' }], trace, reach: new Map(), engines: 'chromium' })
    assert.deepEqual(chosen.filter((c) => c.level === 0).map((c) => c.file), ['tests/ws-c.test.ts'])
  })

  it('un test sans relevé est choisi et signalé', function () {
    const chosen = selectTests({ tests, changes: [{ file: 'src/runtime/mjs_for.ts', state: 'modifié' }], trace, reach: new Map(), engines: 'chromium' })
    const neuf   = chosen.find((c) => c.file === 'tests/neuf-d.test.ts')
    assert.ok(neuf, 'le test sans relevé doit être choisi')
    assert.equal(neuf!.traced, false)
    assert.equal(neuf!.level, 5)
    assert.match(neuf!.why, /sans relevé/)
  })

  it('aucun relevé du tout : chaque test est choisi, signalé sans relevé', function () {
    const chosen = selectTests({ tests, changes: [{ file: 'src/runtime/mjs_for.ts', state: 'modifié' }], trace: new Map(), reach: new Map(), engines: 'chromium' })
    assert.equal(chosen.length, tests.length)
    assert.ok(chosen.every((c) => !c.traced && /sans relevé/.test(c.why)))
  })

  it('un lien par le graphe des imports compte aussi, direct ou à distance', function () {
    const reach  = new Map([['tests/ws-c.test.ts', { d: 0, from: 'src/mjs-ws/streams.ts' }], ['tests/if-b.test.ts', { d: 2, from: 'src/mjs-ws/streams.ts' }]])
    const chosen = selectTests({ tests, changes: [{ file: 'src/mjs-ws/streams.ts', state: 'modifié' }], trace, reach, engines: 'chromium' })
    assert.equal(chosen.find((c) => c.file === 'tests/ws-c.test.ts')!.level, 3)
    assert.equal(chosen.find((c) => c.file === 'tests/if-b.test.ts')!.level, 4)
    assert.equal(chosen.find((c) => c.file === 'tests/for-a.test.ts'), undefined)
  })

  it('un fichier lu, hors du cœur, des effets et du runtime : le lien du relevé, sans visée', function () {
    const chosen = selectTests({ tests: [info('tests/ws-c.test.ts', 'statique', "import '../src/mjs-ws/streams.js'")], changes: [{ file: 'src/mjs-ws/streams.ts', state: 'modifié' }], trace: new Map([['tests/ws-c.test.ts', traced(['src/mjs-ws/streams.ts'])]]), reach: new Map(), engines: 'chromium' })
    assert.equal(chosen[0].level, 3)
  })

  it('un relevé fusionné garde l\'union des lectures et la durée du dernier passage complet', function () {
    const store = new Map<string, TraceEntry>()
    mergeFragment(store, { version: 1, engines: 'tous', partial: false, end: '2026-10-26T10:00:00.000Z', files: { 'tests/for-a.test.ts': { ms: 9000, done: true, tests: 3, failures: 0, pending: 0, failed: [], skippedEngines: {}, reads: ['src/a.ts'], dirs: [], spawns: [] } } })
    mergeFragment(store, { version: 1, engines: 'chromium', partial: false, end: '2026-10-26T11:00:00.000Z', files: { 'tests/for-a.test.ts': { ms: 4000, done: true, tests: 3, failures: 0, pending: 1, failed: [], skippedEngines: { firefox: 1 }, reads: ['src/b.ts'], dirs: [], spawns: [] }, '/tmp/x/fixture.test.ts': { ms: 1, done: true, tests: 1, failures: 0, pending: 0, failed: [], skippedEngines: {}, reads: [], dirs: [], spawns: [] } } })
    const e = store.get('tests/for-a.test.ts')!
    assert.deepEqual(e.reads, ['src/a.ts', 'src/b.ts'])
    assert.deepEqual(e.ms, { tous: 9000, chromium: 4000 })
    assert.equal(store.has('/tmp/x/fixture.test.ts'), false, 'un fichier hors de tests/ n\'entre pas au relevé')
  })
})

describe('tests liés : un fichier du cœur, d\'un effet ou du runtime — les tests qui le visent d\'abord', function () {
  const change = (file: string) => [{ file, state: 'modifié' as const }]
  const select = 'src/core-modules/select.mjs'
  // le constructeur du Bundler lit tous les modules du cœur : presque tout test relevé « lit » select.mjs
  const lit    = traced([select, 'src/core-modules/option.mjs'], 500)
  const tests  = [
    info('tests/bundler-e.test.ts', 'compile'),
    info('tests/core-select-b-browser.test.ts', 'navigateur'),
    info('tests/form-c.test.ts', 'statique', 'const src = \'<@@select name="pays">\''),
    info('tests/vue-d.test.ts', 'statique', "readFileSync(new URL('../src/core-modules/select.mjs', import.meta.url))"),
    info('tests/core-select-a.test.ts', 'compile'),
    info('tests/autre-f.test.ts', 'statique', '<@@selection> reselect.mjs select'),
    info('tests/core-option-g.test.ts', 'compile', '<@@option>'),
    info('tests/for-select-h.test.ts', 'statique', '<select><option>')
  ]
  const trace  = new Map<string, TraceEntry>([
    ['tests/bundler-e.test.ts', lit],
    ['tests/core-select-b-browser.test.ts', traced([select], 20000)],
    ['tests/form-c.test.ts', lit],
    ['tests/autre-f.test.ts', lit],
    ['tests/core-option-g.test.ts', traced(['src/core-modules/option.mjs'])]
  ])

  it('nommés (core-select-…), puis cités (<@@select>, le chemin du fichier), puis les liens du relevé ; un nom voisin ne vise pas', function () {
    const chosen = selectTests({ tests, changes: change(select), trace, reach: new Map(), engines: 'chromium' })
    const level  = (f: string) => chosen.find((c) => c.file === f)?.level
    assert.equal(level('tests/core-select-a.test.ts'), 1, 'sans relevé, mais son nom désigne select.mjs')
    assert.equal(level('tests/core-select-b-browser.test.ts'), 1)
    assert.equal(level('tests/form-c.test.ts'), 2, 'la balise <@@select>')
    assert.equal(level('tests/vue-d.test.ts'), 2, 'le chemin du fichier')
    assert.equal(level('tests/bundler-e.test.ts'), 3, 'il le lit seulement')
    assert.equal(level('tests/autre-f.test.ts'), 3, '<@@selection>, reselect.mjs : pas select.mjs')
    assert.equal(level('tests/core-option-g.test.ts'), undefined)
    assert.equal(level('tests/for-select-h.test.ts'), 5, 'la balise <select> du HTML : pas le module du cœur, il n\'est ni nommé ni cité')
    assert.match(chosen.find((c) => c.file === 'tests/form-c.test.ts')!.why, /cite src\/core-modules\/select\.mjs \(« <@@select »\)/)
  })

  it('le budget garde les nommés et les cités en tête, et coupe par la fin de l\'ordre', function () {
    const chosen = selectTests({ tests, changes: change(select), trace, reach: new Map(), engines: 'chromium' })
    const plan   = planRun(chosen, { budgetMs: 31500, lanes: 1, overheadMs: 0 })
    assert.deepEqual(plan.played.map((c) => c.file), ['tests/core-select-a.test.ts', 'tests/core-select-b-browser.test.ts', 'tests/form-c.test.ts', 'tests/vue-d.test.ts'])
    assert.deepEqual(plan.notPlayed.map((c) => c.file), ['tests/autre-f.test.ts', 'tests/bundler-e.test.ts', 'tests/for-select-h.test.ts'])
  })

  it('runtime : mjs_every cité sans extension (import en .js) ; mjs_for.ts ne vise ni mjs_for_nested ni mjs_form_reset', function () {
    const t = [info('tests/zz-a.test.ts', 'statique', "import '../src/runtime/mjs_every.js'"), info('tests/zz-b.test.ts', 'statique', "lit('src/runtime/mjs_for_nested.ts') ; mjs_form_reset")]
    const every = selectTests({ tests: t, changes: change('src/runtime/mjs_every.ts'), trace: new Map(t.map((x) => [x.file, traced([])])), reach: new Map(), engines: 'chromium' })
    assert.deepEqual(every.map((c) => [c.file, c.level]), [['tests/zz-a.test.ts', 2]])
    const pour = selectTests({ tests: t, changes: change('src/runtime/mjs_for.ts'), trace: new Map(t.map((x) => [x.file, traced([])])), reach: new Map(), engines: 'chromium' })
    assert.deepEqual(pour, [])
  })

  it('effet : `*liquid` dans un gabarit cite src/runtime/mjs_fx_liquid.ts ; une multiplication ne le cite pas', function () {
    const t = [info('tests/effets-liquide-x.test.ts', 'statique', '<div *liquid="fort">'), info('tests/calcul-y.test.ts', 'statique', 'const v = a*liquid')]
    const chosen = selectTests({ tests: t, changes: change('src/runtime/mjs_fx_liquid.ts'), trace: new Map(t.map((x) => [x.file, traced([])])), reach: new Map(), engines: 'chromium' })
    assert.deepEqual(chosen.map((c) => [c.file, c.level]), [['tests/effets-liquide-x.test.ts', 2]])
  })
})

describe('tests liés : le budget', function () {
  it('ce qui ne tient pas dans le budget est « non joué », du plus court au plus long', function () {
    const chosen = [cand('tests/d.test.ts', 100000, 'd'), cand('tests/b.test.ts', 30000, 'b'), cand('tests/c.test.ts', 50000, 'c'), cand('tests/a.test.ts', 10000, 'a')]
    const plan   = planRun(chosen, { budgetMs: 100000, lanes: 1, overheadMs: 0 })
    assert.deepEqual(plan.played.map((c) => c.file), ['tests/a.test.ts', 'tests/b.test.ts'])
    assert.deepEqual(plan.notPlayed.map((c) => c.file).sort(), ['tests/c.test.ts', 'tests/d.test.ts'])
  })

  it('budget dépassé : un échantillon par famille passe avant le deuxième test d\'une même famille', function () {
    const chosen = [cand('tests/a1.test.ts', 1000, 'a'), cand('tests/a2.test.ts', 2000, 'a'), cand('tests/a3.test.ts', 3000, 'a'), cand('tests/b1.test.ts', 5000, 'b')]
    const plan   = planRun(chosen, { budgetMs: 8750, lanes: 1, overheadMs: 0 })
    assert.deepEqual(plan.played.map((c) => c.file), ['tests/a1.test.ts', 'tests/b1.test.ts'])
  })

  it('la priorité passe avant la durée, et le budget coupe par la fin de l\'ordre : un test d\'après ne passe pas devant un test d\'avant', function () {
    const chosen = [cand('tests/loin.test.ts', 1500, 'x', 4), cand('tests/sans.test.ts', 500, 'y', 5), cand('tests/direct.test.ts', 4000, 'z', 3), cand('tests/change.test.ts', 3000, 'w', 0)]
    const plan   = planRun(chosen, { budgetMs: 10000, lanes: 1, overheadMs: 0 })
    assert.deepEqual(plan.played.map((c) => c.file), ['tests/change.test.ts', 'tests/direct.test.ts'])
    assert.deepEqual(plan.notPlayed.map((c) => c.file), ['tests/loin.test.ts', 'tests/sans.test.ts'], 'sans.test.ts tiendrait, mais loin.test.ts passe avant lui')
  })

  it('un test plus long qu\'une voie entière est mis de côté sans arrêter la suite', function () {
    const chosen = [cand('tests/a.test.ts', 1000, 'a', 1), cand('tests/geant.test.ts', 90000, 'g', 1), cand('tests/b.test.ts', 2000, 'b', 3)]
    const plan   = planRun(chosen, { budgetMs: 10000, lanes: 1, overheadMs: 0 })
    assert.deepEqual(plan.played.map((c) => c.file), ['tests/a.test.ts', 'tests/b.test.ts'])
    assert.deepEqual(plan.notPlayed.map((c) => c.file), ['tests/geant.test.ts'])
    assert.ok(plan.notPlayed[0].ms > plan.cap)
  })

  it('plusieurs voies : la charge se répartit, chaque voie reste sous le budget', function () {
    const chosen = [1, 2, 3, 4, 5, 6].map((i) => cand(`tests/t${i}.test.ts`, 3000, `f${i}`))
    const plan   = planRun(chosen, { budgetMs: 10000, lanes: 3, overheadMs: 1000 })
    assert.equal(plan.played.length, 6)
    assert.deepEqual(plan.lanes.map((l) => l.length), [2, 2, 2])
  })
})

describe('tests liés : un rouge se rejoue seul avant d\'être cru', function () {
  const done = (failures: number) => ({ done: true, failures, failed: failures ? ['un test'] : [], tests: 1, pending: 0, skippedEngines: {} })

  it('rouge sous charge puis vert seul : instable ; rouge deux fois : confirmé ; le rejeu ne joue qu\'un fichier, après la passe', async function () {
    const calls: Array<{ files: string[], at: number }> = []
    let clock = 0
    const runner = async (job: { files: string[] }): Promise<LaneResult> => {
      calls.push({ files: job.files, at: clock++ })
      const solo  = job.files.length === 1
      const files: LaneResult['files'] = {}
      for (const f of job.files) files[f] = f === 'tests/x.test.ts' ? done(solo ? 0 : 1) : f === 'tests/z.test.ts' ? done(1) : done(0)
      return { code: Object.values(files).some((r) => r.failures) ? 1 : 0, killed: false, files, log: '' }
    }
    const plan    = { lanes: [[cand('tests/x.test.ts', 1000, 'x'), cand('tests/y.test.ts', 1000, 'y')], [cand('tests/z.test.ts', 1000, 'z')]] }
    const outcome = await executeRun(plan, { runner, mainDeadline: Date.now() + 60000, endDeadline: Date.now() + 60000, overheadMs: 0 })
    assert.equal(outcome.status.get('tests/y.test.ts'), 'vert')
    assert.equal(outcome.status.get('tests/x.test.ts'), 'instable')
    assert.equal(outcome.status.get('tests/z.test.ts'), 'rouge')
    const replays = calls.slice(2)
    assert.deepEqual(replays.map((c) => c.files), [['tests/x.test.ts'], ['tests/z.test.ts']])
    assert.ok(replays.every((c) => c.at >= 2), 'les rejeux partent après les deux voies')
  })

  it('plus de temps pour rejouer : le rouge reste « non rejoué », jamais cru vert, avec le temps qui restait et celui qu\'il fallait', async function () {
    const runner = async (job: { files: string[] }): Promise<LaneResult> => ({ code: 1, killed: false, files: Object.fromEntries(job.files.map((f) => [f, done(1)])), log: '' })
    const plan    = { lanes: [[cand('tests/x.test.ts', 60000, 'x')]] }
    const outcome = await executeRun(plan, { runner, mainDeadline: Date.now() + 1000, endDeadline: Date.now() + 1000, overheadMs: 0 })
    assert.equal(outcome.status.get('tests/x.test.ts'), 'rouge non rejoué')
    assert.equal(outcome.short.get('tests/x.test.ts')?.need, 60000)
    assert.ok(outcome.short.get('tests/x.test.ts')!.left <= 1000)
  })

  it('les rouges se rejouent par ordre de priorité, celui du plan, pas par voie', async function () {
    const order: string[] = []
    const runner = async (job: { files: string[], name: string }): Promise<LaneResult> => {
      if (job.name.startsWith('rejeu')) order.push(job.files[0])
      return { code: 1, killed: false, files: Object.fromEntries(job.files.map((f) => [f, done(1)])), log: '' }
    }
    const haut = cand('tests/core-select-haut.test.ts', 1000, 'core-select', 1)
    const bas  = cand('tests/bundler-bas.test.ts', 1000, 'bundler', 3)
    await executeRun({ lanes: [[bas], [haut]], played: [haut, bas] }, { runner, mainDeadline: Date.now() + 60000, endDeadline: Date.now() + 60000, overheadMs: 0 })
    assert.deepEqual(order, ['tests/core-select-haut.test.ts', 'tests/bundler-bas.test.ts'])
  })

  it('un budget trop court pour rejouer le dit, avec le budget qui en laisse la place', function () {
    const played = [cand('tests/a.test.ts', 1000, 'a')]
    const court  = replayWarning(90, played)
    assert.ok(court, 'budget de 90 s : 9 s après la coupe, 5 s de marge, il reste 4 s, moins qu\'un démarrage de mocha')
    assert.match(court!, /budget trop court/)
    assert.match(court!, /--budget (\d+) au moins/)
    const least = Number(/--budget (\d+) au moins/.exec(court!)![1])
    assert.equal(replayWarning(least, played), null, 'le budget proposé laisse la place d\'un rejeu')
    assert.equal(replayWarning(300, played), null)
  })

  it('une voie coupée à l\'échéance : ses fichiers inachevés sont « interrompu »', async function () {
    const runner = async (job: { files: string[] }): Promise<LaneResult> => ({ code: 143, killed: true, files: { [job.files[0]]: done(0) }, log: '' })
    const plan    = { lanes: [[cand('tests/a.test.ts', 1000, 'a'), cand('tests/b.test.ts', 1000, 'b')]] }
    const outcome = await executeRun(plan, { runner, mainDeadline: Date.now() + 60000, endDeadline: Date.now() + 60000, overheadMs: 0 })
    assert.equal(outcome.status.get('tests/a.test.ts'), 'vert')
    assert.equal(outcome.status.get('tests/b.test.ts'), 'interrompu')
  })
})

describe('tests liés : le graphe statique des imports', function () {
  it('imports relatifs résolus en .ts, `import type` ignoré, import sur plusieurs lignes, lecture littérale d\'un fichier de src/', function () {
    const root = mjsTmp('tests-lies-graphe')
    mkdirSync(join(root, 'src', 'runtime'), { recursive: true })
    mkdirSync(join(root, 'tests', 'helpers'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.ts'), "import { b } from './b.js'\nimport type { C } from './c.js'\nimport {\n  d1,\n  d2\n} from './d.js'\nexport const a = b + d1 + d2\n")
    writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 1\n')
    writeFileSync(join(root, 'src', 'c.ts'), 'export type C = number\n')
    writeFileSync(join(root, 'src', 'd.ts'), 'export const d1 = 1, d2 = 2\n')
    writeFileSync(join(root, 'src', 'runtime', 'r.ts'), 'µ.r = 1\n')
    writeFileSync(join(root, 'tests', 'helpers', 'aide.ts'), "export { a } from '../../src/a.js'\n")
    writeFileSync(join(root, 'tests', 'x.test.ts'), "import { a } from './helpers/aide.js'\nconst texte = readFileSync(new URL('../src/runtime/r.ts', import.meta.url), 'utf-8')\n")
    const graph = buildGraph(root)
    assert.equal(distancesTo(graph, ['src/a.ts']).get('tests/x.test.ts')?.d, 0, 'importé par une aide du test : lien direct')
    assert.equal(distancesTo(graph, ['src/b.ts']).get('tests/x.test.ts')?.d, 1, 'un pas dans src/ : lien à distance')
    assert.equal(distancesTo(graph, ['src/d.ts']).get('tests/x.test.ts')?.d, 1)
    assert.equal(distancesTo(graph, ['src/c.ts']).get('tests/x.test.ts'), undefined, 'un import de type seul ne lie pas')
    assert.equal(distancesTo(graph, ['src/runtime/r.ts']).get('tests/x.test.ts')?.d, 0, 'lecture littérale du fichier')
  })

  it('famille : le premier mot du nom, ou les deux premiers quand le premier est trop répandu', function () {
    const counts = new Map([['core', 221], ['for', 33]])
    assert.equal(familyOf('tests/core-select-sticky-browser.test.ts', counts), 'core-select')
    assert.equal(familyOf('tests/for-filtre-objet-recharge-browser.test.ts', counts), 'for')
  })
})

describe('tests liés : où vit le relevé', function () {
  it('node_modules/.cache/mjs-tests de l\'arbre ; MJS_TEST_TRACE le déplace, « 0 » l\'éteint ; une copie dont node_modules est un lien n\'écrit pas chez le prêteur', function () {
    const root = mjsTmp('tests-lies-dossier')
    mkdirSync(join(root, 'node_modules'))
    assert.equal(traceDir(root, {}), join(root, 'node_modules', '.cache', 'mjs-tests'))
    assert.equal(traceDir(root, { MJS_TEST_TRACE: '/ailleurs/releve' }), '/ailleurs/releve')
    assert.equal(traceDir(root, { MJS_TEST_TRACE: '0' }), null)
    const copie = mjsTmp('tests-lies-copie')
    symlinkSync(join(root, 'node_modules'), join(copie, 'node_modules'))
    assert.equal(traceDir(copie, {}), null)
  })
})

describe('tests liés : lancés par npm', function () {
  this.timeout(60000)

  // le noyau refuse un chemin de socket Unix de plus de 107 octets : un lanceur qui ouvre la sienne sous TMPDIR
  // (`tsx-<uid>/<pid>.pipe`) tombe en `listen EINVAL` avant même d'appeler l'enclos, qui sait, lui, prendre un dossier court
  it('sous un TMPDIR trop long pour une socket Unix, `npm run test:lies` démarre et répond', function () {
    const racine = join(dirname(fileURLToPath(import.meta.url)), '..')
    const long   = join(mjsTmp('tests-lies-tmpdir-long'), 'un-dossier-temporaire-dont-le-nom-suffit-a-depasser-la-limite-des-sockets-unix')
    mkdirSync(long, { recursive: true })
    assert.ok(Buffer.byteLength(long) > 107, `le TMPDIR du cas doit dépasser 107 octets : ${long}`)
    const r = spawnSync('npm', ['run', '--silent', 'test:lies', '--', '--aide'], { cwd: racine, env: { ...process.env, TMPDIR: long }, encoding: 'utf-8' })
    assert.equal(r.status, 0, `code ${r.status}\n${r.stderr}`)
    assert.match(r.stdout, /npm run test:lies -- \[fichiers changés/)
  })
})
