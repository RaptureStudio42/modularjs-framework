// Une prop à tiret (`search-placeholder`) reçoit sa valeur sous son nom camelCase (`searchPlaceholder`) quelle que soit la forme qui la
// pose : en dur, par une expression `{…}`, par une liaison `!{…}`, par un étalement `{...$p}`. Chaque forme se joue à la racine du parent,
// dans un `{if}` levé par un bouton et dans une ligne de `{for}`, dans cinq modes de chargement (développement avec les parents définis
// avant ou après les enfants, production en un fichier ou en fichiers séparés, rendu serveur puis hydratation) : l'enfant pas encore mis
// à niveau reçoit la prop par le registre des props en attente, l'enfant mis à niveau par `_set`. Le module cœur <@@select> lit
// `search-placeholder` comme le composant du projet. Une balise `mjs-…` hors du manifeste (un web component tiers) garde l'attribut
// brut `some-thing` pour la liaison à deux sens : il le lit tel quel. Chromium réel.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MODES, variantes, construire, charger, attendre, lever, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'
import { SELECT_DE_HOTE } from './helpers/sonde-select.js'

const SOURCES: Record<string, string> = {
  'c-carte.mjs': [
    '<script>',
    "  $searchPlaceholder = 'défaut'",
    '  $showAll           = false',
    '  $itemCount         = 0',
    '</script>',
    '<p class="vu">{$searchPlaceholder}|{typeof $itemCount}:{$itemCount}</p>'
  ].join('\n'),
  'p-formes.mjs': [
    '<script>',
    "  $x = 'un'",
    '  $n = 2',
    "  $p = { 'search-placeholder': 'etale', 'item-count': 5 }",
    '  $show = false',
    "  $rows = [{ x: 'r-un', n: 3, p: { 'search-placeholder': 'r-etale', 'item-count': 6 } }]",
    '</script>',
    '<@c-carte class="dur" search-placeholder="Chercher" show-all></@c-carte>',
    '<@c-carte class="expr" search-placeholder={$x} item-count={$n}></@c-carte>',
    '<@c-carte class="lie" search-placeholder=!{$x}></@c-carte>',
    '<@c-carte class="etale" {...$p}></@c-carte>',
    '<button class="go" @click={$show = true}>go</button>',
    '{if $show}',
    '  <@c-carte class="si-expr" search-placeholder={$x} item-count={$n}></@c-carte>',
    '  <@c-carte class="si-lie" search-placeholder=!{$x}></@c-carte>',
    '  <@c-carte class="si-etale" {...$p}></@c-carte>',
    '{end}',
    '{for r in $rows}',
    '  <@c-carte class="pour-expr" search-placeholder={r.x} item-count={r.n}></@c-carte>',
    '  <@c-carte class="pour-lie" search-placeholder=!{r.x}></@c-carte>',
    '  <@c-carte class="pour-etale" {...r.p}></@c-carte>',
    '{end}'
  ].join('\n'),
  'p-select.mjs': [
    '<script>',
    "  $ph = 'Trouver un pays'",
    '</script>',
    '<@@select class="s" name="pays" search search-placeholder={$ph}>',
    '  <@@option value="fr">France</@@option>',
    '</@@select>'
  ].join('\n'),
  'p-tiers.mjs': [
    '<script>',
    '  $v = 7',
    "  $q = { 'some-thing': 9 }",
    '</script>',
    '<mjs-tiers some-thing=!{$v}></mjs-tiers>',
    '<mjs-tiers-expr some-thing={$v}></mjs-tiers-expr>',
    '<mjs-tiers-etale {...$q}></mjs-tiers-etale>',
    '<button class="g" @click={$v = 8}>g</button>'
  ].join('\n')
}

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, ['mjs-p-formes']))
  return cibles.get(mode)!
}

const titre = (mode: Mode, variante: string) => mode + (variante ? ` (${variante})` : '')

