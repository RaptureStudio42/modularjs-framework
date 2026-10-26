// Les parties des modules cœur que la construction ôte quand aucune page ne les demande — la réponse libre « Autre » de <@@select>
// (`other`), le mode « répondre » de <@@editor> (`answer`), les outils de la barre de l'éditeur (`toolbar` de <@@editor>, `tools` de
// <@@toolbar>), les groupes de <@@sortable> (`group`) — se tranchent comme la barre de <@@chart> : la même décision en développement et
// en production, au rendu serveur comme au navigateur, pour que la page servie et la page reprise portent le même gabarit. Écrite en dur
// ou liée, la partie reste ; dans le doute aussi : un étalement, une balise dynamique qui écrit l'attribut ou un étalement, un module
// .civet, .coffee, .js ou .ts, ou le script d'un composant, qui nomme la balise, une référence relevée sans ses attributs (un cache
// ancien). Un script qui pose l'attribut alors qu'aucune page ne l'écrit n'a plus la partie, en développement non plus : un avertissement
// du développement le dit, une fois. Une copie du module posée dans un projet garde tout, et ne le dit jamais.
//
// Statique, avec un Bundler réel et le catalogue réel du framework, sans minification (les noms des fonctions restent lisibles) ; les
// avertissements dans happy-dom. La reprise d'une page servie par de vrais navigateurs : core-liste-editeur-reprise-croisee-browser.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'

type Files = Record<string, string>

const SCRIPT = `<script>
  $choix  = null
  $texte  = '<p>Bonjour</p>'
  $etapes = [{ id: 1, t: 'un' }, { id: 2, t: 'deux' }]
  $o      = 40
  $a      = true
  $outils = 'link check'
  $g      = 'g'
  $p      = {}
</script>
`
const liste   = (attrs = '', classe = 'liste') => `<@@select class="${classe}" value=!{$choix} ${attrs}><@@option value="a">Alpha</@@option><@@option value="b">Bêta</@@option></@@select>`
const editeur = (attrs = 'toolbar="bold italic"', classe = 'ed') => `<@@editor class="${classe}" name="e" value=!{$texte} ${attrs}></@@editor>`
const tri     = (attrs = '') => `<@@sortable class="tri" value=!{$etapes} ${attrs}>{for et in $etapes by id}<div class="ligne">{et.t}</div>{end}</@@sortable>`
const page    = (corps: string, script = '') => SCRIPT.replace('</script>', script + '</script>') + corps + '\n'
const NUE     = () => page(liste() + editeur() + tri())

// ce que chaque partie, et elle seule, met dans le module compilé (sans minification ; aucune clé de libellé, que le manifeste porte) ; à côté,
// ce qui reste toujours (le module est là)
const PARTIES: Record<string, { module: string, noms: string[] }> = {
  'other de <@@select>':          { module: 'core-select',   noms: ['otherMaxOf', 'submitOther', 'select-other-edit', 'with-other'] },
  'answer de <@@editor>':         { module: 'core-editor',   noms: ['answerHtml', 'answerKey', 'syncTicks'] },
  'outils lien et cases (éditeur)': { module: 'core-editor', noms: ['openLink', 'applyLink', 'barShows'] },
  'outils lien et cases (barre)': { module: 'core-toolbar',  noms: ['M6.8 9.2a3', 'M2.7 4.6l1.2'] },
  'group de <@@sortable>':        { module: 'core-sortable', noms: ['sortableLists', 'groupName', 'sortableGrabGroup'] },
}
const TOUJOURS: Record<string, string[]> = { 'core-select': ['select-btn'], 'core-editor': ['readBlocks'], 'core-toolbar': ['toolBold'], 'core-sortable': ['listRows'] }
const MODULES  = Object.keys(TOUJOURS)

const ENVS = {
  'développement':                 { env: 'dev' },
  'développement, fichier unique': { env: 'dev', js: 'bundle' },
  'production':                    { env: 'prod' },
} as const
const DEV  = ENVS['développement']
const PROD = ENVS['production']

