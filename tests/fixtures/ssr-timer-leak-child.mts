// Fixture PROCESS ENFANT — appelée par tests/ssr-timer-leak.test.ts via
// `spawn(process.execPath, ['--import', 'tsx', ...])`, JAMAIS chargée par Mocha elle-même
// (extension .mts, hors du glob `--extension ts` — même patron que journal-sigterm-child.mts).
// Rend un composant dont le `<script module>` pose une minuterie brute (`setInterval`, permis hors du script d'un
// composant : c'est elle que le test surveille) et dont le `µeffect` pose `µevery` (au rendu serveur, elle ne part
// jamais), ferme le
// renderer, puis n'appelle JAMAIS `process.exit()` : si une minuterie fuit réellement (VRAI timer Node, cf.
// renderToString.ts finally), ce process ne se termine JAMAIS tout seul — c'est le PARENT (le
// test) qui doit alors le tuer après un délai de sécurité. Sortie naturelle (code 0, aucun
// signal) = pas de fuite.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSSRRenderer } from '../../src/server/renderToString.js'
import { terminateSharedWorkerPool } from '../../src/bundler/index.js'

const srcDir = process.argv[2]
mkdirSync(srcDir, { recursive: true })
writeFileSync(join(srcDir, 'ticker.mjs'), `
<script module>
setInterval((-> null), 5)
</script>
<script lang="coffee">
µeffect ->
  µevery 5, -> null
</script>
<p>ticker</p>
`)
const renderer = await createSSRRenderer({ sourceDir: srcDir })
await renderer.renderToString('mjs-ticker', { settleMs: 100 })
await renderer.close()
await terminateSharedWorkerPool()
console.log('MJS_LOT3_S21_DONE')
// pas de process.exit() ici, volontairement : c'est tout le point du test
