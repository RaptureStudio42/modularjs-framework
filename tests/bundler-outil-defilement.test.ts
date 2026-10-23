// l'avancée d'une balise au défilement (µ._mjs_fxScroll, runtime/mjs_fx_toolscroll.ts) est un module à part : le moteur des effets ne la porte
// plus, elle ne vient qu'avec un effet qui l'appelle (bundler/fx-tools.ts). Une appli qui pose *neon ne grossit pas d'un code de défilement
// dont elle ne se sert pas ; *scrub, *gallery, *goo, *path et *stagger, eux, l'ont toujours.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler } from '../src/bundler/index.js'
import { FX_NAMED, FX_NAMEABLE_KEYS } from '../src/bundler/features.js'
import { FX_TOOLS } from '../src/bundler/fx-tools.js'

const RUNTIME   = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')
const OUTIL     = 'mjs_fx_toolscroll.ts'
const APPELANTS = ['fx_gallery', 'fx_goo', 'fx_path', 'fx_scrub', 'fx_stagger']
const lire      = (f: string) => readFileSync(join(RUNTIME, f), 'utf-8')
const fichiers  = (used?: Set<string>, config: Record<string, unknown> = {}) => new Bundler({ i18n: { default: 'fr' }, ...config } as any).resolveRuntimeFiles(used).files
const code      = (files: string[]) => files.map(lire).join('\n')
// un échec ne doit pas recopier le source entier dans son message
const sans      = (texte: string, re: RegExp, msg: string) => assert.ok(!re.test(texte), msg)

describe('l\'avancée au défilement — un module à part, embarqué avec ses seuls utilisateurs', () => {
  it('le moteur des effets ne la définit plus ; l\'outil la définit, une seule fois', () => {
    sans(lire('mjs_fx.ts'), /µ\._mjs_fxScroll = /, 'mjs_fx.ts définit encore µ._mjs_fxScroll')
    assert.equal(lire(OUTIL).match(/^µ\._mjs_fxScroll = /gm)?.length, 1)
  })

  it('ce qui sert aussi à d\'autres reste dans le moteur : la bande de la zone et l\'avancée (*travel et les transitions au défilement les lisent)', () => {
    const moteur = lire('mjs_fx.ts')
    assert.match(moteur, /^µ\._mjs_fxZone = /m)
    assert.match(moteur, /^µ\._mjs_fxAdvance = /m)
    sans(lire(OUTIL), /^µ\._mjs_fxZone = |^µ\._mjs_fxAdvance = /m, 'l\'outil redéfinit ce qui reste au moteur')
    assert.match(lire('mjs_fx_travel.ts'), /µ\._mjs_fxZone\(/)
    assert.match(lire('mjs_fx_transition.ts'), /µ\._mjs_fxAdvance\(/)
  })

  it('une appli sans effet, avec le moteur seul ou avec *neon ou *tilt : ni l\'outil ni une ligne de son code', () => {
    for (const used of [new Set<string>(), new Set(['fx']), new Set(['fx', 'fx_neon']), new Set(['fx', 'fx_neon', 'fx_tilt'])]) {
      const files = fichiers(used)
      assert.ok(!files.includes(OUTIL), [...used].join(' ') + ' : l\'outil est là')
      sans(code(files), /_mjs_fxScroll/, [...used].join(' ') + ' : le code du défilement est là')
    }
  })

  it('chaque effet qui l\'appelle : l\'outil vient, une seule fois, après le moteur ; le code embarqué la définit', () => {
    for (const k of APPELANTS) {
      const files = fichiers(new Set(['fx', k]))
      assert.ok(files.includes(OUTIL), k + ' : l\'outil manque')
      assert.ok(files.indexOf('mjs_fx.ts') < files.indexOf(OUTIL), k + ' : le moteur doit précéder l\'outil')
      assert.equal(files.filter((f) => f === OUTIL).length, 1, k)
      assert.equal(code(files).match(/^µ\._mjs_fxScroll = /gm)?.length, 1, k)
    }
  })

  it('un effet nommé à l\'exécution (`fx: $effet`) qui peut l\'appeler (*path, *stagger se nomment) : l\'outil vient', () => {
    assert.ok(APPELANTS.some((k) => FX_NAMEABLE_KEYS.includes(k)), 'aucun appelant ne se nomme : le cas ne se pose plus')
    const files = fichiers(new Set(['fx', FX_NAMED]))
    assert.ok(files.includes(OUTIL))
    assert.ok(files.indexOf('mjs_fx.ts') < files.indexOf(OUTIL))
  })

  it('demandé par son nom (runtime: [\'fx_toolscroll\']), même sans effet dans la page : avec le moteur, avant lui ; en \'all\' : là aussi', () => {
    const files = fichiers(new Set(), { runtime: ['fx_toolscroll'] })
    assert.ok(files.includes(OUTIL) && files.includes('mjs_fx.ts'))
    assert.ok(files.indexOf('mjs_fx.ts') < files.indexOf(OUTIL))
    assert.ok(fichiers(undefined, { runtime: 'all' }).includes(OUTIL))
  })

  it('elle passe par les outils du cœur (parents à travers les ombres, « est dans », racines d\'ombre) sans en recopier le code : la table les demande, chaque appelant les embarque', () => {
    const outil = lire(OUTIL)
    assert.match(outil, /µ\._mjs_fxParent\b/)
    assert.match(outil, /µ\._mjs_fxWithin\(/)
    assert.match(outil, /µ\._mjs_fxRoots\(/)
    sans(outil, /nodeType === 11/, 'l\'outil recopie le parcours des parents de µ._mjs_fxParent')
    sans(outil, /roots\.indexOf\(/, 'l\'outil recopie la liste des racines de µ._mjs_fxRoots')
    assert.deepEqual(FX_TOOLS.fx_toolscroll.needs, ['fx_toolup', 'fx_toolroots'])
    for (const k of APPELANTS) {
      const files = fichiers(new Set(['fx', k]))
      for (const dep of ['mjs_fx_toolup.ts', 'mjs_fx_toolroots.ts']) assert.equal(files.filter((f) => f === dep).length, 1, k + ' : ' + dep + ' doit venir une fois')
    }
    for (const dep of ['mjs_fx_toolup.ts', 'mjs_fx_toolroots.ts']) assert.ok(!fichiers(new Set(['fx', 'fx_neon'])).includes(dep), '*neon seul embarque ' + dep)
  })

  it('la table des outils : exactement les cinq effets qui appellent l\'avancée, et ceux-là seuls (aucun autre effet ne la cite)', () => {
    const t = FX_TOOLS.fx_toolscroll
    assert.deepEqual([...t.effects].sort(), APPELANTS)
    assert.deepEqual(t.needs, ['fx_toolup', 'fx_toolroots'])
    const effets = readdirSync(RUNTIME).filter((f) => /^mjs_fx_[a-z0-9_]+\.ts$/.test(f) && !/^mjs_fx_tool[a-z]+\.ts$/.test(f))
    const cites  = effets.filter((f) => /µ\._mjs_fxScroll\(/.test(lire(f))).map((f) => f.slice(4, -3)).sort()
    assert.deepEqual(cites, APPELANTS)
    assert.ok(t.uses.test('µ._mjs_fxScroll('))
  })
})
