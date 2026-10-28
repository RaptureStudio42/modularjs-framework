// les textes des traces du routeur dans un build de production : ils partent avec les traces, ou ils sont là
//
// le routeur écrit ses traces avec un texte du groupe `err` de la table des messages (`routerLog…`), qui vit en
// production dans un fichier par langue, `mjs_err-<langue>-<empreinte>.json`, chargé quand un message s'écrit.
//  - niveau de console 'warn', 'error' (défaut) ou 'silent' : la construction retire les traces du code envoyé, personne
//    ne lira leur texte : les fichiers de messages ne le portent plus. Aux niveaux 'error' et 'silent', les avertissements
//    du runtime partent aussi, et les textes qu'eux seuls lisent (WARNING_ONLY_MESSAGES) ; aux trois niveaux, ceux du développement
//    seul aussi (DEV_ONLY_MESSAGES). Les autres messages n'en bougent pas
//  - niveau 'log' : les traces restent, leur texte part avec le manifeste (groupe `err` réduit à ces textes), si bien que
//    la première trace s'écrit en texte, tout de suite, dans la langue de la page. Les fichiers de messages restent complets
//  - sans minification les traces restent dans le code : les fichiers aussi. En développement, rien ne change
//  - une appli qui n'a pas le routeur ne paie rien

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { WARNING_ONLY_MESSAGES, DEV_ONLY_MESSAGES } from '../src/bundler/minify.js'
import { mjsTmp } from './helpers/tmp.js'

// les textes que seules des traces du routeur lisent
const ROUTEUR = [
  'routerLogRegister', 'routerLogInit', 'routerLogNavigate', 'routerLogCurtain', 'routerLogViewTransition', 'routerLogNative', 'routerLogNoRoutes',
  'routerLogAnalyze', 'routerLogMatch', 'routerLogNothingToInject', 'routerNoRouteLog', 'routerLogViewCleared', 'routerLogCacheHit', 'routerLogCreate',
]
// le texte de la trace d'un {await} rejeté sans branche {error} : seule une trace le lit, il quitte les fichiers avec ceux du routeur
const AWAIT = 'awaitUnhandled'
// le texte de la trace d'une poignée de salon partie (on() ou onLeft() après leave()) : seule une trace le lit, il quitte les fichiers
// avec ceux du routeur, et part au manifeste avec eux quand le texte du cœur la nomme (traceKeysIn) : le cœur n'a le socket que si l'appli
// s'en sert, ou avec `runtime: 'all'`
const SOCKET = 'sockHandleGone'
// UJS écrit ce texte dans sa trace du mode 'silent' et dans l'avertissement des autres modes : une trace le lit, un avertissement aussi
const UJS = 'ujsNoPage'
// la clé refusée par µ.state, µ.smooth ou le socket : seules leurs traces de développement la lisent, elle quitte les fichiers avec
// celles du routeur, et part au manifeste avec elles au niveau 'log'
const RUNES = 'runesKey'

const SOURCES: Record<string, string> = {
  'app.page.mjs':   ['<script>', '  @routes =', '    \'main\':', '      \'/\':      \'home-page\'', '      \'/about\': \'about-page\'', '</script>', '', '<@view main>'].join('\n'),
  'home-page.mjs':  '<h1>Accueil</h1>',
  'about-page.mjs': '<h1>A propos</h1>',
}

type Langue = 'fr' | 'en'

interface Construit {
  fichiers: Record<Langue, Record<string, string>>
  table: any
  dossier: string
}

async function construire(opts: Record<string, unknown>, sources: Record<string, string> = SOURCES): Promise<Construit> {
  const root   = mjsTmp('messages-traces')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, contenu] of Object.entries(sources)) writeFileSync(join(srcDir, nom), contenu + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), ...opts } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const noms     = readdirSync(outDir)
  const fichiers = { fr: {}, en: {} } as Construit['fichiers']
  for (const lang of ['fr', 'en'] as const) {
    const nom = noms.find((f) => new RegExp(`^mjs_err-${lang}-[0-9a-z]{5}\\.json$`).test(f))
    if (nom) fichiers[lang] = JSON.parse(readFileSync(join(outDir, nom), 'utf-8'))
  }
  // le fichier unique est minifié : sa table ne se lit pas ligne à ligne, seuls les fichiers de messages sont relevés
  if (opts.js === 'bundle') return { fichiers, table: undefined, dossier: outDir }
  const ligne = readFileSync(join(outDir, 'bundle.js'), 'utf-8').split('\n').map((l) => l.trim()).find((l) => l.startsWith('µ._runtimeLabels ='))
  assert.ok(ligne, 'le manifeste pose la table des libellés')
  return { fichiers, table: JSON.parse(ligne!.slice('µ._runtimeLabels ='.length).trim().replace(/;$/, '')), dossier: outDir }
}

const cles = (o: Record<string, unknown>) => Object.keys(o).sort()
const sans = (liste: string[], retire: string[]) => liste.filter((k) => !retire.includes(k))

