// Un {await} dont l'expression lit un contexte (`§§cfg.lang`) ou un état partagé (`µ.state`) est relu quand celui-ci
// change. Défaut garanti absent : depuis que l'expression n'est relue que quand une variable qu'elle cite change, ces
// lectures n'en faisaient pas partie — `{await charger(§§cfg.lang)}` gardait le texte de l'ancienne langue (le
// `{§§cfg.lang}` voisin montrait la nouvelle), `{await partage.req}` gardait l'ancienne promesse. Garde : un seul
// nouvel appel par changement, aucune relance ensuite (la résolution ne relit pas l'expression).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SOURCES: Record<string, string> = {
  'tst-awc-fournit.mjs': "<script>\n§§cfg = {lang: 'fr'}\nbascule = -> §§cfg.lang = 'en'\n</script>\n<button class=\"ch\" @click={bascule()}>c</button><@slot/>\n",
  'tst-awc-lit.mjs': "<script>\ncharger = (l) ->\n  window.__appels.push(l)\n  Promise.resolve('texte-' + l)\n</script>\n<div class=\"w\">{await charger(§§cfg.lang)}<i>attente</i>{success u}<b class=\"ok\">{u}</b>{end}</div><p class=\"l\">{§§cfg.lang}</p>\n",
  'tst-awc-etat.mjs': "<script>\nwindow.__partageAw ||= µ.state({req: Promise.resolve('e1')})\nwindow.__changeReq = (v) -> window.__partageAw.req = Promise.resolve(v)\npartage = window.__partageAw\n</script>\n<p>{await partage.req}<i>attente</i>{success v}<b class=\"ok\">{v}</b>{end}</p>\n",
}

function projetTemporaire(): string {
  const root   = mjsTmp('await-contexte-etat')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('{await} relu quand un contexte ou un état partagé qu\'il lit change', function () {
  this.timeout(60000)
  let app: any

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('`{await charger(§§cfg.lang)}` : la nouvelle langue est chargée, une seule fois', async () => {
    const d = app.window.document
    app.window.__appels = []
    d.body.innerHTML = '<mjs-tst-awc-fournit><mjs-tst-awc-lit></mjs-tst-awc-lit></mjs-tst-awc-fournit>'
    await pause(150)
    const lit = d.querySelector('mjs-tst-awc-lit')
    assert.equal(lit._shadow.querySelector('.ok')?.textContent, 'texte-fr')
    d.querySelector('mjs-tst-awc-fournit')._shadow.querySelector('.ch').click()
    await pause(150)
    assert.equal(lit._shadow.querySelector('.l')?.textContent, 'en', 'le texte voisin suit le contexte')
    assert.equal(lit._shadow.querySelector('.ok')?.textContent, 'texte-en', 'le bloc {await} est relu avec la nouvelle langue')
    await pause(100)
    assert.deepEqual(app.window.__appels, ['fr', 'en'], 'un appel par langue, aucune relance ensuite')
    d.body.innerHTML = ''
  })

  it('`{await partage.req}` (µ.state) : la nouvelle promesse est attendue', async () => {
    const d = app.window.document
    d.body.innerHTML = '<mjs-tst-awc-etat></mjs-tst-awc-etat>'
    await pause(150)
    const c = d.querySelector('mjs-tst-awc-etat')
    assert.equal(c._shadow.querySelector('.ok')?.textContent, 'e1')
    app.window.__changeReq('e2')
    await pause(150)
    assert.equal(c._shadow.querySelector('.ok')?.textContent, 'e2')
    d.body.innerHTML = ''
  })
})
