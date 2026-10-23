// Les effets en direct (*follow, *cursors, *react, *heatmap) prennent leur connexion MJS WS dans une
// variable : `sock: $$sock` (un store, une seule connexion pour toute l'appli), `sock: @sock` ; sans
// `sock`, dans `@sock` du composant — et si son <script> ne pose pas `@sock`, le build s'arrête et dit
// quoi écrire. Une adresse écrite (`server: 'wss://…'`) reste une autre connexion, sans `@sock`.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { parseEffect } from '../src/effects/catalog.js'

const compile = async (src: string): Promise<string> => String((await transpile(src, { moduleName: 'essai-sock' }) as any).output)
const refuse  = async (src: string, motif: RegExp): Promise<void> => {
  await assert.rejects(() => transpile(src, { moduleName: 'essai-sock' }), (e: any) => {
    assert.match(String(e.message), motif)
    return true
  })
}

const OUVRE = "<script>\n  @sock = µsocket 'wss://x.fr/ws'\n</script>\n"

describe('effets en direct — la connexion : sock, @sock par défaut', function () {
  this.timeout(30000)

  for (const [effet, balise] of [['follow', '<div *follow>z</div>'], ['cursors', '<div *cursors>z</div>'], ['react', '<div *react(stage: true)>z</div>'], ['heatmap', '<div *heatmap>z</div>']]) {
    it(`*${effet} sans sock dans un composant qui ne pose pas @sock : erreur du build, qui dit quoi écrire`, async () => {
      // la connexion est le réglage sans nom de *follow et de *cursors : l'erreur donne l'écriture courte
      const writing = effet === 'follow' || effet === 'cursors' ? `\\*${effet}\\(\\$\\$sock\\)` : 'sock: \\$\\$sock'
      await refuse(balise, new RegExp(`\\*${effet}[\\s\\S]*@sock[\\s\\S]*µsocket[\\s\\S]*${writing}`))
    })

    it(`*${effet} sans sock : la connexion de @sock, posée par le <script>`, async () => {
      const js = await compile(OUVRE + balise)
      assert.match(js, new RegExp(`µ\\._mjs_fx\\(this, _mjs_fxn, "${effet}", \\{[^}]*\\}, \\{[^}]*"sock": \\(this\\.sock\\)`))
    })
  }

  it('un bouton *react sans @sock : pas d\'erreur — il passe par la scène la plus proche ; avec @sock, @sock', async () => {
    const seul = await compile('<button *react(🎉)>b</button>')
    assert.doesNotMatch(seul, /"sock"/)
    const ouvert = await compile(OUVRE + '<button *react(🎉)>b</button>')
    assert.match(ouvert, /"sock": \(this\.sock\)/)
  })

  for (const effet of ['follow', 'cursors', 'react', 'heatmap']) {
    it(`<@document *${effet}> : @sock du composant, ou l'erreur du build`, async () => {
      await refuse(`<@document *${effet}></@document>`, new RegExp(`\\*${effet}[\\s\\S]*@sock`))
      const js = await compile(OUVRE + `<@document *${effet}></@document>`)
      assert.match(js, new RegExp(`µ\\._mjs_fx\\(this, document\\.documentElement, "${effet}", \\{\\}, \\{\\s*sock: this\\.sock\\s*\\}`))
    })
  }

  it('<@document *follow(sock: $$sock)> : la connexion d\'un store, suivie', async () => {
    const js = await compile('<@document *follow(sock: $$sock, lead: true)></@document>')
    assert.match(js, /µ\._mjs_fx\(this, document\.documentElement, "follow", \{"lead":true\}, \{\s*sock: µ\.store\.sock\s*\}/)
    assert.match(js, /µ\._mjs_fxSet\(document\.documentElement, "follow", \{\s*sock: µ\.store\.sock\s*\}/)
  })

  it('<@document *follow(server: …)> : sa propre connexion, sans @sock', async () => {
    const js = await compile("<@document *follow(server: 'wss://x.fr/ws')></@document>")
    assert.doesNotMatch(js, /sock:/)
  })

  it('sock: $$sock — la connexion d\'un store, sans @sock dans le composant', async () => {
    const js = await compile('<div class="z" *follow(sock: $$sock, lead: true)>z</div>')
    assert.match(js, /µ\._mjs_fx\(this, _mjs_fxn, "follow", \{"lead":true\}, \{"sock": \(µ\.store\.sock\)\}/)
  })

  it('sock: @autre — une autre variable du composant', async () => {
    const js = await compile("<script>\n  @autre = µsocket 'wss://y.fr/ws'\n</script>\n<div *cursors(sock: @autre)>z</div>")
    assert.match(js, /"sock": \(this\.autre\)/)
  })

  it('@sock posé dans une fonction (après une connexion, par exemple) compte aussi', async () => {
    const js = await compile("<script>\n  connecter = ->\n    @sock = µsocket 'wss://x.fr/ws'\n</script>\n<div *follow>z</div>")
    assert.match(js, /"sock": \(this\.sock\)/)
  })

  it('server: \'wss://…\' écrit : une autre connexion, sans @sock', async () => {
    const js = await compile("<div *follow(server: 'wss://x.fr/ws')>z</div>")
    assert.doesNotMatch(js, /"sock"/)
  })

  it('sock prend une variable, jamais une adresse écrite', () => {
    assert.throws(() => parseEffect('follow', "sock: 'wss://x.fr/ws'"), /\*follow[\s\S]*sock[\s\S]*\$\$sock/)
    assert.throws(() => parseEffect('react', '🎉, sock: 12'), /\*react[\s\S]*sock/)
    assert.deepEqual(parseEffect('follow', 'sock: $$sock').dynamic, { sock: '$$sock' })
    assert.deepEqual(parseEffect('heatmap', 'sock: @sock').dynamic, { sock: '@sock' })
  })

  it('les autres effets n\'ont pas de sock', () => {
    assert.throws(() => parseEffect('neon', 'sock: $$sock'), /sock/)
  })
})
