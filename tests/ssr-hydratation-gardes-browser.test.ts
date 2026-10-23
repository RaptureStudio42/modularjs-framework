// Page rendue par le serveur puis reprise dans un navigateur réel : les gardes de la reprise qui ne servent que dans un cas
// précis, chacune jouée avec le HTML du serveur retouché pour fabriquer ce cas.
// - `<link>` d'un gabarit (hors feuille partagée du serveur) : repris comme tout élément, un seul exemplaire (positional, diff)
// - champ caché en trop dans un élément d'un composant ordinaire (pas dans la balise d'un module du cœur) : retiré avec les nœuds en trop (positional, diff)
// - deux ancres d'un bloc dans l'ordre inverse, ou une ancre sans sa jumelle : la vue est reconstruite, sans exception, même
//   rattrapée par le cœur (`markers`)
// Le cœur rattrape les exceptions de la reprise et reconstruit : la vue finale ne montrerait pas qu'une garde a manqué, d'où
// l'espion posé sur les méthodes du DOM qui note toute exception, rattrapée ou non.
// En développement et en production (vrai build, un morceau par module), dans Chromium et Firefox.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const ENVS = ['dev', 'prod'] as const

const LIEN = `<script>
  $a = 'a'
  @pose = (v) -> $a = v
</script>

<link rel="stylesheet" href="/autre.css">
<p class="p">Bonjour {$a}!</p>
<p class="fin">fin</p>
`

const CHAMP = `<script>
  $a = 'a'
  @pose = (v) -> $a = v
</script>

<div class="w"><p class="p">Bonjour {$a}!</p></div>
<p class="fin">fin</p>
`

const BLOCS = `<script>
  $items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }]
  $on = true
  @liste = (l) -> $items = l
  @bascule = (v) -> $on = v
</script>

<p class="t">titre</p>
<ul class="u">{for it in $items by id}<li class="y">{it.t}</li>{end}</ul>
{if $on}<p class="x">oui</p>{end}
<p class="fin">fin</p>
`

// ce que le scénario lit dans la page (`voir`, qui attend la valeur) et écrit dans l'état du composant (`ecrire`)
type Contexte = {
  voir:   (js: string, attendu: any, quand: string) => Promise<void>
  ecrire: (js: string) => Promise<void>
}

type Scenario = {
  nom:      string
  tag:      string
  mode:     'markers' | 'positional' | 'diff'
  // le HTML du serveur, retouché pour fabriquer le cas
  retouche: (html: string) => string
  verifier: (c: Contexte) => Promise<void>
}

// les deux ancres de chaque bloc, échangées : la fin vient avant le début
const inverser = (html: string) => html.replace(/<!--mjs-e:([se])-/g, (_m, c) => '<!--mjs-e:' + (c === 's' ? 'e' : 's') + '-')
// l'ancre de fin de chaque bloc disparaît
const sansFin  = (html: string) => html.replace(/<!--mjs-e:e-[^>]*-->/g, '')

const VUE_BLOCS = `(() => { const r = document.querySelector('mjs-ga-blocs')._shadow; return 'y=' + Array.from(r.querySelectorAll('.y')).map((e) => e.textContent).join('') + ' x=' + r.querySelectorAll('.x').length + ' t=' + r.querySelectorAll('.t').length + ' fin=' + r.querySelectorAll('.fin').length })()`
const BLOCS_EL  = `document.querySelector('mjs-ga-blocs')`

