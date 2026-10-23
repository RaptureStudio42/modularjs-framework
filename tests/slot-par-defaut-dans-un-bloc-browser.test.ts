// Un `<@slot>` par défaut écrit DANS un bloc ({if}/{else}) : les enfants projetés doivent atterrir
// dedans et s'afficher. Défaut garanti absent : au constructeur, le bloc n'est pas encore rendu,
// le shadow ne montre donc aucun slot par défaut — le rangement des slots indexés concluait alors
// « pas de slot par défaut » et posait `slot="0"` sur chaque enfant, qui ne correspondait plus à
// rien une fois le bloc rendu : contenu invisible, sans erreur. Le rangement indexé (`slot="N"`,
// `{for}` de `<@slot {i}/>`) doit, lui, continuer de marcher.
// Chromium et pas happy-dom : seul un vrai navigateur construit l'élément avec ses enfants déjà en
// place (page chargée avant le script, ou contenu cloné par un composant parent), le cas du défaut.
// Chromium absent → test sauté proprement, comme les autres tests navigateur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'carte.mjs': '<script>\n$ouvert = true\n</script>\n{if $ouvert}<div class="a"><@slot/></div>{else}<div class="b"><@slot/></div>{end}\n<button class="t" @click={$ouvert = !$ouvert}>t</button>\n',
  'volet.mjs': '<script>\n$ouvert = false\n</script>\n{if $ouvert}<div class="a"><@slot/></div>{end}\n<button class="t" @click={$ouvert = true}>t</button>\n',
  'page.mjs': '<@carte><p class="c">cloné</p></@carte>\n',
  'onglets.mjs': '<script>\n$tabs = [\'a\', \'b\']\n</script>\n<div class="grille">{for i, t in $tabs}<div class="case"><@slot {i}/></div>{end}</div>\n'
}

describe('slot par défaut dans un bloc {if}/{else} (Chromium réel) — les enfants projetés s\'affichent', function () {
  this.timeout(60000)
  let present = false
  let script  = ''

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test des slots dans un bloc sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('slot-defaut-bloc')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
    script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('{if}/{else}, {if} fermé puis ouvert, contenu cloné par un parent : l\'enfant sans attribut atterrit dans le slot par défaut ; les slots indexés restent rangés', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const corps = '<mjs-carte><p class="c">carte</p></mjs-carte><mjs-volet><p class="c">volet</p></mjs-volet><mjs-page></mjs-page><mjs-onglets><p class="o">un</p><p class="o">deux</p></mjs-onglets>'
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${corps}<script>${script}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForTimeout(200)
      const lire = () => page.evaluate(() => {
        const etat = (hote: any) => {
          const p: any    = hote.querySelector('.c')
          const slot: any = hote._shadow.querySelector('slot:not([name])')
          return { attribut: p.getAttribute('slot'), range: slot ? slot.assignedElements().includes(p) : false, hauteur: p.getBoundingClientRect().height > 0 }
        }
        const pageMjs: any = document.querySelector('mjs-page')
        const onglets: any = document.querySelector('mjs-onglets')
        const slot1: any   = onglets._shadow.querySelector('slot[name="1"]')
        return {
          erreurs: document.querySelectorAll('.mjs-error').length,
          carte:   etat(document.querySelector('mjs-carte')),
          volet:   etat(document.querySelector('mjs-volet')),
          clone:   etat(pageMjs._shadow.querySelector('mjs-carte')),
          indexes: Array.from(onglets.querySelectorAll('.o')).map((o: any) => o.getAttribute('slot')),
          slot1:   slot1 ? slot1.assignedElements().map((e: any) => e.textContent) : null
        }
      })
      const avant = await lire()
      assert.equal(avant.erreurs, 0, 'aucun composant en erreur')
      assert.deepEqual(avant.carte, { attribut: null, range: true, hauteur: true }, '{if}/{else} : aucun index posé, l\'enfant est dans le slot par défaut et s\'affiche')
      assert.deepEqual(avant.clone, { attribut: null, range: true, hauteur: true }, 'contenu cloné par un composant parent : même règle')
      assert.equal(avant.volet.attribut, null, '{if} fermé : aucun index posé en attendant son slot')
      assert.deepEqual(avant.indexes, ['0', '1'], 'slots indexés d\'un {for} : chaque enfant reçoit toujours son index')
      assert.deepEqual(avant.slot1, ['deux'], 'le second enfant atterrit dans le slot 1')

      await page.evaluate(() => {
        ;(document.querySelector('mjs-carte') as any)._shadow.querySelector('.t').click()
        ;(document.querySelector('mjs-volet') as any)._shadow.querySelector('.t').click()
      })
      await page.waitForTimeout(100)
      const apres = await lire()
      assert.deepEqual(apres.carte, { attribut: null, range: true, hauteur: true }, 'branche {else} rendue : l\'enfant passe dans son slot par défaut')
      assert.deepEqual(apres.volet, { attribut: null, range: true, hauteur: true }, '{if} ouvert : l\'enfant apparaît dans le slot par défaut')
    } finally {
      await browser.close()
    }
  })
})
