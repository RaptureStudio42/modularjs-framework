// un effet en direct (*follow, *react, *cursors) dans une vue que la navigation retire, sous une VRAIE View
// Transition (`µ.viewTransition`) : la vue sortante reste à l'écran pendant que la transition se prépare, et la
// route a déjà changé — l'effet ne rejoint pas le salon d'après pour le quitter aussitôt (un faux arrivant chez
// les autres, sa présence, la demande de la dernière position) : il quitte son salon, et c'est tout. Un effet
// qui reste (hors de la vue) change de salon, lui, une fois la vue permutée. Chromium et Firefox ; la
// connexion seule est simulée.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const EFFETS: Record<string, string> = {
  follow:  '<div class="z" *follow><p>a</p></div>\n',
  react:   '<button class="z" *react(emoji: \'x\')>x</button>\n',
  cursors: '<div class="z" *cursors><p>a</p></div>\n'
}
const FICHIERS: Record<string, string> = {}
for (const [e, corps] of Object.entries(EFFETS)) {
  FICHIERS[`fx-vt-${e}-shell.page.mjs`] = `<routes target="app-view">\n/a  fx-vt-${e}-a\n/b  fx-vt-${e}-b\n</routes>\n<@view app-view>\n`
  FICHIERS[`fx-vt-${e}-a.mjs`]          = `<script>\n@sock = µsocket 'wss://x.fr/ws'\n</script>\n${corps}`
  FICHIERS[`fx-vt-${e}-b.mjs`]          = '<p class="b">b</p>\n'
  // l'effet est dans la page : il reste, la vue seule change
  // deux vues différentes derrière /a et /b : la navigation permute vraiment les vues, donc sous une vraie transition
  FICHIERS[`fx-vt-${e}-reste.page.mjs`] = `<script>\n@sock = µsocket 'wss://x.fr/ws'\n</script>\n${corps}<routes target="app-view">\n/a  fx-vt-${e}-v1\n/b  fx-vt-${e}-v2\n</routes>\n<@view app-view>\n`
  FICHIERS[`fx-vt-${e}-v1.mjs`]         = '<p class="v1">v1</p>\n'
  FICHIERS[`fx-vt-${e}-v2.mjs`]         = '<p class="v2">v2</p>\n'
}
const FAUSSE = `(() => {
  window.__j = []; window.__q = []; window.__v = []
  // la vue affichée ('v1', 'v2' ou rien) : les vues vivent dans un shadow root fermé (_shadow)
  window.__aff = () => {
    const cherche = (n, c) => { if (n.querySelector && n.querySelector(c)) return true; for (const e of n.querySelectorAll ? n.querySelectorAll('*') : []) { const r = e.shadowRoot || e._shadow; if (r && cherche(r, c)) return true } return false }
    return cherche(document, '.v2') ? 'v2' : cherche(document, '.v1') ? 'v1' : ''
  }
  const s = { _mjs_refs: 1, state: 'open', opts: {}, _mjs_destroyed: false, send() {}, on() { return () => {} },
    room(n) { __j.push('join ' + n); __v.push(__aff()); return { presence() { __j.push('presence ' + n); return {} }, leave() { __j.push('leave ' + n) } } },
    destroy() {}, request(t, p) { __q.push(t + ' ' + JSON.stringify(p)); return Promise.resolve(null) }, release() {} }
  µ.socket = () => s
  µ._mjs_sockets = { 'wss://x.fr/ws': s }
  µ.error = () => {}
})()`

