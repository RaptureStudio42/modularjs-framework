// mjs_devpanel — l'onglet « Effets » : les effets qu'un composant a posés (la balise, l'effet, chaque
// réglage avec sa valeur écrite ou son défaut, la ligne de code qui suit), réglables à chaud — une
// variable CSS mise à jour sur place, un réglage de comportement qui relance l'effet —, « rétablir »
// qui rend les réglages de la pose ; l'entrée « effets (*) » de l'arbre, pour tous les effets de la
// page ; un effet CSS de l'appli (fichier *.effects.mjs) avec ses réglages. Les réglages de chaque
// effet utilisé partent dans le cœur de développement (µ._mjs_fxCatalog), jamais ceux des autres.
// « copier l'écriture » met la ligne de code dans le presse-papiers, avec les réglages essayés ; la
// connexion d'un effet en direct s'y écrit par sa variable (`sock: $$sock`), jamais par sa valeur.
//
// Pipeline RÉEL (Bundler → cœur + composants compilés, montés dans happy-dom), comme devpanel.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const FICHIERS: Record<string, string> = {
  'app.effects.mjs': [
    '<effects>',
    '  *halo(color: #0ff, size: 12px) =',
    '    box-shadow: 0 0 $size $color',
    '</effects>',
  ].join('\n'),
  'dpfx-carte.mjs': [
    '<h1 class="t" *neon(#f0f, size: 2)>Soirée</h1>',
    '<button class="b" *lift>Go</button>',
    '<span class="h" *halo(on: hover)>H</span>',
    "<p class=\"c\" *count(separator: '.')>12480</p>",
  ].join('\n'),
  'dpfx-vide.mjs': '<p class="v">sans effet</p>',
  'dpfx-delta.mjs': '<script>\n$n = 5\n</script>\n<b class="d" *delta(fx: *scramble(20))>{$n}</b>',
  'dpfx-direct.mjs': '<script>\n@sock = null\n</script>\n<div class="f" *follow(lead: true)>z</div>\n<div class="g" *cursors(sock: $$sock)>z</div>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('mjs_devpanel — l\'onglet Effets', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('devpanel-effets')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, source] of Object.entries(FICHIERS)) writeFileSync(join(srcDir, f), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire  = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${lire(files.find((f) => /^mjs_core-/.test(f))!)}\nglobalThis.µ = µ;`)
    // les fichiers des effets, importés par les composants qui les écrivent
    for (const f of files.filter((f) => /^mjs_fx_[a-z_]+-[0-9a-z]{5}\.js$/.test(f))) window.eval(lire(f))
    for (const nom of ['dpfx-carte', 'dpfx-vide', 'dpfx-direct', 'dpfx-delta']) {
      window.eval(lire(files.find((f) => new RegExp(`^${nom}-[0-9a-z]{5}\\.js$`).test(f))!))
    }
  })

  afterEach(() => {
    if (window?.µ?.console) window.µ.console(false)
    if (window) window.document.body.innerHTML = ''
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const racine = () => window.document.querySelector('[data-mjs-devpanel]')?.shadowRoot
  const clic   = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const onglet = (id: string) => clic(racine().querySelector(`.onglet[data-onglet="${id}"]`))
  const bloc   = (effet: string) => Array.from(racine().querySelectorAll('.detail .fx') as ArrayLike<any>).find((b: any) => b.querySelector('.fx-nom')?.textContent === '*' + effet)
  const champ  = (effet: string, cle: string) => bloc(effet)?.querySelector(`[data-cle="${cle}"]`)
  const regler = (el: any, valeur: string) => {
    el.value = valeur
    el.dispatchEvent(new window.Event('change', { bubbles: true }))
  }

  async function monter(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow && !!comp._shadow.querySelector(sel))
    await new Promise((r) => setTimeout(r, 20))
    return comp
  }

  it('les réglages des effets utilisés partent dans le cœur de développement, pas ceux des autres', () => {
    const cat = window.µ._mjs_fxCatalog
    assert.ok(cat && cat.neon && cat.lift, 'neon et lift attendus')
    assert.equal(cat.glitch, undefined, 'un effet que personne ne pose n\'y est pas')
    assert.equal(cat.neon.m, 'color')
  })

  it('l\'onglet liste les effets posés : la balise, l\'effet, chaque réglage (écrit, ou son défaut), la ligne de code', async () => {
    await monter('mjs-dpfx-carte', '.h')
    window.µ.console('mjs-dpfx-carte')
    onglet('effets')
    const neon = bloc('neon')
    assert.ok(neon, racine().querySelector('.detail').textContent)
    assert.match(neon.querySelector('.fx-balise').textContent, /<h1\.t>/)
    assert.equal(champ('neon', 'color').value, '#f0f')
    assert.equal(champ('neon', 'size').value, '2')
    assert.equal(champ('neon', 'flicker').type, 'checkbox', 'un réglage oui/non est une case')
    assert.equal(neon.querySelector('.fx-code').textContent, '*neon(#f0f, size: 2)')
    assert.ok(bloc('lift'), 'le second effet du composant')
    assert.equal(champ('lift', 'on').tagName, 'SELECT', 'une liste de mots est un menu')
    assert.equal(bloc('count').querySelector('.fx-code').textContent, "*count(separator: '.')", 'une ponctuation seule reste entre guillemets')
  })

  it('régler à chaud : variable CSS mise à jour sur place, réglage de comportement qui relance l\'effet, puis « rétablir »', async () => {
    const comp = await monter('mjs-dpfx-carte', '.h')
    const h1 = comp._shadow.querySelector('.t')
    const bouton = comp._shadow.querySelector('.b')
    window.µ.console('mjs-dpfx-carte')
    onglet('effets')
    regler(champ('neon', 'color'), '#0ff')
    assert.equal(h1.style.getPropertyValue('--mjs-neon-color'), '#0ff')
    assert.equal(bloc('neon').querySelector('.fx-code').textContent, '*neon(#0ff, size: 2)')
    regler(champ('lift', 'on'), 'click')
    assert.equal(bouton._mjs_fxOff.lift._s.on, 'click', 'l\'effet relancé avec son nouveau réglage')
    clic(bloc('neon').querySelector('[data-action="fx-retablir"]'))
    assert.equal(h1.style.getPropertyValue('--mjs-neon-color'), '#f0f')
    assert.equal(bloc('neon').querySelector('.fx-code').textContent, '*neon(#f0f, size: 2)')
  })

  it('« copier l\'écriture » : la ligne de code, avec les réglages essayés, part dans le presse-papiers ; le bouton le dit', async () => {
    const copies: string[] = []
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: (t: string) => { copies.push(t); return Promise.resolve() } }, configurable: true })
    await monter('mjs-dpfx-carte', '.h')
    window.µ.console('mjs-dpfx-carte')
    onglet('effets')
    regler(champ('neon', 'color'), '#0ff')
    const bouton = bloc('neon').querySelector('[data-action="fx-copier"]')
    assert.ok(bouton, 'un bouton par effet')
    clic(bouton)
    await attendre(() => copies.length > 0)
    assert.deepEqual(copies, ['*neon(#0ff, size: 2)'])
    await attendre(() => /copié/.test(bloc('neon').querySelector('[data-action="fx-copier"]').textContent))
    assert.match(bloc('neon').querySelector('[data-action="fx-copier"]').textContent, /copié/)
  })

  it('« copier l\'écriture » sans presse-papiers permis : la ligne est sélectionnée, le bouton dit Ctrl+C', async () => {
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('refusé')) }, configurable: true })
    await monter('mjs-dpfx-carte', '.h')
    window.µ.console('mjs-dpfx-carte')
    onglet('effets')
    clic(bloc('neon').querySelector('[data-action="fx-copier"]'))
    await attendre(() => /Ctrl\+C/.test(bloc('neon').querySelector('[data-action="fx-copier"]').textContent))
    assert.match(bloc('neon').querySelector('[data-action="fx-copier"]').textContent, /Ctrl\+C/)
  })

  it('un effet en direct : sa connexion s\'écrit par sa variable ($$sock), jamais par sa valeur ; @sock par défaut ne s\'écrit pas ; elle ne se règle pas ici', async () => {
    await monter('mjs-dpfx-direct', '.g')
    window.µ.console('mjs-dpfx-direct')
    onglet('effets')
    assert.equal(bloc('follow').querySelector('.fx-code').textContent, '*follow(lead: true)')
    assert.equal(bloc('cursors').querySelector('.fx-code').textContent, '*cursors($$sock)')
    assertAbsent(champ('cursors', 'sock'), 'pas de champ pour la connexion')
    assert.match(bloc('cursors').textContent, /\$\$sock/)
    assert.match(bloc('follow').textContent, /@sock/)
  })

  it('un effet donné en réglage s\'écrit comme il s\'écrit dans le code : fx: *scramble(20)', async () => {
    await monter('mjs-dpfx-delta', '.d')
    window.µ.console('mjs-dpfx-delta')
    onglet('effets')
    assert.match(bloc('delta').querySelector('.fx-code').textContent, /^\*delta\(fx: \*scramble\((speed: )?20\)\)$/)
  })

  it('un effet CSS de l\'appli : ses réglages et leurs défauts, réglables comme les autres', async () => {
    const comp = await monter('mjs-dpfx-carte', '.h')
    const span = comp._shadow.querySelector('.h')
    window.µ.console('mjs-dpfx-carte')
    onglet('effets')
    assert.ok(bloc('halo'), racine().querySelector('.detail').textContent)
    assert.equal(champ('halo', 'color').placeholder, '#0ff')
    assert.equal(champ('halo', 'on').value, 'hover')
    regler(champ('halo', 'size'), '20px')
    assert.equal(span.style.getPropertyValue('--mjs-halo-size'), '20px')
  })

  it('l\'entrée « effets (*) » de l\'arbre : tous les effets de la page, par composant ; un composant sans effet le dit', async () => {
    window.document.body.innerHTML = '<mjs-dpfx-carte></mjs-dpfx-carte><mjs-dpfx-vide></mjs-dpfx-vide>'
    await attendre(() => !!window.document.querySelector('mjs-dpfx-vide')?._shadow?.querySelector('.v') && !!window.document.querySelector('mjs-dpfx-carte')?._shadow?.querySelector('.h'))
    window.µ.console(true)
    const entree = Array.from(racine().querySelectorAll('.ligne') as ArrayLike<any>).find((b: any) => /effets \(\*\)/.test(b.textContent))
    assert.ok(entree, 'entrée « effets (*) » attendue dans l\'arbre')
    clic(entree)
    assert.match(racine().querySelector('.detail').textContent, /dpfx-carte/)
    assert.ok(bloc('neon') && bloc('lift') && bloc('halo'))
    window.µ.console('mjs-dpfx-vide')
    onglet('effets')
    assert.match(racine().querySelector('.detail').textContent, /aucun effet posé par ce composant/)
  })

  it('sans effet dans la page, pas d\'entrée « effets (*) »', async () => {
    await monter('mjs-dpfx-vide', '.v')
    window.µ.console(true)
    const entree = Array.from(racine().querySelectorAll('.ligne') as ArrayLike<any>).find((b: any) => /effets \(\*\)/.test(b.textContent))
    assert.ok(entree === undefined, 'aucune entrée « effets (*) »')
  })
})
