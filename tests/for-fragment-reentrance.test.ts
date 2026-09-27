// `{for}` posé dans le contenu PROJETÉ d'un composant (`<@porteur>{for …}…{end}</@porteur>`) :
// toutes les lignes doivent arriver, même quand l'insertion réveille un autre rendu de liste.
//
// Défaut : `_mjs_reconcileList` rassemblait les lignes neuves dans UN fragment partagé par tout
// le runtime (`µ._mjs_reusableFragment`), puis l'insérait. Sous happy-dom — le DOM du module de
// test — l'insertion déclenche `slotchange` de façon SYNCHRONE : le porteur y relit ses enfants
// et re-rend sa propre liste — en synchrone lui aussi dès qu'un texte du gabarit lit la même
// variable (`{$vus.length}`) — qui reprenait le MÊME fragment, encore plein des lignes de l'hôte,
// et les emportait dans son ombre. Seule la première ligne restait à sa place, sans une erreur.
// Correctif : le fragment est pris en exclusivité le temps de l'insertion ; un rendu réentrant en
// crée un autre.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const PORTEUR = [
  '<script>',
  '  $vus    = []',
  '  slotRef = null',
  '  compter = -> $vus = slotRef.assignedElements().map((b) -> b.textContent)',
  '  µmount ->',
  "    slotRef.addEventListener('slotchange', compter)",
  '</script>',
  '',
  '<em class="n">{$vus.length}</em><span class="jauge">{for v in $vus}<i>{v}</i>{end}</span>',
  '<slot @this=!{slotRef}></slot>',
].join('\n')

const HOTE = [
  '<script>',
  '  $items = []',
  "  @charger = -> $items = [{id: 1, n: 'A'}, {id: 2, n: 'B'}, {id: 3, n: 'C'}]",
  '</script>',
  '',
  '<@porteur>{for it in $items by id}<b>{it.n}</b>{end}</@porteur>',
  '<button class="charger" @click={@charger()}>charger</button>',
].join('\n')

describe('{for} dans le contenu projeté d\'un composant — toutes les lignes arrivent', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  it('liste vide puis remplie : les trois lignes dans le porteur, aucune aspirée dans son ombre', async () => {
    const root   = mjsTmp('for-reentrance')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'porteur.mjs'), PORTEUR)
    writeFileSync(join(srcDir, 'hotefrag.mjs'), HOTE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

    const files = readdirSync(outDir)
    const pick  = (re: RegExp) => files.find((f) => re.test(f))!
    const code  = [pick(/^mjs_core-/), pick(/^porteur-/), pick(/^hotefrag-/)].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-hotefrag></mjs-hotefrag>'
    await new Promise((r) => setTimeout(r, 80))

    const hote    = window.document.body.querySelector('mjs-hotefrag')
    const porteur = hote._shadow.querySelector('mjs-porteur')
    hote._shadow.querySelector('.charger').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
    await new Promise((r) => setTimeout(r, 120))

    const projetees = Array.from(porteur.querySelectorAll(':scope > b')).map((b: any) => b.textContent)
    assert.deepEqual(projetees, [ 'A', 'B', 'C' ], 'les trois lignes de l\'hôte, dans l\'ordre, dans le contenu projeté')
    assert.equal(porteur._shadow.querySelectorAll('b').length, 0, 'aucune ligne de l\'hôte dans l\'ombre du porteur')
    const jauge = Array.from(porteur._shadow.querySelectorAll('.jauge i')).map((i: any) => i.textContent)
    assert.deepEqual(jauge, [ 'A', 'B', 'C' ], 'le porteur a bien vu ses trois enfants')
    assert.equal(porteur._shadow.querySelector('.n').textContent, '3')
    window.close?.()
  })
})
