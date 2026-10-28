// Page rendue par le serveur (`ssrMode: 'markers'`) puis reprise dans un navigateur réel dont les données diffèrent de celles du
// serveur : une ligne n'est reprise que si sa clé, une fois les doublons écartés (la première occurrence d'une clé reste), est celle
// de l'élément de même rang. Une clé `by` écrite par l'auteur se compare telle quelle, même quand elle a la forme d'une clé
// d'identité du framework (`mjs-1`, `mjs-o2`, `mjs-3#1`) : la saisie faite sur une ligne ne passe jamais sur une autre. Un objet
// suivi par son identité (liste sans `by`, ou clé `by` nulle) se reprend par son rang, comme avant.
// La page vient du rendu happy-dom (Chromium, Firefox, WebKit) et du moteur navigateur du prérendu (Chromium).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'

type Forme = {
  tag:     string
  source:  string
  // le résumé du DOM de la forme, lu dans sa racine d'ombre (`r`)
  vue:     string
  depart:  string
  // les éléments qui doivent être ceux du serveur après la reprise, et ceux qui doivent être neufs
  repris:  string
  neufs:   string
  // [nom, geste (le composant est `el`, sa racine `r`), résumé attendu juste après]
  etapes:  Array<[string, string, string]>
}

const SAISIES = `(r) => 'li=' + Array.from(r.querySelectorAll('li')).map((l) => l.textContent.trim()).join(',') + ' saisies=' + Array.from(r.querySelectorAll('input')).map((c) => c.value).join(',')`

const FORMES: Forme[] = [
  {
    tag: 'cle-doublons',
    source: `<script>
  $items = (if globalThis.__ecart then [{ id: 2, t: 'c' }, { id: 2, t: 'd' }, { id: 1, t: 'a' }] else [{ id: 1, t: 'a' }, { id: 1, t: 'b' }, { id: 2, t: 'c' }])
  $choix = '-'
  @choisir = (t) -> $choix = t
</script>

<p class="choix">{$choix}</p>
<ul>
  {for it in $items by id}
    <li><button class="b" @click="@choisir(it.t)">{it.t}</button></li>
  {end}
</ul>
`,
    vue: `(r) => 'choix=' + r.querySelector('.choix').textContent + ' li=' + Array.from(r.querySelectorAll('li')).map((l) => l.textContent.trim()).join(',')`,
    depart: 'choix=- li=c,a',
    repris: '',
    neufs: 'li',
    etapes: [
      ['clic sur la première ligne', `r.querySelectorAll('.b')[0].click()`, 'choix=c li=c,a'],
      ['clic sur la seconde ligne',  `r.querySelectorAll('.b')[1].click()`, 'choix=a li=c,a']
    ]
  },
  {
    tag: 'cle-doublons-reprise',
    source: `<script>
  $items = (if globalThis.__ecart then [{ id: 1, t: 'a' }, { id: 1, t: 'x' }, { id: 2, t: 'b' }] else [{ id: 1, t: 'a' }, { id: 2, t: 'b' }])
  @pose = (l) -> $items = l
</script>

<ul>
  {for i, it in $items by id}
    <li>{i}:{it.t}</li>
  {end}
</ul>
`,
    vue: `(r) => 'li=' + Array.from(r.querySelectorAll('li')).map((l) => l.textContent.trim()).join(',')`,
    depart: 'li=0:a,2:b',
    repris: 'li',
    neufs: '',
    etapes: [
      ['doublon retiré', `el.pose([{ id: 1, t: 'a' }, { id: 2, t: 'b' }])`, 'li=0:a,1:b']
    ]
  },
  {
    tag: 'cle-motif',
    source: `<script>
  $items = (if globalThis.__ecart then ['mjs-3#1', 'mjs-o2', 'mjs-1'] else ['mjs-1', 'mjs-o2', 'mjs-3#1']).map((k) -> { id: k, t: k })
</script>

<ul>
  {for it in $items by id}
    <li data-k="{it.t}">{it.t}<input class="saisie" aria-label="saisie {it.t}"></li>
  {end}
</ul>
`,
    vue: SAISIES,
    depart: 'li=mjs-3#1,mjs-o2,mjs-1 saisies=,tape-1,',
    repris: 'li[data-k="mjs-o2"]',
    neufs: 'li[data-k="mjs-1"], li[data-k="mjs-3#1"]',
    etapes: []
  },
  {
    tag: 'cle-motif-nulle',
    source: `<script>
  $items = (if globalThis.__ecart then [{ id: null, t: 'x' }] else [{ id: 'mjs-1', t: 'a' }])
</script>

<ul>
  {for it in $items by id}
    <li>{it.t}<input class="saisie" aria-label="saisie {it.t}"></li>
  {end}
</ul>
`,
    vue: SAISIES,
    depart: 'li=x saisies=',
    repris: '',
    neufs: 'li',
    etapes: []
  },
  {
    tag: 'cle-identite',
    source: `<script>
  $items = (if globalThis.__ecart then [{ t: 'x' }, { t: 'y' }] else [{ t: 'a' }, { t: 'b' }])
</script>

<ul>
  {for it in $items}
    <li>{it.t}<input class="saisie" aria-label="saisie {it.t}"></li>
  {end}
</ul>
`,
    vue: SAISIES,
    depart: 'li=x,y saisies=tape-0,tape-1',
    repris: 'li',
    neufs: '',
    etapes: []
  },
  {
    tag: 'cle-nulle',
    source: `<script>
  $items = (if globalThis.__ecart then [{ id: null, t: 'x' }, { id: 7, t: 'y' }] else [{ id: null, t: 'a' }, { id: 7, t: 'b' }])
</script>

<ul>
  {for it in $items by id}
    <li>{it.t}</li>
  {end}
</ul>
`,
    vue: `(r) => 'li=' + Array.from(r.querySelectorAll('li')).map((l) => l.textContent.trim()).join(',')`,
    depart: 'li=x,y',
    repris: 'li',
    neufs: '',
    etapes: []
  }
]

