// Le parent gagne toujours, à tous les étages, quel que soit l'ordre dans lequel les composants sont définis. Un composant du milieu tient la
// valeur par défaut de son script (`$x = 'mid-defaut'`) tant que son parent ne lui a pas livré la sienne ; si sa feuille est définie dans
// l'intervalle, elle reçoit cette valeur d'attente (le registre des props en attente) et ne doit pas la renvoyer vers le milieu : il la
// remonterait dans la variable du grand-parent, qui finirait avec le défaut du milieu. Même chose pour un parent qui écrit lui-même dans son
// `µawake` : ce qu'il vient d'écrire n'est jamais remplacé par la valeur d'avant que son enfant avait retenue.
// Les écritures de la feuille, elles, traversent bien les deux étages. Sont joués : les six ordres de définition de trois composants, un
// parent qui écrit au réveil, des valeurs typées sur trois niveaux ; en développement, en production (un fichier, fichiers séparés) et en
// rendu serveur avec ses quatre reprises (markers, positional, diff, replace), dans Chromium et Firefox réels.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { VARIANTES, SHOW, construire, charger, graves, enfant } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

type Role = 'top' | 'mid' | 'leaf'

// l'ordre alphabétique des fichiers fixe l'ordre des définitions : `c-1-…` d'abord, `c-3-…` en dernier
const ORDRES: Role[][] = [['top', 'mid', 'leaf'], ['top', 'leaf', 'mid'], ['mid', 'top', 'leaf'], ['mid', 'leaf', 'top'], ['leaf', 'top', 'mid'], ['leaf', 'mid', 'top']]
const nom = (ordre: Role[], role: Role) => `c-${ordre.indexOf(role) + 1}-${role}`

// la feuille montre sa prop et l'écrit à un clic ; le milieu a un défaut et la lie à la feuille ; le haut la lui lie
function chaine(ordre: Role[]): Record<string, string> {
  const [top, mid, leaf] = (['top', 'mid', 'leaf'] as Role[]).map((r) => nom(ordre, r))
  return {
    [`${leaf}.mjs`]: `<script>\n  $x = null\n  ${SHOW}\n</script>\n<button class="w" @click={$x = [1, 2]}>w</button><p class="vu">{show($x)}</p>\n`,
    [`${mid}.mjs`]: `<script>\n  $x = 'mid-defaut'\n  ${SHOW}\n</script>\n<@${leaf} x=!{$x}></@${leaf}>\n<p class="vu">{show($x)}</p>\n`,
    [`${top}.mjs`]: `<script>\n  $t = [7, 8]\n  ${SHOW}\n</script>\n<@${mid} x=!{$t}></@${mid}>\n<p class="p0">{show($t)}</p>\n`
  }
}

// un parent qui écrit dans son propre `µawake`, et un enfant défini après lui
const REVEIL: Record<string, string> = {
  'c-none.mjs': enfant(''),
  'p-reveil.mjs': `<script>\n  $y = 'a'\n  µawake -> $y = 'b'\n  ${SHOW}\n</script>\n<@c-none x=!{$y}></@c-none>\n<p class="p0">{show($y)}</p>\n`
}

// des valeurs de chaque type à travers trois niveaux : le haut en tient cinq, le milieu et la feuille les relaient sans défaut
const TYPES: Record<string, string> = {
  'c-z-leaf.mjs': enfant(''),
  'c-a-mid.mjs': `<script>\n  ${SHOW}\n</script>\n<@c-z-leaf x=!{$x}></@c-z-leaf>\n<p class="vu">{show($x)}</p>\n`,
  'p-types.mjs': `<script>\n  $v0 = 7\n  $v1 = 0\n  $v2 = false\n  $v3 = new Date(0)\n  $v4 = { a: [1, 2] }\n  ${SHOW}\n</script>\n${[0, 1, 2, 3, 4].map((i) => `<@c-a-mid x=!{$v${i}}></@c-a-mid>`).join('')}\n${[0, 1, 2, 3, 4].map((i) => `<p class="p${i}">{show($v${i})}</p>`).join('')}\n`
}
const VALEURS_TYPEES = ['7 <number>', '0 <number>', 'false <boolean>', '"1970-01-01T00:00:00.000Z" <Date>', '{"a":[1,2]} <object>']

