// `<@element>` seul, `<@module>` seul et les deux ensemble, en production (un seul fichier et fichiers séparés) : l'appli ne porte que la
// partie de mjs_dynamic.ts dont elle se sert, et la balise, le composant, les attributs et l'étalement suivent comme avant. Témoin
// d'absence : `_updDynEl` et `_updModule`, aides que le compilateur appelle, ne sont jamais raccourcies par le minifieur (CORE_HELPER_NAMES),
// leur nom se lit donc tel quel dans les fichiers de production. Navigateurs réels (Chromium, Firefox, WebKit)

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'
import { construire, charger, graves, type Cible } from './helpers/liaison-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const BALISE  = 'mjs-dyn-app'
const ENFANTS = {
  'dyn-ca.mjs': '<script>\n$n = 0\n</script>\n<p class="v">A{$n}</p>\n',
  'dyn-cb.mjs': '<script>\n$n = 0\n</script>\n<p class="v">B{$n}</p>\n'
}
const ELEMENT = { vars: '$tag = \'section\'\n$t   = \'a\'\n$x   = {\'data-k\': \'k1\'}\n', gabarit: '<@element $tag data-t="el" title={$t} {...$x}>texte</@element>\n<button class="tag" @click={$tag = \'article\'}>g</button>\n<button class="titre" @click={$t = \'b\'}>t</button>\n<button class="vider-el" @click={$x = {}}>v</button>\n' }
const MODULE  = { vars: '$comp = \'dyn-ca\'\n$n    = 1\n$y    = {\'data-k\': \'m1\'}\n', gabarit: '<@module $comp data-t="mod" n={$n} {...$y}></@module>\n<button class="comp" @click={$comp = \'dyn-cb\'}>c</button>\n<button class="plus" @click={$n++}>p</button>\n<button class="vider-mod" @click={$y = {}}>v</button>\n' }

const appli = (parts: typeof ELEMENT[]) => ({ 'dyn-app.mjs': `<script>\n${parts.map((p) => p.vars).join('')}</script>\n${parts.map((p) => p.gabarit).join('')}`, ...ENFANTS })

// chaque appli : ses sources, les aides qu'elle porte et celles qu'elle ne porte pas
const APPLIS = {
  'élément seul': { sources: appli([ELEMENT]), el: true, mod: false },
  'module seul':  { sources: appli([MODULE]), el: false, mod: true },
  'les deux':     { sources: appli([ELEMENT, MODULE]), el: true, mod: true }
}
const MODES = ['bundle', 'split'] as const

// la balise `[data-t="el"]` (nom, `title`, `data-k`) et le composant `[data-t="mod"]` (nom, `data-k`, texte de son ombre), « - » pour un attribut absent
const lire = `(() => {
  const h  = document.querySelector('${BALISE}')
  const sh = h && (h._shadow || h.shadowRoot)
  if (!sh) return null
  const e = sh.querySelector('[data-t="el"]'), m = sh.querySelector('[data-t="mod"]')
  const o = m && (m._shadow || m.shadowRoot), v = o && o.querySelector('.v')
  return (e ? e.localName + ' ' + (e.getAttribute('title') ?? '-') + ' ' + (e.getAttribute('data-k') ?? '-') : '') + ' | ' + (m ? m.localName + ' ' + (m.getAttribute('data-k') ?? '-') + ' ' + (v ? v.textContent : '?') : '')
})()`

// les étapes d'une appli : le changement de balise et d'attribut, de composant et de prop, puis l'étalement vidé
const etapes = (el: boolean, mod: boolean) => {
  const vu = (e: string, m: string) => (el ? e : '') + ' | ' + (mod ? m : '')
  const l  = [{ clic: '', attendu: vu('section a k1', 'mjs-dyn-ca m1 A1') }]
  if (el) l.push({ clic: '.tag', attendu: vu('article a k1', 'mjs-dyn-ca m1 A1') }, { clic: '.titre', attendu: vu('article b k1', 'mjs-dyn-ca m1 A1') })
  if (mod) l.push({ clic: '.comp', attendu: vu('article b k1', 'mjs-dyn-cb m1 B1') }, { clic: '.plus', attendu: vu('article b k1', 'mjs-dyn-cb m1 B2') })
  if (el) l.push({ clic: '.vider-el', attendu: vu('article b -', 'mjs-dyn-cb m1 B2') })
  if (mod) l.push({ clic: '.vider-mod', attendu: vu('article b -', 'mjs-dyn-cb - B2') })
  return l
}

// tout le JavaScript de production de l'appli
const codeDe = (cible: Cible) => {
  const out = join(cible.racine, 'out')
  return (readdirSync(out, { recursive: true }) as string[]).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(out, f), 'utf-8')).join('\n')
}

describe('<@element> et <@module> en production : chaque appli ne porte que sa partie de mjs_dynamic.ts, comportement inchangé, navigateurs réels', function () {
  this.timeout(240000)
  const cibles: Record<string, Cible> = {}

  before(async function () {
    this.timeout(300000)
    for (const [nom, a] of Object.entries(APPLIS)) {
      for (const mode of MODES) cibles[nom + ' ' + mode] = await construire(mode, a.sources, [BALISE])
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, a] of Object.entries(APPLIS)) {
    for (const mode of MODES) {
      it(`${nom}, ${mode} : la partie de l'autre balise est absente des fichiers de production`, () => {
        const code = codeDe(cibles[nom + ' ' + mode])
        assert.equal(/_updDynEl/.test(code), a.el, a.el ? 'la partie élément manque' : 'la partie élément est portée par une appli sans <@element>')
        assert.equal(/_updModule/.test(code), a.mod, a.mod ? 'la partie de <@module> manque' : 'la partie de <@module> est portée par une appli sans <@module>')
      })
    }
  }

  for (const moteur of MOTEURS) {
    describe(moteur, function () {
      let browser: any = null

      before(async function () {
        if (!(await moteurPresent(moteur))) {
          console.log(`  ℹ️  ${moteur} non installé, tests sautés. Activer : \`npx playwright install ${moteur}\``)
          this.skip()
        }
        const playwright: any = await import('playwright')
        browser = await playwright[moteur].launch()
      })

      after(async () => { if (browser) await browser.close() })

      for (const [nom, a] of Object.entries(APPLIS)) {
        for (const mode of MODES) {
          it(`${nom}, ${mode} : balise, composant, attributs et étalement suivent`, async function () {
            const o = await charger(browser, cibles[nom + ' ' + mode], BALISE)
            try {
              for (const etape of etapes(a.el, a.mod)) {
                if (etape.clic) await o.page.evaluate(`document.querySelector('${BALISE}')._shadow.querySelector('${etape.clic}').click()`)
                await o.page.waitForFunction(`${lire} === ${JSON.stringify(etape.attendu)}`, null, { timeout: 5000 }).catch(() => {})
                assert.equal(await o.page.evaluate(lire), etape.attendu, `${etape.clic ? 'après le clic ' + etape.clic : 'premier rendu'} ; la page dit : ${[...o.erreurs, ...o.avis].join(' / ')}`)
              }
              assert.deepEqual(graves(o), [])
            }
            finally {
              await o.fermer()
            }
          })
        }
      }
    })
  }
})
