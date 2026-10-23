// Le calque de texte (les lettres, le compteur, le défilé : `µ._mjs_fxLayer`, `µ._mjs_fxSplit` et la feuille des calques) est un outil du cœur
// (runtime/mjs_fx_tooltext.ts) : il ne part qu'avec les effets qui travaillent le texte de leur balise. Une application qui ne pose que `*neon`
// n'en porte pas une ligne, en production, en cœur seul (`runtime: 'core'`) et en développement. Une application qui pose un effet de texte, ou
// un effet choisi par une variable (`*delta(fx: $effet)`), le porte, et ses effets jouent dans Chromium et Firefox réels, dans les deux
// configurations de production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Moteur = 'chromium' | 'firefox'

async function navigateurPresent(nom: Moteur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const FINE = ' '

// une application de cinq effets : les lettres, le compteur, le défilé, le brouillage, et un *delta dont la variable nomme, au clic, un effet écrit nulle part
const TEXTE = `<script>
$n = 1
$fx = 'none'
</script>

<p class="t r" *rainbow>Bonjour le monde</p>
<p class="t c" *count(duration: 800ms, on: load)>12480</p>
<p class="t m" *marquee(speed: 4s)>Un défilé de texte qui passe</p>
<p class="t s" *scramble>Brouillé</p>
<span class="t d" *delta(fx: $fx)>{$n}</span>
<button class="go" @click={$fx = '*scramble'; $n = 12480}>go</button>

<style>
.t
  font: 28px sans-serif
  margin: 6px 20px
.m
  width: 300px
</style>
`

// une application sans effet de texte
const NEON = `<p class="t n" *neon>Bonjour</p>

<style>
.t
  font: 28px sans-serif
  margin: 6px 20px
</style>
`

// des effets réglés une fois dans un fichier `*.effects.mjs` du projet : ils se résolvent à la compilation en l'effet de la bibliothèque qu'ils règlent,
// dont le fichier embarque l'outil du texte (un effet réglé ne pèse que l'effet qu'il règle)
const EFFETS_TEXTE = `<effects>
  *titre = *scramble(on: load)
  *compte = *count(duration: 800ms, on: load)
  *glisse = *marquee(speed: 4s)
</effects>
`
const REGLES_TEXTE = `<p class="t c" *compte>12480</p>
<p class="t s" *titre>Brouillé</p>
<p class="t m" *glisse>Un défilé de texte qui passe</p>

<style>
.t
  font: 28px sans-serif
  margin: 6px 20px
.m
  width: 300px
</style>
`
const EFFETS_NEON = `<effects>
  *lueur = *neon(on: hover)
</effects>
`
const REGLES_NEON = `<p class="t n" *lueur>Bonjour</p>

<style>
.t
  font: 28px sans-serif
  margin: 6px 20px
</style>
`

type Reglage = { nom: string, options: Record<string, unknown> }
const REGLAGES: Reglage[] = [
  { nom: 'production', options: { js: 'bundle', env: 'prod' } },
  { nom: 'cœur seul', options: { js: 'bundle', env: 'prod', runtime: 'core' } }
]

const bundles: Record<string, Promise<string>> = {}
// le code d'une application (un seul fichier : le manifeste, ou tout ce que le build écrit en développement)
function construit(nom: string, source: string, options: Record<string, unknown>, autres: Record<string, string> = {}): Promise<string> {
  const cle = nom + JSON.stringify(options)
  bundles[cle] ||= (async () => {
    const root   = mjsTmp('effets-outil-texte-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'cl-outil.mjs'), source)
    for (const [fichier, contenu] of Object.entries(autres)) writeFileSync(join(srcDir, fichier), contenu)
    const manifeste = join(root, 'bundle.js')
    const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, ...options } as any)
    const stats     = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang     = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const sortie   = [...fichiers].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    return (existsSync(manifeste) ? stripEsm(readFileSync(manifeste, 'utf-8')) + '\n' : '') + sortie
  })()
  return bundles[cle]
}

