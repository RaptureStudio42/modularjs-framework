// POURQUOI CE FICHIER EXISTE
// Relecture de la refonte de `<@module EXPR …>` (composant choisi par une variable) : quatre défauts
// que les tests de la refonte ne voyaient pas, parce qu'ils ne regardaient ni une branche `{await}`
// qui change d'état, ni une ligne de `{for}` dont le composant change PUIS qui subit une opération de
// liste, ni la mémoire après des dizaines de changements, ni le nombre de `_set` posés sur l'enfant.
// Ce que chaque groupe garde :
//  1. {await} — `{success r}<@module $comp titre={r.nom}>` : quand la promesse est rejouée ou rejetée,
//     la branche n'est plus affichée et `r` vaut null. L'effet qui repose les props relisait quand même
//     `r.nom` : « Cannot read properties of null », l'hôte tombait. Un composant écrit en dur
//     (`<mjs-ce titre={r.nom}>`) n'a jamais ce défaut ; la variante symétrique (`{error err}`) aussi.
//  2. {for} — après un CHANGEMENT de composant dans une ligne, la ligne gardait en main le nœud
//     d'origine (remplacé) : ajout en tête, retrait, inversion visaient un nœud mort. La matrice
//     complète des opérations de liste est dans module-dynamique-liste-matrice.test.ts ; ici, les
//     trois enchaînements qui cassaient, plus l'état interne des lignes voisines.
//  3. Fuite — le chaînage « ancien nœud → nœud qui l'a remplacé » ne raccourcissait jamais : 80
//     changements de composant laissaient 78 anciens composants vivants après ramasse-miettes.
//  4. Props — changer UNE variable reposait TOUTES les props (un `_set` par prop) ; un littéral
//     `opts={ { u: $u } }` recevait alors une nouvelle référence et relançait les effets de l'enfant
//     sur un changement sans rapport. Attendu : comme un composant écrit en dur, un `_set` par prop
//     dont la variable a changé.
//  5. Écriture juste après le montage — le drapeau « prop posée à la création », vidé en microtâche, avalait
//     toute écriture synchrone faite par l'hôte dans la foulée (`µmount -> $t = 'b'` : l'enfant gardait
//     `a`). Il garde maintenant les VALEURS posées, et l'effet d'une prop ne se tait que s'il apporte la
//     même (égalité stricte, ou deux littéraux objet/tableau de même contenu au premier niveau).

import assert from 'node:assert/strict'
import v8 from 'node:v8'
import vm from 'node:vm'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterModule, pause } from './helpers/module-dynamique.js'

const CE = '<script lang="coffee">\n$titre = \'\'\n</script>\n<p class="v">E:{$titre}</p>\n'

const hoteAwait = (corps: string, init: string) => `<script lang="coffee">\n$comp = 'mjs-ce'\n${init}\n@setP = (v) -> $p = v\n</script>\n${corps}\n`

// les titres des composants `mjs-ce` montés dans l'hôte (chaînes seulement)
const titres = (h: any) => [...h._shadow.querySelectorAll('mjs-ce')].map((c: any) => c._shadow?.querySelector('.v')?.textContent)

const SUCCES_MODULE = '{await $p}<i>...</i>{success r}<@module $comp titre={r.nom}></@module>{error err}<b>E</b>{end}'
const SUCCES_DUR    = '{await $p}<i>...</i>{success r}<mjs-ce titre={r.nom}></mjs-ce>{error err}<b>E</b>{end}'
const ERREUR_MODULE = '{await $p}<i>...</i>{success r}<b>ok</b>{error err}<@module $comp titre={err.message}></@module>{end}'
const ERREUR_DUR    = '{await $p}<i>...</i>{success r}<b>ok</b>{error err}<mjs-ce titre={err.message}></mjs-ce>{end}'

