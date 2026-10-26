// Page rendue par le serveur avec des props (`renderToString` / `renderPage`, option `props`), puis reprise dans un vrai
// navigateur : les props gardent leur type à la reprise comme dans le HTML du serveur. Un nombre reste un nombre, `$a + $b`
// vaut 12 (et 13 après `b = 8`), jamais « 57 », comme quand un parent pose `a={5}` dans le navigateur seul. Une prop
// écrite en texte sur la balise (`<mjs-x a="5">`) reste une chaîne. Les deux moteurs du serveur (happy-dom, navigateur),
// les quatre modes de reprise, en développement et en production (vrai build, un morceau par module), dans Chromium ;
// et la balise d'une page rendue par requête posée après le démarrage (navigation), qui reçoit aussi ses props typées.
// Un nom de prop en kebab-case (`user-id`) ou en camelCase (`userId`) arrive dans la variable que lit le composant
// (`$userId`), typé, sans clé parasite (`user-id`, `userid`) dans l'état, au serveur comme à la reprise.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'

const MODES = ['replace', 'markers', 'positional', 'diff'] as const
const ENVS  = ['dev', 'prod'] as const
const PROPS = { a: 5, b: 7, c: true, o: { k: 1 }, l: 'true', n: null, titre: 'Stylo' }

const SOMME = `<script>
  $a = 1
  $b = 2
  $somme = $a + $b
</script>

<p class="s">{$somme}</p>
<p class="t">{typeof $a}/{typeof $b}/{typeof $c}/{typeof $o}/{typeof $l}/{typeof $n}</p>
<p class="v">{JSON.stringify($o)}|{$l}|{$titre}</p>
`

const PARENT = `<@pt-somme a={5} b={7} c={true} o={{ k: 1 }} l={'true'} n={null} titre="Stylo"></@pt-somme>
`

const TYPES = 'number/number/boolean/object/string/object'

// noms composés : `.v` liste les clés parasites de l'état (aucune attendue)
const NOMS = `<script>
  $userId = 1
  $nbArticles = 2
  $total = $userId + $nbArticles
</script>

<p class="s">{$total}</p>
<p class="t">{typeof $userId}/{typeof $nbArticles}</p>
<p class="v">{Object.keys($).filter((k) => ['user-id', 'userid', 'nb-articles', 'nbarticles', 'data-n', 'dataN'].includes(k)).join(',') || 'aucune'}</p>
`
const NOMS_PROPS = { 'kebab-case': { 'user-id': 5, 'nb-articles': 7, 'data-n': 5 }, camelCase: { userId: 5, nbArticles: 7 } }
const NOMS_MODES = ['replace', 'markers'] as const

type Rendus    = Record<string, { html: string; hydrateScript: string }>
type Construit = { rendus: Rendus; fichiers: Record<string, Map<string, Buffer>> }
let construit: Promise<Construit> | null = null

