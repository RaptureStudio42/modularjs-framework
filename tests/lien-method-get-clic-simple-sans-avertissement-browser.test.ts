// Lien `@method="get"` sous un clic simple : `get` est un verbe reconnu, le verbe même d'un lien. Le lien navigue comme
// un lien ordinaire, quelle que soit la casse (`GET`), sans avertissement — y compris quand `@confirm` pose sa question,
// sous la modale maison (sa boîte remplacée par une réponse « oui » immédiate ; le clic est rejoué une fois la réponse
// donnée) comme sous une confirmation synchrone (`window.confirm`). Avant : la console disait « verbe HTTP non
// reconnu ». Sous `@noUJS`, la navigation native du navigateur fait un GET : rien n'est perdu, aucun avertissement non
// plus (avant : « @method ignoré »). Un verbe vraiment inconnu (`purge`) garde son avertissement, qui cite les verbes
// acceptés, `get` compris ; `@noUJS` avec `delete` garde le sien. Le sort du lien (question, requêtes, adresse, page
// gardée ou quittée) est mesuré contre le lien sans `@method`, dans le même navigateur. Deux composants, léger
// (`mjs-light`) et en ombre fermée. Chromium, Firefox et WebKit réels (vrais clics de souris).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'
type Forme = 'modale' | 'synchrone' | null

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const ORIGINE  = 'http://mjs.test'
const QUESTION = 'QUESTION: '
// `natif` : le lien porte `@noUJS`, le navigateur le suit lui-même ; `aucun` : le lien sans `@method`, la mesure de
// référence de sa famille
const LIENS = [
  '<a class="aucun" href="/article/3">aucun</a>',
  '<a class="get" href="/article/3" @method="get">get</a>',
  '<a class="get_maj" href="/article/3" @method="GET">GET</a>',
  '<a class="inconnu" href="/article/3" @method="purge">purge</a>',
  '<a class="aucun_question" href="/article/3" @confirm="Ouvrir ?">aucun ?</a>',
  '<a class="get_question" href="/article/3" @method="get" @confirm="Ouvrir ?">get ?</a>',
  '<a class="natif_aucun" href="/article/3" @noUJS>natif</a>',
  '<a class="natif_get" href="/article/3" @noUJS @method="get">natif get</a>',
  '<a class="natif_get_maj" href="/article/3" @noUJS @method="GET">natif GET</a>',
  '<a class="natif_delete" href="/article/3" @noUJS @method="delete">natif delete</a>',
  '<a class="natif_aucun_question" href="/article/3" @noUJS @confirm="Ouvrir ?">natif ?</a>',
  '<a class="natif_get_question" href="/article/3" @noUJS @method="get" @confirm="Ouvrir ?">natif get ?</a>'
].map((lien) => '<p>' + lien + '</p>').join('\n')

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`lien @method="get" sous un clic simple : un lien ordinaire, sans avertissement (${nom} réel)`, function () {
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
    const root   = mjsTmp('lien-method-get-clic')
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

  // un clic simple sur le lien `classe`, dans un contexte neuf, sous la confirmation `forme` (répond toujours « oui ») :
  // rend ce qui en est sorti (questions posées, onglets ou fenêtres ouverts, requêtes de la page vers l'article, adresse
  // et document de la page, avertissements de la console qui parlent d'un verbe). `ombre` : le lien du composant en
  // ombre fermée, que les sélecteurs ne traversent pas — cliqué à ses coordonnées
  async function clic(classe: string, ombre: boolean, forme: Forme) {
    const contexte = await navigateur.newContext()
    const sortie = { questions: [] as string[], ouvertes: 0, requetes: [] as string[], url: '', meme: false, avertis: [] as string[] }
    try {
      let charge = false
      contexte.on('page', () => { if (charge) sortie.ouvertes++ })
      await contexte.route('**/*', (route: any) => {
        const r = route.request()
        const u = new URL(r.url())
        if (u.origin === ORIGINE && u.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
        if (r.method() !== 'GET') return route.fulfill({ status: 204, body: '' })
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><p>ARTICLE</p>' })
      })
      const page = await contexte.newPage()
      page.on('request', (r: any) => { if (charge && new URL(r.url()).pathname === '/article/3') sortie.requetes.push(r.method() + ' ' + r.url()) })
      // la question passe par la console : relevée même quand la page est quittée juste après
      page.on('console', (m: any) => {
        const texte = m.text()
        if (texte.startsWith(QUESTION)) sortie.questions.push(texte.slice(QUESTION.length))
        else if (m.type() === 'warning' && texte.includes('method="')) sortie.avertis.push(texte)
      })
      await page.goto(ORIGINE + '/')
      await page.waitForFunction(() => { const o: any = document.querySelector('mjs-ombre'); return !!document.querySelector('mjs-hote a.aucun') && !!(o && o._shadow && o._shadow.querySelector('a.aucun')) })
      const pret = await page.evaluate(([f, q]: [Forme, string]) => {
        const w: any = window
        w.__meme = true
        if (f === 'synchrone') {
          w.µ.config.confirm = false
          w.confirm = (m: string) => { console.log(q + m); return true }
        }
        else if (f === 'modale') {
          // la modale maison, la confirmation par défaut : sa boîte répond « oui » sur-le-champ
          w.µ.config.confirm = true
          if (!w.µ.modal || typeof w.µ.modal.fire !== 'function') return false
          w.µ.modal.fire = (o: any) => { console.log(q + o.text); return Promise.resolve({ isConfirmed: true }) }
        }
        return true
      }, [forme, QUESTION] as [Forme, string])
      assert.equal(pret, true, 'la modale maison doit être dans le code de la page')
      charge = true
      if (ombre) {
        const b = await page.evaluate((c: string) => {
          const lien = (document.querySelector('mjs-ombre') as any)._shadow.querySelector('a.' + c)
          lien.scrollIntoView({ block: 'center' })
          const r = lien.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        }, classe)
        await page.mouse.click(b.x, b.y)
      }
      else await page.click(`mjs-hote a.${classe}`)
      await page.waitForTimeout(700)
      sortie.url  = page.url()
      sortie.meme = await page.evaluate(() => (window as any).__meme === true).catch(() => false)
      return sortie
    }
    finally { await contexte.close() }
  }

  // ce que le navigateur a fait du lien, avertissements à part : comparé d'un lien à l'autre
  const suite = (s: any) => ({ questions: s.questions, ouvertes: s.ouvertes, requetes: s.requetes, url: s.url, meme: s.meme })

  // le lien sans `@method` de la famille, sous la même confirmation : mesuré une fois, partagé par les verbes
  const references = new Map<string, Promise<any>>()
  function ordinaire(classe: string, ombre: boolean, forme: Forme) {
    const cle = [classe, ombre, forme].join('|')
    if (!references.has(cle)) references.set(cle, clic(classe, ombre, forme))
    return references.get(cle)!
  }

  // même sort que le lien ordinaire ; la référence a bien navigué (requête de l'article, adresse de l'article)
  const commeOrdinaire = (s: any, o: any) => {
    assert.ok(o.requetes.length > 0 && o.url === ORIGINE + '/article/3', 'référence : le lien ordinaire mène à l\'article ' + JSON.stringify(suite(o)))
    assert.deepEqual(suite(s), suite(o), 'même sort que le lien sans @method')
  }

  for (const ombre of [false, true]) {
    const ou = ombre ? 'composant en ombre fermée' : 'composant léger'

    for (const [classe, ecrit] of [['get', 'get'], ['get_maj', 'GET']]) {
      it(`${ou}, clic simple sur <a @method="${ecrit}"> : suivi comme un lien ordinaire, sans avertissement`, async function () {
        if (!present) { this.skip(); return }
        const o = await ordinaire('aucun', ombre, null)
        const s = await clic(classe, ombre, null)
        commeOrdinaire(s, o)
        assert.deepEqual(s.avertis, [], 'aucun avertissement')
      })
    }

    it(`${ou}, clic simple sur <a @method="purge"> : navigation normale, un avertissement qui cite les verbes acceptés, get compris`, async function () {
      if (!present) { this.skip(); return }
      const o = await ordinaire('aucun', ombre, null)
      const s = await clic('inconnu', ombre, null)
      commeOrdinaire(s, o)
      assert.equal(s.avertis.length, 1, 'un avertissement de développement ' + JSON.stringify(s.avertis))
      assert.ok(s.avertis[0].includes('mjs-method="purge" : verbe HTTP non reconnu'), s.avertis[0])
      for (const verbe of ['get', 'delete', 'post', 'put', 'patch']) assert.match(s.avertis[0], new RegExp('\\b' + verbe + '\\b'), 'le verbe accepté ' + verbe + ' est cité : ' + s.avertis[0])
    })

    for (const forme of ['modale', 'synchrone'] as const) {
      const sous = forme === 'modale' ? 'modale maison (clic rejoué après « oui »)' : 'confirmation synchrone'
      it(`${sous}, ${ou}, clic simple sur <a @method="get" @confirm> : la question et la suite du lien ordinaire, sans avertissement`, async function () {
        if (!present) { this.skip(); return }
        const o = await ordinaire('aucun_question', ombre, forme)
        const s = await clic('get_question', ombre, forme)
        assert.deepEqual(o.questions, ['Ouvrir ?'], 'référence : la question est posée')
        commeOrdinaire(s, o)
        assert.deepEqual(s.avertis, [], 'aucun avertissement')
      })
    }

    for (const [classe, ecrit] of [['natif_get', 'get'], ['natif_get_maj', 'GET']]) {
      it(`${ou}, clic simple sur <a @noUJS @method="${ecrit}"> : la navigation native, en GET, rien de perdu, sans avertissement`, async function () {
        if (!present) { this.skip(); return }
        const o = await ordinaire('natif_aucun', ombre, null)
        const s = await clic(classe, ombre, null)
        assert.equal(o.meme, false, 'référence : le navigateur quitte la page lui-même')
        commeOrdinaire(s, o)
        assert.deepEqual(s.avertis, [], 'aucun avertissement')
      })
    }

    it(`${ou}, clic simple sur <a @noUJS @method="delete"> : la navigation native, un avertissement (verbe perdu)`, async function () {
      if (!present) { this.skip(); return }
      const o = await ordinaire('natif_aucun', ombre, null)
      const s = await clic('natif_delete', ombre, null)
      commeOrdinaire(s, o)
      assert.equal(s.avertis.length, 1, 'un avertissement de développement ' + JSON.stringify(s.avertis))
      assert.ok(s.avertis[0].includes('@method="delete" ignoré — @noUJS'), s.avertis[0])
    })

    for (const forme of ['modale', 'synchrone'] as const) {
      const sous = forme === 'modale' ? 'modale maison (clic rejoué après « oui »)' : 'confirmation synchrone'
      it(`${sous}, ${ou}, clic simple sur <a @noUJS @method="get" @confirm> : la question puis la navigation native, sans avertissement`, async function () {
        if (!present) { this.skip(); return }
        const o = await ordinaire('natif_aucun_question', ombre, forme)
        const s = await clic('natif_get_question', ombre, forme)
        assert.deepEqual(o.questions, ['Ouvrir ?'], 'référence : la question est posée')
        commeOrdinaire(s, o)
        assert.deepEqual(s.avertis, [], 'aucun avertissement')
      })
    }
  }
})
