// module cœur field (<@@field layout="float">) autour d'une liste de choix (<@@select>) ou d'un éditeur (<@@editor>) : ni l'un ni l'autre ne
// porte de propriété `value`, le champ lit leur état. Une option choisie, au moins un choix d'une liste multiple, un éditeur qui a du texte :
// le libellé monte au-dessus (il restait couché sur « France », et sur la barre d'outils de l'éditeur) ; sans valeur, il reste couché ; une
// valeur posée par la page (liaison), sans aucun geste, le fait monter aussi.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, pause } from './helpers/coeur-monter.js'
import { monter } from './helpers/editeur-riche.js'

const HOTE = [
  '<script>',
  '  $pays  = \'\'',
  '  $texte = \'\'',
  '</script>',
  '<@@field class="choisi" layout="float" label="Pays"><@@select name="p1" value="fr"><@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option></@@select></@@field>',
  '<@@field class="aucun" layout="float" label="Pays"><@@select name="p2"><@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option></@@select></@@field>',
  '<@@field class="multi" layout="float" label="Langues"><@@select name="l1" multiple value={[\'fr\']}><@@option value="fr">Français</@@option><@@option value="en">Anglais</@@option></@@select></@@field>',
  '<@@field class="multiVide" layout="float" label="Langues"><@@select name="l2" multiple value={[]}><@@option value="fr">Français</@@option><@@option value="en">Anglais</@@option></@@select></@@field>',
  '<@@field class="lie" layout="float" label="Pays"><@@select name="p3" value=!{$pays}><@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option></@@select></@@field>',
  '<@@field class="redige" layout="float" label="Message"><@@editor name="m1" value="<p>Bonjour</p>"></@@editor></@@field>',
  '<@@field class="blanc" layout="float" label="Message"><@@editor name="m2"></@@editor></@@field>',
  '<@@field class="ecrit" layout="float" label="Message"><@@editor name="m3" value=!{$texte}></@@editor></@@field>',
  '<button id="b" @click={$pays = \'de\'; $texte = \'<p>Salut</p>\'}>poser</button>',
].join('\n')

describe('mjs-core-field — libellé flottant d\'une liste de choix et d\'un éditeur', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('option choisie, choix multiple non vide, éditeur rédigé : rempli ; sans valeur : couché ; une liaison le fait monter sans geste', async () => {
    const { window, hote } = await monter(HOTE, 'field-liste-editeur')
    const rempli = (sel: string) => hote._shadow.querySelector(sel)._shadow.querySelector('.field').classList.contains('filled')
    await attendre(() => !!hote._shadow.querySelector('.redige mjs-core-editor')?._shadow?.querySelector('.surface p'))
    await pause(60)
    const vu = Object.fromEntries(['choisi', 'aucun', 'multi', 'multiVide', 'lie', 'redige', 'blanc', 'ecrit'].map((c) => [c, rempli('.' + c)]))
    assert.deepEqual(vu, { choisi: true, aucun: false, multi: true, multiVide: false, lie: false, redige: true, blanc: false, ecrit: false })
    hote._shadow.querySelector('#b').click()
    await attendre(() => !!hote._shadow.querySelector('.ecrit mjs-core-editor')?._shadow?.querySelector('.surface')?.textContent.includes('Salut'))
    await pause(60)
    assert.equal(rempli('.lie'), true, 'liste passée de vide à « de » par la liaison')
    assert.equal(rempli('.ecrit'), true, 'éditeur rempli par la liaison')
    window.close()
  })
})
