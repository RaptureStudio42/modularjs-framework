// Navigateurs réels (Chromium, Firefox, WebKit), développement et production : une boucle du parent qui écrit la variable passée en
// prop à un composant enfant, puis appelle une méthode de cet enfant, lui fait lire la valeur du tour. La prop est de l'état de l'enfant,
// pas un attribut du DOM : elle arrive à chaque écriture, comme hors boucle, et l'enfant qui garde ce qu'il reçoit finit avec « a,b,c ».
// CoffeeScript, Civet et JS, liaison simple (`x={$courant}`) et à deux sens (`x=!{$courant}`). Les textes d'une variable qui ne
// passe à aucun enfant restent regroupés : une écriture DOM, à la sortie de la boucle, déjà lue par l'instruction qui la suit.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves, type Cible } from './helpers/liaison-navigateur.js'

const RACINE = 'mjs-prop-racine'

const corps = (langue: 'coffee' | 'civet', lien: string) => `<script${langue === 'coffee' ? ' lang="coffee"' : ''}>
$courant = ''
$vu = ''
@jouer = ->
  p = @@_shadow.querySelector('mjs-c-panier')
  for it ${langue === 'coffee' ? 'in' : 'of'} ['a', 'b', 'c']
    $courant = it
    $vu = it
    p.garder()
  p.contenu()
</script>
<@c-panier x=${lien}></@c-panier>
<p class="n">{$vu}</p>
`
const enJs = (lien: string) => `<script lang="js">
$courant = ''
$vu = ''
@jouer = function() {
  const p = this._shadow.querySelector('mjs-c-panier')
  for (const it of ['a', 'b', 'c']) {
    $courant = it
    $vu = it
    p.garder()
  }
  return p.contenu()
}
</script>
<@c-panier x=${lien}></@c-panier>
<p class="n">{$vu}</p>
`
// l'enfant garde chaque valeur reçue, au moment où le parent l'appelle
const PANIER = `<script>
$x = ''
$liste = []
@garder = -> $liste.push($x)
@contenu = -> $liste.join(',')
</script>
<p class="vu">{$liste.join(',')}</p>
`

const PARENTS: Record<string, string> = {
  'coffee':          corps('coffee', '{$courant}'),
  'civet':           corps('civet', '{$courant}'),
  'js':              enJs('{$courant}'),
  'coffee-deuxsens': corps('coffee', '!{$courant}'),
  'civet-deuxsens':  corps('civet', '!{$courant}'),
  'js-deuxsens':     enJs('!{$courant}'),
}
const NOMS = Object.keys(PARENTS)
const SOURCES: Record<string, string> = {
  'prop-racine.mjs': NOMS.map((n) => `<@prop-${n}></@prop-${n}>`).join('\n') + '\n',
  'c-panier.mjs':    PANIER,
  ...Object.fromEntries(NOMS.map((n) => [`prop-${n}.mjs`, PARENTS[n]])),
}

// un parent : l'appel, le texte `.n` lu juste après (et ses écritures DOM comptées), puis, une tâche plus tard, ce que l'enfant montre et garde
const JOUER = `async (nom) => {
  const el  = document.querySelector('${RACINE}')._shadow.querySelector('mjs-prop-' + nom)
  const n   = el._shadow.querySelector('.n')
  const obs = new MutationObserver(() => {})
  obs.observe(n, { subtree: true, characterData: true, childList: true })
  const ret        = el.jouer()
  const vu         = n.textContent
  const ecritures  = obs.takeRecords().length
  obs.disconnect()
  await new Promise((r) => setTimeout(r, 0))
  const p = el._shadow.querySelector('mjs-c-panier')
  return { ret, vu, ecritures, ecran: p._shadow.querySelector('.vu').textContent, etat: p.contenu() }
}`

describe('boucle du parent : la prop d\'un composant enfant arrive à chaque écriture, les textes restent regroupés (navigateurs réels, dev et production)', function () {
  this.timeout(300000)
  const cibles: Record<string, Cible> = {}
  before(async function () {
    this.timeout(300000)
    for (const mode of ['dev-parents-avant', 'bundle'] as const) cibles[mode] = await construire(mode, SOURCES, [RACINE])
  })
  after(async () => { await terminateSharedWorkerPool() })
  for (const mode of ['dev-parents-avant', 'bundle']) {
    for (const moteur of ['chromium', 'firefox', 'webkit']) {
      it(`${moteur}, ${mode === 'bundle' ? 'production' : 'développement'} : CoffeeScript, Civet et JS, liaison simple et à deux sens`, async function () {
        const playwright: any = await import('playwright')
        if (!existsSync(playwright[moteur].executablePath())) {
          console.log(`  ℹ️  ${moteur} non installé, test sauté. Activer : \`npx playwright install ${moteur}\``)
          this.skip()
        }
        const browser = await playwright[moteur].launch()
        try {
          const o = await charger(browser, cibles[mode], RACINE)
          try {
            await o.page.waitForFunction(`(() => {
              const sh = document.querySelector('${RACINE}')?._shadow
              return !!sh && ${JSON.stringify(NOMS)}.every((n) => {
                const e = sh.querySelector('mjs-prop-' + n)
                const p = e && e._shadow && e._shadow.querySelector('mjs-c-panier')
                return p && p._shadow && p._shadow.querySelector('.vu') && e._shadow.querySelector('.n')
              })
            })()`, null, { timeout: 10000 })
            await o.page.waitForTimeout(200)
            for (const nom of NOMS) {
              const j = await o.page.evaluate(`(${JOUER})(${JSON.stringify(nom)})`)
              assert.equal(j.ret, 'a,b,c', `${nom} : la méthode de l'enfant appelée dans la boucle lit la valeur du tour`)
              assert.equal(j.etat, 'a,b,c', `${nom} : l'enfant garde les trois valeurs`)
              assert.equal(j.ecran, 'a,b,c', `${nom} : l'enfant les affiche`)
              assert.equal(j.vu, 'c', `${nom} : le texte d'une autre variable est à jour juste après la boucle`)
              assert.equal(j.ecritures, 1, `${nom} : ce texte est écrit une fois, à la sortie de la boucle (${j.ecritures})`)
            }
            assert.deepEqual(graves(o), [], 'aucune erreur')
          }
          finally {
            await o.fermer()
          }
        }
        finally {
          await browser.close()
        }
      })
    }
  }
})
