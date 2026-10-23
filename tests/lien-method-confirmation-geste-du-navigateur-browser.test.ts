// Lien `@method @confirm` sous un geste que le navigateur suivrait lui-même (Ctrl, Maj, Alt ou Cmd, clic du milieu,
// `target`, `download`, autre origine) : le geste ne fait rien, et la question n'est même pas posée — la garde du
// geste passe avant la confirmation. Avant : la question partait, puis, après « oui » dans la modale maison
// (asynchrone, la confirmation par défaut), un clic simple était rejoué et la requête DELETE partait ; avec une
// confirmation synchrone, la question était posée pour rien. Deux formes de confirmation, la modale maison (sa boîte
// remplacée par une réponse « oui » immédiate) et une confirmation synchrone (`window.confirm`) ; deux composants, léger
// (`mjs-light`) et en ombre fermée. Un clic simple pose toujours la question, et la requête part après « oui ».
// Chromium, Firefox et WebKit réels (vrais clics de souris).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'
type Forme = 'modale' | 'synchrone'

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
  '<a class="simple" href="/article/3" @method="delete" @confirm="Supprimer ?">Supprimer</a>',
  '<a class="onglet" href="/article/3" target="_blank" @method="delete" @confirm="Supprimer ?">Supprimer (onglet)</a>',
  '<a class="fichier" href="/article/3" download @method="delete" @confirm="Supprimer ?">Supprimer (fichier)</a>',
  '<a class="ailleurs" href="http://autre.test/article/3" @method="delete" @confirm="Supprimer ?">Supprimer ailleurs</a>'
].join('\n')

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`lien @method @confirm suivi par le navigateur : ni question ni requête (${nom} réel)`, function () {
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
    const root   = mjsTmp('lien-method-confirmation')
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

  // un geste sur le lien `classe`, dans un contexte neuf, sous la confirmation `forme` (répond toujours « oui ») : rend
  // ce qui en est sorti (questions posées, onglets ou fenêtres ouverts, téléchargements, requêtes, adresse et document
  // de la page, avertissements de la console). `ombre` : le lien du composant en ombre fermée, cliqué à ses coordonnées
  async function geste(forme: Forme, classe: string, opts: { modifiers?: string[], button?: string } = {}, ombre = false) {
    const contexte = await navigateur.newContext({ acceptDownloads: true })
    const sortie = { questions: [] as string[], ouvertes: 0, fichiers: 0, requetes: [] as string[], url: '', meme: false, avertis: [] as string[] }
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
      const pret = await page.evaluate((f: Forme) => {
        const w: any = window
        w.__meme = true
        w.__questions = []
        if (f === 'synchrone') {
          w.µ.config.confirm = false
          w.confirm = (m: string) => { w.__questions.push(m); return true }
          return true
        }
        // la modale maison, la confirmation par défaut : sa boîte répond « oui » sur-le-champ
        w.µ.config.confirm = true
        if (!w.µ.modal || typeof w.µ.modal.fire !== 'function') return false
        w.µ.modal.fire = (o: any) => { w.__questions.push(o.text); return Promise.resolve({ isConfirmed: true }) }
        return true
      }, forme)
      assert.equal(pret, true, 'la modale maison doit être dans le code de la page')
      charge = true
      if (ombre) {
        const b = await page.evaluate((c: string) => { const r = (document.querySelector('mjs-ombre') as any)._shadow.querySelector('a.' + c).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, classe)
        for (const m of opts.modifiers || []) await page.keyboard.down(m)
        await page.mouse.click(b.x, b.y, { button: (opts.button || 'left') as any })
        for (const m of opts.modifiers || []) await page.keyboard.up(m)
      }
      else await page.click(`mjs-hote a.${classe}`, opts)
      await page.waitForTimeout(700)
      sortie.url       = page.url()
      sortie.meme      = await page.evaluate(() => (window as any).__meme === true).catch(() => false)
      sortie.questions = sortie.meme ? await page.evaluate(() => (window as any).__questions.slice()) : ['(document quitté)']
      return sortie
    }
    finally { await contexte.close() }
  }

  // tout relevé d'un coup : un échec montre la question ET ce qui est parti
  const rien = (s: any) => {
    const vu = { questions: s.questions, ouvertes: s.ouvertes, fichiers: s.fichiers, requetes: s.requetes, url: s.url, meme: s.meme, avertis: s.avertis.length }
    assert.deepEqual(vu, { questions: [], ouvertes: 0, fichiers: 0, requetes: [], url: ORIGINE + '/', meme: true, avertis: 1 }, 'ni question, ni onglet ou fenêtre, ni téléchargement, ni requête ; la page reste où elle est ; un avertissement de développement')
    assert.match(s.avertis[0], /@method="delete" : lien non suivi/)
  }

  for (const forme of ['modale', 'synchrone'] as const) {
    const sous = forme === 'modale' ? 'modale maison' : 'confirmation synchrone'
    for (const ombre of [false, true]) {
      const ou = ombre ? 'composant en ombre fermée' : 'composant léger'
      for (const [libelle, opts] of [['Ctrl+clic', { modifiers: ['Control'] }], ['Maj+clic', { modifiers: ['Shift'] }], ['Alt+clic', { modifiers: ['Alt'] }], ['Cmd+clic', { modifiers: ['Meta'] }], ['clic du milieu', { button: 'middle' }]] as const) {
        it(`${sous}, ${ou}, ${libelle} sur <a @method @confirm> : ni question ni requête, la console dit pourquoi`, async function () {
          if (!present) { this.skip(); return }
          rien(await geste(forme, 'simple', opts as any, ombre))
        })
      }

      for (const [libelle, classe] of [['target="_blank"', 'onglet'], ['download', 'fichier'], ['autre origine', 'ailleurs']] as const) {
        it(`${sous}, ${ou}, lien @method @confirm avec ${libelle}, clic simple : ni question ni requête`, async function () {
          if (!present) { this.skip(); return }
          rien(await geste(forme, classe, {}, ombre))
        })
      }

      it(`${sous}, ${ou}, clic simple sur <a @method @confirm> : la question, puis la requête DELETE après « oui »`, async function () {
        if (!present) { this.skip(); return }
        const s = await geste(forme, 'simple', {}, ombre)
        assert.deepEqual(s.questions, ['Supprimer ?'])
        assert.deepEqual(s.requetes, ['DELETE ' + ORIGINE + '/article/3'])
        assert.equal(s.ouvertes, 0)
        assert.equal(s.fichiers, 0)
        assert.equal(s.meme, true)
        assert.deepEqual(s.avertis, [])
      })
    }
  }
})
