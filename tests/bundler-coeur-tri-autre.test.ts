// La construction retire la partie « Autre » de <@@select> quand aucune liste de l'appli n'écrit `other` (production seulement) :
// ce que le module cœur envoie dépend de ce que les pages écrivent. Le développement garde tout, une copie éjectée garde tout, et le
// module cœur en cache suit l'appli (mode veille : ajouter puis retirer `other` dans une page change le module émis).
//
// Statique, avec un Bundler réel et le catalogue réel du framework ; un seul test monte la liste dans happy-dom (l'avertissement du
// développement). Les noms propres à « Autre » qu'on cherche dans la sortie : des classes de style, des clés de libellés, le suffixe du
// champ caché (ils survivent à la minification), et — en production non minifiée — les noms des fonctions.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import v8 from 'node:v8'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import { transformSync } from 'esbuild'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'

type Files = Record<string, string>

const SELECT  = fileURLToPath(new URL('../src/core-modules/select.mjs', import.meta.url))
const OPTIONS = '<@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option>'
const liste   = (attrs = '', name = 'pays') => `<@@select name="${name}" ${attrs}>${OPTIONS}</@@select>`

// ce qui n'existe que pour « Autre » dans ce que le navigateur reçoit
const AUTRE_MINIFIE = ['select-other-edit', 'select-other-line', 'select-other-ok', 'select-other-meta', 'select-other-count', 'with-other', 'selectOtherHint', 'selectOtherOk', '_other']
const AUTRE_NOMS    = ['otherMaxOf', 'freeOf', 'choicesOf', 'givenOf', 'listedOf', 'fitOther', 'submitOther', 'openOther', 'cancelOther', 'otherTextsOf', 'otherRowOf', 'cutText']
const AVIS          = 'dev.selectOtherScript'

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
  return { ...app, code: coreSelect(app.outDir) }
}

/** tout ce que le dossier de sortie porte du module cœur select (le code et son style) */
function coreSelect(outDir: string): string {
  // le nom du fichier du cœur, que le module importe, suit les briques que l'appli utilise : il ne compte pas dans la comparaison
  return readdirSync(outDir).filter((f) => f.startsWith('core-select')).sort().map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n').replace(/mjs_core-[0-9a-z]{5}\.js/g, 'mjs_core-X.js')
}

