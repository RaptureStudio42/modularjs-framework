// *marquee dans Chromium, Firefox et WebKit réels (WebKit seulement s'il est installé) : les copies de la bande sont de VRAIES copies, qu'on touche comme
// l'original. Une vitrine porte quatre bandes (`unit: child`) : un compteur (un composant ModularJS), du contenu ordinaire (un bouton et deux lignes d'une
// liste `{for}` dont les gestionnaires viennent du gabarit de la vitrine, un lien, un texte), des champs (un champ lié à `$texte`, un champ libre, deux
// boutons radio sans formulaire) et un formulaire. En développement et en production (le cœur et l'effet minifiés ensemble).
//   1. la copie d'un composant est son miroir vivant (`isMirror`) : « +1 » cliqué dans une copie fait monter le compteur partout, la saisie dans son champ
//      arrive à l'état commun ; le survol (`:hover`) et l'appui (`:active`) touchent la copie elle-même ;
//   2. le contenu ordinaire : un bouton copié déclenche le gestionnaire du gabarit (sur la copie : `currentTarget` est le bouton cliqué), une ligne copiée
//      celui de SA ligne, un lien copié mène où mène l'original, le texte d'une copie se sélectionne ; un bouton glissé dans un composant de la bande
//      (`<@boite>`) joue lui aussi le gestionnaire du gabarit, la copie d'un composant léger (`mjs-light`) se dessine elle-même et partage l'état ;
//   3. une saisie dans un champ copié arrive à l'état comme celle de l'original (champ lié) ou à l'original (champ libre), un bouton radio choisi dans une
//      copie l'est dans l'original ; l'original et toutes les copies montrent la même chose ;
//   4. un formulaire copié est un vrai formulaire (sa méthode, ses champs nommés) : son bouton d'envoi passe par le gestionnaire `@submit` du gabarit ;
//   5. accessibles comme le reste de la page : ni `inert`, ni `aria-hidden` ; la touche Tab s'arrête dans les copies, l'arbre d'accessibilité les contient
//      (Chromium) ;
//   6. requêtes : le `µmount` de chaque miroir fait la sienne, sauf celui qui la garde par `@@isMirror` ;
//   7. (développement) le retrait de l'effet : copies sorties, miroirs sortis du groupe de l'original, aucun observateur ni écouteur de l'effet laissé ;
//   8. le lien d'une copie qui porte `@method` et `@confirm` : une question, une requête DELETE, la page reste ;
//   9. Entrée dans le champ d'un formulaire copié (sans gestionnaire) l'envoie, une fois, avec les valeurs de l'original.
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
    '  $texte = \'départ\'',
    '  $items = [{ n: 1 }, { n: 2 }]',
    '  @note = (quoi, e) -> window.__note(quoi, e)',
    '  @envoyer = (e) -> window.__envoi(e)',
    '</script>',
    '<div class="b1" *marquee(unit: child, speed: 900s)>',
    '  <@compteur></@compteur>',
    '</div>',
    '<div class="b2" *marquee(unit: child, speed: 900s, gap: 8)>',
    '  <button class="b" @click={@note(\'bouton\', e)}>Bouton</button>',
    '  {for it in $items}',
    '    <button class="l" @click={@note(\'ligne\' + it.n, e)}>Ligne {it.n}</button>',
    '  {end}',
    '  <a class="lien" href="#ailleurs">Ailleurs</a>',
    '  <span class="sel">choisir</span>',
    '</div>',
    '<div class="b3" *marquee(unit: child, speed: 900s)>',
    '  <input class="t" aria-label="texte" value=!{$texte}>',
    '  <input class="u" aria-label="libre" value="libre">',
    '  <input class="ra" type="radio" name="r" value="a" aria-label="ra" checked>',
    '  <input class="rb" type="radio" name="r" value="b" aria-label="rb">',
    '</div>',
    '<div class="b4" *marquee(unit: child, speed: 900s)>',
    '  <form class="f" action="/envoi" method="post" @submit.prevent={@envoyer(e)}><input class="q" name="q" aria-label="q" value="7"><button class="ok">Envoyer</button></form>',
    '</div>',
    '<div class="b5" *marquee(unit: child, speed: 900s)>',
    '  <a class="suppr" href="/articles/1" @method="delete" @confirm="Vraiment ?">Suppr</a>',
    '</div>',
    '<div class="b6" *marquee(unit: child, speed: 900s)>',
    '  <form class="envoi" method="post" action="/envoyer"><input type="hidden" name="id" value="7"><input class="note" name="note" value="5" aria-label="note"></form>',
    '</div>',
    '<div class="b7" *marquee(unit: child, speed: 900s)>',
    '  <@boite><button class="gl" @click={@note(\'glisse\', e)}>Glissé</button></@boite>',
    '  <@leger mjs-light></@leger>',
    '</div>',
    '<p class="vu">{$texte}</p>',
    '<style>',
    '.b1, .b2, .b3, .b4, .b5, .b6, .b7',
    '  width: 900px',
    '  margin: 10px 0',
    '.b, .l',
    '  width: 70px',
    '.t, .u',
    '  width: 110px',
    '.q, .note',
    '  width: 60px',
    '</style>',
    ''
  ].join('\n'),
  'boite.mjs': ['<div class="bx"><slot></slot></div>', '<style>', ':host', '  display: inline-block', '</style>', ''].join('\n'),
  'leger.mjs': ['<script>', '  $n = 0', '  @plus = -> $n++', '</script>', '<button class="lb" @click={@plus()}>léger {$n}</button>', ''].join('\n'),
  'compteur.mjs': [
    '<script>',
    '  $n = 0',
    '  $nom = \'\'',
    '  @plus = -> $n++',
    '  µmount ->',
    '    fetch(\'/donnees\')',
    '    return if @@isMirror',
    '    fetch(\'/sage\')',
    '    return',
    '</script>',
    '<div class="cpt"><button class="plus" @click={@plus()}>+1</button> <span class="n">{$n}</span> <input class="nom" aria-label="nom" value=!{$nom}></div>',
    '<style>',
    ':host',
    '  display: inline-block',
    '.plus',
    '  width: 50px',
    '  background-color: rgb(200, 200, 200)',
    '.plus:hover',
    '  background-color: rgb(0, 128, 0)',
    '.nom',
    '  width: 90px',
    '</style>',
    ''
  ].join('\n')
}

