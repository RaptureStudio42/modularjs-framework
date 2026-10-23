// mjs_devpanel — trois gestes du panneau d'inspection :
//   1. double-cliquer un composant de l'arbre ouvre ou ferme sa branche (comme la flèche ▸/▾) ;
//   2. les stores `$$x` ont leur entrée dans l'arbre, se lisent et se modifient — écriture
//      profonde comprise, l'écran qui les affiche suit ;
//   3. la rune `µconsole` ouvre le panneau : écrite dans le code (sur CE composant), ou tapée dans
//      la console du navigateur ; en production elle ne fait rien, sans planter.
//
// Pipeline RÉEL (Bundler → cœur + composants compilés, montés dans happy-dom), comme devpanel.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'dpx-parent': '<div class="p"><mjs-dpx-enfant></mjs-dpx-enfant></div>',
  'dpx-enfant': '<p class="e">enfant</p>',
  'dpx-store': [
    '<script>',
    '$$compteur = 5',
    '$$panier = { quantite: 2 }',
    '</script>',
    '<p class="c">{$$compteur}</p>',
    '<p class="q">{$$panier.quantite}</p>',
  ].join('\n'),
  'dpx-console': [
    '<script>',
    'µmount ->',
    '  µconsole',
    '</script>',
    '<p class="k">console</p>',
  ].join('\n'),
  'dpx-vise': [
    '<script>',
    'µmount ->',
    "  µconsole('mjs-dpx-enfant')",
    '</script>',
    '<mjs-dpx-enfant></mjs-dpx-enfant>',
  ].join('\n'),
  'dpx-vise-nu': [
    '<script>',
    'µmount ->',
    "  µconsole 'mjs-dpx-enfant'",
    '</script>',
    '<mjs-dpx-enfant></mjs-dpx-enfant>',
  ].join('\n'),
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

function ecrireSources(srcDir: string) {
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), source)
}

