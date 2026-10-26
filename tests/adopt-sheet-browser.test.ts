// µ.adoptSheet(el, feuille) dans Chromium, Firefox et WebKit réels : `adoptedStyleSheets` y est vrai, la cascade aussi.
// La feuille collée dans l'ombre fermée d'un composant passe APRÈS les siennes et les surcharge (même sélecteur,
// la dernière gagne), reste quand le composant sort de la page et y revient (ModularJS remet alors à zéro ses
// feuilles), reste à un changement de thème, n'est collée qu'une fois, se retire par la fonction rendue (la dernière
// des fonctions rendues pour la même feuille) ; un texte CSS vaut une CSSStyleSheet ; une balise sans ombre
// (`mjs-light`) ou une feuille que l'ombre refuse ne reçoit rien et ne lève rien ; la balise sans ombre, ou qui n'est pas un
// composant, avertit en console, une seule fois par nom de balise (deux composants légers du même nom : une ligne ; deux noms :
// deux lignes), en français ou en anglais selon la page (en production : le texte court d'abord, puis le texte complet quand
// le fichier des messages de la langue est arrivé), la feuille refusée n'avertit pas.
// WebKit jette une feuille que plus aucun code ne tient : elle doit y survivre à un ramasse-miettes. Appelé dans un hook du
// composant : le retour d'un `µmount` est son nettoyage.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const BOITE = `<script>
@adopt   = (sheet) -> µ.adoptSheet(@, sheet)
@adoptOn = (el, sheet) -> µ.adoptSheet(el, sheet)
@sombre  = -> µtheme = 'dark'
@clair   = -> µtheme = 'light'
</script>
<p class="a">texte</p>
<style>
.a
  color: rgb(1, 2, 3)
</style>
`

const BASE  = 'rgb(1, 2, 3)'
const AUTRE = 'rgb(9, 9, 9)'
const TEXTE = '.a { color: rgb(9, 9, 9) }'

// l'outil appelé DANS un hook du composant (CoffeeScript : la dernière expression d'une fonction est rendue)
const DANS = (hook: string, suite = '') => `<script>
${hook} ->
  µ.adoptSheet(@, '${TEXTE}')
${suite}</script>
<p class="a">texte</p>
<style>
.a
  color: rgb(1, 2, 3)
