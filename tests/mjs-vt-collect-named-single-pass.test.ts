// Garde de non-régression (refactor PERF, comportement PRÉSERVÉ) — µ._mjs_vtCollectNamed
// (mjs_vt_presets.ts) faisait DEUX parcours complets du sous-arbre à chaque appel :
// `root.querySelectorAll('[style*="view-transition-name"]')` PUIS `root.querySelectorAll('*')`
// pour repérer les hôtes de shadow — recursé pour CHAQUE shadow trouvé, donc jusqu'à 2×N
// parcours natifs pour une arborescence de N shadows imbriquées. Appelé plusieurs fois par
// transition de page (départ, arrivée, jusqu'à 3 essais côté arrivée). Fusionné en UN SEUL
// parcours par racine : chaque élément est jugé pour les deux critères (nommé, hôte de shadow)
// dans la même boucle, les shadows trouvés étant recursés APRÈS pour garder l'ordre EXACT
// d'avant. Ce test verrouille ce contrat (résultat et ordre inchangés) pour le refactor — il n'y
// a pas de bug corrigé ici, seulement un filet de sécurité sur un comportement qui doit rester
// identique.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VT_PRESETS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_vt_presets.ts'), 'utf-8')

function load(): any {
  const µ: any = { warn() {}, log() {}, error() {} }
  new Function('µ', VT_PRESETS_SRC)(µ)
  return µ
}

function nommer(doc: any, nom: string) {
  const el = doc.createElement('span')
  // même double pose que view-transition.test.ts (cf. son en-tête) : happy-dom ne reflète pas
  // l'attribut `style="view-transition-name: …"` vers l'accesseur camelCase POUR LA LECTURE —
  // seule l'affectation directe `.style.viewTransitionName = …` le fait, ce que lit le runtime.
  el.setAttribute('style', `view-transition-name: ${nom}`)
  el.style.viewTransitionName = nom
  return el
}

describe('µ._mjs_vtCollectNamed — un seul parcours par racine, ordre et résultat inchangés', function () {
  it('un nommé À LA RACINE + un nommé dans un shadow imbriqué : les DEUX sont trouvés, racine AVANT shadow', () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const doc = win.document
    const µ = load()

    const racineNommee = nommer(doc, 'racine')
    doc.body.appendChild(racineNommee)

    const host = doc.createElement('div')
    const inner = nommer(doc, 'imbrique')
    const sh: any = host.attachShadow({ mode: 'open' })
    host._shadow = sh
    sh.appendChild(inner)
    doc.body.appendChild(host)

    const out = µ._mjs_vtCollectNamed(doc.body)
    assert.equal(out.length, 2)
    assert.deepEqual(out.map((o: any) => o.name), ['racine', 'imbrique'], "l'ordre doit être : nommés de la racine D'ABORD, puis shadow par shadow")
    assert.equal(out[0].el, racineNommee)
    assert.equal(out[1].el, inner)
  })

  it('DEUX shadows au même niveau : recueillis dans leur ordre de rencontre (doc order des hôtes)', () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const doc = win.document
    const µ = load()

    const hostA = doc.createElement('div')
    const namedA = nommer(doc, 'a')
    const shA: any = hostA.attachShadow({ mode: 'open' })
    hostA._shadow = shA
    shA.appendChild(namedA)

    const hostB = doc.createElement('div')
    const namedB = nommer(doc, 'b')
    const shB: any = hostB.attachShadow({ mode: 'open' })
    hostB._shadow = shB
    shB.appendChild(namedB)

    doc.body.appendChild(hostA)
    doc.body.appendChild(hostB)

    const out = µ._mjs_vtCollectNamed(doc.body)
    assert.deepEqual(out.map((o: any) => o.name), ['a', 'b'])
  })

  it('un HÔTE de shadow qui est LUI-MÊME nommé : son propre nom sort AVANT ceux de son shadow', () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const doc = win.document
    const µ = load()

    const host = nommer(doc, 'hote') // nommé ET hôte de shadow
    const inner = nommer(doc, 'enfant')
    const sh: any = host.attachShadow({ mode: 'open' })
    host._shadow = sh
    sh.appendChild(inner)
    doc.body.appendChild(host)

    const out = µ._mjs_vtCollectNamed(doc.body)
    assert.deepEqual(out.map((o: any) => o.name), ['hote', 'enfant'])
  })

  it("aucun nommé : tableau vide, jamais d'erreur", () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const doc = win.document
    const µ = load()
    doc.body.appendChild(doc.createElement('div'))
    assert.deepEqual(µ._mjs_vtCollectNamed(doc.body), [])
  })

  it("view-transition-name: none : ignoré (comme avant)", () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const doc = win.document
    const µ = load()
    const el = doc.createElement('span')
    el.style.viewTransitionName = 'none'
    doc.body.appendChild(el)
    assert.deepEqual(µ._mjs_vtCollectNamed(doc.body), [])
  })
})
