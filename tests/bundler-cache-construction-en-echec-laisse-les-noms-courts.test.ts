// `mjs build --cache` en échec : `.mangle-cache.json` reste celui d'avant, à l'octet. Ensuite, la construction rapide suivante (sur le
// cache que l'échec a laissé) et, en production, la construction complète de repli (cache jeté, comme le fait la tâche de mise en
// ligne) donnent la même sortie qu'une construction complète lancée sur l'état d'avant l'essai : mêmes noms courts, mêmes empreintes.
// Hors production (minification demandée), la clé du cache suit `.mangle-cache.json` : l'échec n'écrit pas non plus le cache, dont les
// unités minifiées porteraient des noms courts que ce fichier n'a pas. Par l'API, l'échec est provoqué en remplaçant la minification
// d'un composant ; par la ligne de commande, par un script que Civet ne sait pas lire. Deux composants ajoutés portent chacun un nom
// interne neuf (une classe à bascule) : le tour en échec donne au second le premier nom court libre, une construction complète le
// donne d'abord au premier. Un tour en échec qui publie quand même (`keepFailedComponents`, composant repêché) inscrit, lui, les
// noms courts de ce qu'il publie

import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { build, gaps, write } from './helpers/construction-cache.js'

const vivant  = (nom: string): string => `<script lang="js">\n  $n = 0;\n  @inc = function() { $n++; };\n</script>\n\n<div class="${nom}">\n  <button @click={@inc()}>{$n}</button>\n  {if $n > 2}\n    <b>${nom}</b>\n  {end}\n</div>\n`
const bascule = (classe: string): string => `<script lang="js">\n  $c = 1;\n</script>\n\n<p class="cpt" :class{$c > 1}="${classe}">{$c}</p>\n`
// un script que Civet ne sait pas lire : la construction échoue
const CASSE   = '<script>\n  x := ((\n</script>\n'
const CONFIG  = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs' }

const SOURCES: Record<string, string> = {
  'accueil.mjs': vivant('accueil'),
  'pied.mjs':    vivant('pied'),
}
// ajoutés après la première construction : chacun un nom interne que le cache des noms courts ne connaît pas encore
const AJOUTS: Record<string, string> = {
  'bascule-a.mjs': bascule('haut'),
  'bascule-z.mjs': bascule('bas'),
}

interface Construction { erreurs: string[], suivie: boolean }

// construction minifiée par l'API dans `root`, comme `mjs build` : un tour en échec ne publie rien ; `garde` : un composant en échec
// garde sa version d'avant et le tour publie (`keepFailedComponents`, celui de `mjs dev`) ; `enEchec` : la minification de ce
// composant échoue, dans la suite des unités (celle qui, en production, suit le cache sur disque) ; `suivie` : cette suite tournait
// sous le cache
async function construire(root: string, env: 'dev' | 'prod', cache: boolean, enEchec?: string, garde = false): Promise<Construction> {
  const ici = process.cwd()
  process.chdir(root)
  try {
    const out = join(root, 'public/modularjs')
    const b: any = new Bundler({ sourceDir: join(root, 'app/modularjs'), outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/modularjs', env, minify: true, cache, keepFailedComponents: garde } as any)
    let suivie = false
    if (enEchec !== undefined) {
      const flush = b.flushPendingMinifyTasks
      b.flushPendingMinifyTasks = async function (withCached: boolean): Promise<void> {
        if (withCached) {
          suivie = this.mangleTrailOn()
          for (const task of this.pendingMinifyTasks) if (task.stem === enEchec) task.run = async () => { throw new Error(`minification de ${enEchec} en échec`) }
        }
        return flush.call(this, withCached)
      }
    }
    const s = await b.compile()
    await b.close()
    return { erreurs: s.errors.map((e: Error) => e.message), suivie }
  }
  finally {
    process.chdir(ici)
  }
}

// dossier `to` remplacé par une copie de `from`
function copie(from: string, to: string): void {
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
}

async function scene(env: 'dev' | 'prod'): Promise<void> {
  const root  = mjsTmp(`cache-echec-noms-${env}`)
  const out   = join(root, 'public/modularjs')
  const names = join(out, '.mangle-cache.json')
  const at    = (dir: string): string => join(root, 'essai', dir)
  for (const [rel, data] of Object.entries(SOURCES)) write(join(root, 'app/modularjs', rel), data)
  // le cache sur disque vit sous node_modules/.cache : sans ce dossier, il est écarté
  mkdirSync(join(root, 'node_modules'))
  assert.deepEqual((await construire(root, env, true)).erreurs, [])
  for (const [rel, data] of Object.entries(AJOUTS)) write(join(root, 'app/modularjs', rel), data)
  copie(out, at('avant'))
  const avant = readFileSync(names)
  const echec = await construire(root, env, true, 'bascule-a')
  assert.deepEqual(echec.erreurs, ['minification de bascule-a en échec'])
  assert.equal(echec.suivie, env === 'prod', 'en production, l\'échec tombe dans la suite qui suit le cache sur disque')
  assert.ok(readFileSync(names).equals(avant), `la construction rapide en échec a réécrit .mangle-cache.json\n${readFileSync(names, 'utf-8')}`)
  copie(out, at('apres-echec'))
  // la construction rapide suivante, sur le cache que l'échec a laissé
  assert.deepEqual((await construire(root, env, true)).erreurs, [])
  copie(out, at('rapide'))
  // la référence : construction complète lancée sur l'état d'avant l'essai
  copie(at('avant'), out)
  assert.deepEqual((await construire(root, env, false)).erreurs, [])
  copie(out, at('reference'))
  assert.ok(!readFileSync(join(at('reference'), '.mangle-cache.json')).equals(avant), 'aucun nom court neuf : l\'essai ne prouverait rien')
  assert.deepEqual(gaps(at('rapide'), at('reference')), [], 'construction rapide après l\'échec')
  if (env === 'prod') {
    // repli de la tâche de mise en ligne, sur la sortie que l'échec a laissée : cache jeté, construction complète
    copie(at('apres-echec'), out)
    rmSync(join(root, 'node_modules/.cache/mjs/build'), { recursive: true, force: true })
    assert.deepEqual((await construire(root, env, false)).erreurs, [])
    assert.deepEqual(gaps(out, at('reference')), [], 'construction complète de repli')
  }
}

describe('mjs build --cache en échec : le cache des noms courts reste celui d\'avant', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('production : .mangle-cache.json intact, construction rapide suivante et repli égaux à la construction complète d\'avant', async () => {
    await scene('prod')
  })

  it('hors production, minification demandée : .mangle-cache.json intact, construction rapide suivante égale à la construction complète', async () => {
    await scene('dev')
  })
})

describe('mjs build --cache en échec qui publie quand même (keepFailedComponents)', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le tour en échec inscrit dans .mangle-cache.json les noms courts de ce qu\'il publie', async () => {
    const root  = mjsTmp('cache-echec-noms-publies')
    const names = join(root, 'public/modularjs/.mangle-cache.json')
    for (const [rel, data] of Object.entries(SOURCES)) write(join(root, 'app/modularjs', rel), data)
    mkdirSync(join(root, 'node_modules'))
    assert.deepEqual((await construire(root, 'prod', true, undefined, true)).erreurs, [])
    for (const [rel, data] of Object.entries(AJOUTS)) write(join(root, 'app/modularjs', rel), data)
    assert.equal(readFileSync(names, 'utf-8').includes('"_mjs_cl_bas"'), false)
    assert.deepEqual((await construire(root, 'prod', true, 'bascule-a', true)).erreurs, ['minification de bascule-a en échec'])
    // bascule-z est publié avec son nom court : une construction suivante, dans un autre processus, ne le donne pas à une autre propriété
    assert.ok(readFileSync(names, 'utf-8').includes('"_mjs_cl_bas"'), readFileSync(names, 'utf-8'))
  })
})

