// La navigation de MJS prend un lien (zéro rechargement complet de la page) même quand un écouteur NATIF de la
// page arrête ceux du même nœud (`stopImmediatePropagation()`) ou coupe la propagation dès la capture
// (`stopPropagation()` posé par `addEventListener('click', f, true)`) : l'écouteur de remontée de la navigation
// ne joue alors jamais, et le navigateur rechargeait la page. Défaut garanti absent : un lien d'un composant, à
// ombre ou léger, pris par la navigation dans ces cas, sur le lien lui-même, sur la balise cliquée dessous, sur
// un conteneur, et au clavier.
// Gardes : l'action prévenue par l'écouteur de l'auteur (avant ou après sa coupure, dans le même écouteur ou dans
// un autre écouteur du même nœud, en capture comme en remontée) garde le lien à l'auteur, y compris quand la
// balise cliquée est un `<span>` sous le lien ; un lien de la page hors composant reste au navigateur ; la
// question d'un `@confirm` se pose une seule fois.
// Chromium et Firefox, vrai clic de souris (Playwright) : c'est le navigateur qui recharge, ou non.
// Une seule exception : la touche Entrée sur un lien dont l'écouteur appelle `stopImmediatePropagation()`, en
// Chromium seulement — Firefox fabrique ce clic DANS l'envoi de la touche, et ses microtâches n'arrivent qu'après
// l'action par défaut : le lien reste au navigateur (la coupure en capture, elle, est prise dans les deux).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'lien-coupe.mjs': [
    '<script>',
    '$v = 0',
    '</script>',
    '<a class="lk" href="/page-b"><span class="in">lien</span></a>',
    '<a class="nu" href="/page-b">texte nu</a>',
    '<div class="boite"><a class="lk2" href="/page-b">autre</a></div>',
    '<a class="conf" href="/page-b" @confirm="Aller ?"><span class="in2">confirmé</span></a>'
  ].join('\n') + '\n'
}

type Mode = 'ombre' | 'léger'

type Scenario = {
  nom:     string
  pose:    string
  clic:    string
  pris:    boolean
  modes?:  Mode[]
  clavier?: boolean
  question?: boolean
  navigateurs?: ('chromium' | 'firefox')[]
}

// l'écouteur de l'auteur compte ses passages (`__joues`) : sans cela, « le lien n'est pas pris » pourrait être
// vrai parce que l'écouteur n'a jamais joué
const JOUE  = 'window.__joues = (window.__joues || 0) + 1'
const poser = (cible: string, corps: string, capture = false) => `${cible}.addEventListener('click', (e) => { ${corps} }, ${capture})`

