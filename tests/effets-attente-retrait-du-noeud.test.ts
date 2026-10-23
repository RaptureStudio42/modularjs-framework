// Un nœud dont l'effet `*nom` est encore en attente (son fichier n'est pas arrivé, ou son composant n'est pas encore
// défini) et que le bloc qui le porte retire ({if}, {for}) : l'attente part tout de suite avec lui. Elle ne restait
// que tant que l'effet n'arrivait pas — jamais, pour un composant qui n'arrive pas — parce que le chemin de
// destruction ne regardait que les effets déjà posés (`_mjs_fxOff`), pas ceux qui attendent (`_mjs_fxWait`).
// Même chose pour un nœud qui a une sortie à jouer, et pour un descendant du nœud retiré.
// happy-dom : le fichier de l'effet `neon` est « en route » (retiré des effets connus, `arrive()` le rend).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await pause(10)
}

const REGLE = { color: ['c', 'color'] }

const COMPOSANTS: Record<string, string> = {
  'bloc-effet':           '<script>\n$vu = true\n</script>\n<div class="box">{if $vu}<b class="n" *neon(#0ff)>x</b>{end}</div>',
  'bloc-effet-imbrique':  '<script>\n$vu = true\n</script>\n<div class="box">{if $vu}<div class="o"><p><b class="n" *neon(#0ff)>x</b></p></div>{end}</div>',
  'liste-effet':          '<script>\n$items = [1, 2, 3]\n</script>\n<div class="box">{for i in $items}<b class="n" *neon(#0ff)>{i}</b>{end}</div>'
}

