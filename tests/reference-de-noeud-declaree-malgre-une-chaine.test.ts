// référence de nœud `:this=!{nom}` à variable nue : sa déclaration est posée dès que la racine du script ne déclare pas ce nom, même
// quand le texte du script porte le mot ailleurs — dans une chaîne (`'let the champ rest'`) ou comme variable d'une de ses fonctions ;
// vraie construction (Bundler) puis rendu (happy-dom) : le premier rendu ne lève pas « champ is not defined » et le clic lit le champ
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendreEgal } from './helpers/attendre.js'
import { monterHote } from './helpers/coeur-monter.js'

const GABARIT = '<label>x <input :this=!{champ}></label>\n<button @click={$vu = champ.tagName}>{aide}</button>\n<p class="vu">{$vu}</p>\n'

// monte l'hôte, clique le bouton : le texte du paragraphe lit alors la balise que vise la référence
async function cliquer(script: string, prefixe: string): Promise<void> {
  const { hote, erreurs } = await monterHote(`<script>\n${script}\n</script>\n${GABARIT}`, prefixe)
  assert.deepEqual(Array.from(erreurs), [], 'aucune erreur au montage')   // tableau de la fenêtre happy-dom, recopié en tableau de Node
  const ombre = hote._shadow
  assert.equal(ombre.querySelector('p.vu')?.textContent.trim(), 'rien', 'premier rendu fait')
  ombre.querySelector('button').click()
  await attendreEgal(() => ombre.querySelector('p.vu')?.textContent.trim(), 'INPUT', 'le clic lit la balise visée par la référence', 5000)
}

describe('référence de nœud — déclarée quand la racine du script ne la déclare pas', function () {
  this.timeout(60_000)
  after(async () => { await terminateSharedWorkerPool() })

  it('une chaîne du script qui porte « let champ » : premier rendu fait, le clic lit le champ', async () => {
    await cliquer("aide := 'let the champ rest'\n$vu = 'rien'", 'ref-chaine')
  })

  it('une variable du même nom dans une fonction du script : même chose', async () => {
    await cliquer("aide := 'ok'\n$vu = 'rien'\ncompte := ->\n  champ := 2\n  champ + 1", 'ref-locale')
  })

  it('garde : un champ que la racine du script déclare n\'est pas déclaré une seconde fois', async () => {
    await cliquer("aide := 'ok'\n$vu = 'rien'\nchamp .= null", 'ref-racine')
  })
})
