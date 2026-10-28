// page rendue par le serveur (`ssrMode: 'markers'`) puis reprise dans un navigateur réel : une ligne dont la clé est un objet suivi
// par son identité (clé `by` objet, gelé ou non ; clé objet d'une `Map` sans `by`) se reprend par son rang, comme celle d'une liste
// d'objets sans `by` : son identifiant est fabriqué à chaque page, le serveur écrit `#`. Mêmes données des deux côtés : les lignes
// du serveur restent, avec la saisie du visiteur, même quand le navigateur a déjà fabriqué d'autres identifiants (une liste du
// navigateur seul, rendue avant celle de la forme, en prend au compteur de la page). Une clé écrite (objet qui s'écrit lui-même,
// comme un tableau ; clé texte d'une `Map`, même de la forme d'un identifiant du framework) se compare toujours telle quelle : à un
// autre rang, la ligne est refaite. La page vient du rendu happy-dom (Chromium, Firefox, WebKit) et du moteur navigateur du
// prérendu (Chromium)

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
  // les repères de ligne écrits par le serveur (`<!--mjs-l:…-->`), dans l'ordre du HTML
  lignes:  string[]
}

// une liste du navigateur seul, rendue avant celle de la forme : ses clés objets prennent des identifiants au compteur de la page
const LEURRE_ETAT = `$leurre = (if globalThis.__ecart then [{ ref: {} }, { ref: {} }, { ref: {} }] else [])`
const LEURRE      = `<div class="leurre">
  {for d in $leurre by ref}
    <p>-</p>
  {end}
</div>`

const SAISIES = `(r) => 'li=' + Array.from(r.querySelectorAll('li')).map((l) => l.textContent.trim()).join(',') + ' saisies=' + Array.from(r.querySelectorAll('li input')).map((c) => c.value).join(',')`

const FORMES: Forme[] = [
  {
    tag: 'cle-objet',
    source: `<script>
  ${LEURRE_ETAT}
  $items = [{ ref: { n: 1 }, t: 'a' }, { ref: Object.freeze({ n: 2 }), t: 'b' }]
</script>

${LEURRE}
<ul>
  {for it in $items by ref}
    <li>{it.t}<input class="saisie" aria-label="saisie {it.t}"></li>
  {end}
</ul>
`,
    vue: SAISIES,
    depart: 'li=a,b saisies=tape-0,tape-1',
    repris: 'li',
    neufs: '',
    lignes: ['#', '#']
  },
  {
    tag: 'cle-objet-ecart',
    source: `<script>
  ${LEURRE_ETAT}
  $items = (if globalThis.__ecart then [{ ref: { n: 1 }, t: 'x' }, { ref: { n: 2 }, t: 'y' }, { ref: { n: 3 }, t: 'z' }] else [{ ref: { n: 1 }, t: 'a' }, { ref: { n: 2 }, t: 'b' }])
</script>

${LEURRE}
<ul>
  {for it in $items by ref}
    <li>{it.t}<input class="saisie" aria-label="saisie {it.t}"></li>
  {end}
</ul>
`,
    vue: SAISIES,
    depart: 'li=x,y,z saisies=tape-0,tape-1,',
    repris: 'li:nth-child(-n+2)',
    neufs: 'li:nth-child(3)',
    lignes: ['#', '#']
  },
  {
    tag: 'map-objets',
    source: `<script>
  ${LEURRE_ETAT}
  $m = new Map([[{ n: 1 }, 'a'], [{ n: 2 }, 'b']])
</script>

${LEURRE}
<ul>
  {for i, p in $m}
    <li>{p[1]}<input class="saisie" aria-label="saisie {p[1]}"></li>
  {end}
</ul>
`,
    vue: SAISIES,
    depart: 'li=a,b saisies=tape-0,tape-1',
    repris: 'li',
    neufs: '',
    lignes: ['#', '#']
  },
  {
    tag: 'map-textes',
    source: `<script>
  paires = (if globalThis.__ecart then [['mjs-o1', 'a'], ['mjs-o3', 'c'], ['mjs-o2', 'b']] else [['mjs-o1', 'a'], ['mjs-o2', 'b'], ['mjs-o3', 'c']])
  $m = new Map(paires)
</script>

<ul>
  {for i, p in $m}
    <li>{p[1]}<input class="saisie" aria-label="saisie {p[1]}"></li>
  {end}
</ul>
`,
    vue: SAISIES,
    depart: 'li=a,c,b saisies=tape-0,,',
    repris: 'li:nth-child(1)',
    neufs: 'li:nth-child(n+2)',
    lignes: ['mjs-o1', 'mjs-o2', 'mjs-o3']
  },
  {
    tag: 'cle-objet-texte',
    source: `<script>
  $items = (if globalThis.__ecart then [{ ref: ['k1'], t: 'a' }, { ref: ['k3'], t: 'c' }, { ref: ['k2'], t: 'b' }] else [{ ref: ['k1'], t: 'a' }, { ref: ['k2'], t: 'b' }, { ref: ['k3'], t: 'c' }])
</script>

<ul>
  {for it in $items by ref}
    <li>{it.t}<input class="saisie" aria-label="saisie {it.t}"></li>
  {end}
</ul>
`,
    vue: SAISIES,
    depart: 'li=a,c,b saisies=tape-0,,',
    repris: 'li:nth-child(1)',
    neufs: 'li:nth-child(n+2)',
    lignes: ['k1', 'k2', 'k3']
  },
  {
    tag: 'cle-objet-imbr',
    source: `<script>
  ${LEURRE_ETAT}
  $groupes = [{ ref: { n: 1 }, t: 'G', items: ['a', 'b'] }, { ref: { n: 2 }, t: 'H', items: ['c'] }]
</script>

${LEURRE}
<div class="groupes">
  {for g in $groupes by ref}
    <section><h3>{g.t}</h3><input class="titre" aria-label="titre {g.t}"><ul>{for v in g.items}<li>{v}<input class="saisie" aria-label="saisie {v}"></li>{end}</ul></section>
  {end}
</div>
`,
    vue: `(r) => Array.from(r.querySelectorAll('section')).map((s) => s.querySelector('h3').textContent + ':' + s.querySelector('.titre').value + ':' + Array.from(s.querySelectorAll('li')).map((l) => l.textContent.trim() + '=' + l.querySelector('input').value).join('/')).join(' ')`,
    depart: 'G:tape-0:a=tape-1/b=tape-2 H:tape-3:c=tape-4',
    repris: 'section, li',
    neufs: '',
    lignes: ['#', 'idx-0', 'idx-1', '#', 'idx-0']
  }
]