describe('<@module> — défauts relevés à la relecture de la refonte', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('1. dans une branche {await}', () => {
    for(const [nom, corps] of [['<@module>', SUCCES_MODULE], ['composant écrit en dur (témoin)', SUCCES_DUR]]) {
      it(`${nom} dans {success} : promesse rejetée → la branche {error} s'affiche, sans erreur ; rejouée en succès → le titre revient`, async () => {
        const m = await monterModule({ hote: hoteAwait(corps, '$p = Promise.resolve({ nom: \'N1\' })'), ce: CE })
        const h = m.hote
        await pause(80)
        assert.deepEqual(titres(h), ['E:N1'])
        h.setP(Promise.reject(new Error('boum')))
        await pause(80)
        assert.deepEqual(m.erreurs(), [], 'aucune erreur interceptée')
        assert.equal(h._shadow.querySelector('b')?.textContent, 'E', 'la branche {error} est affichée')
        assert.deepEqual(titres(h), [])
        h.setP(Promise.resolve({ nom: 'N2' }))
        await pause(80)
        assert.deepEqual(m.erreurs(), [])
        assert.deepEqual(titres(h), ['E:N2'])
      })

      it(`${nom} dans {success} : promesse REMPLACÉE par une promesse en attente puis résolue`, async () => {
        const m = await monterModule({ hote: hoteAwait(corps, '$p = Promise.resolve({ nom: \'N1\' })'), ce: CE })
        const h = m.hote
        await pause(80)
        h.setP(new Promise((r) => setTimeout(() => r({ nom: 'N3' }), 60)))
        await pause(20)
        assert.deepEqual(m.erreurs(), [], 'branche {pending} : aucune erreur')
        assert.equal(h._shadow.querySelector('i')?.textContent, '...')
        await pause(120)
        assert.deepEqual(m.erreurs(), [])
        assert.deepEqual(titres(h), ['E:N3'])
      })
    }

    for(const [nom, corps] of [['<@module>', ERREUR_MODULE], ['composant écrit en dur (témoin)', ERREUR_DUR]]) {
      it(`${nom} dans {error} : retour à une promesse résolue → la branche {success} s'affiche, sans erreur ; nouveau rejet → le message revient`, async () => {
        const m = await monterModule({ hote: hoteAwait(corps, '$p = Promise.reject(new Error(\'boum\'))'), ce: CE })
        const h = m.hote
        await pause(80)
        assert.deepEqual(titres(h), ['E:boum'])
        h.setP(Promise.resolve({ nom: 'N1' }))
        await pause(80)
        assert.deepEqual(m.erreurs(), [], 'aucune erreur interceptée')
        assert.equal(h._shadow.querySelector('b')?.textContent, 'ok')
        assert.deepEqual(titres(h), [])
        h.setP(Promise.reject(new Error('boum2')))
        await pause(80)
        assert.deepEqual(m.erreurs(), [])
        assert.deepEqual(titres(h), ['E:boum2'])
      })
    }

    it('une prop profonde (`r.a.b`) ne plante pas non plus quand la branche se ferme', async () => {
      const corps = '{await $p}<i>...</i>{success r}<@module $comp titre={r.a.b}></@module>{error err}<b>E</b>{end}'
      const m = await monterModule({ hote: hoteAwait(corps, '$p = Promise.resolve({ a: { b: \'B1\' } })'), ce: CE })
      const h = m.hote
      await pause(80)
      assert.deepEqual(titres(h), ['E:B1'])
      h.setP(Promise.reject(new Error('boum')))
      await pause(80)
      h.setP(Promise.resolve({ a: { b: 'B2' } }))
      await pause(80)
      assert.deepEqual(m.erreurs(), [])
      assert.deepEqual(titres(h), ['E:B2'])
    })
  })

  describe('2. dans un {for} : enchaînement qui cassait après un changement de composant', () => {
    const CC = '<script lang="coffee">\n$titre = \'\'\n$n = 0\n@inc = -> $n++\n</script>\n<button class="i" @click={@inc()}>+</button><p class="v">C:{$titre}:{$n}</p>\n'
    const CD = '<script lang="coffee">\n$titre = \'\'\n</script>\n<p class="v">D:{$titre}</p>\n'
    const hote = (corps: string, init: string) => `<script lang="coffee">\n${init}\n@set = (v) -> $l = v\n</script>\n${corps}\n`
    const lignes = (h: any) => [...h._shadow.children].filter((n: any) => n.localName !== 'style').map((n: any) => n.localName + '|' + (n._shadow?.querySelector('.v')?.textContent ?? ''))

    for(const [mode, corps] of [['avec clé', '{for f in $l by k}<@module f.c titre={f.t}></@module>{end}'], ['sans clé', '{for f in $l}<@module f.c titre={f.t}></@module>{end}']]) {
      it(`${mode} : [2:cc] → [2:cd] → [1:cc, 2:cd] : deux lignes, dans l'ordre, sans erreur`, async () => {
        const m = await monterModule({ hote: hote(corps, '$l = [{ k: 2, c: \'mjs-cc\', t: \'b\' }]'), cc: CC, cd: CD })
        const h = m.hote
        assert.deepEqual(lignes(h), ['mjs-cc|C:b:0'])
        h.set([{ k: 2, c: 'mjs-cd', t: 'b' }])
        await pause(60)
        assert.deepEqual(lignes(h), ['mjs-cd|D:b'])
        h.set([{ k: 1, c: 'mjs-cc', t: 'a' }, { k: 2, c: 'mjs-cd', t: 'b' }])
        await pause(60)
        assert.deepEqual(m.erreurs(), [])
        assert.deepEqual(lignes(h), ['mjs-cc|C:a:0', 'mjs-cd|D:b'])
      })

      it(`${mode} : changement de composant, puis retrait, puis ajout : pas de ligne fantôme`, async () => {
        const m = await monterModule({ hote: hote(corps, '$l = [{ k: 1, c: \'mjs-cc\', t: \'a\' }, { k: 2, c: \'mjs-cc\', t: \'b\' }]'), cc: CC, cd: CD })
        const h = m.hote
        h.set([{ k: 1, c: 'mjs-cc', t: 'a' }, { k: 2, c: 'mjs-cd', t: 'b' }])
        await pause(60)
        h.set([{ k: 1, c: 'mjs-cc', t: 'a' }])
        await pause(60)
        assert.deepEqual(lignes(h), ['mjs-cc|C:a:0'])
        h.set([{ k: 1, c: 'mjs-cc', t: 'a' }, { k: 3, c: 'mjs-cc', t: 'c' }])
        await pause(60)
        assert.deepEqual(m.erreurs(), [])
        assert.deepEqual(lignes(h), ['mjs-cc|C:a:0', 'mjs-cc|C:c:0'])
      })

      it(`${mode} : changement de composant, puis inversion : deux nœuds, pas trois`, async () => {
        const m = await monterModule({ hote: hote(corps, '$l = [{ k: 1, c: \'mjs-cc\', t: \'a\' }, { k: 2, c: \'mjs-cc\', t: \'b\' }]'), cc: CC, cd: CD })
        const h = m.hote
        h.set([{ k: 1, c: 'mjs-cd', t: 'a' }, { k: 2, c: 'mjs-cc', t: 'b' }])
        await pause(60)
        h.set([{ k: 2, c: 'mjs-cc', t: 'b' }, { k: 1, c: 'mjs-cd', t: 'a' }])
        await pause(60)
        assert.deepEqual(m.erreurs(), [])
        assert.deepEqual(lignes(h), mode === 'avec clé' ? ['mjs-cc|C:b:0', 'mjs-cd|D:a'] : ['mjs-cc|C:b:0', 'mjs-cd|D:a'])
      })
    }

    it('avec clé : une ligne qui n\'a pas changé de composant garde son état interne pendant que sa voisine change', async () => {
      const m = await monterModule({ hote: hote('{for f in $l by k}<@module f.c titre={f.t}></@module>{end}', '$l = [{ k: 1, c: \'mjs-cc\', t: \'a\' }, { k: 2, c: \'mjs-cc\', t: \'b\' }]'), cc: CC, cd: CD })
      const h = m.hote
      h._shadow.querySelectorAll('mjs-cc')[0]._shadow.querySelector('.i').click()
      h._shadow.querySelectorAll('mjs-cc')[0]._shadow.querySelector('.i').click()
      await pause(40)
      h.set([{ k: 1, c: 'mjs-cc', t: 'a' }, { k: 2, c: 'mjs-cd', t: 'b' }])
      await pause(60)
      h.set([{ k: 0, c: 'mjs-cd', t: 'z' }, { k: 1, c: 'mjs-cc', t: 'a' }, { k: 2, c: 'mjs-cd', t: 'b' }])
      await pause(60)
      assert.deepEqual(m.erreurs(), [])
      assert.deepEqual(lignes(h), ['mjs-cd|D:z', 'mjs-cc|C:a:2', 'mjs-cd|D:b'])
    })
  })

  describe('3. fuite : les anciens composants d\'une ligne sont libérés', () => {
    const CC = '<script lang="coffee">\n$titre = \'\'\n</script>\n<p class="v">C:{$titre}</p>\n'
    const CD = '<script lang="coffee">\n$titre = \'\'\n</script>\n<p class="v">D:{$titre}</p>\n'
    // `gc` sans option de ligne de commande : le drapeau est posé à chaud, la fonction lue dans un contexte neuf
    v8.setFlagsFromString('--expose-gc')
    const gc: () => void = vm.runInNewContext('gc')

    for(const mode of ['for', 'racine', 'if']) {
      it(`${mode} : 80 changements de composant → au plus un ancien composant encore vivant après ramasse-miettes`, async () => {
        const corps = mode === 'for' ? '{for f in $l by k}<@module f.c titre={f.t}></@module>{end}' : mode === 'if' ? '{if $on}<@module $c titre="x"></@module>{end}' : '<@module $c titre="x"></@module>'
        const m = await monterModule({ hote: `<script lang="coffee">\n$l = [{ k: 1, c: 'mjs-cc', t: 'a' }]\n$c = 'mjs-cc'\n$on = true\n@set = (v) -> $l = v\n@setC = (v) -> $c = v\n</script>\n${corps}\n`, cc: CC, cd: CD })
        const h = m.hote
        const refs: WeakRef<object>[] = []
        for(let i = 0; i < 80; i++) {
          if(mode === 'for') h.set([{ k: 1, c: i % 2 ? 'mjs-cc' : 'mjs-cd', t: 'a' + i }])
          else h.setC(i % 2 ? 'mjs-cc' : 'mjs-cd')
          await pause(12)
          if(i < 78) refs.push(new WeakRef(h._shadow.querySelector('mjs-cc, mjs-cd')))
        }
        assert.deepEqual(m.erreurs(), [])
        for(let i = 0; i < 6; i++) {
          gc()
          await pause(30)
        }
        const vivants = refs.filter((r) => r.deref() !== undefined).length
        assert.ok(vivants <= 1, `${vivants} anciens composants encore vivants sur ${refs.length}`)
      })
    }
  })

  describe('4. props : un `_set` par prop dont la variable a changé', () => {
    const ENFANT = '<script lang="coffee">\n$titre = \'\'\n$ids = null\n$opts = null\nµeffect ->\n  $opts\n  window.__eo = (window.__eo or 0) + 1\n</script>\n<p class="v">{$titre}|{$ids}|{JSON.stringify($opts)}</p>\n'
    const hote = (corps: string) => `<script lang="coffee">\n$comp = 'mjs-ce'\n$t = 'T'\n$ids = ['a', 'b']\n$u = 1\n@setT = (v) -> $t = v\n@setU = (v) -> $u = v\n@setIds = (v) -> $ids = v\n</script>\n${corps}\n`
    const espion = (el: any) => {
      const posees: string[] = []
      const orig = el._set
      el._set = function(k: string, v: any) {
        posees.push(k)
        return orig.call(this, k, v)
      }
      return posees
    }
    const effetsOpts = (m: any) => Number(m.window.eval('globalThis.__eo || 0'))

    for(const [nom, balise] of [['<@module>', '<@module $comp titre={$t} ids={$ids} opts={ { u: $u } }></@module>'], ['composant écrit en dur (témoin)', '<mjs-ce titre={$t} ids={$ids} opts={ { u: $u } }></mjs-ce>']]) {
      it(`${nom} : changer $t ne pose que « titre » et ne relance pas l'effet de l'enfant sur opts`, async () => {
        const m = await monterModule({ hote: hote(balise), ce: ENFANT })
        const h = m.hote
        const el = h._shadow.querySelector('mjs-ce')
        assert.equal(el._shadow.querySelector('.v').textContent, 'T|a,b|{"u":1}')
        const posees = espion(el)
        const avant  = effetsOpts(m)
        h.setT('T2')
        await pause(60)
        assert.deepEqual(posees, ['titre'])
        assert.equal(effetsOpts(m), avant, 'l\'effet de l\'enfant sur opts n\'a pas été relancé')
        assert.equal(el._shadow.querySelector('.v').textContent, 'T2|a,b|{"u":1}')
      })

      it(`${nom} : changer $u ne pose que « opts » ; changer la liste ne pose que « ids »`, async () => {
        const m = await monterModule({ hote: hote(balise), ce: ENFANT })
        const h = m.hote
        const el = h._shadow.querySelector('mjs-ce')
        const posees = espion(el)
        h.setU(2)
        await pause(60)
        assert.deepEqual(posees.splice(0), ['opts'])
        assert.equal(el._shadow.querySelector('.v').textContent, 'T|a,b|{"u":2}')
        h.setIds(['x'])
        await pause(60)
        assert.deepEqual(posees.splice(0), ['ids'])
        assert.equal(el._shadow.querySelector('.v').textContent, 'T|x|{"u":2}')
      })
    }

    it('<@module> : une liste modifiée sur place (push) est bien notifiée à l\'enfant, comme pour un composant écrit en dur', async () => {
      const m = await monterModule({ hote: hote('<@module $comp titre={$t} ids={$ids}></@module>').replace('@setIds = (v) -> $ids = v', '@setIds = (v) -> $ids.push(v)'), ce: ENFANT })
      const h = m.hote
      h.setIds('c')
      await pause(60)
      assert.equal(h._shadow.querySelector('mjs-ce')._shadow.querySelector('.v').textContent, 'T|a,b,c|null')
    })

    it('<@module> : un changement de composant repose bien TOUTES les props sur le nouvel élément', async () => {
      const AUTRE = '<script lang="coffee">\n$titre = \'\'\n$ids = null\n$opts = null\n</script>\n<p class="v">F:{$titre}|{$ids}|{JSON.stringify($opts)}</p>\n'
      const m = await monterModule({ hote: hote('<@module $comp titre={$t} ids={$ids} opts={ { u: $u } }></@module>').replace('@setT', '@choisir = (v) -> $comp = v\n@setT'), ce: ENFANT, cf: AUTRE })
      const h = m.hote
      h.choisir('mjs-cf')
      await pause(60)
      assert.equal(h._shadow.querySelector('mjs-cf')._shadow.querySelector('.v').textContent, 'F:T|a,b|{"u":1}')
      assert.deepEqual(m.erreurs(), [])
    })
  })

  // pourquoi ce groupe : l'effet de chaque prop tourne une fois au montage, avec la valeur déjà posée à la
  // création du composant — il se tait alors. Un simple drapeau (vidé en microtâche) se taisait aussi sur
  // une valeur ÉCRITE depuis, dans le même tour ou juste après : l'enfant restait sur l'ancienne
  describe('5. une écriture juste après le montage n\'est pas avalée', () => {
    const ENFANT = '<script lang="coffee">\n$titre = \'\'\n$opts = null\n$ids = null\nµeffect ->\n  $opts\n  window.__eo = (window.__eo or 0) + 1\nµeffect ->\n  $ids\n  window.__ei = (window.__ei or 0) + 1\n</script>\n<p class="v">{$titre}|{JSON.stringify($ids)}|{JSON.stringify($opts)}</p>\n'
    const hote = (corps: string, montage = '') => `<script lang="coffee">\n$comp = 'mjs-ce'\n$t = 'a'\n$u = 1\n$show = true\n$p = Promise.resolve({ nom: 'N' })\n@setU = (v) -> $u = v\n${montage}\n</script>\n${corps}\n`
    const MODULE = '<@module $comp titre={$t}></@module>'
    const DUR    = '<mjs-ce titre={$t}></mjs-ce>'
    const enfant = (m: any) => m.hote._shadow.querySelector('mjs-ce')
    const vu     = (m: any) => enfant(m)._shadow.querySelector('.v').textContent
    const effets = (m: any, nom: string) => Number(m.window.eval(`globalThis.${nom} || 0`))
    const unTour = (n: number) => `µmount ->\n  Promise.resolve()${'.then(-> null)'.repeat(n)}.then(-> $t = 'b')`

    for(const [nom, balise] of [['<@module>', MODULE], ['composant écrit en dur (témoin)', DUR]]) {
      it(`${nom} : écriture synchrone dans µmount → l'enfant affiche la nouvelle valeur`, async () => {
        const m = await monterModule({ hote: hote(balise, 'µmount -> $t = \'b\''), ce: ENFANT })
        await pause(60)
        assert.equal(vu(m), 'b|null|null')
        assert.deepEqual(m.erreurs(), [])
      })

      it(`${nom} : écriture dans un µeffect du premier rendu → l'enfant affiche la nouvelle valeur`, async () => {
        const m = await monterModule({ hote: hote(balise, 'µeffect ->\n  $t = \'b\''), ce: ENFANT })
        await pause(60)
        assert.equal(vu(m), 'b|null|null')
      })

      for(const n of [0, 1, 2, 3, 4, 5]) {
        it(`${nom} : écriture ${n} microtâche(s) après le montage → l'enfant affiche la nouvelle valeur`, async () => {
          const m = await monterModule({ hote: hote(balise, unTour(n)), ce: ENFANT })
          await pause(60)
          assert.equal(vu(m), 'b|null|null')
        })
      }

      it(`${nom} : écriture dans un setTimeout(0) après le montage → l'enfant affiche la nouvelle valeur`, async () => {
        const m = await monterModule({ hote: hote(balise, 'µmount -> setTimeout((-> $t = \'b\'), 0)'), ce: ENFANT })
        await pause(60)
        assert.equal(vu(m), 'b|null|null')
      })
    }

    it('<@module> dans un {if} : écriture synchrone dans µmount → l\'enfant affiche la nouvelle valeur', async () => {
      const m = await monterModule({ hote: hote('{if $show}<@module $comp titre={$t}></@module>{end}', 'µmount -> $t = \'b\''), ce: ENFANT })
      await pause(60)
      assert.equal(vu(m), 'b|null|null')
    })

    it('<@module> sous {await} : écriture dans µmount, puis dans un setTimeout(0) → l\'enfant affiche la dernière valeur', async () => {
      const corps = '{await $p}<i>...</i>{success r}<@module $comp titre={$t}></@module>{error err}<b>E</b>{end}'
      const m = await monterModule({ hote: hote(corps, 'µmount ->\n  $t = \'b\'\n  setTimeout((-> $t = \'c\'), 0)'), ce: ENFANT })
      await pause(80)
      assert.equal(vu(m), 'c|null|null')
      assert.deepEqual(m.erreurs(), [])
    })

    for(const [nom, balise] of [['<@module>', '<@module $comp titre={$t} opts={ { u: $u } }></@module>']]) {
      it(`${nom} : prop objet littéral — l'effet de l'enfant sur opts tourne UNE fois au montage (pas de seconde référence de même contenu), puis une fois de plus quand $u change`, async () => {
        const m = await monterModule({ hote: hote(balise), ce: ENFANT })
        await pause(60)
        assert.equal(effets(m, '__eo'), 1, 'une fois au montage')
        assert.equal(vu(m), 'a|null|{"u":1}')
        m.hote.setU(2)
        await pause(60)
        assert.equal(effets(m, '__eo'), 2, 'une fois de plus après le changement de $u')
        assert.equal(vu(m), 'a|null|{"u":2}')
      })
    }

    it('<@module> : prop tableau littéral — l\'effet de l\'enfant ne tourne qu\'une fois au montage, puis une fois de plus quand $u change', async () => {
      const m = await monterModule({ hote: hote('<@module $comp ids={ [$u, 2] }></@module>'), ce: ENFANT })
      await pause(60)
      assert.equal(effets(m, '__ei'), 1, 'une fois au montage')
      assert.equal(vu(m), '|[1,2]|null')
      m.hote.setU(5)
      await pause(60)
      assert.equal(effets(m, '__ei'), 2)
      assert.equal(vu(m), '|[5,2]|null')
    })

    it('<@module> : une prop dont seul le 2ᵉ niveau diffère (référence intérieure neuve) n\'est pas jugée la même — c\'est attendu, figé ici', async () => {
      const m = await monterModule({ hote: hote('<@module $comp opts={ { a: { b: $u } } }></@module>'), ce: ENFANT })
      await pause(60)
      const memes = (a: string, b: string) => m.window.eval(`µ._mjs_modSame(${a}, ${b})`)
      assert.equal(memes('{ a: { b: 1 } }', '{ a: { b: 1 } }'), false, 'objets intérieurs distincts : reposée')
      assert.equal(memes('{ u: 1 }', '{ u: 1 }'), true, 'même contenu au premier niveau : tue')
      assert.equal(memes('[1, 2]', '[1, 2]'), true)
      assert.equal(memes('[1, 2]', '{ 0: 1, 1: 2 }'), false, 'tableau et objet ne se confondent pas')
      assert.equal(vu(m), '|null|{"a":{"b":1}}')
    })

    it('<@module> sous {await} : prop objet littéral — une seule exécution de l\'effet de l\'enfant au montage', async () => {
      const corps = '{await $p}<i>...</i>{success r}<@module $comp opts={ { u: $u } }></@module>{error err}<b>E</b>{end}'
      const m = await monterModule({ hote: hote(corps), ce: ENFANT })
      await pause(80)
      assert.equal(effets(m, '__eo'), 1)
      assert.equal(vu(m), '|null|{"u":1}')
    })

    it('<@module> dans un {if} : prop objet littéral — une seule exécution de l\'effet de l\'enfant au montage', async () => {
      const m = await monterModule({ hote: hote('{if $show}<@module $comp opts={ { u: $u } }></@module>{end}'), ce: ENFANT })
      await pause(60)
      assert.equal(effets(m, '__eo'), 1)
      assert.equal(vu(m), '|null|{"u":1}')
    })
  })
})
