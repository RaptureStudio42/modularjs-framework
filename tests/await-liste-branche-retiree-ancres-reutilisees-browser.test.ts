// une liste `{for}` posée dans une branche `{await}` (directement, ou sous un `{if}` de la branche) n'écrit plus rien quand sa branche n'est plus affichée : ses deux repères sont des
// nœuds texte que le pool de nœuds texte réattribue, à la destruction de la branche, aux balises de la branche suivante ; la liste, rappelée par sa variable, y insérait ses lignes
// (une ligne `<li>` de la liste retirée restait dans l'attente) ou plantait le composant (« insertBefore … is not a child of this node »).
// Chaque cas joue l'histoire minimale (la promesse arrive, puis elle est relancée et une variable change), dans le même tour et en tours séparés, puis laisse la promesse arriver de
// nouveau : la liste porte alors exactement les lignes de la nouvelle valeur, et elle suit encore la variable.
// Les trois modes (développement, production en fichiers séparés, production en un seul fichier) en navigateur réel, Chromium puis Firefox quand il est installé.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

// le composant : une attente qui lit deux variables et porte un `{if}` (de quoi réattribuer plusieurs repères), puis `{success}` ; la promesse est tenue par le test
const ENTETE = `<script>
  $a = 'a0'
  $b = 'b0'
  $m = 'x'
  $k = 1

  fin = null
  armer = (res) ->
    fin = res
  nouvelle = -> new Promise(armer)
  $p = nouvelle()

  @finir    = (x) -> fin(x)
  @relancer = -> $p = nouvelle()
  @ra       = (x) -> $a = x
  @rk       = (x) -> $k = x
</script>
<u class="hors">{$a}</u>
{await $p}
  <i class="att" title={$a + $b}>w:{$a}/{$b}</i>
  {if $m is 'x'}<s class="aw1">{$b}</s>{else}<s class="aw2">{$a}</s>{end}
`

const SOURCES: Record<string, string> = {
  // la liste est dans {success}, sous une balise
  'liste-direct.mjs': ENTETE + `{success v}
  <ul class="ul">{for x in v.items}<li>{x}{$a}</li>{end}</ul>
{end}
`,
  // la liste est sous un `{if}` de {success}, à côté d'un autre `{if}`
  'liste-bloc.mjs': ENTETE + `{success v}
  {if $k > 1}<div class="ext">{if $m is 'x'}<em class="in1">{$a}</em>{else}<em class="in2">{v.t}{$b}</em>{end}<ul class="ul">{for x in v.items}<li>{x}{$a}</li>{end}</ul></div>{end}
{end}
`
}

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, ['mjs-liste-direct', 'mjs-liste-bloc']))
  return cibles.get(mode)!
}

// ce que la page montre : l'attente, le bloc, la ligne du `{if}` intérieur, les lignes de la liste ; un composant planté se lit « PLANTÉ »
const lire = (page: any, balise: string): Promise<string> => page.evaluate(`(() => {
  const h  = document.querySelector('${balise}')
  const sh = h._shadow
  if (h.classList.contains('mjs-error') || sh.querySelector('.mjs-fatal-error')) return 'PLANTÉ'
  const t = (s) => [...sh.querySelectorAll(s)].map((n) => n.textContent).join('|')
  return 'att=' + t('.att') + ' ; ext=' + sh.querySelectorAll('.ext').length + ' ; in1=' + t('.in1') + ' ; li=' + t('li')
})()`)

// un tour : des appels sur le composant dans le même geste, puis le temps de la mise à jour
const tour = async (page: any, balise: string, appels: string[]) => {
  await page.evaluate(`(() => { const h = document.querySelector('${balise}'); ${appels.map((a) => `h.${a};`).join(' ')} return null })()`)
  await page.waitForTimeout(220)
}

const T1 = 'finir({ t: \'T1\', items: [\'j1\'] })'
const T2 = 'finir({ t: \'T2\', items: [\'p\', \'q\'] })'

type Etape = [string, string[][], string]

