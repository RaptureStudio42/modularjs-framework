// *marquee dans Chromium, Firefox et WebKit réels (WebKit seulement s'il est installé) : les copies posées pendant le premier rendu du composant, sous son
// bouclier d'attente (la balise y a déjà sa taille), sont justes dès la première image. En développement et en production (le cœur et l'effet minifiés ensemble).
//   1. la valeur que le gabarit lie à un champ (`value=!{…}` d'un champ de texte, d'une zone de texte et d'une liste, `checked=!{…}` d'une case) n'est posée
//      qu'après la pose de l'effet, en propriété, que l'observateur des copies ne voit pas : chaque copie la montre pourtant dès la première image où la bande
//      a des copies, et toutes les images suivantes ;
//   2. ce rattrapage ne refait pas les copies : chaque copie posée dans la page y reste (aucune n'est retirée, aucune n'est posée deux fois) ;
//   3. la copie d'une ligne de `{for}` qui ne lit que son élément (son gestionnaire relit l'élément sur la ligne d'origine) : un clic joue le gestionnaire du
//      gabarit avec l'élément de SA ligne, sur la copie, une fois ;
//   4. une saisie au bout du champ lié d'une copie arrive à l'état à la suite de la valeur de départ.
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

const SOURCE = [
  '<script>',
  '  $texte = \'départ\'',
  '  $coche = true',
  '  $choix = \'b\'',
  '  $items = [{ n: 1 }, { n: 2 }]',
  '  @note = (quoi, e) -> window.__note(quoi, e)',
  '</script>',
  '<div class="champs" *marquee(unit: child, speed: 900s)>',
  '  <input class="t" aria-label="texte" value=!{$texte}>',
  '  <input class="c" type="checkbox" aria-label="coche" checked=!{$coche}>',
  '  <select class="s" aria-label="choix" value=!{$choix}><option value="a">a</option><option value="b">b</option></select>',
  '  <textarea class="z" aria-label="zone" value=!{$texte}></textarea>',
  '</div>',
  '<div class="lignes" *marquee(unit: child, speed: 900s, gap: 8)>',
  '  {for it in $items}',
  '    <button class="l" @click={@note(\'ligne\' + it.n, e)}>Ligne {it.n}</button>',
  '  {end}',
  '</div>',
  '<p class="vu">{$texte}</p>',
  '<style>',
  '.champs, .lignes',
  '  width: 900px',
  '  margin: 10px 0',
  '.t, .z',
  '  width: 110px',
  '.l',
  '  width: 70px',
  '</style>',
  ''
].join('\n')

// les aides de la page, posées avant tout script : l'ombre (fermée) de chaque composant est retenue et suivie dès sa création (les copies qui y sont posées,
// celles qui en partent) ; après chaque image dessinée, un relevé des copies des champs liés
const AIDES = `(() => {
  window.__ombres = new Map()
  // chaque copie vue dans la page, chaque copie qui en est partie (une copie refaite est une copie neuve, l'ancienne part)
  window.__posees = new Set()
  window.__retirees = new Set()
  const copie = (n) => n.nodeType === 1 && n.hasAttribute('mjs-fx-marquee-copy')
  // les copies d'un nœud posé ou retiré : lui-même, et celles qu'il porte (un gabarit posé d'un bloc dans l'ombre arrive avec ses bandes)
  const copiesDe = (n) => n.nodeType === 1 ? (copie(n) ? [n] : []).concat([...n.querySelectorAll('[mjs-fx-marquee-copy]')]) : []
  const suivi = new MutationObserver((list) => {
    for (const r of list) {
      for (const n of r.addedNodes) for (const k of copiesDe(n)) window.__posees.add(k)
      for (const n of r.removedNodes) for (const k of copiesDe(n)) window.__retirees.add(k)
    }
  })
  const attache = Element.prototype.attachShadow
  Element.prototype.attachShadow = function(o) {
    const r = attache.call(this, o)
    window.__ombres.set(this, r)
    suivi.observe(r, { childList: true, subtree: true })
    return r
  }
  window.__v = () => window.__ombres.get(document.querySelector('mjs-vitrine'))
  window.__run = (c) => window.__v()?.querySelector('.' + c + ' > [mjs-fx-marquee-run]')
  window.__copies = (c) => { const r = window.__run(c); return r ? [...r.querySelectorAll(':scope > [mjs-fx-marquee-copy]')] : [] }
  window.__champs = () => window.__copies('champs').map(k => [k.querySelector('.t')?.value, k.querySelector('.c')?.checked, k.querySelector('.s')?.value, k.querySelector('.z')?.value].join('|'))
  window.__images = []
  const releve = () => {
    const h = document.querySelector('mjs-vitrine')
    window.__images.push({ cache: !h || h.hasAttribute('mjs-loading'), champs: window.__v() ? window.__champs() : [] })
  }
  // le relevé suit le dessin de l'image : un message posté depuis l'image arrive une fois celle-ci dessinée
  const suivre = () => requestAnimationFrame(() => {
    const c = new MessageChannel()
    c.port1.onmessage = () => {
      releve()
      if (window.__images.length < 40) suivre()
    }
    c.port2.postMessage(0)
  })
  suivre()
  window.__notes = []
  window.__dansCopie = (n) => { for (let x = n; x; x = x.parentNode || x.host) if (copie(x)) return true; return false }
  window.__note = (quoi, e) => window.__notes.push(quoi + (window.__dansCopie(e.currentTarget) ? '@copie' : '@original'))
  // dans une copie : le \`rang\`-ième nœud \`sel\`, entièrement visible dans la bande
  window.__cible = (c, sel, rang) => {
    const b = window.__v().querySelector('.' + c).getBoundingClientRect()
    for (const k of window.__copies(c)) {
      const n = k.querySelectorAll(sel)[rang || 0]
      if (!n) continue
      const r = n.getBoundingClientRect()
      if (r.width > 0 && r.left >= b.left + 4 && r.right <= b.right - 4) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }
    return null
  }
})()`

