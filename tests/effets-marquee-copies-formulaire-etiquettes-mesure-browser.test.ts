// *marquee dans Chromium, Firefox et WebKit réels (WebKit seulement s'il est installé), en développement et en production : les copies de la bande
// sont des miroirs vivants et de vraies copies, qui tiennent les règles de l'original. Une vitrine porte quatre bandes (`unit: child`) :
//   1. une bande posée dans un formulaire, avec deux modules de saisie du cœur nommés (`<@@number name>`, `<@@checkbox name>`), un composant
//      `@formAssociated` nommé et un champ natif : le formulaire envoie chaque valeur une fois, quel que soit le nombre de copies — le miroir d'un
//      composant associé au formulaire en sort, comme un champ natif recopié, et partage toujours l'état de l'original ;
//   2. une bande posée sous un ancêtre mis à l'échelle (`transform: scale(.5)`) : le texte d'un enfant qui change ne déplace aucune copie et ne
//      change pas le tour (la taille se mesure comme à la pose, sans la transformation) ;
//   3. une étiquette (`<label for>`) et son champ, un champ décrit (`aria-describedby`) par une balise de la bande et par une autre hors de la bande,
//      un champ dont l'identifiant n'est cité par rien : dans chaque copie, l'identifiant cité devient propre à la copie (unique dans la page) et les
//      références de la copie le suivent ; la référence hors de la bande reste telle quelle ; l'identifiant que rien ne cite reste ôté. Le clic sur
//      l'étiquette d'une copie met le focus dans le champ de cette copie ; chaque champ recopié porte le nom de l'original (arbre d'accessibilité de
//      Chromium). Tenu quand l'original change (un identifiant renommé, une référence de plus) et d'une remesure à l'autre (copies gardées) ;
//   4. la valeur d'un champ posée par un script (sans événement) rejoint les copies quand le tour change (la piste grandit) ;
//   5. deux options d'une liste à choix multiples choisies dans une copie le sont dans l'original et dans chaque copie.
// Ni erreur ni avertissement dans la page.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'vitrine.mjs': [
    '<script>',
    '  $q = 3',
    '  $ok = true',
    '  $n = 0',
    '  @plus = -> $n++',
    '  @cinq = -> $q = 5',
    '</script>',
    '<form class="f" action="/envoyer" method="post">',
    '  <div class="b1" *marquee(unit: child, speed: 900s)>',
    '    <@@number name="qte" value=!{$q}></@@number>',
    '    <@@checkbox name="ok" checked=!{$ok}>OK</@@checkbox>',
    '    <@saisie name="libre"></@saisie>',
    '    <input class="n1" name="nom1" value="x" aria-label="n1">',
    '  </div>',
    '</form>',
    '<div class="b2" *marquee(unit: child, speed: 900s)>',
    '  <label class="lab" for="nom">Nom</label>',
    '  <input id="nom" class="nom" value="lu">',
    '  <span id="aide" class="aide">Aide</span>',
    '  <input class="mel" aria-describedby="aide ailleurs" aria-label="mel" value="m">',
    '  <input id="seul" class="seul" aria-label="seul" value="s">',
    '</div>',
    '<p id="ailleurs" class="ailleurs">Ailleurs</p>',
    '<button class="pl" @click={@plus()}>+</button>',
    '<button class="pq" @click={@cinq()}>5</button>',
    '<div class="echelle">',
    '  <div class="b3" *marquee(unit: child, speed: 900s)>',
    '    <span class="a3">AAAA</span>',
    '    <span class="t">{$n}</span>',
    '  </div>',
    '</div>',
    '<div class="b4" *marquee(unit: child, speed: 900s)>',
    '  <span class="a4">AAAA</span>',
    '  <input class="i" aria-label="i" value="depart">',
    '  <select class="s" multiple aria-label="s"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select>',
    '</div>',
    '<style>',
    ':host',
    '  display: block',
    '.b1, .b3, .b4',
    '  width: 900px',
    '  margin: 10px 0',
    '.b2',
    '  margin: 10px 0',
    '.echelle',
    '  width: 1800px',
    '  transform: scale(.5)',
    '  transform-origin: 0 0',
    '.a3, .a4',
    '  display: inline-block',
    '  width: 150px',
    '.t',
    '  display: inline-block',
    '  width: 40px',
    ':host(.grand) .a4',
    '  width: 420px',
    '.nom, .mel, .seul, .i, .n1',
    '  width: 90px',
    '</style>',
    ''
  ].join('\n'),
  'saisie.mjs': [
    '@formAssociated',
    '',
    '<script>',
    '  $val = \'v\'',
    '  µeffect =>',
    '    @@internals?.setFormValue($val)',
    '</script>',
    '<span class="sv">{$val}</span>',
    ''
  ].join('\n')
}

