// La liaison à deux sens d'un champ (`value=!{$n}`) ignore le pas incomplet d'un champ nombre
// (« 1. », « - » : le navigateur ne rend alors pas de valeur, `validity.badInput` est vrai) au lieu
// de le convertir en 0 : la garde est émise dans le gestionnaire du champ, en Civet comme en
// JavaScript (`templateLang: 'js'`), et nulle part ailleurs (une case à cocher n'en a pas).
// Aucun champ n'a de gestionnaire de SORTIE (`change`, `focusout`) : une saisie refusée reste dans le champ à la
// sortie, comme dans un champ natif, et seule une écriture du code la remplace. Le texte lu en nombre
// (`value.number`, `.int`, `.float`) ne met jamais NaN dans le modèle.
// Le comportement lui-même se voit dans un vrai navigateur : champ-nombre-frappe-browser.test.ts et
// champ-nombre-sortie-et-vidage-browser.test.ts.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const SRC = `<script>
  $n  = 0
  $ok = false
  $s  = ''
</script>

<input aria-label="n" type="number" value=!{$n}>
<input aria-label="ok" type="checkbox" checked=!{$ok}>
<input aria-label="s" type="text" value.number=!{$s}>
`

/** les gestionnaires inline seuls, un par liaison, dans l'ordre du gabarit */
async function gestionnaires(templateLang: 'civet' | 'js'): Promise<string[]> {
  const { output } = await transpile(SRC, { moduleName: 'card', templateLang } as any)
  const debut = output.indexOf('_mjs_inline = [')
  assert.ok(debut > 0, 'aucun gestionnaire inline dans la sortie')
  const fin = output.indexOf('this._mjs_dir', debut)
  return output.slice(debut, fin > 0 ? fin : undefined).split(/\n\s*\(_mjs_e,\s*_mjs_el\) => \{/).slice(1)
}

for (const templateLang of ['civet', 'js'] as const) {
  describe(`liaison à deux sens d'un champ — garde du pas incomplet (gabarit ${templateLang})`, function () {
    this.timeout(60000)

    it('les liaisons value ont la garde, avant la conversion', async () => {
      const [nombre, , texte] = await gestionnaires(templateLang)
      for (const [nom, corps] of [['value=!{$n}', nombre], ['value.number=!{$s}', texte]]) {
        assert.match(corps, /_mjs_el\.type\s*={2,3}\s*'number'/, `${nom} : la garde regarde le type du champ`)
        assert.match(corps, /badInput/, `${nom} : la garde lit validity.badInput`)
        assert.ok(corps.indexOf('badInput') < corps.indexOf('Number(_mjs_el.value)'), `${nom} : la garde passe avant la conversion en nombre`)
        assert.ok(corps.indexOf('badInput') < corps.indexOf('_set('), `${nom} : la garde passe avant l'écriture du modèle`)
      }
    })

    it('la case à cocher n\'en a pas', async () => {
      const [, case_] = await gestionnaires(templateLang)
      assert.doesNotMatch(case_, /badInput/)
      assert.match(case_, /_mjs_el\.checked/)
    })

    it('le champ nombre n\'a pas de gestionnaire de sortie : une saisie refusée n\'est jamais remplacée à la sortie', async () => {
      const gestionnairesChamp = await gestionnaires(templateLang)
      assert.equal(gestionnairesChamp.length, 3, 'un gestionnaire par liaison, pas de gestionnaire de sortie')
      assert.ok(!gestionnairesChamp.some(g => /focusout/.test(g)), 'aucun ne regarde focusout')
      assert.ok(!gestionnairesChamp.some(g => /_mjs_el\.value\s*=[^=]/.test(g)), 'aucun n\'écrit dans le champ')
    })

    it('le texte lu en nombre (value.number) ne met pas NaN dans le modèle ; le champ nombre sans conversion n\'en a pas besoin', async () => {
      const [nombre, , texte] = await gestionnaires(templateLang)
      assert.match(texte, /Number\.isNaN\(_mjs_val\)/, 'le texte lu en nombre ignore ce qui n\'en est pas un')
      assert.ok(texte.indexOf('Number.isNaN') < texte.indexOf('_set('), 'et le contrôle passe avant l\'écriture du modèle')
      assert.doesNotMatch(nombre, /isNaN/, 'un champ nombre rend toujours un nombre ou une chaîne vide (lue 0)')
    })

    it('aucune route focusout ; seule la case à cocher écoute change, le champ nombre et le champ texte n\'écoutent que la frappe', async () => {
      const { output } = await transpile(SRC, { moduleName: 'card', templateLang } as any)
      const routes = JSON.parse(/(\{"input":\{[^\n]*?\})\);/.exec(output)![1])
      const [nombre, texte] = Object.keys(routes.input)
      assert.equal(routes.focusout, undefined, 'pas de route focusout')
      assert.ok(!(nombre in (routes.change ?? {})), 'le champ nombre n\'écoute que la frappe')
      assert.ok(!(texte in (routes.change ?? {})), 'le champ texte n\'écoute que la frappe')
      assert.equal(Object.keys(routes.change ?? {}).length, 1, 'change : la case à cocher seule')
    })
  })
}
