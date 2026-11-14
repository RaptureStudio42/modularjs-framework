// Une balise du cœur citée dans un commentaire ne retient plus son morceau : la construction interroge l'arbre du lecteur unique
// (src/reader) — balises, attributs, chaînes et noms du code — et jamais un commentaire, du code ou du HTML. Deux lectures en
// dépendent : le doute d'une source du projet qui pourrait fabriquer une balise du cœur hors du relevé des balises (un script, un
// module .civet, .coffee, .js ou .ts, une classe `Nom.class.mjs`, tout le code du gabarit d'un composant — gestionnaires,
// expressions, têtes de blocs —, la valeur texte d'un attribut qui écrit la balise sous forme de balise, `<mjs-core-…` ou `<@@…`,
// quelle que soit la balise qui la porte, une balise dynamique), et la citation d'un module du catalogue par un autre module du
// catalogue. Le même texte écrit pour de vrai (une chaîne, une balise, un attribut) garde le morceau ; un module .js ou .ts se lit
// par acorn (ses types ôtés par esbuild) ; un script ou un module CoffeeScript se lit dans sa langue : `//` y est la division
// entière, et collée à son second terme (`n //2`), que le lecteur range encore dans un commentaire, la suite de la ligne compte
// quand même pour le doute ; une source qui ne se lit pas sans faute garde tout, dans le doute.
//
// Statique, avec un Bundler réel ; témoin : la barre d'outils de <@@chart> (attribut `toolbar`), dont les noms survivent à la
// minification.

import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

type Files = Record<string, string>

const CATALOG = fileURLToPath(new URL('../src/core-modules', import.meta.url))
const DONNEES = `<script>
  $rows   = [{ id: 'a', x: '2026-09-01', poids: 72 }, { id: 'b', x: '2026-09-03', poids: 73 }]
  $series = [{ key: 'poids', name: 'Poids', unit: 'kg' }]
</script>
`
const graphique = '<@@chart rows={$rows} series={$series}></@@chart>'
const page      = (corps: string, script = '') => DONNEES.replace('</script>', script + '</script>') + corps

// ce qui n'existe que pour la barre dans ce que le navigateur reçoit : les rôles de ses menus, les clés de ses libellés, une icône
const BARRE = ['menuitemradio', 'radiogroup', 'chartTools', 'chartShapeOf', 'chartLegend', 'chartLine', 'chartYear', 'M1.5 12L5.5 7.5L9 10L14.5 3.5']

/** tout ce que la construction de production écrit pour le navigateur : le dossier de sortie et le manifeste */
async function build(prefix: string, files: Files, core?: string, opts: Record<string, unknown> = {}): Promise<string> {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(srcDir, rel), content)
  const outDir  = join(root, 'out')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', js: 'split', ...(core ? { coreModulesDir: core } : {}), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
  const fichiers = readdirSync(outDir).sort().filter((f) => /\.(js|json|css)$/.test(f)).map((f) => join(outDir, f))
  if (existsSync(join(root, 'bundle.js'))) fichiers.push(join(root, 'bundle.js'))
  return fichiers.map((f) => readFileSync(f, 'utf-8')).join('\n')
}

/** un catalogue qui est celui du framework, sauf un module dont le texte est changé */
function catalogue(prefix: string, module: string, change: (src: string) => string): string {
  const dir = join(mjsTmp(prefix), 'core-modules')
  mkdirSync(dir, { recursive: true })
  for (const f of readdirSync(CATALOG)) copyFileSync(join(CATALOG, f), join(dir, f))
  const avant = readFileSync(join(CATALOG, module), 'utf-8')
  const apres = change(avant)
  assert.notEqual(apres, avant, 'le module du catalogue est bien changé')
  writeFileSync(join(dir, module), apres)
  return dir
}

const present = (code: string) => BARRE.filter((n) => code.includes(n))
const manque  = (code: string) => BARRE.filter((n) => !code.includes(n))

