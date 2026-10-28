// La construction retire la barre d'outils de <@@chart> quand aucune balise du projet n'écrit `toolbar` : son code (fonctions, gabarit,
// style, icônes) et ses libellés ne partent pas. La même décision partout : en développement comme en production, en un fichier par
// module comme en fichier unique, au rendu serveur comme au navigateur (la page servie et la page reprise portent le même gabarit).
// Écrit en dur ou lié, l'attribut garde la barre ; dans le doute aussi : un étalement, une balise dynamique (<@element>, <@module>) qui
// écrit l'attribut ou un étalement, une référence relevée sans ses attributs (un cache ancien), un module .civet, .coffee, .js ou .ts, ou le script
// d'un composant qui fabrique la balise. Un script qui donne `toolbar` à un graphique alors qu'aucune page ne l'écrit : un avertissement
// du développement, une fois.
//
// Statique, avec un Bundler réel et le catalogue réel du framework ; l'avertissement dans happy-dom. Ce qu'on cherche dans la sortie :
// les rôles des menus de la barre, les clés de ses libellés, le dessin d'une de ses icônes (ils survivent à la minification) et, sans
// minification, les noms de ses fonctions.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { selectCoreSections } from '../src/bundler/core-sections.js'
import { CORE_LABEL_MODULES, CORE_LABEL_PARTS, coreLabelKeys, runtimeLabelsFor } from '../src/runtime-labels.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'

type Files = Record<string, string>

const DONNEES = `<script>
  $rows   = [{ id: 'a', x: '2026-09-01', poids: 72 }, { id: 'b', x: '2026-09-03', poids: 73 }, { id: 'c', x: '2026-09-05', poids: 71 }]
  $series = [{ key: 'poids', name: 'Poids', unit: 'kg' }]
</script>
`
const graphique = (attrs = '') => `<@@chart rows={$rows} series={$series} ${attrs}></@@chart>`
const page      = (corps: string, script = '') => DONNEES.replace('</script>', script + '</script>') + corps

// ce qui n'existe que pour la barre dans ce que le navigateur reçoit, et ses fonctions (sans minification)
const BARRE_MINIFIE = ['menuitemradio', 'radiogroup', 'chartTools', 'chartShapeOf', 'chartLegend', 'chartLine', 'chartYear', 'M1.5 12L5.5 7.5L9 10L14.5 3.5']
const BARRE_NOMS    = ['barOf', 'formsOf', 'toolsOf', 'toggleStat', 'openMenu', 'menuKey']
// ce qui sert au graphique sans barre : il reste
const GRAPHIQUE     = ['chartEmpty', 'chartMean', 'xlabel', 'measureText']
const AVIS          = 'dev.chartToolbarScript'
const CHART         = fileURLToPath(new URL('../src/core-modules/chart.mjs', import.meta.url))

const MODES = {
  'développement, un fichier par module': { env: 'dev', js: 'split' },
  'développement, fichier unique':        { env: 'dev', js: 'bundle' },
  'production, un fichier par module':    { env: 'prod', js: 'split' },
  'production, fichier unique':           { env: 'prod', js: 'bundle' },
} as const
const PROD = MODES['production, un fichier par module']

interface Built { root: string, srcDir: string, outDir: string, bundler: Bundler }

function appOf(prefix: string, files: Files, opts: Record<string, unknown> = {}): Built {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(srcDir, rel), content)
  const outDir  = join(root, 'out')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts })
  return { root, srcDir, outDir, bundler }
}

/** tout ce que la construction écrit pour le navigateur : le dossier de sortie et le manifeste (code, style, libellés) */
function sortie(app: { root: string, outDir: string }): string {
  const fichiers = existsSync(app.outDir) ? readdirSync(app.outDir).sort().filter((f) => /\.(js|json|css)$/.test(f)).map((f) => join(app.outDir, f)) : []
  if (existsSync(join(app.root, 'bundle.js'))) fichiers.push(join(app.root, 'bundle.js'))
  return fichiers.map((f) => readFileSync(f, 'utf-8')).join('\n')
}

async function build(prefix: string, files: Files, opts: Record<string, unknown> = PROD): Promise<Built & { code: string }> {
  const app   = appOf(prefix, files, opts)
  const stats = await app.bundler.compile()
  await app.bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
  return { ...app, code: sortie(app) }
}

