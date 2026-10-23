// Un champ nombre lié (`<input type="number" value=!{$n}>`) garde ce qu'on tape, et la liaison ne le
// réécrit que si le modèle change. Trois suites de cette règle, vues avec une vraie frappe dans
// Chromium et Firefox :
//   - un champ laissé à une saisie invalide (« - » : `validity.badInput`, le navigateur ne rend pas de
//     valeur) garde sa saisie quand on le quitte, comme un champ natif (le modèle n'est pas écrit) ;
//   - un champ texte lu en nombre (`value.number`) qui reçoit « . » ou « - » garde ce qui est tapé et ne
//     met pas NaN dans le modèle ;
//   - un champ vidé (« 5 », Retour arrière) reste vide tant qu'on l'édite, le modèle prend 0 (le nombre
//     que donne un champ vide) — le champ n'affiche pas « 0 » à la place de la frappe.

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
  'cs-page.mjs': `<script>
  $e = 3
  $z = null
  $n = 5
  $u = 0
  $m = 5
  $t = 4
  $i = 6
  $rows = [{id: 1, v: 5}]
</script>
<input class="e" aria-label="e" type="number" step="any" value=!{$e}>
<input class="z" aria-label="z" type="number" step="any" value=!{$z}>
<input class="n" aria-label="n" type="number" step="any" value=!{$n}>
<input class="u" aria-label="u" type="number" step="any" value=!{$u}>
<input class="m" aria-label="m" type="number" step="any" value.number=!{$m}>
<input class="t" aria-label="t" type="text" value.number=!{$t}>
<input class="i" aria-label="i" type="number" step="any" value.int=!{$i}>
<input class="x" aria-label="x" type="text">
<ul>{for r in $rows by id}<li><input class="r" aria-label="r" type="number" step="any" value=!{r.v}></li>{end}</ul>
<button class="pareil" @click={$e = 3}>pareil</button>
<button class="autre" @click={$e = 9; $n = 4}>autre</button>
<p class="mod"><b class="e">{$e}</b>|<b class="z">{$z}</b>|<b class="n">{$n}</b>|<b class="tn">{typeof $n}</b>|<b class="u">{$u}</b>|<b class="m">{$m}</b>|<b class="t">{$t}</b>|<b class="tt">{typeof $t}</b>|<b class="i">{$i}</b>|<b class="rv">{$rows[0].v}</b></p>
`
}

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`champ nombre lié (${nom} réel) — sortie du champ, texte lu en nombre, champ vidé`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test du champ nombre sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('champ-nombre-sortie-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    })

    after(async () => { await terminateSharedWorkerPool() })

    async function essai(fn: (page: any, erreurs: string[]) => Promise<void>) {
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const page = await browser.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.route('http://t.test/**', (route: any) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-cs-page></mjs-cs-page><script>${script}</script></body></html>` }))
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-cs-page') as any)?._shadow?.querySelector('input.e'))
        await page.waitForTimeout(100)
        await fn(page, erreurs)
        assert.deepEqual(erreurs, [], 'aucune erreur de page')
      } finally {
        await browser.close()
      }
    }

    // l'état d'un champ : sa valeur, et `mauvais` (la frappe n'est pas encore un nombre : le champ la garde)
    const etat = (page: any, classe: string) => page.evaluate((c: string) => {
      const el = (document.querySelector('mjs-cs-page') as any)._shadow.querySelector('input.' + c)
      return { value: el.value as string, mauvais: !!el.validity.badInput }
    }, classe)
    const modele = (page: any, classe: string) => page.evaluate((c: string) => (document.querySelector('mjs-cs-page') as any)._shadow.querySelector('b.' + c).textContent as string, classe)
    const clic   = (page: any, classe: string) => page.evaluate((c: string) => ((document.querySelector('mjs-cs-page') as any)._shadow.querySelector('button.' + c) as HTMLElement).click(), classe)

    // met le focus dans le champ et sélectionne tout son contenu
    async function entrer(page: any, classe: string) {
      await page.evaluate((c: string) => (document.querySelector('mjs-cs-page') as any)._shadow.querySelector('input.' + c).focus(), classe)
      await page.keyboard.press('Control+A')
    }
    async function taper(page: any, touches: string[]) {
      for (const t of touches) {
        if (t.length === 1) await page.keyboard.type(t)
        else await page.keyboard.press(t)
        await page.waitForTimeout(40)
      }
    }

    it('un champ laissé à « - » garde sa saisie à la sortie, le modèle ne bouge pas', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await entrer(page, 'e')
        await taper(page, ['-'])
        assert.deepEqual(await etat(page, 'e'), { value: '', mauvais: true }, 'après « - » : la frappe reste dans le champ')
        assert.equal(await modele(page, 'e'), '3', 'le modèle ne bouge pas')
        // le code réécrit la même valeur : rien n'a changé, rien ne repasse dans le champ
        await clic(page, 'pareil')
        await page.waitForTimeout(60)
        assert.deepEqual(await etat(page, 'e'), { value: '', mauvais: true }, 'tant qu\'on édite, la frappe reste')
        await taper(page, ['Tab'])
        assert.deepEqual(await etat(page, 'e'), { value: '', mauvais: true }, 'à la sortie : la saisie refusée reste, comme dans un champ natif')
        assert.equal(await modele(page, 'e'), '3')
      })
    })

    it('la touche Entrée dans un champ invalide : la saisie reste et le champ garde le focus', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await entrer(page, 'e')
        await taper(page, ['-'])
        assert.deepEqual(await etat(page, 'e'), { value: '', mauvais: true }, 'après « - »')
        await taper(page, ['Enter'])
        assert.deepEqual(await etat(page, 'e'), { value: '', mauvais: true }, 'la saisie refusée reste après Entrée')
        const actif = await page.evaluate(() => (document.querySelector('mjs-cs-page') as any)._shadow.activeElement?.className)
        assert.equal(actif, 'e', 'le champ garde le focus')
      })
    })

    it('la fenêtre qui perd le focus (focusout, le champ reste l\'élément actif) ne remplace pas la frappe, ni la sortie pour de bon', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await entrer(page, 'e')
        await taper(page, ['-'])
        await page.evaluate(() => (document.querySelector('mjs-cs-page') as any)._shadow.querySelector('input.e').dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true })))
        await page.waitForTimeout(60)
        assert.deepEqual(await etat(page, 'e'), { value: '', mauvais: true }, 'le champ garde la frappe : on y revient')
        await taper(page, ['Tab'])
        assert.deepEqual(await etat(page, 'e'), { value: '', mauvais: true }, 'quitté pour de bon : la saisie refusée reste')
      })
    })

    it('un champ sans valeur (modèle vide) laissé à « - » : la saisie reste à la sortie, le modèle reste vide', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await entrer(page, 'z')
        await taper(page, ['-'])
        assert.deepEqual(await etat(page, 'z'), { value: '', mauvais: true }, 'après « - »')
        await taper(page, ['Tab'])
        assert.deepEqual(await etat(page, 'z'), { value: '', mauvais: true }, 'à la sortie : la saisie refusée reste')
        assert.equal(await modele(page, 'z'), '', 'le modèle n\'a rien reçu')
      })
    })

    it('« 1. » laissé tel quel : la sortie n\'écrit rien, ni dans le champ ni dans le modèle (1, jamais 0)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await entrer(page, 'e')
        await taper(page, ['1', '.'])
        const avant = await etat(page, 'e')
        await taper(page, ['Tab'])
        assert.deepEqual(await etat(page, 'e'), avant, 'la sortie ne change rien au champ')
        assert.equal(await modele(page, 'e'), '1', 'le modèle a gardé le « 1 » tapé avant le point')
      })
    })

    it('un champ de {for}, un value.number et un value.int : la saisie refusée reste à la sortie', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        for (const [classe, mod, attendu] of [['r', 'rv', '5'], ['m', 'm', '5'], ['i', 'i', '6']]) {
          await entrer(page, classe)
          await taper(page, ['-'])
          assert.deepEqual(await etat(page, classe), { value: '', mauvais: true }, `${classe} : après « - »`)
          await taper(page, ['Tab'])
          assert.deepEqual(await etat(page, classe), { value: '', mauvais: true }, `${classe} : à la sortie, la saisie refusée reste`)
          assert.equal(await modele(page, mod), attendu, `${classe} : le modèle garde sa valeur`)
        }
      })
    })

    it('un autre champ qui prend le focus, sans toucher au champ : rien ne bouge', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await entrer(page, 'e')
        await taper(page, ['7'])
        assert.equal(await modele(page, 'e'), '7')
        await entrer(page, 'x')
        await taper(page, ['Tab'])
        assert.deepEqual(await etat(page, 'e'), { value: '7', mauvais: false }, 'un champ valide n\'est pas réécrit')
        assert.equal(await modele(page, 'u'), '0')
        assert.equal((await etat(page, 'u')).value, '0', 'un modèle à 0 s\'affiche « 0 » quand personne ne le tape')
      })
    })

    it('un champ texte avec value.number : « . » et « - » restent dans le champ, le modèle ne reçoit jamais NaN', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await entrer(page, 't')
        await taper(page, ['.'])
        assert.equal((await etat(page, 't')).value, '.', 'après « . » : la frappe reste, pas « NaN »')
        assert.equal(await modele(page, 't'), '4', 'le modèle garde son nombre')
        await taper(page, ['5'])
        assert.equal(await modele(page, 't'), '0.5', 'après « .5 » : le modèle vaut 0.5')
        assert.equal(await modele(page, 'tt'), 'number')
        await page.keyboard.press('Control+A')
        await taper(page, ['-'])
        assert.equal((await etat(page, 't')).value, '-', 'après « - » : la frappe reste')
        assert.equal(await modele(page, 't'), '0.5', 'le modèle ne reçoit pas NaN')
        await taper(page, ['2'])
        assert.deepEqual(await etat(page, 't'), { value: '-2', mauvais: false })
        assert.equal(await modele(page, 't'), '-2', 'après « -2 » : le modèle vaut -2')
        await page.keyboard.press('Control+A')
        await taper(page, ['a', 'b'])
        assert.equal((await etat(page, 't')).value, 'ab', 'un texte qui n\'est pas un nombre reste dans le champ')
        assert.equal(await modele(page, 't'), '-2', 'le modèle garde le dernier nombre')
      })
    })

    it('un champ nombre vidé (« 5 », Retour arrière) reste vide, le modèle vaut 0 ; « 7 » ensuite donne 7', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await entrer(page, 'n')
        await taper(page, ['5', 'Backspace'])
        assert.deepEqual(await etat(page, 'n'), { value: '', mauvais: false }, 'le champ reste vide, sans « 0 »')
        assert.equal(await modele(page, 'n'), '0', 'le modèle prend 0, le nombre d\'un champ vide')
        assert.equal(await modele(page, 'tn'), 'number', 'et reste un nombre')
        await taper(page, ['7'])
        assert.deepEqual(await etat(page, 'n'), { value: '7', mauvais: false })
        assert.equal(await modele(page, 'n'), '7')
        await taper(page, ['Backspace'])
        assert.equal((await etat(page, 'n')).value, '', 'on peut le vider encore')
        // le code pose une autre valeur : elle remplace le champ vide
        await clic(page, 'autre')
        await page.waitForTimeout(60)
        assert.equal((await etat(page, 'n')).value, '4', 'une valeur du code remplace le champ vide')
      })
    })

    it('value.number sur un champ nombre, un champ de {for} et un champ texte lu en nombre : vidés, ils restent vides', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        for (const [classe, mod] of [['m', 'm'], ['r', 'rv'], ['t', 't']]) {
          await entrer(page, classe)
          await taper(page, ['Backspace'])
          assert.equal((await etat(page, classe)).value, '', `${classe} : le champ reste vide`)
          assert.equal(await modele(page, mod), '0', `${classe} : le modèle vaut 0`)
        }
      })
    })

    it('value.int vidé : le champ reste vide et le modèle garde son entier (parseInt d\'un champ vide n\'est pas un nombre)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await entrer(page, 'i')
        await taper(page, ['Backspace'])
        assert.equal((await etat(page, 'i')).value, '', 'le champ reste vide')
        assert.equal(await modele(page, 'i'), '6', 'le modèle ne reçoit pas NaN')
        await taper(page, ['9'])
        assert.equal(await modele(page, 'i'), '9')
      })
    })
  })
}
