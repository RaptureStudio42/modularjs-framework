// Test neuf — parser/index.ts : chaque référence à un module cœur (`<@@nom>` ou `<mjs-core-nom>`) rapporte ce que sa
// balise écrit : les NOMS de ses attributs, tels qu'écrits (quelle que soit la forme de la valeur), et la présence d'un
// étalement `{...p}`, et le TEXTE écrit de chaque attribut (`texts`, nul quand la valeur est calculée, vide quand l'attribut est écrit sans valeur). Le bundler y lit si un attribut est posé
// quelque part dans l'appli (Bundler.coreAttrWritten, testé dans bundler-coeur-attribut-ecrit.test.ts) et quels outils les barres de l'éditeur
// nomment (Bundler.coreToolShown, testé dans bundler-coeur-tri-editeur.test.ts). Les références au projet, elles, ne rapportent rien : leurs
// attributs n'intéressent personne au build.

import assert from 'node:assert/strict'
import { parse } from '../src/parser/index.js'
import type { TagRef, TagRefAttrs } from '../src/parser/index.js'

type Models = { dev?: Record<string, string[]>, core?: Record<string, string[]> }

function rawRefsOf(html: string, models?: Models): TagRef[] {
  const refs: TagRef[] = []
  parse(html, refs, { models })
  return refs
}

// les vérifications sur les noms et l'étalement ne lisent pas le texte de chaque attribut : il a ses propres essais plus bas
function refsOf(html: string, models?: Models): TagRef[] {
  return rawRefsOf(html, models).map((r) => r.attrs ? { ...r, attrs: { names: r.attrs.names, spread: r.attrs.spread } } : r)
}

function attrsOf(html: string): { names: string[], spread: boolean } | undefined {
  const a = fullAttrsOf(html)
  return a && { names: a.names, spread: a.spread }
}

function fullAttrsOf(html: string): TagRefAttrs | undefined {
  const refs = rawRefsOf(html)
  assert.equal(refs.length, 1, `une seule référence attendue (reçu : ${JSON.stringify(refs)})`)
  return refs[0].attrs
}

function textsOf(html: string): Record<string, string | null> | undefined {
  return fullAttrsOf(html)?.texts
}

