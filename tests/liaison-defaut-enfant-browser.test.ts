// Le défaut qu'un enfant écrit dans son script (`$x = null`, `$x = []`, `$x = 'a'`) n'est pas une écriture de l'enfant : il ne remonte JAMAIS
// dans la variable que le parent lui lie à deux sens (`x=!{$v}`) — le parent gagne, y compris dans sa propre variable. Ce qui remonte, ce sont
// les écritures de l'enfant une fois monté : un geste, son `µmount`, une minuterie.
// Un enfant pas encore défini quand son parent le traite (fichiers séparés, ordre des fichiers en développement, rendu serveur, ligne de
// `{for}` clonée dans un gabarit inerte) écrivait son défaut dans la variable du parent à sa mise à niveau : un parent qui lit sa variable
// sans garde (`$v.map(…)`) plantait, et la variable gardait la valeur de l'enfant. Chaque cas se joue à la racine du parent, dans un `{if}` et
// dans un `{for}`, dans cinq modes de chargement (développement avec les parents définis avant ou après les enfants, production en un fichier
// ou en fichiers séparés, rendu serveur puis hydratation), dans Chromium et Firefox réels. Les types (7 reste un nombre, une date reste une
// date) ont leur fichier : liaison-types-conserves-browser.test.ts.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MODES, VARIANTES, variantes, SHOW, DBL, construire, charger, attendre, lire, lever, graves, parent, enfant } from './helpers/liaison-navigateur.js'
import type { Cible, Liaison, Lecture, Mode, Ouverture } from './helpers/liaison-navigateur.js'

// des enfants au défaut de chaque sorte, et un sans défaut
const SOURCES: Record<string, string> = {
  'c-null.mjs':      enfant('  $x = null\n'),
  'c-arr.mjs':       enfant('  $x = []\n'),
  'c-str.mjs':       enfant("  $x = 'a'\n"),
  'c-zero.mjs':      enfant('  $x = 0\n'),
  'c-none.mjs':      enfant(''),
  // ce que l'enfant écrit APRÈS son montage : un geste, son µmount, une minuterie
  'c-geste.mjs':     `<script>\n  ${SHOW}\n</script>\n<button class="g" @click={$x = [9, 8, 7]}>g</button>\n<p class="vu">{show($x)}</p>\n`,
  'c-montage.mjs':   enfant('  µmount -> $x = 42\n'),
  'c-minuterie.mjs': enfant('  µmount -> setTimeout((-> $x = { k: 2 }), 30)\n'),
  // la prop liée n'a besoin d'aucune déclaration : le parent initialise sa variable, l'enfant ne fait qu'y écrire
  'c-clavier.mjs':   `<script>\n  select = (digit)-> $x += digit\n  ${SHOW}\n</script>\n<button class="b1" @click={select(1)}>1</button><button class="b2" @click={select(2)}>2</button>\n<p class="vu">{show($x)}</p>\n`
}

const LIAISONS: Liaison[] = [
  { enfant: 'c-null', valeur: '[1, 2, 3]', lit: true },
  { enfant: 'c-arr',  valeur: "['q']" },
  { enfant: 'c-str',  valeur: "'b'" },
  { enfant: 'c-none', valeur: '[4, 5]' },
  { enfant: 'c-null', valeur: '{ k: 1 }' }
]
const VALEURS  = ['[1,2,3] <object>', '["q"] <object>', '"b" <string>', '[4,5] <object>', '{"k":1} <object>']
const ENFANTS  = ['c-null=' + VALEURS[0], 'c-arr=' + VALEURS[1], 'c-str=' + VALEURS[2], 'c-none=' + VALEURS[3], 'c-null=' + VALEURS[4]]
const REMONTES = ['c-null.x=' + VALEURS[0], 'c-arr.x=' + VALEURS[1], 'c-str.x=' + VALEURS[2], 'c-none.x=' + VALEURS[3], 'c-null.x=' + VALEURS[4]]

// à un sens : l'enfant reçoit la valeur du parent, typée, et rien ne remonte
const UN_SENS = `<script>
  $z = 7
  $n = [1, 2, 3]
  $s = 'b'
  ${DBL}
  ${SHOW}
</script>
<@c-zero x={$z}></@c-zero>
<@c-null x={$n}></@c-null>
<@c-str x={$s}></@c-str>
<p class="p0">{show($z)}</p><p class="p1">{show($n)}</p><p class="p2">{show($s)}</p><p class="m1">{dbl($n)}</p>
`

const ECRITURES = `<script>
  $g = ['depart']
  $m = 'avant'
  $t = 1
  ${SHOW}
</script>
<@c-geste x=!{$g}></@c-geste>
<@c-montage x=!{$m}></@c-montage>
<@c-minuterie x=!{$t}></@c-minuterie>
<p class="p0">{show($g)}</p><p class="p1">{show($m)}</p><p class="p2">{show($t)}</p>
`

