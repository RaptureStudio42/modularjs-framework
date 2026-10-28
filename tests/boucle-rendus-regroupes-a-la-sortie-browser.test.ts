// Navigateurs réels (Chromium, Firefox, WebKit), développement et production, Civet et CoffeeScript : une boucle du code
// d'un composant qui écrit l'état N fois écrit les textes et attributs d'une variable une fois, à sa sortie, et
// l'instruction qui suit la boucle les lit à jour. Les blocs (`{for}`) et les reffets gardent leur heure d'avant : la
// microtâche qui suit. Les écritures DOM sont comptées par un MutationObserver (`takeRecords`, synchrone, juste après l'appel).
// D'abord ce qui ne change pas : liste `{for}` écrite en boucle, boucle qui attend (`await`, rendu à chaque écriture). Puis :
// écriture profonde (affectation simple et composée), `$x` dans un `while`, les formes de boucle du langage (une passe par
// boucle), exception levée dans la boucle, `return` depuis la boucle, boucles imbriquées (seule la plus extérieure
// redessine), variable remise à sa valeur d'avant, texte et liste du même composant (le texte attend le bloc), magasin `$$`
// lu par deux composants (une passe chacun), reffet (une passe, sur l'état final), douze mille sorties de boucle dans un même
// tour (pas une boucle réactive), `.forEach` hors de toute boucle dont le rappel écrit l'état (regroupé comme une boucle).

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves, type Cible } from './helpers/liaison-navigateur.js'

const RACINE  = 'mjs-boucle-racine'
const GABARIT = `
<p class="o">{$o.a.b.c}</p>
<p class="n">{$n}</p>
<p class="t">{$$total}</p>
<ul>{for it in $items}<li>{it}</li>{end}</ul>
`
const LECTEUR = "document.querySelector('mjs-boucle-racine')._shadow.querySelector('mjs-boucle-lecteur')._shadow.querySelector('.t').textContent"

const CIVET = `<script>
$o = {a: {b: {c: 0}}}
$n = 0
$items = []
$cles = {a: 1, b: 2, c: 3}
$$total = 0
µeffect ->
  window.effets.push(['civet', $n]) if window.effets
txt = (c) -> @@_shadow.querySelector(c).textContent
lecteur = -> ${LECTEUR}
@remise = ->
  $o = {a: {b: {c: 0}}}
  $n = 0
  $items = []
  $$total = 0
@profond = (n) ->
  for i of [1..n]
    $o.a.b.c = i
  txt '.o'
@composee = (n) ->
  for i of [1..n]
    $o.a.b.c += 1
  txt '.o'
@tantque = (n) ->
  i .= 0
  while i < n
    i++
    $n = i
  txt '.n'
@formes = ->
  for v in Object.values($cles)
    $n += v
  do
    $n++
  while $n < 10
  loop
    $n++
    break if $n >= 12
  for x of [1, 2]
    $n += x
  txt '.n'
@exception = (n) ->
  vu .= null
  try
    for i of [1..n]
      $n = i
      throw new Error('stop') if i == 3
  catch e
    vu = txt '.n'
  $o.a.b.c = 77
  {vu, apres: txt('.o')}
@retour = (n) ->
  for i of [1..n]
    $n = i
    return 'parti' if i == 5
  'fin'
@imbrique = ->
  vus := []
  for i of [1..3]
    for j of [1..3]
      $n = i * 10 + j
    vus.push txt('.n')
  vus.push txt('.n')
  vus
@retourAvant = (n) ->
  avant := $n
  for i of [1..n]
    $n = i
    $n = avant if i == n
  txt '.n'
lignes = -> @@_shadow.querySelectorAll('li').length
@liste = (n) ->
  for i of [1..n]
    $items.push i
  avant := lignes()
  await null
  [avant, lignes()]
@melange = (n) ->
  for i of [1..n]
    $n = i
    $items.push i
  avant := [txt('.n'), lignes()]
  await null
  [avant, [txt('.n'), lignes()]]
@magasin = (n) ->
  for i of [1..n]
    $$total = i
  [txt('.t'), lecteur()]
@attente = (n) ->
  vus := []
  for i of [1..n]
    $n = i
    await null
    vus.push txt('.n')
  vus
@effet = (n) ->
  for i of [1..n]
    $n = i
  null
@rappel = (n) ->
  [1..n].forEach (k) -> $n = k
  txt '.n'
unPas = (k) ->
  for i of [1..2]
    $n = k
@milliers = (n) ->
  [1..n].forEach (k) -> unPas(k)
  txt '.n'
</script>
${GABARIT}`