const MODES_CHAINE: Mode[] = ['dev-parents-avant', 'bundle', 'split', 'ssr']
const MODES_TOUS: Mode[]   = ['dev-parents-avant', 'dev-enfants-avant', 'bundle', 'split', 'ssr']
const reprises = (mode: Mode) => VARIANTES[mode]
const titre    = (mode: Mode, variante: string) => mode + (variante ? ` (${variante})` : '')

const cibles = new Map<string, Promise<Cible>>()
function cible(cle: string, mode: Mode, sources: Record<string, string>, balise: string) {
  const k = cle + '/' + mode
  if (!cibles.has(k)) cibles.set(k, construire(mode, sources, [balise]))
  return cibles.get(k)!
}

// le haut monté et, dans l'ombre de chacun, le composant suivant jusqu'à la feuille rendue
async function pret(page: any, chemin: string[]) {
  await page.waitForFunction(`(() => {
    let e = document
    for (const tag of ${JSON.stringify(chemin)}) { e = (e._shadow || e).querySelector(tag); if (!e || !e._mjs_is_mounted) return false }
    return !!(e._shadow && e._shadow.querySelector('.vu'))
  })()`, null, { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(300)
}

// la ligne `.vu` de chaque composant de la chaîne, la ligne du haut, et tout ce qui est remonté (`mjs-bind:*`)
const lireChaine = (page: any, top: string, mid: string, leaf: string): Promise<{ top: string, mid: string, leaf: string, binds: string[] }> => page.evaluate(`(() => {
  const h = document.querySelector('mjs-${top}')
  const m = h && h._shadow && h._shadow.querySelector('mjs-${mid}')
  const f = m && m._shadow && m._shadow.querySelector('mjs-${leaf}')
  const vu = (e) => e && e._shadow && e._shadow.querySelector('.vu') ? e._shadow.querySelector('.vu').textContent : '(absent)'
  return { top: h && h._shadow && h._shadow.querySelector('.p0') ? h._shadow.querySelector('.p0').textContent : '(absent)', mid: vu(m), leaf: vu(f), binds: window.__binds.slice() }
})()`)

for (const nomNavigateur of ['chromium', 'firefox'] as const) describe(`le parent gagne quel que soit l'ordre de définition (${nomNavigateur} réel)`, function () {
  this.timeout(300000)
  let present = false
  let browser: any

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nomNavigateur].executablePath())
    if (!present) { console.log(`  ℹ️  ${nomNavigateur} non installé, test de l'ordre de définition sauté. Activer : \`npx playwright install ${nomNavigateur}\``); return }
    browser = await playwright[nomNavigateur].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const ordre of ORDRES) for (const mode of MODES_CHAINE) for (const variante of reprises(mode)) {
    const [top, mid, leaf] = (['top', 'mid', 'leaf'] as Role[]).map((r) => nom(ordre, r))
    it(`trois niveaux définis dans l'ordre ${ordre.join(', ')}, ${titre(mode, variante)} : la variable du grand-parent garde sa valeur, la feuille écrit jusqu'à elle`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible('chaine-' + ordre.join('-'), mode, chaine(ordre), 'mjs-' + top), 'mjs-' + top, variante)
      try {
        await pret(o.page, ['mjs-' + top, 'mjs-' + mid, 'mjs-' + leaf])
        const lu = await lireChaine(o.page, top, mid, leaf)
        assert.deepEqual(graves(o), [], 'aucune erreur, aucun plantage de composant')
        assert.deepEqual({ top: lu.top, mid: lu.mid, leaf: lu.leaf }, { top: '[7,8] <object>', mid: '[7,8] <object>', leaf: '[7,8] <object>' }, 'le haut garde sa valeur, le milieu et la feuille la montrent')
        assert.deepEqual(lu.binds.filter((b) => b.startsWith(mid + '.x=') && b !== mid + '.x=[7,8] <object>'), [], 'rien d\'autre que la valeur du haut ne remonte du milieu vers lui')
        await o.page.evaluate(`document.querySelector('mjs-${top}')._shadow.querySelector('mjs-${mid}')._shadow.querySelector('mjs-${leaf}')._shadow.querySelector('.w').click()`)
        await o.page.waitForTimeout(300)
        const apres = await lireChaine(o.page, top, mid, leaf)
        assert.deepEqual(graves(o), [], 'aucune erreur après l\'écriture de la feuille')
        assert.deepEqual({ top: apres.top, mid: apres.mid, leaf: apres.leaf }, { top: '[1,2] <object>', mid: '[1,2] <object>', leaf: '[1,2] <object>' }, 'l\'écriture de la feuille traverse les deux étages')
      } finally {
        await o.fermer()
      }
    })
  }

  for (const mode of MODES_TOUS) for (const variante of reprises(mode)) {
    it(`parent qui écrit dans son µawake, enfant défini après lui, ${titre(mode, variante)} : la valeur écrite par le parent tient chez lui et chez l'enfant`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible('reveil', mode, REVEIL, 'mjs-p-reveil'), 'mjs-p-reveil', variante)
      try {
        await pret(o.page, ['mjs-p-reveil', 'mjs-c-none'])
        const lu = await o.page.evaluate(`(() => {
          const h = document.querySelector('mjs-p-reveil')
          const e = h._shadow.querySelector('mjs-c-none')
          return { parent: h._shadow.querySelector('.p0').textContent, enfant: e._shadow.querySelector('.vu').textContent }
        })()`)
        assert.deepEqual(graves(o), [], 'aucune erreur, aucun plantage de composant')
        assert.deepEqual(lu, { parent: '"b" <string>', enfant: '"b" <string>' }, 'le parent garde ce qu\'il a écrit au réveil, l\'enfant le montre')
      } finally {
        await o.fermer()
      }
    })

    it(`valeurs typées sur trois niveaux (7, 0, false, date, objet), ${titre(mode, variante)} : chaque étage garde la valeur et le type du haut`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible('types', mode, TYPES, 'mjs-p-types'), 'mjs-p-types', variante)
      try {
        await pret(o.page, ['mjs-p-types', 'mjs-c-a-mid', 'mjs-c-z-leaf'])
        const lu: any = await o.page.evaluate(`(() => {
          const h = document.querySelector('mjs-p-types')._shadow
          const mids = Array.from(h.querySelectorAll('mjs-c-a-mid'))
          return { top: [0, 1, 2, 3, 4].map((i) => h.querySelector('.p' + i).textContent), mid: mids.map((m) => m._shadow.querySelector('.vu').textContent), leaf: mids.map((m) => m._shadow.querySelector('mjs-c-z-leaf')._shadow.querySelector('.vu').textContent), binds: window.__binds.slice() }
        })()`)
        assert.deepEqual(graves(o), [], 'aucune erreur, aucun plantage de composant')
        assert.deepEqual(lu.top, VALEURS_TYPEES, 'le haut garde ses valeurs')
        assert.deepEqual(lu.mid, VALEURS_TYPEES, 'le milieu montre chaque valeur avec son type')
        assert.deepEqual(lu.leaf, VALEURS_TYPEES, 'la feuille montre chaque valeur avec son type')
        assert.deepEqual(lu.binds.filter((b: string) => !VALEURS_TYPEES.some((v) => b.endsWith('.x=' + v))), [], 'rien ne remonte avec une autre valeur ou un autre type que ceux du haut')
      } finally {
        await o.fermer()
      }
    })
  }
})
