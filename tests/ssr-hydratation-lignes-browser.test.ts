// Page rendue par le serveur (`ssrMode: 'markers'`) puis reprise dans un navigateur réel : les lignes d'un `{for}` que le serveur a
// écrites sont REPRISES (mêmes nœuds), pas refaites — à plat comme imbriquées, avec une clé `by`, une clé vide, sans clé (objets suivis
// par leur identité, valeurs simples par leur position). Le champ où le visiteur écrivait avant le démarrage garde le focus et sa saisie,
// et un clic dans une ligne reprise appelle le gestionnaire avec son élément. Une ligne dont la clé n'est pas celle de l'élément de même
// rang dans le navigateur est refaite, les autres restent. Une ligne qui porte un `{if}` est reprise, le contenu du `{if}` est refait.
// Un `{for}` dans un `{if}` ou dans un `{key}` est refait au premier rendu, comme avant. Après la reprise, chaque écriture de l'état se
// retrouve dans le DOM, sans ligne en double, et aucun repère ne reste dans le DOM.
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
  neufs?:  string
  // [nom, geste (le composant est `el`, sa racine `r`), résumé attendu juste après]
  etapes:  Array<[string, string, string]>
}

const LI = `(r) => 'li=' + Array.from(r.querySelectorAll('li')).map((l) => l.textContent.trim()).join(',') + ' lignes=' + r.querySelectorAll('li').length`

