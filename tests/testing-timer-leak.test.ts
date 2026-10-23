// testing/index (harnais applicatif) — même motif que renderToString.ts, sur l'AUTRE
// point touché. `createHarness().destroy()` fermait sa Window happy-dom via
// `window.close()` (API DOM standard, no-op sur une Window créée nue) — le vrai nettoyage vit sous
// `window.happyDOM.close()`. Méthode : process enfant qui ne s'auto-termine jamais lui-même (cf.
// tests/ssr-timer-leak.test.ts pour la justification détaillée de cette méthode plutôt que
// `process._getActiveHandles()`/monkey-patch).

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(__dirname, 'fixtures/testing-timer-leak-child.mts')

function lancerFixture(srcDir: string, outDir: string): Promise<{ code: number | null, signal: NodeJS.Signals | null, killedBySecurite: boolean }> {
  return new Promise((resolve, reject) => {
    const enfant = spawn(process.execPath, ['--import', 'tsx', FIXTURE, srcDir, outDir], { cwd: join(__dirname, '..'), stdio: 'ignore' })
    let killedBySecurite = false
    const securite = setTimeout(() => { killedBySecurite = true; enfant.kill('SIGKILL') }, 30000) //marge large : machine chargée, spawn+tsx+happy-dom peuvent déborder 6s sans fuite réelle
    enfant.on('error', (e) => { clearTimeout(securite); reject(e) })
    enfant.on('exit', (code, signal) => { clearTimeout(securite); resolve({ code, signal, killedBySecurite }) })
  })
}

describe('testing/index (createHarness) — un µeffect->setInterval ne fuit plus après destroy()', function () {
  this.timeout(45000) //couvre la marge de sécurité 30s + battement spawn/assertions

  it('le process enfant se termine TOUT SEUL après app.destroy() (pas de timer Node fantôme qui le maintient en vie)', async function () {
    const root = mjsTmp('testing-timer-leak')
    try {
      const srcDir = join(root, 'src')
      // sorties de la construction dans le dossier temporaire : sans dossier donné, le harnais construit dans `public/modularjs`
      // du dossier courant de l'enfant, celui du framework
      const outDir = join(root, 'out')
      const { code, signal, killedBySecurite } = await lancerFixture(srcDir, outDir)
      assert.equal(killedBySecurite, false,
        "le process enfant a dû être tué par le délai de sécurité — un setInterval posé par le µeffect a survécu à app.destroy() (window.close() natif est un no-op happy-dom)")
      assert.equal(signal, null, `le process ne doit PAS avoir reçu de signal — sortie naturelle attendue (signal reçu : ${signal})`)
      assert.equal(code, 0, `le process enfant doit sortir avec le code 0 (reçu : ${code})`)
      assert.ok(existsSync(join(outDir, 'bundle.js')), 'sorties de la construction écrites hors du dossier temporaire')
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
