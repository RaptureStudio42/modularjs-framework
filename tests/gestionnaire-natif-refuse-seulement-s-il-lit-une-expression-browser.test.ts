// un `on…` d'une balise HTML ou SVG est refusé à la construction quand il lit une expression : une accolade qui en ouvre une
// (`onclick="if (w) { f() }"`, `onclick="{$x}"`) ou la forme calculée `onclick={$x}` ; le message propose `@click={…}` pour un événement du
// navigateur, et pour un autre nom (`one={$x}`) les deux voies sans nom d'événement : `@…={…}` ou un nom `data-…`. Sur une balise tierce (`<x-truc>`), seule la forme texte qui lit une expression est
// refusée : la forme calculée lui arrive en propriété (`onclick={$f}` se déclenche, `one={$x}` est lu). Des accolades vides, le quantifieur
// d'une expression régulière ou une accolade dans une chaîne (`{}`, `/^a{2}$/`, `'{'.length`) ne lisent rien : le texte est posé tel quel
// et le gestionnaire se déclenche, dans Chromium et dans Firefox — vraie construction (production, un seul fichier), mode strict
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const script = `\n<script>\n  $x = 'a'\n  $f = -> window.__n = 7\n</script>\n`
// aucune expression lue : le clic écrit 1 dans `window.__n`
const DECLENCHENT: Record<string, string> = {
  'n-vide':   `<button class="v" onclick="window.__o = {}; window.__n = 1">b</button>`,
  'n-quant':  `<button class="v" onclick="if (/^a{2}$/.test('aa')) window.__n = 1">b</button>`,
  'n-chaine': `<button class="v" onclick="window.__n = '{'.length">b</button>`,
  'n-simple': `<button class="v" onclick="window.__n = 1">b</button>`
}
// balise tierce, forme calculée : la valeur arrive en propriété
const TIERCES: Record<string, string> = {
  't-fonction':  `<x-truc class="v" onclick={$f}>t</x-truc>`,
  't-proprietes': `<x-truc class="v" one={$x} only={$x}>t</x-truc>`
}
// une expression lue : refusée, avec la forme à écrire
const CLIC = /@click=\{…\}/
const REFUSES: Record<string, { texte: string, forme: RegExp }> = {
  'r-bloc':    { texte: `<button class="v" onclick="if (window) { window.__n = 1 }">b</button>`, forme: CLIC },
  'r-texte':   { texte: `<button class="v" onclick="{$x}">b</button>`, forme: CLIC },
  'r-calcule': { texte: `<button class="v" onclick={$x}>b</button>`, forme: CLIC },
  'r-tierce':  { texte: `<x-truc class="v" onclick="if (window) { window.__n = 1 }">t</x-truc>`, forme: CLIC },
  'r-svg':     { texte: `<svg><circle class="v" r="5" onclick="if (window) { window.__n = 1 }"></circle></svg>`, forme: CLIC },
  'r-nom':     { texte: `<div class="v" one={$x}>t</div>`, forme: /« @…=\{…\} », avec le nom de l'événement après « @ » ; sinon, renommez-le \(« data-one »/ }
}

// construit un composant seul ; rend le code de la page, en mode strict, ou le message du refus
const construire = async (nom: string, texte: string): Promise<{ code: string, refus: string }> => {
  const root = mjsTmp('gestionnaire-natif-expression')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, nom + '.mjs'), texte + script)
  const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle', minify: false } as any)
  let refus = ''
  try { refus = (await bundler.compile()).errors.map((e: any) => String(e.message)).join('\n') }
  catch (e) { refus = String((e as Error).message) }
  finally { await bundler.close() }
  if (refus) return { code: '', refus }
  return { code: '"use strict";\n' + readFileSync(join(out, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, ''), refus }
}

describe('gestionnaire natif on… : refusé à la construction seulement quand il lit une expression', function () {
  this.timeout(200000)
  const construits: Record<string, { code: string, refus: string }> = {}

  before(async () => {
    for (const [nom, texte] of Object.entries({ ...DECLENCHENT, ...TIERCES })) construits[nom] = await construire(nom, texte)
    for (const [nom, cas] of Object.entries(REFUSES)) construits[nom] = await construire(nom, cas.texte)
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('{ f() }, onclick="{$x}", onclick={$x}, texte d\'une balise tierce, SVG : refus avec @click={…} ; one={$x} : @…={…} sans nom d\'événement, ou un nom data-…', () => {
    const vus = Object.fromEntries(Object.entries(REFUSES).map(([nom, cas]) => [nom, new RegExp(nom).test(construits[nom].refus) && cas.forme.test(construits[nom].refus)]))
    assert.deepEqual(vus, Object.fromEntries(Object.keys(REFUSES).map((nom) => [nom, true])))
  })

  it('{}, quantifieur, accolade dans une chaîne, forme calculée d\'une balise tierce : la construction passe', () => {
    const noms = [...Object.keys(DECLENCHENT), ...Object.keys(TIERCES)]
    assert.deepEqual(Object.fromEntries(noms.map((nom) => [nom, construits[nom].refus])), Object.fromEntries(noms.map((nom) => [nom, ''])))
  })

  for (const moteur of ['chromium', 'firefox'] as const) {
    it(`${moteur} : le texte est posé tel quel et le gestionnaire se déclenche ; la balise tierce reçoit ses propriétés`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const navigateur = await playwright[moteur].launch()
      try {
        const vus: Record<string, unknown> = {}
        for (const nom of [...Object.keys(DECLENCHENT), ...Object.keys(TIERCES)]) {
          if (!construits[nom].code) { vus[nom] = 'refusé'; continue }
          const page = await navigateur.newPage()
          await page.setContent('<!doctype html><html><head></head><body></body></html>')
          await page.addScriptTag({ content: construits[nom].code })
          vus[nom] = await page.evaluate(async (balise: string) => {
            document.body.innerHTML = `<${balise}></${balise}>`
            const hote: any = document.querySelector(balise)
            let v: any = null
            for (let i = 0; i < 100 && !v; i++) {
              await new Promise((r) => setTimeout(r, 20))
              v = (hote._shadow || hote.shadowRoot || hote).querySelector('.v')
            }
            if (!v) return 'absent'
            await new Promise((r) => setTimeout(r, 50))
            ;(window as any).__n = 0
            v.click()
            return /^mjs-t-/.test(balise) ? { declenche: (window as any).__n, one: String(v.one), only: String(v.only) } : { attr: v.getAttribute('onclick'), declenche: (window as any).__n }
          }, 'mjs-' + nom)
          await page.close()
        }
        assert.deepEqual(vus, {
          ...Object.fromEntries(Object.entries(DECLENCHENT).map(([nom, texte]) => [nom, { attr: /onclick="([^"]*)"/.exec(texte)![1], declenche: 1 }])),
          't-fonction':   { declenche: 7, one: 'undefined', only: 'undefined' },
          't-proprietes': { declenche: 0, one: 'a', only: 'a' }
        })
      }
      finally { await navigateur.close() }
    })
  }
})