const AVIS_LISTE   = 'dev.selectOtherScript'
const AVIS_EDITEUR = 'dev.editorAnswerScript'
const AVIS_TRI     = 'but no page of the application writes that attribute'
const AVIS_BARRE   = 'dev.toolbarToolScript'
const COEUR        = (nom: string) => fileURLToPath(new URL(`../src/core-modules/${nom}.mjs`, import.meta.url))

interface App { root: string, srcDir: string, outDir: string, bundler: Bundler }

function appOf(prefix: string, files: Files, opts: Record<string, unknown>): App {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(srcDir, rel), content)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), js: 'split', minify: false, ...opts } as any)
  return { root, srcDir, outDir, bundler }
}

/** le code compilé de chaque module cœur suivi ; en fichier unique, tout le code pour chacun */
function modules(app: App): Record<string, string> {
  const fichiers = readdirSync(app.outDir).filter((f) => f.endsWith('.js'))
  const lire     = (f: string) => readFileSync(join(app.outDir, f), 'utf-8')
  const unique   = !fichiers.some((f) => f.startsWith('core-'))
  const tout     = unique ? [...fichiers.map(lire), existsSync(join(app.root, 'bundle.js')) ? readFileSync(join(app.root, 'bundle.js'), 'utf-8') : ''].join('\n') : ''
  const out: Record<string, string> = {}
  for (const m of MODULES) out[m] = unique ? tout : fichiers.filter((f) => f.startsWith(m + '-') || f === m + '.js').map(lire).join('\n')
  return out
}

async function build(prefix: string, files: Files, opts: Record<string, unknown>): Promise<Record<string, string>> {
  const app   = appOf(prefix, files, opts)
  const stats = await app.bundler.compile()
  await app.bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
  return modules(app)
}

/** les parties présentes, et celles qui manquent, dans un build ; le module est toujours là */
function parties(code: Record<string, string>): { la: string[], parties: string[] } {
  for (const m of MODULES) {
    assert.ok(code[m].length > 1000, `${m} est compilé`)
    assert.deepEqual(TOUJOURS[m].filter((n) => !code[m].includes(n)), [], `${m} : ce qui reste toujours est là`)
  }
  const la: string[] = []
  const parties: string[] = []
  for (const [nom, { module, noms }] of Object.entries(PARTIES)) {
    const vus = noms.filter((n) => code[module].includes(n))
    assert.ok(vus.length === 0 || vus.length === noms.length, `${nom} : à moitié là (${vus.join(', ')})`)
    ;(vus.length ? la : parties).push(nom)
  }
  return { la, parties }
}

