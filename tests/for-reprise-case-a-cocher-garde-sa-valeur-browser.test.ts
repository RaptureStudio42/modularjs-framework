// la ligne neuve d'une clé neuve (remplacement total d'une liste à clé, ou remplissage après un vidage : aucune ancienne ligne n'est
// reprise) garde la valeur de ses cases à cocher et de ses boutons radio : sans attribut `value`, une case vaut « on », et le formulaire
// envoie « on » pour une case cochée ; une case à valeur écrite garde la sienne
// développement et production en un seul fichier ; Chromium réel

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'cc-cases.mjs': `<script>
  $liste = []

  @poser = (l) -> $liste = l
</script>
<form class="f">
  <ul class="l">{for x in $liste by id}<li><input type="checkbox" name="c" checked={x.c} aria-label="case"><input type="radio" name="r" aria-label="radio"><input type="checkbox" name="v" value="valeur" aria-label="valeur"><span>{x.nom}</span></li>{end}</ul>
</form>
<p class="pret">prêt</p>
`
}

const BALISES = ['mjs-cc-cases']

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode) as Promise<Cible>
}

const B = 'mjs-cc-cases'

const lignes = (de: number, a: number) => {
  const r: string[] = []
  for (let i = de; i <= a; i++) r.push(`{ id: ${i}, nom: 'n${i}', c: ${i % 2 === 0} }`)
  return '[' + r.join(', ') + ']'
}

const regler = async (page: any, appel: string) => {
  await page.evaluate(`(() => { document.querySelector('${B}').${appel}; return null })()`)
  await page.waitForTimeout(150)
}

// valeurs des cases, des radios et des cases à valeur écrite ; textes des lignes ; éléments repris de la passe d'avant
const lire = (page: any): Promise<{ cases: string, radios: string, valeurs: string, textes: string, reprises: number }> => page.evaluate(`(() => {
  const r = document.querySelector('${B}')._shadow
  const v = (s) => Array.from(r.querySelectorAll(s)).map((n) => n.value).join(',')
  const lis = Array.from(r.querySelectorAll('ul.l li'))
  const reprises = lis.filter((li) => li.__before).length
  lis.forEach((li) => { li.__before = 1 })
  return { cases: v('input[name=c]'), radios: v('input[name=r]'), valeurs: v('input[name=v]'), textes: lis.map((li) => li.textContent).join(','), reprises }
})()`)

for (const mode of ['dev-parents-avant', 'bundle'] as const) describe(`ligne neuve d'une clé neuve : la case à cocher garde sa valeur (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test de la case à cocher sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  const jouer = async (scenario: (page: any) => Promise<void>) => {
    const o = await charger(browser, await cible(mode), B)
    try {
      await o.page.waitForFunction(`!!document.querySelector('${B}')?._shadow?.querySelector('.pret')`, null, { timeout: 10000 })
      await o.page.waitForTimeout(100)
      await scenario(o.page)
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  }

  it('toutes les clés changent : les lignes neuves gardent la valeur de leurs cases', async function () {
    if (!present) { this.skip(); return }
    await jouer(async (page) => {
      await regler(page, `poser(${lignes(1, 4)})`)
      await lire(page)
      await regler(page, `poser(${lignes(11, 14)})`)
      const l = await lire(page)
      assert.equal(l.textes, 'n11,n12,n13,n14', 'les lignes des clés neuves')
      assert.equal(l.reprises, 0, 'aucune ancienne ligne reprise')
      assert.equal(l.cases, 'on,on,on,on', 'case sans attribut value : « on »')
      assert.equal(l.radios, 'on,on,on,on', 'radio sans attribut value : « on »')
      assert.equal(l.valeurs, 'valeur,valeur,valeur,valeur', 'case à valeur écrite : la sienne')
      // le formulaire envoie « on » pour une case cochée d'une ligne neuve
      const envoi = await page.evaluate(`(() => { const r = document.querySelector('${B}')._shadow; return new FormData(r.querySelector('form.f')).getAll('c').join(',') })()`)
      assert.equal(envoi, 'on,on', 'cases cochées (clés 12 et 14) envoyées « on »')
    })
  })

  it('après un vidage, les lignes neuves gardent la valeur de leurs cases', async function () {
    if (!present) { this.skip(); return }
    await jouer(async (page) => {
      await regler(page, `poser(${lignes(1, 3)})`)
      await lire(page)
      await regler(page, 'poser([])')
      await regler(page, `poser(${lignes(21, 23)})`)
      const l = await lire(page)
      assert.equal(l.textes, 'n21,n22,n23')
      assert.equal(l.reprises, 0, 'aucune ligne vidée reprise')
      assert.equal(l.cases, 'on,on,on', 'case sans attribut value : « on »')
      assert.equal(l.radios, 'on,on,on', 'radio sans attribut value : « on »')
      assert.equal(l.valeurs, 'valeur,valeur,valeur', 'case à valeur écrite : la sienne')
    })
  })
})
