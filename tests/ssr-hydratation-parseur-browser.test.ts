// Page rendue par le serveur puis reprise dans un navigateur réel quand le parseur HTML du navigateur range les nœuds
// autrement que le gabarit : un `<tr>` sous un `<table>` (le `<tbody>` que le parseur ouvre seul), un `<div>`, un `<ul>` ou
// un `<table>` sous un `<p>`, un `<li>` sous un `<li>`, une `<option>` sous une `<option>`, un `<a>` sous un `<a>`, un
// `<button>` sous un `<button>`, un titre sous un titre, du texte directement dans un `<table>` ou un `<tr>`.
// Le client bâtit ces blocs avec le DOM, qui accepte tout ; le HTML du serveur, lui, est relu par le parseur, qui referme
// ou déplace : les deux ancres d'un bloc ne sont plus chez le même parent, ou le texte d'une interpolation n'est plus là
// où le serveur l'a écrit. La reprise doit alors reconstruire la vue (comme `replace`), jamais planter ni laisser une
// interpolation inerte : chaque écriture de l'état se retrouve dans le DOM, en développement et en production, dans les
// quatre modes de reprise et sur les pages du moteur navigateur du prérendu, dans Chromium et Firefox.
// Les formes valides (`<tbody>` écrit, `<tbody>` répété par un bloc, `<option>` d'un `<select>`) sont les témoins : en
// `markers` leurs nœuds du serveur sont repris tels quels.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'

const MODES = ['markers', 'replace', 'positional', 'diff'] as const
const ENVS  = ['dev', 'prod'] as const

// les pages rendues par le moteur navigateur du prérendu (vrai Chromium), dans les trois modes qui reprennent les nœuds du serveur
const NAVIGATEUR = ['markers', 'positional', 'diff'].map((m) => `${m} (moteur navigateur)`)
const VARIANTES  = [...MODES, ...NAVIGATEUR] as const

type Forme = {
  tag:      string
  source:   string
  // le résumé du DOM de la forme, lu dans sa racine d'ombre (`r`)
  vue:      string
  depart:   string
  // [nom, geste (le composant est `el`), résumé attendu juste après]
  etapes:   Array<[string, string, string]>
  // les nœuds du serveur que `markers` doit reprendre tels quels (vide : la reprise reconstruit la vue)
  reprises: string[]
}

const SCRIPT_BASCULE = `<script>
  $on = true
  $a = 'a'
  @bascule = (v) -> $on = v
  @pose = (v) -> $a = v
</script>
`

const SCRIPT_LISTE = `<script>
  $items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 3, t: 'c' }]
  @pose = (l) -> $items = l
</script>
`

const SCRIPT_TEXTE = `<script>
  $a = 'a'
  @pose = (v) -> $a = v
</script>
`

const VUE_BASCULE = `(r) => 'x=' + r.querySelectorAll('.x').length + ' txt=' + Array.from(r.querySelectorAll('.x')).map((e) => e.textContent.trim()).join('|') + ' fin=' + r.querySelectorAll('.fin').length`
const VUE_LISTE   = `(r) => 'x=' + r.querySelectorAll('.x').length + ' txt=' + Array.from(r.querySelectorAll('.x')).map((e) => e.textContent.trim()).join('') + ' fin=' + r.querySelectorAll('.fin').length`
const VUE_TEXTE   = `(r) => 'tb=' + r.querySelector('.tb').textContent + ' fin=' + r.querySelectorAll('.fin').length`

// un bloc `{if}` dont le contenu (`.x`, « oui {$a} ») n'est pas permis là où le gabarit le pose
const bascule = (tag: string, gabarit: string, reprises: string[] = []): Forme => ({
  tag,
  source: `${SCRIPT_BASCULE}\n${gabarit}\n<p class="fin">fin</p>\n`,
  vue: VUE_BASCULE,
  depart: 'x=1 txt=oui a fin=1',
  etapes: [
    ['bascule à faux', `el.bascule(false)`, 'x=0 txt= fin=1'],
    ['texte z',        `el.pose('z')`,       'x=0 txt= fin=1'],
    ['bascule à vrai', `el.bascule(true)`,   'x=1 txt=oui z fin=1'],
    ['texte b',        `el.pose('b')`,       'x=1 txt=oui b fin=1']
  ],
  reprises
})

