// Une classe calculée (`class="c{$n}"`) et une classe basculée (`@class{$flag}="on"`) sur la même balise
// vivent ensemble, quel que soit l'ordre d'écriture. Défaut garanti absent : avec la bascule écrite AVANT
// la classe calculée, le premier rendu effaçait la classe basculée (« c0 » au lieu de « c0 on ») et elle ne
// revenait pas (la bascule garde sa dernière valeur, elle ne rejoue pas).
// Le `className` EXACT est vérifié après chaque changement : un jeton de l'ancienne classe calculée qui
// reste (« c0 c1 on »), ou une classe basculée perdue, se voit tout de suite — un test qui ne regarde que
// « contient on » laisserait passer les deux.
// Gardes : une classe qu'aucune bascule active n'a posée (celle d'un rendu serveur que l'état de la page
// ne redit pas : « theme-light » devenu « theme-dark ») tombe au premier rendu, comme avant.
// Les jetons à caractères spéciaux (« is-active », « md:flex », « w-1/2 », « p-0.5 ») se retrouvent eux aussi : la
// garde de la bascule porte le nom de la classe réduit à des lettres, chiffres et soulignés, et la classe déjà
// posée est réduite de la même façon avant la comparaison.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const CORPS = '<button class="n" @click={$n++}>n</button><button class="f" @click={$flag = !$flag}>f</button>\n'

