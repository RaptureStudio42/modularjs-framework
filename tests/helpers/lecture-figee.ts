// les lectures du gabarit figées : pour chaque gabarit qu'un test lit (son empreinte sha1, avec ses réglages), l'empreinte de
// sa lecture (arbre de Node, références, erreur, messages de console), relevée quand deux lectures du gabarit, comparées côte à
// côte, la rendaient identique. Un changement voulu de la lecture se refige : MJS_FIGER_LECTURES=1 réécrit l'empreinte de
// chaque gabarit lu (tests/fixtures/lecture-du-gabarit-figee.json)

import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const FICHIER   = new URL('../fixtures/lecture-du-gabarit-figee.json', import.meta.url)
const figees    = JSON.parse(readFileSync(FICHIER, 'utf8')) as Record<string, string>
const empreinte = (x: unknown): string => createHash('sha1').update(JSON.stringify(x)).digest('hex')

// la lecture `lu` du gabarit `cle` (le gabarit, avec ses réglages s'il en a) est celle qui est figée pour lui
export function commeFigee(cle: unknown, lu: unknown): void {
  const k = empreinte(cle)
  if (process.env.MJS_FIGER_LECTURES === '1') {
    figees[k] = empreinte(lu)
    writeFileSync(FICHIER, JSON.stringify(figees, null, 2) + '\n')
    return
  }
  assert.ok(figees[k] !== undefined, `aucune lecture figée pour ${JSON.stringify(cle).slice(0, 160)}`)
  assert.equal(empreinte(lu), figees[k], `la lecture n'est plus celle qui est figée : ${JSON.stringify(cle).slice(0, 160)}`)
}
