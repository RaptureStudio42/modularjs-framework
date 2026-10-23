// La navigation de MJS doit prendre un lien (zéro rechargement complet de la page) dans deux cas où elle
// le perdait : (a) un écouteur NATIF de la page appelle `stopPropagation()` sur le lien, sous lui ou
// sur un conteneur du composant — la remontée ne la rejoignait jamais, le navigateur rechargeait la
// page ; (b) le gestionnaire du lien retire de la page la balise cliquée à l'intérieur du lien resté en
// place (une icône basculée par `{if}`) — le lien était cherché depuis un nœud détaché. S'y ajoute le
// `.stop` d'un lien de composant LÉGER posé dans la page : il ne coupe pas la navigation, comme pour
// un composant à ombre.
// Gardes : sans écouteur qui coupe, le lien est pris une seule fois ; un écouteur natif qui coupe ET
// prévient l'action par défaut (une bibliothèque qui prend le lien à son compte) le garde.
// Chromium et Firefox, vrai clic de souris (Playwright) : c'est le navigateur qui recharge, ou non.

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
  'lien-natif.mjs': [
    '<script>',
    '$v = 0',
    '</script>',
    '<a class="lk" href="/page-b"><span class="in">lien</span></a>',
    '<div class="boite"><a class="lk2" href="/page-b">autre</a></div>',
    '<a class="prevenu" href="/page-b">pris à son compte</a>'
  ].join('\n') + '\n',
  'lien-icone.mjs': [
    '<script>',
    '$on = true',
    'bascule = ->',
    '  $on = not $on',
    '  window.__clics = (window.__clics or 0) + 1',
    '</script>',
    '<a class="ic" href="/page-b" @click={bascule()}>{if $on}<b class="x">on</b>{else}<i>off</i>{end}</a>'
  ].join('\n') + '\n',
  'lien-stop.mjs': [
    '<script>',
    '$v = 0',
    'compte = ->',
    '  window.__clics = (window.__clics or 0) + 1',
    '</script>',
    '<a class="s" href="/page-b" @click.stop={compte()}>stop</a>'
  ].join('\n') + '\n'
}