const COFFEE = `<script lang="coffee">
$o = {a: {b: {c: 0}}}
$n = 0
$items = []
$cles = {a: 1, b: 2, c: 3}
$$total = 0
µeffect ->
  window.effets.push(['coffee', $n]) if window.effets
txt = (c) -> @@_shadow.querySelector(c).textContent
lecteur = -> ${LECTEUR}
@remise = ->
  $o = {a: {b: {c: 0}}}
  $n = 0
  $items = []
  $$total = 0
@profond = (n) ->
  for i in [1..n]
    $o.a.b.c = i
  txt '.o'
@composee = (n) ->
  for i in [1..n]
    $o.a.b.c += 1
  txt '.o'
@tantque = (n) ->
  i = 0
  while i < n
    i++
    $n = i
  txt '.n'
@formes = ->
  for k of $cles
    $n += $cles[k]
  until $n >= 10
    $n++
  loop
    $n++
    break if $n >= 12
  ($n += x for x in [1, 2])
  txt '.n'
@exception = (n) ->
  vu = null
  try
    for i in [1..n]
      $n = i
      throw new Error('stop') if i == 3
  catch e
    vu = txt '.n'
  $o.a.b.c = 77
  {vu, apres: txt('.o')}
@retour = (n) ->
  for i in [1..n]
    $n = i
    return 'parti' if i == 5
  'fin'
@imbrique = ->
  vus = []
  for i in [1..3]
    for j in [1..3]
      $n = i * 10 + j
    vus.push txt('.n')
  vus.push txt('.n')
  vus
@retourAvant = (n) ->
  avant = $n
  for i in [1..n]
    $n = i
    $n = avant if i == n
  txt '.n'
lignes = -> @@_shadow.querySelectorAll('li').length
@liste = (n) ->
  for i in [1..n]
    $items.push i
  avant = lignes()
  await null
  [avant, lignes()]
@melange = (n) ->
  for i in [1..n]
    $n = i
    $items.push i
  avant = [txt('.n'), lignes()]
  await null
  [avant, [txt('.n'), lignes()]]
@magasin = (n) ->
  for i in [1..n]
    $$total = i
  [txt('.t'), lecteur()]
@attente = (n) ->
  vus = []
  for i in [1..n]
    $n = i
    await null
    vus.push txt('.n')
  vus
@effet = (n) ->
  for i in [1..n]
    $n = i
  null
@rappel = (n) ->
  [1..n].forEach (k) -> $n = k
  txt '.n'
unPas = (k) ->
  for i in [1..2]
    $n = k
  null
@milliers = (n) ->
  [1..n].forEach (k) -> unPas(k)
  txt '.n'
</script>
${GABARIT}`

const SOURCES: Record<string, string> = {
  'boucle-racine.mjs':  '<@boucle-civet></@boucle-civet>\n<@boucle-coffee></@boucle-coffee>\n<@boucle-lecteur></@boucle-lecteur>\n',
  'boucle-civet.mjs':   CIVET,
  'boucle-coffee.mjs':  COFFEE,
  'boucle-lecteur.mjs': '<p class="t">{$$total}</p>\n',
}