describe('construction — une balise du cœur citée dans un commentaire ne retient plus son morceau', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('une source du projet ne cite la balise qu\'en commentaire : la barre part', () => {
    const SEULE: [string, Files][] = [
      ['un module .civet, commentaire de ligne', { 'page.mjs': page(graphique), 'outils.civet.mjs': '# à remplacer un jour par <@@chart toolbar="legend">\nexport outils = -> 1\n' }],
      ['un module .civet, bloc ###', { 'page.mjs': page(graphique), 'outils.civet.mjs': "###\nfabriquait autrefois document.createElement('mjs-core-chart')\n###\nexport outils = -> 1\n" }],
      ['un module .coffee', { 'page.mjs': page(graphique), 'outils.coffee.mjs': '# ancien : <mjs-core-chart toolbar="legend">\noutils = -> 1\n' }],
      ['le script d\'un composant', { 'page.mjs': page(graphique, '  # à remplacer un jour par <@@chart toolbar>\n') }],
      ['une balise dynamique dans un commentaire HTML', { 'page.mjs': page(graphique + '\n<!-- ancien : <@element $t toolbar="legend"></@element> -->\n', "  $t = 'div'\n") }],
      ['une balise dynamique citée dans un commentaire du script', { 'page.mjs': page(graphique, '  # <@module $c {...$p}> remplacé par le graphique\n') }],
      ['un partiel qui la cite dans un commentaire HTML', { '_note.mjs': '<!-- <@module $c {...$p}></@module> -->\n<p>note</p>\n', 'page.mjs': page('<main>' + graphique + '<@include note></main>') }],
      ['un module .js, commentaire de ligne', { 'page.mjs': page(graphique), 'outils.js': "// ancien : document.createElement('mjs-core-chart')\nexport const outils = () => 1\n" }],
      ['un module .ts, bloc de commentaire', { 'page.mjs': page(graphique), 'outils.ts': '/* ancien : <@@chart toolbar="legend"> */\nexport const outils = (n: number): number => n\n' }],
      ['une balise dynamique dont seule une valeur d\'attribut nomme l\'attribut', { 'page.mjs': page(graphique + '\n<@element $t title="sans toolbar"></@element>\n', "  $t = 'div'\n") }],
      ['un module .coffee, une division entière // puis un commentaire #', { 'page.mjs': page(graphique), 'outils.coffee': 'export moitie = (n) -> n // 2 # ancien : <mjs-core-chart toolbar="legend">\n' }],
      ['la valeur texte d\'un attribut qui cite le nom de la balise sans `<`', { 'page.mjs': page(graphique + '\n<@brut html="mjs-core-chart toolbar=legend"></@brut>\n<span title="@@chart">voir</span>\n'), 'brut.mjs': '<div>{{ $html }}</div>\n' }],
      ['une classe .class.mjs qui ne cite la balise qu\'en commentaire', { 'page.mjs': page(graphique + '\n<button @click={µOutils.un()}>un</button>\n'), 'Outils.class.mjs': "class Outils\n  # ancien : document.createElement 'mjs-core-chart'\n  un = -> 1\n" }],
    ]
    for (const [nom, files] of SEULE) {
      it(nom, async () => {
        assert.deepEqual(present(await build('cite-commentaire', files)), [])
      })
    }
  })

  describe('le même texte écrit pour de vrai, ou une source lue comme avant : la barre reste', () => {
    const BALISE          = "<mjs-core-chart toolbar='legend'></mjs-core-chart>"
    const FABRIQUE_COFFEE = "monte = (n) ->\n  moitie = n // 2; document.body.innerHTML = \"<mjs-core-chart toolbar='legend'></mjs-core-chart>\"\n  moitie\n"
    // la division entière collée à son second terme (`n //2`) : Civet y voit un commentaire, CoffeeScript une division
    const FABRIQUE_COLLEE = FABRIQUE_COFFEE.replace('n // 2', 'n //2')
    const enRetrait       = (code: string) => code.replace(/^(?=.)/gm, '  ')
    const VRAI: [string, Files, Record<string, unknown>?][] = [
      ['un module .coffee qui fabrique la balise après une division entière //', { 'page.mjs': page(graphique), 'fabrique.coffee': 'export ' + FABRIQUE_COFFEE }],
      ['le script coffee d\'un composant qui fabrique la balise après une division entière //', { 'page.mjs': page(graphique), 'fabrique.mjs': '<script lang="coffee">\n' + enRetrait(FABRIQUE_COFFEE) + '</script>\n<button @click={monte(4)}>graphique</button>\n' }],
      ['le script sans lang d\'un projet en CoffeeScript qui fabrique la balise après une division entière //', { 'page.mjs': page(graphique), 'fabrique.mjs': '<script>\n' + enRetrait(FABRIQUE_COFFEE) + '</script>\n<button @click={monte(4)}>graphique</button>\n' }, { defaultScriptLang: 'coffee' }],
      ['un module .coffee qui fabrique la balise après une division entière collée //2', { 'page.mjs': page(graphique), 'fabrique.coffee': 'export ' + FABRIQUE_COLLEE }],
      ['un module .coffee.mjs qui fabrique la balise après une division entière collée //2', { 'page.mjs': page(graphique), 'fabrique.coffee.mjs': 'export ' + FABRIQUE_COLLEE }],
      ['le script coffee d\'un composant qui fabrique la balise après une division entière collée //2', { 'page.mjs': page(graphique), 'fabrique.mjs': '<script lang="coffee">\n' + enRetrait(FABRIQUE_COLLEE) + '</script>\n<button @click={monte(4)}>graphique</button>\n' }],
      ['le script sans lang d\'un projet en CoffeeScript qui fabrique la balise après une division entière collée //2', { 'page.mjs': page(graphique), 'fabrique.mjs': '<script>\n' + enRetrait(FABRIQUE_COLLEE) + '</script>\n<button @click={monte(4)}>graphique</button>\n' }, { defaultScriptLang: 'coffee' }],
      ['du HTML brut {{…}} qui écrit la balise', { 'page.mjs': page(graphique + "\n<div>{{ '<mjs-core-chart toolbar=\"legend\"></mjs-core-chart>' }}</div>\n") }],
      ['du HTML brut :html=!{…} dont la valeur vient du gabarit', { 'page.mjs': page(graphique + "\n{for carte in [{ html: '<mjs-core-chart toolbar=\"legend\"></mjs-core-chart>' }]}\n<div :html=!{carte.html} contenteditable></div>\n{end}\n") }],
      ['une classe .class.mjs qui fabrique la balise', { 'page.mjs': page(graphique + '\n<button @click={µFabrique.monte()}>graphique</button>\n'), 'Fabrique.class.mjs': "class Fabrique\n  monte = -> document.body.append document.createElement 'mjs-core-chart'\n" }],
      ['un module .civet qui fabrique la balise, avec le même commentaire', { 'page.mjs': page(graphique), 'fabrique.civet.mjs': "# à remplacer un jour par <@@chart>\nexport fabrique = -> document.createElement('mjs-core-chart')\n" }],
      ['le script d\'un composant qui écrit la balise dans une chaîne', { 'page.mjs': page(graphique, "  # note\n  fabrique = (el) -> el.innerHTML = \"<mjs-core-chart toolbar='legend'></mjs-core-chart>\"\n") }],
      ['une balise dynamique écrite pour de vrai, à côté d\'un commentaire HTML', { 'page.mjs': page(graphique + '\n<!-- <@element> -->\n<@element $t toolbar="legend"></@element>\n', "  $t = 'div'\n") }],
      ['un module .js qui fabrique la balise dans une chaîne', { 'page.mjs': page(graphique), 'fabrique.js': "// note\nexport const fabrique = () => document.createElement('mjs-core-chart')\n" }],
      ['un module .ts qui fabrique la balise dans un gabarit', { 'page.mjs': page(graphique), 'fabrique.ts': '// note\nexport const fabrique = (el: HTMLElement): void => { el.innerHTML = `<mjs-core-chart toolbar="legend"></mjs-core-chart>` }\n' }],
      ['une balise dynamique écrite pour de vrai avec un étalement', { 'page.mjs': page(graphique + '\n<@module $c {...$p}></@module>\n', "  $c = 'div'\n  $p = {}\n") }],
      ['un script que l\'arbre ne lit pas sans faute (une lettre réservée) : son texte brut', { 'page.mjs': page(graphique, "  # <@@chart toolbar>\n  $lettre = 'Ꞩ'\n") }],
      ['un module .js qui fabrique la balise par la clé d\'une table', { 'page.mjs': page(graphique), 'fabrique.js': "const fabriques = { 'mjs-core-chart': (el) => el.setAttribute('toolbar', 'legend') }\nexport const monte = () => Object.entries(fabriques).forEach(([tag, init]) => init(document.body.appendChild(document.createElement(tag))))\n" }],
      ['un module .civet qui fabrique la balise par la clé d\'une table', { 'page.mjs': page(graphique), 'fabrique.civet.mjs': "fabriques = { 'mjs-core-chart': (el) -> el.setAttribute 'toolbar', 'legend' }\nexport monte = ->\n  for tag, init of fabriques\n    init document.body.appendChild document.createElement tag\n" }],
      ['le script d\'un composant qui fabrique la balise par la clé d\'une table', { 'page.mjs': page(graphique, "  fabriques = { 'mjs-core-chart': (el) -> el.setAttribute 'toolbar', 'legend' }\n") }],
      ['une prop écrite en clair par le parent, posée en HTML brut {{…}} par l\'enfant', { 'page.mjs': page(graphique + `\n<@brut html="${BALISE}"></@brut>\n`), 'brut.mjs': '<div>{{ $html }}</div>\n' }],
      ['une prop écrite en clair par le parent, posée en HTML brut :html=!{…} par l\'enfant', { 'page.mjs': page(graphique + `\n<@brut html="${BALISE}"></@brut>\n`), 'brut.mjs': '<div :html=!{$html} contenteditable></div>\n' }],
      ['la valeur texte d\'un attribut HTML qui écrit la balise <@@…>, avec du code au milieu', { 'page.mjs': page(graphique + '\n<div data-modele="<@@chart toolbar={$outils}></@@chart>"></div>\n', "  $outils = 'legend'\n") }],
      ['un gestionnaire d\'un gabarit sans HTML brut qui fabrique la balise', { 'page.mjs': page(graphique + `\n<button @click={document.body.innerHTML = "${BALISE}"}>graphique</button>\n`) }],
      ['une expression d\'un gabarit sans HTML brut qui fabrique la balise', { 'page.mjs': page(graphique + `\n<p>{document.body.insertAdjacentHTML('beforeend', "${BALISE}")}</p>\n`) }],
      ['la tête d\'un bloc d\'un gabarit sans HTML brut qui fabrique la balise', { 'page.mjs': page(graphique + `\n{if document.body.insertAdjacentHTML('beforeend', "${BALISE}") is undefined}\n<p>posé</p>\n{end}\n`) }],
      ['une expression d\'un gabarit sans HTML brut qui écrit le nom de la balise en texte : dans le doute', { 'page.mjs': page(graphique + "\n<p>{'balise mjs-core-chart'}</p>\n") }],
      ['un script ts d\'un composant aux fins de ligne \\r\\n, la balise au bout du bloc', { 'page.mjs': page(graphique), 'fabrique.mjs': '<script lang="ts">\r\n' + Array.from({ length: 40 }, (_, i) => `  const a${i} = ${i}`).join('\r\n') + "\r\n  const monte = (): void => { document.body.append(document.createElement('mjs-core-chart')) }\r\n</script>\r\n<div>graphique</div>\r\n" }],
    ]
    for (const [nom, files, opts] of VRAI) {
      it(nom, async () => {
        assert.deepEqual(manque(await build('cite-vrai', files, undefined, opts)), [])
      })
    }
  })

  describe('un autre module du catalogue cite <@@chart>', () => {
    it('dans un commentaire de son script : la barre part', async () => {
      const core = catalogue('cite-catalogue-script', 'gauge.mjs', (s) => s.replace('<script>\n', '<script>\n  # à remplacer un jour par <@@chart toolbar="legend">\n'))
      assert.deepEqual(present(await build('cite-catalogue', { 'page.mjs': page(graphique) }, core)), [])
    })

    it('dans un commentaire HTML : la barre part', async () => {
      const core = catalogue('cite-catalogue-html', 'gauge.mjs', (s) => s + '\n<!-- ancien : <mjs-core-chart toolbar="legend"></mjs-core-chart> -->\n')
      assert.deepEqual(present(await build('cite-catalogue', { 'page.mjs': page(graphique) }, core)), [])
    })

    it('par une balise de son gabarit : tout reste', async () => {
      const core = catalogue('cite-catalogue-balise', 'gauge.mjs', (s) => s + '\n<@@chart></@@chart>\n')
      assert.deepEqual(manque(await build('cite-catalogue', { 'page.mjs': page(graphique) }, core)), [])
    })

    it('dans la valeur texte d\'un attribut de son gabarit : la barre part', async () => {
      const core = catalogue('cite-catalogue-attribut', 'gauge.mjs', (s) => s + '\n<span title="<@@chart>">voir</span>\n')
      assert.deepEqual(present(await build('cite-catalogue', { 'page.mjs': page(graphique) }, core)), [])
    })

    it('dans la clé d\'un objet de son script : tout reste', async () => {
      const core = catalogue('cite-catalogue-cle', 'gauge.mjs', (s) => s.replace('<script>\n', "<script>\n  modeles = { '<mjs-core-chart></mjs-core-chart>': 1 }\n"))
      assert.deepEqual(manque(await build('cite-catalogue', { 'page.mjs': page(graphique) }, core)), [])
    })

    it('dans une chaîne de son script : tout reste', async () => {
      const core = catalogue('cite-catalogue-chaine', 'gauge.mjs', (s) => s.replace('<script>\n', "<script>\n  modele = '<mjs-core-chart></mjs-core-chart>'\n"))
      assert.deepEqual(manque(await build('cite-catalogue', { 'page.mjs': page(graphique) }, core)), [])
    })
  })
})
