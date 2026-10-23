// La construction retire du module <@@sortable> le fondu des lignes (la ligne qui sort d'une liste avec une transition, que `*crossfade` fait voler
// jusqu'à sa place dans l'autre) quand aucune page de l'appli n'écrit de transition (production seulement) : ce que le module cœur envoie dépend de ce
// que les pages écrivent, par le même mécanisme que les groupes (repères `@@` dans le fichier du module). Ici la décision n'est pas celle d'un attribut
// mais d'un fait de l'appli, `coreTransitionWritten()` : une page du projet écrit `@in`, `@out` ou `@transition` (le fait même qui fait partir le moteur
// des transitions). Le développement garde tout, une copie éjectée garde tout, et le module cœur en cache suit l'appli (mode veille).
//
// Statique, avec un Bundler réel et le catalogue réel du framework. Les noms propres au fondu qu'on cherche dans la sortie : des noms du DOM (ils
// survivent à la minification), et — en production non minifiée — les noms des variables du morceau.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

type Files = Record<string, string>

const SORTABLE = fileURLToPath(new URL('../src/core-modules/sortable.mjs', import.meta.url))
const SCRIPT   = '<script>\n  $l = [{ id: 1, t: \'a\' }, { id: 2, t: \'b\' }]\n  $m = [{ id: 3, t: \'c\' }]\n  $d = 400\n  $anime = true\n  garde = (el)-> null\n</script>\n'

const ligne  = (attrs = '') => `<div class="p"${attrs ? ' ' + attrs : ''}>{x.t}</div>`
const listes = (attrs = '', groupe = ' group="g"') => `<@@sortable value=!{$l}${groupe}>{for x in $l by id}${ligne(attrs)}{end}</@@sortable><@@sortable value=!{$m}${groupe}>{for x in $m by id}${ligne(attrs)}{end}</@@sortable>`
const FONDU  = '@transition=*crossfade(key: x.id)'

// ce que le fondu des lignes met dans ce que le navigateur reçoit : la sortie de l'ancienne ligne du flux (un point d'ancrage et son défilement)
const FONDU_MINIFIE = ['offsetParent', 'scrollLeft']
const FONDU_NOMS    = ['leaving', 'anchor', 'toldFade', 'warningFade']
// ce qui n'existe que pour les groupes
const GROUPE_MINIFIE = ['sortableGrabGroup', 'sortableHop', 'sortableEnter', 'sortableLeave', 'sortableNamed', 'sortableUnnamed', 'changer de groupe', 'change group', 'Sortie vers', 'Moved out to', '{list}']
const AVIS_FONDU     = 'but no page of the application writes a transition'

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