type Rendu     = { html: string; hydrateScript: string }
type Construit = { rendus: Record<string, Rendu>; fichiers: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

const VARIANTES = ['happy-dom', 'moteur navigateur'] as const

// les rendus du serveur (happy-dom, moteur navigateur) et le build de production, une seule fois pour les trois navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('lignes-cles')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const f of FORMES) writeFileSync(join(srcDir, f.tag + '.mjs'), f.source)
    const rendus: Record<string, Rendu> = {}
    const renderer = await createSSRRenderer({ sourceDir: srcDir, env: 'prod', bundlerOpts: { runtime: ['hydrate'] } } as any)
    try {
      let html = ''
      let hydrateScript = ''
      for (const f of FORMES) {
        const r = await renderer.renderToString('mjs-' + f.tag, { ssrMode: 'markers' } as any)
        html += r.html + '\n'
        hydrateScript = r.hydrateScript
      }
      rendus['happy-dom'] = { html, hydrateScript }
    } finally {
      await renderer.close()
    }
    const playwright = await import('playwright')
    if (existsSync(playwright.chromium.executablePath())) {
      const nav = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out-navigateur', runtime: ['hydrate'] } as any, { configDir: root })
      try {
        let html = ''
        let hydrateScript = ''
        for (const f of FORMES) {
          const r = await nav.renderPage('mjs-' + f.tag, { ssrMode: 'markers' } as any)
          html += r.html + '\n'
          hydrateScript = r.hydrateScript
        }
        rendus['moteur navigateur'] = { html, hydrateScript }
      } finally {
        await nav.close()
      }
    }
    const dossier = join(root, 'out')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'split', env: 'prod' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
    const fichiers = new Map<string, Buffer>()
    for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers.set(n, readFileSync(join(dossier, n)))
    assert.ok(fichiers.has('bundle.js'), 'le build écrit son manifeste')
    return { rendus, fichiers }
  })()
  return construit
}