const CLAVIER = `<script>
  $pin = ''
  ${SHOW}
</script>
<@c-clavier x=!{$pin}></@c-clavier>
<p class="p0">{show($pin)}</p>
`

// les modules du cœur dont la prop liée n'est ni un nombre ni une date ; le parent lit `$sel.map` sans garde
const COEUR = `<script>
  $sel = ['a', 'b']
  $t = 'x'
  $col = '#ff0000'
  $ck = true
  $sw = true
  $r = 'y'
  $op = true
  ids = (l)-> l.map(String).join(',')
  ${SHOW}
</script>
<@@select multiple value=!{$sel}>
  <@@option value="a">A</@@option>
  <@@option value="b">B</@@option>
  <@@option value="c">C</@@option>
</@@select>
<@@tabs value=!{$t}><span value="x">X</span><span value="y">Y</span></@@tabs>
<@@color value=!{$col}></@@color>
<@@checkbox checked=!{$ck}>c</@@checkbox>
<@@switch checked=!{$sw}>s</@@switch>
<@@radio name="g" value="x" group=!{$r}>x</@@radio>
<@@radio name="g" value="y" group=!{$r}>y</@@radio>
<@@menu open=!{$op}><a href="/">a</a></@@menu>
<p class="p0">{show($sel)}</p><p class="p1">{show($t)}</p><p class="p2">{show($col)}</p><p class="p3">{show($ck)}</p><p class="p4">{show($sw)}</p><p class="p5">{show($r)}</p><p class="p6">{show($op)}</p><p class="m0">{ids($sel)}</p>
`

for (const lieu of ['racine', 'si', 'pour'] as const) SOURCES['p-' + lieu + '.mjs'] = parent(lieu, LIAISONS)
SOURCES['p-un-sens.mjs']   = UN_SENS
SOURCES['p-ecritures.mjs'] = ECRITURES
SOURCES['p-coeur.mjs']     = COEUR
SOURCES['p-clavier.mjs']   = CLAVIER

// le rendu serveur ne joue que les parents sans module du cœur
const BALISES_SSR = ['mjs-p-racine', 'mjs-p-si', 'mjs-p-pour', 'mjs-p-un-sens', 'mjs-p-ecritures', 'mjs-p-clavier']

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES_SSR))
  return cibles.get(mode)!
}

const titre = (mode: Mode, variante: string) => mode + (variante ? ` (${variante})` : '')

function verifier(lu: Lecture, o: Ouverture, contexte: string) {
  assert.deepEqual(graves(o), [], `${contexte} : aucune erreur, aucun plantage de composant`)
  const attendu: Record<string, string> = { m0: '2,4,6' }
  VALEURS.forEach((v, i) => { attendu['p' + i] = v })
  assert.deepEqual(lu.ps, attendu, `${contexte} : le parent garde ses valeurs, et sa lecture sans garde (.map) se rend`)
  assert.deepEqual(lu.enf, ENFANTS, `${contexte} : chaque enfant montre la valeur de son parent, jamais son défaut`)
  assert.deepEqual(lu.binds.filter((b) => !REMONTES.includes(b)), [], `${contexte} : rien d'autre que la valeur du parent ne remonte (ni défaut, ni valeur changée de type)`)
}

