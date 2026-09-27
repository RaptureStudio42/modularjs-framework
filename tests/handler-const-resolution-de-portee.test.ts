// GARDE du gestionnaire d'événement qui réaffecte une constante : elle cherchait le NOM dans
// le texte brut du gestionnaire, sans résoudre les portées. Deux conséquences, l'une et l'autre
// mesurées :
//   — refus À TORT dès qu'une déclaration LOCALE du gestionnaire portait le même nom que la
//     constante (`@click={() => { let compteur = 1; compteur = 5 }}`) : le JavaScript produit est
//     légal, rien ne plantait ;
//   — fuite sur les constantes du `<script module>`, absentes de la liste contrôlée : la
//     réaffectation compilait et levait « Assignment to constant variable » au premier clic ;
//   — cible DÉSTRUCTURÉE jamais vue (`[compteur] = [1]`, `({ compteur } = …)`) : le motif
//     exigeait le nom collé à l'opérateur.
// Le contrôle passe désormais par la résolution de portée du JavaScript compilé, seul juge
// commun aux deux chemins (gestionnaires et `<script>`).

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

describe('gestionnaires — réaffectation d’une constante tranchée par résolution de portée', function () {
  describe('ACCEPTÉS — la constante est masquée par une liaison locale du gestionnaire', function () {
    it('variable locale homonyme', async function () {
      await transpile(
        "<script>\n  compteur := 0\n</script>\n<button @click={() => { let compteur = 1; compteur = 5 }}>{compteur}</button>\n",
        { moduleName: 'card' },
      )
    })

    it('paramètre homonyme', async function () {
      await transpile(
        "<script>\n  compteur := 0\n</script>\n<button @click={(compteur) => { compteur = 5 }}>{compteur}</button>\n",
        { moduleName: 'card' },
      )
    })

    it('comparaison, jamais une affectation', async function () {
      await transpile(
        "<script>\n  compteur := 0\n</script>\n<button @click={() => { compteur === 5 }}>{compteur}</button>\n",
        { moduleName: 'card' },
      )
    })
  })

  describe('REFUSÉS — la constante est bien celle qui est écrite', function () {
    it('constante du <script>', async function () {
      await assert.rejects(
        () => transpile("<script>\n  compteur := 0\n</script>\n<button @click={compteur = 5}>{compteur}</button>\n", { moduleName: 'card' }),
        /déclaré CONSTANT/,
      )
    })

    it('constante du <script module>', async function () {
      await assert.rejects(
        () => transpile("<script module>\n  compteur := 0\n</script>\n<button @click={compteur = 5}>{compteur}</button>\n", { moduleName: 'card' }),
        /déclaré CONSTANT/,
      )
    })

    it('constante du <script module>, opérateur composé', async function () {
      await assert.rejects(
        () => transpile("<script module>\n  compteur := 0\n</script>\n<button @click={compteur += 1}>{compteur}</button>\n", { moduleName: 'card' }),
        /déclaré CONSTANT/,
      )
    })

    it('cible déstructurée, tableau', async function () {
      await assert.rejects(
        () => transpile("<script>\n  compteur := 0\n</script>\n<button @click={() => { let x = 1; [compteur] = [1] }}>{compteur}</button>\n", { moduleName: 'card' }),
        /déclaré CONSTANT/,
      )
    })

    it('cible déstructurée, objet', async function () {
      await assert.rejects(
        () => transpile("<script>\n  compteur := 0\n</script>\n<button @click={() => { let x = 1; ({ compteur } = window.z) }}>{compteur}</button>\n", { moduleName: 'card' }),
        /déclaré CONSTANT/,
      )
    })
  })
})
