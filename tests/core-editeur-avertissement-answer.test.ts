// Éditeur de texte riche du cœur, en développement : un script qui pose `answer` sur un éditeur alors qu'aucune page de l'application n'écrit cet attribut reçoit un
// avertissement, une seule fois, comme `other` de <@@select>. La production retire le mode « répondre » quand aucune page ne l'écrit : l'éditeur y serait resté figé
// sans ses lignes à cocher. Joué dans happy-dom, avec le vrai Bundler en construction de développement.
// - aucune page n'écrit `answer`, un script le donne à un éditeur : un avertissement, une seule fois même pour deux éditeurs ;
// - rien tant que personne ne donne `answer`, et rien quand le script le donne à « false » (l'éditeur reste en saisie) ;
// - une page écrit `answer` sur un éditeur (même sur un autre) : la production garde le mode, aucun avertissement ;
// - le texte est celui de la table des messages (groupe dev), avec le préfixe [ModularJS], au vouvoiement.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monter } from './helpers/editeur-riche.js'

const SCRIPT = '<script>\n  $v = \'<p>x</p>\'\n</script>\n'
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('éditeur riche : answer posé par un script (happy-dom, développement)', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  // les éditeurs de la page, montés (leur surface existe) ; les avertissements recueillis au lieu d'aller à la console
  async function ouvrir(prefixe: string, balises: string) {
    const { hote, avertissements } = await monter(SCRIPT + balises, prefixe)
    const classes = Array.from(balises.matchAll(/class="(\w+)"/g)).map((m) => m[1])
    await attendre(() => classes.every((c) => !!hote._shadow.querySelector('.' + c)?._shadow?.querySelector('.surface')), 10000)
    const editeur = (c: string): any => hote._shadow.querySelector('.' + c)
    const dits    = (): string[] => Array.from(avertissements as string[]).filter((a) => a.includes('answer'))
    return { editeur, dits }
  }

  it('aucune page n\'écrit answer et un script le donne à un éditeur : un avertissement, une seule fois même pour deux éditeurs', async () => {
    const { editeur, dits } = await ouvrir('editeur-answer-script', '<@@editor class="a" name="a" value={$v}></@@editor><@@editor class="b" name="b" value={$v}></@@editor>')
    assert.deepEqual(dits(), [], 'rien tant que personne ne donne answer')
    editeur('a').setAttribute('answer', '')
    await pause(200)
    editeur('b').setAttribute('answer', '')
    await pause(200)
    assert.equal(dits().length, 1, dits().join('\n'))
    assert.match(dits()[0], /^\[ModularJS\] <@@editor> : un éditeur reçoit « answer » d'un script/)
    assert.match(dits()[0], /Écrivez/)
  })

  it('le script donne answer à « false » : l\'éditeur reste en saisie, aucun avertissement', async () => {
    const { editeur, dits } = await ouvrir('editeur-answer-faux', '<@@editor class="a" name="a" value={$v}></@@editor>')
    editeur('a').setAttribute('answer', 'false')
    await pause(200)
    assert.deepEqual(dits(), [])
  })

  it('une page écrit answer sur un éditeur : aucun avertissement quand un script le donne à un autre', async () => {
    const { editeur, dits } = await ouvrir('editeur-answer-ecrit', '<@@editor class="a" name="a" answer value={$v}></@@editor><@@editor class="b" name="b" value={$v}></@@editor>')
    editeur('b').setAttribute('answer', '')
    await pause(200)
    assert.deepEqual(dits(), [])
  })

  it('personne ne donne answer : aucun avertissement', async () => {
    const { dits } = await ouvrir('editeur-answer-aucun', '<@@editor class="a" name="a" value={$v}></@@editor>')
    await pause(200)
    assert.deepEqual(dits(), [])
  })
})
