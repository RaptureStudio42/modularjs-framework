// Les modules de saisie du cœur (<@@checkbox>, <@@switch>, <@@radio>, <@@number>, <@@gauge>, <@@knob>, <@@select> à choix simple et multiple, <@@editor> en saisie et en
// mode « répondre ») dans Chromium, Firefox et WebKit réels. La marque `mjs-f` n'est écrite que pendant le rendu par le serveur et ne sert qu'à retrouver, dans une page
// reprise, le champ que le serveur a déjà écrit :
// - rendu client pur (développement, puis production sans reprise : le build n'envoie même plus la recherche par la marque) : aucun champ du DOM ne la porte, au départ comme
//   après de vrais gestes et après `form.reset()`, et le formulaire envoie un seul champ par valeur ;
// - page rendue par le serveur puis reprise (production et développement, trois modes de reprise, les deux ordres d'arrivée des morceaux) : le serveur a écrit ses champs
//   marqués, le module les reprend (jamais de champ doublé : `n=3` une fois), le champ de la page de même nom reste en place, et ce que le navigateur crée ensuite ne porte
//   pas la marque : le nombre de champs marqués ne grandit jamais ;
// - page rendue par le serveur dans une appli de production qui n'en reprend aucune (le navigateur la refait) : le serveur n'écrit plus la marque, et le formulaire n'envoie
//   toujours qu'un champ par valeur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS } from './helpers/editeur-riche.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

const ORDRES = ['la page d\'abord', 'les modules d\'abord'] as const

// un seul formulaire : chaque module porte un champ caché de la page, sous son propre nom (le radio `g` le porte dans son premier bouton)
const HOTE = `<script>
  $texte  = '<p>Bonjour</p>'
  $modele = '<ul data-checklist><li>un</li><li>deux</li><li>trois</li></ul>'
  $coches = [0, 2]
  $multi  = ['a', 'c']
</script>

<form class="f-marque" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cb" name="cb" checked={true}><input type="hidden" name="cb" value="a-cb">case</@@checkbox>
  <@@switch class="sw" name="sw" checked={true}><input type="hidden" name="sw" value="a-sw">interrupteur</@@switch>
  <@@radio class="r1" name="g" value="x" checked><input type="hidden" name="g" value="a-g">x</@@radio>
  <@@radio class="r2" name="g" value="y">y</@@radio>
  <@@number class="n" name="n" value="3"><input type="hidden" name="n" value="a-n"></@@number>
  <@@gauge class="gg" name="gg" value="4"><input type="hidden" name="gg" value="a-gg"></@@gauge>
  <@@knob class="k" name="k" value="30"><input type="hidden" name="k" value="a-k"></@@knob>
  <@@select class="s" name="s" value="b"><input type="hidden" name="s" value="a-s"><@@option value="a">A</@@option><@@option value="b">B</@@option></@@select>
  <@@select class="m" name="m" multiple value={$multi}><input type="hidden" name="m" value="a-m"><@@option value="a">A</@@option><@@option value="b">B</@@option><@@option value="c">C</@@option></@@select>
  <@@editor class="e" name="contrat" toolbar="none" value=!{$texte}><input type="hidden" name="contrat" value="a-e"></@@editor>
  <@@editor class="rp" name="reps[]" toolbar="none" answer value={$modele} checked=!{$coches}><input type="hidden" name="reps[]" value="a-rp"></@@editor>
  <button type="reset" class="rz">remise à zéro</button>
  <button type="submit" class="go">envoyer</button>
</form>
`

const MODULES = 'mjs-core-checkbox, mjs-core-switch, mjs-core-radio, mjs-core-number, mjs-core-gauge, mjs-core-knob, mjs-core-select, mjs-core-editor'
const TOTAL   = 11

type Etat = { cb: boolean; sw: boolean; g: string; n: number; gg: number; k: number; s: string; m: string[]; e: string; rp: number[] }

const depart = (): Etat => ({ cb: true, sw: true, g: 'x', n: 3, gg: 4, k: 30, s: 'b', m: ['a', 'c'], e: '<p>Bonjour</p>', rp: [0, 2] })