// un bloc `{for}` dont les lignes (`.x`, « {it.t} ») ne sont pas permises là où le gabarit les pose
const liste = (tag: string, gabarit: string, reprises: string[] = []): Forme => ({
  tag,
  source: `${SCRIPT_LISTE}\n${gabarit}\n<p class="fin">fin</p>\n`,
  vue: VUE_LISTE,
  depart: 'x=3 txt=abc fin=1',
  etapes: [
    ['réordre c a b',   `el.pose(L('c', 'a', 'b'))`,      'x=3 txt=cab fin=1'],
    ['ajout en tête d', `el.pose(L('d', 'c', 'a', 'b'))`, 'x=4 txt=dcab fin=1'],
    ['retrait de a',    `el.pose(L('d', 'c', 'b'))`,      'x=3 txt=dcb fin=1'],
    ['liste vidée',     `el.pose([])`,                    'x=0 txt= fin=1'],
    ['liste remplie b', `el.pose(L('b'))`,                'x=1 txt=b fin=1']
  ],
  reprises
})

// une interpolation de texte posée là où le parseur la sort de l'élément
const texte = (tag: string, gabarit: string): Forme => ({
  tag,
  source: `${SCRIPT_TEXTE}\n${gabarit}\n<p class="fin">fin</p>\n`,
  vue: VUE_TEXTE,
  depart: 'tb=ax fin=1',
  etapes: [
    ['texte z',    `el.pose('z')`,  'tb=zx fin=1'],
    ['texte vidé', `el.pose('')`,   'tb=x fin=1'],
    ['texte Zoé',  `el.pose('Zoé')`, 'tb=Zoéx fin=1']
  ],
  reprises: []
})

const FORMES: Forme[] = [
  liste('pa-table-for',      `<table class="tb">{for it in $items by id}<tr class="x"><td>{it.t}</td></tr>{end}</table>`),
  bascule('pa-table-if',     `<table class="tb">{if $on}<tr class="x"><td>oui {$a}</td></tr>{end}</table>`),
  {
    tag: 'pa-table-else',
    source: `${SCRIPT_BASCULE}\n<table class="tb">{if $on}<tr class="x"><td>oui {$a}</td></tr>{else}<tr class="y"><td>non {$a}</td></tr>{end}</table>\n<p class="fin">fin</p>\n`,
    vue: `(r) => 'x=' + r.querySelectorAll('.x').length + ' y=' + r.querySelectorAll('.y').length + ' txt=' + Array.from(r.querySelectorAll('tr')).map((e) => e.textContent.trim()).join('|') + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'x=1 y=0 txt=oui a fin=1',
    etapes: [
      ['bascule à faux', `el.bascule(false)`, 'x=0 y=1 txt=non a fin=1'],
      ['texte z',        `el.pose('z')`,       'x=0 y=1 txt=non z fin=1'],
      ['bascule à vrai', `el.bascule(true)`,   'x=1 y=0 txt=oui z fin=1']
    ],
    reprises: []
  },
  liste('pa-p-ul',           `<p class="p">{for it in $items by id}<ul class="x"><li>{it.t}</li></ul>{end}</p>`),
  bascule('pa-p-div',        `<p class="p">{if $on}<div class="x">oui {$a}</div>{end}</p>`),
  bascule('pa-p-p',          `<p class="p">avant{if $on}<p class="x">oui {$a}</p>{end}après</p>`),
  bascule('pa-p-table',      `<p class="p">{if $on}<table class="x"><tr><td>oui {$a}</td></tr></table>{end}</p>`),
  bascule('pa-li-li',        `<ul class="u"><li>avant{if $on}<li class="x">oui {$a}</li>{end}</li></ul>`),
  bascule('pa-option-option', `<select class="se" aria-label="choix"><option>avant{if $on}<option class="x">oui {$a}</option>{end}</option></select>`),
  bascule('pa-a-a',          `<a class="l" href="/un">avant{if $on}<a class="x" href="/deux">oui {$a}</a>{end}</a>`),
  bascule('pa-bouton-bouton', `<button class="b" type="button">avant{if $on}<button class="x" type="button">oui {$a}</button>{end}</button>`),
  bascule('pa-titre-titre',  `<h1 class="h">avant{if $on}<h2 class="x">oui {$a}</h2>{end}</h1>`),
  texte('pa-table-texte',    `<table class="tb">{$a}<tr><td>x</td></tr></table>`),
  texte('pa-tr-texte',       `<table class="tb"><tr>{$a}<td>x</td></tr></table>`),
  {
    tag: 'pa-deux-blocs',
    source: `<script>
  $on = true
  $a = 'a'
  $items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }]
  @bascule = (v) -> $on = v
  @liste = (l) -> $items = l
