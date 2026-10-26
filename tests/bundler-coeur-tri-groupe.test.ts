// La construction retire les groupes de <@@sortable> quand aucune liste de l'appli n'écrit `group`, en développement comme en production : ce que le module
// cœur envoie dépend de ce que les pages écrivent, par le même mécanisme que la partie « Autre » de <@@select> (repères `@@` dans le fichier
// du module, décision `coreAttrWrittenStrict(<module du fichier>, <attribut du repère>)`). Une copie éjectée garde tout,
// et le module cœur en cache suit l'appli (mode veille : ajouter puis retirer `group` dans une page change le module émis).
//
// Statique, avec un Bundler réel et le catalogue réel du framework ; un seul test monte les listes dans happy-dom (l'avertissement du
// développement). Les noms propres aux groupes qu'on cherche dans la sortie : les clés et les textes des annonces (ils survivent à la
// minification), et — en production non minifiée — les noms des fonctions et des états.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { transformSync } from 'esbuild'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'

type Files = Record<string, string>

const SORTABLE = fileURLToPath(new URL('../src/core-modules/sortable.mjs', import.meta.url))
const SCRIPT   = '<script>\n  $l = [{ id: 1, t: \'a\' }, { id: 2, t: \'b\' }]\n  $m = [{ id: 3, t: \'c\' }]\n  $nom = \'g\'\n  $p = { handle: \'.p\' }\n  keep = (e)-> $l = $l.slice()\n</script>\n'
const liste    = (attrs = '', data = '$l') => `<@@sortable ${attrs}>{for x in ${data} by id}<div class="p">{x.t}</div>{end}</@@sortable>`

// ce qui n'existe que pour les groupes dans ce que le navigateur reçoit
const GROUPE_MINIFIE = ['sortableGrabGroup', 'sortableHop', 'sortableEnter', 'sortableLeave', 'sortableNamed', 'sortableUnnamed', 'changer de groupe', 'change group', 'Sortie vers', 'Moved out to', '{list}']
const GROUPE_NOMS    = ['sortableLists', 'members', 'enterOf', 'leaveOf', 'sideOf', 'parentOf', 'childOf', 'hop', 'groupName', 'gapsFor', 'listValue', 'setValue', 'emitSort', 'whereOf']
const AVIS           = 'but no page of the application writes that attribute'

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

async function build(prefix: string, files: Files, opts: Record<string, unknown> = {}): Promise<Built & { code: string }> {
  const app   = appOf(prefix, files, opts)
  const stats = await app.bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
  return { ...app, code: coreOf(app.outDir, 'core-sortable') }
}

/** tout ce que le dossier de sortie porte d'un module cœur (le code et son style) */
function coreOf(outDir: string, prefix: string): string {
  // le nom du fichier du cœur, que le module importe, suit les briques que l'appli utilise : il ne compte pas dans la comparaison
  return readdirSync(outDir).filter((f) => f.startsWith(prefix)).sort().map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n').replace(/mjs_core-[0-9a-z]{5}\.js/g, 'mjs_core-X.js')
}

