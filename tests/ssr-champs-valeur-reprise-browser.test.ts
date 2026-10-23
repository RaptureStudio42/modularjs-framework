// Page rendue par le serveur puis reprise dans un navigateur réel : les champs de formulaire sont déjà à leur valeur dans la page que le
// navigateur affiche AVANT le démarrage du JavaScript, et la reprise ne les bouge plus. Avant, un curseur lié à une variable sortait avec
// `value=""` : il s'affichait au milieu de sa course, puis sautait à sa place au démarrage (et Chromium avertissait d'une couleur sans
// valeur au bon format). Un relevé de chaque champ est pris entre la page du serveur et le bundle (la photo), puis une fois la page
// démarrée : les deux sont identiques, et le formulaire envoie les mêmes valeurs. Le mot de passe, lui, n'est jamais écrit par le serveur.
// Les quatre modes de reprise (`ssrMode` : replace, markers, positional, diff), la page venue du moteur happy-dom comme du moteur navigateur.

import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { ecrireChamps, ETAT } from './helpers/champs-prerendu.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'

const MODES = ['replace', 'markers', 'positional', 'diff'] as const

type Rendu     = { html: string; hydrateScript: string }
type Construit = { rendus: Record<string, Rendu>; fichiers: Map<string, Buffer> }

// l'état de chaque champ par sa classe, lu dans toutes les racines d'ombre (celle du serveur, puis celle que le framework tient en `_shadow`),
// et ce que le formulaire enverrait
const RELEVE = `(() => {
  const out = {}
  const visiter = (racine) => {
    for (const el of racine.querySelectorAll('input, select, textarea')) {
      if (el.className) out[el.className] = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value
    }
    for (const hote of racine.querySelectorAll('*')) {
      const ombre = hote._shadow || hote.shadowRoot
      if (ombre && ombre !== hote) visiter(ombre)
    }
  }
  visiter(document)
  const racine = document.querySelector('mjs-champs-tous')
  const ombre  = racine && (racine._shadow || racine.shadowRoot)
  const form   = ombre && ombre.querySelector('form.f')
  out.__form = form ? Array.from(new FormData(form)).map((p) => p[0] + '=' + p[1]).filter((p) => !p.startsWith('secret=')) : null
  return out
})()`

// ce que la page du serveur montre avant le démarrage : l'état de départ de chaque champ (le mot de passe n'est pas écrit)
const PHOTO = {
  lum:       ETAT.luminosite,
  lum2:      ETAT.luminosite,
  teinte:    ETAT.teinte,
  nom:       ETAT.nom,
  actif:     true,
  inactif:   false,
  free:      false,
  pro:       true,
  imperatif: true,
  langue:    ETAT.langue,
  note:      ETAT.note,
  suite:     ETAT.suite,
  retour:    '\nretour',
  cr:        '\ncr',
  secret:    '',
  libre:     '5',
  noir:      '#000000',
  seul:      'a',
  ri:        ETAT.luminosite,
  rp:        ETAT.luminosite
}

let construit: Promise<Construit> | null = null

// les pages du serveur dans chaque mode, pour les deux moteurs, et le build du navigateur : une seule fois pour tous les navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('champs-reprise')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    ecrireChamps(srcDir)
    const rendus: Record<string, Rendu> = {}
    const renderer = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    for (const mode of MODES) {
      const r = await renderer.renderToString('mjs-champs-tous', { ssrMode: mode } as any)
      rendus['happy-dom/' + mode] = { html: r.html, hydrateScript: r.hydrateScript }
    }
    await renderer.close()
    const playwright = await import('playwright')
    if (existsSync(playwright.chromium.executablePath())) {
      const nav = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out-navigateur' } as any, { configDir: root })
      try {
        for (const mode of MODES) {
          const p = await nav.renderPage('mjs-champs-tous', { ssrMode: mode } as any)
          rendus['navigateur/' + mode] = { html: p.html, hydrateScript: p.hydrateScript }
        }
      } finally {
        await nav.close()
      }
    }
    const dossier = join(root, 'out-dev')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'split', env: 'dev' } as any)
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