describe('mjs_devpanel — branches, stores et µconsole', function () {
  this.timeout(60000)
  let window: any
  let outDir: string

  before(async () => {
    const root   = mjsTmp('devpanel-bsc')
    const srcDir = join(root, 'src')
    outDir = join(root, 'out')
    ecrireSources(srcDir)
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

  const racine     = () => window.document.querySelector('[data-mjs-devpanel]')?.shadowRoot
  const texteArbre = () => racine().querySelector('.arbre').textContent as string
  const ligne      = (motif: RegExp) => Array.from(racine().querySelectorAll('.ligne') as ArrayLike<any>).find((b: any) => motif.test(b.textContent))
  const clic       = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const doubleClic = (el: any) => el.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))

  it('double-cliquer un composant ferme puis rouvre sa branche', async () => {
    window.document.body.innerHTML = '<mjs-dpx-parent></mjs-dpx-parent>'
    await attendre(() => !!window.document.querySelector('mjs-dpx-parent')?._shadow?.querySelector('mjs-dpx-enfant'))
    window.µ.console(true)
    assert.match(texteArbre(), /dpx-enfant/, 'au départ, la branche est ouverte')

    // un vrai double-clic, c'est deux clics PUIS le double-clic : le premier clic sélectionne et
    // redessine l'arbre, les suivants tombent sur la ligne redessinée
    clic(ligne(/dpx-parent/))
    clic(ligne(/dpx-parent/))
    doubleClic(ligne(/dpx-parent/))
    assert.doesNotMatch(texteArbre(), /dpx-enfant/, 'double-clic : la branche se ferme')
    assert.equal(ligne(/dpx-parent/).getAttribute('aria-selected'), 'true', 'et le composant reste sélectionné')
    assert.equal(racine().querySelector('.repli[data-uid]').getAttribute('aria-expanded'), 'false', 'la flèche suit')

    doubleClic(ligne(/dpx-parent/))
    assert.match(texteArbre(), /dpx-enfant/, 'second double-clic : elle se rouvre')
  })

  it('double-cliquer un composant sans enfant ne change rien à l’arbre', async () => {
    window.document.body.innerHTML = '<mjs-dpx-parent></mjs-dpx-parent>'
    await attendre(() => !!window.document.querySelector('mjs-dpx-parent')?._shadow?.querySelector('mjs-dpx-enfant'))
    window.µ.console(true)
    const avant = texteArbre()
    doubleClic(ligne(/dpx-enfant/))
    assert.equal(texteArbre().replace(/·\d+/g, ''), avant.replace(/·\d+/g, ''))
  })

  it('les stores ont leur entrée dans l’arbre et s’y lisent', async () => {
    window.document.body.innerHTML = '<mjs-dpx-store></mjs-dpx-store>'
    const el: any = window.document.querySelector('mjs-dpx-store')
    await attendre(() => el._shadow?.querySelector('.c')?.textContent === '5')
    window.µ.console(true)
    const entree = ligne(/stores/)
    assert.ok(entree, `une entrée « stores » doit exister dans l'arbre :\n${texteArbre()}`)
    clic(entree)
    const detail = racine().querySelector('.detail').textContent
    assert.match(detail, /compteur/, detail)
    assert.match(detail, /panier/, detail)
  })

  it('écrire un store dans le panneau change la valeur et l’écran qui l’affiche', async () => {
    window.document.body.innerHTML = '<mjs-dpx-store></mjs-dpx-store>'
    const el: any = window.document.querySelector('mjs-dpx-store')
    await attendre(() => el._shadow?.querySelector('.c')?.textContent === '5')
    window.µ.console(true)
    clic(ligne(/stores/))
    const champ = racine().querySelector('input.di-valeur[data-di-key="compteur"]')
    assert.ok(champ, 'le compteur doit être modifiable')
    champ.value = '9'
    champ.dispatchEvent(new window.Event('change', { bubbles: true }))
    assert.equal(window.µ.store.compteur, 9)
    await attendre(() => el._shadow.querySelector('.c').textContent === '9')
    assert.equal(el._shadow.querySelector('.c').textContent, '9', 'le composant qui lit $$compteur suit')
  })

  it('écrire DANS un objet de store prévient aussi l’écran', async () => {
    window.document.body.innerHTML = '<mjs-dpx-store></mjs-dpx-store>'
    const el: any = window.document.querySelector('mjs-dpx-store')
    await attendre(() => el._shadow?.querySelector('.q')?.textContent === '2')
    window.µ.console(true)
    clic(ligne(/stores/))
    const chevron = Array.from(racine().querySelectorAll('.di-ligne') as ArrayLike<any>).find((l: any) => /panier/.test(l.textContent))?.querySelector('.di-chevron')
    assert.ok(chevron, 'le panier doit se déplier')
    clic(chevron)
    const champ = racine().querySelector('input.di-valeur[data-di-key="quantite"]')
    assert.ok(champ, 'la quantité doit être modifiable une fois le panier déplié')
    champ.value = '7'
    champ.dispatchEvent(new window.Event('change', { bubbles: true }))
    assert.equal(window.µ.store.panier.quantite, 7)
    await attendre(() => el._shadow.querySelector('.q').textContent === '7')
    assert.equal(el._shadow.querySelector('.q').textContent, '7', 'le composant qui lit $$panier.quantite suit')
  })

  it('cliquer un composant après les stores revient à ses onglets', async () => {
    window.document.body.innerHTML = '<mjs-dpx-store></mjs-dpx-store>'
    const el: any = window.document.querySelector('mjs-dpx-store')
    await attendre(() => el._shadow?.querySelector('.c')?.textContent === '5')
    window.µ.console(true)
    clic(ligne(/stores/))
    clic(ligne(/dpx-store/))
    assert.ok(racine().querySelector('.onglets'), 'les onglets du composant reviennent')
  })

  it('µconsole écrit dans le code ouvre le panneau sur CE composant', async () => {
    window.document.body.innerHTML = '<p>page</p><mjs-dpx-console></mjs-dpx-console>'
    await attendre(() => !!racine())
    assert.ok(racine(), 'le panneau doit s’ouvrir')
    await attendre(() => /dpx-console/.test(racine().querySelector('.di-entete')?.textContent ?? ''))
    assert.match(racine().querySelector('.di-entete').textContent, /dpx-console/, 'le composant qui a écrit µconsole est sélectionné')
  })

  it('µconsole tapé dans la console du navigateur ouvre le panneau', () => {
    window.document.body.innerHTML = '<mjs-dpx-parent></mjs-dpx-parent>'
    const retour = window.eval('µconsole')
    assert.ok(racine(), 'le panneau doit s’ouvrir')
    assert.match(String(retour), /panneau/, 'la console affiche une phrase, pas undefined')
  })

  it('µconsole avec un argument, entre parenthèses ou sans : le panneau s’ouvre sur ce qu’il désigne', async () => {
    for (const hote of ['mjs-dpx-vise', 'mjs-dpx-vise-nu']) {
      window.µ.console(false)
      window.document.body.innerHTML = `<${hote}></${hote}>`
      await attendre(() => /dpx-enfant/.test(racine()?.querySelector('.di-entete')?.textContent ?? ''))
      assert.match(racine()?.querySelector('.di-entete')?.textContent ?? '', /dpx-enfant/, `${hote} : le composant désigné est sélectionné`)
    }
  })

  it('µconsole(…) tapé dans la console du navigateur : même argument qu’en code', async () => {
    window.document.body.innerHTML = '<mjs-dpx-parent></mjs-dpx-parent>'
    await attendre(() => !!window.document.querySelector('mjs-dpx-parent')?._shadow?.querySelector('mjs-dpx-enfant'))
    const retour = window.eval("µconsole('mjs-dpx-parent')")
    assert.match(racine().querySelector('.di-entete').textContent, /dpx-parent/)
    assert.match(String(retour), /panneau/, 'la console affiche une phrase')
  })

  it('bouton « cibler » : un clic dans la page sélectionne le composant touché, sans atteindre la page', async () => {
    window.document.body.innerHTML = '<mjs-dpx-parent></mjs-dpx-parent>'
    const parent: any = window.document.querySelector('mjs-dpx-parent')
    await attendre(() => !!parent._shadow?.querySelector('mjs-dpx-enfant')?._shadow?.querySelector('.e'))
    window.µ.console(true)
    const bouton = racine().querySelector('[data-action="cibler"]')
    assert.ok(bouton, 'le bouton « cibler » est dans le bandeau')
    clic(bouton)
    assert.equal(racine().querySelector('[data-action="cibler"]').getAttribute('aria-pressed'), 'true', 'le mode cible est visible')

    let pageTouchee = false
    const cible = parent._shadow.querySelector('mjs-dpx-enfant')._shadow.querySelector('.e')
    cible.addEventListener('click', () => { pageTouchee = true })
    cible.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }))
    assert.match(racine().querySelector('.di-entete').textContent, /dpx-enfant/, 'le composant qui contient l’élément cliqué est sélectionné')
    assert.equal(pageTouchee, false, 'le clic de ciblage ne déclenche rien dans la page')
    assert.equal(racine().querySelector('[data-action="cibler"]').getAttribute('aria-pressed'), 'false', 'un clic suffit : le mode cible se referme')
  })

  it('bouton « cibler » : Échap annule la visée sans fermer le panneau', () => {
    window.document.body.innerHTML = '<mjs-dpx-parent></mjs-dpx-parent>'
    window.µ.console(true)
    clic(racine().querySelector('[data-action="cibler"]'))
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    assert.ok(racine(), 'le panneau reste ouvert')
    assert.equal(racine().querySelector('[data-action="cibler"]').getAttribute('aria-pressed'), 'false', 'la visée est annulée')
  })

  it('µconsole n’est pas une propriété énumérable de la fenêtre', () => {
    assert.equal(Object.keys(window).includes('µconsole'), false)
  })

  // un `µconsole` de `<script module>` s'exécute à l'import, AVANT le démarrage de l'appli : si
  // celle-ci remplace ensuite tout le `<body>`, le panneau part avec, et il doit se rouvrir au
  // prochain appel au lieu de se croire encore ouvert
  it('un panneau retiré de la page par l’application se rouvre au prochain appel', () => {
    window.µ.console(true)
    assert.ok(racine())
    window.document.body.innerHTML = '<p>appli</p>'
    assertAbsent(window.document.querySelector('[data-mjs-devpanel]'), 'le panneau est parti avec le body')
    assert.equal(window.µ.console(true), true)
    assert.ok(window.document.querySelector('[data-mjs-devpanel]'), 'µ.console(true) doit le réafficher')

    window.document.body.innerHTML = '<p>appli</p>'
    assert.equal(window.µ.console(), true, 'sans argument, µconsole ouvre : il n’y a plus rien à fermer')
    assert.ok(window.document.querySelector('[data-mjs-devpanel]'))

    window.document.body.innerHTML = '<p>appli</p>'
    window.eval('µconsole')
    assert.ok(window.document.querySelector('[data-mjs-devpanel]'), 'µconsole aussi')
  })
})