</style>
`

const SOURCES: Record<string, string> = {
  'carte.mjs': BOITE,
  'leger.mjs': BOITE,
  'monte.mjs': DANS('µmount'),
  'monte-return.mjs': DANS('µmount', '  return\n'),
  'eveil.mjs': DANS('µawake')
}

// le build de développement (le runtime en clair, `µ` lisible) comme celui de production (minifié, un seul module : les noms
// internes sont raccourcis, la marque de conservation de l'outil et sa lecture par le cœur doivent s'accorder)
for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const env of ['dev', 'prod'] as const) {
  describe(`µ.adoptSheet (${nom} réel, build de ${env === 'prod' ? 'production' : 'développement'})`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''
    let prod    = ''
    let sortie  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test de µ.adoptSheet sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('adopt-sheet-browser-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      sortie       = outDir
      mkdirSync(srcDir, { recursive: true })
      for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
      // production au niveau 'warn' : les avertissements vérifiés ici restent dans le code envoyé (le défaut 'error' retire ceux du framework)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(env === 'prod' ? { env: 'prod', js: 'bundle', logLevel: 'warn' } : {}) } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      if (env === 'prod') {
        prod = readFileSync(join(root, 'bundle.js'), 'utf-8')
        assert.equal(prod.includes('_mjs_keep'), false, 'les noms internes sont bien raccourcis dans ce build')
        return
      }
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      // les libellés du manifeste, que le navigateur pose après le cœur : sans eux le message sort toujours en français de secours
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
    })

    after(async () => { await terminateSharedWorkerPool() })

    // ce que la console de la page reçoit pour une balise sans ombre : en développement le texte complet ; en production d'abord le
    // texte court (la clé et ses variables), puis le texte complet quand le fichier des messages de la langue est arrivé
    const sansOmbre = (lang: 'fr' | 'en', tag: string): string[] => {
      const complet = '[ModularJS] ' + String((RUNTIME_LABELS[lang].err as any).adoptSheetNoShadow).replace('{tag}', tag)
      return env === 'prod' ? ['[ModularJS] adoptSheetNoShadow ' + JSON.stringify({ tag }), complet] : [complet]
    }
    // plusieurs balises : en développement un texte complet par balise ; en production tous les textes courts d'abord, puis les
    // textes complets, que le fichier des messages rejoue du texte court le plus long au plus court (les noms vont donc du plus long au plus court)
    const sansOmbres = (lang: 'fr' | 'en', tags: string[]): string[] => {
      const textes = tags.map((tag) => sansOmbre(lang, tag))
      return env === 'prod' ? [...textes.map((t) => t[0]), ...textes.map((t) => t[1])] : textes.map((t) => t[0])
    }

    // `attendus` : exactement les erreurs et avertissements de la console, dans l'ordre (aucun par défaut) ; `lang` : la langue de la page
    async function essai(fn: (page: any) => Promise<void>, corps = '', attendus: string[] = [], lang = '') {
      const playwright = await import('playwright')
      const browser    = await playwright[nom].launch()
      try {
        const page = await browser.newPage()
        const erreurs: string[] = []
        page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        const code = env === 'prod' ? '<script type="module" src="/bundle.js"></script>' : `<script>${script}</script>`
        await page.route('http://t.test/**', (route: any) => {
          const url = route.request().url()
          if (env === 'prod' && url === 'http://t.test/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: prod })
          // le fichier des messages de la langue, que le build de production écrit à côté du code
          const messages = env === 'prod' ? /^http:\/\/t\.test\/out\/(mjs_err-(?:fr|en)-[0-9a-z]+\.json)$/.exec(url) : null
          if (messages) return route.fulfill({ contentType: 'application/json', body: readFileSync(join(sortie, messages[1])) })
          if (url !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html${lang ? ` lang="${lang}"` : ''}><head><meta charset="utf-8"></head><body><mjs-carte></mjs-carte><mjs-leger mjs-light></mjs-leger>${corps}${code}</body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-carte') as any)?._shadow?.querySelector('.a') && !!document.querySelector('mjs-leger')?.querySelector('.a'))
        await page.waitForTimeout(150)
        await fn(page)
        // en production le texte complet arrive avec le fichier des messages : on le laisse venir
        for (let i = 0; i < 60 && erreurs.length < attendus.length; i++) await page.waitForTimeout(50)
        assert.deepEqual(erreurs, attendus, attendus.length ? 'exactement les avertissements attendus en console' : 'aucune erreur ni avertissement en console')
        await page.close()
      } finally {
        await browser.close()
      }
    }

    // la couleur que le navigateur calcule pour le paragraphe du composant
    const couleur = (page: any, tag = 'mjs-carte'): Promise<string> => page.evaluate((t: string) => {
      const hote: any = document.querySelector(t)
      return getComputedStyle((hote._shadow === hote ? hote : hote._shadow).querySelector('.a')).color
    }, tag)
    // la fonction `retire` de chaque appel est gardée dans la page, `window.__retire`, et la feuille collée en dernier, `window.__feuille`
    const colle = (page: any, feuille: 'texte' | 'objet' = 'texte', tag = 'mjs-carte') => page.evaluate(([f, t, css]: [string, string, string]) => {
      const hote: any = document.querySelector(t)
      let arg: any = css
      if (f === 'objet') { arg = new CSSStyleSheet(); arg.replaceSync(css) }
      const w: any = window
      ;(w.__retire ||= []).push(hote.adopt(arg))
      const l = hote._shadow.adoptedStyleSheets
      w.__feuille = l[l.length - 1]
    }, [feuille, tag, TEXTE])
    const nombre = (page: any, tag = 'mjs-carte'): Promise<number> => page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.adoptedStyleSheets.length, tag)
    // sort le composant de la page puis le remet : ModularJS rejoue l'adoption de ses feuilles
    const sortirRemettre = async (page: any, tag = 'mjs-carte') => {
      await page.evaluate((t: string) => { const h = document.querySelector(t) as any; (window as any).__h = h; h.remove() }, tag)
      await page.waitForTimeout(60)
      await page.evaluate(() => document.body.appendChild((window as any).__h))
      await page.waitForTimeout(200)
    }

    it('un texte CSS collé surcharge la feuille du composant (même sélecteur : la dernière gagne)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        assert.equal(await couleur(page), BASE)
        await colle(page)
        assert.equal(await couleur(page), AUTRE)
      })
    })

    it('une CSSStyleSheet collée fait de même', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await colle(page, 'objet')
        assert.equal(await couleur(page), AUTRE)
      })
    })

    it('le témoin : une feuille collée à la main, sans l\'outil, est perdue quand le composant revient dans la page', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await page.evaluate((css: string) => {
          const h: any = document.querySelector('mjs-carte')
          const f = new CSSStyleSheet()
          f.replaceSync(css)
          h._shadow.adoptedStyleSheets = [...h._shadow.adoptedStyleSheets, f]
        }, TEXTE)
        assert.equal(await couleur(page), AUTRE, 'collée à la main : elle agit')
        await sortirRemettre(page)
        assert.equal(await couleur(page), BASE, 'remise à zéro par le framework : c\'est le défaut que l\'outil corrige')
      })
    })

    it('composant retiré de la page puis remis : la feuille collée agit toujours, deux fois de suite', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await colle(page)
        const n = await nombre(page)
        await sortirRemettre(page)
        assert.equal(await couleur(page), AUTRE)
        assert.equal(await nombre(page), n, 'ni perdue ni doublée')
        await sortirRemettre(page)
        assert.equal(await couleur(page), AUTRE)
        assert.equal(await nombre(page), n)
      })
    })

    it('même feuille, même texte : collée une seule fois', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const avant = await nombre(page)
        await colle(page)
        await colle(page)
        assert.equal(await nombre(page), avant + 1, 'le même texte deux fois : une feuille')
        await page.evaluate(() => { const h: any = document.querySelector('mjs-carte'); h.adopt((window as any).__feuille); h.adopt((window as any).__feuille) })
        assert.equal(await nombre(page), avant + 1, 'la même feuille rappelée : toujours une')
        assert.equal(await couleur(page), AUTRE)
      })
    })

    it('la fonction rendue retire la feuille ; elle ne revient pas quand le composant revient dans la page', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const avant = await nombre(page)
        await colle(page)
        assert.equal(await couleur(page), AUTRE)
        await page.evaluate(() => { (window as any).__retire[0](); (window as any).__retire[0]() })
        assert.equal(await couleur(page), BASE, 'le style du composant reprend la main')
        assert.equal(await nombre(page), avant)
        await sortirRemettre(page)
        assert.equal(await couleur(page), BASE)
        assert.equal(await nombre(page), avant)
      })
    })

    it('un changement de thème : la feuille collée agit toujours et reste en dernier', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await colle(page)
        const dernier = () => page.evaluate(() => { const l = (document.querySelector('mjs-carte') as any)._shadow.adoptedStyleSheets; return l[l.length - 1] === (window as any).__feuille })
        for (const [geste, valeur] of [['sombre', 'dark'], ['clair', 'light'], ['sombre', 'dark']]) {
          await page.evaluate((g: string) => (document.querySelector('mjs-carte') as any)[g](), geste)
          await page.waitForFunction((v: string) => document.documentElement.getAttribute('data-mjs-theme') === v, valeur)
          await page.waitForTimeout(100)
          assert.equal(await couleur(page), AUTRE, 'après ' + geste)
          assert.equal(await dernier(), true, 'en dernier après ' + geste)
        }
      })
    })

    it('balise sans ombre (mjs-light) : rien n\'est collé, la fonction rendue ne fait rien, un avertissement la nomme', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const avant = await page.evaluate(() => document.adoptedStyleSheets.length)
        const styles = await page.evaluate(() => document.querySelectorAll('style').length)
        const nature = await page.evaluate((css: string) => {
          const retire = (document.querySelector('mjs-leger') as any).adopt(css)
          const t = typeof retire
          retire()
          return t
        }, TEXTE)
        assert.equal(nature, 'function')
        assert.equal(await page.evaluate(() => document.adoptedStyleSheets.length), avant, 'rien dans les feuilles du document')
        assert.equal(await page.evaluate(() => document.querySelectorAll('style').length), styles, 'aucune balise <style> de plus')
        assert.equal(await couleur(page, 'mjs-leger'), BASE, 'le composant léger garde son style')
      }, '', sansOmbre('fr', 'mjs-leger'))
    })

    it('balise sans ombre (mjs-light), page en anglais : l\'avertissement est en anglais', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await page.evaluate((css: string) => (document.querySelector('mjs-leger') as any).adopt(css), TEXTE)
      }, '', sansOmbre('en', 'mjs-leger'), 'en')
    })

    it('balise sans ombre : une seule fois, même rappelée sur la même balise (texte, CSSStyleSheet, fonction rendue)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await page.evaluate((css: string) => {
          const h: any = document.querySelector('mjs-leger')
          const f = new CSSStyleSheet()
          f.replaceSync(css)
          for (let i = 0; i < 5; i++) h.adopt(css)()
          h.adopt(f)
          h.adopt(css)
        }, TEXTE)
      }, '', sansOmbre('fr', 'mjs-leger'))
    })

    it('balise sans ombre : deux balises du même nom (trois composants légers) ne font qu\'une ligne', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await page.waitForFunction(() => { const l = [...document.querySelectorAll('mjs-leger')]; return l.length === 3 && l.every((h) => !!h.querySelector('.a')) })
        const sansOmbreChacune = await page.evaluate((css: string) => {
          const legers = [...document.querySelectorAll('mjs-leger')] as any[]
          for (let tour = 0; tour < 2; tour++) for (const h of legers) h.adopt(css)
          return legers.map((h) => h._shadow === h)
        }, TEXTE)
        assert.deepEqual(sansOmbreChacune, [true, true, true], 'trois balises du même nom, toutes sans ombre')
      }, '<mjs-leger mjs-light></mjs-leger><mjs-leger mjs-light></mjs-leger>', sansOmbre('fr', 'mjs-leger'))
    })

    it('balise sans ombre : deux noms de balise différents font deux lignes', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await page.evaluate((css: string) => {
          const h: any = document.querySelector('mjs-leger')
          const div    = document.body.appendChild(document.createElement('div'))
          for (const el of [h, div, h, div]) h.adoptOn(el, css)
        }, TEXTE)
      }, '', sansOmbres('fr', ['mjs-leger', 'div']))
    })

    it('balise qui n\'est pas un composant ModularJS : l\'avertissement nomme la balise, une seule fois', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const nature = await page.evaluate((css: string) => {
          const h: any = document.querySelector('mjs-carte')
          const div    = document.body.appendChild(document.createElement('div'))
          const retire = h.adoptOn(div, css)
          h.adoptOn(div, css)
          const t = typeof retire
          retire()
          return t
        }, TEXTE)
        assert.equal(nature, 'function')
      }, '', sansOmbre('fr', 'div'))
    })

    it('le même texte demandé deux fois sur la balise : le premier retrait garde la feuille, le dernier la retire', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const avant = await nombre(page)
        await colle(page)
        await colle(page)
        assert.equal(await nombre(page), avant + 1)
        await page.evaluate(() => (window as any).__retire[0]())
        assert.equal(await couleur(page), AUTRE, 'le deuxième appel tient encore la feuille')
        assert.equal(await nombre(page), avant + 1)
        await sortirRemettre(page)
        assert.equal(await couleur(page), AUTRE, 'et elle survit à la remise')
        await page.evaluate(() => { (window as any).__retire[0](); (window as any).__retire[1]() })
        assert.equal(await couleur(page), BASE, 'le dernier retrait la retire, la première fonction rappelée ne compte pas deux fois')
        assert.equal(await nombre(page), avant)
      })
    })

    it('une feuille non construite (celle d\'un <style> du document, que l\'ombre refuse) : aucune exception, rien de collé, aucune marque sur la feuille', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const r = await page.evaluate(([css]: [string]) => {
          const hote: any = document.querySelector('mjs-carte')
          const style     = document.head.appendChild(document.createElement('style'))
          style.textContent = css
          const feuille: any = style.sheet
          const proprietes   = () => Object.getOwnPropertyNames(feuille).join()
          const avant        = proprietes()
          const nombre       = hote._shadow.adoptedStyleSheets.length
          let retire: any           = null
          let exception: any        = null
          let exceptionRetrait: any = null
          try { retire = hote.adopt(feuille) }
          catch (e) { exception = String(e) }
          try { retire() }
          catch (e) { exceptionRetrait = String(e) }
          return { exception, nature: typeof retire, exceptionRetrait, marquee: proprietes() !== avant, ajoutees: hote._shadow.adoptedStyleSheets.length - nombre }
        }, [TEXTE])
        assert.deepEqual(r, { exception: null, nature: 'function', exceptionRetrait: null, marquee: false, ajoutees: 0 })
        await colle(page)
        assert.equal(await couleur(page), AUTRE, 'l\'outil reste utilisable après le refus')
      })
    })

    // WebKit jette une CSSStyleSheet que plus aucun code ne tient, puis la recrée à la demande SANS les propriétés posées dessus.
    // Une feuille collée par l'outil (un texte CSS, ou une CSSStyleSheet que l'appelant lâche) doit y survivre. Le témoin, une
    // feuille posée à la main sans autre référence, dit quand le ramasse-miettes est passé (il perd alors sa propriété) ;
    // Chromium et Firefox gardent la feuille adoptée : le même scénario s'y joue sans témoin
    it('après un ramasse-miettes : la feuille collée reste, une seule fois, et sa fonction de retrait fonctionne encore', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const r = await page.evaluate(async ([texte, moteur]: [string, string]) => {
          const w: any = window
          const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
          const neuve    = async () => { const n: any = document.createElement('mjs-carte'); document.body.appendChild(n); await attendre(250); return n }
          const A = await neuve(), B = await neuve(), C = await neuve(), D = await neuve()
          A.adopt(texte)                                                                       // A : tout est jeté
          w.__retireB = B.adopt(texte)                                                         // B : seule la fonction de retrait est gardée
          ;(() => { const css = new CSSStyleSheet(); css.replaceSync(texte); C.adopt(css) })()   // C : l'appelant lâche sa CSSStyleSheet
          D.adopt(texte)                                                                       // D : le même texte sera redemandé après
          const sentinelle = document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' })
          ;(() => { const t = new CSSStyleSheet(); t.replaceSync('p{}'); (t as any).temoin = 1; sentinelle.adoptedStyleSheets = [t] })()
          let tourDuRamasse = -1
          for (let tour = 1; tour <= (moteur === 'webkit' ? 60 : 4); tour++) {
            const poubelle: any[] = []
            for (let i = 0; i < 60; i++) poubelle.push(new Array(50000).fill(i), 'x'.repeat(100000) + i, new CSSStyleSheet())
            poubelle.length = 0
            await attendre(30)
            if (!(sentinelle.adoptedStyleSheets[0] as any).temoin) { tourDuRamasse = tour; break }
          }
          const nombre  = (e: any) => e._shadow.adoptedStyleSheets.length
          const couleur = (e: any) => getComputedStyle(e._shadow.querySelector('.a')).color
          const avant   = { A: nombre(A), B: nombre(B), C: nombre(C), D: nombre(D) }
          D.adopt(texte)
          const apresDemande = nombre(D)
          for (const e of [A, B, C, D]) e.remove()
          await attendre(120)
          for (const e of [A, B, C, D]) document.body.appendChild(e)
          await attendre(300)
          const remises     = { A: couleur(A), B: couleur(B), C: couleur(C), D: couleur(D) }
          const nombreApres = { A: nombre(A), B: nombre(B), C: nombre(C), D: nombre(D) }
          w.__retireB()
          return { tourDuRamasse, avant, apresDemande, remises, nombreApres, B: { couleur: couleur(B), nombre: nombre(B) } }
        }, [TEXTE, nom])
        if (nom === 'webkit') assert.ok(r.tourDuRamasse > 0, 'le ramasse-miettes est passé (le témoin a perdu sa propriété) : sans cela le test ne prouve rien')
        assert.equal(r.apresDemande, r.avant.D, 'le même texte redemandé après le ramasse-miettes ne colle pas une deuxième feuille')
        assert.deepEqual(r.remises, { A: AUTRE, B: AUTRE, C: AUTRE, D: AUTRE }, 'les quatre feuilles agissent toujours, après la sortie et la remise')
        assert.deepEqual(r.nombreApres, r.avant, 'ni perdues ni doublées')
        assert.deepEqual(r.B, { couleur: BASE, nombre: r.avant.B - 1 }, 'la fonction de retrait gardée retire la feuille')
      })
    })

    // le piège de µmount : le retour d'un µmount est le nettoyage du composant (cf. le cycle de vie) ; en CoffeeScript la dernière
    // expression d'une fonction est rendue, donc `µmount -> µ.adoptSheet(@, …)` rend la fonction de retrait de la feuille, qui
    // s'exécute à la destruction du composant ; remis plus tard dans la page, le même composant rejoue µmount, qui la recolle
    it('dans le <script> d\'un composant : µawake, ou µmount qui finit par return, gardent la feuille ; µmount qui rend la fonction de retrait la perd à la sortie et la recolle au retour', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const trace: Record<string, Array<string | boolean>> = {}
        for (const tag of ['mjs-monte', 'mjs-monte-return', 'mjs-eveil']) {
          await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.a'), tag)
          const montage = await couleur(page, tag)
          const n       = await nombre(page, tag)
          // retiré et remis dans le même tour : un simple déplacement, rien n'est détruit
          await page.evaluate((t: string) => { const h = document.querySelector(t) as any; h.remove(); document.body.appendChild(h) }, tag)
          await page.waitForTimeout(200)
          const deplace = await couleur(page, tag)
          // sorti de la page : le composant est détruit, ses nettoyages s'exécutent ; hors de la page le navigateur ne calcule
          // aucun style, on compte donc les feuilles de l'ombre
          await page.evaluate((t: string) => { const h = document.querySelector(t) as any; (window as any).__h = h; h.remove() }, tag)
          await page.waitForTimeout(60)
          const dehors = await page.evaluate(() => (window as any).__h._shadow.adoptedStyleSheets.length) === n
          // remis plus tard : le même composant rejoue µmount
          await page.evaluate(() => document.body.appendChild((window as any).__h))
          await page.waitForTimeout(200)
          trace[tag] = [montage, deplace, dehors, await couleur(page, tag), await nombre(page, tag) === n]
        }
        // par balise : couleur au montage, après un déplacement, feuille encore là hors de la page, couleur au retour, ni perdue ni doublée
        assert.deepEqual(trace, {
          'mjs-monte': [AUTRE, AUTRE, false, AUTRE, true],
          'mjs-monte-return': [AUTRE, AUTRE, true, AUTRE, true],
          'mjs-eveil': [AUTRE, AUTRE, true, AUTRE, true]
        })
      }, '<mjs-monte></mjs-monte><mjs-monte-return></mjs-monte-return><mjs-eveil></mjs-eveil>')
    })
  })
}
