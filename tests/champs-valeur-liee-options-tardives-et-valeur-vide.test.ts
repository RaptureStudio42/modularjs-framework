// Valeur liée d'un champ de formulaire. Défauts garantis absents :
// - `<select value={$val}>` dont les `<option>` arrivent APRÈS la valeur (liste chargée ensuite)
//   affichait la première option, pas `$val` : la valeur liée n'était jamais réappliquée ;
// - `<input value={$x}>` avec `$x` non défini (ou `null`) affichait le texte « undefined » / « null »
//   dans le champ — un champ vide est attendu, comme pour le texte `{$x}`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PAYS = [
  '<script>',
  "  $val = 'b'",
  '  $opts = []',
  '  charge = ->',
  "    $opts = ['a', 'b', 'c']",
  '</script>',
  '<select class="s" aria-label="pays" value={$val}>{for o in $opts}<option value={o}>{o}</option>{end}</select>',
  '<button class="c" @click={charge()}>c</button>',
  "<button class=\"v\" @click={$val = 'c'}>v</button>",
].join('\n')

const VIDE = [
  '<script>',
  '  $u = undefined',
  '  $z = null',
  '  remplit = ->',
  "    $u = 'x'",
  '  vide = ->',
  '    $u = undefined',
  '</script>',
  '<input class="u" aria-label="u" value={$u}>',
  '<input class="z" aria-label="z" value={$z}>',
  '<textarea class="t" aria-label="t" value={$u}></textarea>',
  '<button class="r" @click={remplit()}>r</button>',
  '<button class="d" @click={vide()}>d</button>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('valeur-liee')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'vl-pays.mjs'), PAYS)
  writeFileSync(join(srcDir, 'vl-vide.mjs'), VIDE)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('valeur liée — <select> aux options tardives, champ à valeur absente', function () {
  this.timeout(180000)

  let app: any

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('<select value={$val}> : les options chargées après la valeur affichent la valeur liée', async () => {
    const c = await app.mount('vl-pays')
    try {
      await c.click('.c')
      const s = c.find('.s')
      assert.equal(s.options.length, 3, 'les trois options sont là')
      assert.equal(s.value, 'b', 'la valeur liée est choisie, pas la première option')
      await c.click('.v')
      assert.equal(s.value, 'c', 'un changement de la valeur liée suit toujours')
    } finally {
      c.destroy()
    }
  })

  it('<input value={undefined}> / {null} : champ vide, jamais le texte « undefined » ou « null »', async () => {
    const c = await app.mount('vl-vide')
    try {
      assert.equal(c.find('.u').value, '', 'undefined → champ vide')
      assert.equal(c.find('.z').value, '', 'null → champ vide')
      assert.equal(c.find('.t').value, '', 'undefined dans un <textarea> → vide')
      await c.click('.r')
      assert.equal(c.find('.u').value, 'x', 'la valeur posée s\'affiche')
      await c.click('.d')
      assert.equal(c.find('.u').value, '', 'remise à undefined → champ vidé')
    } finally {
      c.destroy()
    }
  })
})