// une reprise qui reconstruit : la vue rejoue chaque écriture de l'état, sans exception du DOM
const reconstruit = async (c: Contexte) => {
  await c.voir(VUE_BLOCS, 'y=ab x=1 t=1 fin=1', 'la vue de départ')
  await c.ecrire(`${BLOCS_EL}.liste([{ id: 2, t: 'b' }, { id: 3, t: 'c' }, { id: 1, t: 'a' }])`)
  await c.voir(VUE_BLOCS, 'y=bca x=1 t=1 fin=1', 'liste changée')
  await c.ecrire(`${BLOCS_EL}.bascule(false)`)
  await c.voir(VUE_BLOCS, 'y=bca x=0 t=1 fin=1', 'bloc fermé')
  await c.ecrire(`${BLOCS_EL}.liste([])`)
  await c.voir(VUE_BLOCS, 'y= x=0 t=1 fin=1', 'liste vidée')
  await c.ecrire(`${BLOCS_EL}.bascule(true)`)
  await c.voir(VUE_BLOCS, 'y= x=1 t=1 fin=1', 'bloc rouvert')
  await c.voir(`window.__erreursDom`, [], 'aucune exception du DOM, même rattrapée')
}

// un composant dont la reprise garde les nœuds du serveur : le résumé de ses nœuds repris, puis une écriture de l'état
const repris = (tag: string, resume: string, attendu: string, quoi: string) => async (c: Contexte) => {
  await c.voir(`(() => { const r = document.querySelector('mjs-${tag}')._shadow; return ${resume} })()`, attendu, quoi)
  await c.ecrire(`document.querySelector('mjs-${tag}').pose('Bob')`)
  await c.voir(`document.querySelector('mjs-${tag}')._shadow.querySelector('.p').textContent`, 'Bonjour Bob!', 'l\'écriture de l\'état arrive')
}

const SCENARIOS: Scenario[] = []

for (const mode of ['positional', 'diff'] as const) {
  SCENARIOS.push({
    nom: 'le <link> du gabarit est repris comme tout élément',
    tag: 'ga-lien',
    mode,
    retouche: (html) => html,
    verifier: repris('ga-lien', `r.querySelectorAll('link[href="/autre.css"]').length + ' ' + (r.querySelector('link[href="/autre.css"]').__srv === true) + ' ' + (r.querySelector('.p').__srv === true) + ' ' + (r.querySelector('.fin').__srv === true)`, '1 true true true', 'un seul <link>, celui du serveur, et les nœuds du serveur gardés')
  })
  SCENARIOS.push({
    nom: 'un champ caché en trop dans un composant ordinaire est retiré',
    tag: 'ga-champ',
    mode,
    retouche: (html) => html.replace('</div>', '<input type="hidden" name="x" value="1"></div>'),
    verifier: repris('ga-champ', `r.querySelectorAll('input').length + ' ' + (r.querySelector('.w').__srv === true) + ' ' + (r.querySelector('.p').__srv === true)`, '0 true true', 'le champ en trop est parti, les nœuds du serveur sont gardés')
  })
}

SCENARIOS.push({
  nom: 'témoin : des ancres en place, les blocs sont repris tels quels',
  tag: 'ga-blocs',
  mode: 'markers',
  retouche: (html) => html,
  verifier: async (c) => {
    await c.voir(`(() => { const r = ${BLOCS_EL}._shadow; return (r.querySelector('.t').__srv === true) + ' ' + (r.querySelector('.u').__srv === true) + ' ' + (r.querySelector('.fin').__srv === true) })()`, 'true true true', 'les nœuds du serveur hors des blocs sont gardés')
    await reconstruit(c)
  }
})
SCENARIOS.push({
  nom: 'les ancres d\'un bloc dans l\'ordre inverse : la vue est reconstruite',
  tag: 'ga-blocs',
  mode: 'markers',
  retouche: inverser,
  verifier: reconstruit
})
SCENARIOS.push({
  nom: 'une ancre de fin sans sa jumelle : la vue est reconstruite',
  tag: 'ga-blocs',
  mode: 'markers',
  retouche: sansFin,
  verifier: reconstruit
})

type Construit = { html: Record<string, string>; scripts: Record<string, string>; fichiers: Record<string, Map<string, Buffer>> }
let construit: Promise<Construit> | null = null

