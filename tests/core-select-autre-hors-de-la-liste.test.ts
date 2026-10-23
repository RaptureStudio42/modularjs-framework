// <@@select other> : pendant la saisie de la réponse libre « Autre… », le champ et son bouton ✔ ne sont pas dans la liste — un
// `role="listbox"` ne contient que des options et des groupes, un lecteur d'écran n'y attend rien d'autre — : ils la suivent, dans le
// panneau. La saisie se valide toujours, et la ligne « Autre… » revient dans la liste à la réouverture.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $v = \'\'',
  '</script>',
  '<@@select class="s" name="g" other value=!{$v}><@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option></@@select>',
  '<p class="v">{$v}</p>',
].join('\n')

describe('mjs-core-select — le champ de la réponse libre hors de la liste', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('en saisie libre, `role="listbox"` ne contient ni champ ni bouton ; Entrée valide la réponse', async () => {
    const { window, hote } = await monterHote(HOTE, 'select-autre-hors-liste')
    const S = hote._shadow.querySelector('.s')._shadow
    S.querySelector('.select-btn').click()
    await attendre(() => !!S.querySelector('.select-other'))
    S.querySelector('.select-other').click()
    await attendre(() => !!S.querySelector('.select-other-input'))
    await pause(30)
    const liste = S.querySelector('[role="listbox"]')
    assert.ok(liste, 'la liste reste là')
    assert.deepEqual([...liste.querySelectorAll('input, button, textarea')].map((n: any) => n.tagName + '.' + n.className), [], 'aucun champ dans la liste')
    for (const n of [...liste.children] as any[]) assert.ok(['option', 'group', 'none'].includes(n.getAttribute('role')) || n.classList.contains('select-empty'), 'enfant de la liste : ' + n.outerHTML.slice(0, 80))
    const champ = S.querySelector('.select-other-input')
    assert.ok(S.querySelector('.select-panel').contains(champ), 'le champ reste dans le panneau')
    champ.value = 'Belgique'
    champ.dispatchEvent(new window.Event('input', { bubbles: true }))
    await pause(20)
    champ.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await attendre(() => hote._shadow.querySelector('.v').textContent === 'Belgique')
    assert.equal(hote._shadow.querySelector('.v').textContent, 'Belgique')
    S.querySelector('.select-btn').click()
    await attendre(() => !!S.querySelector('.select-other'))
    assert.ok(S.querySelector('[role="listbox"]').contains(S.querySelector('.select-other')), 'la ligne « Autre… » est une option de la liste')
    window.close()
  })
})