const FORMES: Forme[] = [
  {
    tag: 'li-plat',
    source: `<script>
  $items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 3, t: 'c' }, { id: 4, t: 'd' }]
  $choix = 0
  @choisir = (id) -> $choix = id
  @pose = (l) -> $items = l
</script>

<p class="choix">{$choix}</p>
<ul>
  {for it in $items by id}
    <li data-k="{it.t}"><a class="lien" @click="@choisir(it.id)">{it.t}</a><input class="saisie" aria-label="saisie {it.t}"></li>
  {end}
</ul>
`,
    vue: `(r) => 'choix=' + r.querySelector('.choix').textContent + ' li=' + Array.from(r.querySelectorAll('li')).map((l) => l.textContent.trim()).join(',') + ' lignes=' + r.querySelectorAll('li').length`,
    depart: 'choix=0 li=a,b,c,d lignes=4',
    repris: 'li, a, input',
    etapes: [
      ['clic sur la ligne b',      `r.querySelectorAll('.lien')[1].click()`,                                'choix=2 li=a,b,c,d lignes=4'],
      ['réordre d b a c',          `el.pose(L('d', 'b', 'a', 'c'))`,                                         'choix=2 li=d,b,a,c lignes=4'],
      ['clic sur la ligne d',      `r.querySelectorAll('.lien')[0].click()`,                                'choix=4 li=d,b,a,c lignes=4'],
      ['ajout en tête e',          `el.pose(L('e', 'd', 'b', 'a', 'c'))`,                                    'choix=4 li=e,d,b,a,c lignes=5'],
      ['retrait de b',             `el.pose(L('e', 'd', 'a', 'c'))`,                                         'choix=4 li=e,d,a,c lignes=4'],
      ['liste vidée',              `el.pose([])`,                                                            'choix=4 li= lignes=0'],
      ['liste remplie a b',        `el.pose(L('a', 'b'))`,                                                   'choix=4 li=a,b lignes=2']
    ]
  },
  {
    tag: 'li-imbr',
    source: `<script>
  $groupes = [{ id: 1, t: 'G1', items: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }] }, { id: 2, t: 'G2', items: [{ id: 1, t: 'c' }, { id: 2, t: 'd' }, { id: 3, t: 'e' }] }]
  @pose = (l) -> $groupes = l
</script>

<div class="g">
  {for g in $groupes by id}
    <section data-g="{g.t}"><h3>{g.t}</h3><ul>{for it in g.items by id}<li data-k="{it.t}">{it.t}</li>{end}</ul></section>
  {end}
</div>
`,
    vue: `(r) => Array.from(r.querySelectorAll('section')).map((s) => s.querySelector('h3').textContent + ':' + Array.from(s.querySelectorAll('li')).map((l) => l.textContent).join('')).join(' ') + ' lignes=' + r.querySelectorAll('li').length`,
    depart: 'G1:ab G2:cde lignes=5',
    repris: 'section, h3, ul, li',
    etapes: [
      ['réordre dans G2',          `el.pose([{ id: 1, t: 'G1', items: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }] }, { id: 2, t: 'G2', items: [{ id: 3, t: 'e' }, { id: 1, t: 'c' }] }])`, 'G1:ab G2:ec lignes=4'],
      ['groupes échangés',         `el.pose([{ id: 2, t: 'G2', items: [{ id: 3, t: 'e' }] }, { id: 1, t: 'G1', items: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 4, t: 'f' }] }])`, 'G2:e G1:abf lignes=4'],
      ['un groupe ajouté',         `el.pose([{ id: 2, t: 'G2', items: [] }, { id: 1, t: 'G1', items: [{ id: 1, t: 'a' }] }, { id: 3, t: 'G3', items: [{ id: 1, t: 'z' }] }])`, 'G2: G1:a G3:z lignes=2']
    ]
  },
  {
    tag: 'li-si',
    source: `<script>
  $items = [{ id: 1, t: 'a', on: true }, { id: 2, t: 'b', on: false }, { id: 3, t: 'c', on: true }]
  @pose = (l) -> $items = l
</script>

<ul>
  {for it in $items by id}
    <li data-k="{it.t}">{it.t}{if it.on}<b>!</b>{end}</li>
  {end}
</ul>
`,
    vue: LI + ` + ' b=' + r.querySelectorAll('b').length`,
    depart: 'li=a!,b,c! lignes=3 b=2',
    repris: 'li',
    etapes: [
      ['bascules',                 `el.pose([{ id: 1, t: 'a', on: false }, { id: 2, t: 'b', on: true }, { id: 3, t: 'c', on: true }])`, 'li=a,b!,c! lignes=3 b=2'],
      ['retrait de a',             `el.pose([{ id: 2, t: 'b', on: true }, { id: 3, t: 'c', on: false }])`,                                'li=b!,c lignes=2 b=1']
    ]
  },
  {
    tag: 'li-ecart',
    source: `<script>
  $items = (if globalThis.__ecart then ['a', 'x', 'c'] else ['a', 'b', 'c']).map((t) -> { id: t, t: t })
  @pose = (l) -> $items = l
</script>

<ul>
  {for it in $items by id}
    <li data-k="{it.t}">{it.t}</li>
  {end}
</ul>
`,
    vue: LI,
    depart: 'li=a,x,c lignes=3',
    repris: 'li[data-k="a"], li[data-k="c"]',
    neufs: 'li[data-k="x"]',
    etapes: [
      ['ajout en fin d',           `el.pose(['a', 'x', 'c', 'd'].map((t) => ({ id: t, t })))`,               'li=a,x,c,d lignes=4']
    ]
  },
  {
    tag: 'li-objets',
    source: `<script>
  $items = [{ t: 'a' }, { t: 'b' }, { t: 'c' }]
  @pose = (l) -> $items = l
</script>

<ul>
  {for it in $items}
    <li>{it.t}</li>
  {end}
</ul>
`,
    vue: LI,
    depart: 'li=a,b,c lignes=3',
    repris: 'li',
    etapes: [
      ['liste neuve',              `el.pose([{ t: 'c' }, { t: 'd' }])`,                                      'li=c,d lignes=2']
    ]
  },
  {
    tag: 'li-valeurs',
    source: `<script>
  $vals = ['a', 'b', 'c']
  @pose = (l) -> $vals = l
</script>

<ul>
  {for v in $vals}
    <li>{v}</li>
  {end}
</ul>
`,
    vue: LI,
    depart: 'li=a,b,c lignes=3',
    repris: 'li',
    etapes: [
      ['retrait en tête',          `el.pose(['b', 'c'])`,                                                    'li=b,c lignes=2'],
      ['ajout',                    `el.pose(['b', 'c', 'd', 'e'])`,                                          'li=b,c,d,e lignes=4']
    ]
  },
  {
    tag: 'li-cle-vide',
    source: `<script>
  $items = [{ id: 1, t: 'a' }, { id: null, t: 'b' }, { id: '', t: 'c' }]
  @pose = (l) -> $items = l
</script>

<ul>
  {for it in $items by id}
    <li>{it.t}</li>
  {end}
</ul>
`,
    vue: LI,
    depart: 'li=a,b,c lignes=3',
    repris: 'li',
    etapes: [
      ['ajout en fin',             `el.pose([{ id: 1, t: 'a' }, { id: '', t: 'c' }, { id: 4, t: 'd' }])`,     'li=a,c,d lignes=3']
    ]
  },
  {
    tag: 'li-dans-si',
    source: `<script>
  $on = true
  $items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }]
  @bascule = (v) -> $on = v
  @pose = (l) -> $items = l
</script>

{if $on}
  <ul>
    {for it in $items by id}
      <li>{it.t}</li>
    {end}
  </ul>
{end}
`,
    vue: LI,
    depart: 'li=a,b lignes=2',
    repris: '',
    neufs: 'li',
    etapes: [
      ['ajout',                    `el.pose(L('a', 'b', 'c'))`,                                              'li=a,b,c lignes=3'],
      ['bascule à faux',           `el.bascule(false)`,                                                      'li= lignes=0'],
      ['bascule à vrai',           `el.bascule(true)`,                                                       'li=a,b,c lignes=3']
    ]
  },
  {
    tag: 'li-dans-cle',
    source: `<script>
  $k = 1
  $items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }]
  @cle = (v) -> $k = v
  @pose = (l) -> $items = l
</script>

{key $k}
  <ul>
    {for it in $items by id}
      <li>{it.t}</li>
    {end}
  </ul>
{end}
`,
    vue: LI,
    depart: 'li=a,b lignes=2',
    repris: '',
    neufs: 'li',
    etapes: [
      ['nouvelle clé',             `el.cle(2)`,                                                              'li=a,b lignes=2'],
      ['ajout',                    `el.pose(L('a', 'b', 'c'))`,                                              'li=a,b,c lignes=3']
    ]
  }
]