describe('le calque de texte, outil du cœur : il ne part qu\'avec un effet de texte', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  // la feuille des calques de texte ne s'écrit que dans l'outil (`mjs-fx-over` : le texte d'origine masqué sous le calque)
  for (const { nom, options } of [...REGLAGES, { nom: 'développement', options: {} }]) {
    it(`${nom} : une application à *neon seul ne porte ni le calque ni sa feuille ; une application d'effets de texte les porte`, async () => {
      const neon  = await construit('neon-' + nom, NEON, options)
      const texte = await construit('texte-' + nom, TEXTE, options)
      assert.ok(!neon.includes('mjs-fx-over'), 'la feuille des calques de texte est dans une application sans effet de texte')
      assert.ok(!neon.includes('mjs-fx-word'), 'le découpage en lettres est dans une application sans effet de texte')
      assert.ok(texte.includes('mjs-fx-over'), 'la feuille des calques de texte manque à une application d\'effets de texte')
      assert.ok(texte.includes('mjs-fx-word'), 'le découpage en lettres manque à une application d\'effets de texte')
    })

    it(`${nom} : un effet de texte réglé dans un fichier *.effects.mjs embarque l'outil ; un effet sans texte réglé, non`, async () => {
      const regle = await construit('regle-texte-' + nom, REGLES_TEXTE, options, { 'mes.effects.mjs': EFFETS_TEXTE })
      const neon  = await construit('regle-neon-' + nom, REGLES_NEON, options, { 'mes.effects.mjs': EFFETS_NEON })
      assert.ok(regle.includes('mjs-fx-over'), 'l\'outil du texte manque à une application dont les effets de texte sont réglés dans un fichier d\'effets')
      assert.ok(!neon.includes('mjs-fx-over'), 'l\'outil du texte est dans une application dont le seul effet réglé n\'est pas un effet de texte')
    })
  }
})

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`le calque de texte, outil du cœur : les effets de texte jouent, en production et en cœur seul (${nom} réel)`, function () {
    this.timeout(120000)
    let present = false
    let browser: any = null

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      browser = await (await import('playwright'))[nom].launch()
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    // une page neuve : le composant monté, les erreurs de la page gardées
    async function essai(code: string, fn: (page: any) => Promise<void>) {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 }, reducedMotion: 'no-preference' })
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push('pageerror : ' + e.message))
      page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push('console.error : ' + m.text()) })
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-cl-outil></mjs-cl-outil><script>${code}</script></body></html>` })
      })
      try {
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-cl-outil') as any)?._shadow?.querySelector('.t'))
        await fn(page)
        assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      } finally {
        await page.close()
      }
    }

    // relit `lire` jusqu'à ce que `ok` soit vrai (au plus `ms`) ; rend la dernière lecture dans tous les cas
    async function jusque(lire: () => Promise<any>, ok: (v: any) => boolean, ms = 12000) {
      const fin = Date.now() + ms
      let v     = await lire()
      while (!ok(v) && Date.now() < fin) {
        await new Promise((r) => setTimeout(r, 40))
        v = await lire()
      }
      return v
    }

    for (const { nom: reglage, options } of REGLAGES) {
      it(`${reglage} : *rainbow (les lettres), *count (le compteur), *marquee (le défilé), *scramble, et l'effet qu'une variable nomme au clic`, async function () {
        if (!present) return this.skip()
        const code = await construit('texte-' + reglage, TEXTE, options)
        await essai(code, async (page) => {
          // les lettres : un calque, une lettre par caractère, le texte d'origine masqué dessous
          const lettres = await page.evaluate(() => {
            const sh: any = (document.querySelector('mjs-cl-outil') as any)._shadow
            const r       = sh.querySelector('.r')
            return { calques: r.querySelectorAll('[mjs-fx-layer="text"]').length, lettres: r.querySelectorAll('[mjs-fx-letter]').length, masque: getComputedStyle(r).webkitTextFillColor }
          })
          assert.equal(lettres.calques, 1, 'un calque de lettres')
          assert.equal(lettres.lettres, 14, 'une lettre par caractère de « Bonjour le monde »')
          assert.match(lettres.masque, /^(transparent|rgba\(0, 0, 0, 0\))$/, 'le texte d\'origine est masqué sous le calque')
          // le compteur arrive au nombre écrit
          const compte = await jusque(() => page.evaluate(() => (document.querySelector('mjs-cl-outil') as any)._shadow.querySelector('.c [mjs-fx-layer="text"]')?.textContent), (t: string) => t === `12${FINE}480`)
          assert.equal(compte, `12${FINE}480`, 'le compteur écrit le nombre final')
          // le défilé et le brouillage ont posé leur calque
          const calques = await page.evaluate(() => {
            const sh: any = (document.querySelector('mjs-cl-outil') as any)._shadow
            return { m: sh.querySelectorAll('.m [mjs-fx-layer="text"]').length, s: sh.querySelectorAll('.s [mjs-fx-layer="text"]').length }
          })
          assert.deepEqual(calques, { m: 1, s: 1 }, 'un calque de défilé et un calque de lettres')
          // un effet qu'aucune ligne de l'application n'écrit, nommé par la variable : il joue (son calque se pose dans le nombre de *delta)
          await page.evaluate(() => {
            const sh: any = (document.querySelector('mjs-cl-outil') as any)._shadow
            ;(window as any).__nomme = false
            new MutationObserver((list) => {
              for (const m of list) for (const n of Array.from(m.addedNodes) as any[]) if (n.nodeType === 1 && n.getAttribute('mjs-fx-layer') === 'text' && n.closest('[mjs-fx-delta-val]')) (window as any).__nomme = true
            }).observe(sh, { childList: true, subtree: true })
            sh.querySelector('.go').click()
          })
          const nomme = await jusque(() => page.evaluate(() => (window as any).__nomme), (v: boolean) => v === true)
          assert.equal(nomme, true, 'l\'effet nommé par la variable a posé son calque')
          // le nombre final : écrit dans le nombre de *delta, et montré par le calque de l'effet nommé une fois son brouillage fini
          const fin = await jusque(() => page.evaluate(() => {
            const val: any = (document.querySelector('mjs-cl-outil') as any)._shadow.querySelector('.d [mjs-fx-delta-val]')
            const propre   = Array.from(val.childNodes).filter((n: any) => n.nodeType === 3).map((n: any) => n.nodeValue).join('')
            return { propre, calque: val.querySelector('[mjs-fx-layer="text"]')?.textContent }
          }), (v: any) => v.propre === `12${FINE}480` && v.calque === `12${FINE}480`)
          assert.deepEqual(fin, { propre: `12${FINE}480`, calque: `12${FINE}480` }, 'le nombre final s\'écrit, et le calque de l\'effet nommé le montre')
        })
      })

      it(`${reglage} : des effets de texte réglés dans un fichier *.effects.mjs jouent (compteur, brouillage, défilé)`, async function () {
        if (!present) return this.skip()
        const code = await construit('regle-texte-' + reglage, REGLES_TEXTE, options, { 'mes.effects.mjs': EFFETS_TEXTE })
        await essai(code, async (page) => {
          const compte = await jusque(() => page.evaluate(() => (document.querySelector('mjs-cl-outil') as any)._shadow.querySelector('.c [mjs-fx-layer="text"]')?.textContent), (t: string) => t === `12${FINE}480`)
          assert.equal(compte, `12${FINE}480`, 'le compteur réglé écrit le nombre final')
          const calques = await page.evaluate(() => {
            const sh: any = (document.querySelector('mjs-cl-outil') as any)._shadow
            return { m: sh.querySelectorAll('.m [mjs-fx-layer="text"]').length, s: sh.querySelectorAll('.s [mjs-fx-layer="text"]').length }
          })
          assert.deepEqual(calques, { m: 1, s: 1 }, 'un calque de défilé et un calque de lettres')
        })
      })

      it(`${reglage} : *neon seul joue sans calque de texte`, async function () {
        if (!present) return this.skip()
        const code = await construit('neon-' + reglage, NEON, options)
        await essai(code, async (page) => {
          const vu = await page.evaluate(() => {
            const n: any = (document.querySelector('mjs-cl-outil') as any)._shadow.querySelector('.n')
            return { effet: n.getAttribute('mjs-fx'), calques: n.querySelectorAll('[mjs-fx-layer]').length, texte: n.textContent }
          })
          assert.deepEqual(vu, { effet: 'neon', calques: 0, texte: 'Bonjour' })
        })
      })
    }
  })
}