type Rendu     = { html: string; hydrateScript: string }
type Construit = { rendus: Record<string, Rendu>; fichiers: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

const VARIANTES = ['happy-dom', 'moteur navigateur'] as const

// les rendus du serveur (happy-dom, moteur navigateur) et le build de production, une seule fois pour les trois navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('lignes-cles-objets')
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

// les repères de ligne qu'un rendu du serveur écrit dans le composant `tag`
function reperes(html: string, tag: string): string[] {
  const bloc = html.match(new RegExp(`<mjs-${tag}[\\s>][\\s\\S]*?</mjs-${tag}>`))
  assert.ok(bloc, `le rendu contient <mjs-${tag}>`)
  return Array.from(bloc[0].matchAll(/<!--mjs-l:([\s\S]*?)-->/g), (m) => m[1])
}

describe('lignes à clé objet : repères écrits par le serveur', function () {
  this.timeout(180000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const variante of VARIANTES) it(`${variante} : « # » pour une clé d'identité, la clé encodée pour une clé écrite`, async function () {
    const fait = await construire()
    if (!fait.rendus[variante]) this.skip()
    const vus: Record<string, string[]> = {}
    const voulus: Record<string, string[]> = {}
    for (const f of FORMES) {
      vus[f.tag]    = reperes(fait.rendus[variante].html, f.tag)
      voulus[f.tag] = f.lignes
    }
    assert.deepEqual(vus, voulus)
  })
})

// avant le bundle : chaque élément écrit par le serveur porte un tampon (pour voir plus tard s'il a été repris), puis le visiteur
// écrit dans chaque champ (`tape-<rang>`)
const AVANT = `<script>(function () {
  function t(r) { r.querySelectorAll('*').forEach(function (n) { n.__srv = true; if (n.shadowRoot) t(n.shadowRoot) }); }
  document.querySelectorAll('*').forEach(function (h) { if (h.shadowRoot) t(h.shadowRoot) });
  ${JSON.stringify(FORMES.map((f) => 'mjs-' + f.tag))}.forEach(function (tag) {
    document.querySelector(tag).shadowRoot.querySelectorAll('input').forEach(function (c, i) { c.value = 'tape-' + i; });
  });
})()</script>`

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const variante of VARIANTES) {
  if (variante === 'moteur navigateur' && nom !== 'chromium') continue
  describe(`lignes à clé objet reprises par leur rang : ${nom}, page du ${variante}`, function () {
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
        await page.route('http://cles-objets.test/**', async (route: any) => {
          const url = new URL(route.request().url())
          if (url.pathname.startsWith('/out/')) {
            const corps = fichiers.get(url.pathname.slice(5))
            if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
            await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
            return
          }
          await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
        })
        await page.goto('http://cles-objets.test/page', { waitUntil: 'load' })
        await page.waitForFunction(`(() => ${JSON.stringify(FORMES.map((f) => 'mjs-' + f.tag))}.every((t) => { const h = document.querySelector(t); return h && h.matches(':defined') && !h.hasAttribute('mjs-loading') && h._shadow && h._shadow.firstElementChild }))()`, { timeout: 60000 })
      } catch (e) { present = false; throw e }
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    for (const f of FORMES) it(`${f.tag} : la vue suit les données du navigateur, les lignes reprises gardent la saisie`, async function () {
      if (!present) this.skip()
      await attendreVue(f, f.depart, 'après la reprise')
      const etat = await page.evaluate(`(() => { const r = document.querySelector('mjs-${f.tag}')._shadow; const pris = (s) => s ? Array.from(r.querySelectorAll(s)) : []; return { repris: pris(${JSON.stringify(f.repris)}).filter((n) => n.__srv !== true).map((n) => n.outerHTML.slice(0, 60)), nbRepris: pris(${JSON.stringify(f.repris)}).length, neufs: pris(${JSON.stringify(f.neufs)}).filter((n) => n.__srv === true).map((n) => n.outerHTML.slice(0, 60)), nbNeufs: pris(${JSON.stringify(f.neufs)}).length } })()`)
      assert.deepEqual(etat.repris, [], `${f.tag} : les éléments « ${f.repris} » sont ceux du serveur`)
      assert.deepEqual(etat.neufs, [], `${f.tag} : les éléments « ${f.neufs} » sont refaits`)
      if (f.repris) assert.ok(etat.nbRepris > 0, `${f.tag} : des éléments « ${f.repris} » sont présents`)
      if (f.neufs) assert.ok(etat.nbNeufs > 0, `${f.tag} : des éléments « ${f.neufs} » sont présents`)
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
