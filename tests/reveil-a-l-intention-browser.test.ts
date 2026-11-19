// Le réveil à l'intention (`@wake=interaction` sur la balise d'un composant rendu par le serveur), sur une page rendue en `ssr:markers` : le
// composant reste la page du serveur, même à l'écran, jusqu'au premier signe d'intention sur lui — le pointeur qui y entre (souris, doigt
// posé), le focus clavier. Ce signe est écouté sans rien prendre : aucun geste n'est retenu, annulé, arrêté ni rejoué. Un geste arrivé avant
// la fin du réveil a l'effet qu'il a dans la page du serveur, le même que sur une page sans `@wake` dont le code n'est pas encore arrivé
// (comparé geste par geste au témoin) ; réveillé, le composant répond comme sans `@wake`. Faire paraître le composant ne le réveille pas. Au
// clavier, Tab jusqu'au champ d'un composant qui attend : la vue reprend le nœud du champ de la page du serveur, le focus et la saisie y
// restent au réveil, la frappe et Entrée suivent, sur une page sans valeur qui bouge comme sur une page réactive, comme au démarrage de la
// même page sans `@wake`, et aussi quand le focus est déjà dans le composant à la pose de son déclencheur : le code arrivé après le premier
// Tab, ou un composant qui attend dans un composant qui attend, réveillé avec lui ; de même pour la carte que recrée une racine rebâtie au
// démarrage (la page du serveur ne répond pas au code du navigateur), dont la vue, rebâtie au réveil, rend le focus à son champ. En
// `ssr:positional` et `ssr:diff`, `interaction` se réveille comme `view`, quand la balise paraît à l'écran (le rendu en `ssr`, où la vue
// remplace la page du serveur : cf. reveil-a-l-intention-ssr-browser). Sans rendu serveur, l'option ne change rien. En développement et en
// production (un fichier par composant), dans Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { prerenderPages } from '../src/server/prerender.js'
import { playTogether } from './helpers/engines-together.js'

const ENVS       = ['dev', 'prod'] as const
const MODES      = ['replace', 'markers', 'positional', 'diff', 'prerender'] as const
const COMME_VIEW = ['positional', 'diff'] as const

const SOURCES: Record<string, string> = {
  'ri-carte.mjs': `<script>
  $n = 0
  $s = 0
  @plus = -> $n++
  @filtre = (e) ->
    e.key == 'Enter' and e.preventDefault()
  @bloque = (e) ->
    e.preventDefault()
  µmount ->
    (window.__ordre ||= []).push($quoi)
</script>

<form class="f" @submit.prevent={$s++}><input class="u" aria-label="u" name="u" @keydown=@filtre></form>
<p class="c">Carte {$quoi} {$n} s{$s}</p>
<button type="button" class="plus" @click=@plus>plus</button>
<input class="k" aria-label="k" @keydown=@bloque>
<input class="x" type="checkbox" aria-label="x">

<style>
  :host
    display: block
    width: 400px
</style>
`,
  'ri-page.mjs': `<@ri-carte :wake=interaction quoi="a"></@ri-carte>
<@ri-carte :wake=interaction quoi="b"></@ri-carte>
<@ri-carte :wake=interaction quoi="c"></@ri-carte>
<@ri-carte :wake=interaction quoi="d"></@ri-carte>
<@ri-carte quoi="tot"></@ri-carte>
<div class="espace"></div>
<@ri-carte :wake=interaction quoi="loin"></@ri-carte>

<style>
  .espace
    height: 2600px
</style>
`,
  // les mêmes cartes sous une racine qui affiche une valeur (un repère de la reprise dans la racine)
  'ri-page-r.mjs': `<script>
  $titre = 'Cartes'
</script>

<h1>{$titre}</h1>
<@ri-carte :wake=interaction quoi="a"></@ri-carte>
<@ri-carte quoi="tot"></@ri-carte>
`,
  // une boîte qui attend, et dans sa page une carte qui attend
  'ri-boite.mjs': `<script>
  µmount ->
    (window.__ordre ||= []).push('boite')
</script>

<p class="titre">Boite {$quoi}</p>
<@ri-carte :wake=interaction quoi="n"></@ri-carte>
`,
  'ri-page-b.mjs': `<@ri-boite :wake=interaction quoi="B"></@ri-boite>
<@ri-carte quoi="tot"></@ri-carte>
`
}

