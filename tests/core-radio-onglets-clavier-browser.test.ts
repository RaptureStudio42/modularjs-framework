// <@@radio> et <@@tabs> au vrai clavier et à la vraie souris (Chromium et Firefox réels) — ce que le
// banc des modules cœur ne couvre pas : Maj+Tab, un groupe dont le bouton coché est désactivé (le
// groupe n'avait plus aucun arrêt de tabulation, la tabulation le sautait), les touches tenues avec
// Alt, Ctrl ou Méta (Alt+flèche gauche est le « retour » du navigateur), et le bouton de remise à zéro
// d'un formulaire (la sélection revient au bouton de départ, y compris dans ce que le formulaire envoie).

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

const SOURCES: Record<string, string> = {
  'banc.mjs': [
    '<script>',
    '  $a = \'b\'',
    '  $b = \'b\'',
    '  $t = \'b\'',
    '  $d = \'m\'',
    '</script>',
    '<button id="avant-a">avant</button>',
    '<@@radio id="a1" name="ga" value="a" group=!{$a}>A</@@radio>',
    '<@@radio id="a2" name="ga" value="b" group=!{$a}>B</@@radio>',
    '<@@radio id="a3" name="ga" value="c" group=!{$a}>C</@@radio>',
    '<button id="apres-a">après</button>',
    '<button id="avant-b">avant</button>',
    '<@@radio id="b1" name="gb" value="a" group=!{$b}>A</@@radio>',
    '<@@radio id="b2" name="gb" value="b" disabled group=!{$b}>B (coché, désactivé)</@@radio>',
    '<@@radio id="b3" name="gb" value="c" group=!{$b}>C</@@radio>',
    '<button id="apres-b">après</button>',
    '<button id="avant-t">avant</button>',
    '<@@tabs id="tabs" value=!{$t}><span id="ta" value="a">A</span><span id="tb" value="b">B</span><span id="tc" value="c">C</span></@@tabs>',
    '<button id="apres-t">après</button>',
    '<form id="f" @noUJS>',
    '  <@@radio id="d1" name="gd" value="s" group=!{$d}>S</@@radio>',
    '  <@@radio id="d2" name="gd" value="m" group=!{$d}>M</@@radio>',
    '  <@@radio id="d3" name="gd" value="l" group=!{$d}>L</@@radio>',
    '  <button type="reset" id="raz">remettre à zéro</button>',
    '</form>',
    '<p id="val">{$a}|{$b}|{$t}|{$d}</p>',
    ''
  ].join('\n')
}

