// Page préparée par le serveur, reprise par un build `js: 'split'` (un fichier de code par composant) : la page attend que les fichiers de
// tous ses composants soient arrivés, puis les démarre d'un seul geste, du parent vers les enfants.
// Le navigateur reçoit la page déjà remplie, puis le code de chaque composant. La carte du build fait partir tous les fichiers en
// même temps, mais ils n'arrivent pas au même instant ; au premier rendu, un composant jette le contenu préparé et bâtit le sien.
// Un composant qui prendrait la main dès l'arrivée de son fichier ferait voir deux défauts : le bloc dont le fichier arrive avant celui du
// sous-bloc qu'il contient perd son sous-bloc le temps que ce fichier arrive ; le sous-bloc dont le fichier arrive avant celui de son bloc
// s'affiche avec ses réglages par défaut (le bloc lui passe ceux que le serveur n'a pas écrits) jusqu'à ce que le bloc le redessine.
// Ici le fichier d'un composant est servi en retard (route Playwright), et la page est relevée image par image (`requestAnimationFrame`) :
// ni le sous-bloc, ni le petit-bloc du sous-bloc, ni le composant que seule la deuxième carte d'une liste affiche ne doivent manquer à une
// seule image ; aucun composant de la page ne démarre avant que le dernier fichier soit arrivé ; chaque parent est défini avant ses
// enfants, dans la même tâche. Un composant sans rendu serveur n'attend personne : il part dès l'ouverture de la page, ce qui sert aussi
// d'horloge aux essais de plafond ci-dessous.
// Un fichier qui échoue ne retient pas la page (elle part aussitôt, l'échec est dit en console) ; un fichier qui n'arrive jamais la
// retient jusqu'au plafond d'attente (500 ms), pas au-delà ; un fichier qui arrive après le plafond prend la main à son arrivée.
// En développement et en production (vrai build, un morceau par module), dans Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const ENVS = ['dev', 'prod'] as const

// plafond d'attente de la page (mjs_autoloader.ts) : le test ne s'y colle jamais, il en garde la marge
const PLAFOND = 500

// le fichier le plus lent des essais ci-dessous est servi après ce délai (ms)
const LE_PLUS_LENT = 250

const SOURCES: Record<string, string> = {
  'pa-petit.mjs': `<i class="pe">PETIT-TEXTE</i>
`,
  'pa-sous-bloc.mjs': `<p class="s">SOUS-BLOC-TEXTE</p>
<@pa-petit></@pa-petit>
`,
  'pa-bloc.mjs': `<script>
  $n = 0
  @plus = -> $n++
</script>

<p class="b">Bloc {$n}</p>
<button class="plus" @click=@plus>plus</button>
<@pa-sous-bloc></@pa-sous-bloc>
`,
  'pa-pastille.mjs': `<b class="pa">PASTILLE-TEXTE</b>
`,
  'pa-carte.mjs': `<script>
  $badge = ''
</script>

<p class="c">carte</p>
{if $badge}
  <@pa-pastille></@pa-pastille>
{end}
`,
  'pa-liste.mjs': `<@pa-carte></@pa-carte>
<@pa-carte badge="oui"></@pa-carte>
`,
  'pa-feuille.mjs': `<u class="fe">FEUILLE-TEXTE</u>
`,
  'pa-leger.mjs': `<p class="l">LEGER-TEXTE</p>
<@pa-feuille></@pa-feuille>
`,
  'pa-hote.mjs': `<@pa-leger mjs-light></@pa-leger>
`,
  'pa-libre.mjs': `<p class="li">LIBRE-TEXTE</p>
`
}

// les composants que la page du serveur affiche, et pour chacun le composant qui le contient
const BALISES = ['mjs-pa-bloc', 'mjs-pa-sous-bloc', 'mjs-pa-petit', 'mjs-pa-liste', 'mjs-pa-carte', 'mjs-pa-pastille', 'mjs-pa-hote', 'mjs-pa-leger', 'mjs-pa-feuille']
const PARENTS = [['petit', 'sous-bloc'], ['sous-bloc', 'bloc'], ['pastille', 'carte'], ['carte', 'liste'], ['feuille', 'leger'], ['leger', 'hote']]