// la racine de la page réactive, telle que la construit un serveur resté sur une version sans valeur qui bouge : sa page n'a aucun repère,
// la vue du navigateur en attend un, elle est rebâtie au démarrage
const RACINE_DU_SERVEUR = `<h1>Cartes</h1>
<@ri-carte :wake=interaction quoi="a"></@ri-carte>
<@ri-carte quoi="tot"></@ri-carte>
`

// posée avant tout script de la page : retrouve une carte par son texte (`Carte <quoi>`), à toute profondeur, page du serveur ou vue
// neuve ; `__ecoute(q)` note, à la racine de la carte (après tous ses écouteurs), chaque événement qui la traverse et s'il a été annulé
// (`!`) ; l'envoi du formulaire est retenu par le test pour rester sur la page
const SONDE = `(() => {
  window.__ordre = window.__ordre || [];
  const racine = (el) => el && (el._shadow || el.shadowRoot);
  const tous = (nom) => { const out = [], fouille = (r) => r.querySelectorAll('*').forEach((e) => { if (e.localName === nom) out.push(e); if (racine(e)) fouille(racine(e)); }); fouille(document); return out; };
  window.__cartes = () => tous('mjs-ri-carte');
  window.__boiteAttend = () => tous('mjs-ri-boite').some((b) => b.hasAttribute('mjs-wake'));
  window.__carte = (q) => window.__cartes().find((c) => racine(c) && new RegExp('Carte ' + q + ' ').test(racine(c).textContent));
  window.__dans = (q, sel) => { const c = window.__carte(q); return c && racine(c).querySelector(sel); };
  window.__texte = (q) => { const c = window.__carte(q); return c ? racine(c).querySelector('.c').textContent.trim() : null; };
  window.__attend = (q) => { const c = window.__carte(q); return !!c && c.hasAttribute('mjs-wake'); };
  window.__vus = {};
  window.__ecoute = (q) => {
    const vus = window.__vus[q] = [];
    ['pointerover', 'pointerdown', 'touchstart', 'focusin', 'mousedown', 'click', 'keydown', 'submit'].forEach((t) => racine(window.__carte(q)).addEventListener(t, (e) => { vus.push(t + (e.defaultPrevented ? '!' : '')); if (t === 'submit') e.preventDefault(); }));
  };
  // l'élément qui a le focus, au fond des racines d'ombre : la carte qui le contient et sa classe
  window.__focus = () => {
    let a = document.activeElement, q = null;
    while (a) {
      const r = racine(a);
      if (a.localName === 'mjs-ri-carte' && r) q = (r.textContent.match(/Carte (\\w+) /) || [])[1] || null;
      if (!r || !r.activeElement) break;
      a = r.activeElement;
    }
    return [q, a ? a.className || a.localName : null];
  };
  // des gestes dans la même tâche que le signe d'intention, donc avant la fin du réveil : le pointeur entre, un clic sur le bouton, la case,
  // une touche que le composant refuserait, Entrée qu'il annulerait, l'envoi du formulaire
  window.__gestes = (q) => {
    const r = racine(window.__carte(q)), en = (sel) => r.querySelector(sel);
    window.__ecoute(q);
    en('.plus').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, composed: true }));
    en('.plus').click();
    en('.x').click();
    en('.k').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true, cancelable: true }));
    en('.u').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true }));
    en('.f').requestSubmit();
    return [window.__vus[q].slice(), en('.x').checked, r.querySelector('.c').textContent.trim()];
  };
})()`

type Construit = { pages: Record<string, string>; fichiers: Record<string, Map<string, Buffer>> }
let construit: Promise<Construit> | null = null