// un cas : remise à zéro, une tâche plus tard l'observateur posé sur l'ombre du composant et sur celle du lecteur du magasin,
// l'appel ; `sync` = écritures DOM comptées juste après le retour de l'appel (relevés non livrés compris : pendant une attente,
// l'observateur livre les siens à son rappel), `n` = le texte de `.n` à ce moment, `total` =
// toutes les écritures DOM une fois l'appel fini (promesse comprise) et une tâche passée, `effets` = passages des reffets
const JOUER = `async ({ balise, methode, args }) => {
  const racine = document.querySelector('${RACINE}')._shadow
  const el     = racine.querySelector(balise)
  const lec    = racine.querySelector('mjs-boucle-lecteur')
  el.remise()
  await new Promise((r) => setTimeout(r, 0))
  const vus = [0, 0]
  const obs = [el._shadow, lec._shadow].map((sh, i) => {
    const o = new MutationObserver((l) => { vus[i] += l.length })
    o.observe(sh, { subtree: true, characterData: true, childList: true })
    return o
  })
  window.effets = []
  let ret      = el[methode](...args)
  const pris   = obs.map((o) => o.takeRecords().length)
  const sync   = pris.map((p, i) => vus[i] + p)
  const n      = el._shadow.querySelector('.n').textContent
  if (ret && typeof ret.then === 'function') ret = await ret
  await new Promise((r) => setTimeout(r, 0))
  const total  = obs.map((o, i) => vus[i] + pris[i] + o.takeRecords().length)
  obs.forEach((o) => o.disconnect())
  const effets = window.effets
  window.effets = null
  return { ret, sync, n, total, effets }
}`

type Jeu = { ret: any, sync: number[], n: string, total: number[], effets: any[] }