// les rendus des deux moteurs dans chaque mode et les deux builds, une seule fois
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('props-racine-typees')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'pt-somme.mjs'), SOMME)
    writeFileSync(join(srcDir, 'pt-parent.mjs'), PARENT)
    writeFileSync(join(srcDir, 'pt-noms.mjs'), NOMS)
    const rendus: Rendus = {}
    const renderer = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    for (const mode of MODES) {
      const r = await renderer.renderToString('mjs-pt-somme', { ssrMode: mode, props: PROPS } as any)
      rendus[mode] = { html: r.html, hydrateScript: r.hydrateScript }
    }
    for (const [nom, props] of Object.entries(NOMS_PROPS)) {
      for (const mode of NOMS_MODES) {
        const r = await renderer.renderToString('mjs-pt-noms', { ssrMode: mode, props } as any)
        rendus[`noms ${nom} ${mode}`] = { html: r.html, hydrateScript: r.hydrateScript }
      }
    }
    await renderer.close()
    const playwright = await import('playwright')
    if (existsSync(playwright.chromium.executablePath())) {
      const nav = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out-navigateur' } as any, { configDir: root })
      try {
        for (const mode of MODES) {
          const p = await nav.renderPage('mjs-pt-somme', { ssrMode: mode, props: PROPS } as any)
          rendus[`${mode} (moteur navigateur)`] = { html: p.html, hydrateScript: p.hydrateScript }
        }
        for (const [nom, props] of Object.entries(NOMS_PROPS)) {
          for (const mode of NOMS_MODES) {
            const p = await nav.renderPage('mjs-pt-noms', { ssrMode: mode, props } as any)
            rendus[`noms ${nom} ${mode} (moteur navigateur)`] = { html: p.html, hydrateScript: p.hydrateScript }
          }
        }
      } finally {
        await nav.close()
      }
    }
    const fichiers: Record<string, Map<string, Buffer>> = {}
    for (const env of ENVS) {
      const dossier = join(root, 'out-' + env)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'split', env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
      fichiers[env] = new Map<string, Buffer>()
      for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers[env].set(n, readFileSync(join(dossier, n)))
    }
    return { rendus, fichiers }
  })()
  return construit
}

// la vue de `<mjs-pt-somme>` (`hote` : l'expression qui le trouve) : somme, types reçus, valeurs reçues
const vue = (hote: string) => `(() => { const h = ${hote}; const r = h && h._shadow; if (!r || !r.querySelector('.s')) return 'pas de vue'; return r.querySelector('.s').textContent + ' ' + r.querySelector('.t').textContent + ' ' + r.querySelector('.v').textContent })()`
const RACINE = `document.querySelector('mjs-pt-somme')`
const ENFANT = `document.querySelector('mjs-pt-parent')._shadow.querySelector('mjs-pt-somme')`

