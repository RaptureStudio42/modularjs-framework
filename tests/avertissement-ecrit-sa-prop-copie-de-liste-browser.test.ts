// avertissement de développement « écrit sa prop », en navigateur réel (Chromium, Firefox, WebKit) : un enfant qui réécrit une liste reçue
// à sens unique avec une copie des mêmes éléments (`$cases = $cases.slice()`, ce que fait la remise à zéro d'un formulaire dans un module
// cœur) ne change rien, le parent et l'enfant montrent la même chose : rien n'est dit. Une liste aux éléments différents est dite, une fois.
// En production, rien n'est dit, la page se comporte de même.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'rs-copie.mjs': `<script>
  $c = [0, 2]
</script>

<@c-copie cases={$c}>
<p class="etat">{$c.join(',')}</p>
`,
  'c-copie.mjs': `<script>
  $cases = []

  remettre = -> $cases = $cases.slice()
  changer  = -> $cases = [5]
</script>

<p class="vu">{$cases.join(',')}</p>
<button class="r" type="button" @click={remettre()}>r</button>
<button class="x" type="button" @click={changer()}>x</button>
`,
}
const BALISE = 'mjs-rs-copie'

const NAVIGATEURS = ['chromium', 'firefox', 'webkit'] as const
const MODES: Mode[] = ['dev-parents-avant', 'bundle']

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, [BALISE]))
  return cibles.get(mode)!
}

// ce que la console a dit de l'avertissement
const nosAvis = (avis: string[]) => avis.filter((a) => /écrit sa prop|writes its prop/.test(a))

// un bouton de l'enfant, cliqué par le script ; puis ce que montrent l'enfant et le parent
const cliquer = (page: any, bouton: string) => page.evaluate(`document.querySelector('${BALISE}')._shadow.querySelector('mjs-c-copie')._shadow.querySelector('${bouton}').click()`)
const montre  = (page: any): Promise<string> => page.evaluate(`(() => { const sh = document.querySelector('${BALISE}')._shadow; return sh.querySelector('mjs-c-copie')._shadow.querySelector('.vu').textContent + ' / ' + sh.querySelector('.etat').textContent })()`)

for (const nav of NAVIGATEURS) for (const mode of MODES) describe(`avertissement « écrit sa prop » : une copie des mêmes éléments ne change rien (${mode}, ${nav} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) return
    browser = await playwright[nav].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  it(mode === 'bundle' ? 'production : rien n\'est dit, la page se comporte de même' : 'la copie des mêmes éléments se tait, une liste différente est dite une fois', async () => {
    const o = await charger(browser, await cible(mode), BALISE)
    try {
      await o.page.waitForFunction(`!!document.querySelector('${BALISE}')?._shadow?.querySelector('mjs-c-copie')?._shadow?.querySelector('.vu')`, null, { timeout: 10000 })
      await o.page.waitForTimeout(150)
      assert.equal(await montre(o.page), '0,2 / 0,2', 'l\'enfant reçoit la liste du parent')
      await cliquer(o.page, '.r')
      await o.page.waitForTimeout(150)
      assert.equal(await montre(o.page), '0,2 / 0,2', 'la copie montre les mêmes éléments')
      assert.deepEqual(nosAvis(o.avis), [], 'une copie des mêmes éléments ne dit rien')
      await cliquer(o.page, '.x')
      await o.page.waitForTimeout(150)
      assert.equal(await montre(o.page), '5 / 0,2', 'la liste différente reste à l\'enfant, le parent garde la sienne')
      const dits = nosAvis(o.avis)
      if (mode === 'bundle') assert.deepEqual(dits, [], 'la production ne dit rien')
      else assert.ok(dits.length === 1 && dits[0].includes('<@c-copie>') && /« cases »/.test(dits[0]), `une liste différente est dite une fois : ${JSON.stringify(dits)}`)
      assert.deepEqual(graves(o), [], 'aucune erreur')
    }
    finally {
      await o.fermer()
    }
  })
})