const SCENARIOS: Scenario[] = [
  { nom: 'témoin sans écouteur de la page', pose: '', clic: '.lk', pris: true },

  { nom: 'stopImmediatePropagation() sur le lien lui-même', pose: poser("N('.lk')", JOUE + '; e.stopImmediatePropagation()'), clic: '.lk', pris: true },
  { nom: 'stopImmediatePropagation() sous le lien (la balise cliquée)', pose: poser("N('.in')", JOUE + '; e.stopImmediatePropagation()'), clic: '.lk', pris: true },
  { nom: 'stopImmediatePropagation() sur un conteneur du lien', pose: poser("N('.boite')", JOUE + '; e.stopImmediatePropagation()'), clic: '.lk2', pris: true },
  { nom: 'stopImmediatePropagation() sur un lien qui est lui-même la balise cliquée', pose: poser("N('.nu')", JOUE + '; e.stopImmediatePropagation()'), clic: '.nu', pris: true },
  { nom: 'stopImmediatePropagation() posé en capture sur le lien', pose: poser("N('.lk')", JOUE + '; e.stopImmediatePropagation()', true), clic: '.lk', pris: true },

  { nom: 'stopPropagation() posé en capture sur le lien', pose: poser("N('.lk')", JOUE + '; e.stopPropagation()', true), clic: '.lk', pris: true },
  { nom: 'stopPropagation() posé en capture sur un lien qui est lui-même la balise cliquée', pose: poser("N('.nu')", JOUE + '; e.stopPropagation()', true), clic: '.nu', pris: true },
  { nom: 'stopPropagation() posé en capture sur un conteneur du lien', pose: poser("N('.boite')", JOUE + '; e.stopPropagation()', true), clic: '.lk2', pris: true },
  { nom: 'stopPropagation() posé en capture sur le document', pose: poser('document', JOUE + '; e.stopPropagation()', true), clic: '.lk', pris: true, modes: ['léger'] },
  { nom: 'stopImmediatePropagation() posé en capture sur le document', pose: poser('document', JOUE + '; e.stopImmediatePropagation()', true), clic: '.lk', pris: true, modes: ['léger'] },

  { nom: 'au clavier (Entrée) : stopImmediatePropagation() sur le lien', pose: poser("N('.lk')", JOUE + '; e.stopImmediatePropagation()'), clic: '.lk', pris: true, clavier: true, navigateurs: ['chromium'] },
  { nom: 'au clavier (Entrée) : stopPropagation() posé en capture sur le lien', pose: poser("N('.lk')", JOUE + '; e.stopPropagation()', true), clic: '.lk', pris: true, clavier: true },

  { nom: 'lien @confirm accepté, stopImmediatePropagation() sur le lien : une seule question, lien pris', pose: poser("N('.conf')", JOUE + '; e.stopImmediatePropagation()'), clic: '.conf', pris: true, question: true },

  { nom: 'stopImmediatePropagation() puis preventDefault() dans le même écouteur : le lien reste à l\'auteur', pose: poser("N('.lk')", 'e.stopImmediatePropagation(); e.preventDefault(); ' + JOUE), clic: '.lk', pris: false },
  { nom: 'preventDefault() puis stopImmediatePropagation() dans le même écouteur : le lien reste à l\'auteur', pose: poser("N('.lk')", 'e.preventDefault(); e.stopImmediatePropagation(); ' + JOUE), clic: '.lk', pris: false },
  { nom: 'stopPropagation() posé en capture puis preventDefault() dans le même écouteur : le lien reste à l\'auteur', pose: poser("N('.lk')", 'e.stopPropagation(); e.preventDefault(); ' + JOUE, true), clic: '.lk', pris: false },
  { nom: 'preventDefault() puis stopPropagation() posé en capture dans le même écouteur : le lien reste à l\'auteur', pose: poser("N('.lk')", 'e.preventDefault(); e.stopPropagation(); ' + JOUE, true), clic: '.lk', pris: false },
  { nom: 'stopImmediatePropagation() posé en capture puis preventDefault() dans le même écouteur : le lien reste à l\'auteur', pose: poser("N('.lk')", 'e.stopImmediatePropagation(); e.preventDefault(); ' + JOUE, true), clic: '.lk', pris: false },
  { nom: 'stopPropagation() en remontée dans un écouteur, preventDefault() dans un autre écouteur du même nœud : le lien reste à l\'auteur', pose: poser("N('.lk')", 'e.stopPropagation()') + '; ' + poser("N('.lk')", 'e.preventDefault(); ' + JOUE), clic: '.lk', pris: false },
  { nom: 'stopPropagation() en remontée dans un écouteur, preventDefault() dans un autre écouteur du lien qui est la balise cliquée : le lien reste à l\'auteur', pose: poser("N('.nu')", 'e.stopPropagation()') + '; ' + poser("N('.nu')", 'e.preventDefault(); ' + JOUE), clic: '.nu', pris: false },
  { nom: 'stopPropagation() posé en capture dans un écouteur, preventDefault() dans un autre écouteur du même conteneur : le lien reste à l\'auteur', pose: poser("N('.boite')", 'e.stopPropagation()', true) + '; ' + poser("N('.boite')", 'e.preventDefault(); ' + JOUE, true), clic: '.lk2', pris: false },
  { nom: 'stopPropagation() posé en capture dans un écouteur, preventDefault() dans un autre écouteur du lien qui est la balise cliquée : le lien reste à l\'auteur', pose: poser("N('.nu')", 'e.stopPropagation()', true) + '; ' + poser("N('.nu')", 'e.preventDefault(); ' + JOUE, true), clic: '.nu', pris: false },
  { nom: 'preventDefault() puis stopPropagation() en remontée sur le lien dont la balise cliquée est un <span> : le lien reste à l\'auteur', pose: poser("N('.lk')", 'e.preventDefault(); e.stopPropagation(); ' + JOUE), clic: '.lk', pris: false },
  { nom: 'preventDefault() puis stopPropagation() en remontée sur le conteneur du lien : le lien reste à l\'auteur', pose: poser("N('.boite')", 'e.preventDefault(); e.stopPropagation(); ' + JOUE), clic: '.lk2', pris: false }
]