// les aides de la page : l'ombre d'une balise, une bande, ses originaux, ses copies, l'élément visé dans une copie visible, le focus au plus profond, les
// observateurs en vie et les écouteurs posés sur les bandes et les racines
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
  window.__dansCopie = (n) => { for (let x = n; x; x = x.parentNode || x.host) if (x.nodeType === 1 && x.hasAttribute('mjs-fx-marquee-copy')) return true; return false }
  // dans une copie : le nœud \`sel\` (dans l'ombre du compteur si \`ombre\`), le \`rang\`-ième, entièrement visible dans la bande
  window.__dans = (k, sel, ombre) => ombre ? [...k.querySelectorAll('mjs-compteur')].map(h => window.__ombre(h)?.querySelector(sel)).filter(Boolean) : [...k.querySelectorAll(sel)]
  window.__cible = (c, sel, ombre, rang) => {
    const b = window.__bande(c).getBoundingClientRect()
    for (const k of window.__copies(c)) {
      const n = window.__dans(k, sel, ombre)[rang || 0]
      if (!n) continue
      const r = n.getBoundingClientRect()
      if (r.width > 0 && r.left >= b.left + 4 && r.right <= b.right - 4) return { x: r.left + r.width / 2, y: r.top + r.height / 2, gauche: r.left + 6 }
    }
    return null
  }
  window.__focus = () => {
    let a = document.activeElement
    let profond = a
    while (a) {
      profond = a
      const r = window.__ombre(a)
      a = r && r.activeElement ? r.activeElement : null
    }
    return profond ? (window.__dansCopie(profond) ? 'copie:' : '') + profond.localName + (profond.className ? '.' + profond.className : '') : ''
  }
  window.__notes = []
  window.__note = (quoi, e) => window.__notes.push(quoi + (window.__dansCopie(e.currentTarget) ? '@copie' : '@original') + (e.isTrusted ? '' : '~'))
  window.__envois = []
  window.__envoi = (e) => window.__envois.push((window.__dansCopie(e.target) ? 'copie' : 'original') + ':' + new FormData(e.target).get('q'))
  // un début de sélection ne sort pas de l'ombre (\`selectstart\` n'est pas \`composed\`) : écouté sur celle de la vitrine
  window.__choix = 0
  window.__ecouterChoix = () => window.__v().addEventListener('selectstart', (e) => { if (window.__dansCopie(e.target)) window.__choix++ }, true)
  window.__suivis = []
  const observe = MutationObserver.prototype.observe
  const disconnect = MutationObserver.prototype.disconnect
  MutationObserver.prototype.observe = function(n, o) { window.__suivis.push([this, n]); return observe.call(this, n, o) }
  MutationObserver.prototype.disconnect = function() { window.__suivis = window.__suivis.filter(s => s[0] !== this); return disconnect.call(this) }
  window.__ecoutes = []
  const ajoute = EventTarget.prototype.addEventListener
  const retire = EventTarget.prototype.removeEventListener
  const cap = (o) => !!(o === true || (o && o.capture))
  EventTarget.prototype.addEventListener = function(t, f, o) { if (this.nodeType === 1 || this.nodeType === 11) window.__ecoutes.push([this, t, f, cap(o)]); return ajoute.call(this, t, f, o) }
  EventTarget.prototype.removeEventListener = function(t, f, o) { const i = window.__ecoutes.findIndex(x => x[0] === this && x[1] === t && x[2] === f && x[3] === cap(o)); if (i >= 0) window.__ecoutes.splice(i, 1); return retire.call(this, t, f, o) }
})()`

type Appli = { nom: string, env: 'dev' | 'prod' }
const APPLIS: Appli[] = [{ nom: 'développement', env: 'dev' }, { nom: 'production', env: 'prod' }]

const scripts: Record<string, Promise<string>> = {}
function construire(appli: Appli): Promise<string> {
  scripts[appli.env] ??= (async () => {
    const root   = mjsTmp('marquee-interactives-' + appli.env)
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

describe('*marquee — les copies sont de vraies copies : miroirs vivants des composants, contenu ordinaire qui se comporte comme l\'original, accessibles comme le reste (navigateurs réels)', function () {
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
        it(appli.nom, async () => {
          const script = await construire(appli)
          const page   = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage()
          const erreurs: string[]  = []
          const avis: string[]     = []
          const requetes: string[] = []
          const corps: string[]    = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => {
            if (m.type() === 'error') erreurs.push(m.text())
            else if (m.type() === 'warning' && m.text().startsWith('[ModularJS]')) avis.push(m.text())
          })
          await page.addInitScript(AIDES)
          await page.route('http://t.test/**', (route: any) => {
            const url = new URL(route.request().url())
            if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><mjs-vitrine></mjs-vitrine><script>${script}</script></body></html>` })
            requetes.push(route.request().method() + ' ' + url.pathname)
            if (url.pathname === '/envoyer') {
              corps.push(route.request().postData() || '')
              return route.fulfill({ contentType: 'text/html', body: '<p>ENVOYÉ</p>' })
            }
            if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' })
            return route.fulfill({ contentType: 'application/json', body: '{}' })
          })
          try {
            await page.goto('http://t.test/', { waitUntil: 'load' })
            await page.waitForFunction(`window.__v() && ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'].every(c => window.__bande(c) && window.__copies(c).length > 0)`, null, { timeout: 20000 })
            await page.waitForTimeout(600)
            await page.evaluate('window.__ecouterChoix()')
            const echecs: string[] = []
            const ok = (cond: boolean, msg: string) => { if (!cond) echecs.push(msg) }
            const lit = (js: string) => page.evaluate(js)
            const repos = async () => {
              await lit('document.activeElement && document.activeElement.blur && document.activeElement.blur(); getSelection().removeAllRanges()')
              await page.mouse.move(990, 790)
              await page.waitForTimeout(150)
            }
            const compteurs = `[window.__run('b1').querySelector(':scope > mjs-compteur')].concat(window.__copies('b1').map(k => k.querySelector('mjs-compteur')))`
            const lireCompteurs = (sel: string, prop: string) => lit(`${compteurs}.map(h => h ? window.__ombre(h)?.querySelector('${sel}')?.${prop} ?? null : null)`)
            const champs = (c: string, sel: string, prop: string) => lit(`[window.__run('${c}').querySelector(':scope > ${sel}')].concat(window.__copies('${c}').map(k => k.querySelector('${sel}'))).map(n => n ? String(n.${prop}) : null)`)
            const pareils = (l: any[], v: any) => l.length > 1 && l.every((x) => x === v)

            // 5 (d'abord, avant tout clic) : ni inert, ni aria-hidden ; l'arbre d'accessibilité contient les copies (Chromium)
            const marques = await lit(`['b1', 'b2', 'b3', 'b4'].flatMap(c => window.__copies(c)).map(k => (k.hasAttribute('inert') ? 'inert ' : '') + (k.hasAttribute('aria-hidden') ? 'aria-hidden' : '')).filter(Boolean)`)
            ok(marques.length === 0, `aucune copie n'est inerte ni cachée à la lecture d'écran : ${marques.join(' | ')}`)
            const nbCopies = await lit(`window.__copies('b2').length`)
            if (nom === 'chromium') {
              const cdp = await page.context().newCDPSession(page)
              const { nodes } = await cdp.send('Accessibility.getFullAXTree')
              const vus = nodes.filter((n: any) => !n.ignored && n.role?.value === 'button' && n.name?.value === 'Bouton').length
              ok(vus === 1 + nbCopies, `l'arbre d'accessibilité voit le bouton de l'original et celui de chaque copie : ${vus} pour ${1 + nbCopies}`)
            }

            // 1 : la copie du compteur est son miroir vivant
            const miroirs = await lit(`${compteurs}.map(h => h ? h.isMirror : null)`)
            ok(miroirs[0] === false && miroirs.length > 1 && miroirs.slice(1).every((m: any) => m === true), `la copie du compteur est un miroir (isMirror), l'original non : ${JSON.stringify(miroirs)}`)
            const plus = await lit(`window.__cible('b1', '.plus', true)`)
            ok(!!plus, 'un « +1 » de copie visible dans la bande')
            if (plus) {
              await page.mouse.move(plus.x, plus.y, { steps: 3 })
              await page.waitForTimeout(250)
              const survol = await lit(`(() => { const b = window.__copies('b1').map(k => window.__ombre(k.querySelector('mjs-compteur'))?.querySelector('.plus')).filter(Boolean).find(n => n.matches(':hover')); return b ? getComputedStyle(b).backgroundColor : null })()`)
              ok(survol === 'rgb(0, 128, 0)', `le survol touche le « +1 » de la copie (:hover) : ${survol}`)
              await page.mouse.down()
              await page.waitForTimeout(100)
              const appui = await lit(`window.__copies('b1').some(k => window.__ombre(k.querySelector('mjs-compteur'))?.querySelector('.plus')?.matches(':active'))`)
              ok(appui === true, 'l\'appui touche le « +1 » de la copie (:active)')
              await page.mouse.up()
              await page.waitForTimeout(300)
              const n = await lireCompteurs('.n', 'textContent')
              ok(pareils(n, '1'), `« +1 » cliqué dans une copie : le compteur monte partout : ${JSON.stringify(n)}`)
            }
            await repos()
            const nomC = await lit(`window.__cible('b1', '.nom', true)`)
            ok(!!nomC, 'le champ d\'un miroir visible dans la bande')
            if (nomC) {
              await page.mouse.click(nomC.x, nomC.y)
              await page.keyboard.type('Zo')
              await page.waitForTimeout(300)
              const v = await lireCompteurs('.nom', 'value')
              ok(pareils(v, 'Zo'), `la saisie dans le champ d'un miroir arrive à l'état commun : ${JSON.stringify(v)}`)
            }
            await repos()

            // 2 : le contenu ordinaire
            const bouton = await lit(`window.__cible('b2', '.b')`)
            ok(!!bouton, 'un bouton de copie visible dans la bande')
            if (bouton) {
              await page.mouse.click(bouton.x, bouton.y)
              await page.waitForTimeout(200)
              const f = await lit('window.__focus()')
              ok(f === 'copie:button.b' || nom === 'webkit', `un clic sur le bouton d'une copie y pose le focus : ${f}`)
            }
            const ligne = await lit(`window.__cible('b2', '.l', false, 1)`)
            ok(!!ligne, 'la seconde ligne d\'une copie visible dans la bande')
            if (ligne) {
              await page.mouse.click(ligne.x, ligne.y)
              await page.waitForTimeout(200)
            }
            const notes = await lit('window.__notes.splice(0)')
            ok(JSON.stringify(notes) === JSON.stringify(['bouton@copie', 'ligne2@copie']), `le bouton et la ligne d'une copie déclenchent le gestionnaire du gabarit, sur la copie, une fois chacun : ${JSON.stringify(notes)}`)
            await repos()
            const sel = await lit(`window.__cible('b2', '.sel')`)
            ok(!!sel, 'un texte de copie visible dans la bande')
            if (sel) {
              await page.mouse.dblclick(sel.x, sel.y)
              await page.waitForTimeout(200)
              const choix = await lit('window.__choix')
              ok(choix > 0, `le texte d'une copie se sélectionne : ${choix} début(s) de sélection`)
            }
            await repos()
            const lien = await lit(`window.__cible('b2', '.lien')`)
            ok(!!lien, 'un lien de copie visible dans la bande')
            if (lien) {
              await page.mouse.click(lien.x, lien.y)
              await page.waitForTimeout(300)
              const h = await lit('location.hash')
              ok(h === '#ailleurs', `le lien d'une copie mène où mène l'original : « ${h} »`)
            }
            await repos()

            const gl = await lit(`window.__cible('b7', '.gl')`)
            ok(!!gl, 'un bouton glissé de copie visible dans la bande')
            if (gl) {
              await page.mouse.click(gl.x, gl.y)
              await page.waitForTimeout(200)
              const g = await lit('window.__notes.splice(0)')
              ok(JSON.stringify(g) === JSON.stringify(['glisse@copie']), `le bouton glissé dans un composant d'une copie joue le gestionnaire du gabarit, sur la copie : ${JSON.stringify(g)}`)
            }
            const lb = await lit(`window.__cible('b7', '.lb')`)
            ok(!!lb, 'le bouton d\'un composant léger de copie visible dans la bande')
            if (lb) {
              await page.mouse.click(lb.x, lb.y)
              await page.waitForTimeout(300)
              const v = await lit(`[window.__run('b7').querySelector(':scope > mjs-leger')].concat(window.__copies('b7').map(k => k.querySelector('mjs-leger'))).map(h => h ? (h.isMirror ? 'M:' : 'O:') + h.querySelector('.lb')?.textContent : null)`)
              ok(v.length > 1 && v[0] === 'O:léger 1' && v.slice(1).every((x: any) => x === 'M:léger 1'), `la copie d'un composant léger est son miroir, un clic y agit partout : ${JSON.stringify(v)}`)
            }
            await repos()

            // 3 : les champs
            const t = await lit(`window.__cible('b3', '.t')`)
            ok(!!t, 'le champ lié d\'une copie visible dans la bande')
            if (t) {
              await page.mouse.click(t.x, t.y)
              await page.keyboard.press('End')
              await page.keyboard.type('XY')
              await page.waitForTimeout(300)
              const vu = await lit(`window.__v().querySelector('.vu').textContent`)
              ok(vu === 'départXY', `la saisie dans le champ lié d'une copie arrive à l'état : « ${vu} »`)
              const v = await champs('b3', '.t', 'value')
              ok(pareils(v, 'départXY'), `l'original et toutes les copies du champ lié montrent la saisie : ${JSON.stringify(v)}`)
            }
            await repos()
            const u = await lit(`window.__cible('b3', '.u')`)
            ok(!!u, 'le champ libre d\'une copie visible dans la bande')
            if (u) {
              await page.mouse.click(u.x, u.y)
              await page.keyboard.press('End')
              await page.keyboard.type('Q')
              await page.waitForTimeout(300)
              const v = await champs('b3', '.u', 'value')
              ok(pareils(v, 'libreQ'), `la saisie dans le champ libre d'une copie arrive à l'original et aux autres copies : ${JSON.stringify(v)}`)
            }
            await repos()
            const rb = await lit(`window.__cible('b3', '.rb')`)
            ok(!!rb, 'un bouton radio de copie visible dans la bande')
            if (rb) {
              await page.mouse.click(rb.x, rb.y)
              await page.waitForTimeout(300)
              const a = await champs('b3', '.ra', 'checked')
              const b = await champs('b3', '.rb', 'checked')
              ok(pareils(a, 'false') && pareils(b, 'true'), `le bouton radio choisi dans une copie l'est dans l'original et dans chaque copie : ${JSON.stringify({ a, b })}`)
            }
            await repos()

            // 4 : un formulaire copié est un vrai formulaire
            const forme = await lit(`window.__copies('b4').map(k => { const f = k.querySelector('form'); return f ? f.getAttribute('method') + '/' + [...f.elements].map(e => e.name).filter(Boolean).join(',') : null })`)
            ok(pareils(forme, 'post/q'), `le formulaire d'une copie garde sa méthode et ses champs nommés : ${JSON.stringify(forme)}`)
            const envoi = await lit(`window.__cible('b4', '.ok')`)
            ok(!!envoi, 'le bouton d\'envoi d\'une copie visible dans la bande')
            if (envoi) {
              await page.mouse.click(envoi.x, envoi.y)
              await page.waitForTimeout(300)
              const e = await lit('window.__envois.splice(0)')
              ok(JSON.stringify(e) === JSON.stringify(['copie:7']), `le bouton d'envoi d'une copie passe par le gestionnaire @submit, une fois, avec ses données : ${JSON.stringify(e)}`)
              ok(page.url() === 'http://t.test/#ailleurs', `la page reste : ${page.url()}`)
            }
            await repos()

            // 5 : la touche Tab s'arrête dans les copies
            const arrets: string[] = []
            for (let i = 0; i < 30; i++) {
              await page.keyboard.press('Tab')
              arrets.push(await lit('window.__focus()'))
            }
            const enCopie = arrets.filter((a) => a.startsWith('copie:'))
            ok(enCopie.length > 0, `la touche Tab s'arrête dans les copies : ${[...new Set(arrets)].join(' ')}`)
            await repos()

            // 6 : les requêtes au montage
            const miroirsMontes = (miroirs as any[]).length - 1
            const donnees = requetes.filter((r) => r === 'GET /donnees').length
            const sage = requetes.filter((r) => r === 'GET /sage').length
            ok(donnees === 1 + miroirsMontes && sage === 1, `le µmount de chaque miroir fait sa requête, sauf celle gardée par @@isMirror : /donnees ${donnees} pour ${1 + miroirsMontes}, /sage ${sage}`)

            // 7 : le retrait de l'effet (développement : la fonction de retrait est lisible)
            if (appli.env === 'dev') {
              const r = await lit(`(() => {
                const b = window.__bande('b1')
                const run = window.__run('b1')
                const orig = run.querySelector(':scope > mjs-compteur')
                const miroirs = window.__copies('b1').map(k => k.querySelector('mjs-compteur'))
                const effet = new Set(window.__suivis.filter(s => s[1] === run || s[1] === b).map(s => s[0]))
                const groupe = orig._mjs_twins ? orig._mjs_twins.m.length : -1
                const racine = b.getRootNode()
                const avant = window.__ecoutes.filter(x => x[0] === b).length
                const racineAvant = window.__ecoutes.filter(x => x[0] === racine && x[1] === 'reset').length
                b._mjs_fxOff.marquee()
                return { groupe, avant, effet: effet.size, miroirs: miroirs.length, connectes: miroirs.filter(h => h.isConnected).length, copies: b.querySelectorAll('[mjs-fx-marquee-copy]').length, restants: window.__suivis.filter(s => effet.has(s[0])).length, ecoutes: window.__ecoutes.filter(x => x[0] === b).map(x => x[1]), racine: racineAvant - window.__ecoutes.filter(x => x[0] === racine && x[1] === 'reset').length, groupeApres: orig._mjs_twins ? orig._mjs_twins.m.length : -1, rendu: b.querySelector(':scope > mjs-compteur') === orig }
              })()`)
              ok(r.groupe === 1 + r.miroirs, `avant le retrait, le groupe de l'original compte l'original et ses miroirs : ${JSON.stringify(r)}`)
              ok(r.miroirs >= 1 && r.connectes === 0 && r.copies === 0 && r.rendu, `après le retrait, copies et miroirs sont sortis, le compteur est rendu à la bande : ${JSON.stringify(r)}`)
              ok(r.groupeApres === 1, `après le retrait, les miroirs ont quitté le groupe de l'original : ${JSON.stringify(r)}`)
              ok(r.effet >= 1 && r.restants === 0, `après le retrait, aucun observateur de l'effet : ${JSON.stringify(r)}`)
              ok(r.avant >= 1 && r.ecoutes.length === 0 && r.racine === 1, `après le retrait, aucun écouteur de l'effet sur la bande, le sien retiré de sa racine : ${JSON.stringify(r)}`)
            }

            // 8 : le lien @method / @confirm d'une copie : une question, une requête DELETE, la page reste
            const n0 = requetes.length
            if (appli.env === 'dev') await lit('window.µ.config.confirm = false; window.__questions = []; window.confirm = (m) => { window.__questions.push(m); return true }')
            const suppr = await lit(`window.__cible('b5', '.suppr')`)
            ok(!!suppr, 'un lien de copie visible dans la bande')
            if (suppr) {
              await page.mouse.click(suppr.x, suppr.y)
              await page.waitForTimeout(600)
              let questions = 0
              if (appli.env === 'dev') questions = await lit('window.__questions.length')
              else {
                questions = await lit(`document.querySelectorAll('.mjs-modal-box').length`)
                if (questions) {
                  await page.click('.mjs-modal-confirm')
                  await page.waitForTimeout(600)
                }
              }
              const apres = requetes.slice(n0)
              ok(questions === 1, `une question pour le lien de la copie : ${questions}`)
              ok(apres.filter((r) => r === 'DELETE /articles/1').length === 1 && apres.filter((r) => r.startsWith('GET ')).length === 0, `une requête DELETE, aucune navigation : ${apres.join(' | ')}`)
              ok(page.url() === 'http://t.test/#ailleurs', `la page reste : ${page.url()}`)
            }

            // 9 : Entrée dans le champ d'un formulaire copié l'envoie, une fois, avec ses valeurs (la page part : en dernier)
            ok(erreurs.length === 0, `aucune erreur dans la page : ${erreurs.join(' | ')}`)
            const note = await lit(`window.__cible('b6', '.note')`)
            ok(!!note, 'le champ d\'un formulaire copié visible dans la bande')
            if (note) {
              await page.mouse.click(note.x, note.y)
              await Promise.all([page.waitForURL('http://t.test/envoyer', { timeout: 10000 }).catch(() => null), page.keyboard.press('Enter')])
              await page.waitForTimeout(300)
              ok(JSON.stringify(corps) === JSON.stringify(['id=7&note=5']), `le formulaire copié part une fois, avec les valeurs de l'original : ${JSON.stringify(corps)}`)
            }
            ok(avis.length === 0, `aucun avertissement : ${avis.join(' | ')}`)
            assert.deepEqual(echecs, [])
          }
          finally {
            await page.context().close()
          }
        })
      }
    })
  }
})
