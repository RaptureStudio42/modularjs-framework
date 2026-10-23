// `<button type="submit" @confirm>` dans un `<form @submit.prevent>` pose UNE question par geste : un
// clic accepté est l'envoi qui le suit (dans la même tâche), qui ne redemande pas. Défaut garanti
// absent : la question était posée au clic, puis reposée à l'envoi — deux questions pour un clic, en
// composant à ombre comme en composant léger, et pour un `@confirm` posé sur le formulaire lui-même.
// Gardes : un refus au clic n'envoie rien ; un envoi qui ne vient pas d'un clic (`requestSubmit()`)
// pose sa question ; l'acceptation d'un clic ne vaut que pour l'envoi qui le suit, pas pour un envoi
// d'après ; la touche Entrée dans un champ (clic fabriqué par le navigateur sur le bouton d'envoi)
// pose elle aussi une seule question.
// Un clic accepté qui n'envoie rien (un clic dans un champ du formulaire confirmé, un clic que `@click.prevent`
// retient sur le bouton d'envoi) ne laisse pas sa réponse pour plus tard : l'envoi d'après, dans une autre tâche
// (Entrée dans le champ, `requestSubmit(bouton)`), repose la question.
// Chromium et Firefox, vrai clic de souris (Playwright) ; `window.confirm` est remplacé pour compter
// les questions (`µ.config.confirm = false` : la question passe par `window.confirm`).

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
  'envoi-bouton.mjs': [
    '<script>',
    '$s = 0',
    '</script>',
    '<form class="f" @submit.prevent={$s++}><input class="champ" name="q"><button class="sb" type="submit" @confirm="Envoyer ?">ok</button></form>',
    '<p class="s">{$s}</p>'
  ].join('\n') + '\n',
  'envoi-champ.mjs': [
    '<script>',
    '$s = 0',
    '</script>',
    '<form class="f" @confirm="Envoyer ?" @submit.prevent={$s++}><input class="champ" name="q"></form>',
    '<p class="s">{$s}</p>'
  ].join('\n') + '\n',
  'envoi-inerte.mjs': [
    '<script>',
    '$s = 0',
    '$v = 0',
    '</script>',
    '<form class="f" @submit.prevent={$s++}><button class="sb" type="submit" @confirm="Envoyer ?" @click.prevent={$v++}>ok</button></form>',
    '<p class="s">{$s}</p>'
  ].join('\n') + '\n',
  'envoi-form.mjs': [
    '<script>',
    '$s = 0',
    '</script>',
    '<form class="f" @confirm="Envoyer ?" @submit.prevent={$s++}><button class="sb" type="submit">ok</button></form>',
    '<p class="s">{$s}</p>'
  ].join('\n') + '\n'
}

