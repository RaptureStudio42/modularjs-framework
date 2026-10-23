// Un fichier enregistré en UTF-8 avec une marque d'ordre des octets (BOM) en tête se compile comme le même
// fichier sans elle : avant, la directive de la première ligne (`@i18n 'sec'`) était ignorée en silence,
// les clés de traduction n'étaient pas préfixées et les textes traduits manquaient à l'écran.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

describe('marque BOM en tête d\'un composant', () => {
  it('la directive de la première ligne est lue, la sortie est celle du fichier sans BOM', async () => {
    const src = "@i18n 'sec'\n<p>{µt('titre')}</p>"
    const sans = await transpile(src, { moduleName: 'bom' })
    const avec = await transpile('﻿' + src, { moduleName: 'bom' })
    assert.match(sans.output, /sec\.titre/)
    assert.equal(avec.output, sans.output)
  })

  it('BOM et fins de ligne CRLF ensemble : même sortie', async () => {
    const src = "@i18n 'sec'\n<p>{µt('titre')}</p>\n<script>\n$n = 1\n</script>"
    const sans = await transpile(src, { moduleName: 'bom-crlf' })
    const avec = await transpile('﻿' + src.replace(/\n/g, '\r\n'), { moduleName: 'bom-crlf' })
    assert.equal(avec.output, sans.output)
  })
})
