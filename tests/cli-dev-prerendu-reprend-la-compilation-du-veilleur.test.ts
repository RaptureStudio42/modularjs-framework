// `mjs dev` d'un projet qui prérend ses pages : chaque passe de prérendu rend sur la compilation que le veilleur vient de faire, sans
// recompiler le projet dans un second Bundler — au premier passage comme après un enregistrement, les pages écrites à jour. Un
// enregistrement fait pendant qu'une passe tourne attend la fin de cette passe pour compiler : aucune page n'est rendue sur une compilation
// à moitié écrite. En `js: 'bundle'`, le moteur de rendu compile à part, dans son dossier de travail, comme avant.
// La vraie commande (`bin/mjs`, qui charge dist/cli.js) dans un sous-processus ; un module chargé avant elle (`--import`) écrit sur sa
// sortie le début et la fin de chaque appel de `Bundler.prototype.compile`, avec le numéro de son Bundler : une seule sortie, dans l'ordre
// où les choses arrivent, avec les lignes des pages rendues (`✓ /…`)

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { assertDistFrais } from './helpers/dist-frais.js'
import { createDevPrerenderScheduler } from '../src/cli/dev-prerender.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const MJS      = join(repoRoot, 'bin', 'mjs')

// page d'accueil : son `{await}` retient le rendu `delay` millisecondes (cf. settleRender), une passe dure donc assez pour qu'un
// enregistrement tombe pendant elle (la minuterie dans le script de module, comme le test du `{await}` rendu au serveur)
function accueil(titre: string, delay: number): string {
  return `<script module lang="coffee">\nlater = (value, ms) -> new Promise((done) -> setTimeout((-> done(value)), ms))\n</script>\n<script lang="coffee">\n$titre = '${titre}'\n$p = later 'servi', ${delay}\n</script>\n<h1 class="t">{$titre}</h1>\n{await $p}<span class="w">attente</span>{success v}<span class="v">{v}</span>{end}\n<mjs-carte></mjs-carte>\n`
}

function carte(texte: string): string {
  return `<div class="c">\n  <p>${texte}</p>\n</div>\n`
}

// deux routes prérendues par happy-dom, la première lente
function projet(prefix: string, js: 'split' | 'bundle', delay: number): string {
  const root = mjsTmp(prefix)
  const src  = join(root, 'app', 'modularjs')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'accueil.mjs'), accueil('Accueil v1', delay))
  writeFileSync(join(src, 'apropos.mjs'), '<script>\n$n = 2\n</script>\n<p class="a">à propos {$n}</p>\n<mjs-carte></mjs-carte>\n')
  writeFileSync(join(src, 'carte.mjs'), carte('carte v1'))
  const config = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs', js, render: { engine: { prerender: 'happy-dom' }, routes: { '/': { component: 'mjs-accueil', settleMs: 10000 }, '/apropos': { component: 'mjs-apropos' } } } }
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config, null, 2))
  return root
}

// module chargé avant la commande : chaque appel de `Bundler.prototype.compile` du processus de la commande écrit son début et sa fin sur
// la sortie, avec le numéro de son Bundler (1 : le premier qui compile, celui du veilleur ; le Bundler de dist/index.js est celui de
// dist/cli.js, même morceau ; les fils de travail ne compilent pas de projet)
function counter(): string {
  const source = [
    'import { isMainThread } from \'node:worker_threads\'',
    'if (isMainThread) {',
    `  const { Bundler } = await import(${JSON.stringify(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href)})`,
    '  const compile = Bundler.prototype.compile',
    '  const ids     = new WeakMap()',
    '  let next      = 0',
    '  Bundler.prototype.compile = async function (...args) {',
    '    if (!ids.has(this)) ids.set(this, ++next)',
    '    const id = ids.get(this)',
    '    console.log(\'[compile] début \' + id)',
    '    try { return await compile.apply(this, args) }',
    '    finally { console.log(\'[compile] fin \' + id) }',
    '  }',
    '}',
  ].join('\n')
  return 'data:text/javascript,' + encodeURIComponent(source)
}

interface Dev {
  lines(from?: number): string[]
  waitFor(what: string, ok: (lines: string[]) => boolean): Promise<void>
  stop(): Promise<void>
}