describe('un effet en direct dans une vue retirée sous une View Transition réelle', function () {
  this.timeout(180000)
  let script = ''
  before(async () => {
    const root   = mjsTmp('effets-en-direct-vue-retiree-transition-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, source] of Object.entries(FICHIERS)) writeFileSync(join(srcDir, n), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })
  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let browser: any
      before(async function () {
        const playwright = await import('playwright')
        if (!existsSync(playwright[nom].executablePath())) { this.skip(); return }
        browser = await playwright[nom].launch()
      })
      after(async () => { await browser?.close() })

      // monte la page sur #/a, vide les journaux, navigue vers #/b ; rend ce qui s'est passé depuis
      const naviguer = async (balise: string, vt: boolean, prep = '', cibles: string[] = ['#/b'], suite = '') => {
        const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
        try {
          await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><script>${script}</script></body></html>`, { waitUntil: 'load' })
          await page.evaluate(FAUSSE)
          await page.evaluate(`location.hash = '#/a'`)
          await page.evaluate((t: string) => { document.body.appendChild(document.createElement(t)) }, balise)
          await page.waitForTimeout(500)
          const avant = await page.evaluate(() => (window as any).__j.slice())
          await page.evaluate(() => { (window as any).__j.length = 0; (window as any).__q.length = 0; (window as any).__v.length = 0 })
          const vtOk = await page.evaluate((vt: boolean) => {
            if (vt) (window as any).µ.viewTransition = 'fade'
            return !vt || (window as any).µ.Router._mjs_vtEnabled()
          }, vt)
          assert.ok(vtOk, 'la View Transition doit être active pour ce test')
          if (prep) await page.evaluate(prep)
          await page.evaluate((c: string[]) => { for (const h of c) (window as any).µ.Router.navigate(h) }, cibles)
          await page.waitForTimeout(1500)
          const apres = await page.evaluate(() => ({ j: (window as any).__j.slice(), q: (window as any).__q.slice(), v: (window as any).__v.slice(), vue: (window as any).__aff() }))
          // ensuite : un événement d'historique seul, sans navigation du routeur
          let plus = null
          if (suite) {
            await page.evaluate(() => { (window as any).__j.length = 0; (window as any).__v.length = 0 })
            await page.evaluate(suite)
            await page.waitForTimeout(700)
            plus = await page.evaluate(() => ({ j: (window as any).__j.slice() }))
          }
          return { avant, apres, plus }
        }
        finally { await page.close() }
      }

      for (const effet of Object.keys(EFFETS)) {
        it(`${effet} dans la vue : la vue sortante quitte son salon et ne rejoint pas le suivant`, async () => {
          const { avant, apres } = await naviguer(`mjs-fx-vt-${effet}-shell`, true)
          assert.ok(avant.length >= 1 && avant[0].startsWith('join '), `l'effet de la vue a doit avoir rejoint son salon : ${JSON.stringify(avant)}`)
          assert.equal(apres.j.length, 1, `un seul mouvement attendu (leave) : ${JSON.stringify(apres.j)}`)
          assert.ok(apres.j[0].startsWith('leave '), `il quitte son salon : ${JSON.stringify(apres.j)}`)
          assert.deepEqual(apres.q, [], 'aucune demande au serveur pour un salon qu\'on ne rejoint pas')
        })

        // transition sautée dès sa création : `activeViewTransition` est déjà vide, la vue sortante reste pourtant
        // en place jusqu'à la permutation
        it(`${effet} dans la vue, transition sautée : même mouvement, pas de faux arrivant`, async () => {
          const prep = `(() => { const o = document.startViewTransition.bind(document); document.startViewTransition = (cb) => { const t = o(cb); t.skipTransition(); return t } })()`
          const { apres } = await naviguer(`mjs-fx-vt-${effet}-shell`, true, prep)
          assert.deepEqual(apres.j.map((x: string) => x.split(' ')[0]), ['leave'], `il quitte son salon, et c'est tout : ${JSON.stringify(apres.j)}`)
          assert.deepEqual(apres.q, [], 'aucune demande au serveur pour un salon qu\'on ne rejoint pas')
        })

        // le rappel de la transition lève : la vue a reste affichée, son effet vit toujours — dans son salon
        it(`${effet} dans la vue, rappel qui lève : l'effet de la vue toujours affichée reste dans son salon`, async () => {
          const prep = `(() => { const o = document.startViewTransition.bind(document); document.startViewTransition = () => { const t = o(() => { throw new Error('rappel') }); t.updateCallbackDone.catch(() => {}); return t } })()`
          const { apres } = await naviguer(`mjs-fx-vt-${effet}-shell`, true, prep)
          const j = apres.j
          const dedans = j.filter((x: string) => x.startsWith('join ')).length - j.filter((x: string) => x.startsWith('leave ')).length
          assert.equal(dedans, 0, `un salon tenu avant, un salon tenu après : ${JSON.stringify(j)}`)
          assert.ok(!j.some((x: string) => x.startsWith('join ') && x.endsWith('#/b')), `ne rejoint pas le salon de b (la vue a est toujours là) : ${JSON.stringify(j)}`)
        })

        // deux navigations enchaînées : la première transition est sautée par la seconde
        it(`${effet} dans la vue, double navigation : l'effet ne reste que dans le salon de la vue affichée`, async () => {
          const { apres } = await naviguer(`mjs-fx-vt-${effet}-shell`, true, '', ['#/b', '#/a'])
          const j = apres.j
          const dedans = j.filter((x: string) => x.startsWith('join ')).length - j.filter((x: string) => x.startsWith('leave ')).length
          assert.equal(dedans, 0, `un salon tenu avant, un salon tenu après : ${JSON.stringify(j)}`)
          assert.ok(!j.some((x: string) => x.startsWith('join ') && x.endsWith('#/b')), `ne rejoint jamais le salon de b : ${JSON.stringify(j)}`)
        })

        const compte = `(() => { window.__vt = 0; const o = document.startViewTransition.bind(document); document.startViewTransition = (cb) => { window.__vt++; return o(cb) } })()`
        it(`${effet} dans la page : l'effet qui reste change de salon une fois la vue permutée`, async () => {
          const { apres } = await naviguer(`mjs-fx-vt-${effet}-reste`, true, compte)
          const j = apres.j
          assert.equal(apres.vue, "v2", "la vue b est affichée " + JSON.stringify(apres.v))
          assert.ok(j[0] && j[0].startsWith('leave '), `quitte le salon de a : ${JSON.stringify(j)}`)
          assert.ok(j.some((x: string) => x.startsWith('join ') && x.endsWith('#/b')), `rejoint le salon de b : ${JSON.stringify(j)}`)
          assert.ok(!j.slice(1).some((x: string) => x.startsWith('leave ')), `et ne le quitte pas : ${JSON.stringify(j)}`)
          // une vraie transition a eu lieu, et l'effet n'a rejoint le salon de b qu'après la permutation des vues
          assert.ok(apres.v.length >= 1 && apres.v.every((t: string) => t === 'v2'), `les vues sont permutées quand l'effet rejoint : ${JSON.stringify(apres.v)}`)
        })

        it(`${effet} dans la page : une vraie View Transition a lieu`, async () => {
          const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
          try {
            await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><script>${script}</script></body></html>`, { waitUntil: 'load' })
            await page.evaluate(FAUSSE)
            await page.evaluate(`location.hash = '#/a'`)
            await page.evaluate((t: string) => { document.body.appendChild(document.createElement(t)) }, `mjs-fx-vt-${effet}-reste`)
            await page.waitForTimeout(500)
            await page.evaluate(`µ.viewTransition = 'fade'`)
            await page.evaluate(compte)
            await page.evaluate(`µ.Router.navigate('#/b')`)
            await page.waitForTimeout(800)
            assert.equal(await page.evaluate(() => (window as any).__vt), 1, 'startViewTransition appelée une fois')
          }
          finally { await page.close() }
        })

        // un rappel rejeté : la transition rejetée ne reste pas en mémoire — un événement d'historique seul
        // (sans navigation du routeur) relie encore l'effet qui reste au salon de l'adresse
        it(`${effet} dans la page, rappel rejeté puis événement d'historique seul : l'effet est relié`, async () => {
          const prep = `(() => { const o = document.startViewTransition.bind(document); document.startViewTransition = () => { const t = o(() => { throw new Error('rappel') }); t.updateCallbackDone.catch(() => {}); return t } })()`
          const suite = `window.dispatchEvent(new Event('hashchange'))`
          const { plus } = await naviguer(`mjs-fx-vt-${effet}-reste`, true, prep, ['#/b'], suite)
          assert.ok(plus && plus.j.some((x: string) => x.startsWith('join ') && x.endsWith('#/b')), `rejoint le salon de b : ${JSON.stringify(plus)}`)
        })

        // la transition d'une navigation précédente, encore en attente, ne retient pas l'effet d'une navigation
        // sans transition
        it(`${effet} dans la page : une transition précédente en attente ne retient pas une navigation sans transition`, async () => {
          const prep = `µ._mjs_vtLast = { updateCallbackDone: new Promise(() => {}) }`
          const { apres } = await naviguer(`mjs-fx-vt-${effet}-reste`, false, prep)
          assert.ok(apres.j.some((x: string) => x.startsWith('join ') && x.endsWith('#/b')), `rejoint le salon de b : ${JSON.stringify(apres.j)}`)
        })
      }
    })
  }
})