// ce que la sonde cherche à chaque image : le chemin des balises (chacune dans la racine d'ombre de la précédente, `#n` = la n-ième)
// jusqu'au composant, qui doit être affiché et porter son texte
const CIBLES = [
  { nom: 'sous-bloc', chemin: ['mjs-pa-bloc', 'mjs-pa-sous-bloc'],                   texte: 'SOUS-BLOC-TEXTE' },
  { nom: 'petit',     chemin: ['mjs-pa-bloc', 'mjs-pa-sous-bloc', 'mjs-pa-petit'],   texte: 'PETIT-TEXTE' },
  { nom: 'pastille',  chemin: ['mjs-pa-liste', 'mjs-pa-carte#1', 'mjs-pa-pastille'], texte: 'PASTILLE-TEXTE' },
  { nom: 'feuille',   chemin: ['mjs-pa-hote', 'mjs-pa-leger', 'mjs-pa-feuille'],        texte: 'FEUILLE-TEXTE' }
]

// posée AVANT tout script de la page : relève chaque cible à CHAQUE image, et pour chaque balise l'instant (ms) et la tâche où elle est définie
// (`tache` : numéro de la tâche du navigateur, qui change dès qu'une minuterie a pu passer entre deux définitions)
const SONDE = `(() => {
  const cibles = ${JSON.stringify(CIBLES)};
  const trames = window.__trames = [];
  const defs   = window.__defs = {};
  const define = customElements.define.bind(customElements);
  let tache = 0, ouverte = false;
  customElements.define = (nom, classe, opts) => {
    if (!ouverte) { ouverte = true; setTimeout(() => { tache++; ouverte = false }, 0) }
    const r = define(nom, classe, opts);
    defs[nom] = { t: Math.round(performance.now()), tache };
    return r;
  };
  const lire = (c) => {
    let el = null;
    for (const part of c.chemin) {
      const [sel, i] = part.split('#');
      const racine = el === null ? document : (el._shadow || el.shadowRoot || el);
      if (!racine) return false;
      el = racine.querySelectorAll(sel)[i ? Number(i) : 0];
      if (!el) return false;
    }
    const r = el._shadow || el.shadowRoot || el;
    return getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && r.textContent.includes(c.texte);
  };
  const tick = () => {
    trames.push({ t: Math.round(performance.now()), v: cibles.map(lire) });
    if (!window.__fin) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`

type Trame     = { t: number; v: boolean[] }
type Def       = { t: number; tache: number }
type Construit = { html: string; fichiers: Record<string, Map<string, Buffer>> }
let construit: Promise<Construit> | null = null

// la page rendue par le serveur (une fois) et les deux builds, partagés par les trois navigateurs
function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('parent-attend-enfants')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const renderer = await createSSRRenderer({ sourceDir: srcDir } as any)
    let html = ''
    try {
      for (const racine of ['mjs-pa-bloc', 'mjs-pa-liste', 'mjs-pa-hote']) html += (await renderer.renderToString(racine, { ssrMode: 'replace' } as any)).html
    }
    finally {
      await renderer.close()
    }
    for (const enfant of ['mjs-pa-sous-bloc', 'mjs-pa-petit', 'mjs-pa-pastille', 'mjs-pa-feuille']) assert.match(html, new RegExp(`<${enfant}\\b[^>]*\\bmjs-ssr\\b`), `le serveur doit avoir rendu <${enfant}> dans la page — HTML : ${html}`)
    // le composant sans rendu serveur : sa balise nue, que la page porte telle quelle
    html += '<mjs-pa-libre></mjs-pa-libre>'
    const fichiers: Record<string, Map<string, Buffer>> = {}
    for (const env of ENVS) {
      const dossier = join(root, 'out-' + env)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', js: 'split', env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
      fichiers[env] = new Map<string, Buffer>()
      for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers[env].set(n, readFileSync(join(dossier, n)))
      assert.ok(fichiers[env].has('bundle.js'), `le build ${env} écrit son manifeste`)
    }
    return { html, fichiers }
  })()
  return construit
}

// les images où la cible `i` manquait, une fois vue une première fois (avant la première image où elle est là, la page n'est pas encore peinte)
function trous(trames: Trame[], i: number): number[] {
  const premiere = trames.findIndex((f) => f.v[i])
  if (premiere < 0) return [-1]
  return trames.slice(premiere).filter((f) => !f.v[i]).map((f) => f.t)
}

