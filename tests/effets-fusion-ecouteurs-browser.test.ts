// *blend : les écouteurs que les balises à filtre partagent (chargement d'une image, redimensionnement, police chargée, retour
// d'onglet, et le chargement de la racine d'un composant) se posent avec la première balise et partent avec la dernière, sans
// doublon à la remise ; et cent événements d'affilée ne coûtent qu'une relecture de la boîte, à l'image suivante. Les
// écouteurs se comptent un par un (pas seulement les observateurs de taille).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const BLEND = '*blend(multiply, color: #ff0000, order: under)'
// une balise qu'un bouton pose et retire
const SOURCE = [
  '<script>',
  '$on = false',
  '</script>',
  `{if $on}<div class="t" ${BLEND}></div>{end}`,
  '<button class="b" @click={$on = !$on}>b</button>',
  '<style>',
  '.t',
  '  width: 40.4px',
  '  height: 30.4px',
  '  background: #b4b4b4',
  '</style>',
  ''
].join('\n')
// compte les écouteurs vivants des quatre événements que *blend écoute, sur n'importe quelle cible
const COMPTE = `(() => {
  const types = ['load', 'resize', 'visibilitychange', 'loadingdone']
  const vivants = []
  const cap = (o) => typeof o === 'object' && o !== null ? !!o.capture : !!o
  const ajoute = EventTarget.prototype.addEventListener
  const retire = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function (type, f, o) {
    if (types.includes(type) && f && !vivants.some((v) => v.t === this && v.type === type && v.f === f && v.c === cap(o))) vivants.push({ t: this, type, f, c: cap(o) })
    return ajoute.call(this, type, f, o)
  }
  EventTarget.prototype.removeEventListener = function (type, f, o) {
    const at = vivants.findIndex((v) => v.t === this && v.type === type && v.f === f && v.c === cap(o))
    if (at >= 0) vivants.splice(at, 1)
    return retire.call(this, type, f, o)
  }
  window.__ecouteurs = () => vivants.length
})()`

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*blend (${nom} réel) — écouteurs partagés des balises à filtre`, function () {
    this.timeout(180000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test des écouteurs de *blend sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-fusion-ecouteurs-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'fb-ecouteurs.mjs'), SOURCE)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    })

    after(async () => { await terminateSharedWorkerPool() })

    async function ouvre(browser: any) {
      const page = await browser.newPage({ viewport: { width: 320, height: 120 } })
      await page.addInitScript(COMPTE)
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-fb-ecouteurs></mjs-fb-ecouteurs><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-fb-ecouteurs') as any)?._shadow?.querySelector('.b'))
      await page.waitForTimeout(500)
      return page
    }
    const bascule = async (page: any, present: boolean) => {
      await page.evaluate(() => (document.querySelector('mjs-fb-ecouteurs') as any)._shadow.querySelector('.b').click())
      await page.waitForFunction((p: boolean) => !!(document.querySelector('mjs-fb-ecouteurs') as any)._shadow.querySelector('.t') === p, present)
      await page.waitForTimeout(500)
    }

    it('les écouteurs se posent avec la balise, partent avec elle, et ne se doublent pas à la remise', async function () {
      if (!present) { this.skip(); return }
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const page = await ouvre(browser)
        const repos = await page.evaluate('window.__ecouteurs()') as number
        await bascule(page, true)
        const pose = await page.evaluate('window.__ecouteurs()') as number
        assert.ok(pose >= repos + 5, `la balise pose ses écouteurs : ${repos} au repos, ${pose} posée (au moins 5 de plus attendus : window load et resize, visibilité, document load, polices, racine du composant)`)
        await bascule(page, false)
        assert.equal(await page.evaluate('window.__ecouteurs()'), repos, 'retirée, la balise ne laisse aucun écouteur (page et racine du composant comprises)')
        await bascule(page, true)
        assert.equal(await page.evaluate('window.__ecouteurs()'), pose, 'reposée, la balise remet les mêmes écouteurs, sans doublon')
        await bascule(page, false)
        assert.equal(await page.evaluate('window.__ecouteurs()'), repos, 'retirée de nouveau, plus aucun écouteur')
      } finally {
        await browser.close()
      }
    })

    it('cent événements d\'affilée ne coûtent qu\'une relecture de la boîte', async function () {
      if (!present) { this.skip(); return }
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const page = await ouvre(browser)
        await bascule(page, true)
        const lectures = await page.evaluate(async () => {
          const el = (document.querySelector('mjs-fb-ecouteurs') as any)._shadow.querySelector('.t')
          // l'effet lit la boîte par le prototype : on compte là, pour la seule balise suivie
          const lire = Element.prototype.getBoundingClientRect
          let n = 0
          Element.prototype.getBoundingClientRect = function () { if (this === el) n++; return lire.call(this) }
          try {
            for (let i = 0; i < 100; i++) window.dispatchEvent(new Event('resize'))
            for (let i = 0; i < 100; i++) document.dispatchEvent(new Event('load'))
            await new Promise((r) => setTimeout(r, 500))
          }
          finally {
            Element.prototype.getBoundingClientRect = lire
          }
          return n
        })
        assert.equal(lectures, 1, `deux cents événements d'affilée : ${lectures} lectures de la boîte au lieu d'une seule, à l'image suivante`)
      } finally {
        await browser.close()
      }
    })
  })
}
