// `<@@number stack>` : « + » au-dessus de « − », collés au bord de fin du champ (à droite ; à gauche dans un bloc écrit de droite à gauche, `dir="rtl"`),
// la hauteur du champ partagée entre les deux, 24 px au moins chacun, la saisie de l'autre côté, sur toute la hauteur ; `stack="start"` les colle au bord de
// début ; une autre valeur (`stack="haut"`) les colle au bord de fin, et la console du développement dit les deux valeurs justes. Avec `big`, « ++ » au-dessus
// de « −− », sur une seconde colonne, au bord. Le champ garde la place de sa saisie : 120px, 160px avec `big`. Le geste ne change pas : clic, appui long,
// flèches, Page haut, Début et Fin, bornes, grand pas, ordre de tabulation, noms des boutons et ordre de lecture sont ceux du champ en ligne, qui reste tel
// quel ; écrit de droite à gauche, ses traits de séparation restent entre chaque bouton et la saisie. Dans Chromium, Firefox et WebKit réels, en
// développement et en production, la page rendue dans le navigateur ou rendue par le serveur puis reprise.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS } from './helpers/editeur-riche.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

const PAGE = `<script>
  $a  = 5
  $s  = 5
  $g  = 5
  $ab = 50
  $sb = 50
  $gb = 50
  $m  = 0
  $r  = 5
  $rs = 5
  $ri = 5
  $w  = 5
  $h  = 5
</script>
<div class="ligne">
  <@@number class="a" value=!{$a} min="0" max="99"></@@number>
  <button type="button" class="avant">avant</button>
  <@@number class="s" stack value=!{$s} min="0" max="99"></@@number>
  <@@number class="g" stack="start" value=!{$g} min="0" max="99"></@@number>
  <@@number class="ab" value=!{$ab} min="0" max="999" big="10"></@@number>
  <@@number class="sb" stack value=!{$sb} min="0" max="999" big="10"></@@number>
  <@@number class="gb" stack="start" value=!{$gb} min="0" max="999" big="10"></@@number>
  <@@number class="m" stack value=!{$m} min="0" max="2"></@@number>
  <div class="rtl" dir="rtl">
    <@@number class="r" stack value=!{$r}></@@number>
    <@@number class="rs" stack="start" value=!{$rs}></@@number>
    <@@number class="ri" value=!{$ri}></@@number>
  </div>
  <@@number class="w" stack value=!{$w}></@@number>
  <@@number class="h" stack="haut" value=!{$h}></@@number>
</div>
<style>
  .ligne
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 22px

  mjs-core-number.w
    --mjs-number-width: 200px
</style>
`

const TOTAL = 12
const PLUS  = 'button.more:not(.big)'
const MOINS = 'button.less:not(.big)'

type Rendu     = { html: string; hydrateScript: string }
type Construit = { dev: string; prod: Map<string, Buffer>; serveur: Record<'dev' | 'prod', Rendu> }
type Scenario  = { build: 'dev' | 'prod'; serveur: boolean; nom: string }

const SCENARIOS: Scenario[] = [
  { build: 'dev',  serveur: false, nom: 'développement, page rendue dans le navigateur' },
  { build: 'prod', serveur: false, nom: 'production, page rendue dans le navigateur' },
  { build: 'dev',  serveur: true,  nom: 'développement, page rendue par le serveur puis reprise' },
  { build: 'prod', serveur: true,  nom: 'production, page rendue par le serveur puis reprise' }
]

let construit: Promise<Construit> | null = null