// ce que montre chaque carte : sa ligne `.vu`, et les clés à tiret de son état (il ne doit y en avoir aucune)
const CARTES = `(() => {
  const h = document.querySelector('mjs-p-formes')
  const out = {}
  for (const c of h._shadow.querySelectorAll('mjs-c-carte')) out[c.className] = [c._shadow.querySelector('.vu').textContent, Object.keys(c._state).filter((k) => k.includes('-')).join(',')]
  return out
})()`

const RACINE: Record<string, string[]> = {
  dur:   ['Chercher|number:0', ''],
  expr:  ['un|number:2', ''],
  lie:   ['un|number:0', ''],
  etale: ['etale|number:5', '']
}
const LIGNE: Record<string, string[]> = {
  'pour-expr':  ['r-un|number:3', ''],
  'pour-lie':   ['r-un|number:0', ''],
  'pour-etale': ['r-etale|number:6', '']
}
const SI: Record<string, string[]> = {
  'si-expr':  RACINE.expr,
  'si-lie':   RACINE.lie,
  'si-etale': RACINE.etale
}

const attendreCartes = (page: any, nb: number) => page.waitForFunction(`(() => {
  const h = document.querySelector('mjs-p-formes')
  const k = h && h._shadow ? h._shadow.querySelectorAll('mjs-c-carte') : []
  return k.length >= ${nb} && Array.from(k).every((c) => c._mjs_is_mounted && c._shadow && c._shadow.querySelector('.vu'))
})()`, null, { timeout: 8000 }).catch(() => {})