// la chaîne des éléments actifs, d'ombre en ombre : « mjs-banc > #a2 > input.native »
const ACTIF = `(() => {
  const racine = (el) => el && (el._shadow || el.shadowRoot)
  const chaine = []
  let a = document.activeElement
  while (a) {
    chaine.push(a.id ? '#' + a.id : a.tagName.toLowerCase() + (typeof a.className === 'string' && a.className ? '.' + a.className.split(' ')[0] : ''))
    const r = racine(a)
    a = r && r.activeElement ? r.activeElement : null
  }
  return chaine.join(' > ')
})()`

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`<@@radio> et <@@tabs> au clavier (${nom} réel)`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''
    let browser: any

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test du radio et des onglets au clavier sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('radio-onglets-clavier-' + nom)
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
      script  = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      const lanceur = (await import('playwright'))[nom]
      browser = await lanceur.launch()
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    async function ouvre() {
      const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } })
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push(e.message))
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-banc></mjs-banc><script>${script}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForFunction(() => {
        const sh = (document.querySelector('mjs-banc') as any)?._shadow
        if (!sh) return false
        const radios = [...sh.querySelectorAll('mjs-core-radio')]
        return radios.length === 9 && radios.every((r: any) => r._shadow?.querySelector('input.native')) && !!sh.querySelector('mjs-core-tabs')?._shadow?.querySelector('slot')
      })
      await page.waitForTimeout(400)
      const lit      = () => page.evaluate(ACTIF).then((c: string) => c.replace('mjs-banc > ', ''))
      const focus    = (sel: string) => page.evaluate((s: string) => (document.querySelector('mjs-banc') as any)._shadow.querySelector(s).focus(), sel)
      const focusNat = (id: string) => page.evaluate((i: string) => (document.querySelector('mjs-banc') as any)._shadow.querySelector(i)._shadow.querySelector('input.native').focus(), id)
      const valeurs  = () => page.evaluate(() => (document.querySelector('mjs-banc') as any)._shadow.querySelector('#val').textContent)
      const touche   = async (k: string) => { await page.keyboard.press(k); await page.waitForTimeout(100) }
      const envoye   = () => page.evaluate(() => Object.fromEntries(new FormData((document.querySelector('mjs-banc') as any)._shadow.querySelector('#f')) as any))
      const attend   = (rang: number, valeur: string) => page.waitForFunction(([r, v]: [number, string]) => (document.querySelector('mjs-banc') as any)?._shadow?.querySelector('#val')?.textContent.split('|')[r] === v, [rang, valeur], { timeout: 8000 })
      return { page, erreurs, lit, focus, focusNat, valeurs, touche, envoye, attend }
    }

    it('groupe dont le bouton coché est actif : Tab et Maj+Tab mènent au bouton coché, puis sortent du groupe', async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs, lit, focus, touche } = await ouvre()
      await focus('#avant-a')
      await touche('Tab')
      assert.equal(await lit(), '#a2 > input.native', 'Tab depuis « avant » : le bouton coché')
      await touche('Tab')
      assert.equal(await lit(), '#apres-a', 'Tab suivant : on sort du groupe')
      await touche('Shift+Tab')
      assert.equal(await lit(), '#a2 > input.native', 'Maj+Tab depuis « après » : le bouton coché')
      await touche('Shift+Tab')
      assert.equal(await lit(), '#avant-a', 'Maj+Tab suivant : on sort du groupe')
      assert.deepEqual(erreurs, [])
      await page.close()
    })

    it('bouton coché désactivé : Tab mène au premier bouton libre, puis sort ; Maj+Tab aussi', async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs, lit, focus, touche } = await ouvre()
      await focus('#avant-b')
      await touche('Tab')
      assert.equal(await lit(), '#b1 > input.native', 'Tab depuis « avant » : le premier bouton libre')
      await touche('Tab')
      assert.equal(await lit(), '#apres-b', 'Tab suivant : on sort du groupe')
      await touche('Shift+Tab')
      assert.equal(await lit(), '#b1 > input.native', 'Maj+Tab depuis « après » : le premier bouton libre')
      await touche('Shift+Tab')
      assert.equal(await lit(), '#avant-b', 'Maj+Tab suivant : on sort du groupe')
      assert.deepEqual(erreurs, [])
      await page.close()
    })

    it('radio : Alt, Ctrl ou Méta + flèche ne coche rien ; la flèche seule coche le voisin', async function () {
      if (!present) { this.skip(); return }
      const { page, lit, focusNat, valeurs, touche, attend } = await ouvre()
      await focusNat('#a2')
      for (const k of ['Alt+ArrowRight', 'Alt+ArrowLeft', 'Control+ArrowRight', 'Control+ArrowDown', 'Meta+ArrowLeft', 'Meta+ArrowUp']) {
        await touche(k)
        assert.equal((await valeurs()).split('|')[0], 'b', `${k} : la sélection n'a pas bougé`)
        assert.equal(await lit(), '#a2 > input.native', `${k} : le focus non plus`)
      }
      await touche('ArrowRight')
      await attend(0, 'c')
      assert.equal((await valeurs()).split('|')[0], 'c', 'la flèche seule coche le voisin')
      assert.equal(await lit(), '#a3 > input.native', 'et lui donne le focus')
      await page.close()
    })

    it('onglets : Alt, Ctrl ou Méta + flèche, Début, Fin ne changent pas d\'onglet ; Fin seule mène au dernier', async function () {
      if (!present) { this.skip(); return }
      const { page, focus, valeurs, touche, attend } = await ouvre()
      await focus('#tb')
      for (const k of ['Alt+ArrowLeft', 'Alt+ArrowRight', 'Control+End', 'Control+Home', 'Meta+ArrowRight', 'Alt+Home']) {
        await touche(k)
        assert.equal((await valeurs()).split('|')[2], 'b', `${k} : l'onglet actif n'a pas bougé`)
      }
      await touche('End')
      await attend(2, 'c')
      assert.equal((await valeurs()).split('|')[2], 'c', 'Fin seule mène au dernier onglet')
      await page.close()
    })

    it('bouton de remise à zéro : la sélection et ce que le formulaire envoie reviennent au bouton de départ', async function () {
      if (!present) { this.skip(); return }
      const { page, focusNat, valeurs, touche, envoye, attend } = await ouvre()
      assert.equal((await envoye()).gd, 'm', 'départ : le formulaire envoie le bouton coché')
      await focusNat('#d2')
      await touche('ArrowRight')
      await attend(3, 'l')
      assert.equal((await valeurs()).split('|')[3], 'l', 'le choix de l\'utilisateur')
      assert.equal((await envoye()).gd, 'l')
      const centre = await page.evaluate(() => {
        const r = (document.querySelector('mjs-banc') as any)._shadow.querySelector('#raz').getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })
      await page.mouse.click(centre.x, centre.y)
      await attend(3, 'm')
      assert.equal((await valeurs()).split('|')[3], 'm', 'la variable liée est revenue')
      assert.equal((await envoye()).gd, 'm', 'le formulaire envoie de nouveau le bouton de départ')
      const coches = await page.evaluate(() => ['d1', 'd2', 'd3'].map((id) => (document.querySelector('mjs-banc') as any)._shadow.querySelector('#' + id)._shadow.querySelector('input.native').checked))
      assert.deepEqual(coches, [false, true, false], 'le bouton de départ est recoché')
      await page.close()
    })

    it('remise à zéro annulée par un écouteur (preventDefault) : le choix reste', async function () {
      if (!present) { this.skip(); return }
      const { page, focusNat, valeurs, touche, envoye, attend } = await ouvre()
      await page.evaluate(() => (document.querySelector('mjs-banc') as any)._shadow.querySelector('#f').addEventListener('reset', (e: Event) => e.preventDefault()))
      await focusNat('#d2')
      await touche('ArrowRight')
      await attend(3, 'l')
      const centre = await page.evaluate(() => {
        const r = (document.querySelector('mjs-banc') as any)._shadow.querySelector('#raz').getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })
      await page.mouse.click(centre.x, centre.y)
      await page.waitForTimeout(400)
      assert.equal((await valeurs()).split('|')[3], 'l', 'la variable liée garde le choix')
      assert.equal((await envoye()).gd, 'l', 'le formulaire envoie toujours le choix')
      await page.close()
    })
  })
}