for (const nomNavigateur of ['chromium', 'firefox'] as const) {
  describe('lien pris par la navigation malgré un stopImmediatePropagation() ou une coupure en capture (' + nomNavigateur + ' réel)', function () {
    this.timeout(180000)
    let present = false
    let script  = ''
    let navigateur: any

    before(async function () {
      present = await navigateurPresent(nomNavigateur)
      if (!present) {
        console.log('  ℹ️  ' + nomNavigateur + ' non installé, test des coupures sauté. Activer : `npx playwright install ' + nomNavigateur + '`')
        return
      }
      const root   = mjsTmp('lien-coupure')
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
      script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      const playwright = await import('playwright')
      navigateur = await playwright[nomNavigateur].launch()
    })

    after(async () => {
      if (navigateur) await navigateur.close()
      await terminateSharedWorkerPool()
    })

    // une page avec un lien hors composant et UN composant (à ombre, ou léger : `mjs-light`) ; `chargements`
    // compte les chargements natifs de la page (le premier est la page elle-même)
    async function ouvrir(mode: Mode) {
      const page = await navigateur.newPage()
      const chargements: string[] = []
      page.on('request', (r: any) => { if (r.isNavigationRequest()) chargements.push(r.url()) })
      const hote = '<mjs-lien-coupe' + (mode === 'léger' ? ' mjs-light' : '') + '></mjs-lien-coupe>'
      const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><a class="page" href="/page-b">lien de la page</a>${hote}<script>${script}</script></body></html>`
      await page.route('http://mjs.test/**', (route: any) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
      await page.goto('http://mjs.test/')
      await page.waitForFunction(() => !!(document.querySelector('mjs-lien-coupe') as any)?._shadow?.querySelector('.lk'))
      await page.evaluate(() => {
        const w: any = window
        w.__temoin = 'page d\'origine'
        w.__q = 0
        w.µ.config.confirm = false
        w.confirm = () => { w.__q++; return true }
        w.N = (s: string) => (document.querySelector('mjs-lien-coupe') as any)._shadow.querySelector(s)
      })
      return { page, chargements }
    }

    // vrai clic au centre d'un élément (du composant, ou de la page : `page`)
    async function cliquer(ctx: any, sel: string, clavier = false) {
      if (clavier) {
        await ctx.page.evaluate((s: string) => (window as any).N(s).focus(), sel)
        await ctx.page.keyboard.press('Enter')
      } else {
        const [x, y] = await ctx.page.evaluate((s: string) => {
          const r = (s === 'page' ? document.querySelector('.page') : (window as any).N(s)).getBoundingClientRect()
          return [r.x + r.width / 2, r.y + r.height / 2]
        }, sel)
        await ctx.page.mouse.click(x, y)
      }
      await ctx.page.waitForTimeout(600)
    }

    const etat = (ctx: any) => ctx.page.evaluate(() => ({ chemin: location.pathname, temoin: (window as any).__temoin, joues: (window as any).__joues || 0, questions: (window as any).__q }))

    // la page n'a pas été rechargée et la navigation de MJS a poussé l'adresse
    async function assertPris(ctx: any, message: string) {
      assert.equal(ctx.chargements.length, 1, message + ' : aucun chargement natif de la page (chargements : ' + ctx.chargements.join(', ') + ')')
      const e = await etat(ctx)
      assert.equal(e.temoin, 'page d\'origine', message + ' : la page d\'origine est toujours là')
      assert.equal(e.chemin, '/page-b', message + ' : l\'adresse du lien a été poussée par la navigation de MJS')
    }

    // le lien est resté à l'auteur : ni adresse poussée ni page chargée, et son écouteur a joué
    async function assertGarde(ctx: any, message: string) {
      const e = await etat(ctx)
      assert.equal(e.joues, 1, message + ' : l\'écouteur de l\'auteur a joué')
      assert.equal(e.chemin, '/', message + ' : aucune adresse poussée')
      assert.equal(ctx.chargements.length, 1, message + ' : aucun chargement natif de la page (chargements : ' + ctx.chargements.join(', ') + ')')
      assert.equal(e.temoin, 'page d\'origine', message + ' : la page d\'origine est toujours là')
    }

    for (const mode of ['ombre', 'léger'] as const) {
      for (const sc of SCENARIOS) {
        if (sc.modes && !sc.modes.includes(mode)) continue
        if (sc.navigateurs && !sc.navigateurs.includes(nomNavigateur)) continue
        it('(' + mode + ') ' + sc.nom, async function () {
          if (!present) { this.skip(); return }
          const ctx = await ouvrir(mode)
          try {
            if (sc.pose) await ctx.page.evaluate(sc.pose)
            await cliquer(ctx, sc.clic, sc.clavier)
            if (sc.pris) {
              await assertPris(ctx, sc.nom)
              if (sc.pose) assert.equal((await etat(ctx)).joues, 1, 'l\'écouteur de l\'auteur a joué une fois')
            } else {
              await assertGarde(ctx, sc.nom)
            }
            if (sc.question) assert.equal((await etat(ctx)).questions, 1, 'une seule question')
          } finally { await ctx.page.close() }
        })
      }
    }

    // un clic fabriqué par un script (`lien.click()`) : sa microtâche arrive après l'envoi, le navigateur a déjà
    // agi — la prise du lien n'est pas rejouée (une page qui a déjà quitté ne doit pas aussi en charger une autre).
    // `sessionStorage` garde les comptes à travers le rechargement ; l'espion ne compte que les appels hors
    // confirmation de la capture (la prise du lien par la microtâche) : les écouteurs de remontée, eux, tiennent
    // la fonction d'origine
    for (const mode of ['ombre', 'léger'] as const) {
      it('(' + mode + ') un clic fabriqué par un script et un stopImmediatePropagation() : le navigateur seul agit, la prise du lien n\'est pas rejouée', async function () {
        if (!present) { this.skip(); return }
        const ctx = await ouvrir(mode)
        try {
          await ctx.page.evaluate(() => {
            const w: any = window
            const compter = (cle: string) => sessionStorage.setItem(cle, String(Number(sessionStorage.getItem(cle) || 0) + 1))
            const prise = w.µ._mjs_ujsOnClick
            w.µ._mjs_ujsOnClick = function (this: any, e: any) {
              if (!e._mjs_ujsGateOnly) compter('prises')
              return prise.call(this, e)
            }
            document.addEventListener('mjs:before-visit', () => compter('visites'))
          })
          await ctx.page.evaluate(poser("N('.lk')", JOUE + '; e.stopImmediatePropagation()'))
          await ctx.page.evaluate(() => (window as any).N('.lk').click())
          await ctx.page.waitForTimeout(800)
          assert.equal(ctx.chargements.length, 2, 'la page est rechargée par le navigateur (chargements : ' + ctx.chargements.join(', ') + ')')
          assert.deepEqual(await ctx.page.evaluate(() => ({ prises: sessionStorage.getItem('prises'), visites: sessionStorage.getItem('visites') })), { prises: null, visites: null }, 'ni prise du lien rejouée, ni visite de la navigation de MJS')
        } finally { await ctx.page.close() }
      })
    }

    // hors composant, le lien reste au navigateur : comme avant, la page est rechargée
    for (const [nom, pose] of [
      ['stopImmediatePropagation() sur le lien',               poser("document.querySelector('.page')", JOUE + '; e.stopImmediatePropagation()')],
      ['stopPropagation() posé en capture sur le lien',        poser("document.querySelector('.page')", JOUE + '; e.stopPropagation()', true)],
      ['stopPropagation() posé en capture sur le document',    poser('document', JOUE + '; e.stopPropagation()', true)]
    ]) {
      it('(hors composant) ' + nom + ' : le lien reste au navigateur', async function () {
        if (!present) { this.skip(); return }
        const ctx = await ouvrir('léger')
        try {
          await ctx.page.evaluate(pose)
          await cliquer(ctx, 'page')
          assert.equal(ctx.chargements.length, 2, 'la page est rechargée par le navigateur (chargements : ' + ctx.chargements.join(', ') + ')')
        } finally { await ctx.page.close() }
      })
    }
  })
}