// projet construit par `mjs build` (rien de publié en échec) ; `modules` : avec le dossier node_modules où vit le cache sur disque
function projet(prefix: string, modules: boolean): string {
  const root = mjsTmp(prefix)
  write(join(root, 'mjs.config.json'), JSON.stringify(CONFIG))
  for (const [rel, data] of Object.entries(SOURCES)) write(join(root, 'app/modularjs', rel), data)
  if (modules) mkdirSync(join(root, 'node_modules'))
  return root
}

// premier passage, copié dans `avant` ; puis les deux composants ajoutés et un composant en échec, premier dans l'ordre des noms
function echec(root: string, avant: string): void {
  const out   = join(root, 'public/modularjs')
  const names = join(out, '.mangle-cache.json')
  assert.equal(build(root, ['--prod', '--cache']).status, 0)
  copie(out, avant)
  for (const [rel, data] of Object.entries(AJOUTS)) write(join(root, 'app/modularjs', rel), data)
  write(join(root, 'app/modularjs/aaa-casse.mjs'), CASSE)
  const failed = build(root, ['--prod', '--cache'])
  assert.notEqual(failed.status, 0, failed.out)
  assert.ok(readFileSync(names).equals(readFileSync(join(avant, '.mangle-cache.json'))), `la construction rapide en échec a réécrit .mangle-cache.json\n${readFileSync(names, 'utf-8')}`)
}

describe('mjs build --prod --cache en échec, par la ligne de commande', function () {
  this.timeout(180000)

  it('vrai échec du premier composant de l\'ordre des noms : la construction rapide réparée égale la construction complète d\'avant', () => {
    const root = projet('cache-echec-noms-cli', true)
    const out  = join(root, 'public/modularjs')
    const at   = (dir: string): string => join(root, 'essai', dir)
    echec(root, at('avant'))
    write(join(root, 'app/modularjs/aaa-casse.mjs'), bascule('fixe'))
    const rapide = build(root, ['--prod', '--cache'])
    assert.equal(rapide.status, 0, rapide.out)
    copie(out, at('rapide'))
    // la référence : construction complète lancée sur l'état d'avant l'essai
    copie(at('avant'), out)
    assert.equal(build(root, ['--prod']).status, 0)
    assert.ok(!readFileSync(join(out, '.mangle-cache.json')).equals(readFileSync(join(at('avant'), '.mangle-cache.json'))), 'aucun nom court neuf : l\'essai ne prouverait rien')
    assert.deepEqual(gaps(at('rapide'), out), [])
  })

  it('sans dossier node_modules (cache écarté, construction complète) : .mangle-cache.json intact après l\'échec', () => {
    const root = projet('cache-echec-noms-sans-modules', false)
    echec(root, join(root, 'essai/avant'))
  })
})