// les aides de la page : l'ombre d'une balise, une bande, sa piste, ses copies, un nœud de l'original, ce que le formulaire envoie, la place d'une
// étiquette de copie entièrement visible
const AIDES = `(() => {
  window.__ombre = (el) => {
    if (!el) return null
    if (el.shadowRoot) return el.shadowRoot
    for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
    return null
  }
  window.__v = () => window.__ombre(document.querySelector('mjs-vitrine'))
  window.__bande = (c) => window.__v().querySelector('.' + c)
  window.__run = (c) => window.__bande(c).querySelector(':scope > [mjs-fx-marquee-run]')
  window.__copies = (c) => [...window.__run(c).querySelectorAll(':scope > [mjs-fx-marquee-copy]')]
  window.__o = (c, sel) => window.__run(c).querySelector(':scope > ' + sel)
  window.__envoi = () => { const c = {}; for (const [k, v] of new FormData(window.__v().querySelector('form.f'))) c[k] = (c[k] || []).concat(String(v)); return c }
  window.__lab = () => {
    const b = window.__bande('b2').getBoundingClientRect()
    const k = window.__copies('b2')
    for (let i = 0; i < k.length; i++) {
      const r = k[i].querySelector('.lab').getBoundingClientRect()
      if (r.width > 0 && r.left >= b.left + 4 && r.right <= b.right - 4) return { x: r.left + r.width / 2, y: r.top + r.height / 2, i }
    }
    return null
  }
  window.__etiquettes = () => {
    const ids = [...window.__v().querySelectorAll('[id]')].map(n => n.id)
    return {
      uniques: ids.length === new Set(ids).size,
      orig: [window.__o('b2', '.lab').getAttribute('for'), window.__o('b2', '.nom').id, window.__o('b2', '.mel').getAttribute('aria-describedby')],
      copies: window.__copies('b2').map(k => ({ rang: k.__rang, for: k.querySelector('.lab').getAttribute('for'), nom: k.querySelector('.nom').id, aide: k.querySelector('.aide').id, dit: k.querySelector('.mel').getAttribute('aria-describedby'), seul: k.querySelector('.seul').id }))
    }
  }
})()`

type Appli = { nom: string, env: 'dev' | 'prod' }
const APPLIS: Appli[] = [{ nom: 'développement', env: 'dev' }, { nom: 'production', env: 'prod' }]

const scripts: Record<string, Promise<string>> = {}
function construire(appli: Appli): Promise<string> {
  scripts[appli.env] ??= (async () => {
    const root   = mjsTmp('marquee-formulaire-etiquettes-' + appli.env)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const manifeste = join(outDir, 'bundle.js')
    const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle' }
    if (appli.env === 'prod') options.env = 'prod'
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [], appli.nom)
    const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    assert.ok(fichiers.includes('bundle.js'), fichiers.join(' '))
    return stripEsm(readFileSync(manifeste, 'utf-8'))
  })()
  return scripts[appli.env]
}

