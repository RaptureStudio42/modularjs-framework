// Page rendue par le serveur (`ssrMode: 'markers'`) puis reprise dans Chromium : le composant enfant d'une ligne écrite par le serveur, sa
// balise définie avant la page, attend la reprise de sa ligne pour se connecter (runtime/mjs_hydrate.ts) ; ensuite il garde des propriétés
// rapides pour V8, comme celui dont la balise est définie après la page, qui n'attend pas. Une propriété posée sur l'élément le temps de
// l'attente puis effacée le ferait passer en dictionnaire : chaque lecture de son état en paierait le prix toute sa vie. Lu par
// `%HasFastProperties` (Chromium lancé avec le drapeau de V8 `--allow-natives-syntax` ; Firefox et WebKit n'ont pas V8)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

const N = 30
const SOURCES: Record<string, string> = {
  'c-item.mjs': '<p class="vu">{$lib}:{$n}</p>\n',
  'p-ssr.mjs': `<script>
  $l = Array.from({ length: ${N} }, (_, i) -> ({ id: 'r' + i, n: i }))
  rev = -> $l = $l.slice().reverse()
</script>
{for d in $l by id}<section class="ligne"><@c-item n=!{d.n} lib={d.id}></@c-item></section>{end}
<button class="rev" @click={rev()}>rev</button>
`
}

type Construit = { html: string, coeur: string, page: string, enfant: string }

async function construire(): Promise<Construit> {
  const root   = mjsTmp('lignes-forme')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
  const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
  let html = ''
  try {
    const r = await renderer.renderToString('mjs-p-ssr', { ssrMode: 'markers' } as any)
    html = `${r.html}\n${r.hydrateScript}`
  } finally {
    await renderer.close()
  }
  const lire     = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
  const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js') && f !== 'bundle.js')
  const noyau    = fichiers.filter((f) => /^mjs_core-/.test(f))
  const runtime  = fichiers.filter((f) => f.startsWith('mjs_') && !/^mjs_core-/.test(f)).sort()
  const page     = fichiers.filter((f) => f.startsWith('p-'))
  const enfant   = fichiers.filter((f) => f.startsWith('c-'))
  assert.ok(noyau.length === 1 && page.length === 1 && enfant.length === 1, `le build écrit un cœur, la page et l'enfant (${fichiers.join(', ')})`)
  return { html, coeur: lire(noyau[0]) + '\nglobalThis.µ = µ;\n' + runtime.map(lire).join('\n'), page: lire(page[0]), enfant: lire(enfant[0]) }
}

const script = (corps: string) => `<script>${corps.replace(/<\/script/gi, '<\\/script')}</script>`

// l'enfant défini avant la page attend la reprise de sa ligne ; défini plus tard, il est mis à niveau une fois sa ligne reprise
function documentDe(c: Construit, avant: boolean): string {
  const scripts = avant ? script(c.coeur + '\n' + c.enfant + '\n' + c.page) : script(c.coeur + '\n' + c.page) + script(`setTimeout(function () { (0, eval)(${JSON.stringify(c.enfant)}) }, 80)`)
  const corps   = `${c.html}\n${scripts}`
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}</body></html>`
}

// chaque enfant : ce qu'il montre, s'il a attendu sa ligne (la marque de l'attente reste posée, à zéro) et si ses propriétés sont rapides
const LIRE = `(() => {
  const p = document.querySelector('mjs-p-ssr')
  const s = p && (p._shadow || p.shadowRoot)
  const l = s ? Array.from(s.querySelectorAll('mjs-c-item')) : []
  const vu = (c) => { const o = c._shadow || c.shadowRoot; const v = o && o.querySelector('.vu'); return v ? v.textContent : '(absent)' }
  return { vus: l.map(vu), attendus: l.filter((c) => '_mjs_srvWait' in c).length, rapides: l.filter((c) => %HasFastProperties(c)).length }
})()`

type Lu = { vus: string[], attendus: number, rapides: number }

describe('reprise d\'une page servie : l\'enfant d\'une ligne qui attend sa reprise garde des propriétés rapides (chromium réel, V8)', function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let c: Construit

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test de la forme des enfants repris sauté. Activer : `npx playwright install chromium`'); return }
    c       = await construire()
    browser = await playwright.chromium.launch({ args: ['--js-flags=--allow-natives-syntax'] })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  async function ouvrir(avant: boolean): Promise<{ page: any, erreurs: string[], fermer: () => Promise<void> }> {
    const ctx  = await browser.newContext()
    const page = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 200)))
    await page.route('http://forme.test/**', (route: any) => route.fulfill({ contentType: 'text/html', body: documentDe(c, avant) }))
    await page.goto('http://forme.test/', { waitUntil: 'load' })
    return { page, erreurs, fermer: () => ctx.close() }
  }

  // la page au repos, chaque enfant montré
  async function lu(page: any): Promise<Lu> {
    let l: Lu = await page.evaluate(LIRE)
    for (let i = 0; i < 50 && !(l.vus.length === N && l.vus.every((v) => v !== '(absent)')); i++) {
      await new Promise((fini) => setTimeout(fini, 50))
      l = await page.evaluate(LIRE)
    }
    return l
  }

  const attendus = (ordre: string[]) => ordre.map((i) => `r${i}:${i}`)
  const rangs    = Array.from({ length: N }, (_, i) => String(i))

  for (const avant of [false, true]) {
    it(`enfant défini ${avant ? 'avant la page : il attend la reprise de sa ligne' : 'plus tard (témoin) : il n\'attend pas'}, puis ses lignes se déplacent`, async function () {
      if (!present) { this.skip(); return }
      const o = await ouvrir(avant)
      try {
        let l = await lu(o.page)
        assert.deepEqual(o.erreurs, [], 'aucune erreur au chargement')
        assert.deepEqual(l.vus, attendus(rangs), 'chaque enfant montre sa ligne')
        assert.equal(l.attendus, avant ? N : 0, avant ? 'chaque enfant a attendu la reprise de sa ligne' : 'aucun enfant n\'a attendu')
        assert.equal(l.rapides, N, 'enfants aux propriétés rapides, une fois repris')
        await o.page.evaluate(`document.querySelector('mjs-p-ssr')._shadow.querySelector('.rev').click()`)
        l = await lu(o.page)
        assert.deepEqual(l.vus, attendus([...rangs].reverse()), 'lignes retournées : chaque enfant suit sa ligne')
        assert.equal(l.rapides, N, 'enfants aux propriétés rapides, après le déplacement de leurs lignes')
      } finally {
        await o.fermer()
      }
    })
  }
})