describe('textes des traces du routeur — fichiers de messages et manifeste, builds réels', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const niveau of [undefined, 'warn', 'error', 'silent']) {
    it(`production, niveau ${niveau ?? 'par défaut'} : les fichiers de messages n'ont plus les textes des traces, ni le manifeste aucun message`, async () => {
      const b = await construire({ env: 'prod', ...(niveau ? { logLevel: niveau } : {}) })
      for (const lang of ['fr', 'en'] as const) {
        const complet = cles(RUNTIME_LABELS[lang].err)
        // aux niveaux qui retirent les avertissements (le défaut 'error', et 'silent'), leurs textes partent aussi ; au niveau 'warn', ceux du développement seul
        const avertissements = niveau === 'warn' ? [...DEV_ONLY_MESSAGES] : [...WARNING_ONLY_MESSAGES]
        assert.deepEqual(cles(b.fichiers[lang]), sans(complet, [...ROUTEUR, AWAIT, SOCKET, RUNES, ...avertissements]), `fichier ${lang}`)
        assert.ok(b.fichiers[lang][UJS], 'le texte de l\'avertissement d\'UJS reste')
        assert.equal(b.table[lang].err, undefined, `manifeste ${lang} : aucun message`)
        // le reste du fichier est la table, mot pour mot
        for (const k of cles(b.fichiers[lang])) assert.equal(b.fichiers[lang][k], (RUNTIME_LABELS[lang].err as any)[k], `${lang} ${k}`)
      }
    })
  }

  it('production, niveau error, fichier unique : mêmes fichiers de messages', async () => {
    const b = await construire({ env: 'prod', logLevel: 'error', js: 'bundle' })
    for (const lang of ['fr', 'en'] as const) assert.deepEqual(cles(b.fichiers[lang]), sans(cles(RUNTIME_LABELS[lang].err), [...ROUTEUR, AWAIT, SOCKET, RUNES, ...WARNING_ONLY_MESSAGES]))
  })

  it('production, niveau log : les fichiers de messages sont complets, le manifeste porte le texte des traces dans les deux langues', async () => {
    const b = await construire({ env: 'prod', logLevel: 'log' })
    for (const lang of ['fr', 'en'] as const) {
      assert.deepEqual(b.fichiers[lang], RUNTIME_LABELS[lang].err, `fichier ${lang} complet`)
      // l'appli ne se sert pas du socket : le cœur ne l'a pas, le texte de sa trace ne part pas au manifeste
      assert.deepEqual(cles(b.table[lang].err ?? {}), [...ROUTEUR, UJS, RUNES].sort(), `manifeste ${lang} : les textes des traces, et eux seuls`)
      for (const k of [...ROUTEUR, UJS, RUNES]) assert.equal(b.table[lang].err?.[k], (RUNTIME_LABELS[lang].err as any)[k], `${lang} ${k}`)
      // le reste de la table est celui d'un build sans ces textes
      assert.ok(b.table[lang].modal && b.table[lang].router && b.table[lang].toast && b.table[lang].ujs)
    }
  })

  it('production, niveau log, runtime \'all\' : le socket est au cœur, le texte de sa trace part au manifeste avec ceux du routeur', async () => {
    const b = await construire({ env: 'prod', logLevel: 'log', runtime: 'all' })
    for (const lang of ['fr', 'en'] as const) {
      assert.deepEqual(cles(b.table[lang].err ?? {}), [...ROUTEUR, UJS, SOCKET, RUNES].sort(), `manifeste ${lang} : les textes des traces, et eux seuls`)
      assert.equal(b.table[lang].err?.[SOCKET], (RUNTIME_LABELS[lang].err as any)[SOCKET], `${lang} ${SOCKET}`)
    }
  })

  it('production sans minification, niveau par défaut : les traces restent dans le code, les fichiers de messages sont complets, le manifeste sans message', async () => {
    const b = await construire({ env: 'prod', minify: false })
    for (const lang of ['fr', 'en'] as const) {
      assert.deepEqual(b.fichiers[lang], RUNTIME_LABELS[lang].err, `fichier ${lang} complet`)
      assert.equal(b.table[lang].err, undefined)
    }
  })

  it('production sans minification, niveau log : fichiers complets et textes des traces au manifeste', async () => {
    const b = await construire({ env: 'prod', minify: false, logLevel: 'log' })
    for (const lang of ['fr', 'en'] as const) {
      assert.deepEqual(b.fichiers[lang], RUNTIME_LABELS[lang].err)
      assert.deepEqual(cles(b.table[lang].err ?? {}), [...ROUTEUR, UJS, RUNES].sort())
    }
  })

  it('développement : la table complète au manifeste, aucun fichier de messages', async () => {
    const b = await construire({ env: 'dev' })
    for (const lang of ['fr', 'en'] as const) {
      assert.deepEqual(b.fichiers[lang], {}, 'aucun fichier de messages')
      assert.deepEqual(b.table[lang].err, RUNTIME_LABELS[lang].err)
    }
  })

  it('production, niveau log, cœur seul sans routeur ni UJS : aucun texte de trace au manifeste (rien à payer pour ce qui n\'est pas écrit)', async () => {
    const b = await construire({ env: 'prod', logLevel: 'log', runtime: 'core' }, { 'hop.mjs': '<p>x</p>' })
    for (const lang of ['fr', 'en'] as const) {
      const dessus = cles(b.table[lang].err ?? {})
      assert.deepEqual(dessus.filter((k) => ROUTEUR.includes(k) || k === UJS), [], `manifeste ${lang}`)
    }
  })
})
