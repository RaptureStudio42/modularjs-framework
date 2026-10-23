// *cursors et *follow dans Chromium, Firefox et WebKit réels : le serveur relaie la souris d'une identité nommée `constructor`
// (ou `__proto__`, `prototype`) comme celle des autres, et la présence du salon, un état réactif (µ.state), refuse ce nom. Le
// curseur était dessiné à chaque position reçue, puis retiré par le balayage de la présence, une fois par seconde : il clignotait.
// Une identité absente de la présence n'est plus dessinée ; celle d'un visiteur ordinaire reste à l'écran, sans interruption.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Nom = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Nom): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'fx-hp-curseurs.mjs': '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *cursors><p>Texte</p></div>\n',
  'fx-hp-suivi.mjs':    '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<div class="z" *follow><p>Texte</p></div>\n'
}

// la connexion simulée, posée avant les composants : la présence du salon est un vrai état réactif, qui tient le visiteur `7` et
// refuse `constructor` ; chaque curseur ajouté ou retiré du calque est compté, par nom
const STUB = `(() => {
  const pres = µ.state({})
  pres['7'] = { name: 'Prof' }
  pres['constructor'] = { name: 'Eve' }
  const ec = {}
  const s  = {
    _mjs_refs: 1,
    send() {},
    on(type, f) { (ec[type] = ec[type] || []).push(f); return () => {} },
    room() { return { presence: () => pres, leave() {} } },
    destroy() {}, request() { return Promise.resolve(null) }, release() {},
    recoit(type, p) { (ec[type] = ec[type] || []).forEach((f) => f(p)) }
  }
  window.__s = s
  µ.socket = () => s
  µ._mjs_sockets = { 'wss://x.fr/ws': s }
  window.__vus = { ajouts: {}, retraits: {} }
  const nom = (n) => { const b = n.nodeType === 1 && n.querySelector('[mjs-fx-cursor] b'); return b ? b.textContent : null }
  new MutationObserver((ms) => ms.forEach((m) => {
    m.addedNodes.forEach((n) => { const k = nom(n); if (k) __vus.ajouts[k] = (__vus.ajouts[k] || 0) + 1 })
    m.removedNodes.forEach((n) => { const k = nom(n); if (k) __vus.retraits[k] = (__vus.retraits[k] || 0) + 1 })
  })).observe(document.body, { childList: true, subtree: true })
})()`

describe('*cursors, *follow — une identité absente de la présence n\'est pas dessinée (navigateurs réels)', function () {
  this.timeout(180000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('curseurs-hors-presence-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
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
      let present = false
      let browser: any

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test des curseurs hors présence sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { await browser?.close() })

      // la page, la connexion simulée, le composant ; puis, pendant 2,6 s (deux balayages de la présence), une position toutes les
      // 200 ms de chacun des deux visiteurs
      async function joue(tag: string, type: string) {
        const page              = await browser.newPage({ viewport: { width: 900, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push('pageerror : ' + e.message))
        await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script>${script}</script></body></html>`, { waitUntil: 'load' })
        await page.evaluate(STUB)
        await page.evaluate((t: string) => { document.body.appendChild(document.createElement(t)) }, tag)
        await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.z'), tag)
        await page.waitForTimeout(150)
        await page.evaluate((ty: string) => new Promise<void>((ok) => {
          const w: any = window
          const room   = w.µ._mjs_fxRoomName({})
          let n        = 0
          const iv     = setInterval(() => {
            for (const from of [{ id: '7', name: 'Prof' }, { id: 'constructor', name: 'Eve' }]) w.__s.recoit(ty, { room, p: { a: [0], x: 0.5, y: 0.5 }, t: null, f: null, c: 0, from })
            if (++n < 13) return
            clearInterval(iv)
            setTimeout(ok, 150)
          }, 200)
        }), type)
        const vus = await page.evaluate(() => ({ ...(window as any).__vus, noms: Array.from(document.querySelectorAll('[mjs-fx-cursors-layer] [mjs-fx-cursor] b')).map((b) => b.textContent) }))
        await page.close()
        return { vus, erreurs }
      }

      for (const [effet, tag, type] of [['*cursors', 'mjs-fx-hp-curseurs', 'cursors:move'], ['*follow', 'mjs-fx-hp-suivi', 'follow:cursor']]) {
        it(`${effet} : le curseur de \`constructor\`, refusé par la présence, n'est jamais dessiné ; celui d'un visiteur présent reste à l'écran`, async function () {
          if (!present) { this.skip(); return }
          const { vus, erreurs } = await joue(tag, type)
          assert.deepEqual(erreurs, [])
          assert.equal(vus.ajouts.Eve, undefined, '`constructor` n\'est jamais dessiné (ajouts : ' + vus.ajouts.Eve + ', retraits : ' + vus.retraits.Eve + ')')
          assert.deepEqual(vus.noms, ['Prof'], 'à l\'écran : le visiteur présent seul')
          assert.equal(vus.ajouts.Prof, 1, 'le visiteur présent est dessiné une fois')
          assert.equal(vus.retraits.Prof, undefined, 'le visiteur présent n\'est jamais retiré')
        })
      }
    })
  }
})