</script>

<ul class="u">{for it in $items by id}<li class="y">{it.t}</li>{end}</ul>
<table class="tb">{if $on}<tr class="x"><td>oui {$a}</td></tr>{end}</table>
<p class="fin">fin</p>
`,
    vue: `(r) => 'y=' + Array.from(r.querySelectorAll('.y')).map((e) => e.textContent.trim()).join('') + ' x=' + r.querySelectorAll('.x').length + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'y=ab x=1 fin=1',
    etapes: [
      ['liste c a',      `el.liste(L('c', 'a'))`, 'y=ca x=1 fin=1'],
      ['bascule à faux', `el.bascule(false)`,     'y=ca x=0 fin=1'],
      ['liste vidée',    `el.liste([])`,          'y= x=0 fin=1'],
      ['bascule à vrai', `el.bascule(true)`,      'y= x=1 fin=1']
    ],
    reprises: []
  },
  liste('pa-tbody-for',      `<table class="tb"><tbody>{for it in $items by id}<tr class="x"><td>{it.t}</td></tr>{end}</tbody></table>`, ['.tb', '.fin']),
  liste('pa-tbody-bloc',     `<table class="tb"><thead><tr><th>t</th></tr></thead>{for it in $items by id}<tbody class="x"><tr><td>{it.t}</td></tr></tbody>{end}</table>`, ['.tb', '.fin']),
  liste('pa-select-for',     `<select class="se" aria-label="choix">{for it in $items by id}<option class="x" value="{it.t}">{it.t}</option>{end}</select>`, ['.se', '.fin']),
  bascule('pa-select-div',   `<select class="se" aria-label="choix">{if $on}<div class="x">oui {$a}</div>{end}<option>un</option></select>`, ['.se', '.fin'])
]

type Rendus    = Record<string, { html: string; hydrateScript: string }>
type Construit = { rendus: Rendus; fichiers: Record<string, Map<string, Buffer>> }
let construit: Promise<Construit> | null = null

// les rendus du serveur dans chaque mode et les deux builds (développement, production), une seule fois pour les deux navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('parseur-hydratation')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const f of FORMES) writeFileSync(join(srcDir, f.tag + '.mjs'), f.source)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    const rendus: Rendus = {}
    for (const mode of MODES) {
      let html = ''
      let hydrateScript = ''
      for (const f of FORMES) {
        const r = await renderer.renderToString('mjs-' + f.tag, { ssrMode: mode } as any)
        html += r.html + '\n'
        hydrateScript = r.hydrateScript
      }
      rendus[mode] = { html, hydrateScript }
    }
    await renderer.close()
    const playwright = await import('playwright')
    if (existsSync(playwright.chromium.executablePath())) {
      const nav = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out-navigateur' } as any, { configDir: root })
      try {
        for (const variante of NAVIGATEUR) {
          let html = ''
          let hydrateScript = ''
          for (const f of FORMES) {
            const r = await nav.renderPage('mjs-' + f.tag, { ssrMode: variante.split(' ')[0] } as any)
            html += r.html + '\n'
            hydrateScript = r.hydrateScript
          }
          rendus[variante] = { html, hydrateScript }
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
      assert.ok(fichiers[env].has('bundle.js'), `le build ${env} écrit son manifeste`)
    }
    return { rendus, fichiers }
  })()
  return construit
}

// avant le bundle : chaque élément écrit par le serveur (dans toutes les racines d'ombre) porte un tampon, pour voir plus tard s'il a été repris
const TAMPON = `<script>(function () { function t(r) { r.querySelectorAll('*').forEach(function (n) { n.__srv = true; if (n.shadowRoot) t(n.shadowRoot) }) } document.querySelectorAll('*').forEach(function (h) { if (h.shadowRoot) t(h.shadowRoot) }) })()</script>`

// l'espion : toute exception d'une méthode du DOM qui change l'arbre est notée, qu'elle soit rattrapée ou non (le cœur rattrape celles de la reprise et reconstruit)
const ESPION = `window.__erreursDom = []; ['removeChild', 'insertBefore', 'appendChild', 'replaceChild', 'compareDocumentPosition'].forEach(function (nom) { var orig = Node.prototype[nom]; Node.prototype[nom] = function () { try { return orig.apply(this, arguments) } catch (e) { window.__erreursDom.push(nom + ' : ' + String(e.message).slice(0, 120)); throw e } } })`

