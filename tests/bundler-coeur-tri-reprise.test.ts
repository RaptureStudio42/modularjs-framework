// La construction retire des modules de saisie du cœur (<@@checkbox>, <@@switch>, <@@radio>, <@@number>, <@@gauge>, <@@knob>, <@@select>) le code qui écrit leur
// état de départ dans leur balise (`checked`, `group`, `value`) quand l'appli ne reprend aucune page rendue par le serveur (production seulement) : seul le serveur
// l'exécute, et une appli sans rendu serveur le recevait pour rien (de 40 à 100 octets gzip par module). Même mécanisme que `other` et `group` (repères `@@` dans le
// fichier du module) ; la décision est un fait de l'appli, `coreResumeWanted()` : celui-là même qui embarque le moteur de reprise (mjs_hydrate.ts), c'est-à-dire un
// mode de rendu qui adopte le DOM du serveur (`ssr:markers`, `ssr:positional`, `ssr:diff`, par défaut ou sur une route) ou `runtime: ['hydrate']`.
// Le développement garde tout, une copie éjectée garde tout.
//
// Statique, avec un Bundler réel et le catalogue réel du framework. Ce que le code d'état de départ met dans ce que le navigateur reçoit : la lecture du drapeau
// `µ.server` (deux usages par module, l'état de départ et la marque du champ caché ; trois pour le radio qui écrit aussi son groupe), qui survit à la minification.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { selectCoreSections, RESUME_LABEL } from '../src/bundler/core-sections.js'
import { mjsTmp } from './helpers/tmp.js'

type Files   = Record<string, string>
type Chunks  = Record<string, string>
type Options = Record<string, unknown>

const MODULES = ['checkbox', 'switch', 'radio', 'number', 'gauge', 'knob', 'select'] as const
const CATALOG = fileURLToPath(new URL('../src/core-modules/', import.meta.url))

// la page porte les sept modules, chacun avec l'état que la page lui donne
const HOTE = [
  '<script>',
  '  $a = true',
  '  $n = 3',
  '  $v = 40',
  '  $s = \'fr\'',
  '  $r = \'x\'',
  '</script>',
  '<@@checkbox name="c" checked={$a}>c</@@checkbox>',
  '<@@switch name="w" checked={$a}>w</@@switch>',
  '<@@radio name="r" value="x" group={$r}>r</@@radio>',
  '<@@number name="n" value={$n}></@@number>',
  '<@@gauge name="g" value={$v}></@@gauge>',
  '<@@knob name="k" value={$v}></@@knob>',
  '<@@select name="p" value={$s}><@@option value="fr">France</@@option></@@select>',
].join('\n')

const FICHIERS: Files = { 'hote.mjs': HOTE }

const PROD     = { env: 'prod' }
const PROD_TXT = { env: 'prod', minify: false }
const DEV      = { env: 'dev' }

// des réglages où aucune page n'est reprise : pas de rendu serveur, ou un rendu que le navigateur jette puis refait
const SANS: [string, Options][] = [
  ['aucun bloc render', {}],
  ['render.default: csr', { render: { default: 'csr' } }],
  ['render.default: prerender (rien à adopter)', { render: { default: 'prerender' } }],
  ['render.default: ssr (rendre puis remplacer)', { render: { default: 'ssr' } }],
  ['render.default: ssr:replace', { render: { default: 'ssr:replace' } }],
  ['des routes rendues sans reprise', { render: { default: 'prerender', routes: { '/': { component: 'mjs-hote' }, '/x': { component: 'mjs-hote', mode: 'ssr' } } } }],
  ['une liste de modules d\'exécution qui ne cite pas hydrate', { runtime: ['router'] }],
]

// des réglages où le navigateur reprend une page du serveur : le moteur de reprise part avec
const AVEC: [string, Options][] = [
  ['render.default: ssr:markers', { render: { default: 'ssr:markers' } }],
  ['render.default: ssr:positional', { render: { default: 'ssr:positional' } }],
  ['render.default: ssr:diff', { render: { default: 'ssr:diff' } }],
  ['une seule route en ssr:diff, le reste prérendu', { render: { default: 'prerender', routes: { '/': { component: 'mjs-hote' }, '/x': { component: 'mjs-hote', mode: 'ssr:diff' } } } }],
  ['runtime: [\'hydrate\'] sans bloc render (un serveur qui rend par l\'API)', { runtime: ['hydrate'] }],
  ['runtime: [\'router\', \'hydrate\'] avec une page rendue sans reprise', { runtime: ['router', 'hydrate'], render: { default: 'ssr' } }],
]

