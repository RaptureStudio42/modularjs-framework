// Gestionnaires d'événement et `<script>` : un setter de contexte suivi d'un `if` postfixe, et un commentaire
// `#` qui contient une apostrophe, doivent se construire et faire ce que la ligne écrite dit.
//
// Défauts garantis absents :
// - `@click={§theme = 'dark' if $sombre}` (et `§§…`, et `if $ok then §x = 1 else §x = 2`, dans un gestionnaire
//   comme dans le `<script>`) ne se construisait pas : le `if` (ou le `else`) était avalé dans l'appel émis ;
// - une apostrophe dans un commentaire `#` d'un gestionnaire sur plusieurs lignes (`# c'est tout`) faisait
//   refuser la construction (« chaîne non fermée »).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanJs } from '../src/generator/utils.js'
import { tokenize } from '../src/lexer/index.js'
import { transpile } from '../src/transpiler/index.js'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

function contexte(sombre: boolean): string[] {
  return [
    '<script>',
    `$sombre = ${sombre}`,
    "§theme = 'light'",
    "§mode = 'aucun'",
    "§mode = 'script' if $sombre",
    "if $sombre then §bord = 'oui' else §bord = 'non'",
    '</script>',
    "<button class=\"b\" @click={§theme = 'dark' if $sombre}>x</button>",
    "<button class=\"b2\" @click={if $sombre then §theme = 'un' else §theme = 'deux'}>y</button>",
  ]
}

const COMMENTAIRES = [
  '<script>',
  '$n = 0',
  '$m = 0',
  '</script>',
  '<p class="v">{$n}|{$m}</p>',
  '<button class="b" @click={',
  "  # l'élément cliqué",
  '  $n++',
  '}>a</button>',
  '<button class="b2" @click={',
  "  $m += 1 # c'est tout",
  '}>b</button>',
]

function projetTemporaire(): string {
  const root   = mjsTmp('gestionnaires-contexte')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'gc-sombre.mjs'), contexte(true).join('\n'))
  writeFileSync(join(srcDir, 'gc-clair.mjs'), contexte(false).join('\n'))
  writeFileSync(join(srcDir, 'gc-commentaires.mjs'), COMMENTAIRES.join('\n'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('gestionnaires — setter de contexte suivi d\'un `if`, commentaire `#` avec apostrophe', () => {
  describe('construction', () => {
    it('le `if`/`unless` postfixe et le `then`/`else` qui englobent un setter restent hors de l\'appel émis', () => {
      assert.equal(cleanJs("§theme = 'dark' if $sombre", []), "this._mjs_setContext('theme', 'dark') if $.sombre")
      assert.equal(cleanJs("§§lang = 'fr' if $ok", []), "this._mjs_setRCtx('lang', 'fr') if $.ok")
      assert.equal(cleanJs('if $ok then §x = 1 else §x = 2', []), "if $.ok then this._mjs_setContext('x', 1) else this._mjs_setContext('x', 2)")
    })
    it('un `if … then … else …` écrit comme valeur reste entier, comme une valeur sans mot-clé', () => {
      assert.equal(cleanJs('§x = if $a then 1 else 2', []), "this._mjs_setContext('x', if $.a then 1 else 2)")
      assert.equal(cleanJs("§§lang = 'fr'", []), "this._mjs_setRCtx('lang', 'fr')")
      assert.equal(cleanJs('§x = f(if $a then 1 else 2) + 1', []), "this._mjs_setContext('x', f(if $.a then 1 else 2) + 1)")
    })
    it('dans le `<script>`, même découpe', () => {
      assert.match(tokenize("§theme = 'dark' if $sombre"), /_mjsThis\._mjs_setContext\('theme', 'dark'\) if \$\.sombre/)
      assert.match(tokenize('if $ok then §x = 1 else §x = 2'), /_mjsThis\._mjs_setContext\('x', 1\) else _mjsThis\._mjs_setContext\('x', 2\)/)
    })
    it('un gestionnaire sur plusieurs lignes dont un commentaire `#` porte une apostrophe se construit', async () => {
      await transpile(COMMENTAIRES.join('\n'), { moduleName: 'gc-commentaires' })
    })
  })

  describe('composants montés', function () {
    this.timeout(90000)
    let app: any

    before(async () => { app = await createHarness({ root: projetTemporaire() }) })
    after(async () => { if (app) await app.destroy() })

    it('`$sombre` vrai : chaque setter pose sa valeur', async () => {
      const c = await app.mount('gc-sombre')
      try {
        assert.equal(c.el._mjs_getContext('mode'), 'script')
        assert.equal(c.el._mjs_getContext('bord'), 'oui')
        await c.click('.b')
        assert.equal(c.el._mjs_getContext('theme'), 'dark')
        await c.click('.b2')
        assert.equal(c.el._mjs_getContext('theme'), 'un')
      }
      finally { c.destroy() }
    })

    it('`$sombre` faux : le `if` postfixe laisse le contexte inchangé, le `else` pose le sien', async () => {
      const c = await app.mount('gc-clair')
      try {
        assert.equal(c.el._mjs_getContext('mode'), 'aucun')
        assert.equal(c.el._mjs_getContext('bord'), 'non')
        await c.click('.b')
        assert.equal(c.el._mjs_getContext('theme'), 'light')
        await c.click('.b2')
        assert.equal(c.el._mjs_getContext('theme'), 'deux')
      }
      finally { c.destroy() }
    })

    it('les deux gestionnaires commentés marchent : 1|1', async () => {
      const c = await app.mount('gc-commentaires')
      try {
        await c.click('.b')
        await c.click('.b2')
        assert.equal(c.text('.v'), '1|1')
      }
      finally { c.destroy() }
    })
  })
})
