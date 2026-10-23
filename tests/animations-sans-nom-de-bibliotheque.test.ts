// les animations du runtime (src/runtime/animations/, sous-dossiers compris) ne citent aucune bibliothèque d'origine : un commentaire dit ce que fait le code,
// pas d'où l'idée vient

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'runtime', 'animations')
// le nom est écrit en deux morceaux : ce fichier ne le cite pas non plus
const NOM = new RegExp('sve' + 'lte', 'i')

describe('animations du runtime : aucune bibliothèque nommée', function () {
  for (const fichier of (readdirSync(DIR, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).sort()) {
    it(`${fichier} ne cite aucune bibliothèque`, () => {
      const citations = readFileSync(join(DIR, fichier), 'utf-8').split('\n').map((l, i) => NOM.test(l) ? `${fichier}:${i + 1} ${l.trim()}` : '').filter(Boolean)
      assert.deepEqual(citations, [], 'ces lignes nomment une bibliothèque : dire ce que fait le code, sans nom')
    })
  }
})
