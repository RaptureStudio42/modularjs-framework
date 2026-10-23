// Attributs qui mêlent texte et `{…}`, et contenu d'une branche `{await}` construit élément par élément :
// le rendu doit être celui du même HTML lu par le navigateur.
//
// Défauts garantis absents :
// - `title="Total {$n + ' $US'}"` affichait « Total 5 ${$.US} » : le raccourci `$mot` du texte réécrivait
//   aussi l'intérieur des `{…}` ;
// - `title="clics : {µ$$count.value}"` (singleton importé, forme documentée) ne se construisait pas ;
// - dans une branche `{await}`, `&amp;`, `&nbsp;`, `&eacute;`… restaient en clair dans le texte, et seules six
//   entités nommées étaient décodées dans les attributs ;
// - dans cette même branche, `placeholder`, `name`, `value` statiques étaient posés en propriété : aucun attribut
//   sur une `<div>`, et un `<input value="init">` sans valeur par défaut (`form.reset()` le vidait).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMixedString, decodeHtmlEntities } from '../src/generator/utils.js'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const FICHIERS: Record<string, string[]> = {
  'am-mixte.mjs': [
    '<script>',
    '$n = 5',
    '</script>',
    '<p class="t" title="Total {$n + \' $US\'}">x</p>',
    '<p class="r" title="n=$n fin">y</p>',
  ],
  'am-singleton.mjs': [
    "@import µ$$amCompte 'am-partage.module.civet'",
    '',
    '<p class="t" title="clics : {µ$$amCompte.value}">{µ$$amCompte.value}</p>',
  ],
  'am-partage.module.civet': ['export µ$$amCompte = { value: 3 }'],
  'am-await.mjs': [
    '<script>',
    '$n = 1',
    "$p = Promise.resolve({ x: 'ok' })",
    '</script>',
    '<p class="e2">Tom &amp; Jerry&nbsp;: {$n}</p>',
    '<div class="w">{await $p}<i>attente</i>{success v}<p class="e">Tom &amp; Jerry&nbsp;: {v.x} &eacute;t&eacute; &#36;&#123;z&#125; &#96;</p>'
      + '<form class="f"><input class="i" value="init"></form>'
      + '<div class="d" placeholder="Tapez" name="nm" title="caf&eacute; &laquo;x&raquo; 5&euro;">z</div>'
      + '<textarea class="ta">a &amp; b</textarea>{end}</div>',
  ],
}

function projetTemporaire(): string {
  const root   = mjsTmp('attributs-mixtes')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, lignes] of Object.entries(FICHIERS)) writeFileSync(join(srcDir, nom), lignes.join('\n'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('attributs mixtes et branches {await} — même rendu que le HTML lu par le navigateur', () => {
  describe('construction', () => {
    it('le raccourci `$mot` ne s\'applique qu\'au texte de l\'attribut, jamais à l\'intérieur des `{…}`', () => {
      assert.equal(parseMixedString("Total {$n + ' $US'}", []), "`Total ${$.n + ' $US'}`")
      assert.equal(parseMixedString('v: {$imp} fin', ['$imp']), '`v: ${$imp} fin`')
      assert.equal(parseMixedString('v: $n et $$t fin', []), '`v: ${$.n} et ${µ.store.t} fin`')
    })
    it('les entités nommées du standard HTML sont décodées, pas seulement six', () => {
      assert.equal(decodeHtmlEntities('caf&eacute; &laquo;x&raquo; 5&euro; &amp; &nbsp;&hellip;&NotEqualTilde;'), 'café «x» 5€ &  …≂̸')
      assert.equal(decodeHtmlEntities('a &inconnu; b & c &#233;'), 'a &inconnu; b & c é')
    })
  })

  describe('composants montés', function () {
    this.timeout(90000)
    let app: any
    let root = ''

    before(async () => {
      root = projetTemporaire()
      app  = await createHarness({ root })
    })
    after(async () => { if (app) await app.destroy() })

    it('`title="Total {$n + \' $US\'}"` affiche « Total 5 $US » ; le raccourci du texte marche toujours', async () => {
      const c = await app.mount('am-mixte')
      try {
        assert.equal(c.find('.t').getAttribute('title'), 'Total 5 $US')
        assert.equal(c.find('.r').getAttribute('title'), 'n=5 fin')
      }
      finally { c.destroy() }
    })

    it('`title="clics : {µ$$amCompte.value}"` se construit, la valeur lue comme dans le texte', () => {
      const fichier = readdirSync(join(root, 'out')).find((f) => /^am-singleton-.*\.js$/.test(f))
      assert.ok(fichier, 'module du composant introuvable')
      const code = readFileSync(join(root, 'out', fichier!), 'utf8')
      assert.ok(code.includes('`clics : ${$amCompte.value}`'), 'attribut émis : ' + (code.match(/clics[^;]*/)?.[0] ?? '?'))
    })

    it('une branche `{await}` décode les entités du texte et des attributs, et pose les attributs statiques', async () => {
      const c = await app.mount('am-await')
      try {
        for (let k = 0; k < 5 && !c.find('.e'); k++) await c.tick()
        assert.equal(c.text('.e2'), 'Tom & Jerry : 1')
        assert.equal(c.text('.e'), 'Tom & Jerry : ok été ${z} `')
        const champ = c.find('.i')
        assert.equal(champ.getAttribute('value'), 'init')
        assert.equal(champ.defaultValue, 'init')
        assert.equal(champ.value, 'init')
        champ.value = 'tapé'
        c.find('.f').reset()
        assert.equal(champ.value, 'init', '`form.reset()` remet la valeur écrite dans le gabarit')
        const d = c.find('.d')
        assert.equal(d.getAttribute('placeholder'), 'Tapez')
        assert.equal(d.getAttribute('name'), 'nm')
        assert.equal(d.getAttribute('title'), 'café «x» 5€')
        assert.equal(c.find('.ta').value, 'a & b')
      }
      finally { c.destroy() }
    })
  })
})