for (const nomNavigateur of ['chromium', 'firefox'] as const) {
  describe('une seule question pour un bouton d\'envoi confirmé (' + nomNavigateur + ' réel)', function () {
    this.timeout(120000)
    let present = false
    let script  = ''
    let navigateur: any

    before(async function () {
      present = await navigateurPresent(nomNavigateur)
      if (!present) {
        console.log('  ℹ️  ' + nomNavigateur + ' non installé, test des questions sauté. Activer : `npx playwright install ' + nomNavigateur + '`')
        return
      }
      const root   = mjsTmp('confirm-envoi')
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

    // une page avec UN composant ; `reponse` : ce que rend la question (vrai : accepté)
    async function ouvrir(balise: string, mode: 'ombre' | 'léger', reponse: boolean, pret = '.sb') {
      const page = await navigateur.newPage()
      const hote = '<mjs-' + balise + (mode === 'léger' ? ' mjs-light' : '') + '></mjs-' + balise + '>'
      const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${hote}<script>${script}</script></body></html>`
      await page.route('http://mjs.test/**', (route: any) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
      await page.goto('http://mjs.test/')
      await page.waitForFunction(([b, sel]: string[]) => !!(document.querySelector('mjs-' + b) as any)?._shadow?.querySelector(sel), [balise, pret])
      await page.evaluate((rep: boolean) => {
        const w: any = window
        w.µ.config.confirm = false
        w.__q = 0
        w.confirm = () => { w.__q++; return rep }
      }, reponse)
      return { page, balise }
    }

    const lire = (ctx: any) => ctx.page.evaluate((b: string) => ({
      questions: (window as any).__q,
      envois:    (document.querySelector('mjs-' + b) as any)._shadow.querySelector('.s').textContent
    }), ctx.balise)

    async function cliquerEnvoi(ctx: any) {
      const [x, y] = await ctx.page.evaluate((b: string) => {
        const r = (document.querySelector('mjs-' + b) as any)._shadow.querySelector('.sb').getBoundingClientRect()
        return [r.x + r.width / 2, r.y + r.height / 2]
      }, ctx.balise)
      await ctx.page.mouse.click(x, y)
      await ctx.page.waitForTimeout(150)
    }

    for (const mode of ['ombre', 'léger'] as const) {
      for (const balise of ['envoi-bouton', 'envoi-form']) {
        const porteur = balise === 'envoi-bouton' ? 'le bouton d\'envoi' : 'le formulaire'

        it('(' + mode + ', @confirm sur ' + porteur + ') un clic accepté pose une seule question et envoie une fois', async function () {
          if (!present) { this.skip(); return }
          const ctx = await ouvrir(balise, mode, true)
          try {
            await cliquerEnvoi(ctx)
            assert.deepEqual(await lire(ctx), { questions: 1, envois: '1' }, 'une question, un envoi')
          } finally { await ctx.page.close() }
        })

        it('(' + mode + ', @confirm sur ' + porteur + ') un clic refusé pose une question et n\'envoie rien', async function () {
          if (!present) { this.skip(); return }
          const ctx = await ouvrir(balise, mode, false)
          try {
            await cliquerEnvoi(ctx)
            assert.deepEqual(await lire(ctx), { questions: 1, envois: '0' }, 'une question, aucun envoi')
          } finally { await ctx.page.close() }
        })

        it('(' + mode + ', @confirm sur ' + porteur + ') l\'acceptation d\'un clic ne vaut que pour l\'envoi qui le suit : un envoi d\'après repose la question', async function () {
          if (!present) { this.skip(); return }
          const ctx = await ouvrir(balise, mode, true)
          try {
            await cliquerEnvoi(ctx)
            assert.deepEqual(await lire(ctx), { questions: 1, envois: '1' }, 'le clic')
            await ctx.page.waitForTimeout(100)
            await ctx.page.evaluate((b: string) => {
              const racine = (document.querySelector('mjs-' + b) as any)._shadow
              racine.querySelector('.f').requestSubmit(racine.querySelector('.sb'))
            }, ctx.balise)
            await ctx.page.waitForTimeout(100)
            assert.deepEqual(await lire(ctx), { questions: 2, envois: '2' }, 'l\'envoi programmé pose sa propre question')
          } finally { await ctx.page.close() }
        })
      }

      it('(' + mode + ') avec la modale maison (µ.config.confirm = true) : un clic accepté pose une seule question et envoie une fois (garde)', async function () {
        if (!present) { this.skip(); return }
        const ctx = await ouvrir('envoi-bouton', mode, true)
        try {
          await ctx.page.evaluate(() => {
            const w: any = window
            const ouvrirModale = w.µ.modal.fire
            w.µ.config.confirm = true
            w.__q = 0
            w.µ.modal.fire = function (...args: any[]) { w.__q++; return ouvrirModale.apply(w.µ.modal, args) }
          })
          await cliquerEnvoi(ctx)
          await ctx.page.click('.mjs-modal-confirm')
          await ctx.page.waitForTimeout(300)
          assert.deepEqual(await lire(ctx), { questions: 1, envois: '1' }, 'une modale, un envoi')
        } finally { await ctx.page.close() }
      })

      it('(' + mode + ', @confirm sur le formulaire) un clic accepté dans un champ, sans envoi : l\'envoi par Entrée qui vient ensuite repose la question', async function () {
        if (!present) { this.skip(); return }
        const ctx = await ouvrir('envoi-champ', mode, true, '.champ')
        try {
          const [x, y] = await ctx.page.evaluate((b: string) => {
            const r = (document.querySelector('mjs-' + b) as any)._shadow.querySelector('.champ').getBoundingClientRect()
            return [r.x + r.width / 2, r.y + r.height / 2]
          }, ctx.balise)
          await ctx.page.mouse.click(x, y)
          await ctx.page.waitForTimeout(150)
          assert.deepEqual(await lire(ctx), { questions: 1, envois: '0' }, 'le clic dans le champ pose sa question et n\'envoie rien')
          await ctx.page.keyboard.press('Enter')
          await ctx.page.waitForTimeout(150)
          assert.deepEqual(await lire(ctx), { questions: 2, envois: '1' }, 'l\'envoi par Entrée pose sa propre question')
        } finally { await ctx.page.close() }
      })

      it('(' + mode + ', @confirm sur le bouton d\'envoi) un clic accepté que @click.prevent retient, sans envoi : requestSubmit(bouton) qui vient ensuite repose la question', async function () {
        if (!present) { this.skip(); return }
        const ctx = await ouvrir('envoi-inerte', mode, true)
        try {
          await cliquerEnvoi(ctx)
          assert.deepEqual(await lire(ctx), { questions: 1, envois: '0' }, 'le clic pose sa question et n\'envoie rien')
          await ctx.page.evaluate((b: string) => {
            const racine = (document.querySelector('mjs-' + b) as any)._shadow
            racine.querySelector('.f').requestSubmit(racine.querySelector('.sb'))
          }, ctx.balise)
          await ctx.page.waitForTimeout(150)
          assert.deepEqual(await lire(ctx), { questions: 2, envois: '1' }, 'l\'envoi programmé pose sa propre question')
        } finally { await ctx.page.close() }
      })

      it('(' + mode + ') la touche Entrée dans un champ pose une seule question et envoie une fois', async function () {
        if (!present) { this.skip(); return }
        const ctx = await ouvrir('envoi-bouton', mode, true)
        try {
          await ctx.page.evaluate((b: string) => (document.querySelector('mjs-' + b) as any)._shadow.querySelector('.champ').focus(), ctx.balise)
          await ctx.page.keyboard.press('Enter')
          await ctx.page.waitForTimeout(150)
          assert.deepEqual(await lire(ctx), { questions: 1, envois: '1' }, 'une question, un envoi')
        } finally { await ctx.page.close() }
      })
    }
  })
}