const SOURCES: Record<string, string> = {
  'cl-avant.mjs':  '<script>\n$n = 0\n$flag = true\n</script>\n<div data-t="cible" @class{$flag}="on" class="c{$n}">x</div>\n' + CORPS,
  'cl-apres.mjs':  '<script>\n$n = 0\n$flag = true\n</script>\n<div data-t="cible" class="c{$n}" @class{$flag}="on">x</div>\n' + CORPS,
  'cl-faux.mjs':   '<script>\n$n = 0\n$flag = false\n</script>\n<div data-t="cible" @class{$flag}="on" class="c{$n}">x</div>\n' + CORPS,
  'cl-fixe.mjs':   '<script>\n$n = 0\n$flag = true\n</script>\n<div data-t="cible" @class{$flag}="on" class="fixe c{$n}">x</div>\n' + CORPS,
  'cl-double.mjs': '<script>\n$n = 0\n$flag = true\n</script>\n<div data-t="cible" @class{$flag}="un deux" class="c{$n}">x</div>\n' + CORPS,
  'cl-tiret.mjs':  '<script>\n$n = 0\n$flag = true\n</script>\n<div data-t="cible" @class{$flag}="is-active" class="c{$n}">x</div>\n' + CORPS,
  'cl-deuxpts.mjs': '<script>\n$n = 0\n$flag = true\n</script>\n<div data-t="cible" @class{$flag}="md:flex" class="c{$n}">x</div>\n' + CORPS,
  'cl-multi.mjs':  '<script>\n$n = 0\n$flag = true\n</script>\n<div data-t="cible" @class{$flag}="w-1/2 sm:p-0.5" class="c{$n}">x</div>\n' + CORPS,
  'cl-ligne.mjs':  '<script>\n$n = 0\n$flag = true\n$rows = [1, 2]\n</script>\n<ul>{for r in $rows by r}<li data-t="cible" @class{$flag}="on" class="r{$n}">{r}</li>{end}</ul>\n' + CORPS
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('classe basculée et classe calculée sur la même balise : le className exact, quel que soit l\'ordre', function () {
  this.timeout(60000)
  let code = ''

  before(async () => {
    const root   = mjsTmp('classe-premier-rendu')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    code = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  after(async () => { await terminateSharedWorkerPool() })

  async function monter(nom: string) {
    const win: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    win.eval(`${code}\nglobalThis.µ = µ;\nµ.error = function() {};\nµ.warn = function() {};`)
    win.document.body.innerHTML = '<mjs-' + nom + '></mjs-' + nom + '>'
    const hote = win.document.querySelector('mjs-' + nom)
    for (let i = 0; i < 150 && !hote?._shadow?.querySelector('[data-t="cible"]'); i++) await pause(20)
    await pause(80)
    const classes = () => [...hote._shadow.querySelectorAll('[data-t="cible"]')].map((n: any) => n.className)
    const cliquer = async (sel: string) => { hote._shadow.querySelector(sel).click(); await pause(60) }
    return { win, hote, classes, cliquer }
  }

  it('bascule écrite AVANT la classe calculée : « c0 on » au premier rendu, gardé après chaque changement', async function () {
    const { classes, cliquer } = await monter('cl-avant')
    assert.deepEqual(classes(), ['c0 on'], 'premier rendu')
    await cliquer('.n')
    assert.deepEqual(classes(), ['c1 on'], '$n passe à 1 : jamais « c0 c1 on »')
    await cliquer('.n')
    assert.deepEqual(classes(), ['c2 on'], '$n passe à 2')
    await cliquer('.f')
    assert.deepEqual(classes(), ['c2'], 'la bascule se coupe')
    await cliquer('.n')
    assert.deepEqual(classes(), ['c3'], '$n passe à 3, bascule coupée')
    await cliquer('.f')
    assert.deepEqual(classes(), ['c3 on'], 'la bascule revient')
    await cliquer('.n')
    assert.deepEqual(classes(), ['c4 on'], '$n passe à 4')
  })

  it('bascule écrite APRÈS la classe calculée : même résultat (garde)', async function () {
    const { classes, cliquer } = await monter('cl-apres')
    assert.deepEqual(classes(), ['c0 on'], 'premier rendu')
    await cliquer('.n')
    assert.deepEqual(classes(), ['c1 on'])
    await cliquer('.f')
    assert.deepEqual(classes(), ['c1'])
    await cliquer('.n')
    assert.deepEqual(classes(), ['c2'])
    await cliquer('.f')
    assert.deepEqual(classes(), ['c2 on'])
  })

  it('bascule coupée au départ, écrite avant la classe calculée : « c0 », puis « c0 on » quand elle s\'allume', async function () {
    const { classes, cliquer } = await monter('cl-faux')
    assert.deepEqual(classes(), ['c0'], 'premier rendu')
    await cliquer('.f')
    assert.deepEqual(classes(), ['c0 on'], 'la bascule s\'allume')
    await cliquer('.n')
    assert.deepEqual(classes(), ['c1 on'])
  })

  it('classe calculée qui mêle texte fixe et valeur (« fixe c{$n} ») : « fixe c0 on », puis « fixe c1 on »', async function () {
    const { classes, cliquer } = await monter('cl-fixe')
    assert.deepEqual(classes(), ['fixe c0 on'], 'premier rendu')
    await cliquer('.n')
    assert.deepEqual(classes(), ['fixe c1 on'])
  })

  it('bascule de plusieurs classes (« un deux ») écrite avant la classe calculée : les deux jetons restent', async function () {
    const { classes, cliquer } = await monter('cl-double')
    assert.deepEqual(classes(), ['c0 un deux'], 'premier rendu')
    await cliquer('.n')
    assert.deepEqual(classes(), ['c1 un deux'])
    await cliquer('.f')
    assert.deepEqual(classes(), ['c1'])
    await cliquer('.f')
    assert.deepEqual(classes(), ['c1 un deux'])
  })

  it('bascule « is-active » (tiret) écrite avant la classe calculée : « c0 is-active » au premier rendu, gardé après chaque changement', async function () {
    const { classes, cliquer } = await monter('cl-tiret')
    assert.deepEqual(classes(), ['c0 is-active'], 'premier rendu')
    await cliquer('.n')
    assert.deepEqual(classes(), ['c1 is-active'], '$n passe à 1')
    await cliquer('.f')
    assert.deepEqual(classes(), ['c1'], 'la bascule se coupe')
    await cliquer('.f')
    assert.deepEqual(classes(), ['c1 is-active'], 'la bascule revient')
  })

  it('bascule « md:flex » (deux-points) écrite avant la classe calculée : « c0 md:flex » au premier rendu, gardé après chaque changement', async function () {
    const { classes, cliquer } = await monter('cl-deuxpts')
    assert.deepEqual(classes(), ['c0 md:flex'], 'premier rendu')
    await cliquer('.n')
    assert.deepEqual(classes(), ['c1 md:flex'], '$n passe à 1')
    await cliquer('.f')
    assert.deepEqual(classes(), ['c1'], 'la bascule se coupe')
    await cliquer('.f')
    assert.deepEqual(classes(), ['c1 md:flex'], 'la bascule revient')
  })

  it('bascule de plusieurs classes à caractères spéciaux (« w-1/2 sm:p-0.5 ») écrite avant la classe calculée : les deux jetons restent', async function () {
    const { classes, cliquer } = await monter('cl-multi')
    assert.deepEqual(classes(), ['c0 w-1/2 sm:p-0.5'], 'premier rendu')
    await cliquer('.n')
    assert.deepEqual(classes(), ['c1 w-1/2 sm:p-0.5'], '$n passe à 1')
    await cliquer('.f')
    assert.deepEqual(classes(), ['c1'], 'la bascule se coupe')
  })

  it('lignes d\'un {for} : bascule avant la classe calculée, « r0 on » sur chaque ligne puis « r1 on »', async function () {
    const { classes, cliquer } = await monter('cl-ligne')
    assert.deepEqual(classes(), ['r0 on', 'r0 on'], 'premier rendu')
    await cliquer('.n')
    assert.deepEqual(classes(), ['r1 on', 'r1 on'])
    await cliquer('.f')
    assert.deepEqual(classes(), ['r1', 'r1'])
  })

  it('une classe qu\'aucune bascule active n\'a posée tombe au premier rendu (rendu serveur d\'un autre état)', async function () {
    const { win } = await monter('cl-avant')
    const µ = win.µ
    // sans bascule : la classe d'avant est remplacée par la calculée, comme toujours
    const nu = win.document.createElement('div')
    nu.setAttribute('class', 'theme-light')
    µ._mjs_updAttrNode(nu, 'class', 'theme-dark')
    assert.equal(nu.className, 'theme-dark', 'la classe du serveur tombe')
    // avec une bascule active sur la balise : son jeton reste, celui du serveur tombe
    const bascule = win.document.createElement('div')
    bascule.setAttribute('class', 'c5 on')
    bascule._mjs_cl_on = true
    µ._mjs_updAttrNode(bascule, 'class', 'c0')
    assert.equal(bascule.className, 'c0 on', 'la bascule active reste, « c5 » tombe')
    // une bascule coupée ne garde rien
    const coupee = win.document.createElement('div')
    coupee.setAttribute('class', 'c5 on')
    coupee._mjs_cl_on = false
    µ._mjs_updAttrNode(coupee, 'class', 'c0')
    assert.equal(coupee.className, 'c0', 'une bascule coupée ne garde pas son jeton')
  })
})