for (const nom of ['chromium', 'firefox'] as const) describe(`champs de formulaire d'une page préparée : reprise dans ${nom}`, function () {
  this.timeout(180000)
  let browser: any
  let present = false
  let fait: Construit

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) { this.skip(); return }
    fait    = await construire()
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const moteur of ['happy-dom', 'navigateur']) for (const mode of MODES) describe(`page du moteur ${moteur}, reprise « ${mode} »`, function () {
    let page: any
    let photo: any
    let apres: any
    let hydrate: boolean
    const alertes: string[] = []

    before(async function () {
      const rendu = fait && fait.rendus[moteur + '/' + mode]
      if (!rendu) { this.skip(); return }
      const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${rendu.html}\n${rendu.hydrateScript}\n<script>window.__photo = ${RELEVE}</script>\n<script type="module" src="/out/bundle.js"></script></body></html>`
      page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
      await page.addInitScript('window.__name = (f) => f')
      page.on('pageerror', (e: any) => alertes.push('erreur : ' + String(e.message).slice(0, 300)))
      // Firefox signale tout champ mot de passe d'une page servie en http : la page de test l'est, l'avertissement ne dit rien de la reprise
      page.on('console', (m: any) => { if ((m.type() === 'error' || m.type() === 'warning') && !/Password fields present on an insecure/.test(m.text())) alertes.push(m.type() + ' : ' + m.text().slice(0, 300)) })
      await page.route('http://champs.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith('/out/')) {
          const corps = fait.fichiers.get(url.pathname.slice(5))
          if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
          await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
          return
        }
        await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
      })
      await page.goto('http://champs.test/page', { waitUntil: 'load' })
      await page.waitForFunction(`(() => {
        const h = document.querySelector('mjs-champs-tous')
        const i = h && h._shadow && h._shadow.querySelector('mjs-champ-interne')
        const p = i && i._shadow && i._shadow.querySelector('mjs-champ-profond')
        return !!(h && i && p && h._mjs_is_mounted && i._mjs_is_mounted && p._mjs_is_mounted)
      })()`, { timeout: 60000 })
      await page.waitForTimeout(400)
      photo   = await page.evaluate('window.__photo')
      apres   = await page.evaluate(RELEVE)
      hydrate = await page.evaluate(`document.querySelector('mjs-champs-tous')._mjs_hydrated === true`)
    })

    after(async () => { if (page) await page.close() })

    it('la page du serveur montre déjà chaque champ à sa valeur, avant le démarrage du JavaScript', function () {
      const { __form, ...champs } = photo
      assert.deepEqual(champs, PHOTO, 'curseurs, couleur, texte, cases, radios, liste, zones de texte, sous-composants : à leur valeur dès la photo')
      assert.ok(Array.isArray(__form) && __form.length > 0, 'et le formulaire de la photo envoie ces valeurs')
    })

    it('aucun champ ne bouge au démarrage : la page démarrée dit la même chose que la photo, et le formulaire envoie les mêmes valeurs', function () {
      const { __form: formPhoto, secret: secretPhoto, ...champsPhoto } = photo
      const { __form: formApres, secret: secretApres, ...champsApres } = apres
      assert.deepEqual(champsApres, champsPhoto, 'chaque champ a, après le démarrage, la valeur qu\'il montrait avant')
      assert.deepEqual(formApres, formPhoto, 'le formulaire envoie les mêmes valeurs')
      assert.equal(secretPhoto, '', 'le serveur n\'a pas écrit le mot de passe')
      assert.equal(secretApres, ETAT.secret, 'la page démarrée le retrouve dans son état')
    })

    it('la reprise est celle du mode demandé, et la page ne signale rien (ni erreur, ni avertissement)', function () {
      assert.equal(hydrate, mode !== 'replace', 'le composant a adopté la page du serveur, sauf en « replace »')
      assert.deepEqual(alertes, [], 'aucune erreur ni avertissement dans la console de la page')
    })
  })
})
