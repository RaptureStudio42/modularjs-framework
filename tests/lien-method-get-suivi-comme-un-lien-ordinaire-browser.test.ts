// Lien `@method="get"` sous un geste que le navigateur suit lui-même (Ctrl, Maj, Alt ou Cmd, clic du milieu, `target`,
// `download`, autre origine) : `get` est le verbe même du navigateur, rien n'est perdu. Le lien se comporte comme un
// lien ordinaire, quelle que soit la casse (`GET`) : même onglet, même fenêtre, même téléchargement, même page quittée
// que le lien sans `@method`, mesuré sous le même geste dans le même navigateur, et sans avertissement. Avant : retenu
// comme un lien à verbe, rien ne s'ouvrait, et la console parlait d'un verbe perdu. Un autre verbe (`delete`, `post`)
// ou un verbe inconnu reste retenu : rien ne part, la console dit pourquoi. Avec `@confirm`, sous la modale maison (sa
// boîte remplacée par une réponse « oui » immédiate) comme sous une confirmation synchrone (`window.confirm`) : la
// question et la suite sont celles du lien ordinaire. Deux composants, léger (`mjs-light`) et en ombre fermée.
// Chromium, Firefox et WebKit réels (vrais clics de souris).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'
type Forme = 'modale' | 'synchrone' | null
type Geste = { modifiers?: string[], button?: string }

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
// une famille par façon d'être suivi par le navigateur (`simple` : sous une touche ou au clic du milieu), un lien par
// verbe ; `aucun` : le lien ordinaire, la mesure de référence
const FAMILLES: Record<string, [string, string]> = {
  simple:   ['/article/3', ''],
  onglet:   ['/article/3', ' target="_blank"'],
  fichier:  ['/article/3', ' download'],
  ailleurs: ['http://autre.test/article/3', '']
}
const VERBES: Record<string, string> = { aucun: '', get: ' @method="get"', get_maj: ' @method="GET"', delete: ' @method="delete"', post: ' @method="post"', inconnu: ' @method="purge"' }
const LIENS = Object.entries(FAMILLES).map(([famille, [href, attrs]]) => {
  const liens     = Object.entries(VERBES).map(([verbe, method]) => `<a class="${famille}_${verbe}" href="${href}"${attrs}${method}>${verbe}</a>`)
  const questions = ['aucun', 'get'].map((verbe) => `<a class="${famille}_${verbe}_question" href="${href}"${attrs}${VERBES[verbe]} @confirm="Ouvrir ?">${verbe} ?</a>`)
  return '<p>' + [...liens, ...questions].join(' ') + '</p>'
}).join('\n')