// ce que le formulaire DOIT envoyer pour un état : le champ de la page d'abord, puis celui du module
const formulaire = (e: Etat): string[] => [
  'cb=a-cb', ...(e.cb ? ['cb=on'] : []),
  'sw=a-sw', ...(e.sw ? ['sw=on'] : []),
  'g=a-g', 'g=' + e.g,
  'n=a-n', 'n=' + e.n,
  'gg=a-gg', 'gg=' + e.gg,
  'k=a-k', 'k=' + e.k,
  's=a-s', 's=' + e.s,
  'm=a-m', ...e.m.map((v) => 'm=' + v),
  'contrat=a-e', 'contrat=' + e.e,
  'reps[]=a-rp', ...e.rp.map((i) => 'reps[]=' + i)
]

// chaque geste de l'utilisateur et ce qu'il change à l'état (une case décochée puis recochée : le champ du module est retiré, puis recréé par le navigateur)
const GESTES: Array<[string, (e: Etat) => void]> = [
  ['cb', (e) => { e.cb = !e.cb }],
  ['cb', (e) => { e.cb = !e.cb }],
  ['sw', (e) => { e.sw = !e.sw }],
  ['sw', (e) => { e.sw = !e.sw }],
  ['r2', (e) => { e.g = 'y' }],
  ['n', (e) => { e.n++ }],
  ['gg', (e) => { e.gg++ }],
  ['k', (e) => { e.k++ }],
  ['s', (e) => { e.s = 'a' }],
  ['m', (e) => { e.m = ['a', 'c', 'b'] }],
  ['e', (e) => { e.e = '<p>Bonjour!</p>' }],
  ['rp1', (e) => { e.rp = [0, 1, 2] }],
  ['rp0', (e) => { e.rp = [1, 2] }]
]

// la pièce visible sur laquelle on clique, pour chaque geste
const PIECE: Record<string, [string, string]> = { cb: ['cb', '.box'], sw: ['sw', '.pill'], r2: ['r2', '.ring'], n: ['n', 'button.step.more'], gg: ['gg', 'button.btn'] }

type Scenario = { build: 'dev' | 'prod'; client: boolean; sans?: boolean; mode: string; ordre: typeof ORDRES[number]; nom: string }

const SCENARIOS: Scenario[] = [
  { build: 'dev',  client: true,  mode: '',           ordre: ORDRES[0], nom: 'développement, rendu client pur' },
  { build: 'prod', client: true,  mode: '',           ordre: ORDRES[0], nom: 'production sans reprise, rendu client pur' },
  { build: 'prod', client: false, mode: 'positional', ordre: ORDRES[0], nom: 'production, page reprise « positional », la page d\'abord' },
  { build: 'prod', client: false, mode: 'markers',    ordre: ORDRES[1], nom: 'production, page reprise « markers », les modules d\'abord' },
  { build: 'dev',  client: false, mode: 'diff',       ordre: ORDRES[0], nom: 'développement, page reprise « diff »' },
  { build: 'prod', client: false, sans: true, mode: 'replace', ordre: ORDRES[0], nom: 'production sans reprise, page rendue par le serveur puis refaite' }
]

type Rendu = Record<string, { html: string; hydrateScript: string }>
type Construit = { rendus: Record<'dev' | 'prod' | 'sans', Rendu>; dev: string; fichiers: Record<'avec' | 'sans', Map<string, Buffer>> }
let construit: Promise<Construit> | null = null