describe('parser — attributs écrits sur une référence à un module cœur', () => {
  describe('toutes les formes d\'un attribut', () => {
    const FORMES: [string, string][] = [
      ['nu', '<@@select other></@@select>'],
      ['valeur entre guillemets doubles', '<@@select other="42"></@@select>'],
      ['valeur entre guillemets simples', '<@@select other=\'42\'></@@select>'],
      ['valeur sans guillemets', '<@@select other=42></@@select>'],
      ['expression {$x}', '<@@select other={$x}></@@select>'],
      ['liaison =!{$x}', '<@@select other=!{$x}></@@select>'],
      ['autofermante', '<@@select other/>'],
      ['autofermante, espace avant la barre', '<@@select other />'],
      ['balise littérale mjs-core-select', '<mjs-core-select other></mjs-core-select>'],
      ['balise littérale mjs-core-select, valeur', '<mjs-core-select other="42"></mjs-core-select>'],
    ]
    for (const [forme, html] of FORMES) {
      it(`${forme} : \`other\` est rapporté, sans étalement`, () => {
        assert.deepEqual(attrsOf(html), { names: ['other'], spread: false })
      })
    }

    it('la casse écrite est gardée (la comparaison se fait côté bundler)', () => {
      assert.deepEqual(attrsOf('<@@select Other></@@select>'), { names: ['Other'], spread: false })
    })
  })

  describe('plusieurs attributs', () => {
    it('tous les noms, dans l\'ordre où ils sont écrits, avec leurs formes mêlées', () => {
      const attrs = attrsOf('<@@select name="pays" multiple other={$x} placeholder=!{$p} other-label="Autre">x</@@select>')
      assert.deepEqual(attrs, { names: ['name', 'multiple', 'other', 'placeholder', 'other-label'], spread: false })
    })

    it('`other-label` et `other-placeholder` ne sont pas `other` : leurs noms sont rapportés tels quels', () => {
      const attrs = attrsOf('<@@select other-label="Autre" other-placeholder="Précisez"></@@select>')
      assert.deepEqual(attrs, { names: ['other-label', 'other-placeholder'], spread: false })
    })

    it('la valeur ne devient jamais un nom : `value="other"`, `name="other"`', () => {
      const attrs = attrsOf('<@@select name="other" value="other" title=\'other\'></@@select>')
      assert.deepEqual(attrs, { names: ['name', 'value', 'title'], spread: false })
    })

    it('un effet (`*fade`) et un attribut conditionnel (`@class{…}`) sont des noms comme les autres', () => {
      const attrs = attrsOf('<@@select *fade(duration: 1s) @class{$on}="x" other></@@select>')
      assert.ok(attrs)
      assert.ok(attrs.names.includes('*fade'))
      assert.ok(attrs.names.includes('other'))
      assert.equal(attrs.spread, false)
    })

    it('sur plusieurs lignes', () => {
      const attrs = attrsOf('<@@select\n  name="pays"\n  other\n  multiple\n></@@select>')
      assert.deepEqual(attrs, { names: ['name', 'other', 'multiple'], spread: false })
    })
  })

  describe('étalement', () => {
    it('`{...p}` seul : aucun nom, un étalement', () => {
      assert.deepEqual(attrsOf('<@@select {...p}></@@select>'), { names: [], spread: true })
    })

    it('`{...p}` et des attributs écrits : les deux', () => {
      assert.deepEqual(attrsOf('<@@select name="x" {...p} other></@@select>'), { names: ['name', 'other'], spread: true })
    })

    it('deux étalements : un seul indicateur', () => {
      assert.deepEqual(attrsOf('<@@select {...p} {...q}></@@select>'), { names: [], spread: true })
    })

    it('sur la balise littérale', () => {
      assert.deepEqual(attrsOf('<mjs-core-select {...p}></mjs-core-select>'), { names: [], spread: true })
    })

    it('une expression d\'étalement qui contient des accolades', () => {
      assert.deepEqual(attrsOf('<@@select {...{ other: true }}></@@select>'), { names: [], spread: true })
    })
  })

  describe('une référence sans attribut', () => {
    it('rapporte une liste vide (jamais « rien rapporté »)', () => {
      assert.deepEqual(attrsOf('<@@select></@@select>'), { names: [], spread: false })
      assert.deepEqual(attrsOf('<@@select/>'), { names: [], spread: false })
      assert.deepEqual(attrsOf('<mjs-core-select></mjs-core-select>'), { names: [], spread: false })
    })
  })

  describe('quelles références rapportent', () => {
    it('chaque référence a sa propre liste : deux listes dans le même gabarit', () => {
      const refs = refsOf('<@@select name="a"></@@select><@@select name="b" other></@@select>')
      assert.deepEqual(refs.map(r => r.attrs), [{ names: ['name'], spread: false }, { names: ['name', 'other'], spread: false }])
    })

    it('un autre module cœur rapporte aussi les siens (la référence porte son nom)', () => {
      const refs = refsOf('<@@field other></@@field>')
      assert.deepEqual(refs, [{ name: 'field', kind: 'raccourci-coeur', attrs: { names: ['other'], spread: false } }])
    })

    it('dans un {if}, un {for} : rapportés comme ailleurs', () => {
      const refs = refsOf('{if $a}<@@select other></@@select>{end}{for x in $xs}<@@select other="1"></@@select>{end}')
      assert.deepEqual(refs.map(r => r.attrs), [{ names: ['other'], spread: false }, { names: ['other'], spread: false }])
    })

    it('imbriqués : la liste est celle de SA balise, pas celle de la voisine ni de la parente', () => {
      const refs = refsOf('<@@select other><@@option value="a">a</@@option></@@select>')
      assert.deepEqual(refs.map(r => [r.name, r.attrs]), [['select', { names: ['other'], spread: false }], ['option', { names: ['value'], spread: false }]])
    })

    it('un composant du PROJET (`<@carte other>`, `<mjs-carte other>`) ne rapporte rien', () => {
      const refs = refsOf('<@carte other></@carte><mjs-carte other></mjs-carte><@select other></@select>')
      assert.deepEqual(refs, [
        { name: 'carte', kind: 'raccourci-dev' },
        { name: 'carte', kind: 'litteral-dev' },
        { name: 'select', kind: 'raccourci-dev' },
      ])
      for (const ref of refs) assert.equal('attrs' in ref, false)
    })

    it('l\'ancienne notation retirée (`<@mjs-select other>`) ne rapporte rien', () => {
      const refs = refsOf('<@mjs-select other></@mjs-select>')
      assert.deepEqual(refs, [{ name: 'select', kind: 'raccourci-mjs-retire' }])
    })

    it('une balise ordinaire (`<div other>`) n\'est pas une référence', () => {
      assert.deepEqual(refsOf('<div other></div><my-widget other></my-widget>'), [{ name: 'my-widget', kind: 'balise-nue' }], 'un élément personnalisé nu est relevé sans ses attributs')
    })

    it('`other` dans un texte, un commentaire, une valeur : aucune référence, ou aucun nom `other`', () => {
      assert.deepEqual(refsOf('<p>other</p><!-- <@@select other> -->'), [])
      const attrs = attrsOf('<@@select title="other">other</@@select>')
      assert.deepEqual(attrs, { names: ['title'], spread: false })
    })

    it('sans tableau de références (usage historique) : aucun crash', () => {
      assert.doesNotThrow(() => parse('<@@select other {...p}></@@select>'))
    })
  })

  describe('modèles en fichier (`select.compact.mjs`)', () => {
    const MODELES = { core: { select: ['compact'] } }

    it('`layout="compact"` choisit le modèle : la référence devient celle du modèle et garde ses attributs (`layout` compris)', () => {
      const refs = refsOf('<@@select layout="compact" other></@@select>', MODELES)
      assert.equal(refs.length, 1)
      assert.equal(refs[0].name, 'select--compact')
      assert.deepEqual(refs[0].attrs, { names: ['layout', 'other'], spread: false })
    })

    it('`layout={$v}` (modèle calculé) : la référence de base ET celle de chaque modèle reprennent les attributs', () => {
      const refs = refsOf('<@@select layout={$v} other></@@select>', MODELES)
      assert.deepEqual(refs.map(r => r.name), ['select', 'select--compact'])
      for (const ref of refs) assert.deepEqual(ref.attrs, { names: ['layout', 'other'], spread: false })
    })

    it('sans modèle choisi : la référence reste celle du module', () => {
      const refs = refsOf('<@@select other></@@select>', MODELES)
      assert.deepEqual(refs, [{ name: 'select', kind: 'raccourci-coeur', attrs: { names: ['other'], spread: false } }])
    })
  })

  describe('le texte écrit de chaque attribut (texts)', () => {
    it('une valeur écrite entre guillemets, simples ou sans guillemets : son texte', () => {
      assert.deepEqual(textsOf('<@@editor toolbar="bold italic"></@@editor>'), { toolbar: 'bold italic' })
      assert.deepEqual(textsOf('<@@editor toolbar=\'bold | link\'></@@editor>'), { toolbar: 'bold | link' })
      assert.deepEqual(textsOf('<@@editor toolbar=bold></@@editor>'), { toolbar: 'bold' })
    })

    it('une valeur vide est le texte vide', () => {
      assert.deepEqual(textsOf('<@@editor toolbar=""></@@editor>'), { toolbar: '' })
    })

    it('une valeur calculée : null (le build ne sait pas)', () => {
      assert.deepEqual(textsOf('<@@editor toolbar={$t}></@@editor>'), { toolbar: null })
      assert.deepEqual(textsOf('<@@editor toolbar=!{$t}></@@editor>'), { toolbar: null })
      assert.deepEqual(textsOf('<@@editor toolbar="bold {$t}"></@@editor>'), { toolbar: null })
    })

    it('un attribut écrit sans valeur : le texte vide, pas null (le build sait qu\'il est là, tel quel)', () => {
      assert.deepEqual(textsOf('<@@editor toolbar></@@editor>'), { toolbar: '' })
      assert.deepEqual(textsOf('<@@editor answer></@@editor>'), { answer: '' })
      assert.deepEqual(textsOf('<@@editor answer/>'), { answer: '' })
      assert.deepEqual(textsOf('<mjs-core-editor answer></mjs-core-editor>'), { answer: '' })
      assert.deepEqual(textsOf('<@@editor answer={$a}></@@editor>'), { answer: null }, 'calculé : toujours null')
    })

    it('une entité HTML dans la valeur : null (le navigateur la lit autrement que le texte écrit)', () => {
      assert.deepEqual(textsOf('<@@editor toolbar="bold&#32;italic"></@@editor>'), { toolbar: null })
    })

    it('les noms sont rangés en minuscules, comme le navigateur', () => {
      assert.deepEqual(textsOf('<@@editor TOOLBAR="bold"></@@editor>'), { toolbar: 'bold' })
    })

    it('chaque attribut a son texte, l\'étalement n\'en pose aucun', () => {
      assert.deepEqual(textsOf('<@@editor name="e" answer toolbar="bold" value=!{$v} {...$p}></@@editor>'), { name: 'e', answer: '', toolbar: 'bold', value: null })
    })

    it('la balise littérale mjs-core-editor rapporte aussi ses textes', () => {
      assert.deepEqual(textsOf('<mjs-core-editor toolbar="link"></mjs-core-editor>'), { toolbar: 'link' })
    })

    it('les références au projet ne rapportent toujours rien', () => {
      assert.equal(fullAttrsOf('<@editeur toolbar="bold"></@editeur>'), undefined)
    })
  })
})
