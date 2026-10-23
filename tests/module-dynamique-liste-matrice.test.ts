// POURQUOI CE FICHIER EXISTE
// Une ligne de `{for}` qui change de COMPOSANT (`<@module f.c …>`) remplace son repère par le composant
// : la liste gardait en main le nœud d'origine, mort depuis le remplacement, et toute opération de
// liste suivante (ajout, retrait, inversion…) visait ce nœud mort — crash `insertBefore`, ligne
// fantôme, nœud en trop. Les trois enchaînements qui cassaient sont dans
// module-dynamique-await-liste-fuite-props.test.ts ; ici la MATRICE complète, pour qu'aucune
// combinaison ne dépende d'un cas qu'on aurait pensé à écrire :
//   liste à clé et liste sans clé
//   × avant l'opération : aucun changement, un changement de composant, deux changements de suite
//     (aller puis retour), une valeur vide puis le retour au même composant, une valeur vide puis un
//     autre composant
//   × l'opération : ajout en tête, au milieu, en queue ; retrait ; inversion ; tri ; remplacement de
//     toute la liste ; vidage puis recréation (la réserve de lignes).
// À chaque étape, le DOM est comparé à un modèle : nombre de nœuds, ordre, composant et titre de
// chaque ligne, visible ou masquée, et état interne (un compteur) gardé quand la ligne n'a pas changé
// de composant — sans erreur interceptée.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterModule, pause } from './helpers/module-dynamique.js'

const CC = '<script lang="coffee">\n$titre = \'\'\n$n = 0\n@inc = -> $n++\n</script>\n<button class="i" @click={@inc()}>+</button><p class="v">C:{$titre}:{$n}</p>\n'
const CD = '<script lang="coffee">\n$titre = \'\'\n</script>\n<p class="v">D:{$titre}</p>\n'

interface Ligne { k: number; c: string; t: string }
interface Inst  { tag: string; n: number; masque: boolean; titre: string }

const CC_ = 'mjs-cc'
const CD_ = 'mjs-cd'

const hote = (corps: string) => `<script lang="coffee">\n$l = []\n@set = (v) -> $l = v\n</script>\n${corps}\n`

// le DOM tel que l'utilisateur le voit : un résumé par enfant de l'ombre de l'hôte, dans l'ordre
const dom = (h: any): string[] => [...h._shadow.children].filter((n: any) => n.localName !== 'style').map((n: any) => {
  if(n.localName === 'div') return 'div|masque'
  const v = n._shadow?.querySelector('.v')?.textContent ?? ''
  return n.localName + '|' + (n.style.display === 'none' ? 'masque' : 'visible') + '|' + v
})

// identité d'un élément de liste : sans `by`, MJS reconnaît une ligne à son objet (une copie = une autre ligne)
const identites = new WeakMap<object, number>()
let   compteur  = 0
const identite  = (l: Ligne): number => {
  if(!identites.has(l)) identites.set(l, ++compteur)
  return identites.get(l)!
}

// le modèle : une instance par emplacement (la clé, ou l'objet quand la liste n'a pas de clé)
function modele(liste: Ligne[], avant: Map<string, Inst>, parCle: boolean): { insts: Map<string, Inst>; attendu: string[] } {
  const insts = new Map<string, Inst>()
  const attendu: string[] = []
  liste.forEach((l) => {
    const slot = parCle ? 'k' + l.k : 'o' + identite(l)
    const a    = avant.get(slot)
    let inst: Inst
    if(l.c === '') inst = a ? { ...a, masque: true } : { tag: '', n: 0, masque: true, titre: '' }
    else if(a && a.tag === l.c) inst = { ...a, masque: false, titre: l.t }
    else inst = { tag: l.c, n: 0, masque: false, titre: l.t }
    insts.set(slot, inst)
    if(inst.tag === '') attendu.push('div|masque')
    else attendu.push(inst.tag + '|' + (inst.masque ? 'masque' : 'visible') + '|' + (inst.tag === CC_ ? `C:${inst.titre}:${inst.n}` : `D:${inst.titre}`))
  })
  return { insts, attendu }
}

const BASE: Ligne[] = [{ k: 1, c: CC_, t: 'b' }, { k: 2, c: CC_, t: 'c' }, { k: 3, c: CC_, t: 'a' }]

const changer = (l: Ligne[], i: number, c: string): Ligne[] => l.map((x, j) => (j === i ? { ...x, c } : x))

