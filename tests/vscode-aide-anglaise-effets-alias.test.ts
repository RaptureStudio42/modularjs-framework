// L'extension VS Code : en anglais, ce que fait un effet et ce qu'on voit d'un alias livré s'écrivent en anglais. Les phrases françaises
// viennent du chapitre 38 de la doc ; les anglaises, des fiches du site du framework, recopiées dans editors/vscode/effects-help-en.json
// (script/vscode-effects.mjs --site) puis dans effects.json (`help_en`) : la construction de l'extension ne lit jamais le site. Un effet ou
// un alias que le site ne décrit pas garde sa phrase française dans l'aide anglaise, et l'aide française ne change pas. L'aide est du
// Markdown : une balise ou un effet cité dans une phrase anglaise s'écrit entre accents graves, sinon VS Code effacerait la balise

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI     = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const help    = require('../editors/vscode/effects-help.js')
const donnees = (fichier: string) => JSON.parse(readFileSync(join(ICI, '../editors/vscode', fichier), 'utf-8'))
const FR      = { lang: 'fr' }
const EN      = { lang: 'en' }

// chaque effet et chaque alias livré, avec sa fiche d'effects.json
function fiches(): Array<[string, { help: string, help_en?: string }]> {
  const effets = donnees('effects.json')
  const out: Array<[string, { help: string, help_en?: string }]> = []
  for (const [nom, fx] of Object.entries<any>(effets)) {
    out.push([nom, fx])
    for (const [alias, a] of Object.entries<any>(fx.aliases ?? {})) out.push([nom + '.' + alias, a])
  }
  return out
}

describe('extension VS Code — l\'aide anglaise des effets et des alias', () => {
  it('les textes anglais recopiés du site nomment des effets et des alias livrés, et effects.json les porte', () => {
    const anglais = donnees('effects-help-en.json')
    const parNom  = new Map(fiches())
    assert.ok(Object.keys(anglais).length > 250, 'les textes anglais sont recopiés')
    assert.deepEqual(Object.keys(anglais).filter((n) => !parNom.has(n)), [], 'un texte anglais nomme un effet ou un alias livré')
    assert.deepEqual(Object.keys(anglais), [...Object.keys(anglais)].sort(), 'rangés par nom')
    for (const [nom, texte] of Object.entries<string>(anglais)) assert.equal(parNom.get(nom)!.help_en, texte, nom)
    assert.deepEqual(fiches().filter(([nom, f]) => f.help_en !== undefined && !(nom in anglais)).map(([nom]) => nom), [])
  })

  it('au survol et à la complétion, en anglais : la phrase anglaise ; en français : la phrase française, seule', () => {
    const glitch = donnees('effects.json').glitch
    assert.match(glitch.help_en, /^The title glitches in bursts/)
    const ligne = '<h1 *glitch>Titre</h1>'
    assert.ok(help.hover(ligne, ligne.indexOf('glitch') + 2, EN).includes(glitch.help_en))
    assert.ok(!help.hover(ligne, ligne.indexOf('glitch') + 2, EN).includes(glitch.help))
    assert.ok(help.hover(ligne, ligne.indexOf('glitch') + 2, FR).includes(glitch.help))
    assert.ok(!help.hover(ligne, ligne.indexOf('glitch') + 2, FR).includes(glitch.help_en))
    assert.equal(help.suggest('<h1 *gli', EN).find((s: any) => s.label === 'glitch').detail, 'Text — ' + glitch.help_en)
    assert.equal(help.suggest('<h1 *gli', FR).find((s: any) => s.label === 'glitch').detail, 'Texte — ' + glitch.help)
    const lampe = donnees('effects.json').longshadow.aliases.lamp
    assert.ok(lampe.help_en && help.hover('<h1 *longshadow.lamp>', 6, EN).includes(lampe.help_en))
    assert.equal(help.suggest('<h1 *longshadow.', EN).find((s: any) => s.label === 'lamp').detail, lampe.help_en)
    assert.equal(help.suggest('<h1 *longshadow.', FR).find((s: any) => s.label === 'lamp').detail, lampe.help)
  })

  it('chaque effet et chaque alias : sa phrase anglaise en anglais, sa phrase française sinon ; jamais l\'anglaise en français', () => {
    let repli = 0
    for (const [nom, f] of fiches()) {
      const en = help.effectHelp(nom, EN)
      const fr = help.effectHelp(nom, FR)
      if (f.help) assert.ok(fr.includes(f.help), nom)
      if (f.help_en) {
        assert.ok(en.includes(f.help_en), nom)
        assert.ok(!fr.includes(f.help_en), nom)
      }
      else {
        repli++
        if (f.help) assert.ok(en.includes(f.help), nom + ' : sans texte anglais, la phrase française')
      }
    }
    assert.ok(repli > 0 && repli < 20, 'quelques effets ou alias seulement restent en français : ' + repli)
  })

  it('une phrase anglaise est du Markdown : ses balises et ses effets cités sont entre accents graves', () => {
    const anglais = donnees('effects-help-en.json')
    for (const [nom, texte] of Object.entries<string>(anglais)) {
      const horsCode = texte.replace(/`[^`]*`/g, '')
      assert.doesNotMatch(horsCode, /<[^<>\s][^<>]*>/, nom)
      assert.doesNotMatch(horsCode, /\*[a-z]/, nom)
    }
    assert.match(anglais.path, /`<path>`/)
    assert.match(anglais['particles.aura'], /`\*neon`/)
  })
})