describe('*marquee — copies dans un formulaire, étiquettes et identifiants, mesure sous une transformation, valeurs rattrapées (navigateurs réels)', function () {
  this.timeout(600000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Array<'chromium' | 'firefox' | 'webkit'>) {
    describe(nom, function () {
      let browser: any

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      })

      after(async () => { await browser?.close() })

      for (const appli of APPLIS) {
        describe(appli.nom, function () {
          let page: any
          const erreurs: string[] = []
          const avis: string[]    = []
          const lit = (js: string) => page.evaluate(js)

          before(async function () {
            if (!browser) return this.skip()
            const script = await construire(appli)
            page = await (await browser.newContext({ viewport: { width: 1000, height: 900 } })).newPage()
            page.on('pageerror', (e: any) => erreurs.push(String(e)))
            page.on('console', (m: any) => {
              if (m.type() === 'error') erreurs.push(m.text())
              else if (m.type() === 'warning' && m.text().startsWith('[ModularJS]')) avis.push(m.text())
            })
            await page.addInitScript(AIDES)
            await page.route('http://t.test/**', (route: any) => {
              const url = new URL(route.request().url())
              if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><mjs-vitrine></mjs-vitrine><script>${script}</script></body></html>` })
              return route.fulfill({ status: 204, body: '' })
            })
            await page.goto('http://t.test/', { waitUntil: 'load' })
            await page.waitForFunction(`window.__v() && ['b1', 'b2', 'b3', 'b4'].every(c => window.__bande(c) && window.__copies(c).length > 0)`, null, { timeout: 20000 })
            await page.waitForTimeout(600)
          })

          after(async () => { await page?.context().close() })

          it('1 · le formulaire autour d\'une bande envoie chaque valeur une fois (modules du cœur, composant @formAssociated, champ natif)', async () => {
            const copies = await lit(`window.__copies('b1').length`)
            assert.ok(copies >= 2, `au moins deux copies : ${copies}`)
            const envoi = await lit('window.__envoi()')
            assert.deepEqual(envoi, { qte: ['3'], ok: ['on'], libre: ['v'], nom1: ['x'] }, `une paire par nom, pour ${copies} copies`)
            const valide = await lit(`window.__v().querySelector('form.f').checkValidity()`)
            assert.equal(valide, true, 'le formulaire peut partir')
            const miroirs = await lit(`window.__copies('b1').map(k => [...k.querySelectorAll('mjs-core-number, mjs-core-checkbox, mjs-saisie')].map(x => x.localName + ':' + x.isMirror).join(' '))`)
            assert.ok(miroirs.every((m: string) => m === 'mjs-core-number:true mjs-core-checkbox:true mjs-saisie:true'), `les copies portent des miroirs : ${JSON.stringify(miroirs)}`)
            // l'état reste partagé : la valeur changée par la vitrine se voit dans l'original et dans chaque miroir, et part une fois
            await lit(`window.__v().querySelector('.pq').click()`)
            await page.waitForTimeout(300)
            const vus = await lit(`[window.__o('b1', 'mjs-core-number')].concat(window.__copies('b1').map(k => k.querySelector('mjs-core-number'))).map(h => window.__ombre(h).querySelector('input').value)`)
            assert.ok(vus.length > 1 && vus.every((v: string) => v === '5'), `l'original et ses miroirs montrent la même valeur : ${JSON.stringify(vus)}`)
            assert.deepEqual(await lit('window.__envoi()'), { qte: ['5'], ok: ['on'], libre: ['v'], nom1: ['x'] }, 'la valeur changée part une fois')
          })

          it('2 · sous un ancêtre mis à l\'échelle, le texte d\'un enfant qui change ne déplace aucune copie', async () => {
            const lire = () => lit(`({ places: window.__copies('b3').map(k => k.style.translate), tour: window.__run('b3').style.getPropertyValue('--mjs-fx-marquee-tour') })`)
            const avant = await lire()
            assert.ok(avant.places.length >= 2, `au moins deux copies : ${JSON.stringify(avant)}`)
            await lit(`window.__v().querySelector('.pl').click()`)
            await page.waitForTimeout(400)
            const texte = await lit(`window.__copies('b3').map(k => k.querySelector('.t').textContent)`)
            assert.ok(texte.every((t: string) => t === '1'), `les copies montrent le texte neuf : ${JSON.stringify(texte)}`)
            assert.deepEqual(await lire(), avant, 'places et tour inchangés')
          })

          it('5 · deux options choisies dans une copie d\'une liste à choix multiples le sont partout', async () => {
            await lit(`(() => { const s = window.__copies('b4')[0].querySelector('.s'); s.options[0].selected = true; s.options[2].selected = true; s.dispatchEvent(new Event('input', { bubbles: true, composed: true })); s.dispatchEvent(new Event('change', { bubbles: true, composed: true })) })()`)
            await page.waitForTimeout(300)
            const orig = await lit(`[...window.__o('b4', '.s').selectedOptions].map(o => o.value).join('+')`)
            const copies = await lit(`window.__copies('b4').map(k => [...k.querySelector('.s').selectedOptions].map(o => o.value).join('+'))`)
            assert.equal(orig, '1+3', 'l\'original reçoit les deux options')
            assert.ok(copies.length >= 2 && copies.every((c: string) => c === '1+3'), `chaque copie montre les deux options : ${JSON.stringify(copies)}`)
          })

          it('3 · étiquettes et identifiants : propres à chaque copie, références suivies, focus et nom accessible', async () => {
            const tenu = (e: any, nom: string, ref: string, seul: boolean) => {
              assert.ok(e.uniques, `identifiants uniques dans la page : ${JSON.stringify(e)}`)
              assert.ok(e.copies.length >= 1, `des copies : ${JSON.stringify(e)}`)
              for (const k of e.copies) {
                assert.ok(k.nom && k.nom !== nom && k.for === k.nom, `l'étiquette de la copie vise le champ de la copie : ${JSON.stringify(k)}`)
                assert.ok(k.aide && k.aide !== 'aide' && k.dit === k.aide + ' ailleurs' + (ref ? ' ' + k.seul : ''), `la description de la copie vise la balise de la copie, celle hors de la bande reste : ${JSON.stringify(k)}`)
                assert.equal(!!k.seul, seul, `l'identifiant ${seul ? 'cité' : 'que rien ne cite'} : ${JSON.stringify(k)}`)
              }
            }
            const e = await lit('window.__etiquettes()')
            assert.deepEqual(e.orig, ['nom', 'nom', 'aide ailleurs'], 'l\'original garde ses identifiants et ses références')
            tenu(e, 'nom', '', false)
            const lab = await lit('window.__lab()')
            assert.ok(lab, 'une étiquette de copie visible dans la bande')
            await page.mouse.click(lab.x, lab.y)
            await page.waitForTimeout(200)
            const focus = await lit(`(() => { const a = window.__v().activeElement; if (!a) return 'aucun'; const k = a.closest('[mjs-fx-marquee-copy]'); return k ? 'copie' + window.__copies('b2').indexOf(k) + ':' + a.className : 'original:' + a.className })()`)
            assert.equal(focus, 'copie' + lab.i + ':nom', 'le clic sur l\'étiquette d\'une copie met le focus dans le champ de cette copie')
            if (nom === 'chromium') {
              const cdp = await page.context().newCDPSession(page)
              const { nodes } = await cdp.send('Accessibility.getFullAXTree')
              const noms = nodes.filter((n: any) => !n.ignored && n.role?.value === 'textbox' && n.value?.value === 'lu').map((n: any) => n.name?.value || '(sans nom)')
              assert.deepEqual(noms, Array(1 + e.copies.length).fill('Nom'), 'chaque champ recopié porte le nom de l\'original')
            }
            // l'original change : un identifiant renommé, une référence de plus vers une balise que rien ne citait
            await lit(`(() => { window.__o('b2', '.nom').id = 'nom2'; window.__o('b2', '.lab').setAttribute('for', 'nom2'); window.__o('b2', '.mel').setAttribute('aria-describedby', 'aide ailleurs seul') })()`)
            await page.waitForTimeout(300)
            const e2 = await lit('window.__etiquettes()')
            assert.deepEqual(e2.orig, ['nom2', 'nom2', 'aide ailleurs seul'], 'l\'original changé')
            tenu(e2, 'nom2', 'seul', true)
            // remesures : moins de copies, puis plus ; celles qui restent gardent leurs identifiants
            await lit(`window.__copies('b2').forEach((k, i) => { k.__rang = i })`)
            const avant = await lit('window.__etiquettes()')
            await page.setViewportSize({ width: 500, height: 900 })
            await page.waitForTimeout(500)
            await page.setViewportSize({ width: 1700, height: 900 })
            await page.waitForTimeout(500)
            const e3 = await lit('window.__etiquettes()')
            tenu(e3, 'nom2', 'seul', true)
            assert.ok(e3.copies.length > avant.copies.length, `plus de copies après la remesure : ${avant.copies.length} → ${e3.copies.length}`)
            for (const k of e3.copies.filter((x: any) => x.rang !== undefined)) assert.deepEqual(k, avant.copies[k.rang], 'une copie gardée garde ses identifiants')
          })

          it('4 · la valeur posée par un script rejoint les copies quand le tour change', async () => {
            await lit(`window.__o('b4', '.i').value = 'zzz'`)
            await page.waitForTimeout(300)
            const tour = await lit(`window.__run('b4').style.getPropertyValue('--mjs-fx-marquee-tour')`)
            await lit(`document.querySelector('mjs-vitrine').classList.add('grand')`)
            await page.waitForTimeout(600)
            assert.notEqual(await lit(`window.__run('b4').style.getPropertyValue('--mjs-fx-marquee-tour')`), tour, 'le tour a changé')
            const vals = await lit(`window.__copies('b4').map(k => k.querySelector('.i').value)`)
            assert.ok(vals.length >= 1 && vals.every((v: string) => v === 'zzz'), `les copies montrent la valeur de l'original : ${JSON.stringify(vals)}`)
          })

          it('ni erreur ni avertissement', () => {
            assert.deepEqual(erreurs, [])
            assert.deepEqual(avis, [])
          })
        })
      }
    })
  }
})
