// mjs.config.json — `"blocks": { "preload": "idle" | "off" | "on" }` : quand partent les composants écrits seulement sous une branche
// fermable (un `{if}` et ses branches `{else}` ; ni `{for}` ni `{await}`). Toute autre forme est refusée avec un message qui cite les trois
// valeurs ; la valeur lue va à la construction. Le manifeste : `"on"` le laisse tel qu'avant le réglage, la marche du préchargement suit
// µDeps entière ; `"off"` lui ajoute une table du démarrage sans ces composants, que la marche suit — une balise écrite aussi hors de tout
// bloc, sous un `{for}` ou dans un `{await}`, y reste ; `"idle"` (défaut) : la même table, plus la file du repos des fichiers qu'elle
// laisse. Un `{if}` dont la valeur de départ est écrite en clair dans le `<script>` se décide à la construction : sa branche vraie entre
// dans la table du démarrage, les autres restent fermées

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

function lire(blocks: unknown) {
  const root = mjsTmp('config-blocks-preload')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ blocks }))
  const found = findConfig(root)
  return resolveBundlerOpts(found!.config, root)
}

async function manifeste(blocks: unknown, script: string[] = [], gabarit: string[] = []): Promise<string> {
  const root   = mjsTmp('manifeste-blocks-preload')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'app.mjs'), [
    '<script>',
    '  $faux = false',
    '  $p    = new Promise(->)',
    ...script,
    '</script>',
    '<@vu></@vu>',
    '{if $faux}<@si></@si><@vu></@vu>{else}<@sinon></@sinon>{end}',
    '{for x in []}<@boucle></@boucle>{end}',
    '{await $p}<@attente></@attente>{success v}<@fini></@fini>{end}',
    ...gabarit,
    '',
  ].join('\n'))
  for (const n of ['vu', 'si', 'sinon', 'boucle', 'attente', 'fini', 'profil', 'reglages', 'aide']) writeFileSync(join(srcDir, `${n}.mjs`), `<p>${n}</p>\n`)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...(blocks === undefined ? {} : { blocks }) }))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir) } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(root, 'out', 'bundle.js'), 'utf-8')
}

describe('mjs.config.json — blocks.preload', function () {
  this.timeout(60000)
  after(() => terminateSharedWorkerPool())

  for (const mauvais of ['off', { preload: 'repos' }, { preload: true }, { x: 1 }, null, ['on']]) {
    it(`refuse ${JSON.stringify(mauvais)}`, () => {
      assert.throws(() => lire(mauvais), (e: any) => {
        assert.match(e.message, /blocks doit être un objet/)
        assert.match(e.message, /"idle"/)
        assert.match(e.message, /"on"/)
        assert.match(e.message, /"off"/)
        assert.match(e.message, /au repos/)
        assert.match(e.message, /à l'ouverture de sa branche/)
        return true
      })
    })
  }

  for (const valeur of ['idle', 'on', 'off'] as const) {
    it(`accepte "${valeur}" et le transmet à la construction`, () => {
      assert.equal((lire({ preload: valeur }) as any).blocksPreload, valeur)
    })
  }

  it('sans réglage : rien n\'est transmis (la construction prend "idle")', () => {
    assert.equal((lire({}) as any).blocksPreload, undefined)
  })

  it('"idle" et sans réglage : le même manifeste', async () => {
    const sans = await manifeste(undefined)
    const idle = await manifeste({ preload: 'idle' })
    assert.equal(idle.replace(/manifeste-blocks-preload-\w+/g, ''), sans.replace(/manifeste-blocks-preload-\w+/g, ''))
  })

  it('"on" : manifeste sans table du démarrage ni file du repos, la marche suit µDeps entière', async () => {
    const on = await manifeste({ preload: 'on' })
    assert.doesNotMatch(on, /µDepsStart/)
    assert.doesNotMatch(on, /µIdle/)
    assert.match(on, /const µDeps = \{"app":\["attente","boucle","fini","si","sinon","vu"\]\}/)
  })

  it('"off" : la marche du démarrage suit une table sans les composants des branches fermables, sans file du repos', async () => {
    const off = await manifeste({ preload: 'off' })
    assert.match(off, /const µDeps = \{"app":\["attente","boucle","fini","si","sinon","vu"\]\}/)
    assert.match(off, /const µDepsStart = \{"app":\["attente","boucle","fini","vu"\]\}/)
    assert.match(off, /hasOwnProperty\.call\(µDepsStart, name\) \? µDepsStart\[name\]/)
    assert.doesNotMatch(off, /µIdle/)
  })

  it('"idle" : la table du démarrage (le {else} d\'un {if} décidé faux compris), et la file du repos des fichiers qu\'elle laisse, après load', async () => {
    const idle = await manifeste({ preload: 'idle' })
    assert.match(idle, /const µDepsStart = \{"app":\["attente","boucle","fini","sinon","vu"\]\}/)
    assert.match(idle, /const µIdle = \[\];/)
    // l'attente (après load, plus rien en vol, puis un repos) est celle du cœur, commune aux deux files du repos
    assert.match(idle, /µ\._idle\(µNext\)/)
  })

  it('un {if} dont la valeur de départ est écrite en clair se décide à la construction : sa branche vraie part au démarrage', async () => {
    const idle = await manifeste({ preload: 'idle' }, ["  $onglet = 'profil'", '  $vu     = true'], ["{if $onglet is 'profil'}<@profil></@profil>{elsif $onglet == 'reglages'}<@reglages></@reglages>{end}", '{if not $vu}<@aide></@aide>{end}'])
    assert.match(idle, /const µDeps = \{"app":\["aide","attente","boucle","fini","profil","reglages","si","sinon","vu"\]\}/)
    assert.match(idle, /const µDepsStart = \{"app":\["attente","boucle","fini","profil","sinon","vu"\]\}/)
    // sous "off", la devinette ne joue pas : la table d'aujourd'hui
    const off = await manifeste({ preload: 'off' }, ["  $onglet = 'profil'", '  $vu     = true'], ["{if $onglet is 'profil'}<@profil></@profil>{elsif $onglet == 'reglages'}<@reglages></@reglages>{end}", '{if not $vu}<@aide></@aide>{end}'])
    assert.match(off, /const µDepsStart = \{"app":\["attente","boucle","fini","vu"\]\}/)
  })

  it('une valeur de départ qui n\'est pas écrite en clair, ou écrite deux fois, laisse la branche fermée', async () => {
    const idle = await manifeste({ preload: 'idle' }, ['  $onglet = lire()', '  $ouvert = true', '  $ouvert = false'], ["{if $onglet is 'profil'}<@profil></@profil>{end}", '{if $ouvert}<@aide></@aide>{end}'])
    assert.match(idle, /const µDepsStart = \{"app":\["attente","boucle","fini","sinon","vu"\]\}/)
  })
})
