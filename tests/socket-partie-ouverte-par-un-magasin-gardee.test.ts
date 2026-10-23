// une partie (sock.game) ouverte par une fonction de magasin appelée depuis le µmount d'un composant est rattachée à ce
// composant (le rattachement suit le moment de l'appel) : sa destruction quittait la partie et rendait le siège, alors que la
// doc conseille justement le magasin pour une partie qui doit survivre au composant qui l'affiche. Une partie n'est rattachée à
// aucun composant : la destruction d'un composant ne la quitte pas, elle vit jusqu'à leave() ou la fin de la partie. Vrais
// composants compilés par le Bundler, montés dans happy-dom, faux WebSocket qui répond
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const pause = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

const HOTE = [
  '<script lang="coffee">',
  '$montre = true',
  '@cacher = -> $montre = false',
  "globalThis.__magasin ?= { ouvrir: -> globalThis.__partie = µ.socket('ws://jeu.test/play').game('echecs') }",
  '</script>',
  '{if $montre}<@enfant></@enfant>{end}', '',
].join('\n')

const ENFANT = ['<script lang="coffee">', 'µmount ->', '  globalThis.__magasin.ouvrir()', 'µdestroy ->', '  globalThis.__detruit = true', '</script>', '<p>enfant</p>', ''].join('\n')

// s'ouvre aussitôt, accueille, et assoit tout µgame:play à la partie g1
const FAUX_WS = `globalThis.__envoyes = [];
globalThis.WebSocket = class {
  constructor(u) {
    this.url = u; this.readyState = 0;
    setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); this.recevoir({ t: 'µ:welcome', p: {} }) }, 0);
  }
  recevoir(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }) }
  send(d) {
    const m = JSON.parse(String(d));
    globalThis.__envoyes.push(m);
    if (m.t === 'µgame:play') setTimeout(() => this.recevoir({ t: 'µ:ack', id: m.id, p: { game: 'g1', seat: 0, view: {}, phase: 'jeu', turn: '1', seq: 1, code: null } }), 0);
  }
  close() { this.readyState = 3 }
  addEventListener() {}
  removeEventListener() {}
};`

describe('sock.game — une partie ouverte par un magasin depuis le µmount d\'un composant', function () {
  this.timeout(60000)
  let dir: string

  before(() => { dir = mkdtempSync(join(tmpdir(), 'partie-magasin-')) })
  after(() => { rmSync(dir, { recursive: true, force: true }) })

  it('la destruction du composant ne quitte pas la partie : siège gardé, aucun départ envoyé', async () => {
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src/hote.mjs'), HOTE)
    writeFileSync(join(dir, 'src/enfant.mjs'), ENFANT)
    const bundler = new Bundler({ sourceDir: join(dir, 'src'), outputDir: join(dir, 'out'), manifestPath: join(dir, 'bundle.js'), env: 'dev' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files  = readdirSync(join(dir, 'out')).filter(f => f.endsWith('.js'))
    const ordre  = [...files.filter(f => f.startsWith('mjs_')), ...files.filter(f => !f.startsWith('mjs_'))]
    const code   = ordre.map(f => stripEsm(readFileSync(join(dir, 'out', f), 'utf-8'))).join('\n')
    const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    try {
      window.eval(FAUX_WS)
      window.eval(code + '\nglobalThis.µ = µ;')
      window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
      const hote = window.document.querySelector('mjs-hote')
      for (let i = 0; i < 300 && !(window.__partie && window.__partie.state.status === 'playing'); i++) await pause(10)
      const partie = window.__partie
      assert.ok(partie, 'partie ouverte par le magasin')
      assert.equal(partie.state.status, 'playing')
      hote.cacher()
      await pause(300)
      assert.equal(window.__detruit, true, 'enfant détruit')
      assert.equal(partie.state.status, 'playing', 'la partie n\'est pas quittée')
      // copies JSON : les tableaux de la page viennent d'un autre domaine d'exécution
      const departs = (): unknown[] => JSON.parse(JSON.stringify(window.__envoyes.filter((m: any) => m.t === 'µgame:leave').map((m: any) => m.p)))
      assert.deepEqual(departs(), [], 'aucun départ envoyé au serveur')
      partie.leave()
      assert.equal(partie.state.status, 'left')
      assert.deepEqual(departs(), [{ game: 'g1' }], 'leave() reste le départ')
    }
    finally {
      await window.happyDOM?.close?.()
    }
  })
})
