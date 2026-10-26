// `<@failed err reset>` reçoit la valeur jetée telle quelle. Une valeur vide (`throw null`, `throw undefined`, une
// promesse rejetée sans raison) faisait échouer le repli qui lit `{err.message}`, la forme documentée : l'erreur du
// repli tombait sur le bandeau fatal, et `reset` n'était plus proposé. Le repli reçoit désormais, pour une valeur vide,
// une Error dont le message nomme cette valeur ; les autres valeurs (texte, Symbol, nombre, objet sans prototype)
// arrivent telles quelles, et le bandeau fatal d'un composant sans frontière les affiche toutes sans lever.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SCRIPT = [
  '<script>',
  "$genre = ''",
  '$boom = false',
  "valeurs = {null: null, undefined: undefined, texte: 'texte', symbole: Symbol('s'), nu: Object.create(null), nombre: 42}",
  'jette = -> throw valeurs[$genre]',
  '</script>',
  '{if $boom}<i>{jette()}</i>{end}',
  '<button class="boom" @click={$boom = true}>boom</button>',
].join('\n')

const SOURCES: Record<string, string> = {
  'tst-fnx-lit.mjs': SCRIPT + '\n<@failed err reset>\n  <p class="msg">repli : {err.message}</p>\n  <button class="reset" @click={reset()}>reset</button>\n</@failed>\n',
  'tst-fnx-nu.mjs': SCRIPT + '\n',
  'tst-fnx-haut.mjs': '<script>\n$genre = \'\'\n</script>\n<mjs-tst-fnx-nu genre={$genre}></mjs-tst-fnx-nu>\n<@failed err reset>\n  <p class="msg">repli du parent : {err.message}</p>\n</@failed>\n',
  'tst-fnx-page.mjs': '<script>\n$genre = \'\'\n</script>\n<mjs-tst-fnx-lit genre={$genre}></mjs-tst-fnx-lit><mjs-tst-fnx-nu genre={$genre}></mjs-tst-fnx-nu><mjs-tst-fnx-haut genre={$genre}></mjs-tst-fnx-haut>\n',
}

function projet(): string {
  const root   = mjsTmp('failed-non-error')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('<@failed> — une valeur jetée qui n\'est pas une Error', function () {
  this.timeout(60000)
  let app: any
  const journal: string[] = []

  before(async () => {
    app = await createHarness({ root: projet() })
    app.window.console.error = (...a: any[]) => journal.push(a.map((x) => { try { return String(x && x.message !== undefined ? x.message : x) } catch { return '?' } }).join(' '))
    app.window.addEventListener('error', (e: any) => journal.push('non rattrapée : ' + (e.error?.message ?? e.message)))
  })

  after(async () => { if (app) await app.destroy() })

  // repli de l'enfant, bandeau fatal du composant sans frontière, repli du parent qui reçoit l'erreur remontée
  async function planter(genre: string): Promise<{ lit: string; reset: boolean; nu: string; haut: string }> {
    journal.length = 0
    const p = await app.mount('tst-fnx-page', { genre })
    await pause(30)
    const lit  = p.find('mjs-tst-fnx-lit')._shadow
    const nu   = p.find('mjs-tst-fnx-nu')._shadow
    const haut = p.find('mjs-tst-fnx-haut')._shadow
    lit.querySelector('.boom').click()
    nu.querySelector('.boom').click()
    haut.querySelector('mjs-tst-fnx-nu')._shadow.querySelector('.boom').click()
    await pause(40)
    const res = {
      lit: lit.querySelector('.msg')?.textContent ?? lit.querySelector('.mjs-fatal-error')?.textContent ?? '(rien)',
      reset: lit.querySelector('.reset') !== null,
      nu: nu.querySelector('.mjs-fatal-error')?.textContent ?? '(rien)',
      haut: haut.querySelector('.msg')?.textContent ?? haut.querySelector('.mjs-fatal-error')?.textContent ?? '(rien)',
    }
    p.destroy()
    return res
  }

  for (const [genre, texte] of [['null', 'null'], ['undefined', 'undefined']]) {
    it(`throw ${genre} : le repli qui lit err.message s'affiche, avec son reset`, async () => {
      const r = await planter(genre)
      assert.equal(r.lit, `repli : ${texte}`)
      assert.equal(r.reset, true, 'reset est proposé')
      assert.equal(r.haut, `repli du parent : ${texte}`, 'la frontière d\'un ancêtre aussi')
      assert.equal(r.nu, `Fatal Error: ${texte}`)
      assert.deepEqual(journal.filter((l) => !l.includes('Crash intercepted')), [], 'aucune erreur du repli, rien de non rattrapé')
    })
  }

  for (const [genre, fatal] of [['texte', 'Fatal Error: texte'], ['symbole', 'Fatal Error: Symbol(s)'], ['nu', 'Fatal Error'], ['nombre', 'Fatal Error: 42']]) {
    it(`throw ${genre} : la valeur arrive telle quelle, rien ne lève`, async () => {
      const r = await planter(genre)
      assert.equal(r.lit, 'repli : undefined', 'err est la valeur jetée, sans message')
      assert.equal(r.reset, true)
      assert.equal(r.nu, fatal)
      assert.deepEqual(journal.filter((l) => !l.includes('Crash intercepted')), [])
    })
  }
})