for (const nom of ['chromium', 'firefox'] as const) for (const env of ENVS) for (const mode of VARIANTES) describe(`ancres rangées par le parseur : ${nom}, ${env}, hydratation « ${mode} »`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  let contenu = ''
  let fichiers = new Map<string, Buffer>()
  const erreurs: string[] = []

  const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const lire   = (f: Forme): Promise<string> => page.evaluate(`(() => { const h = document.querySelector('mjs-${f.tag}'); const r = h && h._shadow; return r ? (${f.vue})(r) : 'pas de racine' })()`)

  // la vue attendue : le navigateur la rejoint (chargement d'un enfant, promesse) dans un délai court, sinon c'est un échec
  async function attendreVue(f: Forme, attendu: string, quand: string) {
    let vu = ''
    for (let i = 0; i < 80; i++) {
      try { vu = await lire(f) } catch (e: any) { vu = 'lecture impossible : ' + String(e.message).slice(0, 120) }
      if (vu === attendu) return
      await dormir(25)
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
      if (!fait.rendus[mode]) { present = false; return }
      fichiers   = fait.fichiers[env]
      contenu    = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${fait.rendus[mode].html}\n${fait.rendus[mode].hydrateScript}\n${TAMPON}\n<script type="module" src="/out/bundle.js"></script></body></html>`
      browser    = await playwright[nom].launch()
      page       = await browser.newPage({ viewport: { width: 1000, height: 900 } })
      await page.addInitScript(`window.__name = (f) => f; window.L = (...ts) => ts.map((t) => ({ id: 'abcde'.indexOf(t) + 1, t })); ${ESPION}`)
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
      page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
      await page.route('http://parseur.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith('/out/')) {
          const corps = fichiers.get(url.pathname.slice(5))
          if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
          await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
          return
        }
        await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
      })
      await page.goto('http://parseur.test/page', { waitUntil: 'load' })
      await page.waitForFunction(`(() => ${JSON.stringify(FORMES.map((f) => 'mjs-' + f.tag))}.every((t) => { const h = document.querySelector(t); return h && h.matches(':defined') && !h.hasAttribute('mjs-loading') && h._shadow && h._shadow.firstElementChild }))()`, { timeout: 60000 })
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // les formes valides sont reprises telles quelles : la reprise ne reconstruit que ce que le parseur a rangé autrement
  if (mode.startsWith('markers')) it('les formes valides gardent les nœuds du serveur (mêmes objets), sans marqueur dans le DOM', async function () {
    if (!present) { this.skip(); return }
    for (const f of FORMES) {
      for (const sel of f.reprises) {
        assert.equal(await page.evaluate(`(() => { const e = document.querySelector('mjs-${f.tag}')._shadow.querySelector('${sel}'); return !!e && e.__srv === true })()`), true, `${f.tag} : ${sel} est le nœud du serveur`)
      }
    }
    assert.equal(await page.evaluate(`Array.from(document.querySelectorAll('*')).some((h) => h._shadow && h._shadow.querySelector('[mjs-h]'))`), false, 'aucun attribut mjs-h ne reste')
    assert.equal(await page.evaluate(`Array.from(document.querySelectorAll('*')).some((h) => { const r = h._shadow; if (!r) return false; const w = document.createTreeWalker(r, 128); let c; while ((c = w.nextNode())) if (/^mjs-[he]:/.test(c.data)) return true; return false })`), false, 'aucun commentaire de marqueur ne reste')
  })

  for (const f of FORMES) it(`${f.tag} : l'état de départ, puis chaque écriture de l'état se retrouve dans le DOM`, async function () {
    if (!present) { this.skip(); return }
    await attendreVue(f, f.depart, 'au départ')
    for (const [quoi, geste, attendu] of f.etapes) {
      await page.evaluate(`(() => { const el = document.querySelector('mjs-${f.tag}'); ${geste} })()`)
      await attendreVue(f, attendu, `après « ${quoi} »`)
    }
    assert.deepEqual(erreurs.filter((e) => e.includes('mjs-' + f.tag)), [], `${f.tag} : aucune erreur de page`)
  })

  it('aucune erreur dans la page', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    assert.deepEqual(await page.evaluate('window.__erreursDom'), [], 'aucune exception du DOM, même rattrapée')
  })
})