interface Built { root: string, srcDir: string, outDir: string, bundler: Bundler }

function appOf(prefix: string, files: Files, opts: Options = {}, core?: string): Built {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(srcDir, rel), content)
  const outDir  = join(root, 'out')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts, ...(core ? { coreModulesDir: core } : {}) } as any)
  return { root, srcDir, outDir, bundler }
}

async function compile(app: Built): Promise<void> {
  const stats = await app.bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
}

/** tout ce que le dossier de sortie porte d'un module cœur (le code et son style) */
function coreOf(outDir: string, prefix: string): string {
  // le nom du fichier du cœur, que le module importe, suit les briques que l'appli utilise : il ne compte pas dans la comparaison
  return readdirSync(outDir).filter((f) => f.startsWith(prefix)).sort().map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n').replace(/mjs_core-[0-9a-z]{5}\.js/g, 'mjs_core-X.js')
}

const chunksOf = (outDir: string): Chunks => Object.fromEntries(MODULES.map((m) => [m, coreOf(outDir, `core-${m}-`)]))

async function build(prefix: string, opts: Options, files: Files = FICHIERS, core?: string): Promise<Chunks> {
  const app = appOf(prefix, files, opts, core)
  await compile(app)
  return chunksOf(app.outDir)
}

/** une ligne de repère qui sort : jamais */
const leaks = (code: string): string[] => code.split('\n').filter((l) => /(?:^|\s)(?:#|\/\/|<!--) @@(?:\s|$)/.test(l) && !/^\s*(?:#|\/\/) /.test(l))

/** le code seul : les commentaires (la légende des repères reste dans le code non minifié) ne comptent pas */
const sansNotes = (code: string): string => code.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

/** combien de fois le module lit le drapeau du serveur (`µ.server` non minifié, `x.server` minifié) */
const lectures = (code: string): number => (sansNotes(code).match(/\.server\b/g) ?? []).length

const gzip = (code: string): number => gzipSync(Buffer.from(code)).length

/**
 * le module lu sans le filtre du build pour ce seul fait : le morceau `reprise` gardé (`garder`) ou retiré, repères de reprise en moins ; les autres repères (`other` de la
 * liste) restent tels quels, le filtre du build les traite pareil des deux côtés. Une ligne retirée devient une ligne vide, les numéros de ligne ne bougent pas
 */
function lireReprise(texte: string, garder: boolean): string {
  const pile: string[] = []
  const sortie: string[] = []
  for (const ligne of texte.split('\n')) {
    const ouvre = /^\s*# @@ (\S.*?)\s*$/.exec(ligne)
    const ferme = /^\s*# @@\s*$/.test(ligne)
    const fin   = /^(.*\S)\s+# @@ reprise\s*$/.exec(ligne)
    if (ouvre) pile.push(ouvre[1])
    const etait = ferme ? pile.pop() : undefined
    if ((ouvre && ouvre[1] === RESUME_LABEL) || etait === RESUME_LABEL) {
      sortie.push('')
      continue
    }
    if (pile.includes(RESUME_LABEL)) {
      sortie.push(garder ? ligne : '')
      continue
    }
    sortie.push(fin ? (garder ? fin[1] : '') : ligne)
  }
  return sortie.join('\n')
}

/** un catalogue de modules cœur qui est celui du framework, sauf les sept modules de saisie, remplacés par leur texte lu avec ou sans le morceau `reprise` */
function catalogueReprise(prefix: string, garder: boolean): string {
  const dir = join(mjsTmp(prefix), 'core-modules')
  mkdirSync(dir, { recursive: true })
  for (const f of readdirSync(CATALOG)) copyFileSync(join(CATALOG, f), join(dir, f))
  for (const m of MODULES) writeFileSync(join(dir, `${m}.mjs`), lireReprise(readFileSync(join(CATALOG, `${m}.mjs`), 'utf-8'), garder))
  return dir
}

describe('les repères `reprise` des sept modules de saisie — le texte des fichiers', () => {
  const garde = (kind: string) => kind === 'piece'
  const sans  = (kind: string, attr: string) => attr === RESUME_LABEL ? false : kind === 'piece'

  for (const m of MODULES) {
    const file = join(CATALOG, `${m}.mjs`)
    const src  = readFileSync(file, 'utf-8')

    it(`${m} : le fichier tel quel porte le code d'état de départ sous un repère, et le repère s'ouvre et se ferme`, () => {
      assert.match(src, /# @@ reprise\b/)
      assert.ok(src.includes('µserver'), 'le fichier lit le drapeau du serveur')
      assert.doesNotThrow(() => selectCoreSections(file, src, garde))
      assert.doesNotThrow(() => selectCoreSections(file, src, sans))
    })

    it(`${m} : avec le morceau, aucun repère ne sort et les numéros de ligne sont ceux du fichier`, () => {
      const full = selectCoreSections(file, src, garde)
      assert.deepEqual(leaks(full), [])
      assert.equal(full.split('\n').length, src.split('\n').length)
      assert.ok(full.includes('reflect') && full.includes('µserver'))
    })

    it(`${m} : sans le morceau, plus de lecture du drapeau du serveur, plus de reflect ; le reste est intact`, () => {
      const lean = selectCoreSections(file, src, sans)
      assert.deepEqual(leaks(lean), [])
      assert.equal(lean.split('\n').length, src.split('\n').length)
      assert.equal(lean.includes('µserver'), false)
      assert.equal(/\breflect\b/.test(lean.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')), false)
      assert.ok(lean.replace(/\n{2,}/g, '\n').length < src.length, 'plus court')
      assert.ok(lean.includes('hiddenInput') || m === 'select', 'le champ caché du formulaire reste')
    })
  }
})

describe('construction — le code d\'état de départ des modules de saisie suit les pages reprises du serveur', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('production, aucune page reprise : plus de lecture du drapeau du serveur dans les sept modules', () => {
    for (const [nom, opts] of SANS) {
      it(`${nom}`, async () => {
        const code = await build('reprise-sans', { ...PROD, ...opts })
        for (const m of MODULES) {
          assert.ok(code[m].length > 3000, `${m} : le module est bien là (${code[m].length} octets)`)
          assert.equal(lectures(code[m]), 0, `${m} : le drapeau du serveur n'est plus lu`)
          assert.deepEqual(leaks(code[m]), [], `${m} : aucun repère ne sort`)
        }
      })
    }

    it('non minifiée : ni reflect, ni µ.server, ni attribut écrit pour le serveur', async () => {
      const code = await build('reprise-sans-noms', PROD_TXT)
      for (const m of MODULES) {
        const texte = sansNotes(code[m])
        assert.equal(/\breflect\b/.test(texte), false, `${m} : reflect est parti`)
        assert.equal(texte.includes('µ.server'), false, `${m} : µ.server est parti`)
        assert.deepEqual(leaks(code[m]), [], `${m} : aucun repère ne sort`)
      }
    })

    it('chaque module est plus léger que celui d\'une appli qui reprend une page, en brut comme en gzip', async () => {
      const sans = await build('reprise-poids-sans', PROD)
      const avec = await build('reprise-poids-avec', { ...PROD, render: { default: 'ssr:markers' } })
      for (const m of MODULES) {
        assert.ok(sans[m].length < avec[m].length - 100, `${m} : ${sans[m].length} octets sans, ${avec[m].length} avec`)
        assert.ok(gzip(sans[m]) < gzip(avec[m]) - 20, `${m} : ${gzip(sans[m])} gzip sans, ${gzip(avec[m])} avec`)
      }
    })

    it('et le module émis est le fichier lu sans le morceau, octet pour octet', async () => {
      const reel = await build('reprise-sans-identique', PROD)
      const ref  = await build('reprise-sans-identique-ref', PROD, FICHIERS, catalogueReprise('reprise-catalogue-sans', false))
      for (const m of MODULES) assert.equal(reel[m], ref[m], m)
    })
  })

  describe('production, l\'appli reprend une page du serveur : tout reste, de quelque façon qu\'elle le demande', () => {
    for (const [nom, opts] of AVEC) {
      it(`${nom}`, async () => {
        const code = await build('reprise-avec', { ...PROD, ...opts })
        for (const m of MODULES) {
          assert.equal(lectures(code[m]), m === 'radio' ? 3 : 2, `${m} : le drapeau du serveur est lu (état de départ écrit dans la balise, marque du champ caché)`)
          assert.deepEqual(leaks(code[m]), [], `${m} : aucun repère ne sort`)
        }
      })
    }

    it('et le module émis est le fichier lu avec le morceau, octet pour octet, minifié ou non', async () => {
      const catalogue = catalogueReprise('reprise-catalogue-avec', true)
      for (const mode of [PROD, PROD_TXT]) {
        const opts = { ...mode, render: { default: 'ssr:markers' } }
        const reel = await build('reprise-avec-identique', opts)
        const ref  = await build('reprise-avec-identique-ref', opts, FICHIERS, catalogue)
        for (const m of MODULES) assert.equal(reel[m], ref[m], `${m} (${mode === PROD ? 'minifié' : 'non minifié'})`)
      }
    })
  })

  describe('développement : tout reste toujours', () => {
    for (const [nom, opts] of [['aucun bloc render', {}], ['render.default: ssr', { render: { default: 'ssr' } }], ['render.default: ssr:markers', { render: { default: 'ssr:markers' } }]] as [string, Options][]) {
      it(`${nom}`, async () => {
        const code = await build('reprise-dev', { ...DEV, ...opts })
        for (const m of MODULES) {
          assert.equal(lectures(code[m]), m === 'radio' ? 3 : 2, `${m} : le drapeau du serveur est lu`)
          assert.deepEqual(leaks(code[m]), [], `${m} : aucun repère ne sort`)
        }
      })
    }
  })

  describe('la décision : coreResumeWanted()', () => {
    const MARQUE_HYDRATE = 'µ.Element.prototype._mjs_hydrateA = function'

    it('réglage pur : connue avant tout compile(), jamais \'unknown\' (qui vaudrait \'yes\')', () => {
      for (const [nom, opts] of SANS) assert.equal(appOf('reprise-decision-avant-sans', FICHIERS, { ...PROD, ...opts }).bundler.coreResumeWanted(), 'no', nom)
      for (const [nom, opts] of AVEC) assert.equal(appOf('reprise-decision-avant-avec', FICHIERS, { ...PROD, ...opts }).bundler.coreResumeWanted(), 'yes', nom)
    })

    it('c\'est le signal du moteur de reprise : le cœur porte mjs_hydrate.ts exactement quand la décision est \'yes\'', async () => {
      for (const [nom, opts] of [...SANS, ...AVEC]) {
        const app = appOf('reprise-decision-moteur', FICHIERS, { ...DEV, ...opts })
        await compile(app)
        const coeur = readdirSync(app.outDir).find((f) => /^mjs_core-/.test(f))
        assert.ok(coeur, 'mjs_core-*.js doit exister')
        const moteur = readFileSync(join(app.outDir, coeur!), 'utf-8').includes(MARQUE_HYDRATE)
        assert.equal(app.bundler.coreResumeWanted() === 'yes', moteur, `${nom} : décision ${app.bundler.coreResumeWanted()}, moteur ${moteur ? 'présent' : 'absent'}`)
      }
    })
  })

  describe('une copie éjectée du module garde tout, et marche', () => {
    it('copiée telle quelle dans le projet : un composant du projet, les repères y sont des commentaires', async () => {
      const copie = readFileSync(join(CATALOG, 'checkbox.mjs'), 'utf-8')
      const app   = appOf('reprise-ejection', { 'ma-case.mjs': copie, 'page.mjs': '<main><@ma-case name="x"></@ma-case><@@checkbox name="y">y</@@checkbox></main>' }, PROD)
      await compile(app)
      const mine = readdirSync(app.outDir).filter((f) => /^ma-case-.*\.js$/.test(f)).map((f) => readFileSync(join(app.outDir, f), 'utf-8')).join('\n')
      assert.equal(lectures(mine), 2, 'la copie garde le code d\'état de départ et la marque du champ caché')
      assert.equal(lectures(coreOf(app.outDir, 'core-checkbox-')), 0, 'le module cœur de la même appli est trié, lui')
    })
  })
})
