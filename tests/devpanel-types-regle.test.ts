// mjs_devpanel — la règle d'une variable typée s'affiche à côté de sa valeur :
//   onglet État d'un composant : `volume  number  50  · int 0..100` ;
//   vue des stores : `panier  object  {…}  · { quantite: int 1..99 }` ;
//   une variable sans règle n'affiche rien de plus ; écrire dans le panneau passe par la règle.
//
// Pipeline RÉEL (Bundler → cœur + composants compilés, montés dans happy-dom), comme devpanel.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'dpt-player': [
    '<vars>',
    '$volume  int 0..100',
    "$couleur 'red' | 'green'",
    '$pseudo  string /^[<a-z]+$/',
    '</vars>',
    '<script>',
    '$volume  = 50',
    "$couleur = 'red'",
    "$pseudo  = 'ann'",
    '$libre   = 3',
    '</script>',
    '<p class="v">{$volume} {$couleur} {$pseudo} {$libre}</p>',
  ].join('\n'),
  'dpt-store': [
    '<vars>',
    '$$panier { quantite: int 1..99 }',
    '</vars>',
    '<script>',
    '$$panier = { quantite: 2 }',
    '$$compte = 1',
    '</script>',
    '<p class="q">{$$panier.quantite} {$$compte}</p>',
  ].join('\n'),
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('mjs_devpanel — la règle de chaque variable typée', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('devpanel-regle')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire  = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${lire(files.find((f) => /^mjs_core-/.test(f))!)}\nglobalThis.µ = µ;`)
    for (const nom of Object.keys(COMPOSANTS)) {
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
  const ligne  = (motif: RegExp) => Array.from(racine().querySelectorAll('.ligne') as ArrayLike<any>).find((b: any) => motif.test(b.textContent))
  const clic   = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  // la ligne de l'inspecteur dont la clé est `cle`, et le texte de sa règle (null : aucune)
  const rangee = (cle: string) => Array.from(racine().querySelectorAll('.detail .di-ligne') as ArrayLike<any>).find((l: any) => l.querySelector('.di-cle')?.textContent === cle)
  const regle  = (cle: string) => {
    const l = rangee(cle)
    assert.ok(l, `aucune ligne « ${cle} » :\n${racine().querySelector('.detail').textContent}`)
    return l.querySelector('.di-regle')?.textContent ?? null
  }

  async function ouvrirSur(balise: string, pret: (el: any) => boolean) {
    window.document.body.innerHTML = `<${balise}></${balise}>`
    const el: any = window.document.querySelector(balise)
    await attendre(() => pret(el))
    window.µ.console(true)
    return el
  }

  it('onglet État : chaque variable typée montre sa règle à côté de sa valeur', async () => {
    await ouvrirSur('mjs-dpt-player', (el) => el._shadow?.querySelector('.v')?.textContent === '50 red ann 3')
    clic(ligne(/dpt-player/))
    assert.equal(regle('volume'), '· int 0..100')
    assert.equal(regle('couleur'), "· 'red' | 'green'")
    assert.equal(regle('libre'), null, 'une variable sans règle : rien de plus')
  })

  it('la règle est du texte : ses chevrons ne deviennent pas des balises', async () => {
    await ouvrirSur('mjs-dpt-player', (el) => el._shadow?.querySelector('.v')?.textContent === '50 red ann 3')
    clic(ligne(/dpt-player/))
    assert.equal(regle('pseudo'), '· string /^[<a-z]+$/')
    assert.equal(rangee('pseudo').querySelector('.di-regle').children.length, 0)
  })

  it('écrire dans le panneau passe par la règle', async () => {
    const el = await ouvrirSur('mjs-dpt-player', (e) => e._shadow?.querySelector('.v')?.textContent === '50 red ann 3')
    clic(ligne(/dpt-player/))
    const champ = rangee('volume').querySelector('input.di-valeur')
    champ.value = '150'
    champ.dispatchEvent(new window.Event('change', { bubbles: true }))
    assert.equal(el._state.volume, 100, '150 ramené à 100')
    assert.equal(regle('volume'), '· int 0..100', 'la ligne redessinée garde sa règle')
  })

  it('vue des stores : le store typé montre sa règle, les autres rien', async () => {
    await ouvrirSur('mjs-dpt-store', (el) => el._shadow?.querySelector('.q')?.textContent === '2 1')
    clic(ligne(/stores/))
    assert.equal(regle('panier'), '· { quantite: int 1..99 }')
    assert.equal(regle('compte'), null)
  })
})
