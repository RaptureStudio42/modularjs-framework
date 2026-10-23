// une liste `{for}` retire TOUTES ses lignes quand elle devient nulle, dans Chromium et Firefox réels,
// même quand un effet pose un frère à côté de la balise de la ligne : le reflet de *reflect (une boîte
// -moz-element dans Firefox, une copie quand on demande du flou), la bulle de *guard. Le nettoyage de
// l'effet retire ce frère pendant que la liste détruit ses nœuds : la marche de destruction ne doit pas
// s'y arrêter et laisser affichées les lignes qui suivent (avec, dessous, leurs effets encore actifs).
// Les formes : liste à la racine sans clé, avec clé, sous-liste d'une liste ; et deux marches voisines
// qui doivent rester justes (une ligne retirée, un tableau vide). *reflect sans réglage ne pose rien dans
// Chromium (reflet natif) : ce cas sert de témoin, il ne change pas de forme d'un navigateur à l'autre.

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

const BOUTON = '<button class="t" @click={$l = null}>t</button>'
const GARDE  = 'type="number" min="1" max="10" aria-label="nombre" *guard(delay: 0, duration: 30s)'

const COMPOSANTS: Record<string, string> = {
  'fx-liste-reflet':    `<script>\n$l = [1, 2, 3]\n</script>\n{for r in $l}<p class="row" *reflect>{r}</p>{end}\n${BOUTON}`,
  'fx-liste-flou':      `<script>\n$l = [1, 2, 3]\n</script>\n{for r in $l}<p class="row" *reflect(blur: 2)>{r}</p>{end}\n${BOUTON}`,
  'fx-liste-garde':     `<script>\n$l = [1, 2, 3]\n</script>\n{for r in $l}<input class="row" ${GARDE}>{end}\n${BOUTON}`,
  'fx-liste-cle':       `<script>\n$l = [{id: 1}, {id: 2}, {id: 3}]\n</script>\n{for r in $l by id}<p class="row" *reflect(blur: 2)>{r.id}</p>{end}\n${BOUTON}`,
  'fx-liste-retrait':   `<script>\n$l = [{id: 1}, {id: 2}, {id: 3}]\n</script>\n{for r in $l by id}<p class="row" *reflect(blur: 2)>{r.id}</p>{end}\n${BOUTON}`,
  'fx-liste-imbriquee': `<script>\n$l = [{id: 1, kids: [1, 2]}, {id: 2, kids: [3, 4]}]\n</script>\n{for g in $l by id}<section class="g">{for k in g.kids}<p class="row" *reflect(blur: 2)>{k}</p>{end}</section>{end}\n${BOUTON}`,
}

