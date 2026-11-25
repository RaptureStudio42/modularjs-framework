// une prop liée à sens unique (`value={r.n}`) ne s'écrit dans l'enfant que quand sa valeur change chez le parent, pas chaque fois que sa
// liaison se rejoue : une ligne de `{for}` qui se redessine (un `{if}` de la ligne bascule à chaque frappe) laisse au champ `<@@number>` la
// frappe en cours, que le champ annonce (`aria-valuenow`, valeur du formulaire), avec ou sans clé ; un composant à soi qui a changé sa prop
// lui-même la garde de même. Le parent qui change la valeur la donne à l'enfant. Défaut garanti absent : la ligne redessinée reposait la
// valeur d'avant du parent, le champ montrait la frappe et annonçait l'ancienne valeur.
// Restent comme avant : la ligne d'une liste de valeurs simples sans clé qui porte désormais un autre élément reçoit toutes ses props, même
// inchangées (aucun état d'un autre élément) ; la ligne recréée part de la valeur du parent ; la prop liée à deux sens suit la frappe.
// Chromium réel, développement

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const SOURCES: Record<string, string> = {
  'redessin-page.mjs': `<script>
  $rows = [{ id: 1, n: 1, on: false }, { id: 2, n: 2, on: false }]
  $kept = [{ id: 1, n: 1, on: false }, { id: 2, n: 2, on: false }]
  $nums = [1, 2]
  $o    = true
  $twin = [{ n: 1, on: false }]
</script>

<form class="f" :noUJS>
  <ul class="libre">{for r in $rows}<li><@@number name={'n' + r.id} value={r.n} @input={r.on = !r.on}></@@number>{if r.on}<b>!</b>{end}</li>{end}</ul>
  <ul class="cle">{for r in $kept by id}<li><@@number name={'k' + r.id} value={r.n} @input={r.on = !r.on}></@@number>{if r.on}<b>!</b>{end}</li>{end}</ul>
  <ul class="deux">{for r in $twin}<li><@@number value=!{r.n} @input={r.on = !r.on}></@@number>{if r.on}<b>!</b>{end}</li>{end}</ul>
</form>
<ul class="compteurs">{for r in $rows}<li><@compteur n={r.n}></@compteur>{if r.on}<i>!</i>{end}</li>{end}</ul>
<ul class="valeurs">{for v in $nums}<li><@volet ouvert={$o} v={v}></@volet></li>{end}</ul>
<p class="vt">{$twin[0].n}</p>
<button class="bascule" @click={$rows[0].on = !$rows[0].on}>b</button>
<button class="change" @click={$rows[0].n = 7}>c</button>
<button class="change-cle" @click={$kept[0].n = 7}>k</button>
<button class="change-deux" @click={$twin[0].n = 9}>d</button>
<button class="tri" @click={$nums = $nums.slice().reverse()}>t</button>
<button class="recree" @click={$rows = [{ id: 3, n: 5, on: false }]}>r</button>
`,
  'compteur.mjs': `<script>
  $n ?= 0
</script>

<button class="plus" @click={$n++}>+</button><span class="n">{$n}</span>
`,
  'volet.mjs': `<script>
  $ouvert ?= false
</script>

<p class="v">{$ouvert ? 'oui' : 'non'}</p><button class="f" @click={$ouvert = false}>f</button>
`
}

let construit: Promise<string> | null = null

function construire(): Promise<string> {
  construit ??= (async () => {
    const root   = mjsTmp('prop-liee-ligne-redessinee')
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
    return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  })()
  return construit
}

