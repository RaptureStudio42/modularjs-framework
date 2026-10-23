// Tire la table de référence du comportement (courbes + ressort) depuis les fichiers runtime
// courants et l'écrit dans tests/fixtures/easing-spring-table.json
//   npx tsx tests/helpers/easing-spring-generer-table.ts

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tableCourbes, tableRessort } from './easing-spring-scenarios.js'

const DOSSIER = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
mkdirSync(DOSSIER, { recursive: true })
writeFileSync(join(DOSSIER, 'easing-spring-table.json'), JSON.stringify({ courbes: tableCourbes(), ressort: tableRessort() }) + '\n')
console.log('table écrite')
