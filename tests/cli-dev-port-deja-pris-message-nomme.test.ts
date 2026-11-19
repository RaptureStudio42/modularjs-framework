// mjs dev sur un port déjà pris : un message qui nomme le port et dit quoi faire (`--port`), en français et en anglais, jamais la
// pile brute de Node (`EADDRINUSE`, `setupListenHandle`)
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getMessagesLang, setMessagesLang, t } from '../src/messages/index.js'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

after(() => sweepRegistered())

describe('mjs dev — port déjà pris', function () {
  this.timeout(60000)

  it('le message nomme le port et dit d\'en choisir un autre avec --port, sans la pile de Node', async function () {
    const occupant = createServer()
    await new Promise<void>((ok) => occupant.listen(0, '127.0.0.1', () => ok()))
    const port = (occupant.address() as AddressInfo).port
    try {
      const root = mjsTmp('dev-port-pris')
      mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
      writeFileSync(join(root, 'app', 'modularjs', 'salut.mjs'), '<p>salut</p>\n')
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'out' }))
      const r      = spawnSync(tsxBin, [cliPath, 'dev', '--root', root, '--port', String(port)], { encoding: 'utf-8', timeout: 30000, env: { ...process.env, NO_COLOR: '1' } })
      const sortie = r.stdout + r.stderr
      assert.equal(r.status, 1, sortie)
      assert.ok(sortie.includes(`le port ${port} est déjà pris`), sortie)
      assert.ok(sortie.includes('`--port`'), sortie)
      assert.ok(!sortie.includes('setupListenHandle'), 'pile de Node brute :\n' + sortie)
    }
    finally {
      occupant.close()
    }
  })

  it('le même message en anglais', function () {
    const avant = getMessagesLang()
    setMessagesLang('en')
    const en = t('cli.port-already-taken' as any, { port: 3000, host: '127.0.0.1' })
    setMessagesLang(avant)
    assert.ok(en.includes('port 3000 is already in use') && en.includes('`--port`'), en)
  })
})
