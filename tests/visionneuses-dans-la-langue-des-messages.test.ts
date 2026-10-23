// Les deux visionneuses servies par `mjs dev` et `mjs serve` (journal d'erreurs, atelier des variables de thème) étaient écrites en
// français en dur, quelle que soit la langue des messages du framework. Leurs textes viennent désormais du catalogue (français et
// anglais) : la page suit la langue des messages, et le cache de la page compilée la suit aussi.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getViewerScript, JOURNAL_VIEWER, THEME_VIEWER } from '../src/server/viewer-page.js'
import { setMessagesLang, getMessagesLang } from '../src/messages/index.js'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

describe('visionneuses — textes dans la langue des messages', function () {
  this.timeout(60000)
  let langue: 'fr' | 'en'
  let manifeste: string
  before(() => {
    langue = getMessagesLang()
    const out = join(mjsTmp('visionneuses-langue'), 'out')
    mkdirSync(out, { recursive: true })
    manifeste = join(out, 'manifest.js')
    writeFileSync(manifeste, "const µCore = '/mjs_core-test1234.js';\nµ.paths = {};\n")
  })
  after(() => { setMessagesLang(langue); sweepRegistered() })

  it('anglais : aucun texte français, aucun repère de traduction restant', async () => {
    setMessagesLang('en')
    const journal = await getViewerScript(manifeste, JOURNAL_VIEWER)
    const theme   = await getViewerScript(manifeste, THEME_VIEWER)
    for (const texte of ['Error log', 'Refresh', 'Purge all', 'No errors']) assert.ok(journal.includes(texte), texte)
    for (const texte of ['Theme variables', 'Save to the source', 'read-only', 'Read by']) assert.ok(theme.includes(texte), texte)
    for (const francais of ["Journal d'erreurs", 'Rafraîchir', 'Purger', 'Variables de thème', 'Enregistrer dans le source', 'lecture seule', 'Lu par', 'feuille partagée', 'déclaration introuvable']) {
      assert.ok(!journal.includes(francais) && !theme.includes(francais), francais)
    }
    assert.ok(!/⟪|viewer\.(journal|theme)\./.test(journal + theme))
  })

  it('français : les textes d\'origine, compilés à nouveau au changement de langue', async () => {
    setMessagesLang('fr')
    const journal = await getViewerScript(manifeste, JOURNAL_VIEWER)
    const theme   = await getViewerScript(manifeste, THEME_VIEWER)
    for (const texte of ["Journal d'erreurs", 'Rafraîchir', 'Purger tout']) assert.ok(journal.includes(texte), texte)
    for (const texte of ['Variables de thème', 'Enregistrer dans le source', 'lecture seule', 'Lu par']) assert.ok(theme.includes(texte), texte)
    assert.ok(!/⟪|viewer\.(journal|theme)\./.test(journal + theme))
  })
})
