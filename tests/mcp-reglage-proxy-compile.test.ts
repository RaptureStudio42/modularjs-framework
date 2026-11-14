// `mjs mcp`, outil compile_component : le composant se compile avec les réglages du projet, comme `mjs build` le compile. Une appli
// à `"proxy": false` reçoit les avertissements propres à ce réglage (un objet de l'état passé à une fonction, que le compilateur ne
// suit pas) ; sans le réglage, l'enveloppe suit ces écritures et rien n'est signalé

import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const SOURCE = `<script lang="js">
  $obj = { a: 1 };
  @f = function() { envoyer($obj); };
</script>
<p>{$obj.a}</p>
`

function projet(config: Record<string, unknown>): string {
  const root = mjsTmp('mcp-proxy')
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', ...config }, null, 2))
  writeFileSync(join(root, 'app', 'modularjs', 'envoi.mjs'), SOURCE)
  return root
}

// une session réduite : initialisation, puis un appel de compile_component sur le fichier du projet ; la réponse rendue, le serveur fermé
async function compiler(root: string): Promise<any> {
  const child: ChildProcessWithoutNullStreams = spawn(join(repoRoot, 'node_modules', '.bin', 'tsx'), [join(repoRoot, 'src', 'cli.ts'), 'mcp', '--root', root], { cwd: repoRoot, env: { ...process.env, NO_COLOR: '1' } })
  let tampon = ''
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (d) => { stderr += d })
  child.stdout.setEncoding('utf8')
  const reponse = new Promise<any>((ok, ko) => {
    const minuterie = setTimeout(() => ko(new Error('pas de réponse de compile_component\nstderr :\n' + stderr)), 60000)
    child.stdout.on('data', (d) => {
      tampon += d
      for (const ligne of tampon.split('\n').slice(0, -1)) {
        const msg = JSON.parse(ligne)
        if (msg.id === 2) { clearTimeout(minuterie); ok(msg.result) }
      }
      tampon = tampon.slice(tampon.lastIndexOf('\n') + 1)
    })
  })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'essai', version: '1' } } }) + '\n')
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'compile_component', arguments: { file: 'app/modularjs/envoi.mjs' } } }) + '\n')
  try {
    return await reponse
  }
  finally {
    child.stdin.end()
    if (child.exitCode === null) child.kill('SIGTERM')
  }
}

const textes = (r: any) => (r.structuredContent.warnings as { message: string }[]).map((w) => w.message)

describe('mjs mcp — compile_component suit le réglage proxy du projet', function () {
  this.timeout(120000)

  it('"proxy": false : l\'avertissement propre au réglage (`$obj` passé à une fonction) est rendu, comme par mjs build', async () => {
    const r = await compiler(projet({ proxy: false }))
    assert.equal(r.structuredContent.ok, true, JSON.stringify(r.structuredContent))
    assert.ok(textes(r).some((m) => m.includes('`$obj` passé à `envoyer`')), JSON.stringify(r.structuredContent.warnings))
  })

  it('sans le réglage : l\'enveloppe suit l\'écriture, rien n\'est signalé', async () => {
    const r = await compiler(projet({}))
    assert.equal(r.structuredContent.ok, true, JSON.stringify(r.structuredContent))
    assert.ok(!textes(r).some((m) => m.includes('passé à `envoyer`')), JSON.stringify(r.structuredContent.warnings))
  })
})
