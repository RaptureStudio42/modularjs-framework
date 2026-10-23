// *spotlight (halo) dans Chromium, Firefox et WebKit réels : l'entrée de la souris allume le halo, à chaque fois, et la lumière se pose sur la dernière position.
// Le halo s'allume par un fondu d'opacité (0,3 s) de son pseudo-élément, que la souris déplace en même temps par les images clés d'une animation Web du même pseudo-élément.
// Firefox perdait le fondu quand ces images clés changeaient dans le gestionnaire du mouvement de la souris pendant qu'il courait : l'opacité du pseudo-élément restait à 0
// (ou à mi-course, sans transition en cours) tant que la souris était sur la carte, sans se rattraper ni au mouvement suivant — une entrée sur deux pour un geste de vingt pas.
// Les images clés changent maintenant une fois par image, juste avant le dessin, la dernière position gagnant — que le mouvement vienne de la souris ou d'un rayon que l'application change dans son gestionnaire.
// - vingt pas, trente entrées de suite, sur une carte dont l'arrondi change au survol, sur un halo seul et sur un halo seul dont le rayon est une variable que l'application change à chaque mouvement : le halo est allumé à chaque fois, sous la souris à sa dernière position ;
// - un mouvement, la sortie, la rentrée ailleurs et deux mouvements dans la même image : l'image demandée avant la sortie est défaite, le halo est à la dernière position ;
// - plusieurs mouvements dans une même image : une image demandée, une écriture, la dernière position ; la souris immobile, au repos et après la sortie : aucune image demandée ;
// - dix allers-retours, et un retrait avec une image en attente : rien ne reste (ni animation, ni image demandée, ni écriture).
// Aucune attente n'est un délai : chacune est une condition de l'état de la page, de sorte que la charge de la machine ne change pas le verdict.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
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

// quatre cartes blanches éclairées en rouge opaque : l'écriture par défaut (halo et liseré) avec un arrondi qui change au survol, la même sans rien qui change, le halo seul,
// et le halo seul dont le rayon est une variable que l'application change à chaque mouvement de la souris
const DEFAUT = '*spotlight(color: #f00, fill: 1, size: 400)'
const SEUL   = '*spotlight(where: fill, color: #f00, fill: 1, size: 400)'
const RAYON  = '*spotlight(where: fill, color: #f00, fill: 1, size: 400, radius: $r)'
const PAGE   = `<script>
$r = 12
</script>
<div class="carte arrondie" ${DEFAUT}></div>
<div class="carte fixe" ${DEFAUT}></div>
<div class="carte seule" ${SEUL}></div>
<div class="carte rayon" ${RAYON} @pointermove={$r = 12 + (e.offsetX % 20)}></div>
<style>
:host
  display: block
.carte
  box-sizing: border-box
  position: relative
  width: 265px
  height: 130px
  margin: 20px
  background: #fff
  border-radius: 12px
.arrondie
  transition: border-radius .6s linear
  &:hover
    border-radius: 40px
</style>
`

const TAG   = 'mjs-h-allume'
const CARTE = (classe: string) => `document.querySelector('${TAG}')._shadow.querySelector('.${classe}')`

// le halo est au repos : la souris dehors, rien de promu, le fondu fini (son opacité calculée vaut 0)
const REPOS  = (classe: string) => `(() => { const c = ${CARTE(classe)}; return !c.matches(':hover') && !c.hasAttribute('mjs-fx-live') && +getComputedStyle(c, '::after').opacity === 0 })()`
// le halo est allumé : l'opacité calculée du pseudo-élément a atteint 1 (un fondu perdu la laisse à 0 ou à mi-course, sans transition en cours)
const ALLUME = (classe: string) => `+getComputedStyle(${CARTE(classe)}, '::after').opacity >= 0.95`
// la place du halo (le `translate` de son pseudo-élément) est à moins de 1,5 px du point (x, y) de la carte
const SOUS   = (classe: string, x: number, y: number) => `(() => { const t = getComputedStyle(${CARTE(classe)}, '::after').translate.split(' ').map(parseFloat); return Math.abs(t[0] - ${x}) < 1.5 && Math.abs(t[1] - ${y}) < 1.5 })()`
// les animations Web du pseudo-élément du halo (hors transition d'opacité)
const ANIMS  = (classe: string) => `${CARTE(classe)}.getAnimations({ subtree: true }).filter((x) => x.effect && x.effect.pseudoElement === '::after' && !(x instanceof CSSTransition)).length`
const BOITE  = (classe: string) => `(() => { const r = ${CARTE(classe)}.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`

