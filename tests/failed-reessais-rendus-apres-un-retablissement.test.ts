// `<@failed retry="N">` compte les réessais sur un attribut (`mjs-retry-used`) que l'instance neuve hérite de
// l'ancienne. Ce compte ne repartait jamais de zéro : un composant rétabli par `reset`, qui plantait de nouveau
// plus tard (des heures après, sur une autre action), trouvait `reset` sans effet. Le compte repart désormais de zéro
// quand `reset` est voulu par l'utilisateur (appelé pendant la distribution d'un clic de confiance sur « réessayer ») et
// que l'instance neuve vit ensuite deux secondes sans replanter. Un `reset` hors geste (relancé par le code, ou par un
// clic qui ne vient pas de l'utilisateur, quelle que soit `navigator.userActivation`) compte toujours, et une instance
// qui replante avant les deux secondes continue de compter : la limite arrête toujours une erreur qui revient à chaque
// essai.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SOURCES: Record<string, string> = {
  'tst-frr-enfant.mjs': [
    '<script>',
    '$boom = false',
    '$x = null',
    '</script>',
    '{if $boom}<i>{$x.crash}</i>{end}',
    '<p class="ok">ok</p>',
    '<button class="boom" @click={$boom = true}>boom</button>',
    '<@failed err reset>',
    '  <button class="reset" @click={reset()}>reset</button>',
    '</@failed>',
  ].join('\n'),
  'tst-frr-toujours.mjs': [
    '<script>',
    '$x = null',
    '</script>',
    '<p>{$x.crash}</p>',
    '<@failed err reset>',
    '  <button class="reset" @click={reset()}>reset</button>',
    '</@failed>',
  ].join('\n'),
  'tst-frr-parent.mjs': '<mjs-tst-frr-enfant></mjs-tst-frr-enfant>\n<mjs-tst-frr-toujours></mjs-tst-frr-toujours>\n',
}

function projet(): string {
  const root   = mjsTmp('failed-reessais-retablissement')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('<@failed> — les réessais repartent de zéro après un rétablissement', function () {
  this.timeout(60000)
  let app: any
  const journal: string[] = []

  before(async () => {
    app = await createHarness({ root: projet() })
    app.window.console.error = (...a: any[]) => journal.push(a.map((x) => String(x && x.message !== undefined ? x.message : x)).join(' '))
  })

  after(async () => { if (app) await app.destroy() })

  // activation du navigateur (`navigator.userActivation`) : absente, vraie ou fausse, elle ne fait pas un geste
  const geste = (actif: boolean | null) => {
    if (actif === null) delete app.window.navigator.userActivation
    else Object.defineProperty(app.window.navigator, 'userActivation', { configurable: true, value: { isActive: actif } })
  }
  // clic de l'utilisateur : un événement de confiance, distribué par le navigateur
  const cliquer = (bouton: any) => {
    const ev = new app.window.MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
    Object.defineProperty(ev, 'isTrusted', { value: true })
    bouton.dispatchEvent(ev)
  }

  it('rétabli par un clic sur reset puis replanté plus tard : reset remonte de nouveau le composant', async () => {
    journal.length = 0
    const p  = await app.mount('tst-frr-parent')
    await pause(30)
    const e1 = p.find('mjs-tst-frr-enfant')
    e1._shadow.querySelector('.boom').click()
    await pause(30)
    cliquer(e1._shadow.querySelector('.reset'))
    await pause(30)
    const e2 = p.find('mjs-tst-frr-enfant')
    assert.equal(e2 !== e1, true, 'premier reset : une instance neuve')
    assert.equal(e2._shadow.querySelector('.ok')?.textContent, 'ok', 'elle s\'affiche')
    assert.equal(e2.getAttribute('mjs-retry-used'), '1', 'tout juste rétablie : le compte est gardé')
    await pause(2100)
    assert.equal(e2.getAttribute('mjs-retry-used'), null, 'deux secondes sans replanter : le compte est effacé')

    e2._shadow.querySelector('.boom').click()
    await pause(30)
    const bouton = e2._shadow.querySelector('.reset')
    assert.equal(bouton !== null, true, 'le repli est affiché')
    cliquer(bouton)
    await pause(30)
    const e3 = p.find('mjs-tst-frr-enfant')
    assert.equal(e3 !== e2, true, 'second reset : encore une instance neuve')
    assert.equal(e3._shadow.querySelector('.ok')?.textContent, 'ok')
    assert.equal(journal.some((l) => l.includes('limite de réessai')), false, 'aucun abandon annoncé')
    p.destroy()
    geste(null)
  })

  it('reset hors geste (clic qui ne vient pas de l\'utilisateur, activation absente ou fausse) : le compte n\'est jamais effacé, la limite tient', async () => {
    for (const sansApi of [true, false]) {
      journal.length = 0
      geste(sansApi ? null : false)
      const p  = await app.mount('tst-frr-parent')
      await pause(30)
      const e1 = p.find('mjs-tst-frr-enfant')
      e1._shadow.querySelector('.boom').click()
      await pause(30)
      e1._shadow.querySelector('.reset').click()
      await pause(30)
      const e2 = p.find('mjs-tst-frr-enfant')
      assert.equal(e2 !== e1, true, 'reset : une instance neuve')
      await pause(2100)
      assert.equal(e2.getAttribute('mjs-retry-used'), '1', 'deux secondes après un reset hors geste : le compte est gardé')
      e2._shadow.querySelector('.boom').click()
      await pause(30)
      e2._shadow.querySelector('.reset').click()
      await pause(30)
      assert.equal(p.find('mjs-tst-frr-enfant') === e2, true, 'limite atteinte : plus aucune construction')
      assert.equal(journal.some((l) => l.includes('limite de réessai')), true, 'l\'abandon est annoncé')
      p.destroy()
    }
    geste(null)
  })

  it('replanté pendant son premier rendu : le compte continue, la limite tient', async () => {
    journal.length = 0
    const p  = await app.mount('tst-frr-parent')
    await pause(30)
    const t1 = p.find('mjs-tst-frr-toujours')
    t1._shadow.querySelector('.reset').click()
    await pause(30)
    const t2 = p.find('mjs-tst-frr-toujours')
    assert.equal(t2 !== t1, true, 'premier reset : une instance neuve, qui replante aussitôt')
    assert.equal(t2.getAttribute('mjs-retry-used'), '1', 'le compte est gardé')
    t2._shadow.querySelector('.reset').click()
    await pause(30)
    assert.equal(p.find('mjs-tst-frr-toujours') === t2, true, 'limite atteinte : plus aucune construction')
    assert.equal(journal.some((l) => l.includes('limite de réessai')), true, 'l\'abandon est annoncé')
    p.destroy()
  })
})