// avant le bundle : chaque élément écrit par le serveur porte un tampon (pour voir plus tard s'il a été repris), puis le visiteur
// écrit dans chaque champ des formes qui en ont un (`tape-<rang>`)
const AVANT = `<script>(function () {
  function t(r) { r.querySelectorAll('*').forEach(function (n) { n.__srv = true; if (n.shadowRoot) t(n.shadowRoot) }); }
  document.querySelectorAll('*').forEach(function (h) { if (h.shadowRoot) t(h.shadowRoot) });
  ['mjs-cle-motif', 'mjs-cle-motif-nulle', 'mjs-cle-identite'].forEach(function (tag) {
    document.querySelector(tag).shadowRoot.querySelectorAll('input').forEach(function (c, i) { c.value = 'tape-' + i; });
  });
})()</script>`

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const variante of VARIANTES) {
  if (variante === 'moteur navigateur' && nom !== 'chromium') continue
  describe(`lignes reprises par leur clé : ${nom}, page du ${variante}`, function () {
    this.timeout(180000)
    let present = false
    let browser: any
    let page: any
    let contenu = ''
    let fichiers: Map<string, Buffer>
    const erreurs: string[] = []
    const lire = (f: Forme): Promise<string> => page.evaluate(`(() => { const h = document.querySelector('mjs-${f.tag}'); const r = h && h._shadow; return r ? (${f.vue})(r) : 'pas de racine' })()`)

    async function attendreVue(f: Forme, attendu: string, quand: string) {
      let vu = ''
      for (let i = 0; i < 100; i++) {
        vu = await lire(f)
        if (vu === attendu) return
        await page.waitForTimeout(20)
      }
      assert.equal(vu, attendu, `${f.tag} ${quand}`)
    }

    before(async function () {
      this.timeout(180000)
      try {
        const playwright = await import('playwright')
        present = existsSync(playwright[nom].executablePath())
        if (!present) return
        const fait = await construire()
        if (!fait.rendus[variante]) { present = false; return }
        fichiers = fait.fichiers
        contenu  = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${fait.rendus[variante].html}\n${fait.rendus[variante].hydrateScript}\n${AVANT}\n<script type="module" src="/out/bundle.js"></script></body></html>`
        browser  = await playwright[nom].launch()
        page     = await browser.newPage({ viewport: { width: 1000, height: 900 } })
        await page.addInitScript(`window.__name = (f) => f; window.__ecart = true;`)
        page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
        page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push('console : ' + m.text().slice(0, 300)) })
        await page.route('http://cles.test/**', async (route: any) => {
          const url = new URL(route.request().url())
          if (url.pathname.startsWith('/out/')) {
            const corps = fichiers.get(url.pathname.slice(5))
            if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
            await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
            return
          }
          await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
        })
        await page.goto('http://cles.test/page', { waitUntil: 'load' })
        await page.waitForFunction(`(() => ${JSON.stringify(FORMES.map((f) => 'mjs-' + f.tag))}.every((t) => { const h = document.querySelector(t); return h && h.matches(':defined') && !h.hasAttribute('mjs-loading') && h._shadow && h._shadow.firstElementChild }))()`, { timeout: 60000 })
      } catch (e) { present = false; throw e }
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    for (const f of FORMES) it(`${f.tag} : la vue suit les données du navigateur, seules les lignes de même clé au même rang sont reprises`, async function () {
      if (!present) this.skip()
      await attendreVue(f, f.depart, 'après la reprise')
      const etat = await page.evaluate(`(() => { const r = document.querySelector('mjs-${f.tag}')._shadow; const pris = (s) => s ? Array.from(r.querySelectorAll(s)) : []; return { repris: pris(${JSON.stringify(f.repris)}).filter((n) => n.__srv !== true).map((n) => n.outerHTML.slice(0, 60)), nbRepris: pris(${JSON.stringify(f.repris)}).length, neufs: pris(${JSON.stringify(f.neufs)}).filter((n) => n.__srv === true).map((n) => n.outerHTML.slice(0, 60)), nbNeufs: pris(${JSON.stringify(f.neufs)}).length } })()`)
      assert.deepEqual(etat.repris, [], `${f.tag} : les éléments « ${f.repris} » sont ceux du serveur`)
      assert.deepEqual(etat.neufs, [], `${f.tag} : les éléments « ${f.neufs} » sont refaits`)
      if (f.repris) assert.ok(etat.nbRepris > 0, `${f.tag} : des éléments « ${f.repris} » sont présents`)
      if (f.neufs) assert.ok(etat.nbNeufs > 0, `${f.tag} : des éléments « ${f.neufs} » sont présents`)
      for (const [quoi, geste, attendu] of f.etapes) {
        await page.evaluate(`(() => { const el = document.querySelector('mjs-${f.tag}'); const r = el._shadow; ${geste} })()`)
        await attendreVue(f, attendu, `après « ${quoi} »`)
      }
    })

    it('aucun repère ne reste dans le DOM', async function () {
      if (!present) this.skip()
      const restes = await page.evaluate(`(() => { const out = []; document.querySelectorAll('*').forEach((h) => { const r = h._shadow; if (!r) return; r.querySelectorAll('[mjs-h], [mjs-r]').forEach((n) => out.push(n.outerHTML.slice(0, 60))); const w = document.createTreeWalker(r, 128); let c; while ((c = w.nextNode())) if (/^mjs-/.test(c.data)) out.push('<!--' + c.data + '-->') }); return out })()`)
      assert.deepEqual(restes, [])
    })

    it('aucune erreur ni avertissement dans la page', async function () {
      if (!present) this.skip()
      assert.deepEqual(erreurs, [])
    })
  })
}