describe('boucle du code d\'un composant : textes et attributs écrits une fois, à la sortie de la boucle ; blocs et reffets comme avant (navigateurs réels, dev et production)', function () {
  this.timeout(300000)
  const cibles: Record<string, Cible> = {}

  before(async function () {
    this.timeout(300000)
    for (const mode of ['dev-parents-avant', 'bundle'] as const) cibles[mode] = await construire(mode, SOURCES, [RACINE])
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const mode of ['dev-parents-avant', 'bundle']) {
    for (const moteur of ['chromium', 'firefox', 'webkit']) {
      for (const langue of ['civet', 'coffee']) {
        it(`${moteur}, ${mode === 'bundle' ? 'production' : 'développement'}, ${langue === 'civet' ? 'Civet' : 'CoffeeScript'}`, async function () {
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
                const r = document.querySelector('${RACINE}')
                const sh = r && r._shadow
                return !!sh && ['mjs-boucle-civet', 'mjs-boucle-coffee', 'mjs-boucle-lecteur'].every((t) => { const e = sh.querySelector(t); return e && e._shadow && e._shadow.querySelector('.t') })
              })()`, null, { timeout: 10000 })
              await o.page.waitForTimeout(200)
              const balise = `mjs-boucle-${langue}`
              const jouer  = (methode: string, args: any[] = []): Promise<Jeu> => o.page.evaluate(`(${JOUER})(${JSON.stringify({ balise, methode, args })})`)

              // ce qui ne change pas : un bloc écrit en boucle se redessine dans la microtâche qui suit, comme avant
              let j = await jouer('liste', [5])
              assert.deepEqual(j.ret, [0, 5], 'liste {for} écrite en boucle : pas de ligne juste après la boucle, toutes après la microtâche, comme avant')

              j = await jouer('attente', [3])
              assert.deepEqual(j.ret, ['1', '2', '3'], 'boucle qui attend : rendu à chaque écriture, comme avant')
              assert.equal(j.total[0], 3, `boucle qui attend : 3 écritures DOM (${j.total[0]})`)

              // ce qui change : les textes et attributs d'une variable écrits une fois, à la sortie de la boucle
              j = await jouer('profond', [1000])
              assert.equal(j.ret, '1000', 'écriture profonde : DOM à jour juste après la boucle')
              assert.equal(j.sync[0], 1, `écriture profonde : 1 écriture DOM pour 1000 écritures d'état (${j.sync[0]})`)

              j = await jouer('composee', [300])
              assert.equal(j.ret, '300', 'affectation composée d\'un chemin profond : DOM à jour juste après la boucle')
              assert.equal(j.sync[0], 1, `affectation composée d'un chemin profond : 1 écriture DOM (${j.sync[0]})`)

              j = await jouer('tantque', [500])
              assert.equal(j.ret, '500', 'while : DOM à jour juste après la boucle')
              assert.equal(j.sync[0], 1, `while : 1 écriture DOM (${j.sync[0]})`)

              j = await jouer('formes')
              assert.equal(j.ret, '15', 'formes de boucle : DOM à jour après la dernière')
              assert.equal(j.sync[0], 4, `formes de boucle : une écriture DOM par boucle, 4 boucles (${j.sync[0]})`)

              j = await jouer('exception', [10])
              assert.deepEqual(j.ret, { vu: '3', apres: '77' }, 'exception : DOM à jour dans le catch, écriture suivante hors boucle tout de suite')
              assert.equal(j.sync[0], 2, `exception : la boucle quittée par l'exception, puis l'écriture hors boucle (${j.sync[0]})`)

              j = await jouer('retour', [10])
              assert.equal(j.ret, 'parti')
              assert.equal(j.n, '5', 'return depuis la boucle : DOM à jour au retour de la méthode')
              assert.equal(j.sync[0], 1, `return depuis la boucle : 1 écriture DOM (${j.sync[0]})`)

              j = await jouer('imbrique')
              assert.deepEqual(j.ret, ['0', '0', '0', '33'], 'boucles imbriquées : seule la sortie de la plus extérieure redessine')
              assert.equal(j.sync[0], 1, `boucles imbriquées : 1 écriture DOM (${j.sync[0]})`)

              j = await jouer('retourAvant', [20])
              assert.equal(j.ret, '0', 'variable remise à sa valeur d\'avant dans la boucle : écran juste')
              assert.ok(j.sync[0] <= 1, `variable remise à sa valeur d'avant : au plus 1 écriture DOM (${j.sync[0]})`)

              // un texte du même composant qu'un bloc écrit dans la même boucle attend ce bloc : le bloc d'abord, puis ses liaisons, sur
              // l'état final, dans la microtâche (avant, la première écriture du texte s'affichait tout de suite, les suivantes attendaient)
              j = await jouer('melange', [5])
              assert.deepEqual(j.ret, [['0', 0], ['5', 5]], 'texte et liste écrits dans la même boucle : tous deux après la microtâche')

              j = await jouer('magasin', [50])
              assert.deepEqual(j.ret, ['50', '50'], 'magasin : les deux composants qui l\'affichent sont à jour juste après la boucle')
              assert.deepEqual(j.sync, [1, 1], `magasin : une passe par composant touché (${j.sync})`)

              j = await jouer('effet', [100])
              assert.equal(j.sync[0], 1, `reffet : 1 écriture DOM (${j.sync[0]})`)
              assert.deepEqual(j.effets, [[langue, 100]], 'reffet : un passage, sur l\'état final')

              // un `.forEach` hors de toute boucle dont le rappel écrit l'état : regroupé comme une boucle
              j = await jouer('rappel', [300])
              assert.equal(j.ret, '300', '.forEach hors boucle : DOM à jour juste après l\'appel')
              assert.equal(j.sync[0], 1, `.forEach hors boucle : 1 écriture DOM (${j.sync[0]})`)

              // dix mille sorties de boucle dans un même tour (une fonction qui boucle, appelée par un `.forEach`) : ce ne sont pas des
              // microtâches, la garde des boucles réactives ne les compte pas — l'affichage suit jusqu'au bout
              j = await jouer('milliers', [12000])
              assert.equal(j.ret, '12000', 'douze mille sorties de boucle dans un même tour : l\'affichage suit jusqu\'au bout')
              assert.deepEqual(o.avis.filter((a) => /Boucle réactive|reactive loop/i.test(a)), [])

              assert.deepEqual(graves(o), [])
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
  }
})
