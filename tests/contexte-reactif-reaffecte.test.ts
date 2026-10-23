// Contexte réactif `§§` réaffecté par son fournisseur (`§§theme = {c: 'blue'}`) : les consommateurs déjà montés
// suivent la nouvelle valeur. Avant, la réaffectation créait un objet réactif neuf ; les consommateurs restaient
// abonnés à l'ancien et gardaient l'ancienne valeur (seule la modification d'un champ, `§§theme.c = …`, passait).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const FOURNISSEUR = [
  '<script>',
  "§§theme = {c: 'red', n: 1}",
  'changer = ->',
  "  §§theme = {c: 'blue'}",
  'muter = ->',
  "  §§theme.c = 'green'",
  '</script>',
  '<mjs-tst-crr-conso></mjs-tst-crr-conso>',
  '<button class="changer" @click={changer()}>changer</button>',
  '<button class="muter" @click={muter()}>muter</button>',
].join('\n')

const CONSO = '<p class="c">{§§theme.c}</p><p class="n">{§§theme.n}</p>\n'

function projetTemporaire(): string {
  const root   = mjsTmp('contexte-reactif-reaffecte')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'tst-crr-fournisseur.mjs'), FOURNISSEUR)
  writeFileSync(join(srcDir, 'tst-crr-conso.mjs'), CONSO)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('§§ — réaffecter un contexte réactif prévient les consommateurs déjà montés', function () {
  this.timeout(60000)

  let app: any

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('réaffectation puis modification d\'un champ : le consommateur suit les deux', async () => {
    const f = await app.mount('tst-crr-fournisseur')
    await pause(30)
    const conso = f.find('mjs-tst-crr-conso')
    const lire = (sel: string) => conso._shadow.querySelector(sel).textContent
    assert.equal(lire('.c'), 'red')
    assert.equal(lire('.n'), '1')

    await f.click('.changer')
    await pause(30)
    assert.equal(lire('.c'), 'blue', 'la réaffectation atteint le consommateur')
    assert.equal(lire('.n'), '', 'un champ absent de la nouvelle valeur ne s\'affiche plus')

    await f.click('.muter')
    await pause(30)
    assert.equal(lire('.c'), 'green', 'une modification après la réaffectation passe toujours')
    f.destroy()
  })
})
