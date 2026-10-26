// production — noms courts que le runtime pose lui-même sur µ (`µ.t` des traductions, `µ.log`, `µ.nav`…) contre les noms
// courts des propriétés internes `_mjs_*` (esbuild `mangleProps`, cache partagé `<outputDir>/.mangle-cache.json`).
// esbuild ne réserve un nom de propriété que dans la transformation qui le voit écrit : un composant minifié avant le
// cœur, qui ne cite pas `µ.t`, pouvait donner `t` à `µ._mjs_cloneTpl` (l'aide qui copie un gabarit) ; le cœur gardait la
// correspondance du cache, sa fonction de traduction prenait la place de l'aide, et une appli traduite dont aucun
// composant ne traduit rien ne se montait plus (« appendChild … not of type 'Node' »).
//
// Montage dans Chromium, Firefox et WebKit réels (page sans rendu serveur, cf. tests/helpers/graine-page.ts) ; un moteur
// absent est sauté, les assertions sur la construction restent.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { lancer, construire, MOTEURS, type Page } from './helpers/graine-page.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import * as minify from '../src/bundler/minify.js'

type JsMode = 'split' | 'bundle'
type Cache  = Record<string, string | false>

const RUNTIME_DIR = fileURLToPath(new URL('../src/runtime', import.meta.url))

/** Tous les `.ts` d'un dossier de source, sous-dossiers compris. */
function sourcesTs(dir: string): string[] {
  const trouves: string[] = []
  for (const entree of readdirSync(dir, { withFileTypes: true })) {
    if (entree.isDirectory()) trouves.push(...sourcesTs(join(dir, entree.name)))
    else if (entree.name.endsWith('.ts')) trouves.push(join(dir, entree.name))
  }
  return trouves
}

// les `µ.<nom>` du runtime dont le nom est assez court pour sortir du raccourcisseur — relevé TEXTUEL (commentaires compris)
// et volontairement large, comme celui des aides du cœur : un nom réservé à tort coûte quelques octets, un nom manqué rouvre
// le bogue. Les aides du cœur (`µ._p`, `µ._tm`, `µ._al`) ont leur propre liste.
function releveRuntime(): string[] {
  const court = new RegExp(`µ\\.(?<nom>[A-Za-z_$][\\w$]{0,${minify.RESERVED_NAME_MAX_LENGTH - 1}})(?![\\w$])`, 'g')
  const noms  = new Set<string>()
  for (const file of sourcesTs(RUNTIME_DIR)) {
    for (const m of readFileSync(file, 'utf-8').matchAll(court)) noms.add(m.groups!.nom)
  }
  return [...noms].filter(nom => !minify.CORE_HELPER_NAMES.includes(nom)).sort()
}

// propriétés internes dont le nom court est un des noms donnés
function collisions(cache: Cache, noms: string[]): string[] {
  return Object.entries(cache).filter(([, court]) => typeof court === 'string' && noms.includes(court)).map(([prop, court]) => `${prop} → ${court}`).sort()
}

// une appli traduite (dossier `i18n/` des sources : le module des traductions entre au cœur) dont le seul composant ne traduit rien
async function construireTraduite(prefix: string, js: JsMode, cacheDepart?: Cache): Promise<Cache> {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'i18n'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
  writeFileSync(join(srcDir, 'home.mjs'), '<p>rien</p>\n')
  if (cacheDepart) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, '.mangle-cache.json'), JSON.stringify(cacheDepart))
  }
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js, i18n: { default: 'fr' } } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return JSON.parse(readFileSync(join(outDir, '.mangle-cache.json'), 'utf-8'))
}

describe('relevé des noms courts que le runtime pose sur µ', function () {
  it('la liste réservée EST le relevé des `µ.<nom court>` du runtime, aides du cœur mises à part', function () {
    const releve = releveRuntime()
    assert.ok(releve.includes('t'), `le relevé doit voir le \`µ.t\` des traductions : ${releve.join(' ')}`)
    assert.deepEqual([...minify.CORE_API_NAMES].sort(), releve, `relevé des noms posés sur µ par le runtime : ${releve.join(' ')}`)
  })
})

