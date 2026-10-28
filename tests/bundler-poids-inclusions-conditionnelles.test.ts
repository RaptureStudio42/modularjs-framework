// le cœur ne porte que le code des fonctions que l'appli écrit : la reprise d'une sortie en cours (transitions), l'index des
// liaisons filtrées par valeur, la balise de `<@view>`, le registre de l'état partagé (`µ.state`, stores), la lecture de
// `matches` des modules de saisie, l'adoption du DOM serveur (`runtime: ['hydrate']`). Dans les deux sens : absent sans la
// fonction, présent avec elle — et une appli qui ne s'en sert pas garde ses listes, ses blocs et ses clés

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'

const REPRISE       = ['prototype._mjs_tryReviveDying = function', 'this._mjs_tryReviveDying(', '__en._mjs_dying', 'dyingTail.push(']
const FILTREES      = ['µ._mjs_filtPut = function', 'prototype._mjs_filtPurgeEntry = function', 'this._mjs_filtPurgeCache(', '__idxBulk']
const VUE           = 'customElements.define(\'metamjs-view\''
const ETAT_PARTAGE  = 'µ._mjs_registerUniversalDep = function'
const NATIFS        = ['µ._mjs_swap ||= function', 'µ._mjs_matches ||= function', 'µ._mjs_animate ||= function']
const ADOPTION      = 'this._mjs_hydrate(factory)'

async function construire(fichiers: Record<string, string>, reglages: Record<string, unknown> = {}): Promise<{ outDir: string; coeur: string }> {
  const root   = mjsTmp('poids-inclusions')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, contenu] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), contenu + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtime: 'core', js: 'split', env: 'dev', ...reglages } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const coeur = readdirSync(outDir).find((f) => /^mjs_core-/.test(f))
  assert.ok(coeur, 'mjs_core-*.js doit exister')
  return { outDir, coeur: readFileSync(join(outDir, coeur!), 'utf-8') }
}

const absents  = (coeur: string, marques: string[]) => marques.filter((m) => coeur.includes(m))
const presents = (coeur: string, marques: string[]) => marques.filter((m) => !coeur.includes(m))

// listes à clé, bloc conditionnel avec sinon, bloc à clé : rien de ce que ce fichier retire du cœur
const SANS = `<script>
$items = [{ id: 1, n: 'a' }, { id: 2, n: 'b' }, { id: 3, n: 'c' }]
$on = true
$k = 1
melanger = ->
  $items = [{ id: 3, n: 'c' }, { id: 1, n: 'a' }, { id: 4, n: 'd' }]
basculer = -> $on = not $on
changer = -> $k = 2
</script>
<ul>{for it in $items by id}<li>{it.n}</li>{end}</ul>
{if $on}<p class="si">oui</p>{else}<p class="sinon">non</p>{end}
{key $k}<span class="cle">{$k}</span>{end}
<button class="b1" @click={melanger()}>1</button><button class="b2" @click={basculer()}>2</button><button class="b3" @click={changer()}>3</button>`

