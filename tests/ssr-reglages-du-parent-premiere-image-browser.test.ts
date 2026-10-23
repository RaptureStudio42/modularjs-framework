// Page préparée par le serveur, reprise par un build `js: 'split'` (un fichier de code par composant) : un enfant prérendu reçoit de son
// parent des réglages que la page n'écrit pas. Le serveur rend l'enfant avec les réglages du parent, mais ne les pose pas sur la balise
// (`titre={$titre}` ne devient pas un attribut) : c'est le parent qui les donne à l'enfant, une fois démarré.
// Un enfant qui prendrait la main avant son parent s'afficherait d'abord avec ses réglages par défaut (le texte par défaut, la liste par
// défaut, les quatorze boutons de la barre), puis le parent le redessinerait avec les bons. Ici le fichier d'un composant est servi en
// retard (route Playwright) et la page est relevée image par image (`requestAnimationFrame`) : dès la première image où l'enfant se
// montre, ses réglages sont les bons, et aucune image ne montre les réglages par défaut ni ne lui retire son contenu.
// - un enfant maison, dont le parent règle un texte et une liste (fichier du parent en retard, puis fichier de l'enfant en retard) ;
// - la barre de l'éditeur du cœur, que l'éditeur restreint à deux outils : deux boutons d'emblée, pas quatorze puis deux ;
//   page rendue en « replace » (le défaut) et en « markers » (la reprise adopte les nœuds du serveur).
// En développement et en production (vrai build, un morceau par module), dans Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const MOTEURS = ['chromium', 'firefox', 'webkit'] as const
const ENVS    = ['dev', 'prod'] as const
const MODES   = ['replace', 'markers'] as const

type Env  = typeof ENVS[number]
type Mode = typeof MODES[number]

const MAISON: Record<string, string> = {
  'rg-enfant.mjs': `<script>
  $titre = 'TITRE-PAR-DEFAUT'
  $choix = ['DEFAUT-1', 'DEFAUT-2', 'DEFAUT-3']
</script>

<h4 class="t">{$titre}</h4>
<ul class="l">{for c in $choix by c}<li class="i">{c}</li>{end}</ul>
`,
  'rg-parent.mjs': `<script>
  $titre = 'TITRE-DU-PARENT'
  $choix = ['PARENT-A', 'PARENT-B']
</script>

<p class="p">parent</p>
<@rg-enfant titre={$titre} choix={$choix}></@rg-enfant>
`
}

const EDITEUR: Record<string, string> = {
  'hote.mjs': `<script>
  $texte = '<p>Un <b>mot</b></p>'
</script>

<form class="f" @noUJS>
  <@@editor class="e" name="contrat" toolbar="bold italic" value=!{$texte}></@@editor>
</form>
<pre class="o">{$texte}</pre>
`
}

// ce que la page montre à un instant, d'après l'enfant relevé : le texte et la liste que l'enfant affiche
const LIRE_MAISON = `
  const p  = document.querySelector('mjs-rg-parent'); const ps = p && (p._shadow || p.shadowRoot); if (!ps) return 'absent';
  const e  = ps.querySelector('mjs-rg-enfant');       const es = e && (e._shadow || e.shadowRoot); if (!es) return 'absent';
  const t  = es.querySelector('.t');
  return (t ? t.textContent.trim() : 'sans titre') + '|' + Array.from(es.querySelectorAll('.i')).map((l) => l.textContent.trim()).join(',');`

// le nombre de boutons de la barre de l'éditeur, de l'hôte jusqu'à la barre
const LIRE_BARRE = `
  const h  = document.querySelector('mjs-hote');          const hs = h && (h._shadow || h.shadowRoot); if (!hs) return 'absent';
  const e  = hs.querySelector('mjs-core-editor');         const es = e && (e._shadow || e.shadowRoot); if (!es) return 'absent';
  const t  = es.querySelector('mjs-core-toolbar');        const ts = t && (t._shadow || t.shadowRoot); if (!ts) return 'pas de barre';
  return ts.querySelectorAll('button').length + ' boutons';`

// posée AVANT tout script de la page : relève ce que la page montre à chaque image, et ne garde que les changements
const sonde = (lire: string): string => `(() => {
  const suite = window.__suite = [];
  const lire  = () => {${lire}};
  let dernier = null;
  const tick  = () => {
    const v = lire();
    if (v !== dernier) { dernier = v; suite.push([Math.round(performance.now()), v]) }
    if (!window.__fin) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`

type Hote = { html: string; fichiers: Map<string, Buffer> }

// la page rendue par le serveur et le build en fichiers séparés, pour un environnement (le serveur et le navigateur construits pareil)
async function batir(sources: Record<string, string>, racine: string, env: Env, mode: Mode): Promise<Hote> {
  const dossier = mjsTmp('reglages-parent')
  const srcDir  = join(dossier, 'src')
  const outDir  = join(dossier, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(srcDir, nom), source)
  const reprise  = mode === 'markers' ? { runtime: ['hydrate'] } : {}
  const renderer = await createSSRRenderer({ sourceDir: srcDir, env, ...(mode === 'markers' ? { bundlerOpts: reprise } : {}) } as any)
  let rendu: any
  try {
    rendu = await renderer.renderToString(racine, { ssrMode: mode } as any)
  }
  finally {
    await renderer.close()
  }
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js: 'split', env, ...reprise } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = new Map<string, Buffer>()
  for (const n of readdirSync(outDir)) if (/\.(js|json)$/.test(n)) fichiers.set(n, readFileSync(join(outDir, n)))
  assert.ok(fichiers.has('bundle.js'), 'le build écrit son manifeste')
  return { html: rendu.html + '\n' + (rendu.hydrateScript ?? ''), fichiers }
}