type Appli = { nom: string, env: 'dev' | 'prod' }
const APPLIS: Appli[] = [{ nom: 'développement', env: 'dev' }, { nom: 'production', env: 'prod' }]

const scripts: Record<string, Promise<string>> = {}
function construire(appli: Appli): Promise<string> {
  scripts[appli.env] ??= (async () => {
    const root   = mjsTmp('marquee-premier-rendu-' + appli.env)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'vitrine.mjs'), SOURCE)
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

describe('*marquee — les copies posées pendant le premier rendu, sous le bouclier, sont justes dès la première image : valeurs liées des champs, lignes de {for} (navigateurs réels)', function () {
  this.timeout(300000)

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
          const page   = await (await browser.newContext({ viewport: { width: 1000, height: 600 } })).newPage()
          const erreurs: string[] = []
          const avis: string[]    = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => {
            if (m.type() === 'error') erreurs.push(m.text())
            else if (m.type() === 'warning' && m.text().startsWith('[ModularJS]')) avis.push(m.text())
          })
          await page.addInitScript(AIDES)
          await page.route('http://t.test/**', (route: any) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><mjs-vitrine></mjs-vitrine><script>${script}</script></body></html>` }))
          try {
            await page.goto('http://t.test/', { waitUntil: 'load' })
            await page.waitForFunction(`window.__copies('champs').length > 0 && window.__copies('lignes').length > 0 && window.__images.length >= 40`, null, { timeout: 20000 })
            const echecs: string[] = []
            const ok = (cond: boolean, msg: string) => { if (!cond) echecs.push(msg) }
            const lit = (js: string) => page.evaluate(js)

            // 1 : chaque image où la bande a des copies les montre avec les valeurs liées de l'original
            const attendu = 'départ|true|b|départ'
            const images: Array<{ cache: boolean, champs: string[] }> = await lit('window.__images')
            const avecCopies = images.filter((i) => i.champs.length > 0)
            const fausses = avecCopies.filter((i) => !i.champs.every((c) => c === attendu))
            ok(avecCopies.length > 0, `des images dessinées avec les copies des champs : ${images.length} images relevées`)
            ok(fausses.length === 0, `dès la première image où la bande a des copies, chaque copie montre les valeurs liées de l'original (${attendu}) : ${fausses.length} image(s) sur ${avecCopies.length} sans elles, la première : ${JSON.stringify(fausses[0] ?? null)}`)

            // 2 : les copies ne sont pas refaites
            const compte = await lit(`(() => { const la = window.__copies('champs').concat(window.__copies('lignes')); return { posees: window.__posees.size, retirees: window.__retirees.size, la: la.length, vues: la.filter(k => window.__posees.has(k)).length } })()`)
            ok(compte.la > 0 && compte.retirees === 0 && compte.posees === compte.la && compte.vues === compte.la, `chaque copie posée reste, aucune n'est refaite : ${JSON.stringify(compte)}`)

            // 3 : la copie d'une ligne pure joue le gestionnaire avec l'élément de sa ligne
            const ligne = await lit(`window.__cible('lignes', '.l', 1)`)
            ok(!!ligne, 'la seconde ligne d\'une copie visible dans la bande')
            if (ligne) {
              await page.mouse.click(ligne.x, ligne.y)
              await page.waitForTimeout(200)
              const notes = await lit('window.__notes.splice(0)')
              ok(JSON.stringify(notes) === JSON.stringify(['ligne2@copie']), `un clic sur la seconde ligne d'une copie joue le gestionnaire avec l'élément de sa ligne, sur la copie, une fois : ${JSON.stringify(notes)}`)
            }

            // 4 : la saisie au bout du champ lié d'une copie suit la valeur de départ
            const t = await lit(`window.__cible('champs', '.t')`)
            ok(!!t, 'le champ lié d\'une copie visible dans la bande')
            if (t) {
              await page.mouse.click(t.x, t.y)
              await page.keyboard.press('End')
              await page.keyboard.type('XY')
              await page.waitForTimeout(300)
              const vu = await lit(`window.__v().querySelector('.vu').textContent`)
              ok(vu === 'départXY', `la saisie au bout du champ lié d'une copie arrive à l'état : « ${vu} »`)
            }

            ok(erreurs.length === 0, `aucune erreur dans la page : ${erreurs.join(' | ')}`)
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