// n mouvements de la souris dans la même tâche (donc dans la même image), le dernier au point (x, y) de la carte ; `retire` ôte ensuite le composant, dans la même tâche
const RAFALE = (classe: string, n: number, x: number, y: number, retire = false) => `(() => {
  const c = ${CARTE(classe)}
  const r = c.getBoundingClientRect()
  for (let i = 1; i <= ${n}; i++) {
    const k = i / ${n}
    c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'mouse', clientX: r.left + ${x} * k + 30 * (1 - k), clientY: r.top + ${y} * k + 20 * (1 - k) }))
  }
  ${retire ? `document.querySelector('${TAG}').remove()` : ''}
})()`

// dans la même tâche (donc dans la même image) : un mouvement, la sortie, la rentrée au point (200, 100) de la carte, puis deux mouvements, le dernier au point (220, 110)
const SORTIE_RENTREE = (classe: string) => `(() => {
  const c = ${CARTE(classe)}
  const r = c.getBoundingClientRect()
  const ev = (type, x, y) => new PointerEvent(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave', pointerId: 1, pointerType: 'mouse', clientX: r.left + x, clientY: r.top + y })
  c.dispatchEvent(ev('pointermove', 60, 50))
  c.dispatchEvent(ev('pointerleave', 60, 50))
  c.dispatchEvent(ev('pointerenter', 200, 100))
  c.dispatchEvent(ev('pointermove', 200, 100))
  c.dispatchEvent(ev('pointermove', 220, 110))
})()`

// les sondes, posées avant la page : images demandées, images exécutées, écritures des images clés ; `images` compte les images AFFICHÉES depuis la remise à zéro,
// par une boucle à part qui appelle le vrai `requestAnimationFrame` (la sonde ne la compte pas)
const SONDE = `(() => {
  const S = window.__sonde = { actif: false, raf: 0, rappels: 0, ecrit: 0, images: 0, gen: 0 }
  const raf = window.requestAnimationFrame.bind(window)
  S.vraiRaf = raf
  window.requestAnimationFrame = (cb) => { if (S.actif) S.raf++; return raf((t) => { if (S.actif) S.rappels++; cb(t) }) }
  const sk = KeyframeEffect.prototype.setKeyframes
  KeyframeEffect.prototype.setKeyframes = function() { if (S.actif) S.ecrit++; return sk.apply(this, arguments) }
})()`
const RAZ  = '(() => { const S = window.__sonde; S.raf = S.rappels = S.ecrit = S.images = 0; S.actif = true; const g = ++S.gen; const c = () => { if (!S.actif || S.gen !== g) return; S.images++; S.vraiRaf(c) }; S.vraiRaf(c) })()'
const LIRE = '(() => { const S = window.__sonde; S.actif = false; return { raf: S.raf, rappels: S.rappels, ecrit: S.ecrit, images: S.images } })()'

// l'état du halo quand il ne s'allume pas : le survol, les attributs de l'effet, le pseudo-élément et ses animations (de quoi dire pourquoi)
const ETAT = (classe: string) => `(() => {
  const c = ${CARTE(classe)}
  const a = getComputedStyle(c, '::after')
  return JSON.stringify({
    survol: c.matches(':hover'),
    attributs: c.getAttributeNames().filter((n) => /^mjs-fx/.test(n)),
    apres: [a.opacity, a.translate, a.clipPath],
    animations: c.getAnimations({ subtree: true }).map((x) => [x.constructor.name, x.transitionProperty || x.animationName || '', x.playState, (x.effect && x.effect.pseudoElement) || ''])
  })
})()`

const vu = (l: any, cles: string[]) => cles.map((k) => l[k])