describe('cœur allégé — chaque fonction n\'entre au cœur que si l\'appli s\'en sert', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('appli sans transition, sans liaison filtrée, sans <@view>, sans état partagé : aucun de ces codes au cœur', async () => {
    const { coeur } = await construire({ 'hote.mjs': SANS })
    assert.deepEqual(absents(coeur, REPRISE), [], 'reprise des sorties sans transition')
    assert.deepEqual(absents(coeur, FILTREES), [], 'index des liaisons filtrées sans liaison filtrée')
    assert.equal(coeur.includes(VUE), false, 'balise de <@view> sans <@view>')
    assert.equal(coeur.includes(ETAT_PARTAGE), false, 'registre de l\'état partagé sans µ.state ni store')
    assert.deepEqual(absents(coeur, NATIFS), [], 'aides natives sans consommateur')
    assert.equal(coeur.includes(ADOPTION), false, 'adoption du DOM serveur sans le moteur de reprise')
  })

  it('transitions écrites : la reprise d\'une sortie en cours est au cœur ({if}, {key}, {for})', async () => {
    const { coeur } = await construire({ 'hote.mjs': '<script>\n$on = true\n$xs = [1, 2]\n</script>\n{if $on}<p @in=*fade @out=*fly(up)>x</p>{end}\n<ul>{for x in $xs}<li>{x}</li>{end}</ul>' })
    assert.deepEqual(presents(coeur, REPRISE), [])
  })

  it('liaison filtrée par valeur dans un {for} : son index est au cœur', async () => {
    const { coeur } = await construire({ 'hote.mjs': '<script>\n$choix = \'b\'\n$valeurs = [\'a\', \'b\']\n</script>\n{for x in $valeurs}<p data-on={x is $choix}>x</p>{end}' })
    assert.deepEqual(presents(coeur, FILTREES), [])
  })

  it('<@view> écrite : sa balise est déclarée', async () => {
    const { coeur } = await construire({ 'accueil.page.mjs': '<div><@view main></div>' })
    assert.ok(coeur.includes(VUE))
  })

  it('état partagé (µ.state) : le registre des dépendances est au cœur', async () => {
    const { coeur } = await construire({ 'hote.mjs': '<script>\nn = µ.state({ a: 1 })\n</script>\n<p>{n.a}</p>' })
    assert.ok(coeur.includes(ETAT_PARTAGE))
  })

  it('<@@field> écrit : la lecture de `matches` qu\'il appelle est au cœur', async () => {
    const { coeur } = await construire({ 'hote.mjs': '<@@field label="Nom"><input></@@field>' })
    assert.ok(coeur.includes('µ._mjs_matches ||= function'))
  })

  it('build de développement complet : l\'éclair du panneau garde `_mjs_animate`', async () => {
    const { coeur } = await construire({ 'hote.mjs': '<p>x</p>' }, { runtime: ['ajax'] })
    assert.ok(coeur.includes('µ._mjs_animate ||= function'))
  })

  it('runtime: [\'hydrate\'] : l\'adoption du DOM serveur reste', async () => {
    const { coeur } = await construire({ 'hote.mjs': '<p>x</p>' }, { runtime: ['hydrate'] })
    assert.ok(coeur.includes(ADOPTION))
  })

  it('appli sans ces fonctions : listes à clé, {if}/{else} et {key} marchent avec le cœur allégé', async () => {
    const { outDir } = await construire({ 'hote.mjs': SANS })
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
    const code   = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    try {
      window.eval(`${code}\nglobalThis.µ = µ;\nglobalThis.__erreurs = [];\nµ.error = function(...a) { globalThis.__erreurs.push(a.map(String).join(' ')); };`)
      window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
      const hote = window.document.querySelector('mjs-hote')
      await attendre(() => !!hote._shadow && !!hote._shadow.querySelector('li'))
      const textes = () => [...hote._shadow.querySelectorAll('li')].map((li: any) => li.textContent)
      assert.deepEqual(textes(), ['a', 'b', 'c'])
      hote._shadow.querySelector('.b1').click()
      await attendre(() => textes().join() === 'c,a,d')
      assert.deepEqual(textes(), ['c', 'a', 'd'])
      hote._shadow.querySelector('.b2').click()
      await attendre(() => !!hote._shadow.querySelector('.sinon'))
      assertAbsent(hote._shadow.querySelector('.si'))
      hote._shadow.querySelector('.b2').click()
      await attendre(() => !!hote._shadow.querySelector('.si'))
      assertAbsent(hote._shadow.querySelector('.sinon'))
      const cle = hote._shadow.querySelector('.cle')
      hote._shadow.querySelector('.b3').click()
      await attendre(() => hote._shadow.querySelector('.cle')?.textContent === '2')
      assert.ok(hote._shadow.querySelector('.cle') !== cle, 'une clé neuve refait le bloc')
      await pause(50)
      assert.deepEqual([...window.eval('globalThis.__erreurs')], [])
    }
    finally {
      await window.happyDOM.close()
    }
  })
})
