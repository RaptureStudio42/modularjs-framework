// {await charger()} : l'expression d'un bloc {await} n'est relue qu'au premier rendu du bloc et quand une variable
// qu'elle cite change. Relue à chaque rendu, un appel de fonction rendait une promesse neuve à chaque passe, et la
// résolution, qui rend, en relançait une autre : 10 000 appels en rafale quand la promesse se résout tout de suite
// (la garde anti-boucle coupait, la vue restait sur l'attente), et une requête sans fin, au rythme du réseau, quand
// elle se résout plus tard. Ici : un seul appel, la branche {success} affichée, aucun rappel quand une variable que
// l'expression ne cite pas change ; un nouvel appel quand une variable qu'elle cite change.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// promesse résolue tout de suite (microtâche)
const APPEL = [
  '<script>',
  '$montre = true',
  'charger = ->',
  '  window.__appels = (window.__appels or 0) + 1',
  '  Promise.resolve(window.__appels)',
  '</script>',
  '{if $montre}<b class="b">b</b>{end}',
  '<div class="w">{await charger()}<i class="att">attente</i>{success d}<p class="ok">{d}</p>{end}</div>',
  '<button class="bascule" @click={$montre = not $montre}>bascule</button>',
].join('\n')

// promesse résolue plus tard (tâche), comme une réponse du réseau
const RESEAU = [
  '<script>',
  'charger = ->',
  '  window.__appelsR = (window.__appelsR or 0) + 1',
  '  new Promise (r) -> setTimeout((-> r(window.__appelsR)), 5)',
  '</script>',
  '<div class="w">{await charger()}<i class="att">attente</i>{success d}<p class="ok">{d}</p>{end}</div>',
].join('\n')

// l'expression cite `$id` : elle est relue quand `$id` change
const VARIABLE = [
  '<script>',
  '$id = 1',
  'charger = (id) ->',
  '  window.__appelsV = (window.__appelsV or 0) + 1',
  "  Promise.resolve('fiche ' + id)",
  '</script>',
  '<div class="w">{await charger($id)}<i class="att">attente</i>{success d}<p class="ok">{d}</p>{end}</div>',
  '<button class="suivant" @click={$id++}>suivant</button>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('await-appel-relu')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'tst-awr-appel.mjs'), APPEL)
  writeFileSync(join(srcDir, 'tst-awr-reseau.mjs'), RESEAU)
  writeFileSync(join(srcDir, 'tst-awr-variable.mjs'), VARIABLE)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('{await} — l\'expression n\'est relue qu\'au premier rendu et quand une variable qu\'elle cite change', function () {
  this.timeout(60000)

  let app: any
  let avertissements: string[] = []

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
    app.window.console.warn = (...a: any[]) => { avertissements.push(a.map((x) => String(x && x.message ? x.message : x)).join(' ')) }
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('{await charger()} résolu tout de suite : un seul appel, la branche {success} affichée', async () => {
    app.window.__appels = 0
    avertissements = []
    const c = await app.mount('tst-awr-appel')
    await pause(300)
    assert.equal(app.window.__appels, 1, 'charger() appelé une seule fois')
    assert.equal(c.text('.ok'), '1', 'branche {success} affichée avec la valeur du premier appel')
    assertAbsent(c.find('.att'), 'plus d\'attente affichée')
    assert.deepEqual(avertissements.filter((m) => /Boucle/.test(m)), [], 'aucune boucle réactive')
    c.destroy()
  })

  it('une variable que l\'expression ne cite pas change : charger() n\'est pas rappelé', async () => {
    app.window.__appels = 0
    const c = await app.mount('tst-awr-appel')
    await pause(50)
    assert.equal(app.window.__appels, 1)
    await c.click('.bascule')
    await c.click('.bascule')
    await pause(50)
    assert.equal(c.find('.b') !== null, true, 'le {if} voisin a bien été rejoué')
    assert.equal(app.window.__appels, 1, 'toujours un seul appel')
    assert.equal(c.text('.ok'), '1')
    c.destroy()
  })

  it('{await charger()} résolu plus tard (réseau) : un seul appel, pas de requête sans fin', async () => {
    app.window.__appelsR = 0
    const c = await app.mount('tst-awr-reseau')
    await pause(300)
    assert.equal(app.window.__appelsR, 1, 'charger() appelé une seule fois en 300 ms')
    assert.equal(c.text('.ok'), '1', 'branche {success} affichée')
    c.destroy()
  })

  it('{await charger($id)} : relue quand $id change, avec la nouvelle valeur', async () => {
    app.window.__appelsV = 0
    const c = await app.mount('tst-awr-variable')
    await pause(50)
    assert.equal(app.window.__appelsV, 1)
    assert.equal(c.text('.ok'), 'fiche 1')
    await c.click('.suivant')
    await pause(50)
    assert.equal(app.window.__appelsV, 2, 'un nouvel appel quand $id change')
    assert.equal(c.text('.ok'), 'fiche 2', 'la branche {success} montre le résultat du nouvel appel')
    await pause(100)
    assert.equal(app.window.__appelsV, 2, 'et pas d\'autre appel ensuite')
    c.destroy()
  })
})