describe('{for} — une liste qui devient nulle après un effet qui pose un frère (navigateurs réels)', function () {
  this.timeout(120000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('for-liste-nulle-freres-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    // le cœur d'abord, puis le runtime, puis les composants
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let browser: any
      let page: any
      let erreurs: string[]

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
        page    = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage()
        erreurs = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        const balises = Object.keys(COMPOSANTS).map((c) => `<mjs-${c}></mjs-${c}>`).join('')
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${balises}<script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((tags: string[]) => tags.every((t) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.t')), Object.keys(COMPOSANTS).map((c) => 'mjs-' + c))
        await page.evaluate(() => new Promise((r) => setTimeout(r, 300)))
      })

      after(async () => { await browser?.close() })

      // les balises d'un composant (ou de chaque `.g` quand on donne ce sélecteur), en texte : la boîte d'un
      // reflet se lit « calque », la bulle de *guard « bulle »
      const lire = (tag: string, sections = false): Promise<string> => page.evaluate(([tag, sections]: [string, boolean]) => {
        const noms   = (parent: Element) => Array.from(parent.children).map((c: any) => c.getAttribute('mjs-fx-layer') ? 'calque' : c.hasAttribute('mjs-fx-guard-tip') ? 'bulle' : c.localName + '.' + (c.getAttribute('class') ?? '')).join(' ')
        const racine = (document.querySelector(tag) as any)._shadow
        return sections ? Array.from(racine.querySelectorAll('.g')).map((s: any) => '[' + noms(s) + ']').join(' ') : noms(racine)
      }, [tag, sections])

      const actifs  = (tag: string): Promise<number> => page.evaluate((tag: string) => (document.querySelector(tag) as any)._shadow.querySelectorAll('[mjs-fx]').length, tag)
      const cliquer = (tag: string) => page.evaluate((tag: string) => new Promise<void>((fin) => {
        (document.querySelector(tag) as any)._shadow.querySelector('.t').click()
        setTimeout(fin, 400)
      }), tag)
      const poser   = (tag: string, valeur: any) => page.evaluate(([tag, valeur]: [string, any]) => new Promise<void>((fin) => {
        (document.querySelector(tag) as any)._set('l', valeur)
        setTimeout(fin, 400)
      }), [tag, valeur])

      // la boîte du reflet simple : Firefox en pose une (-moz-element), Chromium aucune (reflet natif)
      const reflet = nom === 'firefox' ? 'p.row calque' : 'p.row'
      const flou   = 'p.row calque'

      it('*reflect sans réglage : liste nulle, il ne reste que le bouton ; rouverte, chaque ligne revient une seule fois', async () => {
        const plein = [reflet, reflet, reflet].join(' ') + ' button.t'
        assert.equal(await lire('mjs-fx-liste-reflet'), plein, 'au départ')
        await cliquer('mjs-fx-liste-reflet')
        assert.equal(await lire('mjs-fx-liste-reflet'), 'button.t', 'liste nulle : plus aucune ligne')
        assert.equal(await actifs('mjs-fx-liste-reflet'), 0, 'plus aucun effet actif')
        await poser('mjs-fx-liste-reflet', [1, 2, 3])
        assert.equal(await lire('mjs-fx-liste-reflet'), plein, 'rouverte : une seule fois')
      })

      it('*reflect(blur: 2) : la copie du reflet est un frère, liste nulle il ne reste que le bouton', async () => {
        const plein = [flou, flou, flou].join(' ') + ' button.t'
        assert.equal(await lire('mjs-fx-liste-flou'), plein, 'au départ')
        await cliquer('mjs-fx-liste-flou')
        assert.equal(await lire('mjs-fx-liste-flou'), 'button.t', 'liste nulle : plus aucune ligne, plus aucune copie')
        assert.equal(await actifs('mjs-fx-liste-flou'), 0, 'plus aucun effet actif')
        await poser('mjs-fx-liste-flou', [1, 2, 3])
        assert.equal(await lire('mjs-fx-liste-flou'), plein, 'rouverte : une seule fois')
      })

      it('*guard : la bulle du refus est un frère, liste nulle il ne reste que le bouton', async () => {
        await page.evaluate(() => {
          for (const g of (document.querySelector('mjs-fx-liste-garde') as any)._shadow.querySelectorAll('.row')) {
            g.value = '99'
            g.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
          }
        })
        const plein = 'input.row bulle input.row bulle input.row bulle button.t'
        assert.equal(await lire('mjs-fx-liste-garde'), plein, 'trois valeurs refusées : une bulle posée à côté de chaque champ')
        await cliquer('mjs-fx-liste-garde')
        assert.equal(await lire('mjs-fx-liste-garde'), 'button.t', 'liste nulle : plus aucune ligne, bulles comprises')
        assert.equal(await actifs('mjs-fx-liste-garde'), 0, 'plus aucun effet actif')
      })

      it('avec clé, *reflect(blur: 2) : liste nulle, il ne reste que le bouton ; rouverte, une seule fois', async () => {
        const plein = [flou, flou, flou].join(' ') + ' button.t'
        assert.equal(await lire('mjs-fx-liste-cle'), plein, 'au départ')
        await cliquer('mjs-fx-liste-cle')
        assert.equal(await lire('mjs-fx-liste-cle'), 'button.t', 'liste nulle : plus aucune ligne, plus aucune copie')
        assert.equal(await actifs('mjs-fx-liste-cle'), 0, 'plus aucun effet actif')
        await poser('mjs-fx-liste-cle', [{ id: 1 }, { id: 2 }, { id: 3 }])
        assert.equal(await lire('mjs-fx-liste-cle'), plein, 'rouverte : une seule fois')
      })

      it('avec clé : une ligne retirée emporte sa copie, un tableau vide emporte le reste', async () => {
        await poser('mjs-fx-liste-retrait', [{ id: 1 }, { id: 3 }])
        assert.equal(await lire('mjs-fx-liste-retrait'), [flou, flou].join(' ') + ' button.t', 'la ligne du milieu est partie avec sa copie')
        assert.equal(await actifs('mjs-fx-liste-retrait'), 2, 'un effet par ligne restante')
        await poser('mjs-fx-liste-retrait', [])
        assert.equal(await lire('mjs-fx-liste-retrait'), 'button.t', 'tableau vide : plus aucune ligne, plus aucune copie')
        assert.equal(await actifs('mjs-fx-liste-retrait'), 0, 'plus aucun effet actif')
      })

      it('{for} imbriqué : la sous-liste devient nulle, chaque section se vide ; rouverte, une seule fois', async () => {
        const plein = '[' + flou + ' ' + flou + '] [' + flou + ' ' + flou + ']'
        assert.equal(await lire('mjs-fx-liste-imbriquee', true), plein, 'au départ : deux sections de deux lignes')
        await poser('mjs-fx-liste-imbriquee', [{ id: 1, kids: null }, { id: 2, kids: null }])
        assert.equal(await lire('mjs-fx-liste-imbriquee', true), '[] []', 'sous-listes nulles : les deux sections sont vides')
        assert.equal(await actifs('mjs-fx-liste-imbriquee'), 0, 'plus aucun effet actif')
        await poser('mjs-fx-liste-imbriquee', [{ id: 1, kids: [1, 2] }, { id: 2, kids: [3, 4] }])
        assert.equal(await lire('mjs-fx-liste-imbriquee', true), plein, 'rouvertes : une seule fois')
      })

      it('aucune erreur de page', () => {
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
