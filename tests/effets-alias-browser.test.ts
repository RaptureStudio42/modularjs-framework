// Alias d'effets dans Chromium, Firefox et WebKit réels : une appli qui pose ses alias (chacun six fois, le seuil à partir duquel
// il est écrit une seule fois dans une table) se comporte comme la même appli qui écrit les réglages en clair — mêmes
// réglages reçus par l'effet, même état de la balise, même style calculé, même texte une fois le brouillage fini.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const PIXEL = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#c33"/></svg>')

const EFFETS = [
  '<effects>',
  '  *titre = *scramble(311, on: load)',
  '  *verre = *filter(none, blur: 6, spot: 240, soft: 100)',
  '  *filter.net = *filter(sepia, amount: 0.5)',
  '  *fade.lent = *fade(duration: 3s)',
  '</effects>'
].join('\n')

// chaque alias est posé six fois : c'est le seuil à partir duquel les réglages ne sont écrits qu'une fois, dans la table du cœur
const rang    = (prefixe: string) => Array.from({ length: 6 }, (_, i) => prefixe + (i + 1))
const TITRES  = rang('t')
const VERRES  = rang('i')
const NETS    = rang('n')
const ENTREES = rang('f')
const TEXTES  = ['ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQR']
const POSEES  = [...TITRES, ...VERRES, ...NETS]

// la même page, deux fois : par alias, puis en clair (le deuxième titre change la vitesse, le deuxième verre le flou)
const AVEC = [
  ...TITRES.map((c, i) => `<p class="${c}" *titre${i === 1 ? '(speed: 20)' : ''}>${TEXTES[i]}</p>`),
  ...VERRES.map((c, i) => `<img class="${c}" src="${PIXEL}" alt="" *verre${i === 1 ? '(blur: 9)' : ''}>`),
  ...NETS.map((c) => `<img class="${c}" src="${PIXEL}" alt="" *filter.net>`),
  ...ENTREES.map((c) => `<p class="${c}" @in=*fade.lent(duration: 3s)>GHI</p>`)
].join('\n')
const SANS = [
  ...TITRES.map((c, i) => `<p class="${c}" *scramble(${i === 1 ? 20 : 311}, on: load)>${TEXTES[i]}</p>`),
  ...VERRES.map((c, i) => `<img class="${c}" src="${PIXEL}" alt="" *filter(none, blur: ${i === 1 ? 9 : 6}, spot: 240, soft: 100)>`),
  ...NETS.map((c) => `<img class="${c}" src="${PIXEL}" alt="" *filter(sepia, amount: 0.5)>`),
  ...ENTREES.map((c) => `<p class="${c}" @in=*fade(duration: 3s)>GHI</p>`)
].join('\n')

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
describe(`alias d'effets (${nom} réel)`, function () {
  this.timeout(120000)
  let present = false
  let script  = ''

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) {
      console.log(`  ℹ️  ${nom} non installé, test des alias sauté. Activer : \`npx playwright install ${nom}\``)
      return
    }
    const root   = mjsTmp('effets-alias-browser-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'app.effects.mjs'), EFFETS)
    writeFileSync(join(srcDir, 'fb-al-avec.mjs'), AVEC + '\n')
    writeFileSync(join(srcDir, 'fb-al-sans.mjs'), SANS + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    // la table existe bien, et chacune des vingt-quatre poses y renvoie (sans elle ce test ne dirait rien des alias renvoyés)
    assert.match(script, /_mjs_alias\s*=/)
    const composant = files.filter((f) => f.startsWith('fb-al-avec-')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
    assert.equal((composant.match(/_mjs_alias\(/g) ?? []).length, 24, 'chaque pose renvoie à la table')
  })

  after(async () => { await terminateSharedWorkerPool() })

  // ce que la page fait de chaque balise : réglages reçus par l'effet, marque posée, style calculé, texte
  async function relever(browser: any, tag: string) {
    const page    = await browser.newPage({ viewport: { width: 500, height: 500 } })
    const erreurs: string[] = []
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() === 'http://t.test/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    // posé : les dix-huit balises à effet portent leur marque
    await page.waitForFunction(([t, classes]: [string, string[]]) => {
      const r = (document.querySelector(t) as any)?._shadow
      if (!r) return false
      const ok = classes.every((c) => r.querySelector('.' + c)?.hasAttribute('mjs-fx'))
      return ok
    }, [tag, POSEES], { timeout: 30000 }).catch(async (err: any) => {
      const vu = await page.evaluate((t: string) => { const r = (document.querySelector(t) as any)?._shadow; return r ? r.innerHTML.slice(0, 1500) : 'pas de shadow' }, tag)
      throw new Error(err.message + '\n' + vu + '\n' + erreurs.join('\n'))
    })
    const etat = await page.evaluate(([t, classes, entrees]: [string, string[], string[]]) => {
      const r = (document.querySelector(t) as any)._shadow
      const out: Record<string, unknown> = {}
      for (const c of classes) {
        const el  = r.querySelector('.' + c)
        const nom = el.getAttribute('mjs-fx')
        out[c] = { fx: nom, reglages: { ...el._mjs_fxOff[nom]._s }, texte: c[0] === 't' ? el.firstChild.nodeValue : null, filtre: c[0] === 'i' || c[0] === 'n' ? getComputedStyle(el).filter : null }
      }
      // des transitions posées par un alias pointé (`@in=*fade.lent`) : la balise ne reçoit aucun attribut en trop, la transition est posée
      for (const c of entrees) {
        const el = r.querySelector('.' + c)
        out[c] = { attributs: el.getAttributeNames().filter((a: string) => a !== 'style'), intro: typeof el._mjs_intro }
      }
      return out
    }, [tag, POSEES, ENTREES] as [string, string[], string[]])
    await page.close()
    return { etat, erreurs }
  }

  it('par alias (table) ou en clair : les mêmes réglages, le même état, le même style, aucune erreur', async function () {
    if (!present) return this.skip()
    const playwright = await import('playwright')
    const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-sandbox'] } : {})
    try {
      const avec = await relever(browser, 'mjs-fb-al-avec')
      const sans = await relever(browser, 'mjs-fb-al-sans')
      assert.deepEqual(avec.erreurs, [])
      assert.deepEqual(sans.erreurs, [])
      assert.deepEqual(avec.etat, sans.etat)
      const e: any = avec.etat
      assert.equal(e.t1.fx, 'scramble')
      assert.equal(e.t1.reglages.speed, 311)
      assert.equal(e.t2.reglages.speed, 20)
      assert.equal(e.i2.reglages.blur, 9)
      assert.equal(e.i2.reglages.spot, 240)
      assert.notEqual(e.i1.filtre, 'none')
      for (const c of ENTREES) {
        assert.deepEqual(e[c].attributs, ['class'], '@in=*fade.lent(…) : aucun attribut parasite')
        assert.equal(e[c].intro, 'function', 'la transition d\'entrée est posée')
      }
    }
    finally {
      await browser.close()
    }
  })
})
}