for (const nomNavigateur of ['chromium', 'firefox'] as const) {
  describe('lien pris par la navigation, malgré un écouteur natif ou une balise retirée (' + nomNavigateur + ' réel)', function () {
    this.timeout(120000)
    let present = false
    let script  = ''
    let navigateur: any

    before(async function () {
      present = await navigateurPresent(nomNavigateur)
      if (!present) {
        console.log('  ℹ️  ' + nomNavigateur + ' non installé, test des liens sauté. Activer : `npx playwright install ' + nomNavigateur + '`')
        return
      }
      const root   = mjsTmp('lien-coupe')
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

    // une page avec UN composant (à ombre, ou léger : `mjs-light`), prête quand `sel` est affiché ; `chargements`
    // compte les chargements natifs de la page (le premier est la page elle-même)
    async function ouvrir(balise: string, mode: 'ombre' | 'léger', sel: string) {
      const page       = await navigateur.newPage()
      const chargements: string[] = []
      page.on('request', (r: any) => { if (r.isNavigationRequest()) chargements.push(r.url()) })
      const hote = '<mjs-' + balise + (mode === 'léger' ? ' mjs-light' : '') + '></mjs-' + balise + '>'
      const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${hote}<script>${script}</script></body></html>`
      await page.route('http://mjs.test/**', (route: any) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
      await page.goto('http://mjs.test/')
      await page.waitForFunction(([b, s]: string[]) => !!(document.querySelector('mjs-' + b) as any)?._shadow?.querySelector(s), [balise, sel])
      await page.evaluate(() => { (window as any).__temoin = 'page d\'origine' })
      return { page, chargements, balise }
    }

    // vrai clic au centre d'un élément du composant
    async function cliquer(ctx: any, sel: string) {
      const [x, y] = await ctx.page.evaluate(([b, s]: string[]) => {
        const r = (document.querySelector('mjs-' + b) as any)._shadow.querySelector(s).getBoundingClientRect()
        return [r.x + r.width / 2, r.y + r.height / 2]
      }, [ctx.balise, sel])
      await ctx.page.mouse.click(x, y)
      await ctx.page.waitForTimeout(500)
    }

    // la page n'a pas été rechargée et la navigation de MJS a poussé l'adresse
    async function assertPrisParMjs(ctx: any, message: string) {
      assert.equal(ctx.chargements.length, 1, message + ' : aucun chargement natif de la page (chargements : ' + ctx.chargements.join(', ') + ')')
      const etat = await ctx.page.evaluate(() => ({ chemin: location.pathname, temoin: (window as any).__temoin }))
      assert.equal(etat.temoin, 'page d\'origine', message + ' : la page d\'origine est toujours là')
      assert.equal(etat.chemin, '/page-b', message + ' : l\'adresse du lien a été poussée par la navigation de MJS')
    }

    for (const mode of ['ombre', 'léger'] as const) {
      it('(' + mode + ') un écouteur natif coupe la remontée sur le lien lui-même : la navigation de MJS le prend', async function () {
        if (!present) { this.skip(); return }
        const ctx = await ouvrir('lien-natif', mode, '.lk')
        try {
          await ctx.page.evaluate(() => (document.querySelector('mjs-lien-natif') as any)._shadow.querySelector('.lk').addEventListener('click', (e: any) => e.stopPropagation()))
          await cliquer(ctx, '.lk')
          await assertPrisParMjs(ctx, 'stopPropagation() sur le lien')
        } finally { await ctx.page.close() }
      })

      it('(' + mode + ') un écouteur natif coupe la remontée sous le lien (la balise cliquée) : la navigation de MJS le prend', async function () {
        if (!present) { this.skip(); return }
        const ctx = await ouvrir('lien-natif', mode, '.in')
        try {
          await ctx.page.evaluate(() => (document.querySelector('mjs-lien-natif') as any)._shadow.querySelector('.in').addEventListener('click', (e: any) => e.stopPropagation()))
          await cliquer(ctx, '.in')
          await assertPrisParMjs(ctx, 'stopPropagation() sous le lien')
        } finally { await ctx.page.close() }
      })

      it('(' + mode + ') un écouteur natif coupe la remontée sur un conteneur du lien : la navigation de MJS le prend', async function () {
        if (!present) { this.skip(); return }
        const ctx = await ouvrir('lien-natif', mode, '.lk2')
        try {
          await ctx.page.evaluate(() => (document.querySelector('mjs-lien-natif') as any)._shadow.querySelector('.boite').addEventListener('click', (e: any) => e.stopPropagation()))
          await cliquer(ctx, '.lk2')
          await assertPrisParMjs(ctx, 'stopPropagation() sur le conteneur')
        } finally { await ctx.page.close() }
      })

      it('(' + mode + ') un écouteur natif qui coupe ET prévient l\'action par défaut garde le lien : la navigation de MJS ne le prend pas', async function () {
        if (!present) { this.skip(); return }
        const ctx = await ouvrir('lien-natif', mode, '.prevenu')
        try {
          await ctx.page.evaluate(() => (document.querySelector('mjs-lien-natif') as any)._shadow.querySelector('.prevenu').addEventListener('click', (e: any) => { e.preventDefault(); e.stopPropagation(); (window as any).__pris = true }))
          await cliquer(ctx, '.prevenu')
          const etat = await ctx.page.evaluate(() => ({ chemin: location.pathname, pris: (window as any).__pris }))
          assert.equal(etat.pris, true, 'l\'écouteur natif a joué')
          assert.equal(etat.chemin, '/', 'ni adresse poussée ni page chargée : le lien est resté à l\'écouteur qui l\'a pris')
          assert.equal(ctx.chargements.length, 1, 'aucun chargement natif de la page')
        } finally { await ctx.page.close() }
      })

      it('(' + mode + ') sans écouteur qui coupe, le lien est pris une seule fois par la navigation de MJS', async function () {
        if (!present) { this.skip(); return }
        const ctx = await ouvrir('lien-natif', mode, '.lk')
        try {
          const requetes: string[] = []
          ctx.page.on('request', (r: any) => { if (r.url().endsWith('/page-b')) requetes.push(r.resourceType()) })
          await cliquer(ctx, '.lk')
          await assertPrisParMjs(ctx, 'lien simple')
          assert.deepEqual(requetes, ['fetch'], 'une seule requête, celle de la navigation de MJS')
        } finally { await ctx.page.close() }
      })

      it('(' + mode + ') le gestionnaire retire la balise cliquée (icône basculée par {if}) alors que le lien reste : la navigation de MJS le prend', async function () {
        if (!present) { this.skip(); return }
        const ctx = await ouvrir('lien-icone', mode, '.x')
        try {
          await cliquer(ctx, '.x')
          await assertPrisParMjs(ctx, 'balise cliquée retirée')
          assert.equal(await ctx.page.evaluate(() => (window as any).__clics), 1, 'le gestionnaire du lien a joué')
        } finally { await ctx.page.close() }
      })
    }

    it('(léger) un lien avec .stop : le gestionnaire joue et la navigation de MJS prend le lien quand même', async function () {
      if (!present) { this.skip(); return }
      const ctx = await ouvrir('lien-stop', 'léger', '.s')
      try {
        await cliquer(ctx, '.s')
        await assertPrisParMjs(ctx, '.stop sur un composant léger')
        assert.equal(await ctx.page.evaluate(() => (window as any).__clics), 1, 'le gestionnaire .stop a joué une fois')
      } finally { await ctx.page.close() }
    })

    it('(ombre) un lien avec .stop : le gestionnaire joue et la navigation de MJS prend le lien quand même', async function () {
      if (!present) { this.skip(); return }
      const ctx = await ouvrir('lien-stop', 'ombre', '.s')
      try {
        await cliquer(ctx, '.s')
        await assertPrisParMjs(ctx, '.stop sur un composant à ombre')
        assert.equal(await ctx.page.evaluate(() => (window as any).__clics), 1, 'le gestionnaire .stop a joué une fois')
      } finally { await ctx.page.close() }
    })
  })
}
