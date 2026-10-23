// Rendu d'une grande page et panneau d'erreur. Défauts garantis absents :
// - la garde anti-boucle comptait les rendus de TOUS les composants d'une même rafale de microtâches :
//   une page qui monte plus de 10 000 composants d'un coup (grille de cellules) déclenchait un faux
//   « Boucle réactive détectée » et laissait les composants suivants vides, jamais rendus ;
// - `throw undefined` (ou `null`) dans un rendu faisait planter le panneau d'erreur lui-même
//   (lecture de `.message`) : ombre vide, pas de panneau, exception non rattrapée.
// La vraie boucle (un composant qui se re-rend sans fin) reste arrêtée : tests/loop-guard.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CELLULE = [
  '<script>',
  '  $n = 0',
  '</script>',
  '<b>{$n}</b>',
].join('\n')

const GRILLE = [
  '<script>',
  '  $rows = []',
  '</script>',
  '<div class="g">{for r in $rows}<mjs-gp-cellule n={r}></mjs-gp-cellule>{end}</div>',
].join('\n')

const JETTE = [
  '<script>',
  '  $x = 0',
  '  $quoi = undefined',
  '  f = ->',
  '    throw $quoi',
  '</script>',
  '{if $x}<i>{f()}</i>{end}',
  '<button class="go" @click={$x = 1}>go</button>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('grande-page')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'gp-cellule.mjs'), CELLULE)
  writeFileSync(join(srcDir, 'gp-grille.mjs'), GRILLE)
  writeFileSync(join(srcDir, 'gp-jette.mjs'), JETTE)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('rendu — 10 200 composants montés d\'un coup, erreur jetée sans message', function () {
  this.timeout(180000)

  let app: any
  let avis: string[]
  let erreurs: string[]

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
    avis    = []
    erreurs = []
    app.µ.warn = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
    app.µ.error = (...a: any[]) => { erreurs.push(a.map(String).join(' ')) }
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('10 200 cellules : toutes rendues, aucune fausse « boucle réactive »', async () => {
    const g = await app.mount('gp-grille')
    try {
      avis.length = 0
      g.el._set('rows', Array.from({ length: 10200 }, (_: any, i: number) => i))
      const fin = Date.now() + 60000
      const cellules = () => [...g.shadow.querySelectorAll('mjs-gp-cellule')]
      const rendue = (c: any) => c._shadow && c._shadow.querySelector('b') && c._shadow.querySelector('b').textContent === String(c._state.n)
      while (Date.now() < fin && !(cellules().length === 10200 && rendue(cellules()[10199]))) await pause(50)
      await pause(50)
      const cs = cellules()
      assert.equal(cs.length, 10200, 'les 10 200 cellules sont dans la page')
      assert.equal(cs.filter(rendue).length, 10200, 'chaque cellule affiche son numéro')
      assert.deepEqual(avis.filter((a) => /10 000/.test(a)), [], 'aucun avertissement de boucle')
    } finally {
      g.destroy()
    }
  })

  it('`throw undefined` dans un rendu : panneau « Fatal Error: undefined », aucune exception secondaire', async () => {
    const c = await app.mount('gp-jette')
    try {
      erreurs.length = 0
      await c.click('.go')
      await pause(30)
      const panneau = c.find('.mjs-fatal-error')
      assert.ok(panneau, 'le panneau d\'erreur est affiché')
      assert.equal(panneau.textContent, 'Fatal Error: undefined')
      assert.ok(!erreurs.some((e) => /reading 'message'/.test(e)), 'pas de seconde exception : ' + erreurs.join(' | '))
    } finally {
      c.destroy()
    }
  })

  it('`throw null` : panneau « Fatal Error: null »', async () => {
    const c = await app.mount('gp-jette')
    try {
      c.el._set('quoi', null)
      await c.click('.go')
      await pause(30)
      const panneau = c.find('.mjs-fatal-error')
      assert.ok(panneau, 'le panneau d\'erreur est affiché')
      assert.equal(panneau.textContent, 'Fatal Error: null')
    } finally {
      c.destroy()
    }
  })
})