for (const nom of ['chromium', 'firefox'] as const) describe(`défaut d'un enfant lié à deux sens (${nom} réel)`, function () {
  this.timeout(300000)
  let present = false
  let browser: any

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) { console.log(`  ℹ️  ${nom} non installé, test du défaut des enfants sauté. Activer : \`npx playwright install ${nom}\``); return }
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const lieu of ['racine', 'si', 'pour'] as const) {
    const lieux = { racine: 'à la racine du parent', si: 'dans un {if}', pour: 'dans un {for}' }
    for (const mode of MODES) for (const variante of variantes(mode)) {
      it(`${lieux[lieu]}, ${titre(mode, variante)} : le défaut de l'enfant ne remonte pas, le parent garde ses valeurs`, async function () {
        if (!present) { this.skip(); return }
        const balise = 'mjs-p-' + lieu
        const o = await charger(browser, await cible(mode), balise, variante)
        try {
          if (lieu === 'si') {
            await attendre(o.page, balise, 0)
            await lever(o.page, balise)
          }
          await attendre(o.page, balise, LIAISONS.length)
          verifier(await lire(o.page, balise), o, `${lieux[lieu]}, ${titre(mode, variante)}`)
        } finally {
          await o.fermer()
        }
      })
    }
  }

  for (const mode of MODES) for (const variante of VARIANTES[mode]) {
    it(`à un sens (x={$v}), ${titre(mode, variante)} : l'enfant reçoit la valeur typée du parent, rien ne remonte`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-un-sens', variante)
      try {
        await attendre(o.page, 'mjs-p-un-sens', 3)
        const lu = await lire(o.page, 'mjs-p-un-sens')
        assert.deepEqual(graves(o), [], 'aucune erreur')
        assert.deepEqual(lu.ps, { p0: '7 <number>', p1: '[1,2,3] <object>', p2: '"b" <string>', m1: '2,4,6' }, 'le parent garde ses valeurs')
        assert.deepEqual(lu.enf, ['c-zero=7 <number>', 'c-null=[1,2,3] <object>', 'c-str="b" <string>'], 'chaque enfant a la valeur du parent, avec son type')
        assert.deepEqual(lu.binds, [], 'une liaison à un sens ne fait rien remonter')
      } finally {
        await o.fermer()
      }
    })

    it(`parent qui initialise sa variable (\$pin = ''), enfant sans déclaration, ${titre(mode, variante)} : rien ne remonte au chargement, chaque touche remonte`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-clavier', variante)
      try {
        await attendre(o.page, 'mjs-p-clavier', 1)
        const avant = await lire(o.page, 'mjs-p-clavier')
        assert.deepEqual(graves(o), [], 'aucune erreur')
        assert.deepEqual(avant.ps, { p0: '"" <string>' }, 'le parent garde sa chaîne vide')
        assert.deepEqual(avant.binds.filter((b) => b !== 'c-clavier.x="" <string>'), [], 'rien d\'autre que la valeur du parent ne remonte')
        for (const touche of ['b1', 'b2']) await o.page.evaluate(`document.querySelector('mjs-p-clavier')._shadow.querySelector('mjs-c-clavier')._shadow.querySelector('.${touche}').click()`)
        await o.page.waitForTimeout(300)
        const apres = await lire(o.page, 'mjs-p-clavier')
        assert.deepEqual(graves(o), [], 'aucune erreur')
        assert.deepEqual(apres.ps, { p0: '"12" <string>' }, 'les deux touches ont remonté')
        assert.deepEqual(apres.enf, ['c-clavier="12" <string>'], 'l\'enfant montre ce qu\'il a écrit')
      } finally {
        await o.fermer()
      }
    })

    it(`écritures de l'enfant une fois monté (geste, µmount, minuterie), ${titre(mode, variante)} : elles remontent, avec leur type`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-ecritures', variante)
      try {
        await attendre(o.page, 'mjs-p-ecritures', 3)
        const avant = await lire(o.page, 'mjs-p-ecritures')
        assert.equal(avant.ps.p0, '["depart"] <object>', 'avant le geste, le parent garde sa valeur')
        assert.equal(avant.ps.p1, '42 <number>', 'l\'écriture du µmount remonte, nombre resté nombre')
        assert.equal(avant.ps.p2, '{"k":2} <object>', 'l\'écriture de la minuterie remonte, objet resté objet')
        await o.page.evaluate(`document.querySelector('mjs-p-ecritures')._shadow.querySelector('mjs-c-geste')._shadow.querySelector('.g').click()`)
        await o.page.waitForTimeout(300)
        const apres = await lire(o.page, 'mjs-p-ecritures')
        assert.deepEqual(graves(o), [], 'aucune erreur')
        assert.equal(apres.ps.p0, '[9,8,7] <object>', 'l\'écriture du geste remonte, tableau resté tableau')
        assert.equal(apres.ps.p1, '42 <number>')
        assert.equal(apres.ps.p2, '{"k":2} <object>')
        assert.deepEqual(apres.enf, ['c-geste=[9,8,7] <object>', 'c-montage=42 <number>', 'c-minuterie={"k":2} <object>'], 'les enfants montrent ce qu\'ils ont écrit')
        for (const attendu of ['c-geste.x=[9,8,7] <object>', 'c-montage.x=42 <number>', 'c-minuterie.x={"k":2} <object>']) assert.ok(apres.binds.includes(attendu), `${attendu} est remonté (remontés : ${apres.binds.join(' ; ')})`)
      } finally {
        await o.fermer()
      }
    })
  }

  // les modules du cœur, sans rendu serveur
  for (const mode of MODES.filter((m) => m !== 'ssr')) {
    it(`modules du cœur liés (select, tabs, color, checkbox, switch, radio, menu), ${mode} : la variable du parent garde sa valeur et son type`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-coeur')
      try {
        await attendre(o.page, 'mjs-p-coeur', 9)
        const lu = await lire(o.page, 'mjs-p-coeur')
        assert.deepEqual(graves(o), [], 'aucune erreur, aucun plantage de composant')
        assert.deepEqual(lu.ps, { p0: '["a","b"] <object>', p1: '"x" <string>', p2: '"#ff0000" <string>', p3: 'true <boolean>', p4: 'true <boolean>', p5: '"y" <string>', p6: 'true <boolean>', m0: 'a,b' }, 'le parent garde ses valeurs')
      } finally {
        await o.fermer()
      }
    })
  }
})