// ce qui est appliqué AVANT l'opération : une suite d'étapes, chacune une nouvelle liste
const AVANTS: Record<string, (l: Ligne[]) => Ligne[][]> = {
  'aucun changement de composant':          () => [],
  'un changement de composant':             (l) => [changer(l, 1, CD_)],
  'deux changements de suite (aller-retour)': (l) => { const a = changer(changer(l, 1, CD_), 0, CD_); return [a, changer(a, 1, CC_)] },
  'une valeur vide puis le retour au même composant': (l) => { const a = changer(l, 1, ''); return [a, changer(a, 1, CC_)] },
  'une valeur vide puis un autre composant':   (l) => { const a = changer(l, 1, ''); return [a, changer(a, 1, CD_)] }
}

// l'opération : de la liste courante à la suivante
const OPS: Record<string, (l: Ligne[]) => Ligne[]> = {
  'ajout en tête':                (l) => [{ k: 9, c: CD_, t: 'neuf' }, ...l],
  'ajout au milieu':              (l) => [l[0], { k: 8, c: CC_, t: 'mid' }, ...l.slice(1)],
  'ajout en queue':               (l) => [...l, { k: 7, c: CD_, t: 'fin' }],
  'retrait au milieu':            (l) => l.filter((_, i) => i !== 1),
  'inversion':                    (l) => [...l].reverse(),
  'tri par titre':                (l) => [...l].sort((x, y) => x.t.localeCompare(y.t)),
  'remplacement de toute la liste': () => [{ k: 21, c: CC_, t: 'x' }, { k: 22, c: CD_, t: 'y' }],
  'retrait de la première ligne': (l) => l.slice(1)
}

async function clics(h: any, i: number, fois: number, m: any, insts: Map<string, Inst>, slot: string) {
  const ligne = [...h._shadow.querySelectorAll('mjs-cc')][i] as any
  for(let j = 0; j < fois; j++) {
    ligne._shadow.querySelector('.i').click()
    await pause(25)
  }
  insts.get(slot)!.n += fois
}

describe('<@module> dans un {for} : matrice des opérations de liste', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  for(const parCle of [true, false]) {
    describe(parCle ? 'liste à clé (`by k`)' : 'liste sans clé', () => {
      let m: any
      let h: any
      before(async function () {
        this.timeout(60000)
        m = await monterModule({ hote: hote(`{for f in $l${parCle ? ' by k' : ''}}<@module f.c titre={f.t}></@module>{end}`), cc: CC, cd: CD })
        h = m.hote
      })

      // une étape : applique la liste, compare le DOM au modèle, rend le modèle
      async function etape(nom: string, liste: Ligne[], insts: Map<string, Inst>): Promise<Map<string, Inst>> {
        h.set(liste)
        await pause(55)
        const r = modele(liste, insts, parCle)
        assert.deepEqual(dom(h), r.attendu, nom)
        assert.deepEqual(m.erreurs(), [], `${nom} : aucune erreur interceptée`)
        return r.insts
      }

      for(const [avantNom, avant] of Object.entries(AVANTS)) {
        for(const [opNom, op] of Object.entries(OPS)) {
          it(`${avantNom} puis ${opNom}`, async () => {
            // remise à zéro : vidage (la réserve de lignes se remplit), liste de départ
            let insts = await etape('vidage', [], new Map())
            assert.equal(h._shadow.querySelectorAll('mjs-cc, mjs-cd, [mjs-mod]').length, 0, 'plus aucune ligne après vidage')
            let courante: Ligne[] = BASE
            insts = await etape('liste de départ', courante, insts)
            // un état interne différent par ligne : 1, 2 puis 3 clics
            for(let i = 0; i < 3; i++) await clics(h, i, i + 1, m, insts, parCle ? 'k' + BASE[i].k : 'o' + identite(BASE[i]))
            assert.deepEqual(dom(h), modele(courante, insts, parCle).attendu, 'après les clics')
            for(const [i, suivante] of avant(courante).entries()) {
              courante = suivante
              insts    = await etape(`avant, étape ${i + 1}`, courante, insts)
            }
            courante = op(courante)
            insts    = await etape(opNom, courante, insts)
            // une opération de plus : la liste reste utilisable
            courante = [...courante, { k: 50, c: CC_, t: 'zz' }]
            await etape('ajout final', courante, insts)
          })
        }
      }

      it('vidage puis recréation de la même liste, après un changement de composant : la réserve de lignes ne rend pas un nœud mort', async () => {
        let insts = await etape('vidage', [], new Map())
        let l: Ligne[] = BASE
        insts = await etape('départ', l, insts)
        l     = changer(l, 0, CD_)
        insts = await etape('changement', l, insts)
        insts = await etape('vidage', [], insts)
        insts = await etape('recréation', BASE, insts)
        await etape('recréation avec un autre composant', changer(BASE, 2, CD_), insts)
      })
    })
  }
})