describe('props à tiret — Chromium réel', function () {
  this.timeout(300000)
  let present = false
  let browser: any

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test des props à tiret sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES) for (const variante of variantes(mode)) {
    it(`${titre(mode, variante)} : en dur, expression, liaison et étalement posent la prop sous son nom camelCase (racine, {if}, {for})`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-formes', variante)
      try {
        await attendre(o.page, 'mjs-p-formes', 7)
        await attendreCartes(o.page, 7)
        await o.page.waitForTimeout(300)
        assert.deepEqual(await o.page.evaluate(CARTES), { ...RACINE, ...LIGNE }, 'au chargement : chaque forme montre sa valeur, aucune clé à tiret dans l\'état')

        await lever(o.page, 'mjs-p-formes')
        await attendreCartes(o.page, 10)
        await o.page.waitForTimeout(300)
        assert.deepEqual(await o.page.evaluate(CARTES), { ...RACINE, ...SI, ...LIGNE }, 'dans le {if} levé par le bouton')

        await o.page.evaluate(`(() => { const h = document.querySelector('mjs-p-formes'); h._set('x', 'deux'); h._set('n', 7); h._set('p', { 'search-placeholder': 'etale-2', 'item-count': 9 }) })()`)
        await o.page.waitForTimeout(400)
        const suivi: any = await o.page.evaluate(CARTES)
        assert.equal(suivi.expr[0], 'deux|number:7', 'l\'expression suit ses variables')
        assert.equal(suivi.lie[0], 'deux|number:0', 'la liaison descend')
        assert.equal(suivi['si-expr'][0], 'deux|number:7', 'dans le {if}')
        assert.equal(suivi['si-lie'][0], 'deux|number:0')
        assert.equal(suivi.etale[0], 'etale-2|number:9', 'l\'étalement suit sa donnée')
        assert.equal(suivi['si-etale'][0], 'etale-2|number:9')

        // l'enfant écrit : la variable du parent suit, à la racine comme dans la ligne
        await o.page.evaluate(`(() => { const h = document.querySelector('mjs-p-formes'); h._shadow.querySelector('.lie')._set('searchPlaceholder', 'ecrit'); h._shadow.querySelector('.pour-lie')._set('searchPlaceholder', 'ecrit-ligne') })()`)
        await o.page.waitForTimeout(400)
        const remonte: any = await o.page.evaluate(`(() => { const h = document.querySelector('mjs-p-formes'); return { x: h._state.x, ligne: h._state.rows[0].x } })()`)
        assert.deepEqual(remonte, { x: 'ecrit', ligne: 'ecrit-ligne' }, 'la liaison à deux sens remonte sous la clé de l\'enfant')
        assert.deepEqual(graves(o), [], 'aucune erreur, aucun plantage de composant')
      } finally {
        await o.fermer()
      }
    })
  }

  for (const mode of MODES.filter((m) => m !== 'ssr')) {
    it(`${mode} : <@@select search-placeholder={$ph}> affiche le texte dans son champ de recherche et le suit`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-select')
      try {
        const select = SELECT_DE_HOTE
        await o.page.waitForFunction(`(() => { const s = ${select}; return !!(s && s._mjs_is_mounted && s._shadow && s._shadow.querySelector('.select-btn') && s._state.optionsData && s._state.optionsData.length > 0) })()`, null, { timeout: 8000 }).catch(() => {})
        await o.page.evaluate(`${select}._shadow.querySelector('.select-btn').click()`)
        await o.page.waitForFunction(`!!${select}?._shadow?.querySelector('.select-search')`, null, { timeout: 5000 }).catch(() => {})
        const champ = () => o.page.evaluate(`${select}._shadow.querySelector('.select-search').getAttribute('placeholder')`)
        assert.equal(await champ(), 'Trouver un pays')
        await o.page.evaluate(`document.querySelector('mjs-p-select')._set('ph', 'Autre texte')`)
        await o.page.waitForTimeout(300)
        assert.equal(await champ(), 'Autre texte', 'la valeur suit la variable')
        assert.deepEqual(graves(o), [], 'aucune erreur')
      } finally {
        await o.fermer()
      }
    })
  }

  for (const mode of ['bundle', 'split'] as const) {
    it(`${mode} : une balise mjs-… hors du manifeste garde l'attribut brut \`some-thing\` en liaison à deux sens`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-tiers')
      try {
        const tiers = `document.querySelector('mjs-p-tiers')._shadow.querySelector('mjs-tiers')`
        await o.page.waitForFunction(`!!(document.querySelector('mjs-p-tiers') && document.querySelector('mjs-p-tiers')._shadow && document.querySelector('mjs-p-tiers')._shadow.querySelector('.g'))`, null, { timeout: 5000 }).catch(() => {})
        await o.page.waitForTimeout(300)
        const attributs = () => o.page.evaluate(`Array.from(${tiers}.attributes).map((a) => a.name + '=' + a.value).join(' ')`)
        assert.equal(await attributs(), 'some-thing=7', 'l\'attribut brut, pas de nom camélisé')
        await o.page.evaluate(`document.querySelector('mjs-p-tiers')._shadow.querySelector('.g').click()`)
        await o.page.waitForTimeout(300)
        assert.equal(await attributs(), 'some-thing=8', 'l\'attribut suit la variable')
        assert.deepEqual(graves(o), [], 'aucune erreur')
      } finally {
        await o.fermer()
      }
    })
  }

  for (const mode of ['bundle', 'split'] as const) {
    it(`${mode} : une balise mjs-… hors du manifeste reçoit la clé brute \`some-thing\` par \`{…}\` et \`{...$p}\``, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-tiers')
      try {
        const lire = (balise: string) => o.page.evaluate(`(() => { const e = document.querySelector('mjs-p-tiers')._shadow.querySelector('${balise}'); return [e['some-thing'], e.someThing] })()`)
        await o.page.waitForFunction(`!!(document.querySelector('mjs-p-tiers') && document.querySelector('mjs-p-tiers')._shadow && document.querySelector('mjs-p-tiers')._shadow.querySelector('.g'))`, null, { timeout: 5000 }).catch(() => {})
        await o.page.waitForTimeout(300)
        assert.deepEqual(await lire('mjs-tiers-expr'), [7, undefined], '`{…}` : la clé écrite')
        assert.deepEqual(await lire('mjs-tiers-etale'), [9, undefined], '`{...$p}` : la clé de la donnée')
        assert.deepEqual(graves(o), [], 'aucune erreur')
      } finally {
        await o.fermer()
      }
    })
  }
})
