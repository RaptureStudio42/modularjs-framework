// l'ancre de départ d'un `{if}` ou d'un `{key}` d'une branche {await} naît sans repère de choix : le pool de nœuds texte remet à neuf les nœuds qu'il sert (`_mjs_old_branch`, `_mjs_old_key`, `_mjs_key_set`),
// le code émis du `{if}` n'a donc plus à reconnaître une ancre vide pour construire son premier choix. Le `{key}` lit son repère de clé posée, non sa valeur : un `{key}` de valeur `undefined`
// construit son contenu dans l'attente comme dans `{success}` (en tout lieu, cf. key-valeur-indefinie-browser.test.ts), puis suit la clé quand elle change.
// Le code émis du `{if}` (lecture), puis les trois modes (développement, production en fichiers séparés, production en un seul fichier) en navigateur réel, Chromium puis Firefox quand il est installé.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const BALISE = 'mjs-blocs-ancre-de-depart'

const SOURCES: Record<string, string> = {
  'blocs-ancre-de-depart.mjs': `<script>
  $u = undefined

  fin = null
  armer = (res) -> fin = res
  $p = new Promise(armer)

  @finir = -> fin({ t: 'T' })
  @poser = (x) -> $u = x
</script>
<u class="hors">h</u>
{await $p}
  {key $u}<s class="pk">k{$u}</s>{end}
{success v}
  <div class="a">{key $u}<s class="ka">k{$u}</s>{end}</div>
  <div class="b">{key v.absent}<s class="kb">k</s>{end}</div>
{end}
`
}

// ----- le code émis : le `{if}` d'une branche {await} choisit sur le seul repère de son ancre
describe('code émis : le {if} d\'une branche {await} ne reconnaît pas une ancre vide', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const emis = async (gabarit: string) => (await transpile(`<script>\n  $p = Promise.resolve({ t: 'T' })\n  $m = 'x'\n</script>\n${gabarit}\n`, { moduleName: 'abd-emis' })).output

  it('dans l\'attente et dans {success} : le choix lu sur l\'ancre est comparé seul, aucun test de voisinage entre l\'ouverture et la fermeture', async () => {
    const code = await emis('{await $p}\n{if $m is \'x\'}<i>a</i>{end}\n{success v}\n{if v.t is \'T\'}<b>{v.t}</b>{else}<u>x</u>{end}\n{end}')
    const choix = code.match(/if \(_c_if\d+ !== _mjs_ifStart\._mjs_old_branch\) \{/g) ?? []
    assert.ok(choix.length >= 3, `le choix est comparé à celui de l'ancre, à la construction de chaque branche et dans l'effet de l'attente : ${choix.length} comparaison(s)`)
    assert.ok(!code.includes('_mjs_ifStart.nextSibling'), 'aucun test de voisinage de l\'ancre de départ')
  })
})

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, [BALISE]))
  return cibles.get(mode)!
}

// le nombre de balises de chaque `{key}` et le texte de celui de {success}
const lire = (page: any): Promise<string> => page.evaluate(`(() => {
  const sh = document.querySelector('${BALISE}')._shadow
  const n  = (c) => sh.querySelectorAll('.' + c).length
  const a  = sh.querySelector('.ka')
  return 'pk=' + n('pk') + ' ka=' + n('ka') + ' kb=' + n('kb') + ' texte=' + (a ? a.textContent : '-')
})()`)

for (const moteur of ['chromium', 'firefox'] as const) for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`un {key} de valeur undefined dans une branche {await} (${mode}, ${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[moteur].executablePath())
    if (!present) { console.log(`  ℹ️  ${moteur} non installé, test des clés indéfinies sauté. Activer : \`npx playwright install ${moteur}\``); return }
    browser = await playwright[moteur].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('construit son contenu dans l\'attente et dans {success}, puis suit la clé quand elle change', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(mode), BALISE)
    const geste = async (appel: string) => {
      await o.page.evaluate(`(() => { document.querySelector('${BALISE}').${appel}; return null })()`)
      await o.page.waitForTimeout(250)
    }
    try {
      await o.page.waitForFunction(`!!document.querySelector('${BALISE}')?._shadow?.querySelector('.hors')`, null, { timeout: 10000 })
      await o.page.waitForTimeout(150)
      assert.equal(await lire(o.page), 'pk=1 ka=0 kb=0 texte=-', 'l\'attente')
      await geste('finir()')
      assert.equal(await lire(o.page), 'pk=0 ka=1 kb=1 texte=k', '{success} après l\'arrivée')
      await geste('poser(\'z\')')
      assert.equal(await lire(o.page), 'pk=0 ka=1 kb=1 texte=kz', 'la clé devient z')
      await geste('poser()')
      assert.equal(await lire(o.page), 'pk=0 ka=1 kb=1 texte=k', 'la clé redevient undefined')
      assert.deepEqual(graves(o), [])
    } finally {
      await o.fermer()
    }
  })
})