describe('effet en attente — le retrait du nœud par un bloc l\'annule tout de suite', function () {
  this.timeout(120000)
  let code = ''

  before(async () => {
    const root   = mjsTmp('effets-attente-retrait')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  after(async () => { await terminateSharedWorkerPool() })

  // une page dont le fichier de l'effet `neon` n'est pas encore arrivé : `arrive()` le rend
  function fenetre() {
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    const µ    = window.µ
    const def  = µ._mjs_fxDefs.neon
    const need = µ._mjs_fxNeed
    let fin: () => void = () => {}
    const promesse = new Promise<void>((ok) => { fin = ok })
    delete µ._mjs_fxDefs.neon
    µ._mjs_fxNeed = () => promesse
    return { window, arrive: () => { µ._mjs_fxDefs.neon = def; µ._mjs_fxNeed = need; fin() } }
  }

  async function monter(window: any, tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector('.box'))
    await pause(30)
    return comp
  }

  // les attentes d'une balise, comptées : jamais le nœud lui-même dans une assertion
  const attentes = (el: any) => Object.keys(el._mjs_fxWait || {}).length

  it('{if} : la balise qui porte l\'effet en attente est retirée, l\'attente part avec elle', async () => {
    const { window } = fenetre()
    try {
      const comp = await monter(window, 'mjs-bloc-effet')
      const n = comp._shadow.querySelector('.n')
      assert.equal(attentes(n), 1, 'l\'effet attend son fichier')
      const g = n._mjs_fxWait.neon
      assert.equal(g.calls.length, 1)
      comp._set('vu', false)
      await attendre(() => !comp._shadow.querySelector('.n'))
      assert.equal(!!comp._shadow.querySelector('.n'), false, 'la balise est retirée')
      assert.equal(attentes(n), 0, 'plus d\'attente sur la balise retirée')
      assert.equal(g.calls.length, 0, 'l\'attente ne retient plus ses appels')
      assert.equal(g.step, null, 'et n\'attend plus rien')
    } finally {
      window.close()
    }
  })

  it('{if} : l\'effet en attente est sur un descendant du nœud retiré : il part avec lui', async () => {
    const { window } = fenetre()
    try {
      const comp = await monter(window, 'mjs-bloc-effet-imbrique')
      const n = comp._shadow.querySelector('.n')
      assert.equal(attentes(n), 1, 'l\'effet attend son fichier')
      const g = n._mjs_fxWait.neon
      comp._set('vu', false)
      await attendre(() => !comp._shadow.querySelector('.o'))
      assert.equal(!!comp._shadow.querySelector('.o'), false, 'le bloc est retiré')
      assert.equal(attentes(n), 0, 'plus d\'attente sur le descendant')
      assert.equal(g.calls.length, 0)
    } finally {
      window.close()
    }
  })

  it('{for} : les lignes retirées emportent leur attente', async () => {
    const { window } = fenetre()
    try {
      const comp = await monter(window, 'mjs-liste-effet')
      const lignes = [...comp._shadow.querySelectorAll('.n')]
      assert.equal(lignes.length, 3)
      assert.deepEqual(lignes.map(attentes), [1, 1, 1], 'chaque ligne attend le fichier')
      const gs = lignes.map((l: any) => l._mjs_fxWait.neon)
      comp._set('items', [])
      await attendre(() => comp._shadow.querySelectorAll('.n').length === 0)
      assert.equal(comp._shadow.querySelectorAll('.n').length, 0, 'les lignes sont retirées')
      assert.deepEqual(lignes.map(attentes), [0, 0, 0], 'plus d\'attente sur les lignes retirées')
      assert.deepEqual(gs.map((g: any) => g.calls.length), [0, 0, 0])
    } finally {
      window.close()
    }
  })

  it('un effet demandé pendant la sortie du nœud, encore en attente à la fin de la sortie : il part avec la balise', async () => {
    const { window } = fenetre()
    try {
      const µ = window.µ
      const comp = await monter(window, 'mjs-bloc-effet')
      const noeud = window.document.createElement('b')
      comp._shadow.querySelector('.box').appendChild(noeud)
      noeud._mjs_outro = () => { µ._mjs_fx(comp, noeud, 'neon', {}, { color: '#ff0000' }, REGLE); return pause(10) }
      await comp._mjs_destroyWithHooks(noeud, false)
      assert.equal(!!noeud.parentNode, false, 'la balise est retirée à la fin de la sortie')
      assert.equal(attentes(noeud), 0, 'plus d\'attente sur la balise retirée')
    } finally {
      window.close()
    }
  })

  it('la sortie du nœud dure : l\'attente part dès le début de la sortie, sans attendre qu\'elle finisse', async () => {
    const { window } = fenetre()
    try {
      const µ = window.µ
      const comp = await monter(window, 'mjs-bloc-effet')
      const noeud = window.document.createElement('b')
      comp._shadow.querySelector('.box').appendChild(noeud)
      µ._mjs_fx(comp, noeud, 'neon', {}, { color: '#ff0000' }, REGLE)
      assert.equal(attentes(noeud), 1, 'l\'effet attend son fichier')
      noeud._mjs_outro = () => pause(80)
      const fini = comp._mjs_destroyWithHooks(noeud, false)
      assert.equal(attentes(noeud), 0, 'au début de la sortie, la balise est encore là')
      assert.equal(!!noeud.parentNode, true, 'la balise joue sa sortie')
      await fini
      assert.equal(!!noeud.parentNode, false, 'la balise est retirée à la fin de la sortie')
    } finally {
      window.close()
    }
  })

  it('témoin : l\'effet déjà posé part toujours avec la balise retirée, et un effet qui arrive plus tard ne se pose pas sur elle', async () => {
    const { window, arrive } = fenetre()
    try {
      const comp = await monter(window, 'mjs-bloc-effet')
      const n = comp._shadow.querySelector('.n')
      arrive()
      await pause(30)
      assert.equal(n.getAttribute('mjs-fx'), 'neon', 'l\'effet est posé à l\'arrivée du fichier')
      comp._set('vu', false)
      await attendre(() => !comp._shadow.querySelector('.n'))
      assert.equal(n.hasAttribute('mjs-fx'), false, 'retiré avec la balise')
      assert.equal(!!n._mjs_fxOff, false, 'plus de poignée sur la balise retirée')
    } finally {
      window.close()
    }
  })
})