function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('reveil-intention')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const pages: Record<string, string> = {}
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'rendu'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    try {
      for (const mode of ['replace', 'markers', 'positional', 'diff']) {
        const r = await renderer.renderToString('mjs-ri-page', { ssrMode: mode } as any)
        pages[mode] = r.html + '\n' + (r.hydrateScript || '')
      }
      const r = await renderer.renderToString('mjs-ri-page-r', { ssrMode: 'markers' } as any)
      pages['markers-r'] = r.html + '\n' + (r.hydrateScript || '')
      const b = await renderer.renderToString('mjs-ri-page-b', { ssrMode: 'markers' } as any)
      pages['markers-b'] = b.html + '\n' + (b.hydrateScript || '')
    }
    finally {
      await renderer.close()
    }
    // la page réactive rendue par le serveur construit sur l'autre version de sa racine (cf. RACINE_DU_SERVEUR)
    const srcServeur = join(root, 'src-serveur')
    mkdirSync(srcServeur, { recursive: true })
    writeFileSync(join(srcServeur, 'ri-carte.mjs'), SOURCES['ri-carte.mjs'])
    writeFileSync(join(srcServeur, 'ri-page-r.mjs'), RACINE_DU_SERVEUR)
    const serveur = await createSSRRenderer({ sourceDir: srcServeur, outputDir: join(root, 'rendu-serveur'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    try {
      const r = await serveur.renderToString('mjs-ri-page-r', { ssrMode: 'markers' } as any)
      pages['markers-s'] = r.html + '\n' + (r.hydrateScript || '')
    }
    finally {
      await serveur.close()
    }
    // la page figée au build, telle que `mjs build` l'écrit (le bloc `render` du projet)
    const config: any = { sourceDir: srcDir, outputDir: join(root, 'fige'), render: { default: 'prerender', outDir: join(root, 'pages'), routes: { '/': { component: 'mjs-ri-page' } } } }
    const rapport = await prerenderPages(config, root)
    assert.deepEqual(rapport.skipped, [], 'la page est prérendue')
    pages.prerender = readFileSync(join(root, 'pages', 'index.html'), 'utf-8')
    for (const mode of [...MODES, 'markers-r', 'markers-b', 'markers-s']) assert.match(pages[mode], /<mjs-ri-carte\b[^>]*\bmjs-wake="interaction"/, `le serveur écrit l'attribut du réveil (${mode})`)
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
    return { pages, fichiers }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const env of ENVS) playTogether(describe(`le réveil à l'intention : ${nom}, ${env}`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let fait: Construit

  before(async function () {
    this.timeout(180000)
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    fait    = await construire()
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // `code` : une promesse qui retient le code de la page (bundle.js) jusqu'à sa résolution, la page du serveur seule affichée (le témoin)
  async function ouvrir(corps: string, attendre = 'tot', code?: Promise<void>) {
    const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    const page    = await browser.newPage({ viewport: { width: 1000, height: 700 }, hasTouch: true })
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
    await page.addInitScript(SONDE)
    await page.route('http://intention.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/out/')) { await route.fulfill({ status: 200, contentType: 'text/html', body: contenu }); return }
      const fichier = fait.fichiers[env].get(url.pathname.slice(5))
      if (!fichier) { await route.fulfill({ status: 404, body: '' }); return }
      if (code && url.pathname === '/out/bundle.js') await code
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: fichier })
    })
    if (code) {
      await page.goto('http://intention.test/page', { waitUntil: 'commit' })
      await page.waitForFunction(`!!window.__carte(${JSON.stringify(attendre)})`, null, { timeout: 15000 })
      return { page, erreurs }
    }
    await page.goto('http://intention.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`!!customElements.get('mjs-ri-carte') && window.__ordre.includes(${JSON.stringify(attendre)})`, null, { timeout: 15000 })
    await page.waitForTimeout(600)
    return { page, erreurs }
  }

  // le centre d'un élément de la carte `q`
  async function centre(page: any, q: string, sel: string): Promise<{ x: number; y: number }> {
    return page.evaluate(`(() => { const z = window.__dans(${JSON.stringify(q)}, ${JSON.stringify(sel)}).getBoundingClientRect(); return { x: z.x + z.width / 2, y: z.y + z.height / 2 } })()`)
  }

  async function attendent(page: any, quoi: string[]): Promise<boolean> {
    return page.evaluate(`${JSON.stringify(quoi)}.every((q) => window.__attend(q))`)
  }

  it('markers : la carte attend, à l\'écran, le premier signe d\'intention (pointeur, focus, doigt) ; aucun geste n\'est pris, le même effet que sur la page qui démarre', async function () {
    if (!present) { this.skip(); return }
    const mode = 'markers'
    // le témoin : la même page sans @wake, les mêmes gestes dans sa page du serveur avant l'arrivée du code, puis son démarrage
    const sans = fait.pages[mode].replace(/ mjs-wake="interaction"/g, '')
    assert.ok(!sans.includes('mjs-wake'), `le témoin n'a pas de @wake (${mode})`)
    let lacher = () => {}
    const code = new Promise<void>((r) => { lacher = r })
    const temoin = await ouvrir(sans, 'd', code)
    let attendu: any, demarre: any
    try {
      attendu = await temoin.page.evaluate(`window.__gestes('d')`)
      lacher()
      await temoin.page.waitForFunction(`window.__ordre.includes('d')`, null, { timeout: 15000 })
      await temoin.page.waitForTimeout(200)
      demarre = await temoin.page.evaluate(`[window.__texte('d'), window.__dans('d', '.x').checked]`)
      assert.deepEqual(temoin.erreurs, [], `aucune erreur dans le témoin (${mode})`)
    }
    finally {
      lacher()
      await temoin.page.close()
    }
    assert.deepEqual(attendu, [['pointerover', 'click', 'click', 'keydown', 'keydown', 'submit'], true, 'Carte d 0 s0'], `le témoin : rien n'est annulé, la case se coche (${mode})`)
    assert.equal(demarre[0], 'Carte d 0 s0', `le témoin : rien n'est rejoué au démarrage (${mode})`)
    const { page, erreurs } = await ouvrir(fait.pages[mode])
    const ev = (s: string) => page.evaluate(s)
    try {
      // au démarrage, la page à l'écran et le navigateur au repos : seule la carte sans @wake est réveillée
      assert.deepEqual(await ev('window.__ordre.slice()'), ['tot'], `cartes réveillées au démarrage (${mode})`)
      assert.ok(await attendent(page, ['a', 'b', 'c', 'd', 'loin']), `les cartes attendent un signe d'intention (${mode})`)
      // le pointeur entre dans la carte a, sans clic : elle se réveille, rien n'est annulé ; un clic ensuite compte
      await ev(`window.__ecoute('a')`)
      const pa = await centre(page, 'a', '.c')
      await page.mouse.move(pa.x, pa.y)
      await page.waitForFunction(`window.__ordre.includes('a')`, null, { timeout: 5000 })
      assert.ok((await ev(`window.__vus.a`)).includes('pointerover'), `le pointeur est passé sans être annulé (${mode})`)
      assert.ok(!(await ev(`window.__vus.a`)).some((t: string) => t.endsWith('!')), `aucun signe d'intention annulé (${mode})`)
      assert.ok(await attendent(page, ['b', 'c', 'd', 'loin']), `les autres cartes attendent toujours (${mode})`)
      const pp = await centre(page, 'a', '.plus')
      await page.mouse.click(pp.x, pp.y)
      await page.waitForFunction(`window.__texte('a') === 'Carte a 1 s0'`, null, { timeout: 5000 })
      // le focus clavier sur un champ de la carte b la réveille
      await ev(`window.__ecoute('b'); window.__dans('b', '.u').focus()`)
      await page.waitForFunction(`window.__ordre.includes('b')`, null, { timeout: 5000 })
      assert.deepEqual(await ev(`window.__vus.b`), ['focusin'], `le focus est passé sans être annulé (${mode})`)
      assert.ok(await attendent(page, ['c', 'd', 'loin']), `les autres cartes attendent toujours (${mode})`)
      // un doigt posé sur la carte c la réveille
      await ev(`window.__ecoute('c')`)
      const pc = await centre(page, 'c', '.c')
      await page.touchscreen.tap(pc.x, pc.y)
      await page.waitForFunction(`window.__ordre.includes('c')`, null, { timeout: 5000 })
      assert.ok((await ev(`window.__vus.c`)).includes('touchstart') && !(await ev(`window.__vus.c`)).some((t: string) => t.endsWith('!')), `le doigt est passé sans être annulé (${mode}) : ${JSON.stringify(await ev('window.__vus.c'))}`)
      assert.ok(await attendent(page, ['d', 'loin']), `les autres cartes attendent toujours (${mode})`)
      // des gestes avant la fin du réveil de la carte d : le même effet que dans le témoin, puis le réveil, rien n'est rejoué
      assert.deepEqual(await ev(`window.__gestes('d')`), attendu, `geste par geste, le même effet que sur la page qui démarre (${mode})`)
      await page.waitForFunction(`window.__ordre.includes('d')`, null, { timeout: 5000 })
      await page.waitForTimeout(200)
      assert.deepEqual(await ev(`[window.__texte('d'), window.__dans('d', '.x').checked]`), demarre, `au réveil, rien n'est rejoué et la case connaît le sort qu'elle a au démarrage du témoin (${mode})`)
      // réveillée, la carte répond comme sans @wake : le clic compte, Entrée est annulée, la touche refusée n'est pas écrite
      await ev(`window.__vus.d.length = 0`)
      const pd = await centre(page, 'd', '.plus')
      await page.mouse.click(pd.x, pd.y)
      const pu = await centre(page, 'd', '.u')
      await page.mouse.click(pu.x, pu.y)
      await page.keyboard.press('Enter')
      const pk = await centre(page, 'd', '.k')
      await page.mouse.click(pk.x, pk.y)
      await page.keyboard.type('z')
      await page.waitForTimeout(300)
      assert.equal(await ev(`window.__texte('d')`), 'Carte d 1 s0', `réveillée : le clic compte, Entrée annulée n'envoie rien (${mode})`)
      assert.equal(await ev(`window.__dans('d', '.k').value`), '', `réveillée : la touche refusée n'est pas écrite (${mode})`)
      // paraître ne réveille pas : la carte du bas, amenée à l'écran loin du pointeur, attend ; le pointeur qui y entre la réveille
      await page.mouse.move(990, 10)
      await ev(`window.__carte('loin').scrollIntoView()`)
      await page.waitForTimeout(400)
      assert.ok(await attendent(page, ['loin']), `la carte du bas, à l'écran, attend toujours (${mode})`)
      const pl = await centre(page, 'loin', '.c')
      await page.mouse.move(pl.x, pl.y)
      await page.waitForFunction(`window.__ordre.includes('loin')`, null, { timeout: 5000 })
      assert.deepEqual(erreurs, [], `aucune erreur dans la page (${mode})`)
    }
    finally {
      await page.close()
    }
  })

  // au clavier : Tab jusqu'au champ de la carte a, la frappe, puis, la carte réveillée (ou la page démarrée), la frappe et Entrée. Le nœud du
  // champ, marqué dans la page du serveur, doit rester celui de la vue : rebâti, il emporterait le focus et la saisie. `temoin` : la même page
  // sans @wake, son code retenu jusqu'après la première frappe, le démarrage à la place du réveil ; `tard` : la page avec @wake, son code
  // retenu de même, le déclencheur posé quand le focus est déjà dans la carte (aucun focus ne suit, il réveille la carte)
  for (const [cle, quelle] of [['markers', 'sans valeur qui bouge'], ['markers-r', 'réactive']] as const) for (const [temoin, tard] of [[false, false], [true, false], [false, true]]) {
    const retenu = temoin || tard
    it(`markers, page ${quelle}${temoin ? ', témoin sans @wake' : ''}${tard ? ', code arrivé après le premier Tab' : ''} : Tab jusqu'au champ d'une carte ${temoin ? 'au code pas encore arrivé' : 'qui attend'}, la frappe, Entrée — le focus et la saisie restent ${temoin ? 'au démarrage' : 'au réveil'}`, async function () {
      if (!present) { this.skip(); return }
      const corps = temoin ? fait.pages[cle].replace(/ mjs-wake="interaction"/g, '') : fait.pages[cle]
      assert.ok(corps.includes('mjs-wake="interaction"') !== temoin, `la page porte le réveil à l'intention, le témoin non (${cle})`)
      let lacher = () => {}
      const code = retenu ? new Promise<void>((r) => { lacher = r }) : undefined
      const { page, erreurs } = await ouvrir(corps, retenu ? 'a' : 'tot', code)
      const ev = (s: string) => page.evaluate(s)
      try {
        if (!temoin) assert.ok(await attendent(page, ['a']), `la carte a attend avant le premier Tab (${cle})`)
        await ev(`window.__dans('a', '.u').__serveur = 1`)
        await page.keyboard.press('Tab')
        await page.keyboard.type('zz')
        assert.deepEqual(await ev('window.__focus()'), ['a', 'u'], `le premier Tab mène au champ de la carte a (${cle})`)
        lacher()
        await page.waitForFunction(`window.__ordre.includes('a')`, null, { timeout: 15000 })
        await page.waitForTimeout(300)
        assert.ok(await ev(`window.__dans('a', '.u').__serveur === 1`), `la vue a repris le champ de la page du serveur, sans le rebâtir (${cle})`)
        assert.deepEqual(await ev('window.__focus()'), ['a', 'u'], `le champ garde le focus (${cle})`)
        await ev(`window.__ecoute('a')`)
        await page.keyboard.type('y')
        await page.keyboard.press('Enter')
        await page.waitForTimeout(200)
        assert.deepEqual(await ev(`[window.__dans('a', '.u').value, window.__texte('a'), window.__vus.a]`), ['zzy', 'Carte a 0 s0', ['keydown', 'keydown!']], `la saisie reste, la frappe suit, Entrée passe par la carte, qui l'annule (${cle})`)
        assert.deepEqual(await ev('window.__focus()'), ['a', 'u'], `le focus reste après Entrée (${cle})`)
        assert.deepEqual(erreurs, [], `aucune erreur dans la page (${cle})`)
      }
      finally {
        lacher()
        await page.close()
      }
    })
  }

  // une carte qui attend dans une boîte qui attend : le premier Tab mène au champ de la carte, son focus réveille la boîte, qui pose le
  // déclencheur de la carte quand le focus y est déjà ; la carte se réveille à son tour, la vue reprend le champ de la page du serveur, le
  // focus et la saisie restent, la frappe et Entrée passent par la carte (la page du serveur n'envoie pas son formulaire)
  it('markers, carte qui attend dans un composant qui attend : Tab jusqu\'au champ de la carte, la frappe, Entrée — les deux se réveillent, le focus, la saisie et Entrée restent dans la carte', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvrir(fait.pages['markers-b'])
    const ev = (s: string) => page.evaluate(s)
    try {
      assert.ok(await ev(`window.__boiteAttend() && window.__attend('n')`), 'la boîte et sa carte attendent avant le premier Tab')
      await ev(`window.__reste = 1; window.__dans('n', '.u').__serveur = 1`)
      await page.keyboard.press('Tab')
      await page.keyboard.type('zz')
      assert.deepEqual(await ev('window.__focus()'), ['n', 'u'], 'le premier Tab mène au champ de la carte, dans la boîte')
      await page.waitForFunction(`window.__ordre.includes('boite')`, null, { timeout: 5000 })
      const reveillee = await page.waitForFunction(`window.__ordre.includes('n')`, null, { timeout: 5000 }).then(() => true, () => false)
      assert.ok(reveillee, 'la carte atteinte au clavier se réveille après la boîte')
      await page.waitForTimeout(300)
      assert.ok(await ev(`window.__dans('n', '.u').__serveur === 1`), 'la vue a repris le champ de la page du serveur, sans le rebâtir')
      assert.deepEqual(await ev('window.__focus()'), ['n', 'u'], 'le champ garde le focus')
      await ev(`window.__ecoute('n')`)
      await page.keyboard.type('y')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      assert.deepEqual(await ev(`[window.__reste === 1, location.search, (window.__dans('n', '.u') || {}).value, window.__texte('n'), window.__vus.n]`), [true, '', 'zzy', 'Carte n 0 s0', ['keydown', 'keydown!']], 'la page reste, la saisie aussi, la frappe suit, Entrée passe par la carte, qui l\'annule')
      assert.deepEqual(await ev('window.__focus()'), ['n', 'u'], 'le focus reste après Entrée')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    }
    finally {
      await page.close()
    }
  })

  // la page du serveur ne répond pas au code du navigateur (le serveur construit sur une version de la racine sans repère) : la racine est
  // rebâtie au démarrage et recrée la carte, qui reçoit la page de celle du serveur et attend le premier signe d'intention ; Tab mène au
  // champ de cette page, la carte se réveille, sa vue rebâtie rend le focus et la saisie à son champ
  it('markers, racine rebâtie au démarrage : la carte recréée attend le signe d\'intention ; Tab jusqu\'à son champ, la frappe, Entrée — le focus et la saisie restent au réveil', async function () {
    if (!present) { this.skip(); return }
    let lacher = () => {}
    const code = new Promise<void>((r) => { lacher = r })
    const { page, erreurs } = await ouvrir(fait.pages['markers-s'], 'a', code)
    const ev = (s: string) => page.evaluate(s)
    try {
      await ev(`window.__carte('a').__serveur = 1`)
      lacher()
      await page.waitForFunction(`!!customElements.get('mjs-ri-carte') && window.__ordre.includes('tot')`, null, { timeout: 15000 })
      await page.waitForTimeout(600)
      assert.ok(await ev(`!window.__carte('a').__serveur`), 'la racine rebâtie a recréé la carte')
      assert.deepEqual(await ev('window.__ordre.slice()'), ['tot'], 'la carte recréée, à l\'écran, attend le signe d\'intention')
      assert.ok(await attendent(page, ['a']), 'la carte recréée attend')
      await ev(`window.__reste = 1`)
      await page.keyboard.press('Tab')
      await page.keyboard.type('zz')
      await page.waitForFunction(`window.__ordre.includes('a')`, null, { timeout: 5000 })
      await page.waitForTimeout(300)
      assert.deepEqual(await ev('window.__focus()'), ['a', 'u'], 'le premier Tab mène au champ de la carte')
      await ev(`window.__ecoute('a')`)
      await page.keyboard.type('y')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      assert.deepEqual(await ev(`[window.__reste === 1, location.search, (window.__dans('a', '.u') || {}).value, window.__texte('a'), window.__vus.a]`), [true, '', 'zzy', 'Carte a 0 s0', ['keydown', 'keydown!']], 'la page reste, la saisie aussi, Entrée passe par la carte, qui l\'annule')
      assert.deepEqual(await ev('window.__focus()'), ['a', 'u'], 'le focus reste après Entrée')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    }
    finally {
      lacher()
      await page.close()
    }
  })

  // la page de chaque mode, telle que le serveur l'écrit : la vue de la racine, quand elle est rebâtie, recrée les cartes avec la valeur
  // compilée (une page dérivée en remplaçant le texte de l'attribut n'y vaudrait rien)
  for (const mode of COMME_VIEW) it(`${mode} : interaction se réveille comme view — à l'écran au démarrage, la carte du bas quand elle paraît`, async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvrir(fait.pages[mode])
    try {
      await page.mouse.move(990, 10)
      assert.deepEqual([...await page.evaluate('window.__ordre.slice()')].sort(), ['a', 'b', 'c', 'd', 'tot'], `les cartes de l'écran réveillées au démarrage, sans signe d'intention (${mode})`)
      assert.ok(await attendent(page, ['loin']), `la carte du bas attend (${mode})`)
      await page.evaluate(`window.__carte('loin').scrollIntoView()`)
      await page.waitForFunction(`window.__ordre.includes('loin')`, null, { timeout: 5000 })
      assert.deepEqual(erreurs, [], `aucune erreur dans la page (${mode})`)
    }
    finally {
      await page.close()
    }
  })

  // la page en ssr (rendue sans bloc `render`) et la page figée au build : la vue remplace au réveil la page du serveur, ce que
  // l'utilisateur y a fait passe à la vue ; les cartes attendent, même à l'écran, le premier signe d'intention
  for (const mode of ['replace', 'prerender'] as const) it(`${mode} : interaction attend le signe d'intention, même à l'écran ; le focus clavier réveille la carte, qui le garde`, async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvrir(fait.pages[mode])
    const ev = (s: string) => page.evaluate(s)
    try {
      await page.mouse.move(990, 10)
      assert.deepEqual(await ev('window.__ordre.slice()'), ['tot'], `seule la carte sans @wake est réveillée au démarrage (${mode})`)
      assert.ok(await attendent(page, ['a', 'b', 'c', 'd', 'loin']), `les cartes attendent un signe d'intention (${mode})`)
      await ev(`window.__dans('b', '.u').focus()`)
      await page.keyboard.type('zz')
      await page.waitForFunction(`window.__ordre.includes('b')`, null, { timeout: 5000 })
      await page.waitForTimeout(300)
      await page.keyboard.type('y')
      await page.waitForTimeout(100)
      assert.deepEqual([await ev('window.__focus()'), await ev(`window.__dans('b', '.u').value`)], [['b', 'u'], 'zzy'], `le champ garde le focus et la saisie, la frappe suit (${mode})`)
      assert.ok(await attendent(page, ['a', 'c', 'd', 'loin']), `les autres cartes attendent toujours (${mode})`)
      assert.deepEqual(erreurs, [], `aucune erreur dans la page (${mode})`)
    }
    finally {
      await page.close()
    }
  })

  it('sans rendu serveur, l\'option ne change rien : toutes les cartes se construisent tout de suite', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvrir('<mjs-ri-page></mjs-ri-page>', 'loin')
    try {
      assert.deepEqual([...await page.evaluate('window.__ordre.slice()')].sort(), ['a', 'b', 'c', 'd', 'loin', 'tot'])
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    }
    finally {
      await page.close()
    }
  })
}))