/** une ligne de repère qui sort : jamais */
const leaks = (code: string): string[] => code.split('\n').filter((l) => /(?:^|\s)(?:#|\/\/|<!--) @@(?:\s|$)/.test(l) && !/^\s*(?:#|\/\/) /.test(l))

const manque  = (code: string, noms: string[]) => noms.filter((n) => !code.includes(n))
const present = (code: string, noms: string[]) => noms.filter((n) => code.includes(n))
const nomme   = (code: string, noms: string[]) => noms.filter((n) => new RegExp(`\\b${n}\\b`).test(code))
/** le code seul : les commentaires (la légende des repères reste dans le code non minifié) ne comptent pas */
const sansNotes = (code: string): string => code.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

/** le module tel qu'il était avant les repères, lu SANS le filtre du build : lignes de repère en moins, bouts de ligne rognés, l'autre forme et l'avertissement du développement absents ; aucune de ces applis n'écrit de transition : le morceau du fondu est absent et son autre forme (écrite en commentaire) remise en code */
function sansReperes(texte: string): string {
  const marques = [/^\s*# @@(?: (.+?))?\s*$/, /^\s*\/\/ @@(?: (.+?))?\s*$/, /^\s*<!-- @@(?: (.+?))? -->\s*$/]
  const pile: string[] = []
  const sortie: string[] = []
  for (const ligne of texte.split('\n')) {
    const marque = marques.map((re) => re.exec(ligne)).find((m) => m)
    if (marque) {
      if (marque[1]) pile.push(marque[1])
      else pile.pop()
      sortie.push('')
      continue
    }
    if (pile.some((etiquette) => etiquette !== 'group')) {
      sortie.push('')
      continue
    }
    const fin = /^(.*\S)\s+# @@ (.+?)\s*$/.exec(ligne)
    if (fin) {
      sortie.push(fin[2] === 'group' ? fin[1] : fin[2] === '!transition' ? fin[1].replace(/^(\s*)# /, '$1') : '')
      continue
    }
    sortie.push(ligne.replace(/<!-- @@ group -->(.*?)<!-- @@ -->/g, '$1'))
  }
  return sortie.join('\n')
}

// un hôte monté dans happy-dom avec le code d'un vrai build de développement ; `µ.warn` recueilli
async function monter(files: Files): Promise<{ hote: any, lists: any[], warns: () => string[] }> {
  const app   = appOf('tri-groupe-avis', files)
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
  await attendre(() => !!hote._shadow && hote._shadow.querySelectorAll('mjs-core-sortable').length > 0 && Array.from(hote._shadow.querySelectorAll('mjs-core-sortable')).every((l: any) => l._state))
  await pause(300)
  return { hote, lists: Array.from(hote._shadow.querySelectorAll('mjs-core-sortable')), warns: () => Array.from(window.eval('globalThis.__warns')) as string[] }
}

const MODES = { prod: { env: 'prod' }, 'prod non minifiée': { env: 'prod', minify: false }, dev: { env: 'dev' } } as const

describe('construction — les groupes de <@@sortable> suivent ce que les pages écrivent', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('production, aucune liste n\'écrit `group` : plus rien des groupes', () => {
    const SANS: [string, Files][] = [
      ['une liste simple', { 'liste.mjs': SCRIPT + liste('value=!{$l}') }],
      ['une liste calculée (seul `sort`)', { 'liste.mjs': SCRIPT + liste('@sort={keep(e)}') }],
      ['avec une poignée', { 'liste.mjs': SCRIPT + liste('value=!{$l} handle=".p"') }],
      ['seulement l\'évènement : @group={…} écoute, il n\'allume rien', { 'liste.mjs': SCRIPT + liste('value=!{$l} @group={keep(e)}') }],
      ['l\'évènement nu : @group', { 'liste.mjs': SCRIPT + liste('@group') }],
      ['deux listes, aucune', { 'a.mjs': SCRIPT + liste('value=!{$l}'), 'b.mjs': SCRIPT + liste('value=!{$m}', '$m') }],
      ['deux listes dans un même fichier', { 'liste.mjs': SCRIPT + liste('value=!{$l}') + liste('value=!{$m}', '$m') }],
      ['une liste dans une ligne d\'une autre, sans `group`', { 'liste.mjs': '<@@sortable><section><@@sortable><div class="p">x</div></@@sortable></section></@@sortable>' }],
    ]
    for (const [nom, files] of SANS) {
      it(`${nom}`, async () => {
        const { code } = await build('tri-groupe-sans', files, MODES.prod)
        assert.ok(code.length > 5000, 'le module sortable est bien là')
        assert.deepEqual(present(code, GROUPE_MINIFIE), [])
        assert.deepEqual(leaks(code), [])
      })
    }

    it('non minifiée : ni fonction, ni état, ni avertissement du développement', async () => {
      const { code } = await build('tri-groupe-sans-noms', { 'liste.mjs': SCRIPT + liste('value=!{$l}') }, MODES['prod non minifiée'])
      assert.deepEqual(nomme(sansNotes(code), GROUPE_NOMS), [])
      assert.deepEqual(nomme(sansNotes(code), ['told', 'warning', 'group']), [])
      assert.deepEqual(present(code, [AVIS]), [])
      assert.deepEqual(leaks(code), [])
    })

    it('le module est nettement plus court que celui d\'une appli qui écrit `group`', async () => {
      const sans = (await build('tri-groupe-poids-sans', { 'liste.mjs': SCRIPT + liste('value=!{$l}') }, MODES.prod)).code
      const avec = (await build('tri-groupe-poids-avec', { 'liste.mjs': SCRIPT + liste('value=!{$l} group="g"') }, MODES.prod)).code
      assert.ok(sans.length < avec.length * 0.85, `${sans.length} octets sans, ${avec.length} avec`)
    })

    it('une appli sans aucune liste triable n\'envoie pas le module', async () => {
      const { code } = await build('tri-groupe-sans-liste', { 'accueil.mjs': '<p>bonjour</p>' }, MODES.prod)
      assert.equal(code, '')
    })
  })

  describe('production, une liste écrit `group` : tout reste, de quelque façon qu\'elle l\'écrive', () => {
    const AVEC: [string, Files][] = [
      ['group="g" sur une seule liste', { 'liste.mjs': SCRIPT + liste('value=!{$l} group="g"') }],
      ['attribut nu', { 'liste.mjs': SCRIPT + liste('value=!{$l} group') }],
      ['group={$nom} (écrit : la valeur ne se lit pas au build)', { 'liste.mjs': SCRIPT + liste('value=!{$l} group={$nom}') }],
      ['group=!{$nom} (lié)', { 'liste.mjs': SCRIPT + liste('value=!{$l} group=!{$nom}') }],
      ['en majuscules : GROUP="g"', { 'liste.mjs': SCRIPT + liste('value=!{$l} GROUP="g"') }],
      ['deux listes du même groupe', { 'liste.mjs': SCRIPT + liste('value=!{$l} group="g"') + liste('value=!{$m} group="g"', '$m') }],
      ['sur une seule de ses deux listes', { 'liste.mjs': SCRIPT + liste('value=!{$l}') + liste('value=!{$m} group="g"', '$m') }],
      ['dans un second fichier', { 'a.mjs': SCRIPT + liste('value=!{$l}'), 'b.mjs': SCRIPT + liste('value=!{$m} group="g"', '$m') }],
      ['dans un partiel <@include>', { '_liste.mjs': SCRIPT + liste('value=!{$l} group="g"'), 'page.mjs': '<main><@include liste></main>' }],
      ['dans un composant importé', { 'page.mjs': '<main><@enfant/></main>', 'enfant.mjs': SCRIPT + liste('value=!{$l} group="g"') }],
      ['balise littérale mjs-core-sortable', { 'liste.mjs': SCRIPT + '<mjs-core-sortable value=!{$l} group="g"><div class="p">x</div></mjs-core-sortable>' }],
      ['étalement `{...$p}` (on ne sait pas : tout reste)', { 'liste.mjs': SCRIPT + '<@@sortable {...$p}><div class="p">x</div></@@sortable>' }],
      ['deux niveaux : une liste dans une ligne d\'une autre', { 'liste.mjs': '<@@sortable group="g"><section><@@sortable group="g"><div class="p">x</div></@@sortable></section></@@sortable>' }],
      ['l\'attribut et l\'évènement sur la même liste', { 'liste.mjs': SCRIPT + liste('value=!{$l} group="g" @group={keep(e)}') }],
    ]
    let reference = ''
    for (const [nom, files] of AVEC) {
      it(`${nom}`, async () => {
        const { code } = await build('tri-groupe-avec', files, MODES.prod)
        assert.deepEqual(manque(code, GROUPE_MINIFIE), [])
        assert.deepEqual(leaks(code), [])
        reference ||= code
        // les noms réduits (une lettre) changent d'un build à l'autre : la taille, elle, ne bouge pas
        assert.ok(Math.abs(code.length - reference.length) <= 40, `${code.length} octets, ${reference.length} pour un \`group\` écrit sur une liste`)
      })
    }

    it('et le module émis est celui d\'avant les repères, octet pour octet (le fichier sans aucun repère, lu sans le filtre du build)', async () => {
      const files = { 'liste.mjs': SCRIPT + liste('value=!{$l} group="g"') + liste('value=!{$m} group="g"', '$m') }
      const reel  = (await build('tri-groupe-identique', files, MODES.prod)).code
      const app   = appOf('tri-groupe-identique-ref', files, MODES.prod)
      const core  = join(app.root, 'core-modules')
      mkdirSync(core, { recursive: true })
      writeFileSync(join(core, 'sortable.mjs'), sansReperes(readFileSync(SORTABLE, 'utf-8')))
      const bundler = new Bundler({ sourceDir: app.srcDir, outputDir: app.outDir, manifestPath: join(app.root, 'bundle.js'), env: 'prod', coreModulesDir: core })
      const stats   = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
      const sans = coreOf(app.outDir, 'core-sortable')
      assert.ok(sans.length > 10000, 'le module du fichier sans repère est là')
      assert.equal(reel, sans)
    })
  })

  describe('développement : la même décision que la production', () => {
    it('aucune liste n\'écrit `group` : plus rien des groupes, l\'avertissement est là', async () => {
      const { code } = await build('tri-groupe-dev-sans', { 'liste.mjs': SCRIPT + liste('value=!{$l}') }, MODES.dev)
      assert.deepEqual(present(code, GROUPE_MINIFIE), [])
      assert.deepEqual(present(code, GROUPE_NOMS), [])
      assert.ok(code.includes(AVIS), 'l\'avertissement du développement est là')
      assert.deepEqual(leaks(code), [])
    })

    it('une liste écrit `group` : tout reste, sans avertissement (il n\'a plus de raison d\'être)', async () => {
      const { code } = await build('tri-groupe-dev-avec', { 'liste.mjs': SCRIPT + liste('value=!{$l} group="g"') }, MODES.dev)
      assert.deepEqual(manque(code, GROUPE_MINIFIE), [])
      assert.deepEqual(manque(code, GROUPE_NOMS), [])
      assert.equal(code.includes(AVIS), false)
      assert.deepEqual(leaks(code), [])
    })

    it('la production, elle, n\'envoie jamais l\'avertissement', async () => {
      for (const files of [{ 'liste.mjs': SCRIPT + liste('value=!{$l}') }, { 'liste.mjs': SCRIPT + liste('value=!{$l} group="g"') }]) {
        const { code } = await build('tri-groupe-prod-avis', files, MODES['prod non minifiée'])
        assert.equal(code.includes(AVIS), false)
      }
    })
  })

  describe('mode veille : une même instance, la page change entre deux tours', () => {
    const wait = () => new Promise((r) => setTimeout(r, 1100))   // la date d'un fichier a la seconde pour grain

    for (const [nom, opts] of [['production', MODES.prod], ['développement', MODES.dev]] as const) {
      it(`${nom} : ajouter puis retirer \`group\` dans une page recompile le module cœur`, async () => {
        const app = appOf('tri-groupe-veille', { 'liste.mjs': SCRIPT + liste('value=!{$l}') }, opts)
        const tour = async () => {
          const stats = await app.bundler.compile()
          assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
          return coreOf(app.outDir, 'core-sortable')
        }
        const un = await tour()
        await wait()
        writeFileSync(join(app.srcDir, 'liste.mjs'), SCRIPT + liste('value=!{$l} group="g"'))
        const deux = await tour()
        await wait()
        writeFileSync(join(app.srcDir, 'liste.mjs'), SCRIPT + liste('value=!{$l}'))
        const trois = await tour()
        assert.notEqual(un, deux, 'ajouter `group` change le module émis')
        assert.equal(trois, un, 'le retirer rend le module du départ')
        assert.deepEqual(manque(deux, GROUPE_MINIFIE), [], 'avec `group` : tout')
        if (nom === 'production') {
          assert.deepEqual(present(un, GROUPE_MINIFIE), [], 'sans : plus rien')
          assert.deepEqual(present(trois, GROUPE_MINIFIE), [])
        }
        else {
          assert.ok(un.includes(AVIS) && !deux.includes(AVIS) && trois.includes(AVIS), 'l\'avertissement suit : présent sans `group`, absent avec')
        }
      })
    }

    it('un tour sans rapport avec la liste (autre fichier modifié) ne change pas le module', async () => {
      const app = appOf('tri-groupe-veille-voisin', { 'liste.mjs': SCRIPT + liste('value=!{$l}'), 'voisin.mjs': '<p>un</p>' }, MODES.prod)
      await app.bundler.compile()
      const un = coreOf(app.outDir, 'core-sortable')
      await wait()
      writeFileSync(join(app.srcDir, 'voisin.mjs'), '<p>deux</p>')
      await app.bundler.compile()
      assert.equal(coreOf(app.outDir, 'core-sortable'), un)
    })
  })

  describe('la décision suit le module du fichier et l\'attribut du repère : celle de <@@select> reste la sienne', () => {
    const SELECT = '<@@select name="s"><@@option value="a">A</@@option></@@select>'
    const AUTRE  = ['select-other-edit', 'select-other-ok', 'with-other']

    it('coreAttrWritten répond par module : `group` de sortable, `other` de select, chacun pour soi', async () => {
      const app = appOf('tri-groupe-decisions', { 'liste.mjs': SCRIPT + liste('value=!{$l} group="g"') + SELECT.replace('name="s"', 'name="s" other') })
      await app.bundler.compile()
      assert.equal(app.bundler.coreAttrWritten('sortable', 'group'), 'yes')
      assert.equal(app.bundler.coreAttrWritten('select', 'other'), 'yes')
      assert.equal(app.bundler.coreAttrWritten('sortable', 'other'), 'no')
      assert.equal(app.bundler.coreAttrWritten('select', 'group'), 'no')
    })

    it('production : `other` sur une liste de choix ne garde pas les groupes du triable, et `group` ne garde pas « Autre »', async () => {
      const a = await build('tri-groupe-ind-a', { 'liste.mjs': SCRIPT + liste('value=!{$l}') + SELECT.replace('name="s"', 'name="s" other') }, MODES.prod)
      assert.deepEqual(present(a.code, GROUPE_MINIFIE), [], 'triable sans group')
      assert.deepEqual(manque(coreOf(a.outDir, 'core-select'), AUTRE), [], 'select avec other')
      const b = await build('tri-groupe-ind-b', { 'liste.mjs': SCRIPT + liste('value=!{$l} group="g"') + SELECT }, MODES.prod)
      assert.deepEqual(manque(b.code, GROUPE_MINIFIE), [], 'triable avec group')
      assert.deepEqual(present(coreOf(b.outDir, 'core-select'), AUTRE), [], 'select sans other')
    })

    it('avant tout compile() : \'unknown\' (jamais \'no\', qui autoriserait un retrait)', () => {
      const { bundler } = appOf('tri-groupe-avant', { 'liste.mjs': SCRIPT + liste('value=!{$l}') })
      assert.equal(bundler.coreAttrWritten('sortable', 'group'), 'unknown')
    })

    it('après compile() : \'no\' sans `group`, \'yes\' avec ; les formes d\'un évènement `group` ne comptent pas', async () => {
      const sans = appOf('tri-groupe-apres-sans', { 'liste.mjs': SCRIPT + liste('value=!{$l}') })
      await sans.bundler.compile()
      assert.equal(sans.bundler.coreAttrWritten('sortable', 'group'), 'no')
      const avec = appOf('tri-groupe-apres-avec', { 'liste.mjs': SCRIPT + liste('value=!{$l} group="g"') })
      await avec.bundler.compile()
      assert.equal(avec.bundler.coreAttrWritten('sortable', 'group'), 'yes')
      for (const attrs of ['@group={keep(e)}', '@group', '@group.once={keep(e)}']) {
        const app = appOf('tri-groupe-evenement', { 'liste.mjs': SCRIPT + liste(attrs) })
        await app.bundler.compile()
        assert.equal(app.bundler.coreAttrWritten('sortable', 'group'), 'no', attrs)
      }
    })
  })

  describe('une copie éjectée du module garde tout, et marche', () => {
    it('copiée telle quelle dans le projet : un composant du projet, les repères y sont des commentaires', async () => {
      const copie = readFileSync(SORTABLE, 'utf-8')
      for (const mode of ['dev', 'prod'] as const) {
        const app = appOf('tri-groupe-ejection', { 'ma-liste.mjs': copie, 'page.mjs': `${SCRIPT}<main><@ma-liste group="g"><div>a</div></@ma-liste>${liste('value=!{$l}')}</main>` }, { env: mode })
        const stats = await app.bundler.compile()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
        const files = readdirSync(app.outDir)
        const mine  = files.filter((f) => /^ma-liste-.*\.js$/.test(f)).map((f) => readFileSync(join(app.outDir, f), 'utf-8')).join('\n')
        assert.deepEqual(manque(mine, GROUPE_MINIFIE), [], `${mode} : la copie garde les groupes`)
        // le script de la copie nomme la balise du module (ses textes citent <@@sortable>) : dans le doute, le module cœur de la même appli garde les groupes
        assert.deepEqual(manque(coreOf(app.outDir, 'core-sortable'), GROUPE_MINIFIE), [], `${mode} : le module cœur garde les groupes, dans le doute`)
        assert.doesNotThrow(() => transformSync(mine, { format: 'esm' }), `${mode} : le code de la copie se lit`)
      }
    })
  })

  describe('un catalogue de modules cœur personnalisé', () => {
    it('un sortable.mjs sans repère passe tel quel, avec ou sans `group` écrit', async () => {
      const plain = '<script>\n  $value = null\n</script>\n<span class="neuf">{$value}</span>\n<style>\n.neuf\n  color: red\n</style>\n'
      for (const attrs of ['', 'group="g"']) {
        const app  = appOf('tri-groupe-catalogue', { 'liste.mjs': liste(attrs) }, { env: 'prod' })
        const core = join(app.root, 'core-modules')
        mkdirSync(core, { recursive: true })
        writeFileSync(join(core, 'sortable.mjs'), plain)
        const bundler = new Bundler({ sourceDir: app.srcDir, outputDir: app.outDir, manifestPath: join(app.root, 'bundle.js'), env: 'prod', coreModulesDir: core })
        const stats = await bundler.compile()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
        assert.ok(coreOf(app.outDir, 'core-sortable').includes('neuf'))
      }
    })

    it('un repère mal fermé dans le module est une erreur de build qui nomme le fichier', async () => {
      const app  = appOf('tri-groupe-catalogue-casse', { 'liste.mjs': liste() }, { env: 'prod' })
      const core = join(app.root, 'core-modules')
      mkdirSync(core, { recursive: true })
      writeFileSync(join(core, 'sortable.mjs'), '<script>\n  # @@ group\n  $a = 1\n</script>\n<p></p>\n')
      const bundler = new Bundler({ sourceDir: app.srcDir, outputDir: app.outDir, manifestPath: join(app.root, 'bundle.js'), env: 'prod', coreModulesDir: core })
      const stats = await bundler.compile()
      assert.ok(stats.errors.some((e: Error) => /sortable\.mjs/.test(e.message) && /pas fermée/.test(e.message)), stats.errors.map((e: Error) => e.message).join('\n'))
    })
  })

  describe('l\'avertissement du développement (happy-dom)', () => {
    it('aucune page n\'écrit `group` et un script le donne à une liste : un avertissement, une seule fois même pour deux listes', async () => {
      const { lists, warns } = await monter({ 'hote.mjs': SCRIPT + liste('value=!{$l}') + liste('value=!{$m}', '$m') })
      assert.equal(lists.length, 2)
      assert.deepEqual(warns(), [], 'rien tant que personne ne donne `group`')
      lists[0].setAttribute('group', 'g')
      await attendre(() => warns().length > 0, 5000)
      lists[1].setAttribute('group', 'g')
      await pause(400)
      assert.equal(warns().length, 1, warns().join('\n'))
      assert.match(warns()[0], /^\[ModularJS\] <@@sortable> : une liste reçoit « group » d'un script/)
      assert.match(warns()[0], /Écrivez/)
    })

    it('une page écrit `group` sur une autre liste : aucun avertissement', async () => {
      const { lists, warns } = await monter({ 'hote.mjs': SCRIPT + liste('value=!{$l} group="g"') + liste('value=!{$m}', '$m') })
      lists[1].setAttribute('group', 'g')
      await pause(400)
      assert.deepEqual(warns(), [])
    })
  })
})
