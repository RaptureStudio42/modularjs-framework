// `mjs mcp`, outil compile_component : le composant se compile avec la clé `responsiveFontSize` du projet, comme `mjs build` le
// compile. L'outil ne rend que les fautes et les avertissements : le code qu'il compile est relevé dans le processus même, par un
// lanceur qui enveloppe `compileSingle` (le code écrit dans un fichier du projet d'essai : l'outil capte la console et la sortie
// d'erreur pendant la compilation) puis démarre le serveur MCP du projet

import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const SOURCE = '<p class="t">titre</p>\n<style>\n  .t\n    font-size: 30px\n</style>\n'

function projet(config: Record<string, unknown>): string {
  const root = mjsTmp('mcp-taille-texte')
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', ...config }, null, 2))
  writeFileSync(join(root, 'app', 'modularjs', 'titre.mjs'), SOURCE)
  // le lanceur : le module du bundler est celui que lit le serveur MCP, son compileSingle enveloppé avant le démarrage
  const bundler = JSON.stringify(join(repoRoot, 'src', 'bundler', 'index.js'))
  const mcp     = JSON.stringify(join(repoRoot, 'src', 'cli', 'mcp.js'))
  writeFileSync(join(root, 'releve.mjs'), `import { writeFileSync } from 'node:fs'\nimport { Bundler } from ${bundler}\nimport { runMcp } from ${mcp}\nconst compiler = Bundler.prototype.compileSingle\nBundler.prototype.compileSingle = async function (...a) {\n  const code = await compiler.apply(this, a)\n  writeFileSync(${JSON.stringify(join(root, 'code-compile.js'))}, code)\n  return code\n}\nawait runMcp({ root: ${JSON.stringify(root)}, version: null })\nprocess.exit(0)\n`)
  return root
}

// une session réduite : initialisation, un appel de compile_component, la réponse ; le serveur fermé, le code relevé
async function compiler(root: string): Promise<{ result: any, code: string }> {
  const child: ChildProcessWithoutNullStreams = spawn(join(repoRoot, 'node_modules', '.bin', 'tsx'), [join(root, 'releve.mjs')], { cwd: repoRoot, env: { ...process.env, NO_COLOR: '1' } })
  let tampon = ''
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (d) => { stderr += d })
  child.stdout.setEncoding('utf8')
  const ferme   = new Promise<void>((ok) => child.once('close', () => ok()))
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
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'compile_component', arguments: { file: 'app/modularjs/titre.mjs' } } }) + '\n')
  let result: any
  try {
    result = await reponse
  }
  finally {
    child.stdin.end()
    const arret = setTimeout(() => child.kill('SIGTERM'), 10000)
    await ferme
    clearTimeout(arret)
  }
  const releve = join(root, 'code-compile.js')
  assert.ok(existsSync(releve), 'code compilé non relevé\nstderr :\n' + stderr)
  return { result, code: readFileSync(releve, 'utf-8') }
}

describe('mjs mcp — compile_component suit la clé responsiveFontSize du projet', function () {
  this.timeout(120000)

  it('"responsiveFontSize": false : la taille reste écrite, aucune variable, comme par mjs build', async () => {
    const { result, code } = await compiler(projet({ responsiveFontSize: false }))
    assert.equal(result.structuredContent.ok, true, JSON.stringify(result.structuredContent))
    assert.ok(!code.includes('--mjs-fs-'), code)
    assert.match(code, /font-size:30px/)
  })

  it('sans la clé : la taille devient sa variable (réglage par défaut)', async () => {
    const { result, code } = await compiler(projet({}))
    assert.equal(result.structuredContent.ok, true, JSON.stringify(result.structuredContent))
    assert.match(code, /font-size:var\(--mjs-fs-30\)/)
  })
})
