// `"prune": false` de mjs.config.json atteint le constructeur (les anciennes empreintes restent sur disque), et un build
// en échec ne réécrit pas les feuilles de mise en page `<composant>.<nom>.css` des composants sains : le site servi
// garde celles du dernier build réussi.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { resolveBundlerOpts } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function build(root: string) {
  const r = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', root], { cwd: repoRoot, encoding: 'utf-8', timeout: 120000 })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('"prune": false transmis, mise en page intacte en build en échec', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('resolveBundlerOpts transmet prune', () => {
    assert.equal((resolveBundlerOpts({ prune: false } as any, '/tmp') as any).prune, false)
    assert.equal((resolveBundlerOpts({} as any, '/tmp') as any).prune, undefined)
  })

  it('mjs build avec "prune": false garde l\'ancienne empreinte d\'un composant modifié', () => {
    const root = mjsTmp('cli-prune-faux')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', prune: false }))
    writeFileSync(join(root, 'src', 'a.mjs'), '<p>a1</p>\n')
    const b1 = build(root)
    assert.equal(b1.code, 0, b1.stderr)
    const premier = readdirSync(join(root, 'out')).find(f => /^a-[0-9a-z]{5}\.js$/.test(f))
    assert.ok(premier)
    writeFileSync(join(root, 'src', 'a.mjs'), '<p>a2</p>\n')
    const b2 = build(root)
    assert.equal(b2.code, 0, b2.stderr)
    const apres = readdirSync(join(root, 'out')).filter(f => /^a-[0-9a-z]{5}\.js$/.test(f))
    assert.ok(apres.includes(premier!), `l'ancienne empreinte ${premier} doit rester : ${apres.join(', ')}`)
    assert.equal(apres.length, 2)
  })

  it('build en échec : carte.banner.css garde le contenu du dernier build réussi', async () => {
    const root = mjsTmp('mise-en-page-echec')
    const src = join(root, 'src')
    const out = join(root, 'out')
    mkdirSync(src, { recursive: true })
    const carte = (couleur: string) => ['<p class="t">x</p>', '<style lang="sass" name="banner">', '.t', `  color: ${couleur}`, '</style>'].join('\n')
    writeFileSync(join(src, 'carte.mjs'), carte('green'))
    writeFileSync(join(src, 'b.mjs'), '<p>b</p>\n')
    const opts = { sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), keepFailedComponents: false }
    const s1 = await new Bundler(opts).compile()
    assert.equal(s1.errors.length, 0, s1.errors.map(e => e.message).join('\n'))
    const avant = readFileSync(join(out, 'carte.banner.css'), 'utf-8')
    assert.match(avant, /green/)
    writeFileSync(join(src, 'carte.mjs'), carte('red'))
    writeFileSync(join(src, 'b.mjs'), '<p>{</p>\n<script>\n  $x = (\n</script>\n')
    const s2 = await new Bundler(opts).compile()
    assert.ok(s2.errors.length > 0, 'le 2e build doit échouer')
    assert.equal(readFileSync(join(out, 'carte.banner.css'), 'utf-8'), avant)
    writeFileSync(join(src, 'b.mjs'), '<p>b</p>\n')
    const s3 = await new Bundler(opts).compile()
    assert.equal(s3.errors.length, 0, s3.errors.map(e => e.message).join('\n'))
    assert.match(readFileSync(join(out, 'carte.banner.css'), 'utf-8'), /red/)
  })
})