describe('prop liée à sens unique : gardée par l\'enfant quand la ligne se redessine, écrite quand le parent la change (chromium réel)', function () {
  this.timeout(120000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) {
      console.log('  ℹ️  chromium non installé, test de la prop liée sauté')
      return
    }
    const script = await construire()
    browser = await playwright.chromium.launch()
    page    = await browser.newPage()
    page.setDefaultTimeout(8000)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-redessin-page></mjs-redessin-page><script>${script}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => {
      const h = (document.querySelector('mjs-redessin-page') as any)?._shadow
      return !!h?.querySelector('ul.deux mjs-core-number')?._shadow?.querySelector('input') && !!h?.querySelector('mjs-volet')?._shadow?.querySelector('p.v') && !!h?.querySelector('mjs-compteur')?._shadow?.querySelector('span.n')
    })
    await page.evaluate(`window.__hote = () => document.querySelector('mjs-redessin-page')._shadow; window.__champ = (l, i) => __hote().querySelectorAll('ul.' + l + ' mjs-core-number')[i]._shadow.querySelector('input'); window.__clic = (sel) => __hote().querySelector(sel).click()`)
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  afterEach(function () {
    if (present) assert.deepEqual(erreurs, [], 'aucune erreur de page')
  })

  // ce que montre et annonce le champ `i` de la liste `l` : son texte, aria-valuenow, la valeur du formulaire (vide sans `name`)
  const champ = (l: string, i: number, nom = ''): Promise<string> => page.evaluate(`(() => { const c = __champ('${l}', ${i}); const f = new FormData(__hote().querySelector('form.f')); return c.value + ' | ' + c.getAttribute('aria-valuenow') + ' | ' + (f.get('${nom}') ?? '') })()`)
  // frappe au clavier réel dans le champ vidé, sans le quitter
  const taper = async (l: string, i: number, texte: string) => {
    await page.evaluate(`(() => { const c = __champ('${l}', ${i}); c.focus(); c.select() })()`)
    await page.keyboard.type(texte, { delay: 30 })
    await page.waitForTimeout(80)
  }
  const sortir = async (l: string, i: number) => {
    await page.evaluate(`__champ('${l}', ${i}).blur()`)
    await page.waitForTimeout(80)
  }
  const clic = async (sel: string) => {
    await page.evaluate(`__clic('${sel}')`)
    await page.waitForTimeout(80)
  }
  const lus = (sel: string): Promise<string> => page.evaluate(`[...__hote().querySelectorAll('${sel}')].map((x) => x._shadow.querySelector('.v, .n').textContent).join(',')`)

  for (const [l, nom, bouton, quoi] of [['libre', 'n1', 'button.change', 'sans clé'], ['cle', 'k1', 'button.change-cle', 'avec clé (`by id`)']] as const) {
    it(`<@@number value={r.n}> dans un {for} ${quoi} : la ligne redessinée à chaque frappe laisse au champ sa frappe, annoncée ; le parent qui change r.n la donne au champ`, async function () {
      if (!present) { this.skip(); return }
      await taper(l, 0, '42')
      assert.equal(await champ(l, 0, nom), '42 | 42 | 42', 'la frappe reste au champ et c\'est elle qu\'il annonce (avant : « 42 | 1 | 1 »)')
      await sortir(l, 0)
      assert.equal(await champ(l, 0, nom), '42 | 42 | 42', 'la sortie du champ garde la frappe')
      await clic(bouton)
      assert.equal(await champ(l, 0, nom), '7 | 7 | 7', 'le parent qui change la valeur la donne au champ')
    })
  }

  it('un composant à soi qui change sa prop lui-même la garde quand sa ligne se redessine ; le parent qui la change la lui donne', async function () {
    if (!present) { this.skip(); return }
    await page.evaluate(`__hote().querySelectorAll('mjs-compteur')[1]._shadow.querySelector('button.plus').click()`)
    await page.waitForTimeout(80)
    await clic('button.bascule')
    await clic('button.bascule')
    assert.equal(await lus('ul.compteurs mjs-compteur'), '7,3', 'la ligne redessinée laisse sa valeur à l\'enfant (avant : « 7,2 »)')
  })

  it('la prop liée à deux sens (`!{…}`) suit la frappe dans une ligne redessinée ; le parent qui la change la donne au champ', async function () {
    if (!present) { this.skip(); return }
    await taper('deux', 0, '58')
    assert.equal(await page.evaluate(`__hote().querySelector('p.vt').textContent`), '58', 'la variable du parent suit la frappe')
    await sortir('deux', 0)
    await clic('button.change-deux')
    assert.equal(await champ('deux', 0), '9 | 9 | ', 'le parent qui change la valeur la donne au champ')
  })

  it('liste de valeurs simples sans clé, triée : chaque ligne porte un autre élément et reçoit toutes ses props, même inchangées (aucun état d\'un autre élément)', async function () {
    if (!present) { this.skip(); return }
    await page.evaluate(`__hote().querySelectorAll('ul.valeurs mjs-volet').forEach((v) => v._shadow.querySelector('button.f').click())`)
    await page.waitForTimeout(80)
    assert.equal(await lus('ul.valeurs mjs-volet'), 'non,non', 'chaque volet s\'est fermé lui-même')
    await clic('button.tri')
    assert.equal(await lus('ul.valeurs mjs-volet'), 'oui,oui', 'la ligne qui porte un autre élément reprend `ouvert` du parent')
  })

  it('la ligne recréée part de la valeur du parent', async function () {
    if (!present) { this.skip(); return }
    await clic('button.recree')
    await page.waitForFunction(() => (document.querySelector('mjs-redessin-page') as any)._shadow.querySelector('ul.libre mjs-core-number')?._shadow?.querySelector('input')?.value === '5')
    assert.equal(await champ('libre', 0, 'n3'), '5 | 5 | 5')
    assert.equal(await lus('ul.compteurs mjs-compteur'), '5')
  })
})