type Rendu     = { html: string; hydrateScript: string }
type Construit = { rendus: Record<string, Rendu>; fichiers: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

const VARIANTES = ['happy-dom', 'moteur navigateur'] as const

// les rendus du serveur (happy-dom, moteur navigateur) et le build de production, une seule fois pour les trois navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('lignes-hydratation')
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
// écrit dans le champ de la troisième ligne de `li-plat`, qui garde le focus
const AVANT = `<script>(function () {
  function t(r) { r.querySelectorAll('*').forEach(function (n) { n.__srv = true; if (n.shadowRoot) t(n.shadowRoot) }) }
  document.querySelectorAll('*').forEach(function (h) { if (h.shadowRoot) t(h.shadowRoot) })
  var c = document.querySelector('mjs-li-plat').shadowRoot.querySelectorAll('input')[2]
  c.focus()
  c.value = 'frappe'
})()</script>`

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const variante of VARIANTES) {
  if (variante === 'moteur navigateur' && nom !== 'chromium') continue
  describe(`lignes reprises : ${nom}, page du ${variante}`, function () {
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
        await page.addInitScript(`window.__name = (f) => f; window.__ecart = true; window.L = (...ts) => ts.map((t) => ({ id: 'abcdefgh'.indexOf(t) + 1, t }))`)
        page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
        page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push('console : ' + m.text().slice(0, 300)) })
        await page.route('http://lignes.test/**', async (route: any) => {
          const url = new URL(route.request().url())
          if (url.pathname.startsWith('/out/')) {
            const corps = fichiers.get(url.pathname.slice(5))
            if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
            await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
            return
          }
          await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
        })
        await page.goto('http://lignes.test/page', { waitUntil: 'load' })
        await page.waitForFunction(`(() => ${JSON.stringify(FORMES.map((f) => 'mjs-' + f.tag))}.every((t) => { const h = document.querySelector(t); return h && h.matches(':defined') && !h.hasAttribute('mjs-loading') && h._shadow && h._shadow.firstElementChild }))()`, { timeout: 60000 })
      } catch (e) { present = false; throw e }
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    it('les lignes écrites par le serveur sont reprises (mêmes nœuds), une ligne qui ne correspond pas est refaite', async function () {
      if (!present) this.skip()
      for (const f of FORMES) {
        await attendreVue(f, f.depart, 'après la reprise')
        const etat = await page.evaluate(`(() => { const r = document.querySelector('mjs-${f.tag}')._shadow; const pris = (s) => s ? Array.from(r.querySelectorAll(s)) : []; return { repris: pris(${JSON.stringify(f.repris)}).filter((n) => n.__srv !== true).map((n) => n.outerHTML.slice(0, 60)), nb: pris(${JSON.stringify(f.repris)}).length, neufs: pris(${JSON.stringify(f.neufs || '')}).filter((n) => n.__srv === true).length } })()`)
        assert.deepEqual(etat.repris, [], `${f.tag} : les éléments « ${f.repris} » sont ceux du serveur`)
        if (f.repris) assert.ok(etat.nb > 0, `${f.tag} : des éléments « ${f.repris} » sont présents`)
        assert.equal(etat.neufs, 0, `${f.tag} : les éléments « ${f.neufs} » sont refaits`)
      }
    })

    it('le champ où le visiteur écrivait garde le focus et sa saisie', async function () {
      if (!present) this.skip()
      const champ = await page.evaluate(`(() => { const r = document.querySelector('mjs-li-plat')._shadow; const c = r.querySelectorAll('input')[2]; return { focus: r.activeElement === c, valeur: c.value, srv: c.__srv === true } })()`)
      assert.deepEqual(champ, { focus: true, valeur: 'frappe', srv: true })
    })

    it('aucun repère ne reste dans le DOM', async function () {
      if (!present) this.skip()
      const restes = await page.evaluate(`(() => { const out = []; document.querySelectorAll('*').forEach((h) => { const r = h._shadow; if (!r) return; r.querySelectorAll('[mjs-h], [mjs-r]').forEach((n) => out.push(n.outerHTML.slice(0, 60))); const w = document.createTreeWalker(r, 128); let c; while ((c = w.nextNode())) if (/^mjs-/.test(c.data)) out.push('<!--' + c.data + '-->') }); return out })()`)
      assert.deepEqual(restes, [])
    })

    for (const f of FORMES) it(`${f.tag} : chaque écriture de l'état se retrouve dans le DOM`, async function () {
      if (!present) this.skip()
      await attendreVue(f, f.depart, 'au départ')
      for (const [quoi, geste, attendu] of f.etapes) {
        await page.evaluate(`(() => { const el = document.querySelector('mjs-${f.tag}'); const r = el._shadow; ${geste} })()`)
        await attendreVue(f, attendu, `après « ${quoi} »`)
      }
    })

    it('aucune erreur ni avertissement dans la page', async function () {
      if (!present) this.skip()
      assert.deepEqual(erreurs, [])
    })
  })
}