describe('production — appli traduite dont aucun composant ne traduit rien', function () {
  this.timeout(120000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const js of ['split', 'bundle'] as JsMode[]) {
    it(`js: '${js}' — aucune propriété interne ne prend un nom que le runtime pose sur µ, \`t\` est réservé dans le cache écrit`, async function () {
      const cache = await construireTraduite(`noms-runtime-${js}`, js)
      assert.deepEqual(collisions(cache, releveRuntime()), [], 'une propriété interne de µ sous ce nom écraserait le runtime, ou serait écrasée par lui')
      assert.equal(cache.t, false, '`t` (la traduction, `µ.t`) doit être réservé dans le cache écrit')
    })
  }

  it('cache pollué d\'avance (`_mjs_cloneTpl → t`) : la correspondance est retirée et `t` réservé', async function () {
    const cache = await construireTraduite('noms-runtime-pollue', 'bundle', { _mjs_cloneTpl: 't' })
    assert.deepEqual(collisions(cache, ['t']), [], 'la correspondance polluée doit être retirée du cache')
    assert.equal(cache.t, false, '`t` doit être réservé dans le cache écrit')
  })
})

// trois pages qui ne se montaient plus : un paragraphe seul, un paragraphe qui lit une variable, une liste du cœur — avec la traduction au cœur
// (`runtime: ['hydrate', 'i18n']`, le réglage du banc) et sans aucun texte traduit
const PAGES: Record<string, { source: string, attendu: RegExp }> = {
  paragraphe: { source: '<p>rien</p>\n', attendu: /^<p>rien<\/p>$/ },
  variable:   { source: '<script>\n  $x = 1\n</script>\n<p>{$x}</p>\n', attendu: /^<p>1<\/p>$/ },
  liste:      { source: '<@@select class="select" placeholder="Ville"><@@option value="1">Paris</@@option><@@option value="2">Lyon</@@option></@@select>\n', attendu: /^<mjs-core-select\b/ }
}

describe('montage — page de production sans rendu serveur, traduction au cœur, Chromium, Firefox et WebKit', function () {
  this.timeout(240000)
  const pages: Record<string, Page> = {}

  before(async function () {
    for (const [nom, { source }] of Object.entries(PAGES)) pages[nom] = await construire({ nom: 'noms-runtime-' + nom, composants: { home: source }, env: 'prod', sansRendu: true })
  })

  after(async () => {
    for (const page of Object.values(pages)) await page.fermer()
    await terminateSharedWorkerPool()
  })

  for (const moteur of MOTEURS) {
    it(`${moteur} — chaque page se monte, sans erreur`, async function () {
      const nav = await lancer(moteur)
      if (!nav) this.skip()
      try {
        for (const [nom, { attendu }] of Object.entries(PAGES)) {
          const contexte          = await nav.newContext()
          const p                 = await contexte.newPage()
          const erreurs: string[] = []
          p.on('pageerror', (e: Error) => erreurs.push(e.message))
          await p.goto(pages[nom].base + '/', { waitUntil: 'load' })
          await p.waitForFunction(() => { const h: any = document.querySelector('mjs-home'); return !!h && !!h._shadow && h._shadow.innerHTML !== '' }, null, { timeout: 5000 }).catch(() => {})
          const ombre: string = await p.evaluate(() => { const h: any = document.querySelector('mjs-home'); return h && h._shadow ? h._shadow.innerHTML : '(sans ombre)' })
          await contexte.close()
          assert.deepEqual(erreurs, [], `${nom} : aucune erreur de page`)
          assert.match(ombre, attendu, `${nom} : le composant doit se monter`)
        }
      }
      finally {
        await nav.close()
      }
    })
  }
})