describe('construction — les parties de <@@select>, <@@editor>, <@@toolbar> et <@@sortable> se tranchent pareil en développement et en production', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('aucune page n\'écrit l\'attribut : la partie part, partout', () => {
    for (const [nom, opts] of Object.entries(ENVS)) {
      it(nom, async () => {
        const { la } = parties(await build('parties-nues', { 'page.mjs': NUE() }, opts))
        assert.deepEqual(la, [], 'aucune partie')
      })
    }
  })

  describe('une page écrit l\'attribut, en dur ou lié : la partie reste, partout', () => {
    const AVEC: [string, string][] = [
      ['en dur', liste('other') + editeur('answer') + editeur('toolbar="bold link check"', 'ed2') + tri('group="g"')],
      ['lié {…}', liste('other={$o}') + editeur('answer={$a}') + editeur('toolbar={$outils}', 'ed2') + tri('group={$g}')],
      ['lié à deux sens !{…}', liste('other=!{$o}') + editeur('answer=!{$a}') + editeur('toolbar=!{$outils}', 'ed2') + tri('group=!{$g}')],
    ]
    for (const [nom, corps] of AVEC) for (const [env, opts] of [['développement', DEV], ['production', PROD]] as const) {
      it(`${nom}, ${env}`, async () => {
        const { parties: manquent } = parties(await build('parties-avec', { 'page.mjs': page(corps) }, opts))
        assert.deepEqual(manquent, [], 'toutes les parties')
      })
    }
  })

  describe('dans le doute, la partie reste, partout', () => {
    const TROIS = "['mjs-core-select', 'mjs-core-editor', 'mjs-core-sortable']"
    const DOUTE: [string, Files][] = [
      ['un étalement {...$p} sur chaque balise', { 'page.mjs': page(liste('{...$p}') + editeur('{...$p}') + tri('{...$p}')) }],
      ['une balise dynamique <@element> qui écrit les attributs', { 'page.mjs': page(liste() + editeur() + tri() + '<@element $t other answer group toolbar="link"></@element>', "  $t = 'div'\n") }],
      ['une balise dynamique <@module> qui écrit un étalement', { 'page.mjs': page(liste() + editeur() + tri() + '<@module $c {...$p}></@module>', '  $c = null\n') }],
      ['un module .civet qui fabrique les balises', { 'page.mjs': NUE(), 'fabrique.civet': `fabrique = -> ${TROIS}.map (t)-> document.createElement(t)\n` }],
      ['un module .coffee qui fabrique les balises', { 'page.mjs': NUE(), 'fabrique.coffee': `fabrique = -> ${TROIS}.map (t)-> document.createElement t\n` }],
      ['un module .js qui fabrique les balises', { 'page.mjs': NUE(), 'fabrique.js': `export const fabrique = () => ${TROIS}.map((t) => document.createElement(t))\n` }],
      ['un module .ts qui fabrique les balises', { 'page.mjs': NUE(), 'fabrique.ts': `export const fabrique = (): HTMLElement[] => ${TROIS}.map((t) => document.createElement(t))\n` }],
      ['le script d\'un composant qui fabrique les balises', { 'page.mjs': page(liste() + editeur() + tri(), `  fabrique = -> ${TROIS}.map (t)-> document.createElement(t)\n`) }],
    ]
    for (const [nom, files] of DOUTE) {
      it(`${nom} (production)`, async () => {
        const { parties: manquent } = parties(await build('parties-doute', files, PROD))
        assert.deepEqual(manquent, [], 'toutes les parties')
      })
    }

    it('un module .js qui fabrique les balises (développement)', async () => {
      const { parties: manquent } = parties(await build('parties-doute-dev', DOUTE[5][1], DEV))
      assert.deepEqual(manquent, [])
    })

    it('le doute suit la balise nommée : un script qui ne fabrique qu\'une liste ne garde que « Autre »', async () => {
      for (const opts of [DEV, PROD]) {
        const { la } = parties(await build('parties-doute-liste', { 'page.mjs': NUE(), 'fabrique.js': "export const fabrique = () => document.createElement('mjs-core-select')\n" }, opts))
        assert.deepEqual(la, ['other de <@@select>'], opts.env)
      }
    })

    it('un script qui fabrique une barre <@@toolbar> garde les outils, et rien d\'autre', async () => {
      for (const opts of [DEV, PROD]) {
        const { la } = parties(await build('parties-doute-barre', { 'page.mjs': NUE(), 'fabrique.js': "export const fabrique = () => document.createElement('mjs-core-toolbar')\n" }, opts))
        assert.deepEqual(la, ['outils lien et cases (éditeur)', 'outils lien et cases (barre)'], opts.env)
      }
    })

    it('une référence relevée sans ses attributs (un cache ancien) : les parties reviennent', async () => {
      for (const opts of [DEV, PROD]) {
        const app = appOf('parties-cache-ancien', { 'page.mjs': NUE() }, opts)
        let stats = await app.bundler.compile()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
        assert.deepEqual(parties(modules(app)).la, [], `${opts.env}, premier tour : aucune partie`)
        for (const entry of (app.bundler as any).cache.values()) for (const r of entry.tagRefs ?? []) delete r.attrs
        stats = await app.bundler.compile()
        await app.bundler.close()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
        assert.deepEqual(parties(modules(app)).parties, [], `${opts.env}, second tour, relevé sans attributs : toutes les parties`)
      }
    })
  })

  describe('le rendu serveur prend la même décision que le navigateur : le gabarit servi est le même en développement et en production', () => {
    // l'ombre d'un module dans le HTML servi, sans les commentaires (repères de reprise)
    const ombre = (html: string, balise: string) => {
      const i = html.indexOf('<' + balise)
      const j = html.indexOf('</' + balise + '>', i)
      return i < 0 ? '(absent)' : html.slice(i, j).replace(/<!--[\s\S]*?-->/g, '')
    }

    it('sans attribut écrit : <@@select>, <@@editor> et <@@toolbar> servis à l\'identique', async () => {
      const rendus: Record<string, string> = {}
      for (const env of ['dev', 'prod'] as const) {
        const root   = mjsTmp('parties-serveur-' + env)
        const srcDir = join(root, 'src')
        mkdirSync(srcDir, { recursive: true })
        writeFileSync(join(srcDir, 'pt-page.mjs'), NUE())
        const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'out'), env, bundlerOpts: { runtime: ['hydrate'] } } as any)
        try {
          rendus[env] = (await renderer.renderToString('mjs-pt-page', { ssrMode: 'markers' } as any)).html
        }
        finally {
          await renderer.close()
        }
      }
      for (const balise of ['mjs-core-select', 'mjs-core-editor', 'mjs-core-toolbar', 'mjs-core-sortable']) {
        const dev  = ombre(rendus.dev, balise)
        const prod = ombre(rendus.prod, balise)
        assert.ok(dev.length > 200, `${balise} est servi`)
        assert.equal(dev, prod, `${balise} : développement ${dev.length} signes, production ${prod.length}`)
      }
    })
  })

  describe('une copie du module posée dans un projet garde tout, et son avertissement n\'est jamais du code', () => {
    const COPIES: [string, string, string][] = [['select', 'mon-select', AVIS_LISTE], ['editor', 'mon-editeur', AVIS_EDITEUR], ['sortable', 'mon-tri', AVIS_TRI], ['toolbar', 'ma-barre', AVIS_BARRE]]
    for (const [coeur, nom, avis] of COPIES) {
      it(`${coeur}.mjs copié, développement et production`, async () => {
        for (const opts of [DEV, PROD]) {
          const app   = appOf('parties-copie-' + coeur, { [nom + '.mjs']: readFileSync(COEUR(coeur), 'utf-8'), 'page.mjs': `<@${nom}></@${nom}>\n` }, opts)
          const stats = await app.bundler.compile()
          await app.bundler.close()
          assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
          const code   = readdirSync(app.outDir).filter((f) => f.endsWith('.js') && f.includes(nom)).map((f) => readFileSync(join(app.outDir, f), 'utf-8')).join('\n')
          assert.ok(code.length > 1000, `${opts.env} : la copie est compilée`)
          const vivant = code.split('\n').filter((l) => l.includes(avis) && !/^\s*(?:\/\/|#|\*)/.test(l))
          assert.deepEqual(vivant, [], `${opts.env} : l'avertissement de la copie est du code`)
        }
      })
    }

    // le découpage ne touche que les fichiers du cœur : la copie garde sa partie, même quand aucune page n'écrit l'attribut. Le cas qui le demande : la copie
    // revient du cache, mais le cœur a changé entre deux tours (une page gagne un {await}) ; elle est alors recompilée après la lecture des références du
    // projet, quand la construction sait qu'aucune page n'écrit l'attribut
    const GARDEES: [string, string, string][] = [['select', 'mon-select', 'other de <@@select>'], ['editor', 'mon-editeur', 'answer de <@@editor>'], ['sortable', 'mon-tri', 'group de <@@sortable>']]
    const ATTENTE = '<script>\n  $p = Promise.resolve(1)\n</script>\n{await $p}<p>attente</p>{success v}<p>{v}</p>{end}\n'
    for (const [coeur, nom, partie] of GARDEES) {
      it(`${coeur}.mjs copié : sa partie reste au premier tour, et quand la copie est recompilée après un changement du cœur, en production comme en développement`, async () => {
        for (const opts of [PROD, DEV]) {
          const app  = appOf('parties-copie-gardee-' + coeur, { [nom + '.mjs']: readFileSync(COEUR(coeur), 'utf-8'), 'page.mjs': `<@${nom}></@${nom}>\n` }, { ...opts, runtime: [] })
          const lire = () => readdirSync(app.outDir).filter((f) => f.endsWith('.js') && f.includes(nom)).map((f) => readFileSync(join(app.outDir, f), 'utf-8')).join('\n')
          const noyau = () => readdirSync(app.outDir).find((f) => /^mjs_core-/.test(f))
          const premier = await app.bundler.compile()
          assert.equal(premier.errors.length, 0, premier.errors.map((e: Error) => e.message).join('\n'))
          assert.ok(lire().length > 1000, `${opts.env} : la copie est compilée`)
          assert.deepEqual(PARTIES[partie].noms.filter((n) => !lire().includes(n)), [], `${opts.env}, premier tour : la copie a perdu sa partie ${partie}`)
          const avant = noyau()
          writeFileSync(join(app.srcDir, 'attente.mjs'), ATTENTE)
          const second = await app.bundler.compile()
          await app.bundler.close()
          assert.equal(second.errors.length, 0, second.errors.map((e: Error) => e.message).join('\n'))
          assert.notEqual(noyau(), avant, `${opts.env} : le cœur change entre les deux tours (sinon la copie reviendrait du cache sans être recompilée)`)
          assert.deepEqual(PARTIES[partie].noms.filter((n) => !lire().includes(n)), [], `${opts.env}, copie recompilée : elle a perdu sa partie ${partie}`)
        }
      })
    }
  })

  describe('avertissements du développement (happy-dom)', () => {
    // un hôte monté dans happy-dom avec le code d'un vrai build ; `µ.warn` recueilli
    async function monter(files: Files, balise: string, opts: Record<string, unknown> = DEV): Promise<{ els: any[], warns: () => string[] }> {
      const app   = appOf('parties-avis', files, opts)
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
      await attendre(() => !!hote._shadow && hote._shadow.querySelectorAll(balise).length > 0 && Array.from(hote._shadow.querySelectorAll(balise)).every((e: any) => e._state))
      await pause(250)
      return { els: Array.from(hote._shadow.querySelectorAll(balise)), warns: () => Array.from(window.eval('globalThis.__warns')) as string[] }
    }

    // ouvre une liste : ses options sont là ; la ligne « Autre » y est-elle ?
    async function autre(el: any): Promise<boolean> {
      el._shadow.querySelector('.select-btn').click()
      await attendre(() => el._shadow.querySelectorAll('.select-option').length > 0)
      await pause(100)
      return !!el._shadow.querySelector('.select-other')
    }

    it('<@@select> : un script pose `other` sans qu\'aucune page l\'écrive — pas de ligne « Autre », un avertissement, une seule fois pour deux listes', async () => {
      const { els, warns } = await monter({ 'hote.mjs': page(liste('', 'a') + liste('', 'b')) }, 'mjs-core-select')
      assert.equal(els.length, 2)
      assert.deepEqual(warns(), [], 'rien tant que personne ne pose `other`')
      els[0].setAttribute('other', '')
      await pause(150)
      els[1].setAttribute('other', '20')
      await pause(150)
      assert.equal(warns().length, 1, warns().join('\n'))
      assert.match(warns()[0], /^\[ModularJS\] <@@select> : une liste reçoit « other » d'un script/)
      assert.match(warns()[0], /ni en développement ni en production/)
      assert.equal(await autre(els[0]), false, 'la réponse libre n\'est pas là')
    })

    it('<@@select> : une page écrit `other` sur une autre liste — la ligne « Autre » vient, sans avertissement', async () => {
      const { els, warns } = await monter({ 'hote.mjs': page(liste('other', 'a') + liste('', 'b')) }, 'mjs-core-select')
      els[1].setAttribute('other', '')
      await pause(150)
      assert.deepEqual(warns(), [])
      assert.equal(await autre(els[1]), true)
    })

    it('<@@editor> : un script pose `answer` sans qu\'aucune page l\'écrive — pas de mode « répondre », un avertissement, une seule fois pour deux éditeurs', async () => {
      const { els, warns } = await monter({ 'hote.mjs': page(editeur('toolbar="bold"', 'a') + editeur('toolbar="bold"', 'b')) }, 'mjs-core-editor')
      assert.equal(els.length, 2)
      await attendre(() => els.every((e) => !!e._shadow.querySelector('.surface')))
      assert.deepEqual(warns(), [], 'rien tant que personne ne pose `answer`')
      els[0].setAttribute('answer', '')
      await pause(150)
      els[1].setAttribute('answer', 'true')
      await pause(150)
      assert.equal(warns().length, 1, warns().join('\n'))
      assert.match(warns()[0], /^\[ModularJS\] <@@editor> : un éditeur reçoit « answer » d'un script/)
      assert.match(warns()[0], /ni en développement ni en production/)
      assert.equal(els[0]._shadow.querySelector('.surface').getAttribute('role'), 'textbox', 'la zone reste une zone d\'écriture')
    })

    it('<@@sortable> : un script pose `group` sans qu\'aucune page l\'écrive — un avertissement, une seule fois', async () => {
      const { els, warns } = await monter({ 'hote.mjs': page(tri() + tri()) }, 'mjs-core-sortable')
      assert.equal(els.length, 2)
      assert.deepEqual(warns(), [])
      els[0].setAttribute('group', 'g')
      await pause(150)
      els[1].setAttribute('group', 'g')
      await pause(150)
      assert.equal(warns().length, 1, warns().join('\n'))
      assert.match(warns()[0], /^\[ModularJS\] <@@sortable> : une liste reçoit « group » d'un script/)
      assert.match(warns()[0], /ni en développement ni en production/)
    })

    // seule dans sa page : le montage met tous les modules dans une même portée, où la copie et le module du cœur déclareraient les mêmes noms
    const COPIES: [string, string, string, string, string][] = [
      ['select', 'mon-select', '<@mon-select other><@@option value="a">Alpha</@@option></@mon-select>', 'other', '30'],
      ['editor', 'mon-editeur', '<@mon-editeur name="e" answer></@mon-editeur>', 'answer', 'true'],
      ['sortable', 'mon-tri', '<@mon-tri group="g"><div>a</div></@mon-tri>', 'group', 'h'],
      ['toolbar', 'ma-barre', '<@ma-barre tools="bold"></@ma-barre>', 'tools', 'bold link'],
    ]
    for (const [coeur, nom, corps, attr, valeur] of COPIES) {
      it(`une copie de ${coeur}.mjs posée dans le projet reçoit \`${attr}\` d'un script : elle ne dit rien`, async () => {
        const { els, warns } = await monter({ [nom + '.mjs']: readFileSync(COEUR(coeur), 'utf-8'), 'hote.mjs': corps + '\n' }, 'mjs-' + nom)
        els[0].setAttribute(attr, valeur)
        await pause(150)
        assert.deepEqual(warns(), [])
      })
    }

    it('la production n\'envoie jamais les avertissements', async () => {
      for (const corps of [liste() + editeur() + tri(), liste('other') + editeur('answer') + tri('group="g"')]) {
        const code = Object.values(await build('parties-avis-prod', { 'page.mjs': page(corps) }, PROD)).join('\n')
        assert.deepEqual([AVIS_LISTE, AVIS_EDITEUR, AVIS_TRI, AVIS_BARRE].filter((a) => code.includes(a)), [])
      }
    })
  })
})