// ce que le serveur fait de chaque fichier de composant : servi tel quel, en retard (ms), en échec (404) ou jamais
type Sort = number | 'echec' | 'jamais'

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const env of ENVS) describe(`la page attend tous ses fichiers puis démarre du parent vers les enfants : ${nom}, ${env}`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let fait: Construit
  let version = ''

  before(async function () {
    this.timeout(180000)
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    fait    = await construire()
    version = (/µ\.version = "([^"]+)"/.exec(fait.fichiers[env].get('bundle.js')!.toString('utf-8')) ?? [])[1] ?? ''
    assert.ok(version, 'le manifeste porte la version du build')
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // ouvre la page, fichiers servis selon `sorts` (préfixe du fichier → sort), et rend la page avec ses erreurs
  async function ouvrir(sorts: Record<string, Sort>) {
    const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${fait.html}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    const page    = await browser.newPage({ viewport: { width: 1000, height: 900 } })
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
    // un fichier en échec fait recharger la page une fois par build (garde « bundle périmé ») : la garde est déjà tenue, la page reste la même
    await page.addInitScript(`sessionStorage.setItem('mjs-stale-reload', ${JSON.stringify(version)})`)
    await page.addInitScript(SONDE)
    await page.route('http://parent.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/out/')) { await route.fulfill({ status: 200, contentType: 'text/html', body: contenu }); return }
      const fichier = url.pathname.slice(5)
      const corps   = fait.fichiers[env].get(fichier)
      if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
      const sort = Object.entries(sorts).find(([prefixe]) => fichier.startsWith(prefixe))?.[1]
      if (sort === 'jamais') return
      if (sort === 'echec') { await route.fulfill({ status: 404, body: '' }); return }
      if (typeof sort === 'number') await new Promise((r) => setTimeout(r, sort))
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: corps })
    })
    await page.goto('http://parent.test/page', { waitUntil: 'commit' })
    return { page, erreurs }
  }

  // le bloc a repris la main : son bouton répond
  async function bloc(page: any) {
    await page.waitForFunction(`(() => { const e = document.querySelector('mjs-pa-bloc'); return !!e && e.matches(':defined') })()`, null, { timeout: 15000 })
    await page.evaluate(`document.querySelector('mjs-pa-bloc')._shadow.querySelector('.plus').click()`)
    await page.waitForFunction(`document.querySelector('mjs-pa-bloc')._shadow.querySelector('.b').textContent.trim() === 'Bloc 1'`, null, { timeout: 5000 })
  }

  // l'écart (ms) entre l'instant où le bloc est défini et celui où le composant sans rendu serveur l'a été : celui-ci part dès que la page
  // s'ouvre, il dit quand la page a commencé à attendre
  async function ecart(page: any): Promise<number> {
    const defs: Record<string, Def> = await page.evaluate('window.__defs')
    return defs['mjs-pa-bloc'].t - defs['mjs-pa-libre'].t
  }

  it('fichiers des enfants servis en retard : la page attend le dernier, puis aucune image ne perd le sous-bloc, le petit-bloc, la pastille de la deuxième carte ni la feuille d\'un parent léger', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvrir({ 'pa-sous-bloc-': 100, 'pa-petit-': LE_PLUS_LENT, 'pa-pastille-': 200, 'pa-feuille-': 150 })
    try {
      await page.waitForFunction(`[${[...BALISES, 'mjs-pa-libre'].map((n) => `'${n}'`).join(', ')}].every((n) => !!customElements.get(n))`, null, { timeout: 15000 })
      await bloc(page)
      await page.waitForTimeout(500)
      await page.evaluate('window.__fin = true')
      const trames: Trame[] = await page.evaluate('window.__trames')
      assert.ok(trames.at(-1)!.t - trames[0].t > 500, `sonde trop courte pour conclure : ${trames.length} images sur ${trames.at(-1)!.t - trames[0].t} ms`)
      assert.deepEqual(Object.fromEntries(CIBLES.map((c, i) => [c.nom, trous(trames, i)])), { 'sous-bloc': [], petit: [], pastille: [], feuille: [] }, 'instants (ms) où un composant manque à l\'écran : il disparaît le temps que son fichier arrive')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      const defs: Record<string, Def> = await page.evaluate('window.__defs')
      // aucun composant de la page ne démarre avant que le dernier fichier soit arrivé
      for (const n of BALISES) assert.ok(defs[n].t >= LE_PLUS_LENT, `<${n}> ne doit pas être défini avant l'arrivée du dernier fichier (${LE_PLUS_LENT} ms) — définitions : ${JSON.stringify(defs)}`)
      // les parents avant leurs enfants, à chaque niveau, et tous d'un seul geste (la même tâche)
      for (const [enfant, parent] of PARENTS) assert.ok(defs['mjs-pa-' + parent].t <= defs['mjs-pa-' + enfant].t, `<mjs-pa-${parent}> doit être défini avant <mjs-pa-${enfant}> — définitions : ${JSON.stringify(defs)}`)
      assert.equal(new Set(BALISES.map((n) => defs[n].tache)).size, 1, `les composants de la page sont définis dans une seule tâche — définitions : ${JSON.stringify(defs)}`)
    }
    finally {
      await page.close()
    }
  })

  it('le fichier du sous-bloc échoue : la page part aussitôt sans lui, et la console dit l\'échec', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvrir({ 'pa-sous-bloc-': 'echec' })
    try {
      await bloc(page)
      const attente = await ecart(page)
      assert.ok(attente < PLAFOND - 200, `un fichier en échec ne doit pas retenir la page jusqu'au plafond — bloc défini ${attente} ms après le composant sans rendu serveur`)
      const defs: Record<string, Def> = await page.evaluate('window.__defs')
      assert.equal(defs['mjs-pa-sous-bloc'], undefined, 'le sous-bloc, lui, n\'a jamais été défini')
      assert.ok(erreurs.some((e) => /Failed to import pa-sous-bloc/.test(e)), 'la console dit le fichier perdu : ' + JSON.stringify(erreurs))
    }
    finally {
      await page.close()
    }
  })

  it('le fichier du sous-bloc n\'arrive jamais : la page l\'attend jusqu\'au plafond, pas au-delà', async function () {
    if (!present) { this.skip(); return }
    const { page } = await ouvrir({ 'pa-sous-bloc-': 'jamais' })
    try {
      await bloc(page)
      const attente = await ecart(page)
      assert.ok(attente >= PLAFOND - 250, `la page doit avoir attendu le fichier jusqu'au plafond — bloc défini ${attente} ms après le composant sans rendu serveur`)
      assert.ok(attente < PLAFOND + 700, `la page ne doit pas être retenue bien au-delà du plafond — bloc défini ${attente} ms après le composant sans rendu serveur`)
      const defs: Record<string, Def> = await page.evaluate('window.__defs')
      assert.ok(defs['mjs-pa-liste'] && defs['mjs-pa-hote'], 'toute la page est partie, pas seulement le bloc')
    }
    finally {
      await page.close()
    }
  })

  it('le fichier du sous-bloc arrive après le plafond : la page part sans lui, il prend la main à son arrivée', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvrir({ 'pa-sous-bloc-': 900 })
    try {
      await bloc(page)
      const attente = await ecart(page)
      assert.ok(attente >= PLAFOND - 250 && attente < PLAFOND + 700, `la page part au plafond — bloc défini ${attente} ms après le composant sans rendu serveur`)
      await page.waitForFunction(`!!customElements.get('mjs-pa-sous-bloc') && !!customElements.get('mjs-pa-petit')`, null, { timeout: 15000 })
      await page.waitForTimeout(300)
      await page.evaluate('window.__fin = true')
      const trames: Trame[] = await page.evaluate('window.__trames')
      assert.deepEqual(trames.at(-1)!.v, [true, true, true, true], 'à la fin, le sous-bloc et son petit-bloc sont à l\'écran, comme la pastille et la feuille')
      const defs: Record<string, Def> = await page.evaluate('window.__defs')
      assert.ok(defs['mjs-pa-sous-bloc'].t >= 900, `le sous-bloc n'est défini qu'à l'arrivée de son fichier — défini à ${defs['mjs-pa-sous-bloc'].t} ms`)
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    }
    finally {
      await page.close()
    }
  })
})