const GESTES: Array<[string, string, Geste]> = [
  ['Ctrl+clic', 'simple', { modifiers: ['Control'] }],
  ['Maj+clic', 'simple', { modifiers: ['Shift'] }],
  ['Alt+clic', 'simple', { modifiers: ['Alt'] }],
  ['Cmd+clic', 'simple', { modifiers: ['Meta'] }],
  ['clic du milieu', 'simple', { button: 'middle' }],
  ['target="_blank", clic simple', 'onglet', {}],
  ['download, clic simple', 'fichier', {}],
  ['autre origine, clic simple', 'ailleurs', {}]
]
// gestes que le navigateur suit à coup sûr sur un lien ordinaire (onglet ou page quittée) : la référence n'y est jamais vide
const SUIVIS = ['Ctrl+clic', 'clic du milieu', 'target="_blank", clic simple', 'autre origine, clic simple']

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`lien @method="get" sous un geste du navigateur : suivi comme un lien ordinaire (${nom} réel)`, function () {
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
    const root   = mjsTmp('lien-method-get')
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
  // ce qui en est sorti (questions posées, onglets ou fenêtres ouverts, téléchargements, requêtes de la page vers
  // l'article, adresse et document de la page, avertissements `@method` de la console). `ombre` : le lien du composant
  // en ombre fermée, que les sélecteurs ne traversent pas — cliqué à ses coordonnées. La requête d'un onglet ouvert
  // n'est pas relevée : sous WebKit, elle arrive tantôt avant, tantôt après la fin du relevé — l'onglet compte seul
  async function geste(classe: string, opts: Geste, ombre: boolean, forme: Forme) {
    const contexte = await navigateur.newContext({ acceptDownloads: true })
    const sortie = { questions: [] as string[], ouvertes: 0, fichiers: 0, requetes: [] as string[], url: '', meme: false, avertis: [] as string[] }
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
      page.on('download', () => { sortie.fichiers++ })
      // la question passe par la console : relevée même quand la page est quittée juste après
      page.on('console', (m: any) => {
        const texte = m.text()
        if (texte.startsWith(QUESTION)) sortie.questions.push(texte.slice(QUESTION.length))
        else if (m.type() === 'warning' && texte.includes('@method="')) sortie.avertis.push(texte)
      })
      await page.goto(ORIGINE + '/')
      await page.waitForFunction(() => { const o: any = document.querySelector('mjs-ombre'); return !!document.querySelector('mjs-hote a.simple_aucun') && !!(o && o._shadow && o._shadow.querySelector('a.simple_aucun')) })
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
        for (const m of opts.modifiers || []) await page.keyboard.down(m)
        await page.mouse.click(b.x, b.y, { button: (opts.button || 'left') as any })
        for (const m of opts.modifiers || []) await page.keyboard.up(m)
      }
      else await page.click(`mjs-hote a.${classe}`, opts as any)
      await page.waitForTimeout(700)
      sortie.url  = page.url()
      sortie.meme = await page.evaluate(() => (window as any).__meme === true).catch(() => false)
      return sortie
    }
    finally { await contexte.close() }
  }

  // ce que le navigateur a fait du lien, avertissements à part : comparé d'un lien à l'autre
  const suite = (s: any) => ({ questions: s.questions, ouvertes: s.ouvertes, fichiers: s.fichiers, requetes: s.requetes, url: s.url, meme: s.meme })

  // le lien ordinaire de la famille sous le même geste : mesuré une fois, partagé par les verbes
  const references = new Map<string, Promise<any>>()
  function ordinaire(libelle: string, famille: string, opts: Geste, ombre: boolean, forme: Forme) {
    const cle = [libelle, ombre, forme].join('|')
    if (!references.has(cle)) references.set(cle, geste(famille + (forme ? '_aucun_question' : '_aucun'), opts, ombre, forme))
    return references.get(cle)!
  }

  const commeOrdinaire = (s: any, o: any, libelle: string) => {
    if (SUIVIS.includes(libelle)) assert.ok(o.ouvertes > 0 || !o.meme, 'référence : le lien ordinaire est suivi par le navigateur ' + JSON.stringify(suite(o)))
    assert.deepEqual(suite(s), suite(o), 'même sort que le lien sans @method, sous le même geste')
    assert.deepEqual(s.avertis, [], 'aucun avertissement')
  }

  // tout relevé d'un coup : un échec montre ce qui est parti ET l'avertissement
  const rien = (s: any, ecrit: string) => {
    assert.deepEqual(suite(s), { questions: [], ouvertes: 0, fichiers: 0, requetes: [], url: ORIGINE + '/', meme: true }, 'ni onglet ou fenêtre, ni téléchargement, ni requête ; la page reste où elle est')
    assert.equal(s.avertis.length, 1, 'un avertissement de développement')
    assert.ok(s.avertis[0].includes(`@method="${ecrit}" : lien non suivi`), s.avertis[0])
  }

  for (const ombre of [false, true]) {
    const ou = ombre ? 'composant en ombre fermée' : 'composant léger'
    for (const [libelle, famille, opts] of GESTES) {
      for (const [verbe, ecrit] of [['get', 'get'], ['get_maj', 'GET']]) {
        it(`${ou}, ${libelle} sur <a @method="${ecrit}"> : suivi comme un lien ordinaire, sans avertissement`, async function () {
          if (!present) { this.skip(); return }
          const o = await ordinaire(libelle, famille, opts, ombre, null)
          commeOrdinaire(await geste(`${famille}_${verbe}`, opts, ombre, null), o, libelle)
        })
      }

      for (const [verbe, ecrit] of [['delete', 'delete'], ['post', 'post'], ['inconnu', 'purge']]) {
        it(`${ou}, ${libelle} sur <a @method="${ecrit}"> : retenu, rien ne part, la console dit pourquoi`, async function () {
          if (!present) { this.skip(); return }
          rien(await geste(`${famille}_${verbe}`, opts, ombre, null), ecrit)
        })
      }
    }
  }

  for (const forme of ['modale', 'synchrone'] as const) {
    const sous = forme === 'modale' ? 'modale maison' : 'confirmation synchrone'
    for (const ombre of [false, true]) {
      const ou = ombre ? 'composant en ombre fermée' : 'composant léger'
      for (const [libelle, famille, opts] of GESTES) {
        it(`${sous}, ${ou}, ${libelle} sur <a @method="get" @confirm> : la question et la suite du lien ordinaire`, async function () {
          if (!present) { this.skip(); return }
          const o = await ordinaire(libelle, famille, opts, ombre, forme)
          const s = await geste(`${famille}_get_question`, opts, ombre, forme)
          assert.deepEqual(suite(s), suite(o), 'même question et même sort que le lien sans @method, sous le même geste')
          assert.deepEqual(s.avertis, [], 'aucun avertissement')
        })
      }
    }
  }
})