for (const env of ENVS) describe(`props de la racine typées à la reprise : chromium, ${env}`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let fait: Construit

  const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

  before(async function () {
    this.timeout(180000)
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) return
    fait    = await construire()
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // ouvre `corps` (HTML de la page, avant le bundle), attend le montage de `tag`, puis compare la vue de `hote` à `attendu`
  async function voir(corps: string, tag: string, hote: string, attendu: string, apres?: { js: string; attendu: string }) {
    const page    = await browser.newPage()
    const erreurs: string[] = []
    try {
      await page.addInitScript('window.__name = (f) => f')
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
      page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
      const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}\n<script type="module" src="/out/bundle.js"></script></body></html>`
      await page.route('http://props.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith('/out/')) {
          const fichier = fait.fichiers[env].get(url.pathname.slice(5))
          if (!fichier) { await route.fulfill({ status: 404, body: '' }); return }
          await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: fichier })
          return
        }
        await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
      })
      await page.goto('http://props.test/page', { waitUntil: 'load' })
      await page.waitForFunction(`(() => { const h = document.querySelector('${tag}'); return h && h.matches(':defined') && !h.hasAttribute('mjs-loading') && h._shadow && h._shadow.firstElementChild })()`, { timeout: 60000 })
      const etapes = apres ? [[attendu, ''], [apres.attendu, apres.js]] : [[attendu, '']]
      for (const [voulu, js] of etapes) {
        if (js) await page.evaluate(js)
        let vu = ''
        for (let i = 0; i < 80; i++) {
          vu = await page.evaluate(vue(hote))
          if (vu === voulu) break
          await dormir(25)
        }
        assert.equal(vu, voulu, js ? `après ${js}` : 'la vue reprise')
      }
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    } finally {
      await page.close()
    }
  }

  for (const variante of [...MODES, ...MODES.map((m) => `${m} (moteur navigateur)`)]) {
    it(`hydratation « ${variante} » : 12 au serveur, 12 repris, 13 après b = 8`, async function () {
      if (!present || !fait.rendus[variante]) { this.skip(); return }
      const { html, hydrateScript } = fait.rendus[variante]
      assert.match(html.replace(/<!--[^>]*-->/g, ''), /<p class="s"[^>]*>12<\/p>/, `le HTML du serveur — ${html.slice(0, 400)}`)
      await voir(`${html}\n${hydrateScript}`, 'mjs-pt-somme', RACINE, `12 ${TYPES} {"k":1}|true|Stylo`, { js: `${RACINE}._set('b', 8)`, attendu: `13 ${TYPES} {"k":1}|true|Stylo` })
    })
  }

  for (const nom of Object.keys(NOMS_PROPS)) {
    for (const variante of [...NOMS_MODES, ...NOMS_MODES.map((m) => `${m} (moteur navigateur)`)]) {
      it(`noms en ${nom}, « ${variante} » : 12 au serveur, 12 repris, 13 après nbArticles = 8, sans clé parasite`, async function () {
        const rendu = fait?.rendus[`noms ${nom} ${variante}`]
        if (!present || !rendu) { this.skip(); return }
        const sans = rendu.html.replace(/<!--[^>]*-->/g, '')
        assert.match(sans, /<p class="s"[^>]*>12<\/p>/, `le HTML du serveur — ${rendu.html.slice(0, 400)}`)
        assert.match(sans, /<p class="v"[^>]*>aucune<\/p>/, `clés parasites au serveur — ${rendu.html.slice(0, 400)}`)
        const hote = `document.querySelector('mjs-pt-noms')`
        await voir(`${rendu.html}\n${rendu.hydrateScript}`, 'mjs-pt-noms', hote, '12 number/number aucune', { js: `${hote}._set('nbArticles', 8)`, attendu: '13 number/number aucune' })
      })
    }
  }

  it('navigateur seul, parent qui passe a={5} b={7} : la même vue', async function () {
    if (!present) { this.skip(); return }
    await voir('<mjs-pt-parent></mjs-pt-parent>', 'mjs-pt-parent', ENFANT, `12 ${TYPES} {"k":1}|true|Stylo`, { js: `${ENFANT}._set('b', 8)`, attendu: `13 ${TYPES} {"k":1}|true|Stylo` })
  })

  it('navigateur seul, props écrites en texte sur la balise (a="5") : la lecture des attributs ne change pas', async function () {
    if (!present) { this.skip(); return }
    await voir(`<mjs-pt-somme a="5" b="7" c="true" o='{"k":1}' l="true" n="null" titre="Stylo"></mjs-pt-somme>`, 'mjs-pt-somme', RACINE, '57 string/string/boolean/object/boolean/object {"k":1}|true|Stylo')
  })

  // navigation d'une page rendue par requête (UJS) : la page reçue est lue par DOMParser, sa balise posée APRÈS le démarrage du runtime
  it('balise rendue par le serveur posée après le démarrage (navigation) : ses props typées, 12, puis 13 après b = 8', async function () {
    if (!present) { this.skip(); return }
    const ouvrante = fait.rendus.replace.html.match(/<mjs-pt-somme[^>]*>/)
    assert.ok(ouvrante && / mjs-props="/.test(ouvrante[0]), `la balise du serveur porte mjs-props — ${fait.rendus.replace.html.slice(0, 300)}`)
    const recue = `<body>${ouvrante![0]}</mjs-pt-somme></body>`
    const poser = `document.body.append(new DOMParser().parseFromString(${JSON.stringify(recue)}, 'text/html').body.firstElementChild)`
    await voir('<mjs-pt-parent></mjs-pt-parent>', 'mjs-pt-parent', RACINE, 'pas de vue', { js: poser, attendu: `12 ${TYPES} {"k":1}|true|Stylo` })
    await voir('<mjs-pt-parent></mjs-pt-parent>', 'mjs-pt-parent', RACINE, 'pas de vue', { js: `${poser}; ${RACINE}._set('b', 8)`, attendu: `13 ${TYPES} {"k":1}|true|Stylo` })
  })
})