// le script de développement (qui sait reprendre une page), le rendu du serveur en développement et en production, et le build de production d'une appli qui reprend des pages
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('number-boutons-empiles')
    const srcDir = join(root, 'src')
    const devDir = join(root, 'dev')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'ne-page.mjs'), PAGE)
    const serveur = {} as Record<'dev' | 'prod', Rendu>
    const dev     = await createSSRRenderer({ sourceDir: srcDir, outputDir: devDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    serveur.dev   = await dev.renderToString('mjs-ne-page', { ssrMode: 'positional' } as any)
    await dev.close()
    const files  = readdirSync(devDir).filter((f) => f.endsWith('.js'))
    const coeur  = files.find((f) => /^mjs_core-/.test(f))!
    const autres = files.filter((f) => f !== coeur && f !== 'bundle.js').map((f) => {
      const code = stripEsm(readFileSync(join(devDir, f), 'utf-8'))
      return f.startsWith('mjs_') ? code : `{\n${code}\n}`
    }).join('\n')
    const script = stripEsm(readFileSync(join(devDir, coeur), 'utf-8')) + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(devDir, 'bundle.js')) + '\n' + autres
    const rendu  = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { runtime: ['hydrate'], env: 'prod' } } as any)
    serveur.prod = await rendu.renderToString('mjs-ne-page', { ssrMode: 'positional' } as any)
    await rendu.close()
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), runtime: ['hydrate'], js: 'split', env: 'prod' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
    const prod = new Map<string, Buffer>()
    for (const f of readdirSync(outDir)) if (/\.(js|json|css)$/.test(f)) prod.set(f, readFileSync(join(outDir, f)))
    return { dev: script, prod, serveur }
  })()
  return construit
}

// deux mesures égales au pixel près (bords arrondis différemment selon le moteur)
const pres = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) <= 1, `${msg} (${a} contre ${b})`)

