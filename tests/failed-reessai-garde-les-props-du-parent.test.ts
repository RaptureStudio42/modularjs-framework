// `reset()` d'un `<@failed>` remplace le composant tombé par une instance neuve (son état repart de zéro). Cette
// instance ne recevait que les ATTRIBUTS de l'ancienne : une prop posée par le parent en propriété (objet, tableau)
// était perdue, et le parent gardait sa référence vers l'ancienne balise, détachée — toutes ses mises à jour
// partaient vers elle. Après « réessayer », l'enfant affichait son état par défaut et ne suivait plus jamais son
// parent. Désormais le parent désigne la nouvelle balise, lui repose ses props avant son premier rendu, et garde
// ses écouteurs posés sur la balise (`@ping` ici).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const ENFANT = [
  '<script>',
  '$items = []',
  '$boom = false',
  "ping := -> µemit 'ping'",
  '</script>',
  '{if $boom}<i>{$items.nope.crash}</i>{end}',
  '<p class="len">{$items.length}</p>',
  '<button class="boom" @click={$boom = true}>boom</button>',
  '<button class="ping" @click={ping}>ping</button>',
  '<@failed err reset>',
  '  <button class="reset" @click={reset()}>reset</button>',
  '</@failed>',
].join('\n')

const PARENT = [
  '<script>',
  '$list = [1, 2, 3]',
  '$pings = 0',
  '</script>',
  '<mjs-tst-frp-enfant items={$list} @ping={$pings++}></mjs-tst-frp-enfant>',
  '<p class="pings">{$pings}</p>',
  '<button class="add" @click={$list = [...$list, 4]}>add</button>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('failed-reessai-props')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'tst-frp-enfant.mjs'), ENFANT)
  writeFileSync(join(srcDir, 'tst-frp-parent.mjs'), PARENT)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('<@failed> — réessayer garde les props du parent et le lien avec lui', function () {
  this.timeout(60000)

  let app: any

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
    app.window.console.error = () => {}
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('après reset : la prop du parent est là, l\'enfant suit le parent et lui parle encore', async () => {
    const p = await app.mount('tst-frp-parent')
    await pause(30)
    const avant = p.find('mjs-tst-frp-enfant')
    assert.equal(avant._shadow.querySelector('.len').textContent, '3')

    avant._shadow.querySelector('.boom').click()
    await pause(30)
    const bouton = avant._shadow.querySelector('.reset')
    assert.equal(bouton !== null, true, 'le repli <@failed> est affiché')
    bouton.click()
    await pause(30)

    const apres = p.find('mjs-tst-frp-enfant')
    assert.equal(apres !== avant, true, 'une instance neuve a pris la place')
    assert.equal(apres._mjs_has_crashed === true, false)
    assertAbsent(apres._shadow.querySelector('i'), 'l\'état de l\'enfant est reparti de zéro ($boom faux)')
    assert.equal(apres._shadow.querySelector('.len').textContent, '3', 'la prop posée par le parent est gardée')

    await p.click('.add')
    await pause(30)
    assert.equal(apres._shadow.querySelector('.len').textContent, '4', 'l\'enfant suit de nouveau son parent')
    assert.equal(p.el._mjs_nodes && Object.values(p.el._mjs_nodes).includes(avant), false, 'le parent ne retient plus l\'ancienne balise')

    apres._shadow.querySelector('.ping').click()
    await pause(30)
    assert.equal(p.text('.pings'), '1', 'l\'écouteur @ping du parent reçoit l\'événement de la nouvelle instance')
    p.destroy()
  })
})