// les histoires : [nom, tours (chaque tour = les appels du même geste), lecture attendue après les tours]
const DIRECT: Etape[] = [
  ['avant l\'arrivée',                       [],                                   'att=w:a0/b0 ; ext=0 ; in1= ; li='],
  ['la promesse arrive',                     [[T1]],                               'att= ; ext=0 ; in1= ; li=j1a0'],
  ['relancée et variable changée, même tour', [['relancer()', 'ra(\'a26\')']],     'att=w:a26/b0 ; ext=0 ; in1= ; li='],
  ['la promesse arrive de nouveau',          [[T2]],                               'att= ; ext=0 ; in1= ; li=pa26|qa26'],
  ['la variable change',                     [['ra(\'a27\')']],                    'att= ; ext=0 ; in1= ; li=pa27|qa27']
]
const DIRECT_SEPARES: Etape[] = [
  ['avant l\'arrivée',                       [],                                   'att=w:a0/b0 ; ext=0 ; in1= ; li='],
  ['la promesse arrive',                     [[T1]],                               'att= ; ext=0 ; in1= ; li=j1a0'],
  ['relancée, puis variable changée (deux tours)', [['relancer()'], ['ra(\'a26\')']], 'att=w:a26/b0 ; ext=0 ; in1= ; li='],
  ['la promesse arrive de nouveau',          [[T2]],                               'att= ; ext=0 ; in1= ; li=pa26|qa26'],
  ['la variable change',                     [['ra(\'a27\')']],                    'att= ; ext=0 ; in1= ; li=pa27|qa27']
]
const BLOC: Etape[] = [
  ['avant l\'arrivée',                       [],                                   'att=w:a0/b0 ; ext=0 ; in1= ; li='],
  ['le bloc est levé pendant l\'attente',    [['rk(3)']],                          'att=w:a0/b0 ; ext=0 ; in1= ; li='],
  ['la promesse arrive',                     [[T1]],                               'att= ; ext=1 ; in1=a0 ; li=j1a0'],
  ['relancée et variable changée, même tour', [['relancer()', 'ra(\'a26\')']],     'att=w:a26/b0 ; ext=0 ; in1= ; li='],
  ['la promesse arrive de nouveau',          [[T2]],                               'att= ; ext=1 ; in1=a26 ; li=pa26|qa26'],
  ['la variable change',                     [['ra(\'a27\')']],                    'att= ; ext=1 ; in1=a27 ; li=pa27|qa27']
]
const BLOC_SEPARES: Etape[] = [
  ['avant l\'arrivée',                       [],                                   'att=w:a0/b0 ; ext=0 ; in1= ; li='],
  ['le bloc est levé pendant l\'attente',    [['rk(3)']],                          'att=w:a0/b0 ; ext=0 ; in1= ; li='],
  ['la promesse arrive',                     [[T1]],                               'att= ; ext=1 ; in1=a0 ; li=j1a0'],
  ['relancée, puis variable changée (deux tours)', [['relancer()'], ['ra(\'a26\')']], 'att=w:a26/b0 ; ext=0 ; in1= ; li='],
  ['la promesse arrive de nouveau',          [[T2]],                               'att= ; ext=1 ; in1=a26 ; li=pa26|qa26'],
  ['la variable change',                     [['ra(\'a27\')']],                    'att= ; ext=1 ; in1=a27 ; li=pa27|qa27']
]

for (const moteur of ['chromium', 'firefox'] as const) for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`une liste {for} d'une branche {await} retirée n'écrit plus rien (${mode}, ${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[moteur].executablePath())
    if (!present) { console.log(`  ℹ️  ${moteur} non installé, test de la liste d'une branche retirée sauté. Activer : \`npx playwright install ${moteur}\``); return }
    browser = await playwright[moteur].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // joue l'histoire, une lecture après chaque étape ; tous les écarts sont rendus ensemble, avec les erreurs que la page a dites
  const jouer = async (balise: string, histoire: Etape[]) => {
    const o      = await charger(browser, await cible(mode), balise)
    const ecarts = [] as string[]
    try {
      await o.page.waitForFunction(`!!document.querySelector('${balise}')?._shadow?.querySelector('.hors')`, null, { timeout: 10000 })
      await o.page.waitForTimeout(200)
      for (const [nom, tours, attendu] of histoire) {
        for (const appels of tours) await tour(o.page, balise, appels)
        const lue = await lire(o.page, balise)
        if (lue !== attendu) {
          ecarts.push(`${nom} : attendu ${JSON.stringify(attendu)}, lu ${JSON.stringify(lue)}`)
          break
        }
      }
      assert.deepEqual([...ecarts, ...graves(o).map((g) => `erreur de la page : ${g}`)], [])
    } finally {
      await o.fermer()
    }
  }

  it('les composants se compilent', async function () {
    if (!present) { this.skip(); return }
    await cible(mode)
  })

  it('la liste directe de {success} : promesse relancée et variable changée dans le même tour', async function () {
    if (!present) { this.skip(); return }
    await jouer('mjs-liste-direct', DIRECT)
  })

  it('la liste directe de {success} : promesse relancée, puis variable changée au tour suivant', async function () {
    if (!present) { this.skip(); return }
    await jouer('mjs-liste-direct', DIRECT_SEPARES)
  })

  it('la liste sous un {if} de {success} : promesse relancée et variable changée dans le même tour', async function () {
    if (!present) { this.skip(); return }
    await jouer('mjs-liste-bloc', BLOC)
  })

  it('la liste sous un {if} de {success} : promesse relancée, puis variable changée au tour suivant', async function () {
    if (!present) { this.skip(); return }
    await jouer('mjs-liste-bloc', BLOC_SEPARES)
  })
})
