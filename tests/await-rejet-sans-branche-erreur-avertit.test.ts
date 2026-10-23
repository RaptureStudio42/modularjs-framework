// {await $p} dont la promesse est rejetée, sans branche {error} : rien ne peut afficher l'erreur, et le contenu
// disparaissait sans un mot dans le navigateur (seul le rendu serveur avertissait). En développement, le bloc laisse
// désormais une trace dans la console, qui porte l'erreur, à chaque rejet ; comme les autres traces du runtime, le
// build de production la retire du code envoyé, et son texte du fichier de messages. Un bloc qui a sa branche {error}
// ne laisse rien : l'erreur y est affichée.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SANS_BRANCHE = [
  '<script>',
  "$p = Promise.reject(new Error('boom'))",
  '</script>',
  '<div class="w">{await $p}<i class="att">attente</i>{success d}<b>{d}</b>{end}</div>',
].join('\n')

const AVEC_BRANCHE = [
  '<script>',
  "$p = Promise.reject(new Error('boom'))",
  '</script>',
  '<div class="w">{await $p}<i class="att">attente</i>{success d}<b>{d}</b>{error err}<p class="ko">{err.message}</p>{end}</div>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('await-rejet-sans-branche')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'tst-awj-sans.mjs'), SANS_BRANCHE)
  writeFileSync(join(srcDir, 'tst-awj-avec.mjs'), AVEC_BRANCHE)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

// ce qui part chez le client : le code (.js) et les fichiers de messages, mis bout à bout
const envoye = (dossier: string) => readdirSync(dossier).filter((f) => f.endsWith('.js') || /^mjs_err-.*\.json$/.test(f)).map((f) => readFileSync(join(dossier, f), 'utf-8')).join('\n')

describe('{await} — une promesse rejetée sans branche {error} laisse une trace en développement', function () {
  this.timeout(240000)

  let app: any
  let root = ''
  let traces: any[][] = []

  before(async () => {
    root = projetTemporaire()
    app  = await createHarness({ root })
    app.window.console.log = (...a: any[]) => { traces.push(a) }
  })

  after(async () => {
    if (app) await app.destroy()
    await terminateSharedWorkerPool()
  })

  it('rejet sans {error} : une trace qui nomme le composant et porte l\'erreur', async () => {
    traces = []
    const c = await app.mount('tst-awj-sans')
    await pause(50)
    const miennes = traces.filter((a) => /tst-awj-sans/.test(String(a[0])))
    assert.equal(miennes.length, 1, `une trace attendue, reçues : ${JSON.stringify(traces.map((a) => String(a[0])))}`)
    assert.match(String(miennes[0][0]), /\{error\}/, 'le message dit qu\'il manque la branche {error}')
    assert.equal(miennes[0].some((x: any) => x && x.message === 'boom'), true, 'l\'erreur elle-même est jointe')
    c.destroy()
  })

  it('rejet avec une branche {error} : l\'erreur est affichée, aucune trace', async () => {
    traces = []
    const c = await app.mount('tst-awj-avec')
    await pause(50)
    assert.equal(c.text('.ko'), 'boom')
    assert.deepEqual(traces.filter((a) => /tst-awj-avec/.test(String(a[0]))), [])
    c.destroy()
  })

  it('build de production : la trace ne part pas, ni dans le code envoyé ni dans le fichier de messages', async () => {
    assert.match(envoye(join(root, 'out')), /awaitUnhandled/, 'témoin : le build de développement porte la trace')
    const sortie  = join(root, 'prod')
    const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: sortie, manifestPath: join(sortie, 'bundle.js'), env: 'prod' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const code = envoye(sortie)
    assert.ok(readdirSync(sortie).some((f) => /^mjs_err-fr.*\.json$/.test(f)), 'témoin : le fichier de messages français est émis, et relu')
    assert.equal(code.includes('awaitUnhandled'), false, 'la clé du message est partie avec la trace')
    assert.equal(code.includes('sans branche {error}'), false, 'son texte aussi')
  })
})