const present = (code: string, noms: string[]) => noms.filter((n) => code.includes(n))
const manque  = (code: string, noms: string[]) => noms.filter((n) => !code.includes(n))

describe('construction — la barre d\'outils de <@@chart> ne part que si une page écrit `toolbar`', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('aucune balise n\'écrit `toolbar` : plus rien de la barre, la même décision partout', () => {
    for (const [nom, opts] of Object.entries(MODES)) {
      it(nom, async () => {
        const { code } = await build('tri-barre-sans', { 'page.mjs': page(graphique('shape="bar" stats="mean"') + graphique('shape="pie"')) }, opts)
        assert.deepEqual(manque(code, GRAPHIQUE), [], 'le graphique est bien là')
        assert.deepEqual(present(code, BARRE_MINIFIE), [], 'rien de la barre : ni ses menus, ni ses libellés, ni ses icônes')
        if (opts.env === 'dev') assert.deepEqual(present(code, BARRE_NOMS), [], 'ni ses fonctions')
      })
    }

    it('production non minifiée : ni fonction de la barre, ni avertissement du développement', async () => {
      const { code } = await build('tri-barre-sans-noms', { 'page.mjs': page(graphique()) }, { env: 'prod', minify: false })
      assert.deepEqual(present(code, BARRE_NOMS), [])
      assert.deepEqual(present(code, [AVIS]), [])
    })

    it('le module est nettement plus court que celui d\'une appli qui écrit `toolbar`', async () => {
      const sans = (await build('tri-barre-poids-sans', { 'page.mjs': page(graphique()) })).code
      const avec = (await build('tri-barre-poids-avec', { 'page.mjs': page(graphique('toolbar="legend"')) })).code
      assert.ok(sans.length < avec.length - 12000, `${sans.length} octets sans, ${avec.length} avec`)
    })

    it('une balise dynamique sans `toolbar` ni étalement ne retient pas la barre', async () => {
      const { code } = await build('tri-barre-dynamique-nue', { 'page.mjs': page(graphique() + '<@element $t class="titre">Titre</@element>', "  $t = 'h2'\n") })
      assert.deepEqual(present(code, BARRE_MINIFIE), [])
    })
  })

  describe('une balise écrit `toolbar` : tout reste, de quelque façon qu\'elle l\'écrive', () => {
    const AVEC: [string, Files][] = [
      ['en dur', { 'page.mjs': page(graphique('toolbar="legend"')) }],
      ['vide (l\'attribut est écrit)', { 'page.mjs': page(graphique('toolbar=""')) }],
      ['lié {…}', { 'page.mjs': page(graphique('toolbar={$outils}'), "  $outils = 'legend shapes'\n") }],
      ['lié à deux sens !{…}', { 'page.mjs': page(graphique('toolbar=!{$outils}'), "  $outils = 'stats'\n") }],
      ['en majuscules', { 'page.mjs': page(graphique('TOOLBAR="legend"')) }],
      ['sur un seul de ses deux graphiques', { 'page.mjs': page(graphique() + graphique('toolbar="step"')) }],
      ['dans un second fichier', { 'a.mjs': page(graphique()), 'b.mjs': page(graphique('toolbar="legend"')) }],
      ['dans un partiel <@include>', { '_graphique.mjs': graphique('toolbar="legend"'), 'page.mjs': page('<main><@include graphique></main>') }],
      ['dans un composant importé', { 'page.mjs': page('<main><@enfant/></main>'), 'enfant.mjs': page(graphique('toolbar="legend"')) }],
      ['balise littérale mjs-core-chart', { 'page.mjs': page('<mjs-core-chart rows={$rows} series={$series} toolbar="legend"></mjs-core-chart>') }],
    ]
    for (const [nom, files] of AVEC) {
      it(nom, async () => {
        const { code } = await build('tri-barre-avec', files)
        assert.deepEqual(manque(code, BARRE_MINIFIE), [])
      })
    }

    it('en développement, en fichier unique : tout reste aussi', async () => {
      const { code } = await build('tri-barre-avec-dev', { 'page.mjs': page(graphique('toolbar={$outils}'), "  $outils = 'legend'\n") }, MODES['développement, fichier unique'])
      assert.deepEqual(manque(code, [...BARRE_MINIFIE, ...BARRE_NOMS]), [])
      assert.deepEqual(present(code, [AVIS]), [], 'sans avertissement : une page écrit l\'attribut')
    })
  })

  describe('dans le doute, la barre reste', () => {
    const DOUTE: [string, Files][] = [
      ['un étalement {...$p} sur un graphique', { 'page.mjs': page(graphique('{...$p}'), "  $p = { shape: 'bar' }\n") }],
      ['une balise dynamique <@element> qui écrit `toolbar`', { 'page.mjs': page(graphique() + '<@element $t toolbar="legend"></@element>', "  $t = 'div'\n") }],
      ['une balise dynamique <@module> qui écrit un étalement', { 'page.mjs': page(graphique() + '<@module $c {...$p}></@module>', "  $c = null\n  $p = {}\n") }],
      ['un module .civet qui fabrique la balise', { 'page.mjs': page(graphique()), 'fabrique.civet': "fabrique = -> document.createElement('mjs-core-chart')\n" }],
      ['un module .coffee qui fabrique la balise', { 'page.mjs': page(graphique()), 'fabrique.coffee': "fabrique = -> document.createElement 'mjs-core-chart'\n" }],
      ['un module .js qui fabrique la balise', { 'page.mjs': page(graphique()), 'fabrique.js': "export const fabrique = () => document.createElement('mjs-core-chart')\n" }],
      ['un module .ts qui fabrique la balise', { 'page.mjs': page(graphique()), 'fabrique.ts': "export const fabrique = (): HTMLElement => document.createElement('mjs-core-chart')\n" }],
      ['le script d\'un composant qui fabrique la balise', { 'page.mjs': page(graphique(), "  fabrique = -> document.createElement('mjs-core-chart')\n") }],
    ]
    for (const [nom, files] of DOUTE) {
      it(nom, async () => {
        const { code } = await build('tri-barre-doute', files)
        assert.deepEqual(manque(code, BARRE_MINIFIE), [])
      })
    }

    it('une référence relevée sans ses attributs (un cache ancien) : la barre revient', async () => {
      const app = appOf('tri-barre-cache-ancien', { 'page.mjs': page(graphique()) }, PROD)
      let stats = await app.bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
      assert.deepEqual(present(sortie(app), BARRE_MINIFIE), [], 'premier tour : rien de la barre')
      for (const entry of (app.bundler as any).cache.values()) for (const r of entry.tagRefs ?? []) delete r.attrs
      stats = await app.bundler.compile()
      await app.bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
      assert.equal(app.bundler.coreAttrWrittenStrict('chart', 'toolbar'), 'unknown')
      assert.deepEqual(manque(sortie(app), BARRE_MINIFIE), [], 'second tour, relevé sans attributs : la barre est là')
    })
  })

  describe('coreAttrWrittenStrict ne dit \'no\' qu\'une fois les références du projet lues, et sans aucun doute', () => {
    it('avant tout compile() : \'unknown\'', () => {
      const { bundler } = appOf('tri-barre-avant', { 'page.mjs': page(graphique()) })
      assert.equal(bundler.coreAttrWrittenStrict('chart', 'toolbar'), 'unknown')
    })

    it('après compile() : \'no\' sans `toolbar`, \'yes\' avec, \'unknown\' dans le doute', async () => {
      for (const [attrs, attendu] of [['', 'no'], ['toolbar="legend"', 'yes'], ['{...$p}', 'unknown']] as const) {
        const app = appOf('tri-barre-apres', { 'page.mjs': page(graphique(attrs), "  $p = {}\n") })
        await app.bundler.compile()
        await app.bundler.close()
        assert.equal(app.bundler.coreAttrWrittenStrict('chart', 'toolbar'), attendu, attrs)
      }
    })
  })

  describe('mode veille : une même instance, la page change entre deux tours', () => {
    const wait = () => new Promise((r) => setTimeout(r, 1100))   // la date d'un fichier a la seconde pour grain
    for (const [nom, opts] of [['production', PROD], ['développement', MODES['développement, un fichier par module']]] as const) {
      it(`${nom} : ajouter puis retirer \`toolbar\` dans une page recompile le module`, async () => {
        const app  = appOf('tri-barre-veille', { 'page.mjs': page(graphique()) }, opts)
        const tour = async () => {
          const stats = await app.bundler.compile()
          assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
          return sortie(app)
        }
        const un = await tour()
        await wait()
        writeFileSync(join(app.srcDir, 'page.mjs'), page(graphique('toolbar="legend"')))
        const deux = await tour()
        await wait()
        writeFileSync(join(app.srcDir, 'page.mjs'), page(graphique()))
        const trois = await tour()
        await app.bundler.close()
        assert.deepEqual(present(un, BARRE_MINIFIE), [], 'sans : rien')
        assert.deepEqual(manque(deux, BARRE_MINIFIE), [], 'avec : tout')
        assert.deepEqual(present(trois, BARRE_MINIFIE), [], 'retiré : plus rien')
      })
    }
  })

  describe('le rendu serveur prend la même décision que le navigateur', () => {
    for (const env of ['dev', 'prod'] as const) {
      it(`${env === 'dev' ? 'développement' : 'production'} : le module compilé pour le serveur suit les pages, et la page servie aussi`, async () => {
        for (const [attrs, barre] of [['', false], ['toolbar="legend"', true]] as const) {
          const root   = mjsTmp('tri-barre-serveur')
          const srcDir = join(root, 'src')
          const outDir = join(root, 'out')
          mkdirSync(srcDir, { recursive: true })
          writeFileSync(join(srcDir, 'gr-page.mjs'), page(graphique(attrs)))
          const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir, env, bundlerOpts: { runtime: ['hydrate'] } } as any)
          const rendu    = await renderer.renderToString('mjs-gr-page', { ssrMode: 'markers' } as any)
          await renderer.close()
          const coeur = readdirSync(outDir).filter((f) => f.startsWith('core-chart')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
          assert.ok(coeur.length > 5000, `le module du graphique est compilé pour le serveur (${readdirSync(outDir).join(', ')})`)
          assert.deepEqual(barre ? manque(coeur, ['menuitemradio', 'radiogroup']) : present(coeur, ['menuitemradio', 'radiogroup']), [], attrs || 'sans toolbar')
          assert.equal(rendu.html.includes('class="tools"'), barre, 'la page servie porte la barre si, et seulement si, une page l\'écrit')
        }
      })
    }
  })

  describe('les libellés propres à la barre', () => {
    const PARTIE = CORE_LABEL_PARTS['chart.toolbar']

    // ou d'un module qu'il pose dans son gabarit, qu'il emporte avec lui (<@@editor> pose <@@toolbar>)
    it('chaque clé d\'une partie est une clé de son module, ou d\'un module qu\'il pose dans son gabarit', () => {
      for (const [partie, keys] of Object.entries(CORE_LABEL_PARTS)) {
        const module = partie.split('.')[0]
        const poses  = [...readFileSync(join(dirname(CHART), module + '.mjs'), 'utf-8').matchAll(/<@@([a-z]+)/g)].map((m) => m[1])
        assert.deepEqual(keys.filter((k) => ![module, ...poses].some((m) => CORE_LABEL_MODULES[m]?.includes(k))), [], partie)
      }
    })

    it('le module sans barre ne lit aucune des clés ôtées, le module complet les lit toutes', () => {
      const src  = readFileSync(CHART, 'utf-8')
      const sans = selectCoreSections(CHART, src, (kind, attr) => attr === 'toolbar' ? kind !== 'piece' : kind !== 'alt')
      const avec = selectCoreSections(CHART, src, (kind) => kind === 'piece')
      const lues = (texte: string) => PARTIE.filter((k) => texte.split('\n').some((l) => !/^\s*#/.test(l) && l.includes(`'${k}'`)))
      assert.deepEqual(lues(sans), [], 'une clé ôtée lue par le module sans barre : son texte serait vide')
      assert.deepEqual(lues(avec), PARTIE)
    })

    it('coreLabelKeys ôte les clés d\'une partie, et seulement elles ; une partie inconnue n\'ôte rien', () => {
      const tout = coreLabelKeys(['chart'])
      const sans = coreLabelKeys(['chart'], ['chart.toolbar'])
      assert.equal(tout.size - sans.size, PARTIE.length)
      assert.deepEqual(PARTIE.filter((k) => sans.has(k)), [])
      assert.ok(sans.has('chartEmpty') && sans.has('chartMean'), 'les textes du graphique restent')
      for (const nom of ['chart.inconnu', 'constructor', '__proto__', 'toString']) assert.equal(coreLabelKeys(['chart'], [nom]).size, tout.size, nom)
    })

    it('runtimeLabelsFor : la partie ôtée ne part pas, en français comme en anglais, en développement comme en production', () => {
      for (const prod of [false, true]) {
        const t = runtimeLabelsFor(prod, new Set(['core']), new Set(['chart']), new Set(), new Set(['chart.toolbar'])) as any
        for (const lang of ['fr', 'en']) {
          assert.deepEqual(PARTIE.filter((k) => Object.hasOwn(t[lang].core, k)), [], `${lang} ${prod}`)
          assert.ok(t[lang].core.chartEmpty, `${lang} ${prod} : chartEmpty reste`)
        }
      }
    })
  })

  describe('l\'avertissement du développement (happy-dom)', () => {
    // un hôte monté dans happy-dom avec le code d'un vrai build ; `µ.warn` recueilli
    async function monter(files: Files, opts: Record<string, unknown> = {}, balise = 'mjs-core-chart'): Promise<{ graphiques: any[], warns: () => string[], code: string }> {
      const app   = appOf('tri-barre-avis', files, opts)
      const stats = await app.bundler.compile()
      await app.bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
      const names = readdirSync(app.outDir).filter((f) => f.endsWith('.js'))
      const ordre = [...names.filter((f) => f.startsWith('mjs_')), ...names.filter((f) => !f.startsWith('mjs_'))]
      const code  = ordre.map((f) => stripEsm(readFileSync(join(app.outDir, f), 'utf-8'))).join('\n')
      const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
      window.eval(`${code}\nglobalThis.µ = µ;\nglobalThis.__warns = [];\nµ.warn = function(...a) { globalThis.__warns.push(a.map(String).join(' ')); };`)
      window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
      const hote = window.document.querySelector('mjs-hote')
      await attendre(() => !!hote._shadow && hote._shadow.querySelectorAll(balise).length > 0 && Array.from(hote._shadow.querySelectorAll(balise)).every((g: any) => g._state))
      await pause(200)
      return { graphiques: Array.from(hote._shadow.querySelectorAll(balise)), warns: () => Array.from(window.eval('globalThis.__warns')) as string[], code }
    }

    it('aucune page n\'écrit `toolbar` et un script le donne à un graphique : un avertissement, une seule fois même pour deux graphiques', async () => {
      const { graphiques, warns } = await monter({ 'hote.mjs': page(graphique() + graphique()) })
      assert.equal(graphiques.length, 2)
      assert.deepEqual(warns(), [], 'rien tant que personne ne donne `toolbar`')
      graphiques[0].setAttribute('toolbar', 'legend')
      await pause(150)
      graphiques[1].setAttribute('toolbar', 'shapes')
      await pause(150)
      assert.equal(warns().length, 1, warns().join('\n'))
      assert.match(warns()[0], /^\[ModularJS\] <@@chart> : un graphique reçoit « toolbar » d'un script/)
      assert.match(warns()[0], /Écrivez « toolbar »/)
      assert.equal(graphiques[0]._shadow.querySelector('.tools') === null, true, 'la barre n\'est pas là')
    })

    it('une page écrit `toolbar` sur un autre graphique : aucun avertissement, et la barre vient', async () => {
      const { graphiques, warns } = await monter({ 'hote.mjs': page(graphique('toolbar="legend"') + graphique()) })
      graphiques[1].setAttribute('toolbar', 'legend')
      await pause(150)
      assert.deepEqual(warns(), [])
      assert.equal(!!graphiques[1]._shadow.querySelector('.tools'), true, 'la barre du second graphique est là')
    })

    // seule dans sa page : le montage met tous les modules dans une même portée, où la copie et le module du cœur déclareraient les mêmes noms
    it('une copie du module posée dans le projet garde sa barre, et ne dit rien quand elle la reçoit', async () => {
      const copie = readFileSync(CHART, 'utf-8')
      const { graphiques, warns } = await monter({ 'mon-graphique.mjs': copie, 'hote.mjs': page('<@mon-graphique rows={$rows} series={$series} toolbar="legend"></@mon-graphique>') }, {}, 'mjs-mon-graphique')
      assert.equal(!!graphiques[0]._shadow.querySelector('.tools'), true, 'la copie a sa barre')
      graphiques[0].setAttribute('toolbar', 'shapes')
      await pause(150)
      assert.deepEqual(warns(), [])
    })

    it('la production n\'envoie jamais l\'avertissement', async () => {
      for (const attrs of ['', 'toolbar="legend"']) {
        const { code } = await build('tri-barre-avis-prod', { 'page.mjs': page(graphique(attrs)) }, { env: 'prod', minify: false })
        assert.equal(code.includes(AVIS), false, attrs)
      }
    })
  })
})
