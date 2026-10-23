// module cœur select (<@@select>) : `disabled` le désactive comme un <select disabled> natif — le bouton ne prend ni le focus ni le clic,
// la liste ne s'ouvre ni à la souris ni au clavier, le choix ne change pas, sa valeur ne part pas avec le formulaire, son aspect est grisé ;
// l'attribut suit sa variable (une liste ouverte qu'on désactive se ferme) ; disabled="false" laisse la liste active, comme pour les cases

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const MODULE = join(dirname(fileURLToPath(import.meta.url)), '../src/core-modules/select.mjs')

const HOTE = [
  '<script>',
  '  $off = true',
  '</script>',
  '<form class="f">',
  '  <@@select class="s1" name="pays" value="fr" disabled><@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option></@@select>',
  '  <@@select class="s2" name="ville" value="a" disabled={$off}><@@option value="a">A</@@option><@@option value="b">B</@@option></@@select>',
  '  <@@select class="s3" name="z" value="a" disabled="false"><@@option value="a">A</@@option></@@select>',
  '</form>',
  '<button class="bascule" @click={$off = not $off}>bascule</button>',
].join('\n')

describe('mjs-core-select — disabled, comme un <select disabled> natif', function () {
  this.timeout(60000)
  let window: any
  let hote: any
  let erreurs: string[]
  before(async () => { ({ window, hote, erreurs } = await monterHote(HOTE, 'select-desactive')) })
  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const liste   = (c: string) => hote._shadow.querySelector('.' + c)
  const bouton  = (c: string) => liste(c)._shadow.querySelector('.select-btn')
  const ouvert  = (c: string) => !!liste(c)._shadow.querySelector('.select-panel')
  const champs  = () => [...new window.FormData(hote._shadow.querySelector('.f')).entries()].map(([k, v]: any) => k + '=' + v)
  const bascule = async () => {
    hote._shadow.querySelector('.bascule').click()
    await pause(80)
  }

  it('disabled : bouton désactivé, la liste ne s\'ouvre ni au clic ni au clavier, le choix ne bouge pas, rien dans le formulaire', async () => {
    assert.equal(bouton('s1').disabled, true, 'le bouton est désactivé : ni focus ni clic')
    bouton('s1').click()
    await pause(40)
    assert.equal(ouvert('s1'), false, 'un clic n\'ouvre pas la liste')
    for (const key of ['ArrowDown', 'Enter', ' ', 'ArrowRight']) {
      bouton('s1').dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      await pause(20)
    }
    assert.equal(ouvert('s1'), false, 'le clavier n\'ouvre pas la liste')
    assert.equal(liste('s1')._state.value, 'fr', 'la flèche droite ne change pas le choix')
    assert.ok(!champs().some((c) => c.startsWith('pays=')), 'la valeur ne part pas : ' + champs().join(' '))
  })

  it('l\'attribut suit sa variable : réactivée, la liste s\'ouvre et sa valeur part ; désactivée ouverte, elle se ferme et sa valeur ne part plus', async () => {
    assert.equal(bouton('s2').disabled, true)
    assert.ok(!champs().some((c) => c.startsWith('ville=')), champs().join(' '))
    await bascule()
    assert.equal(bouton('s2').disabled, false, 'réactivée, le bouton reprend')
    assert.ok(champs().includes('ville=a'), 'réactivée, la valeur part : ' + champs().join(' '))
    bouton('s2').click()
    await pause(40)
    assert.equal(ouvert('s2'), true, 'réactivée, la liste s\'ouvre')
    await bascule()
    assert.equal(ouvert('s2'), false, 'désactivée pendant qu\'elle est ouverte, la liste se ferme')
    assert.equal(bouton('s2').disabled, true)
    assert.ok(!champs().some((c) => c.startsWith('ville=')), 'désactivée, la valeur ne part plus : ' + champs().join(' '))
  })

  it('disabled="false" : la liste reste active, sa valeur part, aucune erreur', () => {
    assert.equal(bouton('s3').disabled, false)
    assert.ok(champs().includes('z=a'), champs().join(' '))
    assert.equal(erreurs.length, 0, erreurs.join(' | '))
  })

  it('aspect : le bouton désactivé a son style (grisé, sans main), et le survol ne l\'éclaire pas', () => {
    const style = readFileSync(MODULE, 'utf-8').split('<style')[1]
    const btn   = /\n  \.select-btn\n([\s\S]*?)\n  \.select-label\n/.exec(style)?.[1] ?? ''
    assert.match(btn, /&:disabled\n\s+opacity: [.\d]+\n\s+cursor: default/, 'une règle :disabled sur le bouton')
    assert.match(btn, /&:hover:not\(:disabled\)/, 'le survol n\'éclaire que le bouton actif')
  })
})
