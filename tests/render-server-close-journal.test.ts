// Fermer le serveur de rendu (RunningServer.close()) doit relâcher ce qui appartient au journal
// serveur, pas seulement vider son tampon : journalStore.close() (jamais flush() seul) solde ET se
// retire du hook 'exit' process-level (pendingFlushes, journal.ts) — sinon ce serveur reste
// enregistré après sa propre fermeture, référence qui n'appartient plus à personne. Même patron de
// preuve que tests/journal-close.test.ts (contre-preuve + preuve, process ENFANT réel), mais en
// passant par startRenderServer() plutôt que createJournal() directement.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE   = join(__dirname, 'fixtures/render-server-close-child.mts')

after(() => sweepRegistered())

function lancerFixture(dir: string, mode: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const enfant   = spawn(process.execPath, ['--import', 'tsx', FIXTURE, dir, mode], { cwd: join(__dirname, '..'), stdio: 'ignore' })
    const securite = setTimeout(() => enfant.kill('SIGKILL'), 8000)
    enfant.on('error', (e) => { clearTimeout(securite); reject(e) })
    enfant.on('exit', (code) => { clearTimeout(securite); resolve(code) })
  })
}

describe('render-server — close() relâche le journal (src/server/render-server.ts)', function () {
  this.timeout(20000)

  it('CONTRE-PREUVE sans close() : le hook de sortie RECRÉE le dossier de log effacé juste avant', async () => {
    const dir = mjsTmp('render-close-sans')
    assert.equal(await lancerFixture(dir, 'sans-close'), 0, 'la fixture doit se terminer normalement')
    assert.ok(existsSync(join(dir, 'log')), 'sans close(), le dossier de log doit ressusciter — sinon ce test ne prouve rien du cas suivant')
  })

  it('avec running.close() : le dossier de log effacé RESTE effacé — plus aucune référence dans le hook \'exit\'', async () => {
    const dir = mjsTmp('render-close-avec')
    assert.equal(await lancerFixture(dir, 'avec-close'), 0, 'la fixture doit se terminer normalement')
    assert.ok(!existsSync(join(dir, 'log')), 'close() a soldé le journal PUIS s\'est retiré du hook \'exit\' : rien ne recrée le dossier de log')
  })
})
