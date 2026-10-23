// `@class{$x is item.key}` dans un {for} : quand $x change, seules l'ancienne et la nouvelle ligne
// sont touchées (le reste de la liste n'est pas relu) — le moteur retient la valeur précédente de
// $x pour savoir quelle ligne éteindre. Le défaut : sous un {if}, tant que la liste était cachée,
// ce souvenir n'avançait plus. $x changé pendant qu'elle était cachée, la liste réaffichée, au choix
// suivant c'était la mauvaise ligne qu'on éteignait : l'ancien choix restait allumé à côté du
// nouveau. Même mécanique, même défaut, pour un attribut filtré (`aria-selected={$x is item.key}`).
// Le style filtré (`@style.color={item.key is $x ? 'red' : ''}`) avait en plus son index figé sur
// les lignes d'origine : la liste reconstruite par le {if}, plus aucun choix ne se voyait.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CHOIX = [
  '<script>',
  '$vu = true',
  '$x = \'a\'',
  '$liste = [{ key: \'a\' }, { key: \'b\' }, { key: \'c\' }]',
  '</script>',
  '<button class="v" @click={$vu = !$vu}>v</button>',
  '<button class="sb" @click={$x = \'b\'}>b</button>',
  '{if $vu}',
  '  <ul>',
  '    {for item in $liste}',
  '      <li><button data-k={item.key} @class{$x is item.key}="on" aria-selected={$x is item.key} @click={$x = item.key}>{item.key}</button></li>',
  '    {end}',
  '  </ul>',
  '{else}',
  '  <p>caché</p>',
  '{end}',
].join('\n')

const COULEUR = [
  '<script>',
  '$vu = true',
  '$x = \'a\'',
  '$liste = [{ key: \'a\' }, { key: \'b\' }, { key: \'c\' }]',
  '</script>',
  '<button class="v" @click={$vu = !$vu}>v</button>',
  '<button class="sb" @click={$x = \'b\'}>b</button>',
  '{if $vu}',
  '  <ul>',
  '    {for item in $liste}',
  '      <li><button data-k={item.key} @style.color={item.key is $x ? \'red\' : \'\'} @click={$x = item.key}>{item.key}</button></li>',
  '    {end}',
  '  </ul>',
  '{end}',
].join('\n')

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('{for} sous {if} — la sélection filtrée suit le choix, même changé pendant que la liste est cachée', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('for-selection-filtree-sous-if')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'choix.mjs'), CHOIX)
    writeFileSync(join(srcDir, 'couleur.mjs'), COULEUR)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('cachée, $x change ; réaffichée, puis un autre choix : une seule ligne allumée', async () => {
    window.document.body.innerHTML = '<mjs-choix></mjs-choix>'
    const comp = window.document.querySelector('mjs-choix')
    await attendre(() => !!comp._shadow?.querySelector('[data-k=a]'))
    const clic = async (sel: string) => {
      comp._shadow.querySelector(sel).click()
      await new Promise((r) => setTimeout(r, 20))
    }
    const allumes = (): string => [...comp._shadow.querySelectorAll('li button')].filter((b: any) => b.classList.contains('on')).map((b: any) => b.textContent).join(',')
    const choisis = (): string => [...comp._shadow.querySelectorAll('li button')].filter((b: any) => b.getAttribute('aria-selected') === 'true').map((b: any) => b.textContent).join(',')
    assert.equal(allumes(), 'a')
    await clic('.v')
    await clic('.sb')
    await clic('.v')
    assert.equal(allumes(), 'b', 'réaffichée : le choix fait pendant qu\'elle était cachée')
    await clic('[data-k=c]')
    assert.equal(allumes(), 'c', 'l\'ancien choix s\'éteint')
    assert.equal(choisis(), 'c', 'aria-selected suit de même')
  })

  it('style filtré : la liste cachée puis réaffichée, chaque choix colore sa ligne et seulement elle', async () => {
    window.document.body.innerHTML = '<mjs-couleur></mjs-couleur>'
    const comp = window.document.querySelector('mjs-couleur')
    await attendre(() => !!comp._shadow?.querySelector('[data-k=a]'))
    const clic = async (sel: string) => {
      comp._shadow.querySelector(sel).click()
      await new Promise((r) => setTimeout(r, 20))
    }
    const colores = (): string => [...comp._shadow.querySelectorAll('li button')].filter((b: any) => b.style.color === 'red').map((b: any) => b.textContent).join(',')
    assert.equal(colores(), 'a')
    await clic('.v')
    await clic('.v')
    await clic('[data-k=c]')
    assert.equal(colores(), 'c', 'après un aller-retour du {if}')
    await clic('.v')
    await clic('.sb')
    await clic('.v')
    assert.equal(colores(), 'b', 'le choix fait pendant qu\'elle était cachée')
    await clic('[data-k=a]')
    assert.equal(colores(), 'a', 'l\'ancien choix s\'éteint')
  })
})
