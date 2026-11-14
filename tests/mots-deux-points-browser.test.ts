// Les mots de MJS en `:mot` en navigateur réel : classe et style basculés, HTML lié, propriété calculée, composant sans Shadow DOM
// (`:lightDom`), composant réveillé à la vue et place réservée (`:wake`, `:size`), liste réordonnée (`:flip`) à côté de l'effet du même nom, et deux
// événements à soi nommés comme des mots (`@reorder`, `@dom`) écoutés par `@` — le même résultat en développement, en production et au rendu
// du serveur, dans Chromium, Firefox et WebKit
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'c-child.mjs': '<p class="t">enfant</p>\n<button class="go" @click.emit.reorder={ n: 1 }>r</button>\n<button class="go2" @click.emit.dom={ n: 2 }>d</button>\n',
  'p-home.mjs':  [
    '<script>',
    "$on = true",
    "$c = 'rgb(255, 0, 0)'",
    "$h = '<b>gras</b>'",
    '$off = true',
    "$r = ''",
    "$d = ''",
    '$l = [{ id: 1 }, { id: 2 }]',
    '</script>',
    '<p class="k" :class{$on}="vif" :style.color={$c}>k</p>',
    '<p class="h" contenteditable="true" :html=!{$h}></p>',
    '<input class="i" aria-label="i" :disabled={$off}>',
    '<mjs-c-child class="l" :lightDom></mjs-c-child>',
    '<mjs-c-child class="w" :wake=view :size="320x48"></mjs-c-child>',
    "<mjs-c-child class=\"e\" @reorder={ $r = 'r' } @dom={ $d = 'd' }></mjs-c-child>",
    '<ul class="fl" :flip>{for t in $l by id}<li>{ t.id }</li>{end}</ul>',
    '<span class="fx" *flip(direction: up)>fx</span>',
    '<p class="v">{ $r }{ $d }</p>',
  ].join('\n') + '\n',
}

const RACINE = `document.querySelector('mjs-p-home')?._shadow`
const PRET   = `!!${RACINE}?.querySelector('.e')?._shadow?.querySelector('.go2')`
const CLIQUER = `(() => { const e = ${RACINE}.querySelector('.e')._shadow; e.querySelector('.go').click(); e.querySelector('.go2').click() })()`
const LIRE   = `(() => {
  const r = ${RACINE}
  const q = (s) => r.querySelector(s)
  const k = q('.k'), w = q('.w')
  return JSON.stringify({ vif: k.classList.contains('vif'), couleur: k.style.color, html: q('.h').innerHTML, inactif: q('.i').disabled, leger: !!q('.l').querySelector('.t'), wake: !!w._shadow?.querySelector('.t'), size: w.getAttribute('mjs-size'), flip: q('.fl').getAttribute('mjs-flip'), v: q('.v').textContent })
})()`
const ATTENDU = JSON.stringify({ vif: true, couleur: 'rgb(255, 0, 0)', html: '<b>gras</b>', inactif: true, leger: true, wake: true, size: '320x48', flip: '200', v: 'rd' })

describe('mots de MJS en `:mot` en navigateur', function () {
  this.timeout(180000)
  const cibles: Partial<Record<Mode, Cible>> = {}

  before(async () => {
    for (const mode of ['dev-parents-avant', 'bundle', 'ssr'] as Mode[]) cibles[mode] = await construire(mode, SOURCES, ['mjs-p-home'])
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('rendu du serveur : :lightDom, :wake et :size sur la balise', () => {
    const html = cibles.ssr!.document('mjs-p-home', 'markers')
    for (const attendu of ['mjs-light', 'mjs-wake', 'mjs-size']) assert.ok(html.includes(attendu), `${attendu} dans le rendu du serveur`)
  })

  for (const nom of ['chromium', 'firefox', 'webkit']) it(`${nom} : développement, production, rendu du serveur`, async function () {
    const playwright: any = await import('playwright')
    const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    const ecarts: string[] = []
    try {
      for (const [mode, variante] of [['dev-parents-avant', ''], ['bundle', ''], ['ssr', 'markers']] as [Mode, string][]) {
        const o = await charger(browser, cibles[mode]!, 'mjs-p-home', variante)
        try {
          await o.page.waitForFunction(PRET, null, { timeout: 15000 }).catch(() => undefined)
          await o.page.evaluate(CLIQUER).catch(() => undefined)
          await o.page.waitForFunction(`${RACINE}?.querySelector('.v')?.textContent === 'rd'`, null, { timeout: 5000 }).catch(() => undefined)
          const vu = await o.page.evaluate(LIRE).catch((e: any) => String(e?.message ?? e))
          if (vu !== ATTENDU || o.erreurs.length) ecarts.push(`${mode} ${vu} ${o.erreurs.join(' | ')}`)
        }
        finally {
          await o.fermer()
        }
      }
    }
    finally {
      await browser.close()
    }
    assert.deepEqual(ecarts, [])
  })
})
