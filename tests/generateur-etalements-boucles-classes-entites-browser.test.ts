// Les mêmes montages que generateur-etalements-boucles-classes-entites.test.ts et effets-deux-exemplaires-et-ecran-apres-garde-fou.test.ts,
// dans Chromium réel (build de développement) : deux étalements qui posent la même clé, valeur fixe rendue par un étalement,
// `{for}` sur une Map et un Set lu par un gestionnaire, bascules de classe qui partagent une classe, entités d'un attribut mêlé,
// deux exemplaires d'un reffet qui alignent une clé du store sur leur propre valeur.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'deux-etalements.mjs': [
    '<script>',
    '$a = { title: "A", "data-a": "1" }',
    '$b = { title: "B" }',
    '</script>',
    '<div class="d" {...$a} {...$b}>d</div>',
    '<button class="perd" @click={$a = { "data-a": "2" }}>1</button>',
    '<button class="a3" @click={$a = { title: "A3" }}>2</button>',
    '<button class="bvide" @click={$b = {}}>3</button>',
  ].join('\n'),
  'etalement-statique.mjs': [
    '<script>',
    '$o = { title: "dyn", class: "k" }',
    '</script>',
    '<div title="caf&eacute;" class="st" {...$o}>d</div>',
    '<button class="vide" @click={$o = {}}>1</button>',
  ].join('\n'),
  'boucle-map-set.mjs': [
    '<script>',
    '$m = new Map([["x", 1], ["y", 2]])',
    '$s = new Set(["p", "q"])',
    '</script>',
    '{for k, v in $m}<button class="m{k}" @click={globalThis.__m = [k, v]}>{v[0]}</button>{end}',
    '{for i, v in $s}<button class="s{i}" @click={globalThis.__s = [i, v]}>{v}</button>{end}',
  ].join('\n'),
  'classes-partagees.mjs': [
    '<script>',
    '$a = true',
    '$b = false',
    '</script>',
    '<p class="q" @class{$a}="on" @class{$b}="on big">q</p>',
    '<button class="bvrai" @click={$b = true}>1</button>',
    '<button class="bfaux" @click={$b = false}>2</button>',
  ].join('\n'),
  'entites-mixtes.mjs': [
    '<script>',
    '$x = "ok"',
    '$p = Promise.resolve({ x: "ok" })',
    '</script>',
    '<p class="m1" title="caf&eacute; {$x}">1</p>',
    '{await $p}<i>attente</i>{success v}<p class="m2" title="caf&eacute; {v.x}">2</p>{end}',
  ].join('\n'),
  'sync-un.mjs': [
    '<script>',
    '$f = "x"',
    'µeffect ->',
    '  globalThis.__passes = (globalThis.__passes ?? 0) + 1',
    '  $$filtre = $f if $$filtre != $f',
    '</script>',
    '<p class="f">{$f}:{$$filtre}</p>',
  ].join('\n'),
  'sync-deux.mjs': '<mjs-sync-un class="i1" f="a"></mjs-sync-un><mjs-sync-un class="i2" f="b"></mjs-sync-un>',
}

describe('générateur et reffets du store — montage dans Chromium réel', function () {
  this.timeout(180000)
  let browser: any
  let present = false
  let cible: Cible

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`'); return }
    cible   = await construire('dev-parents-avant', SOURCES, [])
    browser = await playwright.chromium.launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // ouvre le composant, attend son montage, joue `code` dans la page (`r` : son ombre, `pause()`), rend sa valeur ; aucune erreur de page admise
  const jouer = async (balise: string, code: string): Promise<any> => {
    const o = await charger(browser, cible, balise)
    try {
      await o.page.waitForFunction(`(() => { const h = document.querySelector('${balise}'); return h && h._mjs_is_mounted && h._shadow })()`, null, { timeout: 5000 })
      const valeur = await o.page.evaluate(`(async () => { const r = document.querySelector('${balise}')._shadow; const pause = (ms = 60) => new Promise((f) => setTimeout(f, ms)); await pause(); ${code} })()`)
      assert.deepEqual(graves(o), [])
      return { valeur, avis: o.avis }
    }
    finally {
      await o.fermer()
    }
  }
  const ATTRS = 'const at = (el) => Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value]));'

  it('deux étalements qui posent la même clé : le dernier qui la pose gagne, retirée seulement quand aucun ne la pose plus', async function () {
    if (!present) { this.skip(); return }
    const { valeur } = await jouer('mjs-deux-etalements', `${ATTRS} const d = r.querySelector('.d'); const v = [at(d)];
      r.querySelector('.perd').click(); await pause(); v.push(at(d)); r.querySelector('.a3').click(); await pause(); v.push(at(d)); r.querySelector('.bvide').click(); await pause(); v.push(at(d)); return v`)
    assert.deepEqual(valeur, [
      { class: 'd', title: 'B', 'data-a': '1' },
      { class: 'd', title: 'B', 'data-a': '2' },
      { class: 'd', title: 'B' },
      { class: 'd', title: 'A3' },
    ])
  })

  it('une clé retirée par un étalement remet la valeur fixe écrite par l\'auteur', async function () {
    if (!present) { this.skip(); return }
    const { valeur } = await jouer('mjs-etalement-statique', `${ATTRS} const d = r.querySelector('div'); const v = [at(d)]; r.querySelector('.vide').click(); await pause(); v.push(at(d)); return v`)
    assert.deepEqual(valeur, [{ title: 'dyn', class: 'k' }, { title: 'café', class: 'st' }])
  })

  it('{for} sur une Map et un Set : le gestionnaire de la ligne reçoit sa valeur', async function () {
    if (!present) { this.skip(); return }
    const { valeur } = await jouer('mjs-boucle-map-set', `r.querySelector('.m1').click(); r.querySelector('.s1').click(); await pause(); return [globalThis.__m, globalThis.__s]`)
    assert.deepEqual(valeur, [[1, ['y', 2]], [1, 'q']])
  })

  it('bascules qui partagent une classe : présente si l\'une des bascules qui la contiennent est vraie', async function () {
    if (!present) { this.skip(); return }
    const { valeur } = await jouer('mjs-classes-partagees', `const p = r.querySelector('.q'); const v = [p.className]; r.querySelector('.bvrai').click(); await pause(); v.push(p.className); r.querySelector('.bfaux').click(); await pause(); v.push(p.className); return v`)
    assert.deepEqual(valeur, ['q on', 'q on big', 'q on'])
  })

  it('attribut mêlé : entités des parties fixes décodées, à la racine et dans une branche {await}', async function () {
    if (!present) { this.skip(); return }
    const { valeur } = await jouer('mjs-entites-mixtes', `await pause(150); return [r.querySelector('.m1').title, r.querySelector('.m2') && r.querySelector('.m2').title]`)
    assert.deepEqual(valeur, ['café ok', 'café ok'])
  })

  it('deux exemplaires alignent une clé du store sur leur propre valeur : un passage chacun, aucune boucle, les écrans suivent le store', async function () {
    if (!present) { this.skip(); return }
    const { valeur, avis } = await jouer('mjs-sync-deux', `await pause(300); return { passes: globalThis.__passes, store: µ.store.filtre, ecrans: Array.from(r.querySelectorAll('mjs-sync-un')).map((k) => k._shadow.querySelector('.f').textContent) }`)
    assert.deepEqual(valeur, { passes: 2, store: 'b', ecrans: ['a:b', 'b:b'] })
    assert.deepEqual(avis.filter((a) => /Boucle réactive/.test(a)), [])
  })
})