/** le module lu SANS le filtre du build, pour ce que l'appli écrit (`ecrits`) : lignes de repère en moins, le morceau gardé quand son attribut est écrit, son autre forme (écrite en commentaire) remise en code sinon, l'avertissement du développement absent */
function lireSans(texte: string, ecrits: string[]): string {
  const marques = [/^\s*# @@(?: (.+?))?\s*$/, /^\s*\/\/ @@(?: (.+?))?\s*$/, /^\s*<!-- @@(?: (.+?))? -->\s*$/]
  const demande = (etiquette: string) => etiquette.startsWith('dev ') ? false : etiquette.startsWith('!') ? !ecrits.includes(etiquette.slice(1)) : ecrits.includes(etiquette)
  const reveille = (l: string) => l.replace(/^(\s*)(?:# |\/\/ )/, '$1')
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
    if (pile.some((etiquette) => !demande(etiquette))) {
      sortie.push('')
      continue
    }
    const fin = /^(.*\S)\s+# @@ (.+?)\s*$/.exec(ligne)
    if (fin) {
      sortie.push(demande(fin[2]) ? (fin[2].startsWith('!') ? reveille(fin[1]) : fin[1]) : '')
      continue
    }
    sortie.push(pile.some((etiquette) => etiquette.startsWith('!')) ? reveille(ligne) : ligne)
  }
  return sortie.join('\n')
}

/** l'appli construite avec, à la place du module du catalogue, le texte `module` (un catalogue d'un seul module) */
async function buildAvecModule(prefix: string, files: Files, module: string, opts: Record<string, unknown>): Promise<string> {
  const app  = appOf(prefix, files, opts)
  const core = join(app.root, 'core-modules')
  mkdirSync(core, { recursive: true })
  writeFileSync(join(core, 'sortable.mjs'), module)
  const bundler = new Bundler({ sourceDir: app.srcDir, outputDir: app.outDir, manifestPath: join(app.root, 'bundle.js'), ...opts, coreModulesDir: core })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
  return coreOf(app.outDir, 'core-sortable')
}

const MODES = { prod: { env: 'prod' }, 'prod non minifiée': { env: 'prod', minify: false }, dev: { env: 'dev' } } as const

describe('construction — le fondu des lignes de <@@sortable> suit ce que les pages écrivent', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('production, aucune page n\'écrit de transition : plus rien du fondu, les groupes restent', () => {
    const SANS: [string, Files][] = [
      ['des listes à groupes, rien d\'autre', { 'liste.mjs': SCRIPT + listes() }],
      ['des lignes qui se déplacent (@flip) : un déplacement, pas une transition', { 'liste.mjs': SCRIPT + listes('@flip') }],
      ['un @attach sur les lignes', { 'liste.mjs': SCRIPT + listes('@attach={garde}') }],
      ['un effet qui n\'est pas une transition (*neon)', { 'liste.mjs': SCRIPT + listes('*neon(#f0f)') }],
      ['un style CSS `transition:` sur les lignes', { 'liste.mjs': SCRIPT + listes() + '\n<style>\n  .p\n    transition: opacity .2s\n</style>\n' }],
      ['le mot @transition dans un commentaire, un texte et une chaîne', { 'liste.mjs': SCRIPT.replace('$d = 400', '$d = \'@in=*fade\'') + listes() + '<!-- @transition=*crossfade(key: x.id) --><code>@out=*fade</code>' }],
      ['deux fichiers, aucun ne l\'écrit', { 'a.mjs': SCRIPT + listes(), 'b.mjs': '<p>un</p>' }],
    ]
    for (const [nom, files] of SANS) {
      it(`${nom}`, async () => {
        const { code } = await build('tri-transition-sans', files, MODES.prod)
        assert.ok(code.length > 5000, 'le module sortable est bien là')
        assert.deepEqual(present(code, FONDU_MINIFIE), [])
        assert.deepEqual(manque(code, GROUPE_MINIFIE), [], 'les groupes restent')
        assert.deepEqual(leaks(code), [])
      })
    }

    it('non minifiée : ni variable du fondu, ni sortie du flux, ni avertissement du développement', async () => {
      const { code } = await build('tri-transition-sans-noms', { 'liste.mjs': SCRIPT + listes() }, MODES['prod non minifiée'])
      assert.deepEqual(nomme(sansNotes(code), FONDU_NOMS), [])
      assert.equal(sansNotes(code).includes('_mjs_fixPosition'), false)
      assert.equal(code.includes(AVIS_FONDU), false)
      assert.deepEqual(leaks(code), [])
    })

    it('le module est plus court que celui d\'une appli qui écrit une transition', async () => {
      const sans = (await build('tri-transition-poids-sans', { 'liste.mjs': SCRIPT + listes() }, MODES.prod)).code
      const avec = (await build('tri-transition-poids-avec', { 'liste.mjs': SCRIPT + listes(FONDU) }, MODES.prod)).code
      assert.ok(sans.length < avec.length - 150, `${sans.length} octets sans, ${avec.length} avec`)
    })
  })

  describe('production, une page écrit une transition : tout reste, de quelque façon qu\'elle l\'écrive', () => {
    const effets = '<effects>\n  *fondu = *crossfade(duration: 400ms)\n  *fade.lent = *fade(duration: 3s)\n</effects>'
    const AVEC: [string, Files][] = [
      ['@transition=*crossfade(key: …) sur les lignes', { 'liste.mjs': SCRIPT + listes(FONDU) }],
      ['@out=*fade seul', { 'liste.mjs': SCRIPT + listes('@out=*fade') }],
      ['@in=*fly(up) seul (une entrée ne fait rien voler, mais un octet de trop vaut mieux qu\'un fondu perdu)', { 'liste.mjs': SCRIPT + listes('@in=*fly(up)') }],
      ['@in et @out ensemble', { 'liste.mjs': SCRIPT + listes('@in=*fade @out=*fade') }],
      ['avec un modificateur : @out.global=*fade', { 'liste.mjs': SCRIPT + listes('@out.global=*fade') }],
      ['un réglage tenu par une variable', { 'liste.mjs': SCRIPT + listes('@transition=*crossfade(key: x.id, duration: $d)') }],
      ['un alias du fichier d\'effets', { 'fondu.effects.mjs': effets, 'liste.mjs': SCRIPT + listes('@transition=*fondu(key: x.id)') }],
      ['un alias pointé du fichier d\'effets', { 'fondu.effects.mjs': effets, 'liste.mjs': SCRIPT + listes('@out=*fade.lent') }],
      ['dans un {if}', { 'liste.mjs': SCRIPT + `<@@sortable value=!{$l} group="g">{for x in $l by id}{if $anime}${ligne(FONDU)}{else}${ligne()}{end}{end}</@@sortable><@@sortable value=!{$m} group="g">{for x in $m by id}${ligne()}{end}</@@sortable>` }],
      ['dans un composant enfant : la ligne est un composant', { 'liste.mjs': SCRIPT + '<@@sortable value=!{$l} group="g">{for x in $l by id}<@ligne/>{end}</@@sortable><@@sortable value=!{$m} group="g">{for x in $m by id}<@ligne/>{end}</@@sortable>', 'ligne.mjs': '<div class="p" @out=*fade>ligne</div>' }],
      ['dans un autre fichier que celui des listes', { 'liste.mjs': SCRIPT + listes(), 'fenetre.mjs': '<div class="d" @transition=*fade>fenêtre</div>' }],
      ['dans un partiel <@include>', { '_barre.mjs': '<div class="b" @in=*fade>barre</div>', 'liste.mjs': SCRIPT + listes() + '<@include barre>' }],
      ['balise littérale mjs-core-sortable', { 'liste.mjs': SCRIPT + `<mjs-core-sortable value=!{$l} group="g">{for x in $l by id}${ligne('@out=*fade')}{end}</mjs-core-sortable>` }],
    ]
    let reference = ''
    for (const [nom, files] of AVEC) {
      it(`${nom}`, async () => {
        const { code } = await build('tri-transition-avec', files, MODES.prod)
        assert.deepEqual(manque(code, FONDU_MINIFIE), [])
        assert.deepEqual(manque(code, GROUPE_MINIFIE), [])
        assert.deepEqual(leaks(code), [])
        reference ||= code
        // les noms réduits (une lettre) changent d'un build à l'autre : la taille, elle, ne bouge pas
        assert.ok(Math.abs(code.length - reference.length) <= 40, `${code.length} octets, ${reference.length} pour la première façon`)
      })
    }

    it('et le module émis est le fichier lu sans aucun repère, octet pour octet (groupes et fondu demandés)', async () => {
      const files = { 'liste.mjs': SCRIPT + listes(FONDU) }
      const reel  = (await build('tri-transition-identique', files, MODES.prod)).code
      const sans  = await buildAvecModule('tri-transition-identique-ref', files, lireSans(readFileSync(SORTABLE, 'utf-8'), ['group', 'transition']), MODES.prod)
      assert.ok(sans.length > 10000, 'le module du fichier sans repère est là')
      assert.equal(reel, sans)
    })
  })

  describe('les quatre cas : groupes écrits ou non, transition écrite ou non', () => {
    const CAS: [string, Files, boolean, boolean][] = [
      ['groupes et transition', { 'liste.mjs': SCRIPT + listes(FONDU) }, true, true],
      ['groupes sans transition', { 'liste.mjs': SCRIPT + listes() }, true, false],
      ['transition sans groupes : le fondu ne sert qu\'entre deux listes d\'un groupe', { 'liste.mjs': SCRIPT + listes(FONDU, '') }, false, false],
      ['ni groupes ni transition', { 'liste.mjs': SCRIPT + listes('', '') }, false, false],
    ]
    for (const [nom, files, groupes, fondu] of CAS) {
      it(`${nom}`, async () => {
        for (const mode of ['prod', 'prod non minifiée'] as const) {
          const { code } = await build('tri-transition-quatre', files, MODES[mode])
          assert.deepEqual(groupes ? manque(code, GROUPE_MINIFIE) : present(code, GROUPE_MINIFIE), [], `${mode} : groupes`)
          assert.deepEqual(fondu ? manque(code, FONDU_MINIFIE) : present(code, FONDU_MINIFIE), [], `${mode} : fondu`)
          assert.deepEqual(leaks(code), [])
          assert.doesNotThrow(() => transformSync(code, { format: 'esm' }), `${mode} : le code se lit`)
        }
      })
    }

    it('et le module émis est le fichier lu sans aucun repère, octet pour octet, dans chacun des quatre cas', async () => {
      const ecrits: string[][] = [['group', 'transition'], ['group'], ['transition'], []]
      for (const [i, [nom, files]] of CAS.entries()) {
        const reel = (await build('tri-transition-quatre-id', files, MODES.prod)).code
        const sans = await buildAvecModule('tri-transition-quatre-ref', files, lireSans(readFileSync(SORTABLE, 'utf-8'), ecrits[i]), MODES.prod)
        assert.equal(reel, sans, nom)
      }
    })
  })

  describe('développement : tout reste toujours', () => {
    it('aucune page n\'écrit de transition : tout reste, avec l\'avertissement', async () => {
      const { code } = await build('tri-transition-dev-sans', { 'liste.mjs': SCRIPT + listes() }, MODES.dev)
      assert.deepEqual(manque(code, FONDU_MINIFIE), [])
      assert.deepEqual(manque(code, ['leaving', 'anchor']), [])
      assert.deepEqual(manque(code, GROUPE_MINIFIE), [])
      assert.ok(code.includes(AVIS_FONDU), 'l\'avertissement du développement est là')
      assert.deepEqual(leaks(code), [])
    })

    it('une page écrit une transition : tout reste, sans avertissement (il n\'a plus de raison d\'être)', async () => {
      const { code } = await build('tri-transition-dev-avec', { 'liste.mjs': SCRIPT + listes(FONDU) }, MODES.dev)
      assert.deepEqual(manque(code, FONDU_MINIFIE), [])
      assert.deepEqual(manque(code, ['leaving', 'anchor']), [])
      assert.equal(code.includes(AVIS_FONDU), false)
      assert.deepEqual(leaks(code), [])
    })

    it('la production, elle, n\'envoie jamais l\'avertissement', async () => {
      for (const files of [{ 'liste.mjs': SCRIPT + listes() }, { 'liste.mjs': SCRIPT + listes(FONDU) }]) {
        const { code } = await build('tri-transition-prod-avis', files, MODES['prod non minifiée'])
        assert.equal(code.includes(AVIS_FONDU), false)
      }
    })
  })

  describe('mode veille : une même instance, la page change entre deux tours', () => {
    const wait = () => new Promise((r) => setTimeout(r, 1100))   // la date d'un fichier a la seconde pour grain

    for (const [nom, opts] of [['production', MODES.prod], ['développement', MODES.dev]] as const) {
      it(`${nom} : écrire puis retirer une transition dans une page recompile le module cœur`, async () => {
        const app = appOf('tri-transition-veille', { 'liste.mjs': SCRIPT + listes() }, opts)
        const tour = async () => {
          const stats = await app.bundler.compile()
          assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
          return coreOf(app.outDir, 'core-sortable')
        }
        const un = await tour()
        await wait()
        writeFileSync(join(app.srcDir, 'liste.mjs'), SCRIPT + listes(FONDU))
        const deux = await tour()
        await wait()
        writeFileSync(join(app.srcDir, 'liste.mjs'), SCRIPT + listes())
        const trois = await tour()
        // une transition écrite change aussi le moteur de l'appli : les noms réduits du module changent avec lui, c'est donc ce qu'il porte qu'on compare
        assert.deepEqual(manque(deux, FONDU_MINIFIE), [], 'avec la transition : le fondu')
        if (nom === 'production') {
          assert.notEqual(un, deux, 'écrire une transition change le module émis')
          assert.deepEqual(present(un, FONDU_MINIFIE), [], 'sans : plus rien')
          assert.deepEqual(present(trois, FONDU_MINIFIE), [], 'la retirer le retire')
        }
        else {
          assert.deepEqual(manque(un, FONDU_MINIFIE), [], 'en développement, tout reste')
          assert.deepEqual(manque(trois, FONDU_MINIFIE), [])
          assert.ok(un.includes(AVIS_FONDU) && !deux.includes(AVIS_FONDU) && trois.includes(AVIS_FONDU), 'l\'avertissement suit : présent sans transition, absent avec')
        }
      })
    }

    it('un tour sans rapport avec la liste (autre fichier modifié) ne change pas le module', async () => {
      const app = appOf('tri-transition-veille-voisin', { 'liste.mjs': SCRIPT + listes(), 'voisin.mjs': '<p>un</p>' }, MODES.prod)
      await app.bundler.compile()
      const un = coreOf(app.outDir, 'core-sortable')
      await wait()
      writeFileSync(join(app.srcDir, 'voisin.mjs'), '<p>deux</p>')
      await app.bundler.compile()
      assert.equal(coreOf(app.outDir, 'core-sortable'), un)
    })
  })

  describe('la décision : coreTransitionWritten()', () => {
    it('avant tout compile() : \'unknown\' (jamais \'no\', qui autoriserait un retrait)', () => {
      const { bundler } = appOf('tri-transition-avant', { 'liste.mjs': SCRIPT + listes() })
      assert.equal(bundler.coreTransitionWritten(), 'unknown')
    })

    it('après compile() : \'no\' sans transition, \'yes\' avec', async () => {
      const sans = appOf('tri-transition-apres-sans', { 'liste.mjs': SCRIPT + listes() })
      await sans.bundler.compile()
      assert.equal(sans.bundler.coreTransitionWritten(), 'no')
      const avec = appOf('tri-transition-apres-avec', { 'liste.mjs': SCRIPT + listes(FONDU) })
      await avec.bundler.compile()
      assert.equal(avec.bundler.coreTransitionWritten(), 'yes')
    })

    it('une transition écrite par un autre module cœur ne compte pas : la décision ne dépend pas de l\'ordre de compilation des modules', async () => {
      const files = { 'liste.mjs': SCRIPT + listes() + '<@@fenetre/>' }
      const app   = appOf('tri-transition-autre-module', files, MODES.prod)
      const core  = join(app.root, 'core-modules')
      mkdirSync(core, { recursive: true })
      writeFileSync(join(core, 'sortable.mjs'), readFileSync(SORTABLE, 'utf-8'))
      writeFileSync(join(core, 'fenetre.mjs'), '<div class="f" @transition=*fade>fenêtre</div>')
      const bundler = new Bundler({ sourceDir: app.srcDir, outputDir: app.outDir, manifestPath: join(app.root, 'bundle.js'), ...MODES.prod, coreModulesDir: core })
      const stats   = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
      assert.equal(bundler.coreTransitionWritten(), 'no')
      assert.deepEqual(present(coreOf(app.outDir, 'core-sortable'), FONDU_MINIFIE), [])
    })

    it('un module du catalogue qui cite <@@sortable> peut y écrire une transition : dans le doute, tout reste', async () => {
      const files = { 'liste.mjs': SCRIPT + '<@@boite/>' }
      const app   = appOf('tri-transition-cite', files, MODES.prod)
      const core  = join(app.root, 'core-modules')
      mkdirSync(core, { recursive: true })
      writeFileSync(join(core, 'sortable.mjs'), readFileSync(SORTABLE, 'utf-8'))
      writeFileSync(join(core, 'boite.mjs'), '<@@sortable group="g"><div class="p">x</div></@@sortable>')
      const bundler = new Bundler({ sourceDir: app.srcDir, outputDir: app.outDir, manifestPath: join(app.root, 'bundle.js'), ...MODES.prod, coreModulesDir: core })
      const stats   = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
      assert.deepEqual(manque(coreOf(app.outDir, 'core-sortable'), FONDU_MINIFIE), [])
    })
  })

  describe('une copie éjectée du module garde tout, et marche', () => {
    it('copiée telle quelle dans le projet : un composant du projet, les repères y sont des commentaires', async () => {
      const copie = readFileSync(SORTABLE, 'utf-8')
      for (const mode of ['dev', 'prod'] as const) {
        const app = appOf('tri-transition-ejection', { 'ma-liste.mjs': copie, 'page.mjs': `${SCRIPT}<main><@ma-liste group="g"><div>a</div></@ma-liste>${listes()}</main>` }, { env: mode })
        const stats = await app.bundler.compile()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
        const mine = readdirSync(app.outDir).filter((f) => /^ma-liste-.*\.js$/.test(f)).map((f) => readFileSync(join(app.outDir, f), 'utf-8')).join('\n')
        assert.deepEqual(manque(mine, FONDU_MINIFIE), [], `${mode} : la copie garde le fondu`)
        assert.deepEqual(manque(mine, GROUPE_MINIFIE), [], `${mode} : la copie garde les groupes`)
        if (mode === 'prod') assert.deepEqual(present(coreOf(app.outDir, 'core-sortable'), FONDU_MINIFIE), [], 'le module cœur de la même appli est trié, lui')
        assert.doesNotThrow(() => transformSync(mine, { format: 'esm' }), `${mode} : le code de la copie se lit`)
      }
    })
  })
})
