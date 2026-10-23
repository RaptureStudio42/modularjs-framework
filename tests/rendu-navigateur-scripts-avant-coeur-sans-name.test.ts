// le rendu par navigateur (src/server/render-browser.ts) pose dans chaque page, AVANT le cœur, des scripts passés à `context.addInitScript` :
// Playwright les envoie en texte (le source de la fonction), seuls. Sous tsx (esbuild et son `keepNames`), une fonction NOMMÉE dans leur corps
// devient `__name(function …, 'nom')`, un appel que la page ne connaît pas : le script s'arrêtait là (`__name is not defined`), et l'oubli du
// texte d'une feuille retouchée (`insertRule`, `deleteRule`, `replace`) n'était jamais posé. Chaque fonction passée à `addInitScript`, compilée
// comme tsx la compile, tourne seule dans un contexte vide et fait son travail.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const ICI    = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(ICI, '../src/server/render-browser.ts'), 'utf-8')
const NOMS   = [...SOURCE.matchAll(/addInitScript\((\w+)\)/g)].map((m) => m[1])
const JS     = transformSync(SOURCE, { loader: 'ts', format: 'esm', keepNames: true }).code

// le texte de `function nom(…) { … }` dans le code compilé (accolades comptées hors chaînes)
function texte(nom: string): string {
  const debut = JS.indexOf('function ' + nom + '(')
  assert.ok(debut > -1, nom + ' introuvable dans le code compilé')
  let profondeur = 0
  let chaine = ''
  for (let i = JS.indexOf('{', debut); i < JS.length; i++) {
    const c = JS[i]
    if (chaine) {
      if (c === '\\') i++
      else if (c === chaine) chaine = ''
      continue
    }
    if (c === '"' || c === "'" || c === '`') chaine = c
    else if (c === '{') profondeur++
    else if (c === '}' && --profondeur === 0) return JS.slice(debut, i + 1)
  }
  throw new Error(nom + ' : accolades non refermées')
}

class Feuille {
  replaceSync(_css: string) {}
  insertRule() { return 0 }
  deleteRule() {}
  replace() { return Promise.resolve(this) }
}
class Element {
  attachShadow(init: any) { return init }
}

// une page vide, sans `__name` : ce que Playwright fait du script, `(source)()`
function jouer(nom: string) {
  const bac: any = { window: { CSSStyleSheet: Feuille }, Element, Object }
  vm.runInNewContext('(' + texte(nom) + ')()', bac)
  return bac
}

describe('rendu par navigateur — les scripts posés avant le cœur tournent seuls, même compilés par tsx', () => {
  it('ils sont bien trouvés', () => {
    assert.deepEqual(NOMS.slice().sort(), ['mjsSsrForceOpenShadow', 'mjsSsrNoteSheetText'])
  })

  for (const nom of NOMS) {
    it(nom + ' : aucun appel à une aide absente de la page', () => {
      assert.doesNotThrow(() => jouer(nom))
    })
  }

  it('une feuille retouchée (insertRule, deleteRule, replace) oublie le texte retenu par replaceSync', () => {
    const bac = jouer('mjsSsrNoteSheetText')
    for (const retouche of ['insertRule', 'deleteRule', 'replace']) {
      const f: any = new bac.window.CSSStyleSheet()
      f.replaceSync('a { color: red }')
      assert.equal(f.__mjsTexte, 'a { color: red }', 'texte retenu')
      f[retouche]('b { color: blue }')
      assert.equal(f.__mjsTexte, undefined, retouche + ' : le texte retenu est oublié')
    }
  })

  it('un Shadow DOM demandé fermé s\'ouvre', () => {
    const bac = jouer('mjsSsrForceOpenShadow')
    assert.equal(new bac.Element().attachShadow({ mode: 'closed' }).mode, 'open')
  })
})