describe('µconsole — build de production', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  it('ne fait rien et ne plante pas : le panneau n’existe pas en production', async () => {
    const root   = mjsTmp('devpanel-bsc-prod')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'dpx-console.mjs'), COMPOSANTS['dpx-console'])
    writeFileSync(join(srcDir, 'dpx-enfant.mjs'), COMPOSANTS['dpx-enfant'])
    writeFileSync(join(srcDir, 'dpx-vise.mjs'), COMPOSANTS['dpx-vise'])
    writeFileSync(join(srcDir, 'dpx-vise-nu.mjs'), COMPOSANTS['dpx-vise-nu'])
    // fichier unique : cœur et composant dans un seul module, un seul `export{… as µ}`
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', js: 'bundle' })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const code = readFileSync(join(root, 'bundle.js'), 'utf-8')
      .replace(/export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+(?:µ|\\u00B5)\s*\};?/, 'globalThis.µ = $1;')
      .replace(/import\.meta\.url/g, "'http://localhost/'")
    const window: any = new Window({ url: 'http://localhost/' })
    const erreurs: string[] = []
    window.addEventListener('error', (e: any) => erreurs.push(String(e?.message ?? e)))
    try {
      window.eval(code)
      window.document.body.innerHTML = '<mjs-dpx-vise></mjs-dpx-vise><mjs-dpx-vise-nu></mjs-dpx-vise-nu><mjs-dpx-console></mjs-dpx-console>'
      const el: any = window.document.body.querySelector('mjs-dpx-console')
      const rac  = () => el.shadowRoot ?? el._shadow
      await attendre(() => !!rac()?.querySelector('.k'))
      await new Promise((r) => setTimeout(r, 50))
      assert.ok(rac()?.querySelector('.k'), 'le composant s’affiche normalement')
      assertAbsent(window.document.querySelector('[data-mjs-devpanel]'), 'aucun panneau en production')
      assert.deepEqual(erreurs, [], 'aucune erreur')
    } finally {
      window.close?.()
    }
  })
})