// le rendu serveur dans chaque mode, le script de développement, le build de production d'une appli qui reprend des pages et celui d'une appli qui n'en reprend aucune
function construire() {
  construit ??= (async () => {
    const root    = mjsTmp('marque-serveur')
    const srcDir  = join(root, 'src')
    const devDir  = join(root, 'dev')
    const avecDir = join(root, 'out')
    const sansDir = join(root, 'sans')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote-ssr.mjs'), HOTE)
    const compilateur = await createSSRRenderer({ sourceDir: srcDir, outputDir: devDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    await compilateur.renderToString('mjs-hote-ssr', { ssrMode: 'positional' } as any)
    await compilateur.close()
    const files  = readdirSync(devDir).filter((f) => f.endsWith('.js'))
    const coeur  = files.find((f) => /^mjs_core-/.test(f))!
    // chaque composant (un module du cœur, la page) a sa propre portée, comme au vrai chargement où chaque fichier est un module : `select` et `editor` déclarent chacun, au
    // niveau du module, un nom de même valeur (`told`), et un seul script les ferait se heurter (`SyntaxError`)
    const autres = files.filter((f) => f !== coeur && f !== 'bundle.js').map((f) => {
      const code = stripEsm(readFileSync(join(devDir, f), 'utf-8'))
      return f.startsWith('mjs_') ? code : `{\n${code}\n}`
    }).join('\n')
    const dev    = stripEsm(readFileSync(join(devDir, coeur), 'utf-8')) + '\nglobalThis.µ = µ;\n' + autres
    // un site en production rend sur le serveur avec le build de production : ce que ce build retire du code d'un module ne se trouve alors ni dans le HTML, ni dans le navigateur
    const rendus: Record<'dev' | 'prod' | 'sans', Rendu> = { dev: {}, prod: {}, sans: {} }
    for (const build of ['dev', 'prod'] as const) {
      const renderer = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { runtime: ['hydrate'], ...(build === 'prod' ? { env: 'prod' } : {}) } } as any)
      for (const mode of ['positional', 'markers', 'diff']) {
        const { html, hydrateScript } = await renderer.renderToString('mjs-hote-ssr', { ssrMode: mode } as any)
        rendus[build][mode] = { html, hydrateScript }
      }
      await renderer.close()
    }
    // une appli de production qui ne reprend aucune page : le serveur rend avec ce build-là, et le navigateur refait la page
    const sansReprise = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { env: 'prod' } } as any)
    const refaite     = await sansReprise.renderToString('mjs-hote-ssr', { ssrMode: 'replace' } as any)
    rendus.sans.replace = { html: refaite.html, hydrateScript: refaite.hydrateScript }
    await sansReprise.close()
    const fichiers = { avec: new Map<string, Buffer>(), sans: new Map<string, Buffer>() }
    for (const [cle, dir, runtime] of [['avec', avecDir, ['hydrate']], ['sans', sansDir, []]] as Array<['avec' | 'sans', string, string[]]>) {
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: dir, manifestPath: join(dir, 'bundle.js'), ...(runtime.length ? { runtime } : {}), js: 'split', env: 'prod' } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
      for (const f of readdirSync(dir)) if (/\.(js|json)$/.test(f)) fichiers[cle].set(f, readFileSync(join(dir, f)))
      assert.ok([...fichiers[cle].keys()].some((f) => /^core-radio-/.test(f)), 'le build de production sépare un morceau par module')
    }
    return { rendus, dev, fichiers }
  })()
  return construit
}