describe('*spotlight : l\'entrée de la souris allume le halo, à chaque fois', function () {
  this.timeout(1800000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('spotlight-halo-allume')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'h-allume.mjs'), PAGE)
    // un seul fichier (le manifeste) : la pose est celle d'une application de production
    const manifeste = join(outDir, 'bundle.js')
    const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod' } as any)
    const stats     = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    script = stripEsm(readFileSync(manifeste, 'utf-8'))
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Navigateur[]) {
    describe(nom, function () {
      let browser: any

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { await browser?.close() })

      async function ouvre() {
        const contexte = await browser.newContext({ viewport: { width: 320, height: 700 } })
        const page     = await contexte.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        page.on('console', (m: any) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[ModularJS]'))) erreurs.push(m.text()) })
        await page.addInitScript(SONDE)
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${TAG}></${TAG}><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(`['arrondie', 'fixe', 'seule', 'rayon'].every((c) => document.querySelector('${TAG}')?._shadow?.querySelector('.' + c)?.hasAttribute('mjs-fx'))`, null, { timeout: 60000, polling: 50 })
        // trois images affichées : la pose est finie (hors fenêtre de sonde)
        await page.evaluate('new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => fin(0)))))')
        const boite  = (classe: string): Promise<any> => page.evaluate(BOITE(classe))
        // une condition de la page, attendue à intervalle fixe (jamais par requestAnimationFrame, que la sonde compterait) ; `delai` : le temps au-delà duquel la condition ne viendra plus
        const jusqua = (condition: string, delai = 120000) => page.waitForFunction(condition, null, { timeout: delai, polling: 50 })
        // ce que la page fait pendant n images affichées : la sonde remise à zéro, `pendant` fait, puis lue
        const fenetre = async (n: number, pendant?: () => Promise<unknown>): Promise<any> => {
          await page.evaluate(RAZ)
          if (pendant) await pendant()
          await page.waitForFunction(`window.__sonde.images >= ${n}`, null, { timeout: 180000, polling: 50 })
          return page.evaluate(LIRE)
        }
        // la souris dehors, à gauche de la carte, puis le halo revenu au repos
        const sort = async (classe: string) => {
          const b = await boite(classe)
          await page.mouse.move(b.x - 10, b.y + b.h / 2)
          await jusqua(REPOS(classe), 15000)
        }
        // la page est au repos : dix images affichées sans une image demandée ni une écriture
        const auRepos = async () => {
          let l: any
          for (let i = 0; i < 60; i++) {
            l = await fenetre(10)
            if (vu(l, ['raf', 'ecrit']).every((n) => n === 0)) return l
          }
          assert.fail('la page ne revient pas au repos : ' + JSON.stringify(l))
        }
        return { page, contexte, erreurs, boite, jusqua, fenetre, sort, auRepos }
      }

      for (const [classe, titre] of [['arrondie', 'halo et liseré, arrondi qui change au survol'], ['seule', 'halo seul'], ['rayon', 'halo seul, rayon changé par l\'application à chaque mouvement']] as const) {
        it(`vingt pas, trente entrées de suite (${titre}) : le halo est allumé à chaque fois, sous la souris à sa dernière position`, async function () {
          if (!browser) { this.skip(); return }
          const { page, contexte, erreurs, boite, jusqua, sort } = await ouvre()
          try {
            const b = await boite(classe)
            for (let i = 1; i <= 30; i++) {
              await sort(classe)
              await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 20 })
              try {
                await jusqua(ALLUME(classe), 10000)
              }
              catch {
                assert.fail(`entrée ${i} sur 30 : le halo reste éteint, la souris sur la carte : ` + await page.evaluate(ETAT(classe)))
              }
              try {
                await jusqua(SOUS(classe, b.w / 2, b.h / 2), 10000)
              }
              catch {
                assert.fail(`entrée ${i} sur 30 : le halo n'est pas sous la souris à sa dernière position : ` + await page.evaluate(ETAT(classe)))
              }
            }
            // le rayon est bien passé par la variable : sa dernière valeur (12 plus le reste de la position par 20) n'est plus celle de départ
            if (classe === 'rayon') assert.notEqual(await page.evaluate(`getComputedStyle(${CARTE(classe)}).borderTopLeftRadius`), '12px', 'la variable de rayon n\'a pas été changée par les mouvements')
            assert.deepEqual(erreurs, [])
          }
          finally {
            await contexte.close()
          }
        })
      }

      it('plusieurs mouvements dans une même image : une image demandée, une écriture, la dernière position ; la souris immobile, au repos et après la sortie : aucune image', async function () {
        if (!browser) { this.skip(); return }
        const { page, contexte, erreurs, boite, jusqua, fenetre, sort, auRepos } = await ouvre()
        try {
          const b = await boite('fixe')
          // au repos
          let l = await fenetre(10)
          assert.deepEqual(vu(l, ['raf', 'rappels', 'ecrit']), [0, 0, 0], 'au repos : ' + JSON.stringify(l))
          // la souris entre et reste immobile : une fois l'entrée faite, plus rien ne tourne
          await page.mouse.move(b.x - 10, b.y + b.h / 2)
          await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 4 })
          await jusqua(ALLUME('fixe'), 10000)
          l = await auRepos()
          assert.deepEqual(vu(l, ['raf', 'rappels', 'ecrit']), [0, 0, 0], 'la souris immobile sur la carte : ' + JSON.stringify(l))
          // dix mouvements dans la même tâche : une seule image, une seule écriture, la dernière position
          l = await fenetre(10, () => page.evaluate(RAFALE('fixe', 10, 60, 25)))
          assert.deepEqual(vu(l, ['raf', 'rappels', 'ecrit']), [1, 1, 1], 'dix mouvements dans une image : une image demandée, exécutée, une écriture : ' + JSON.stringify(l))
          await jusqua(SOUS('fixe', 60, 25), 10000)
          // la lumière reste où le dernier mouvement l'a laissée : la souris immobile, rien de plus
          l = await fenetre(10)
          assert.deepEqual(vu(l, ['raf', 'rappels', 'ecrit']), [0, 0, 0], 'après la rafale, la souris immobile : ' + JSON.stringify(l))
          // la sortie : une fois le halo au repos, plus rien ne tourne
          await sort('fixe')
          l = await fenetre(10)
          assert.deepEqual(vu(l, ['raf', 'rappels', 'ecrit']), [0, 0, 0], 'après la sortie : ' + JSON.stringify(l))
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })

      it('un mouvement, la sortie, la rentrée ailleurs et deux mouvements dans la même image : l\'image demandée avant la sortie est défaite, le halo est à la dernière position', async function () {
        if (!browser) { this.skip(); return }
        const { page, contexte, erreurs, boite, jusqua, auRepos } = await ouvre()
        try {
          const b = await boite('fixe')
          await page.mouse.move(b.x - 10, b.y + b.h / 2)
          await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 4 })
          await jusqua(ALLUME('fixe'), 10000)
          await auRepos()
          // l'image demandée par le premier mouvement n'a pas encore tourné quand la souris sort puis rentre : la demande de la rentrée ne doit pas se croire déjà faite
          await page.evaluate(SORTIE_RENTREE('fixe'))
          try {
            await jusqua(SOUS('fixe', 220, 110), 10000)
          }
          catch {
            assert.fail('la lumière n\'est pas au dernier point (220, 110) de la rentrée : ' + await page.evaluate(ETAT('fixe')))
          }
          await auRepos()
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })

      it('dix allers-retours de la souris : rien ne reste (ni animation sur le pseudo-élément, ni image demandée, ni écriture)', async function () {
        if (!browser) { this.skip(); return }
        const { page, contexte, erreurs, boite, jusqua, fenetre, sort } = await ouvre()
        try {
          const b = await boite('fixe')
          for (let i = 0; i < 10; i++) {
            await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 3 })
            await page.mouse.move(b.x - 10, b.y + b.h / 2, { steps: 2 })
          }
          await sort('fixe')
          assert.equal(await page.evaluate(ANIMS('fixe')), 0, 'aucune animation sur le pseudo-élément du halo')
          const l = await fenetre(10)
          assert.deepEqual(vu(l, ['raf', 'rappels', 'ecrit']), [0, 0, 0], 'après dix allers-retours : ' + JSON.stringify(l))
          // la souris revient : le halo s'allume encore
          await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 20 })
          await jusqua(ALLUME('fixe'), 10000)
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })

      it('le retrait de l\'effet avec une image en attente la défait : elle ne s\'exécute pas, rien n\'est écrit', async function () {
        if (!browser) { this.skip(); return }
        const { page, contexte, erreurs, boite, jusqua, fenetre, auRepos } = await ouvre()
        try {
          const b = await boite('fixe')
          await page.mouse.move(b.x - 10, b.y + b.h / 2)
          await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 4 })
          await jusqua(ALLUME('fixe'), 10000)
          await auRepos()
          // cinq mouvements puis le retrait du composant, dans la même tâche : l'image demandée par les mouvements n'a pas encore tourné
          const l = await fenetre(10, () => page.evaluate(RAFALE('fixe', 5, 60, 25, true)))
          assert.deepEqual(vu(l, ['rappels', 'ecrit']), [0, 0], 'l\'image en attente est défaite avec l\'effet : ' + JSON.stringify(l))
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })
    })
  }
})