/** une ligne de repère qui sort : jamais */
const leaks = (code: string): string[] => code.split('\n').filter((l) => /(?:^|\s)(?:#|\/\/|<!--) @@(?:\s|$)/.test(l) && !/^\s*(?:#|\/\/) /.test(l))

const manque  = (code: string, noms: string[]) => noms.filter((n) => !code.includes(n))
const present = (code: string, noms: string[]) => noms.filter((n) => code.includes(n))

// un hôte monté dans happy-dom avec le code d'un vrai build de développement ; `µ.warn` recueilli
async function monter(files: Files): Promise<{ hote: any, lists: any[], warns: () => string[] }> {
  const app   = appOf('tri-avis', files)
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
  await attendre(() => !!hote._shadow && hote._shadow.querySelectorAll('mjs-core-select').length > 0 && Array.from(hote._shadow.querySelectorAll('mjs-core-select')).every((l: any) => l._state))
  await pause(300)
  return { hote, lists: Array.from(hote._shadow.querySelectorAll('mjs-core-select')), warns: () => Array.from(window.eval('globalThis.__warns')) as string[] }
}

// un ramasse-miettes complet, sans lancer node avec --expose-gc : le drapeau n'est levé que le temps de prendre la fonction
function collectGarbage(): void {
  v8.setFlagsFromString('--expose-gc')
  const gc = runInNewContext('gc')
  v8.setFlagsFromString('--no-expose-gc')
  gc()
}

const MODES = { prod: { env: 'prod' }, 'prod non minifiée': { env: 'prod', minify: false }, dev: { env: 'dev' } } as const

describe('construction — la partie « Autre » de <@@select> suit ce que les pages écrivent', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('production, aucune liste n\'écrit `other` : plus rien de « Autre »', () => {
    const SANS: [string, Files][] = [
      ['une liste simple', { 'liste.mjs': liste() }],
      ['multiple et recherche', { 'liste.mjs': liste('multiple search') }],
      ['other-label et other-placeholder seuls (sans `other` ils ne posent rien)', { 'liste.mjs': liste('other-label="Autre" other-placeholder="Précisez"') }],
      ['seulement l\'évènement : @other={…} écoute, il n\'allume rien', { 'liste.mjs': `<script>\n$dernier = null\n</script>\n${liste('@other={$dernier = e.data}')}` }],
      ['l\'évènement nu : @other', { 'liste.mjs': `<script>\n@vu = -> null\n</script>\n${liste('@other')}` }],
      ['deux listes, aucune', { 'a.mjs': liste('', 'a'), 'b.mjs': liste('multiple', 'b') }],
    ]
    for (const [nom, files] of SANS) {
      it(`${nom}`, async () => {
        const { code } = await build('tri-sans', files, MODES.prod)
        assert.ok(code.length > 5000, 'le module select est bien là')
        assert.deepEqual(present(code, AUTRE_MINIFIE), [])
        assert.deepEqual(leaks(code), [])
      })
    }

    it('non minifiée : ni fonction, ni état, ni avertissement du développement', async () => {
      const { code } = await build('tri-sans-noms', { 'liste.mjs': liste('search') }, MODES['prod non minifiée'])
      assert.deepEqual(present(code, AUTRE_NOMS), [])
      assert.deepEqual(present(code, ['otherMax', 'otherEditing', 'otherText', 'told', AVIS]), [])
      assert.deepEqual(leaks(code), [])
    })

    it('le module est nettement plus court que celui d\'une appli qui écrit `other`', async () => {
      const sans = (await build('tri-poids-sans', { 'liste.mjs': liste('search') }, MODES.prod)).code
      const avec = (await build('tri-poids-avec', { 'liste.mjs': liste('search other') }, MODES.prod)).code
      assert.ok(sans.length < avec.length * 0.8, `${sans.length} octets sans, ${avec.length} avec`)
    })

    it('une appli sans aucune liste n\'envoie pas le module', async () => {
      const { code } = await build('tri-sans-liste', { 'accueil.mjs': '<p>bonjour</p>' }, MODES.prod)
      assert.equal(code, '')
    })
  })

  describe('production, une liste écrit `other` : tout reste, de quelque façon qu\'elle l\'écrive', () => {
    const AVEC: [string, Files][] = [
      ['attribut nu', { 'liste.mjs': liste('other') }],
      ['other="42"', { 'liste.mjs': liste('other="42"') }],
      ['other={false} (écrit : la valeur ne se lit pas au build)', { 'liste.mjs': liste('other={false}') }],
      ['sur une seule de ses deux listes', { 'liste.mjs': liste('', 'a') + liste('other', 'b') }],
      ['dans un second fichier', { 'a.mjs': liste('', 'a'), 'b.mjs': liste('other', 'b') }],
      ['dans un partiel <@include>', { '_liste.mjs': liste('other'), 'page.mjs': '<main><@include liste></main>' }],
      ['dans un composant importé', { 'page.mjs': '<main><@enfant/></main>', 'enfant.mjs': liste('other') }],
      ['balise littérale mjs-core-select', { 'liste.mjs': '<mjs-core-select name="pays" other><mjs-core-option value="fr">France</mjs-core-option></mjs-core-select>' }],
      ['étalement `{...$p}` (on ne sait pas : tout reste)', { 'liste.mjs': `<script>\n$p = { multiple: true }\n</script>\n<@@select name="pays" {...$p}>${OPTIONS}</@@select>` }],
    ]
    let reference = ''
    for (const [nom, files] of AVEC) {
      it(`${nom}`, async () => {
        const { code } = await build('tri-avec', files, MODES.prod)
        assert.deepEqual(manque(code, AUTRE_MINIFIE), [])
        assert.deepEqual(leaks(code), [])
        reference ||= code
        // les noms réduits (une lettre) changent d'un build à l'autre : la taille, elle, ne bouge pas
        assert.ok(Math.abs(code.length - reference.length) <= 40, `${code.length} octets, ${reference.length} pour un \`other\` écrit nu`)
      })
    }
  })

  describe('développement : tout reste toujours', () => {
    it('aucune liste n\'écrit `other` : tout reste, avec l\'avertissement', async () => {
      const { code } = await build('tri-dev-sans', { 'liste.mjs': liste('search') }, MODES.dev)
      assert.deepEqual(manque(code, [...AUTRE_MINIFIE, ...AUTRE_NOMS]), [])
      assert.ok(code.includes(AVIS), 'l\'avertissement du développement est là')
      assert.deepEqual(leaks(code), [])
    })

    it('une liste écrit `other` : tout reste, sans avertissement (il n\'a plus de raison d\'être)', async () => {
      const { code } = await build('tri-dev-avec', { 'liste.mjs': liste('other') }, MODES.dev)
      assert.deepEqual(manque(code, [...AUTRE_MINIFIE, ...AUTRE_NOMS]), [])
      assert.equal(code.includes(AVIS), false)
      assert.deepEqual(leaks(code), [])
    })

    it('la production, elle, n\'envoie jamais l\'avertissement', async () => {
      for (const files of [{ 'liste.mjs': liste() }, { 'liste.mjs': liste('other') }]) {
        const { code } = await build('tri-prod-avis', files, MODES['prod non minifiée'])
        assert.equal(code.includes(AVIS), false)
      }
    })
  })

  describe('mode veille : une même instance, la page change entre deux tours', () => {
    const wait = () => new Promise((r) => setTimeout(r, 1100))   // la date d'un fichier a la seconde pour grain

    for (const [nom, opts] of [['production', MODES.prod], ['développement', MODES.dev]] as const) {
      it(`${nom} : ajouter puis retirer \`other\` dans une page recompile le module cœur`, async () => {
        const app = appOf('tri-veille', { 'liste.mjs': liste('search') }, opts)
        const tour = async () => {
          const stats = await app.bundler.compile()
          assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
          return coreSelect(app.outDir)
        }
        const un = await tour()
        await wait()
        writeFileSync(join(app.srcDir, 'liste.mjs'), liste('search other'))
        const deux = await tour()
        await wait()
        writeFileSync(join(app.srcDir, 'liste.mjs'), liste('search'))
        const trois = await tour()
        assert.notEqual(un, deux, 'ajouter `other` change le module émis')
        assert.equal(trois, un, 'le retirer rend le module du départ')
        assert.deepEqual(manque(deux, AUTRE_MINIFIE), [], 'avec `other` : tout')
        if (nom === 'production') {
          assert.deepEqual(present(un, AUTRE_MINIFIE), [], 'sans : plus rien')
          assert.deepEqual(present(trois, AUTRE_MINIFIE), [])
        }
        else {
          assert.ok(un.includes(AVIS) && !deux.includes(AVIS) && trois.includes(AVIS), 'l\'avertissement suit : présent sans `other`, absent avec')
        }
      })
    }

    it('un tour sans rapport avec la liste (autre fichier modifié) ne change pas le module', async () => {
      const app = appOf('tri-veille-voisin', { 'liste.mjs': liste('search'), 'voisin.mjs': '<p>un</p>' }, MODES.prod)
      await app.bundler.compile()
      const un = coreSelect(app.outDir)
      await wait()
      writeFileSync(join(app.srcDir, 'voisin.mjs'), '<p>deux</p>')
      await app.bundler.compile()
      assert.equal(coreSelect(app.outDir), un)
    })
  })

  describe('coreAttrWritten ne se prononce qu\'une fois les références du projet lues', () => {
    it('avant tout compile() : \'unknown\' (jamais \'no\', qui autoriserait un retrait)', () => {
      const { bundler } = appOf('tri-avant', { 'liste.mjs': liste() })
      assert.equal(bundler.coreAttrWritten('select', 'other'), 'unknown')
    })

    it('après compile() : \'no\' sans `other`, \'yes\' avec', async () => {
      const sans = appOf('tri-apres-sans', { 'liste.mjs': liste() })
      await sans.bundler.compile()
      assert.equal(sans.bundler.coreAttrWritten('select', 'other'), 'no')
      const avec = appOf('tri-apres-avec', { 'liste.mjs': liste('other') })
      await avec.bundler.compile()
      assert.equal(avec.bundler.coreAttrWritten('select', 'other'), 'yes')
    })

    it('les formes d\'un évènement `other` ne comptent pas : @other={…}, @other', async () => {
      for (const attrs of ['@other={$dernier = 1}', '@other', '@other.once={$dernier = 1}']) {
        const app = appOf('tri-evenement', { 'liste.mjs': `<script>\n$dernier = 0\n</script>\n${liste(attrs)}` })
        await app.bundler.compile()
        assert.equal(app.bundler.coreAttrWritten('select', 'other'), 'no', attrs)
      }
    })

    it('un évènement et l\'attribut sur la même liste : l\'attribut compte', async () => {
      const app = appOf('tri-evenement-et-attribut', { 'liste.mjs': `<script>\n$dernier = 0\n</script>\n${liste('other @other={$dernier = 1}')}` })
      await app.bundler.compile()
      assert.equal(app.bundler.coreAttrWritten('select', 'other'), 'yes')
    })
  })

  describe('le cache ne garde pas de clé `attrs` pour une référence qui n\'en a pas', () => {
    it('références du projet : pas de clé `attrs` (ni dans le cache, ni dans les références du tour)', async () => {
      const app = appOf('tri-cache-attrs', { 'page.mjs': '<main><@enfant/>' + liste('other') + '</main>', 'enfant.mjs': '<p>un</p>' })
      await app.bundler.compile()
      await app.bundler.compile()   // le second tour revient du cache
      const refs = (app.bundler as any).pendingTagRefs as { name: string, kind: string }[]
      assert.ok(refs.some((r) => r.kind === 'raccourci-dev'), 'une référence du projet')
      assert.ok(refs.some((r) => r.kind === 'raccourci-coeur'), 'une référence cœur')
      for (const r of refs) assert.equal(Object.hasOwn(r, 'attrs'), r.kind.endsWith('coeur'), `${r.kind} ${r.name}`)
      for (const entry of (app.bundler as any).cache.values()) {
        for (const r of entry.tagRefs ?? []) assert.equal(Object.hasOwn(r, 'attrs'), r.kind.endsWith('coeur'), `cache ${r.kind} ${r.name}`)
      }
    })
  })

  describe('une copie éjectée du module garde tout, et marche', () => {
    it('copiée telle quelle dans le projet : un composant du projet, les repères y sont des commentaires', async () => {
      const copie = readFileSync(SELECT, 'utf-8')
      for (const mode of ['dev', 'prod'] as const) {
        const app = appOf('tri-ejection', { 'ma-liste.mjs': copie, 'page.mjs': `<main><@ma-liste name="pays" other>${OPTIONS}</@ma-liste>${liste('search', 'autre')}</main>` }, { env: mode })
        const stats = await app.bundler.compile()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
        const files = readdirSync(app.outDir)
        const mine  = files.filter((f) => /^ma-liste-.*\.js$/.test(f)).map((f) => readFileSync(join(app.outDir, f), 'utf-8')).join('\n')
        assert.deepEqual(manque(mine, ['select-other-edit', 'select-other-ok', 'with-other']), [], `${mode} : la copie garde « Autre »`)
        if (mode === 'prod') assert.deepEqual(present(coreSelect(app.outDir), AUTRE_MINIFIE), [], 'le module cœur de la même appli est trié, lui')
        assert.doesNotThrow(() => transformSync(mine, { format: 'esm' }), `${mode} : le code de la copie se lit`)
      }
    })
  })

  describe('une copie éjectée du module marche (happy-dom)', () => {
    it('copiée dans le projet, elle ouvre sa liste, montre la ligne « Autre » et ouvre le champ de la réponse libre', async () => {
      const { hote } = await monter({ 'ma-liste.mjs': readFileSync(SELECT, 'utf-8'), 'hote.mjs': `<@ma-liste name="pays" other>${OPTIONS}</@ma-liste>` })
      const copie = hote._shadow.querySelector('mjs-ma-liste')
      await attendre(() => !!copie._shadow?.querySelector('.select-btn'))
      copie._shadow.querySelector('.select-btn').click()
      await attendre(() => !!copie._shadow.querySelector('.select-other'))
      copie._shadow.querySelector('.select-other').click()
      await attendre(() => !!copie._shadow.querySelector('.select-other-input'))
      assert.ok(copie._shadow.querySelector('.select-other-input'), 'le champ de la réponse libre s\'ouvre')
    })
  })

  describe('un catalogue de modules cœur personnalisé', () => {
    it('un select.mjs sans repère passe tel quel, avec ou sans `other` écrit', async () => {
      const plain = '<script>\n$value = null\n</script>\n<span class="neuf">{$value}</span>\n<style>\n.neuf\n  color: red\n</style>\n'
      for (const attrs of ['', 'other']) {
        const app  = appOf('tri-catalogue', { 'liste.mjs': liste(attrs) }, { env: 'prod' })
        const core = join(app.root, 'core-modules')
        mkdirSync(core, { recursive: true })
        writeFileSync(join(core, 'select.mjs'), plain)
        writeFileSync(join(core, 'option.mjs'), '<span><slot></slot></span>\n')
        const bundler = new Bundler({ sourceDir: app.srcDir, outputDir: app.outDir, manifestPath: join(app.root, 'bundle.js'), env: 'prod', coreModulesDir: core })
        const stats = await bundler.compile()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
        assert.ok(coreSelect(app.outDir).includes('neuf'))
      }
    })

    it('un autre module du catalogue qui cite <@@select> : ses références ne se lisent qu\'après celles de select, donc tout reste (même sans `other`)', async () => {
      const reel = (nom: string) => readFileSync(fileURLToPath(new URL(`../src/core-modules/${nom}.mjs`, import.meta.url)), 'utf-8')
      for (const attrs of ['other', '']) {
        const app  = appOf('tri-catalogue-combo', { 'page.mjs': '<@@combo/>' }, { env: 'prod' })
        const core = join(app.root, 'core-modules')
        mkdirSync(core, { recursive: true })
        writeFileSync(join(core, 'select.mjs'), reel('select'))
        writeFileSync(join(core, 'option.mjs'), reel('option'))
        writeFileSync(join(core, 'combo.mjs'), `<div>${liste(attrs)}</div>\n`)
        const bundler = new Bundler({ sourceDir: app.srcDir, outputDir: app.outDir, manifestPath: join(app.root, 'bundle.js'), env: 'prod', coreModulesDir: core })
        const stats = await bundler.compile()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
        const code = coreSelect(app.outDir)
        assert.ok(code.length > 5000, 'le module select est là')
        assert.deepEqual(manque(code, AUTRE_MINIFIE), [], `gabarit « ${attrs} » : rien n\'est retiré`)
      }
    })

    it('un modèle en fichier d\'un module cœur (select.compact.mjs) n\'est pas trié : ses morceaux restent', async () => {
      const reel = (nom: string) => readFileSync(fileURLToPath(new URL(`../src/core-modules/${nom}.mjs`, import.meta.url)), 'utf-8')
      const app  = appOf('tri-catalogue-modele', { 'page.mjs': liste('layout="compact"') }, { env: 'prod' })
      const core = join(app.root, 'core-modules')
      mkdirSync(core, { recursive: true })
      for (const nom of ['select', 'select.compact', 'option']) writeFileSync(join(core, nom + '.mjs'), reel(nom.replace(/\.compact$/, '')))
      const bundler = new Bundler({ sourceDir: app.srcDir, outputDir: app.outDir, manifestPath: join(app.root, 'bundle.js'), env: 'prod', coreModulesDir: core })
      const stats = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
      const modele = readdirSync(app.outDir).filter((f) => f.startsWith('core-select--compact')).map((f) => readFileSync(join(app.outDir, f), 'utf-8')).join('\n')
      assert.ok(modele.length > 5000, `le module du modèle est là (${readdirSync(app.outDir).join(', ')})`)
      assert.deepEqual(manque(modele, AUTRE_MINIFIE), [])
    })

    it('un repère mal fermé dans un module cœur est une erreur de build qui nomme le fichier', async () => {
      const app  = appOf('tri-catalogue-casse', { 'liste.mjs': liste() }, { env: 'prod' })
      const core = join(app.root, 'core-modules')
      mkdirSync(core, { recursive: true })
      writeFileSync(join(core, 'select.mjs'), '<script>\n  # @@ other\n  $a = 1\n</script>\n<p></p>\n')
      writeFileSync(join(core, 'option.mjs'), '<span><slot></slot></span>\n')
      const bundler = new Bundler({ sourceDir: app.srcDir, outputDir: app.outDir, manifestPath: join(app.root, 'bundle.js'), env: 'prod', coreModulesDir: core })
      const stats = await bundler.compile()
      assert.ok(stats.errors.some((e: Error) => /select\.mjs/.test(e.message) && /pas fermée/.test(e.message)), stats.errors.map((e: Error) => e.message).join('\n'))
    })
  })

  describe('l\'avertissement du développement (happy-dom)', () => {
    it('aucune page n\'écrit `other` et un script le donne à une liste : un avertissement, une seule fois même pour deux listes', async () => {
      const { lists, warns } = await monter({ 'hote.mjs': liste('', 'a') + liste('', 'b') })
      assert.equal(lists.length, 2)
      assert.deepEqual(warns(), [], 'rien tant que personne ne donne `other`')
      lists[0].setAttribute('other', '')
      await pause(150)
      lists[1].setAttribute('other', '')
      await pause(150)
      assert.equal(warns().length, 1, warns().join('\n'))
      assert.match(warns()[0], /^\[ModularJS\] <@@select> : une liste reçoit « other » d'un script/)
      assert.match(warns()[0], /Écrivez/)
    })

    it('un ramasse-miettes complet entre le montage et la pose de `other` : l\'avertissement part quand même', async () => {
      const { lists, warns } = await monter({ 'hote.mjs': liste('', 'a') })
      collectGarbage()
      lists[0].setAttribute('other', '')
      await pause(150)
      assert.equal(warns().length, 1, warns().join('\n'))
    })

    it('une page écrit `other` sur une autre liste : aucun avertissement', async () => {
      const { lists, warns } = await monter({ 'hote.mjs': liste('other', 'a') + liste('', 'b') })
      lists[1].setAttribute('other', '')
      await pause(150)
      assert.deepEqual(warns(), [])
    })
  })
})
