// Modules cœur : spécificité CSS des styles internes (blindage anti-collision avec
// le CSS ambiant adopté dans le shadow). Lecture STATIQUE des 6 fichiers source, aucun build
// ni navigateur : vérifie que plus aucun sélecteur n'est enveloppé de :where(...) (spécificité
// nulle), que les 3 interrupteurs renforcent .native en input.native (0,1,1 — gagne à égalité
// contre input[type=checkbox]/input[type=radio] du site, la feuille du module étant adoptée
// en dernier), et que les part= exposés (support de ::part()) et les variables --mjs-* n'ont
// pas bougé pendant l'opération (comptes figés, anti-suppression accidentelle). La vraie
// preuve visuelle (fond calculé du bouton) reste au navigateur, hors périmètre de ce test.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CORE_DIR  = join(__dirname, '..', 'src', 'core-modules')

const MODULES = ['select', 'option', 'field', 'checkbox', 'radio', 'switch']
const TOGGLES = ['checkbox', 'radio', 'switch']

// comptes figés à l'état sain (select : +3 var — max-height clampé (1) et fond
// sticky de la recherche repris sur --mjs-select-panel-bg/--mjs-surface, déjà nesté ailleurs (2) ;
// checkbox : tiret indeterminate, cf. commentaires en bout de ligne) :
// select 4/31, option 0/0, field 7/8, checkbox 3/18, radio 3/11, switch 3/31
const PART_COUNT: Record<string, number>          = { select: 6, option: 0, field: 7, checkbox: 3, radio: 3, switch: 3 } // select : +2 (réponse libre : la ligne « Autre… » et le champ) ; field : +2 (look float — la pastille et le libellé flottant)
const VAR_COUNT: Record<string, number>           = { select: 50, option: 0, field: 8, checkbox: 18, radio: 11, switch: 31 } // select : +7 (sticky : l'option choisie colle sous la recherche, --mjs-select-search-h, et son fond plein se pose sur celui du panneau) ; select : +9 (réponse libre : le filet, le champ et son bouton de validation) ; select : +1 (--mjs-select-max, plafond de largeur de la jauge) ; select : +1 (--mjs-select-panel-left, place horizontale du panneau d'une liste other) ; select : +1 (--mjs-select-placeholder, couleur du texte d'attente) ; checkbox : +3 (indeterminate — .dash + input.native:indeterminate ~ .box), +4 (chaque usage lit son défaut : accent et bordure en cascade sur --mjs-accent/--mjs-border, anneau de focus réglable) ; field : +2 (look float, fond et pastille) ; switch : +12 (look triangle, couleurs du triangle et des libellés), +3 (idem checkbox : défauts lus à l'usage, anneau de focus) ; radio : +2 (idem)
const INPUT_NATIVE_COUNT: Record<string, number>  = { checkbox: 7, radio: 3, switch: 5 } // checkbox : +1 (input.native:indeterminate ~ .box), +3 (look glow : la piste, son état indéterminé et son état coché) ; switch : +2 (look triangle, idem)

function read(name: string): string {
  return readFileSync(join(CORE_DIR, `${name}.mjs`), 'utf-8')
}

function count(source: string, re: RegExp): number {
  return (source.match(re) || []).length
}

describe('core-modules — spécificité CSS des styles internes', () => {
  describe('aucun sélecteur enveloppé de :where( (spécificité nulle abandonnée)', () => {
    for (const name of MODULES) {
      it(`${name}.mjs ne contient aucun :where(`, () => {
        assert.doesNotMatch(read(name), /:where\(/)
      })
    }
  })

  describe('checkbox/radio/switch — .native renforcé en input.native (0,1,1 contre input[type] du site)', () => {
    for (const name of TOGGLES) {
      it(`${name}.mjs : aucun .native nu (toujours préfixé input)`, () => {
        assert.doesNotMatch(read(name), /(?<!input)\.native\b/)
      })

      it(`${name}.mjs : input.native présent exactement ${INPUT_NATIVE_COUNT[name]} fois (base, :checked${name === 'checkbox' ? ', :indeterminate' : ''}, :focus-visible)`, () => {
        const source = read(name)
        assert.equal(count(source, /input\.native\b/g), INPUT_NATIVE_COUNT[name])
        assert.match(source, /^\s*input\.native\s*$/m)
        assert.match(source, /input\.native:checked ~ /)
        if(name === 'checkbox') assert.match(source, /input\.native:indeterminate ~ /)
        assert.match(source, /input\.native:focus-visible ~ /)
      })
    }
  })

  describe('part= exposés et variables --mjs-* intacts (comptes exacts, anti-suppression accidentelle)', () => {
    for (const name of MODULES) {
      it(`${name}.mjs : ${PART_COUNT[name]} part= et ${VAR_COUNT[name]} var(--mjs-`, () => {
        const source = read(name)
        assert.equal(count(source, /part="/g), PART_COUNT[name])
        assert.equal(count(source, /var\(--mjs-/g), VAR_COUNT[name])
      })
    }
  })
})
