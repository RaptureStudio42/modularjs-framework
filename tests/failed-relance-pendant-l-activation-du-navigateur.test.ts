// `<@failed>` : seul un `reset` appelé PENDANT la distribution d'un événement de l'utilisateur (un clic de confiance sur
// « réessayer ») est un rétablissement voulu, qui fait repartir le compte de réessais de zéro. L'activation du navigateur
// (`navigator.userActivation.isActive`) n'en dit rien : elle reste vraie quelques secondes après N'IMPORTE QUEL clic dans
// la page. Lue au moment de `reset`, elle faisait passer pour un geste la relance automatique d'un repli
// (`setTimeout(reset, 10)`) dès que l'utilisateur cliquait ailleurs : le composant qui replante 2,3 s après chaque montage
// était reconstruit sans fin. Le clic de confiance sur « réessayer », lui, rétablit toujours, même sans cette API.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const enfant = (reset: string) => [
  '<script>',
  '$boom = false',
  '$x = null',
  '</script>',
  '{if $boom}<i>{$x.crash}</i>{end}',
  '<p class="ok">ok</p>',
  '<button class="boom" @click={$boom = true}>boom</button>',
  '<@failed err reset>',
  `  <button class="reset" ${reset}>reset</button>`,
  '</@failed>',
].join('\n')

const SOURCES: Record<string, string> = {
  'tst-fra-lente.mjs': [
    '<script>',
    'window.__fra = (window.__fra or 0) + 1',
    '$boom = false',
    '$x = null',
    'setTimeout((=> $boom = true), 2300)',
    'µfailed (err, reset)->',
    '  setTimeout(reset, 10)',
    '  \'<p class="fb">oups</p>\'',
    '</script>',
    '{if $boom}<i>{$x.crash}</i>{end}',
    '<p class="ok">ok</p>',
  ].join('\n'),
  'tst-fra-appel.mjs': enfant('@click={reset()}'),
  'tst-fra-ecouteur.mjs': enfant('@click=reset'),
  'tst-fra-differe.mjs': enfant('@click={setTimeout(reset, 0)}'),
  'tst-fra-parent.mjs': '<mjs-tst-fra-appel></mjs-tst-fra-appel>\n<mjs-tst-fra-ecouteur></mjs-tst-fra-ecouteur>\n<mjs-tst-fra-differe></mjs-tst-fra-differe>\n',
}

describe('<@failed> — un reset n\'est voulu que pendant un clic de l\'utilisateur, jamais par l\'activation du navigateur', function () {
  this.timeout(60000)
  let app: any
  const journal: string[] = []

  before(async () => {
    const root = mjsTmp('failed-relance-activation')
    mkdirSync(join(root, 'src'), { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(root, 'src', f), s)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
    app = await createHarness({ root })
    app.window.console.error = (...a: any[]) => journal.push(a.map((x) => String(x && x.message !== undefined ? x.message : x)).join(' '))
  })

  after(async () => {
    delete app?.window.navigator.userActivation
    if (app) await app.destroy()
  })

  // activation du navigateur : vraie quelques secondes après n'importe quel clic dans la page
  const activation = (actif: boolean | null) => {
    if (actif === null) delete app.window.navigator.userActivation
    else Object.defineProperty(app.window.navigator, 'userActivation', { configurable: true, value: { isActive: actif } })
  }
  // clic de l'utilisateur : un événement de confiance, distribué par le navigateur
  const cliquer = (cible: any) => {
    const ev = new app.window.MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
    Object.defineProperty(ev, 'isTrusted', { value: true })
    cible.dispatchEvent(ev)
  }

  it('clics ailleurs dans la page, activation toujours vraie : la relance automatique s\'arrête à la limite', async () => {
    const neutre = app.window.document.createElement('button')
    app.window.document.body.appendChild(neutre)
    activation(true)
    app.window.__fra = 0
    const c = await app.mount('tst-fra-lente')
    const minuterie = setInterval(() => cliquer(neutre), 1000)
    try {
      await pause(7600)
    }
    finally {
      clearInterval(minuterie)
    }
    assert.equal(app.window.__fra <= 2, true, 'constructions en 7,6 s : ' + app.window.__fra)
    c.destroy()
    neutre.remove()
    activation(null)
  })

  for (const [tag, forme] of [['tst-fra-appel', '@click={reset()}'], ['tst-fra-ecouteur', '@click=reset']]) {
    it(`clic de confiance sur « réessayer » (${forme}), sans l'API d'activation : rétabli, le compte repart de zéro`, async () => {
      journal.length = 0
      activation(null)
      const p  = await app.mount('tst-fra-parent')
      await pause(30)
      const e1 = p.find(`mjs-${tag}`)
      e1._shadow.querySelector('.boom').click()
      await pause(30)
      cliquer(e1._shadow.querySelector('.reset'))
      await pause(30)
      const e2 = p.find(`mjs-${tag}`)
      assert.equal(e2 !== e1, true, 'premier reset : une instance neuve')
      assert.equal(e2.getAttribute('mjs-retry-used'), '1', 'tout juste rétablie : le compte est gardé')
      await pause(2100)
      assert.equal(e2.getAttribute('mjs-retry-used'), null, 'deux secondes sans replanter : le compte est effacé')
      e2._shadow.querySelector('.boom').click()
      await pause(30)
      cliquer(e2._shadow.querySelector('.reset'))
      await pause(30)
      const e3 = p.find(`mjs-${tag}`)
      assert.equal(e3 !== e2, true, 'plus tard, nouveau plantage : reset remonte encore le composant')
      assert.equal(e3._shadow.querySelector('.ok')?.textContent, 'ok')
      assert.equal(journal.some((l) => l.includes('limite de réessai')), false, 'aucun abandon annoncé')
      p.destroy()
    })
  }

  it('reset différé après le clic (minuterie), activation encore vraie : le compte est gardé, la limite tient', async () => {
    journal.length = 0
    activation(true)
    const p  = await app.mount('tst-fra-parent')
    await pause(30)
    const e1 = p.find('mjs-tst-fra-differe')
    e1._shadow.querySelector('.boom').click()
    await pause(30)
    cliquer(e1._shadow.querySelector('.reset'))
    await pause(30)
    const e2 = p.find('mjs-tst-fra-differe')
    assert.equal(e2 !== e1, true, 'reset : une instance neuve')
    await pause(2100)
    assert.equal(e2.getAttribute('mjs-retry-used'), '1', 'relancé hors du clic : le compte est gardé')
    e2._shadow.querySelector('.boom').click()
    await pause(30)
    cliquer(e2._shadow.querySelector('.reset'))
    await pause(30)
    assert.equal(p.find('mjs-tst-fra-differe') === e2, true, 'limite atteinte : plus aucune construction')
    assert.equal(journal.some((l) => l.includes('limite de réessai')), true, 'l\'abandon est annoncé')
    p.destroy()
    activation(null)
  })
})