for (const nom of MOTEURS) describe(`modules à champ caché : la marque \`mjs-f\` n'est écrite que par le serveur (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let contenu = ''
  let ordre: typeof ORDRES[number] = ORDRES[0]
  let fait: Construit
  let ecritsParLeServeur = 0
  const envois: string[]  = []
  const erreurs: string[] = []

  const attendre  = (ms = 150) => page.waitForTimeout(ms)
  const champs    = (): Promise<string[]> => page.evaluate(`Array.from(new FormData(__q('.f-marque'))).map((p) => p[0] + '=' + p[1])`)
  const marques   = (): Promise<number> => page.evaluate(`__q('.f-marque').querySelectorAll('[mjs-f]').length`)
  const duServeur  = (): Promise<number> => page.evaluate(`Array.from(__q('.f-marque').querySelectorAll('[mjs-f]')).filter((i) => i.__srv).length`)
  const nonMarques = (): Promise<number> => page.evaluate(`Array.from(__q('.f-marque').querySelectorAll('mjs-core-checkbox, mjs-core-switch, mjs-core-radio, mjs-core-number, mjs-core-gauge, mjs-core-knob, mjs-core-select, mjs-core-editor')).reduce((n, m) => n + m.querySelectorAll(':scope > input[type=hidden]:not([mjs-f])').length, 0)`)

  // le centre d'une pièce visible d'un module (la case, la pastille, l'anneau, le bouton « + », la liste), pour de vrais clics
  async function cliquer(cls: string, piece: string, rang = 0) {
    const { x, y } = await page.evaluate(`(() => {
      const e = __q('.${cls}')._shadow.querySelectorAll('${piece}')[${rang}]
      e.scrollIntoView({ block: 'center' })
      const r = e.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.mouse.click(x, y)
    await attendre()
  }

  async function cliquerBouton(cls: string) {
    const { x, y } = await page.evaluate(`(() => {
      const e = __q('.${cls}')
      e.scrollIntoView({ block: 'center' })
      const r = e.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.mouse.click(x, y)
  }

  // un geste de l'utilisateur : un clic sur la pièce du module, la flèche haute du bouton rotatif (vraie touche), un choix dans une liste (la liste restée ouverte est refermée
  // d'un clic à côté), une frappe dans l'éditeur ou un clic dans la marge d'une ligne à cocher
  async function geste(nomGeste: string) {
    if (nomGeste === 'k') {
      await page.evaluate(`__q('.k')._shadow.querySelector('.knob').focus()`)
      await page.keyboard.press('ArrowUp')
      await attendre()
    } else if (nomGeste === 's' || nomGeste === 'm') {
      await cliquer(nomGeste, '.select-btn')
      await cliquer(nomGeste, '.select-option', nomGeste === 's' ? 0 : 1)
      await page.mouse.click(2, 2)
      await attendre()
    } else if (nomGeste === 'e') {
      await page.evaluate(`(() => { const sf = __q('.e')._shadow.querySelector('.surface'); sf.focus(); const w = document.createTreeWalker(sf, 4); let n; while ((n = w.nextNode())) if (n.nodeValue.includes('Bonjour')) break; const o = n.nodeValue.length; document.getSelection().setBaseAndExtent(n, o, n, o) })()`)
      await page.keyboard.type('!')
      await attendre(250)
    } else if (nomGeste.startsWith('rp')) {
      const p = await page.evaluate(`(() => { const li = __q('.rp')._shadow.querySelectorAll('.line')[${nomGeste.slice(2)}].parentNode; li.scrollIntoView({ block: 'center' }); const r = li.getBoundingClientRect(); return { x: r.left + 6, y: r.top + 12 } })()`)
      await page.mouse.click(p.x, p.y)
      await attendre()
    } else {
      const [cls, piece] = PIECE[nomGeste]
      await cliquer(cls, piece)
    }
  }

  // la page dans ce scénario (rendu client pur : la balise de la page seule ; sinon le HTML du serveur dans ce mode), puis l'attente que les modules soient montés
  async function charger(s: Scenario) {
    ordre = s.ordre
    const rendu  = s.client ? null : fait.rendus[s.sans ? 'sans' : s.build][s.mode]
    // avant tout module : le formulaire et chaque champ marqué écrit par le serveur reçoivent un repère, pour reconnaître ensuite les nœuds du serveur
    const pre    = `<script>(function () { var r = document.querySelector('mjs-hote-ssr').shadowRoot; r.querySelectorAll('form').forEach(function (f) { f.__srv = true }); r.querySelectorAll('input[mjs-f]').forEach(function (i) { i.__srv = true }) })()</script>`
    const corps  = rendu ? `${rendu.html}\n${pre}\n${rendu.hydrateScript}` : '<mjs-hote-ssr></mjs-hote-ssr>'
    const script = s.build === 'dev' ? `<script>${fait.dev}</script>` : `<script type="module" src="/${s.client || s.sans ? 'sans' : 'out'}/bundle.js"></script>`
    ecritsParLeServeur = rendu ? (rendu.html.match(/<input\b[^>]*\bmjs-f\b[^>]*>/g) ?? []).length : 0
    contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}\n${script}</body></html>`
    await page.goto('http://marque.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`(() => {
      const h = document.querySelector('mjs-hote-ssr')
      const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('${MODULES}')) : []
      return m.length === ${TOTAL} && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.firstElementChild)
    })()`, undefined, { timeout: 60000 })
    await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote-ssr')._shadow.querySelector(s)`)
    await page.waitForTimeout(500)
  }

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      fait    = await construire()
      browser = await playwright[nom].launch()
      page    = await browser.newPage({ viewport: { width: 1100, height: 1400 } })
      await page.addInitScript('window.__name = (f) => f')
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
      await page.route('http://marque.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (url.pathname === '/envoi') {
          envois.push(url.pathname + url.search)
          await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>envoi</title><p>reçu</p>' })
          return
        }
        const dossier = url.pathname.startsWith('/out/') ? 'avec' : url.pathname.startsWith('/sans/') ? 'sans' : null
        if (dossier) {
          const f = url.pathname.slice(dossier === 'avec' ? 5 : 6)
          let corps = fait.fichiers[dossier].get(f)
          if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
          // « les modules d'abord » : avant de lancer le chargeur, le manifeste évalue le morceau de chaque module du cœur, l'un après l'autre
          if (f === 'bundle.js' && ordre === ORDRES[1]) {
            const texte = corps.toString('utf-8')
            const lance = 'if (µ.Autoloader) {'
            assert.ok(texte.includes(lance), 'le manifeste lance le chargeur à cet endroit')
            corps = Buffer.from(texte.replace(lance, 'for (const n of Object.keys(µPaths).filter((k) => k.startsWith(\'core-\'))) { await import(µPathsPrefix + µPaths[n]); }\n  ' + lance), 'utf-8')
          }
          await route.fulfill({ status: 200, contentType: f.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
          return
        }
        await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
      })
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const s of SCENARIOS) describe(s.nom, function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      envois.length  = 0
      erreurs.length = 0
      await charger(s)
    })

    it('au départ : un seul champ par valeur, celui de la page à sa place ; marques seulement sur ce que le serveur a écrit', async function () {
      if (!present) { this.skip(); return }
      const reprise = await page.evaluate(`document.querySelector('mjs-hote-ssr')._shadow.querySelector('form').__srv === true`)
      assert.equal(reprise, !s.client && !s.sans, 'le mode demandé est celui qui a joué : les nœuds du serveur sont repris, sauf en rendu client pur et dans une appli sans reprise')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      assert.deepEqual(await champs(), formulaire(depart()), 'FormData au départ')
      if (s.sans) assert.equal(ecritsParLeServeur, 0, 'une appli sans reprise : le serveur n\'écrit plus la marque')
      if (s.client || s.sans) assert.equal(await marques(), 0, 'aucun champ ne porte la marque')
      else {
        assert.ok(ecritsParLeServeur >= 10, `le serveur a écrit les champs de ses modules, marqués (${ecritsParLeServeur})`)
        // un éditeur en mode « répondre » défait puis refait ses champs au premier rendu (les cases ne sont connues qu'une fois le texte lu) : ceux-là perdent leur marque, jamais davantage
        const marques1 = await marques()
        assert.ok(marques1 <= ecritsParLeServeur, `le navigateur n'ajoute aucune marque (${marques1} marqués, ${ecritsParLeServeur} écrits par le serveur)`)
        assert.equal(await duServeur(), marques1, 'tout champ marqué du DOM est un nœud du serveur')
        assert.ok(marques1 >= 9, `les champs des sept modules à valeur simple et de la liste multiple sont repris, pas refaits (${marques1})`)
      }
    })

    it('de vrais gestes puis form.reset() : un champ par valeur, le champ de la page en place, jamais une marque de plus', async function () {
      if (!present) { this.skip(); return }
      const avant = await marques()
      const borne = s.client || s.sans ? 0 : avant
      const etat  = depart()
      for (const [nomGeste, change] of GESTES) {
        await geste(nomGeste)
        change(etat)
        assert.deepEqual(await champs(), formulaire(etat), `FormData après un geste sur « ${nomGeste} »`)
        assert.ok(await marques() <= borne, `après « ${nomGeste} » : ce que le navigateur crée ne porte pas la marque (${await marques()} marqués, ${borne} permis)`)
      }
      assert.ok(await nonMarques() > 0, 'les champs créés par le navigateur existent, sans marque')
      await cliquerBouton('rz')
      await attendre(500)
      assert.deepEqual(await champs(), formulaire(depart()), 'FormData après la remise à zéro')
      assert.ok(await marques() <= borne, 'la remise à zéro n\'ajoute aucune marque')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    })

    it('un vrai envoi du formulaire porte un seul champ par valeur, celui de la page compris', async function () {
      if (!present) { this.skip(); return }
      await cliquerBouton('go')
      await page.waitForFunction(`location.pathname === '/envoi'`)
      assert.equal(envois.length, 1, 'un seul envoi')
      const recu = Array.from(new URL('http://marque.test' + envois[0]).searchParams).map((p) => p[0] + '=' + p[1])
      assert.deepEqual(recu, formulaire(depart()), 'envoi sans geste')
    })
  })
})
