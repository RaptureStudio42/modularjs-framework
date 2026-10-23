// Lien `@method` que le navigateur suivrait lui-même : avec Ctrl, Maj, Alt ou Cmd, au clic du milieu, avec `target` ou
// `download`, ou vers une autre origine, il partirait en GET, sans le verbe (nouvel onglet, nouvelle fenêtre,
// téléchargement, page quittée). Ces gestes ne font plus rien — ni navigation, ni requête — et la console de
// développement dit pourquoi. Un clic simple envoie toujours la requête au verbe demandé. Deux cas : un composant
// léger (`mjs-light`) et un composant en ombre fermée (le cas par défaut), où le document ne voit que l'hôte.
// Chromium, Firefox et WebKit réels (vrais clics de souris).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const ORIGINE = 'http://mjs.test'
const LIENS = [
  '<a class="simple" href="/article/3" @method="delete">Supprimer</a>',
  '<a class="onglet" href="/article/3" target="_blank" @method="delete">Supprimer (onglet)</a>',
  '<a class="fichier" href="/article/3" download @method="delete">Supprimer (fichier)</a>',
  '<a class="ailleurs" href="http://autre.test/article/3" @method="delete">Supprimer ailleurs</a>'
].join('\n')

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`lien @method suivi par le navigateur : rien ne part (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let navigateur: any
  let html = ''

  before(async () => {
    present = await navigateurPresent(nom)
    if (!present) {
      console.log('  ℹ️  ' + nom + ' non installé, test sauté. Activer : `npx playwright install ' + nom + '`')
      return
    }
    const root   = mjsTmp('lien-method-natif')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), LIENS + '\n')
    writeFileSync(join(srcDir, 'ombre.mjs'), LIENS + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre  = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    const script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote mjs-light></mjs-hote><mjs-ombre></mjs-ombre><script>${script}</script></body></html>`
    const playwright = await import('playwright')
    navigateur = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  })

  after(async () => {
    if (navigateur) await navigateur.close()
    await terminateSharedWorkerPool()
  })

  // un geste sur le lien `classe`, dans un contexte neuf : rend ce qui en est sorti (onglets ou fenêtres ouverts,
  // téléchargements, requêtes, adresse et document de la page, avertissements de la console). `ombre` : le lien du
  // composant en ombre fermée, que les sélecteurs ne traversent pas — cliqué à ses coordonnées
  async function geste(classe: string, opts: { modifiers?: string[], button?: string } = {}, ombre = false) {
    const contexte = await navigateur.newContext({ acceptDownloads: true })
    const sortie = { ouvertes: 0, fichiers: 0, requetes: [] as string[], url: '', meme: false, avertis: [] as string[] }
    try {
      let charge = false
      contexte.on('page', () => { if (charge) sortie.ouvertes++ })
      contexte.on('request', (r: any) => { if (charge) sortie.requetes.push(r.method() + ' ' + r.url()) })
      await contexte.route('**/*', (route: any) => {
        const r = route.request()
        const u = new URL(r.url())
        if (u.origin === ORIGINE && u.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
        if (r.method() !== 'GET') return route.fulfill({ status: 204, body: '' })
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><p>ARTICLE</p>' })
      })
      const page = await contexte.newPage()
      page.on('download', () => { sortie.fichiers++ })
      page.on('console', (m: any) => { if (m.type() === 'warning' && m.text().includes('@method="delete"')) sortie.avertis.push(m.text()) })
      await page.goto(ORIGINE + '/')
      await page.waitForFunction(() => { const o: any = document.querySelector('mjs-ombre'); return !!document.querySelector('mjs-hote a.simple') && !!(o && o._shadow && o._shadow.querySelector('a.simple')) })
      await page.evaluate(() => { (window as any).__meme = true })
      charge = true
      if (ombre) {
        const b = await page.evaluate((c: string) => { const r = (document.querySelector('mjs-ombre') as any)._shadow.querySelector('a.' + c).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, classe)
        for (const m of opts.modifiers || []) await page.keyboard.down(m)
        await page.mouse.click(b.x, b.y, { button: (opts.button || 'left') as any })
        for (const m of opts.modifiers || []) await page.keyboard.up(m)
      }
      else await page.click(`mjs-hote a.${classe}`, opts)
      await page.waitForTimeout(700)
      sortie.url  = page.url()
      sortie.meme = await page.evaluate(() => (window as any).__meme === true).catch(() => false)
      return sortie
    }
    finally { await contexte.close() }
  }

  const rien = (s: any) => {
    assert.equal(s.ouvertes, 0, 'aucun onglet ni fenêtre ouverts')
    assert.equal(s.fichiers, 0, 'aucun téléchargement')
    assert.deepEqual(s.requetes, [], 'aucune requête')
    assert.equal(s.url, ORIGINE + '/', 'la page reste où elle est')
    assert.equal(s.meme, true, 'même document')
    assert.equal(s.avertis.length, 1, 'un avertissement de développement')
    assert.match(s.avertis[0], /@method="delete" : lien non suivi/)
    assert.match(s.avertis[0], /clic du milieu/)
  }

  for (const ombre of [false, true]) {
    const ou = ombre ? 'composant en ombre fermée' : 'composant léger'
    for (const [libelle, opts] of [['Ctrl+clic', { modifiers: ['Control'] }], ['Maj+clic', { modifiers: ['Shift'] }], ['Alt+clic', { modifiers: ['Alt'] }], ['Cmd+clic', { modifiers: ['Meta'] }], ['clic du milieu', { button: 'middle' }]] as const) {
      it(`${ou}, ${libelle} sur <a @method="delete"> : rien ne part, la console dit pourquoi`, async function () {
        if (!present) { this.skip(); return }
        rien(await geste('simple', opts as any, ombre))
      })
    }

    for (const [libelle, classe] of [['target="_blank"', 'onglet'], ['download', 'fichier'], ['autre origine', 'ailleurs']] as const) {
      it(`${ou}, lien @method avec ${libelle}, clic simple : rien ne part, la console dit pourquoi`, async function () {
        if (!present) { this.skip(); return }
        rien(await geste(classe, {}, ombre))
      })
    }

    it(`${ou}, clic simple sur <a @method="delete"> : la requête DELETE part`, async function () {
      if (!present) { this.skip(); return }
      const s = await geste('simple', {}, ombre)
      assert.deepEqual(s.requetes, ['DELETE ' + ORIGINE + '/article/3'])
      assert.equal(s.ouvertes, 0)
      assert.equal(s.fichiers, 0)
      assert.equal(s.meme, true)
      assert.deepEqual(s.avertis, [])
    })
  }
})