function startDev(root: string): Dev {
  const port = 21000 + Math.floor(Math.random() * 9000)
  const proc = spawn(process.execPath, ['--import', counter(), MJS, 'dev', '--root', root, '--port', String(port)], { env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out    = ''
  let err    = ''
  proc.stdout!.on('data', d => { out += String(d) })
  proc.stderr!.on('data', d => { err += String(d) })
  // lignes non vides, comptées comme la marque que l'appelant a prise (`lines().length`)
  const lines = (from = 0): string[] => out.split('\n').filter(Boolean).slice(from)
  return {
    lines,
    waitFor: (what, ok) => new Promise((resolve, reject) => {
      const limit = Date.now() + 60_000
      const tick  = (): void => {
        if (ok(lines())) return resolve()
        if (proc.exitCode !== null || Date.now() > limit) return reject(new Error(`${what} : jamais vu\n--- sortie ---\n${out}\n--- erreurs ---\n${err}`))
        setTimeout(tick, 20)
      }
      tick()
    }),
    stop: () => new Promise(done => {
      if (proc.exitCode !== null) return done()
      proc.once('close', () => done())
      proc.kill('SIGINT')
      setTimeout(() => proc.kill('SIGKILL'), 5000).unref()
    }),
  }
}

const passEnds  = (lines: string[]): number => lines.filter(l => /✓ \/apropos → /.test(l)).length
const compiles  = (lines: string[]): string[] => lines.filter(l => l.startsWith('[compile] début '))

// le fragment écrit contient `text` (la passe l'écrit, puis l'en-tête de démarrage) : attendu au plus 30 s
async function pageHas(root: string, page: string, text: string): Promise<string> {
  const file  = join(root, 'public', 'mjs_pages', page)
  const limit = Date.now() + 30_000
  for (;;) {
    const html = existsSync(file) ? readFileSync(file, 'utf-8') : ''
    if (html.includes(text) || Date.now() > limit) return html
    await new Promise(r => setTimeout(r, 20))
  }
}

describe('mjs dev — le prérendu reprend la compilation du veilleur', function () {
  this.timeout(180_000)

  before(() => {
    assert.ok(existsSync(join(repoRoot, 'dist', 'cli.js')), 'bin/mjs charge dist/cli.js : lancez `npm run build:self` avant ce test')
    assertDistFrais(repoRoot)
  })

  it('unités séparées : une compilation par passage, aucune dans un second Bundler ; un enregistrement pendant une passe attend sa fin', async () => {
    const root = projet('dev-reprise-prerendu', 'split', 1500)
    const src  = join(root, 'app', 'modularjs')
    const dev  = startDev(root)
    // chaque compte faux est noté, la sortie de la commande avec lui : tous sont dits à la fin
    const faults: string[] = []
    const check           = (ok: boolean, what: string, lines: string[]): void => { if (!ok) faults.push(`${what} :\n${lines.join('\n')}`) }
    try {
      // premier passage : la compilation du veilleur, puis la passe de prérendu
      await dev.waitFor('la première passe de prérendu', l => passEnds(l) >= 1)
      check(compiles(dev.lines()).join() === '[compile] début 1', 'premier passage : le prérendu rend sur la compilation du veilleur, sans recompiler le projet', dev.lines())
      assert.match(await pageHas(root, 'index.html', 'Accueil v1'), /<h1 class="t">Accueil v1<\/h1>/)

      // un composant des deux pages enregistré : le veilleur recompile, la passe rend sur sa compilation
      let mark = dev.lines().length
      writeFileSync(join(src, 'carte.mjs'), carte('carte v2'))
      await dev.waitFor('la passe de prérendu de l\'enregistrement', l => passEnds(l.slice(mark)) >= 1)
      check(compiles(dev.lines(mark)).join() === '[compile] début 1', 'après un enregistrement : la seule compilation du veilleur', dev.lines(mark))
      assert.match(await pageHas(root, 'index.html', 'carte v2'), /carte v2/)
      assert.match(await pageHas(root, 'apropos.html', 'carte v2'), /carte v2/)

      // deux enregistrements, le second pendant la passe du premier : sa compilation attend la fin de cette passe
      mark = dev.lines().length
      writeFileSync(join(src, 'accueil.mjs'), accueil('Accueil v3', 1500))
      await dev.waitFor('la compilation du premier des deux enregistrements', l => l.slice(mark).includes('[compile] fin 1'))
      writeFileSync(join(src, 'accueil.mjs'), accueil('Accueil v4', 1500))
      await dev.waitFor('la passe de prérendu du second enregistrement', l => passEnds(l.slice(mark)) >= 2)
      const tail   = dev.lines(mark)
      const first  = tail.indexOf('[compile] fin 1')
      const second = tail.indexOf('[compile] début 1', first)
      const pass   = tail.slice(first, second === -1 ? tail.length : second)
      check(second > first && pass.some(l => /✓ \/ → /.test(l)) && pass.some(l => /✓ \/apropos → /.test(l)), 'la compilation du second enregistrement attend la fin de la passe du premier', tail)
      check(compiles(tail).join() === '[compile] début 1,[compile] début 1', 'deux enregistrements : deux compilations du veilleur, aucune autre', tail)
      assert.match(await pageHas(root, 'index.html', 'Accueil v4'), /<h1 class="t">Accueil v4<\/h1>/)
      assert.match(readFileSync(join(root, 'public', 'mjs_pages', 'index.html'), 'utf-8'), /<span class="v">servi<\/span>/, 'le `{await}` rendu résolu')

      // un enregistrement qui échoue à la compilation (feuille SASS fautive) : aucune passe de prérendu ; corrigé, la passe rend la correction
      mark = dev.lines().length
      writeFileSync(join(src, 'carte.mjs'), `${carte('carte v3')}<style>\n.c { color: red; }\n</style>\n`)
      await dev.waitFor('la compilation en échec', l => l.slice(mark).some(x => /\(errors: [1-9]/.test(x)))
      writeFileSync(join(src, 'carte.mjs'), carte('carte v4'))
      await dev.waitFor('la passe de prérendu de la correction', l => passEnds(l.slice(mark)) >= 1)
      const failed = dev.lines(mark)
      const fixed  = failed.lastIndexOf('[compile] début 1')
      check(fixed > 0 && failed.slice(0, fixed).every(l => !/✓ \//.test(l)), 'un enregistrement en échec ne lance aucune passe de prérendu', failed)
      check(compiles(failed).join() === '[compile] début 1,[compile] début 1', 'l\'échec puis la correction : deux compilations du veilleur, aucune autre', failed)
      assert.match(await pageHas(root, 'index.html', 'carte v4'), /carte v4/)
      assert.deepEqual(faults, [], faults.join('\n\n'))
    }
    finally {
      await dev.stop()
    }
  })

  it('`js: \'bundle\'` : le moteur de rendu compile à part à chaque passe, comme avant', async () => {
    const root = projet('dev-reprise-prerendu-bundle', 'bundle', 0)
    const dev  = startDev(root)
    try {
      await dev.waitFor('la première passe de prérendu', l => passEnds(l) >= 1)
      assert.deepEqual(compiles(dev.lines()), ['[compile] début 1', '[compile] début 2'], `le veilleur, puis le moteur de rendu dans son dossier de travail :\n${dev.lines().join('\n')}`)
      const mark = dev.lines().length
      writeFileSync(join(root, 'app', 'modularjs', 'carte.mjs'), carte('carte v2'))
      await dev.waitFor('la passe de prérendu de l\'enregistrement', l => passEnds(l.slice(mark)) >= 1)
      assert.deepEqual(compiles(dev.lines(mark)), ['[compile] début 1', '[compile] début 3'], `le veilleur, puis un nouveau moteur de rendu :\n${dev.lines(mark).join('\n')}`)
      assert.match(await pageHas(root, 'index.html', 'carte v2'), /carte v2/)
    }
    finally {
      await dev.stop()
    }
  })
})

describe('cli/dev-prerender — la passe reçoit la compilation du veilleur', () => {
  const config: any = { render: { routes: { '/': { component: 'mjs-home' } } } }
  const report      = { outDir: '/out', generated: [], skipped: [] }

  it('schedule(stats) : la passe reçoit `compiled` (le Bundler du veilleur et ce résultat), les autres réglages gardés', async () => {
    const bundler: any = { jsMode: 'split' }
    const stats: any   = { errors: [] }
    const seen: any[]  = []
    const scheduler    = createDevPrerenderScheduler(config, '/proj', {
      overrides: { outputDir: 'sortie', env: 'dev' },
      prerenderFn: (async (_c: unknown, _d: unknown, _l: unknown, overrides: any) => { seen.push(overrides); return report }) as any,
    } as any)
    await scheduler.schedule(stats)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].outputDir, 'sortie')
    assert.equal(seen[0].env, 'dev')
    assert.equal(seen[0].compiled, undefined, 'sans Bundler du veilleur, rien à reprendre')
    const withBundler = createDevPrerenderScheduler(config, '/proj', {
      bundler,
      startupFn: (async () => ({ pages: [], written: 0, pageFiles: [] })) as any,
      overrides: { outputDir: 'sortie', env: 'dev' },
      prerenderFn: (async (_c: unknown, _d: unknown, _l: unknown, overrides: any) => { seen.push(overrides); return report }) as any,
    })
    await withBundler.schedule(stats)
    assert.equal(seen[1].compiled?.bundler, bundler)
    assert.equal(seen[1].compiled?.stats, stats)
    assert.equal(seen[1].outputDir, 'sortie')
  })

  for (const jsMode of ['split', 'bundle'] as const) {
    it(`idle() ${jsMode === 'split' ? 'attend la fin de la passe qui lit le dossier de sortie du veilleur' : 'n\'attend pas la passe en `js: \'bundle\'` (elle compile dans son dossier de travail)'}`, async () => {
      const order: string[] = []
      const scheduler       = createDevPrerenderScheduler(config, '/proj', {
        bundler: { jsMode } as any,
        startupFn: (async () => ({ pages: [], written: 0, pageFiles: [] })) as any,
        prerenderFn: (async () => { await new Promise(r => setTimeout(r, 80)); order.push('passe'); return report }) as any,
      })
      const pass = scheduler.schedule({ errors: [] } as any)
      await scheduler.idle().then(() => order.push('idle'))
      await pass
      assert.deepEqual(order, jsMode === 'split' ? ['passe', 'idle'] : ['idle', 'passe'])
    })
  }
})