const faits = new Map<string, Promise<Hote>>()
function construire(sources: Record<string, string>, racine: string, env: Env, mode: Mode): Promise<Hote> {
  const cle = [racine, env, mode].join('/')
  if (!faits.has(cle)) faits.set(cle, batir(sources, racine, env, mode))
  return faits.get(cle)!
}

// les changements relevés après la première image où la page montre autre chose que « absent » (avant, rien n'est encore peint)
function depuisLaPremiere(suite: [number, string][]): string[] {
  const valeurs  = suite.map(([, v]) => v)
  const premiere = valeurs.findIndex((v) => v !== 'absent')
  return premiere < 0 ? ['jamais montré'] : valeurs.slice(premiere)
}

for (const nom of MOTEURS) for (const env of ENVS) describe(`l'enfant prérendu montre les réglages de son parent dès la première image : ${nom}, ${env}`, function () {
  this.timeout(240000)
  let present = false
  let browser: any

  before(async function () {
    this.timeout(240000)
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // ouvre la page, relève ce qu'elle montre à chaque image jusqu'à ce que `attendre` soit vrai (+ 500 ms), et rend les changements
  // `retards` : préfixe d'un fichier du build → millisecondes de retard du serveur
  async function suivre(hote: Hote, lire: string, retards: Record<string, number>, attendre: string): Promise<{ suite: [number, string][]; erreurs: string[] }> {
    const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${hote.html}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    const page    = await browser.newPage({ viewport: { width: 1000, height: 1000 } })
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
    try {
      await page.addInitScript(sonde(lire))
      await page.route('http://reglages.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (!url.pathname.startsWith('/out/')) { await route.fulfill({ status: 200, contentType: 'text/html', body: contenu }); return }
        const fichier = url.pathname.slice(5)
        const corps   = hote.fichiers.get(fichier)
        if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
        const retard = Object.entries(retards).find(([prefixe]) => fichier.startsWith(prefixe))?.[1] ?? 0
        if (retard) await new Promise((r) => setTimeout(r, retard))
        await route.fulfill({ status: 200, contentType: fichier.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
      })
      await page.goto('http://reglages.test/page', { waitUntil: 'commit' })
      await page.waitForFunction(attendre, null, { timeout: 30000 })
      await page.waitForTimeout(500)
      await page.evaluate('window.__fin = true')
      return { suite: await page.evaluate('window.__suite'), erreurs }
    }
    finally {
      await page.close()
    }
  }

  const MAISON_PRETE = `!!customElements.get('mjs-rg-parent') && !!customElements.get('mjs-rg-enfant')`
  const JUSTE        = 'TITRE-DU-PARENT|PARENT-A,PARENT-B'

  describe('un enfant maison, dont le parent règle un texte et une liste', function () {
    let hote: Hote

    before(async function () {
      if (!present) { this.skip(); return }
      hote = await construire(MAISON, 'mjs-rg-parent', env, 'replace')
      assert.match(hote.html, /<mjs-rg-enfant\b[^>]*\bmjs-ssr\b/, 'le serveur doit avoir rendu l\'enfant dans la page')
      assert.doesNotMatch(hote.html, /<mjs-rg-enfant\b[^>]*\b(titre|choix)=/, 'la page n\'écrit pas les réglages que le parent donne à son enfant')
    })

    it('le fichier du parent arrive en retard : le texte et la liste du parent à chaque image, jamais ceux par défaut', async function () {
      if (!present) { this.skip(); return }
      const { suite, erreurs } = await suivre(hote, LIRE_MAISON, { 'rg-parent-': 200 }, MAISON_PRETE)
      assert.deepEqual(depuisLaPremiere(suite), [JUSTE], `ce que l'enfant montre, image après image (ms, valeur) : ${JSON.stringify(suite)}`)
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    })

    it('le fichier de l\'enfant arrive en retard : le texte et la liste du parent à chaque image, l\'enfant ne manque à aucune', async function () {
      if (!present) { this.skip(); return }
      const { suite, erreurs } = await suivre(hote, LIRE_MAISON, { 'rg-enfant-': 200 }, MAISON_PRETE)
      assert.deepEqual(depuisLaPremiere(suite), [JUSTE], `ce que l'enfant montre, image après image (ms, valeur) : ${JSON.stringify(suite)}`)
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    })
  })

  for (const mode of MODES) describe(`la barre de l'éditeur, page rendue en « ${mode} »`, function () {
    let hote: Hote

    before(async function () {
      if (!present) { this.skip(); return }
      hote = await construire(EDITEUR, 'mjs-hote', env, mode)
      assert.match(hote.html, /<mjs-core-toolbar\b[^>]*\bmjs-ssr\b/, 'le serveur doit avoir rendu la barre dans la page')
    })

    it('le fichier de l\'éditeur arrive en retard : deux boutons à chaque image, jamais quatorze', async function () {
      if (!present) { this.skip(); return }
      const attendre = `!!customElements.get('mjs-core-editor') && !!customElements.get('mjs-core-toolbar')`
      const { suite, erreurs } = await suivre(hote, LIRE_BARRE, { 'core-editor': 120 }, attendre)
      assert.deepEqual(depuisLaPremiere(suite), ['2 boutons'], `les boutons de la barre, image après image (ms, valeur) : ${JSON.stringify(suite)}`)
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    })
  })
})