// un rendu par couple (composant, mode) et les deux builds, une seule fois pour les deux navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('gardes-hydratation')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'ga-lien.mjs'), LIEN)
    writeFileSync(join(srcDir, 'ga-champ.mjs'), CHAMP)
    writeFileSync(join(srcDir, 'ga-blocs.mjs'), BLOCS)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    const html: Record<string, string>    = {}
    const scripts: Record<string, string> = {}
    for (const s of SCENARIOS) {
      const cle = s.tag + '|' + s.mode
      if (html[cle]) continue
      const r = await renderer.renderToString('mjs-' + s.tag, { ssrMode: s.mode } as any)
      html[cle]    = r.html
      scripts[cle] = r.hydrateScript
    }
    await renderer.close()
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
    return { html, scripts, fichiers }
  })()
  return construit
}

// avant le bundle : chaque élément écrit par le serveur (dans toutes les racines d'ombre) porte un tampon, pour voir plus tard s'il a été repris
const TAMPON = `<script>(function () { function t(r) { r.querySelectorAll('*').forEach(function (n) { n.__srv = true; if (n.shadowRoot) t(n.shadowRoot) }) } document.querySelectorAll('*').forEach(function (h) { if (h.shadowRoot) t(h.shadowRoot) }) })()</script>`

// l'espion : toute exception d'une méthode du DOM qui change l'arbre est notée, qu'elle soit rattrapée ou non
const ESPION = `window.__erreursDom = []; ['removeChild', 'insertBefore', 'appendChild', 'replaceChild', 'compareDocumentPosition'].forEach(function (nom) { var orig = Node.prototype[nom]; Node.prototype[nom] = function () { try { return orig.apply(this, arguments) } catch (e) { window.__erreursDom.push(nom + ' : ' + String(e.message).slice(0, 120)); throw e } } })`

for (const nom of ['chromium', 'firefox'] as const) for (const env of ENVS) for (const s of SCENARIOS) describe(`gardes de la reprise : ${nom}, ${env}, ${s.mode}, ${s.nom}`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []

  const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

  // la valeur attendue : le navigateur la rejoint dans un délai court, sinon c'est un échec
  async function voir(js: string, attendu: any, quand: string) {
    let vu: any
    for (let i = 0; i < 80; i++) {
      try { vu = await page.evaluate(js) } catch (e: any) { vu = 'lecture impossible : ' + String(e.message).slice(0, 120) }
      if (JSON.stringify(vu) === JSON.stringify(attendu)) return
      await dormir(25)
    }
    assert.deepEqual(vu, attendu, `${s.tag} ${quand}`)
  }

  before(async function () {
    this.timeout(180000)
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const fait    = await construire()
      const cle     = s.tag + '|' + s.mode
      const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${s.retouche(fait.html[cle])}\n${fait.scripts[cle]}\n${TAMPON}\n<script type="module" src="/out/bundle.js"></script></body></html>`
      browser = await playwright[nom].launch()
      page    = await browser.newPage({ viewport: { width: 1000, height: 900 } })
      await page.addInitScript(`window.__name = (f) => f; ${ESPION}`)
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
      page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
      await page.route('http://gardes.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith('/out/')) {
          const corps = fait.fichiers[env].get(url.pathname.slice(5))
          if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
          await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
          return
        }
        if (url.pathname === '/autre.css') { await route.fulfill({ status: 200, contentType: 'text/css', body: '.p { color: red }' }); return }
        await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
      })
      await page.goto('http://gardes.test/page', { waitUntil: 'load' })
      await page.waitForFunction(`(() => { const h = document.querySelector('mjs-${s.tag}'); return h && h.matches(':defined') && !h.hasAttribute('mjs-loading') && h._shadow && h._shadow.firstElementChild })()`, { timeout: 60000 })
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('la page est reprise, puis chaque écriture de l\'état se retrouve dans le DOM', async function () {
    if (!present) { this.skip(); return }
    await s.verifier({ voir, ecrire: async (js) => { await page.evaluate(js) } })
  })

  it('aucune erreur dans la page', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
  })
})