for (const nom of MOTEURS) describe(`<@@number stack> : « + » au-dessus de « − », collés à un bord (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let contenu = ''
  let fait: Construit
  const erreurs: string[] = []
  const avertis: string[] = []

  const valeur = (c: string): Promise<string> => page.evaluate(`__n('${c}').querySelector('input').value`)
  const gris   = (c: string): Promise<boolean[]> => page.evaluate(`Array.from(__n('${c}').querySelectorAll('button')).map((b) => b.disabled)`)
  // ce qu'un lecteur d'écran lit, dans l'ordre : chaque élément nommé et chaque bouton, son rôle, son nom, sa place dans la tabulation
  const lus    = (c: string): Promise<string[]> => page.evaluate(`Array.from(__n('${c}').querySelectorAll('[aria-label], button, input')).map((e) => e.tagName + ' ' + (e.matches('button') ? e.className : '') + ' ' + (e.getAttribute('role') || '') + ' « ' + e.getAttribute('aria-label') + ' » ' + e.getAttribute('tabindex'))`)
  // le module et l'élément qui ont le focus
  const focus  = (): Promise<{ cls: string[]; tag: string }> => page.evaluate(`(() => { const p = document.querySelector('mjs-ne-page')._shadow.activeElement; const i = p && p._shadow ? p._shadow.activeElement : null; return { cls: p ? Array.from(p.classList) : [], tag: i ? i.tagName : '' } })()`)
  // l'épaisseur des traits à gauche et à droite de « − » et de « + »
  const traits = (c: string): Promise<Record<string, string>> => page.evaluate(`(() => { const sh = __n('${c}'); const w = (sel, cote) => getComputedStyle(sh.querySelector(sel))['border' + cote + 'Width']; return { moinsG: w('${MOINS}', 'Left'), moinsD: w('${MOINS}', 'Right'), plusG: w('${PLUS}', 'Left'), plusD: w('${PLUS}', 'Right') } })()`)

  // les boîtes du champ, de la saisie et de chaque bouton : `more`, `less`, `big-more`, `big-less`
  const boites = (c: string): Promise<any> => page.evaluate(`(() => {
    const sh = __n('${c}')
    const r  = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height } }
    const o  = { champ: r(sh.querySelector('.field')), saisie: r(sh.querySelector('input')) }
    for (const b of sh.querySelectorAll('button')) o[(b.classList.contains('big') ? 'big-' : '') + (b.classList.contains('more') ? 'more' : 'less')] = r(b)
    return o
  })()`)

  async function cliquer(c: string, piece: string) {
    const { x, y } = await page.evaluate(`(() => { const b = __n('${c}').querySelector('${piece}').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
    await page.mouse.click(x, y)
    await page.waitForTimeout(120)
  }

  async function touche(c: string, nomTouche: string) {
    await page.evaluate(`__n('${c}').querySelector('input').focus()`)
    await page.keyboard.press(nomTouche)
    await page.waitForTimeout(60)
  }

  // « + » au-dessus de « − » (et « ++ » au-dessus de « −− », une colonne plus loin vers le bord), collés au bord, la hauteur partagée, la saisie de l'autre côté
  async function empile(c: string, bord: 'droite' | 'gauche', largeur: number) {
    const o        = await boites(c)
    const F        = o.champ
    const I        = o.saisie
    const colonnes = [[o.more, o.less], ...(o['big-more'] ? [[o['big-more'], o['big-less']]] : [])]
    const vu       = JSON.stringify(o)
    pres(F.w, largeur, `${c} : la largeur du champ, ${vu}`)
    pres(F.h, 50, `${c} : 50 px de haut à la taille par défaut, ${vu}`)
    for (const [haut, bas] of colonnes) {
      assert.ok(haut.b <= bas.t + 0.5, `${c} : le bouton qui monte est au-dessus de celui qui descend, ${vu}`)
      pres(haut.l, bas.l, `${c} : une seule colonne (bord gauche)`)
      pres(haut.r, bas.r, `${c} : une seule colonne (bord droit)`)
      pres(haut.t, F.t + 1, `${c} : le bouton du haut touche le haut du champ`)
      pres(bas.b, F.b - 1, `${c} : le bouton du bas touche le bas du champ`)
      pres(haut.h, bas.h, `${c} : la hauteur du champ est partagée`)
      assert.ok(haut.h >= 23.99 && bas.h >= 23.99, `${c} : 24 px au moins par bouton (${haut.h}, ${bas.h})`)
    }
    const pres1 = colonnes[0][0]
    const bout  = colonnes[colonnes.length - 1][0]
    if (bord === 'droite') {
      pres(bout.r, F.r - 1, `${c} : collés au bord droit, ${vu}`)
      pres(I.l, F.l + 1, `${c} : la saisie au bord gauche`)
      pres(I.r, pres1.l, `${c} : la saisie touche la colonne de « + »`)
      if (colonnes.length > 1) pres(pres1.r, bout.l, `${c} : « ++ » et « −− » dans la colonne du bord`)
    }
    if (bord === 'gauche') {
      pres(bout.l, F.l + 1, `${c} : collés au bord gauche, ${vu}`)
      pres(I.r, F.r - 1, `${c} : la saisie au bord droit`)
      pres(I.l, pres1.r, `${c} : la saisie touche la colonne de « + »`)
      if (colonnes.length > 1) pres(pres1.l, bout.r, `${c} : « ++ » et « −− » dans la colonne du bord`)
    }
    pres(I.t, F.t + 1, `${c} : la saisie prend toute la hauteur (haut)`)
    pres(I.b, F.b - 1, `${c} : la saisie prend toute la hauteur (bas)`)
  }

  // la page dans ce scénario (la balise de la page seule, ou le HTML du serveur), puis l'attente que les douze champs soient montés
  async function charger(s: Scenario) {
    const rendu  = s.serveur ? fait.serveur[s.build] : null
    const corps  = rendu ? `${rendu.html}\n${rendu.hydrateScript}` : '<mjs-ne-page></mjs-ne-page>'
    const script = s.build === 'dev' ? `<script>${fait.dev}</script>` : '<script type="module" src="/out/bundle.js"></script>'
    contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}\n${script}</body></html>`
    erreurs.length = 0
    avertis.length = 0
    await page.goto('http://empile.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`(() => {
      const h = document.querySelector('mjs-ne-page')
      const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('mjs-core-number')) : []
      return m.length === ${TOTAL} && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.querySelector('input'))
    })()`, undefined, { timeout: 60000 })
    await page.evaluate(`window.__n = (c) => document.querySelector('mjs-ne-page')._shadow.querySelector('mjs-core-number.' + c)._shadow`)
    await page.waitForTimeout(300)
  }

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) {
      console.log(`  ℹ️  ${nom} non installé, test des boutons empilés sauté`)
      return
    }
    fait    = await construire()
    browser = await playwright[nom].launch()
    page    = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    page.setDefaultTimeout(10000)
    await page.addInitScript('window.__name = (f) => f')
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    page.on('console', (m: any) => {
      if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200))
      if (m.type() === 'warning') avertis.push(m.text().slice(0, 400))
    })
    await page.route('http://empile.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/out/')) {
        const corps = fait.prod.get(url.pathname.slice(5))
        if (!corps) { erreurs.push('absent : ' + url.pathname); await route.fulfill({ status: 404, body: '' }); return }
        await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: corps })
        return
      }
      await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
    })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const s of SCENARIOS) describe(s.nom, function () {
    before(async function () {
      if (!present) { this.skip(); return }
      await charger(s)
    })

    if (s.serveur) it('le serveur écrit déjà la disposition dans la page : neuf champs empilés, dont trois au bord de début', function () {
      const html = fait.serveur[s.build].html
      assert.equal((html.match(/class="(?=[^"]*\bfield\b)(?=[^"]*\bstack\b)[^"]*"/g) ?? []).length, 9, 'neuf champs empilés')
      assert.equal((html.match(/class="(?=[^"]*\bfield\b)(?=[^"]*\bstack\b)(?=[^"]*\bstart\b)[^"]*"/g) ?? []).length, 3, 'trois au bord de début')
    })

    it('géométrie : collés à droite par défaut, à gauche avec `stack="start"`, l\'inverse en `dir="rtl"` ; `big` sur une seconde colonne ; le champ en ligne inchangé', async function () {
      await empile('s', 'droite', 120)
      await empile('g', 'gauche', 120)
      await empile('sb', 'droite', 160)
      await empile('gb', 'gauche', 160)
      await empile('m', 'droite', 120)
      await empile('r', 'gauche', 120)
      await empile('rs', 'droite', 120)
      await empile('w', 'droite', 200)
      const a = await boites('a')
      pres(a.champ.w, 160, 'en ligne : 160px')
      pres(a.less.t, a.more.t, 'en ligne : « − » et « + » sur une ligne')
      assert.ok(a.less.r <= a.saisie.l + 0.5 && a.saisie.r <= a.more.l + 0.5, `en ligne : « − », la saisie, « + » (${JSON.stringify(a)})`)
      const ab = await boites('ab')
      pres(ab.champ.w, 240, 'en ligne avec big : 240px')
      assert.ok(ab['big-less'].r <= ab.less.l + 0.5 && ab.more.r <= ab['big-more'].l + 0.5, 'en ligne avec big : « −− » et « ++ » aux bords')
      assert.equal(await page.evaluate(`__n('a').querySelector('.field').classList.contains('stack')`), false, 'en ligne : aucune classe de la disposition empilée')
      assert.deepEqual(erreurs, [], 'aucune erreur de page')
    })

    it('le champ en ligne écrit de droite à gauche : « − » à droite, « + » à gauche, et chaque trait de séparation entre le bouton et la saisie', async function () {
      const ri = await boites('ri')
      assert.ok(ri.saisie.r <= ri.less.l + 0.5 && ri.more.r <= ri.saisie.l + 0.5, `de droite à gauche : « + », la saisie, « − » (${JSON.stringify(ri)})`)
      assert.deepEqual(await traits('ri'), { moinsG: '1px', moinsD: '0px', plusG: '0px', plusD: '1px' }, 'de droite à gauche : les traits face à la saisie')
      assert.deepEqual(await traits('a'), { moinsG: '0px', moinsD: '1px', plusG: '1px', plusD: '0px' }, 'de gauche à droite : les traits face à la saisie, comme avant')
    })

    it('une valeur inconnue (`stack="haut"`) : collés au bord de fin, et la console du développement dit les deux valeurs justes', async function () {
      await empile('h', 'droite', 120)
      const dits = avertis.filter((t) => t.includes('stack « haut »'))
      if (s.build === 'dev') {
        assert.equal(dits.length, 1, `un avertissement, une fois (${JSON.stringify(avertis)})`)
        assert.ok(dits[0].includes('stack seul') && dits[0].includes('stack="start"'), `il dit les deux valeurs justes (${dits[0]})`)
      }
      else assert.deepEqual(dits, [], 'en production, rien dans la console')
      assert.deepEqual(erreurs, [], 'aucune erreur de page')
    })

    it('noms, rôles et ordre de lecture : ceux du champ en ligne ; les boutons restent hors de la tabulation', async function () {
      assert.deepEqual(await lus('s'), await lus('a'), 'sans big')
      assert.deepEqual(await lus('sb'), await lus('ab'), 'avec big')
      assert.ok((await lus('sb')).some((l) => l.includes('« Plus »')) && (await lus('sb')).some((l) => l.includes('« Augmenter de 10 »')), 'les libellés sont lus')
      await page.evaluate(`document.querySelector('mjs-ne-page')._shadow.querySelector('.avant').focus()`)
      await page.keyboard.press('Tab')
      const premier = await focus()
      assert.ok(premier.cls.includes('s') && premier.tag === 'INPUT', `Tab mène à la saisie (${JSON.stringify(premier)})`)
      await page.keyboard.press('Tab')
      const second = await focus()
      assert.ok(second.cls.includes('g') && second.tag === 'INPUT', `Tab suivant : la saisie du champ suivant, aucun bouton entre les deux (${JSON.stringify(second)})`)
    })

    it('clic, flèches, Page haut, Début et Fin ; le grand pas ; les bornes grisent le bon bouton', async function () {
      await cliquer('s', PLUS)
      assert.equal(await valeur('s'), '6', '« + » d\'un clic : un pas, une fois (rien n\'est doublé par la reprise)')
      await cliquer('s', MOINS)
      assert.equal(await valeur('s'), '5', '« − » d\'un clic')
      await touche('s', 'ArrowUp')
      assert.equal(await valeur('s'), '6', 'flèche haut')
      await touche('s', 'ArrowDown')
      assert.equal(await valeur('s'), '5', 'flèche bas')
      await touche('s', 'PageUp')
      assert.equal(await valeur('s'), '15', 'Page haut : dix pas')
      await touche('s', 'Home')
      assert.equal(await valeur('s'), '0', 'Début : le min')
      await touche('s', 'End')
      assert.equal(await valeur('s'), '99', 'Fin : le max')
      await page.evaluate(`__n('s').querySelector('input').select()`)
      await page.keyboard.type('42')
      await page.keyboard.press('Enter')
      assert.equal(await valeur('s'), '42', 'le nombre se sélectionne et se tape')
      await cliquer('sb', 'button.more.big')
      assert.equal(await valeur('sb'), '60', '« ++ » : le grand pas')
      await cliquer('sb', 'button.less.big')
      assert.equal(await valeur('sb'), '50', '« −− » : le grand pas')
      await cliquer('gb', PLUS)
      assert.equal(await valeur('gb'), '51', '« + » au bord de début')
      await cliquer('r', PLUS)
      assert.equal(await valeur('r'), '6', '« + » en `dir="rtl"`')
      assert.deepEqual(await gris('m'), [true, false], 'au min : « − » grisé')
      await cliquer('m', PLUS)
      await cliquer('m', PLUS)
      assert.equal(await valeur('m'), '2', 'deux pas jusqu\'au max')
      assert.deepEqual(await gris('m'), [false, true], 'au max : « + » grisé')
      await cliquer('m', PLUS)
      assert.equal(await valeur('m'), '2', 'au max, « + » ne fait rien')
      assert.deepEqual(erreurs, [], 'aucune erreur de page')
    })

    it('appui long sur « + » : le pas se répète puis s\'arrête au relâché', async function () {
      const avant    = Number(await valeur('g'))
      const { x, y } = await page.evaluate(`(() => { const b = __n('g').querySelector('${PLUS}').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.waitForTimeout(1100)
      await page.mouse.up()
      await page.waitForTimeout(250)
      const apres = Number(await valeur('g'))
      assert.ok(apres - avant >= 3, `l'appui long répète le pas (${avant} → ${apres})`)
      await page.waitForTimeout(400)
      assert.equal(Number(await valeur('g')), apres, 'relâché : plus rien ne bouge')
    })
  })
})
