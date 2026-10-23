// µclone (rune) et µ.clone (JavaScript) : une balise NEUVE du même composant, hors de la page, qui monte avec une copie de l'état de l'original au
// moment de l'appel — ses variables `$` et ses props — puis vit seule. Construction réelle (le vrai Bundler), montée dans happy-dom.
//   1. compteur à 5 : la copie monte à 5, avec la prop reçue par l'original et le contenu glissé entre ses balises (recopié comme cloneNode(true)) ;
//   2. +1 sur la copie ne touche pas l'original, et l'inverse ;
//   3. liste d'objets, Map, Set, Date : copies profondes — modifier la copie ne touche pas l'original ;
//   4. une fonction, une instance de classe, un ressort µspring, un élément du DOM rangés dans l'état ne sont pas recopiés : la copie garde ceux que
//      son script lui donne — `$valider = -> $n++` appelé dans la copie change la copie ; une donnée qui tient une fonction non plus ;
//   5. la prop : la copie garde la valeur du moment, le parent de l'original ne la pilote plus ;
//   6. le µmount de la copie joue une fois, son reffet suit sa propre variable et voit l'état copié dès son premier tour ;
//   7. une balise qui n'est pas un composant MJS : erreur claire (texte français et anglais), rien n'est copié ;
//   8. µ.clone depuis un script `lang="js"` ;
//   9. une prop posée en propriété sur une balise pas encore montée (`el.titre = …`) : la copie la reçoit, comme l'original à son montage ;
//      original monté : la copie reprend ce qu'il affiche, pas une propriété écrite après son montage, qu'il ne lit pas ; la méthode
//      homonyme d'une variable, que la balise porte avant son montage, n'est pas prise pour une prop ;
//  10. la copie d'une copie pas encore posée part de l'état qui attend la première ; une prop posée ensuite en propriété passe devant ;
//  11. un composant léger (`mjs-light`) : seule sa balise est copiée, la copie construit sa propre vue ;
//  12. deux variables qui tiennent le même objet le partagent aussi dans la copie ; les clés `__proto__`, `constructor`, `prototype` d'une
//      donnée reçue en JSON ne sont pas reprises

import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { compilerScript } from './helpers/navigateurs-compiles.js'
import { attendre, pause } from './helpers/coeur-monter.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { SOURCES_CLONE } from './helpers/composants-clone.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'

// un composant léger, dont la vue est faite de ses propres enfants ; deux variables qui peuvent tenir le même objet et une donnée reçue en JSON ;
// une variable homonyme d'une méthode
const SOURCES_EN_PLUS: Record<string, string> = {
  'leger.mjs': [
    '<script>',
    '  $k = 0',
    '</script>',
    '<p class="k">{$k}</p>',
    '<button class="kp" @click={$k++}>+</button>',
    ''
  ].join('\n'),
  'partage.mjs': [
    '<script>',
    '  $a = { x: 1 }',
    '  $b = null',
    '  $data = null',
    '  @partager = -> $b = $a',
    '  @changerA = -> $a.x = 99',
    '  @charger = (txt) -> $data = JSON.parse(txt)',
    '</script>',
    '<p class="ab">{$a.x}/{$b and $b.x}</p>',
    ''
  ].join('\n'),
  'homonyme.mjs': [
    '<script>',
    '  $compte = 0',
    '  @compte = -> $compte',
    '</script>',
    '<p class="c">{$compte}</p>',
    '<button class="plus" @click={$compte++}>+</button>',
    ''
  ].join('\n')
}

describe('µclone — copier un composant avec son état, puis le laisser vivre seul (happy-dom)', function () {
  this.timeout(120000)

  let window: any, hote: any, original: any, copie: any
  const texte = (el: any, sel: string) => el._shadow.querySelector(sel).textContent
  const brut  = (v: any) => window.µ._mjs_toRaw(v)
  // une valeur de la page de happy-dom (autre domaine d'exécution : autres prototypes) relue ici, pour la comparer
  const local = (v: any) => JSON.parse(JSON.stringify(v))
  const clic  = async (el: any, n = 1) => { for (let i = 0; i < n; i++) el._shadow.querySelector('.plus').click(); await pause(30) }

  before(async () => {
    const code = await compilerScript('clone-copie-vivante', { ...SOURCES_CLONE, ...SOURCES_EN_PLUS })
    window = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    window.eval('window.__monte = []; window.__vus = [];')
    window.eval(code)
    window.document.body.innerHTML = '<mjs-liste></mjs-liste>'
    hote = window.document.querySelector('mjs-liste')
    await attendre(() => !!hote._shadow && !!hote._shadow.querySelector('mjs-carte')?._mjs_is_mounted && !!hote._shadow.querySelector('mjs-carte')._shadow?.querySelector('.n'))
    await pause(80)
    original = hote._shadow.querySelector('mjs-carte')
    // l'original s'éloigne de son état de départ : 5 clics, un objet de plus dans sa liste, sa Map, son Set et sa Date modifiés
    await clic(original, 5)
    original.ajouter('b')
    original.marquer()
    await pause(30)
    copie = hote.dupliquer()
    await attendre(() => !!copie._mjs_is_mounted && !!copie._shadow?.querySelector('.n') && texte(copie, '.n') === '5')
    await pause(80)
  })

  after(async () => {
    await window?.happyDOM?.close?.()
    await terminateSharedWorkerPool()
  })

  it('compteur à 5 : la copie monte à 5, avec la prop de l\'original et le contenu glissé entre ses balises', () => {
    assert.equal(texte(original, '.n'), '5')
    assert.ok(copie !== original, 'la copie est une autre balise')
    assert.equal(copie.localName, 'mjs-carte')
    assert.ok(copie.parentNode === hote._shadow.querySelector('.zone'), 'la copie est posée dans la zone')
    assert.equal(texte(copie, '.n'), '5')
    assert.equal(texte(copie, '.titre'), 'Bonjour')
    const glisse = copie.querySelector('.glisse')
    assert.ok(glisse, 'le contenu glissé est recopié')
    assert.equal(glisse.textContent, 'glissé')
    assert.ok(glisse !== original.querySelector('.glisse'), 'le contenu glissé est une copie, pas le même nœud')
  })

  it('+1 sur la copie : l\'original reste à 5 ; +2 sur l\'original : la copie reste à 6', async () => {
    await clic(copie)
    assert.equal(texte(copie, '.n'), '6')
    assert.equal(texte(original, '.n'), '5')
    await clic(original, 2)
    assert.equal(texte(original, '.n'), '7')
    assert.equal(texte(copie, '.n'), '6')
  })

  it('liste d\'objets, Map, Set, Date : copies profondes de l\'état du moment, modifier la copie ne touche pas l\'original', async () => {
    const o = original._state, c = copie._state
    assert.deepEqual(local(c.items), [{ nom: 'a', qte: 1 }, { nom: 'b', qte: 1 }])
    assert.notEqual(brut(c.items), brut(o.items))
    assert.notEqual(brut(brut(c.items)[0]), brut(brut(o.items)[0]))
    const cm = brut(c.m), om = brut(o.m)
    assert.ok(cm instanceof window.Map, 'une Map')
    assert.notEqual(cm, om)
    assert.deepEqual(local([...cm.keys()]), ['k', 'k2'])
    assert.equal(brut(cm.get('k2')).v, 2)
    assert.notEqual(brut(cm.get('k')), brut(om.get('k')))
    const cs = brut(c.s), os = brut(o.s)
    assert.ok(cs instanceof window.Set, 'un Set')
    assert.notEqual(cs, os)
    assert.deepEqual(local([...cs]), [1, 2, 3])
    const cd = brut(c.d), od = brut(o.d)
    assert.ok(cd instanceof window.Date, 'une Date')
    assert.notEqual(cd, od)
    assert.equal(cd.getFullYear(), 2030)
    assert.equal(cd.getTime(), od.getTime())
    // la copie change, l'original non
    copie.ajouter('c')
    c.items[0].qte = 9
    c.m.get('k').v = 7
    c.s.delete(1)
    c.d.setFullYear(2040)
    await pause(30)
    assert.deepEqual(local(o.items), [{ nom: 'a', qte: 1 }, { nom: 'b', qte: 1 }])
    assert.equal(brut(om.get('k')).v, 1)
    assert.deepEqual(local([...os]), [1, 2, 3])
    assert.equal(od.getFullYear(), 2030)
    assert.equal(brut(c.items).length, 3)
  })

  it('une fonction, une instance de classe, un ressort µspring, un élément du DOM rangés dans l\'état ne sont pas recopiés : la copie garde les siens', () => {
    const o = original._state, c = copie._state
    assert.equal(typeof brut(c.f), 'function')
    assert.notEqual(brut(c.f), brut(o.f))
    assert.notEqual(brut(c.valider), brut(o.valider))
    assert.notEqual(brut(c.inst), brut(o.inst))
    assert.equal(brut(c.inst).href, 'http://x.test/')
    assert.ok(brut(c.dom) !== brut(o.dom), 'la copie a son propre élément du DOM')
    assert.equal(brut(c.dom).localName, 'i')
    assert.ok(brut(c.ressort) && brut(c.ressort).constructor === brut(o.ressort).constructor, 'un ressort, de la même sorte')
    assert.notEqual(brut(c.ressort), brut(o.ressort))
  })

  it('une donnée qui tient une fonction, à quelque profondeur que ce soit, n\'est pas recopiée : la copie garde la valeur de son script', () => {
    const o = brut(original._state.melange), c = brut(copie._state.melange)
    assert.equal(o.nom, 'changé')
    assert.equal(c.nom, 'm')
    assert.equal(typeof c.f, 'function')
    assert.notEqual(c.f, o.f)
  })

  it('la prop : la copie garde la valeur du moment, le parent de l\'original ne la pilote plus', async () => {
    hote.titrer('Salut')
    await attendre(() => texte(original, '.titre') === 'Salut')
    await pause(30)
    assert.equal(texte(original, '.titre'), 'Salut')
    assert.equal(texte(copie, '.titre'), 'Bonjour')
  })

  it('le µmount de la copie joue une fois ; son reffet voit l\'état copié dès son premier tour et ne suit que sa variable', async () => {
    const monte = window.eval('window.__monte')
    assert.equal(monte.filter((u: number) => u === copie.uid).length, 1, JSON.stringify(monte))
    assert.equal(monte.filter((u: number) => u === original.uid).length, 1, JSON.stringify(monte))
    assert.notEqual(copie.uid, original.uid)
    const vus  = () => local(window.eval('window.__vus').filter((x: string) => x.startsWith(copie.uid + ':')))
    assert.equal(vus()[0], copie.uid + ':5', JSON.stringify(window.eval('window.__vus')))
    assert.deepEqual(vus(), [copie.uid + ':5', copie.uid + ':6'])
    await clic(original)
    assert.deepEqual(vus(), [copie.uid + ':5', copie.uid + ':6'])
    await clic(copie)
    assert.deepEqual(vus(), [copie.uid + ':5', copie.uid + ':6', copie.uid + ':7'])
  })

  it('$valider = -> $n++, appelé dans la copie, change la copie et pas l\'original ; appelé dans l\'original, l\'inverse', async () => {
    const n = (el: any) => Number(texte(el, '.n'))
    const [no, nc] = [n(original), n(copie)]
    copie._shadow.querySelector('.valider').click()
    await pause(30)
    assert.deepEqual([n(original), n(copie)], [no, nc + 1])
    original._shadow.querySelector('.valider').click()
    await pause(30)
    assert.deepEqual([n(original), n(copie)], [no + 1, nc + 1])
  })

  it('une balise qui n\'est pas un composant MJS : erreur claire (vouvoiement), rien n\'est copié ; le texte existe en français et en anglais', () => {
    const fr = /^\[ModularJS\] µclone : (<div>|null|<mjs-inconnu>|\[object Text\]) n'est pas un composant MJS, ou sa définition n'est pas encore chargée — aucun état à copier\. Pour copier une balise ordinaire, écrivez el\.cloneNode\(true\)\.$/
    for (const el of [window.document.createElement('div'), null, window.document.createElement('mjs-inconnu'), window.document.createTextNode('x')]) {
      assert.throws(() => window.µ.clone(el), (e: any) => fr.test(e.message) || assert.fail(e.message))
    }
    // la table des libellés (manifeste) : le texte français est celui du secours, l'anglais dit la même chose
    assert.match('[ModularJS] ' + RUNTIME_LABELS.fr.err.cloneNotComponent.replace('{tag}', '<div>'), fr)
    assert.match(RUNTIME_LABELS.en.err.cloneNotComponent.replace('{tag}', '<div>'), /^µclone: <div> is not an MJS component, or its definition has not loaded yet — there is no state to copy\. To copy a plain element, write el\.cloneNode\(true\)\.$/)
  })

  it('µ.clone depuis un script `lang="js"` : même copie vivante', async () => {
    window.document.body.insertAdjacentHTML('beforeend', '<mjs-jsliste></mjs-jsliste>')
    const h = window.document.querySelector('mjs-jsliste')
    await attendre(() => !!h._shadow && !!h._shadow.querySelector('mjs-carte')?._shadow?.querySelector('.n'))
    await pause(50)
    const o = h._shadow.querySelector('mjs-carte')
    await clic(o, 3)
    const k = h.dupliquer()
    await attendre(() => !!k._shadow?.querySelector('.n') && texte(k, '.n') === '3')
    assert.equal(texte(k, '.n'), '3')
    await clic(k)
    assert.equal(texte(k, '.n'), '4')
    assert.equal(texte(o, '.n'), '3')
  })

  it('une prop posée en propriété sur une balise pas encore montée (el.titre = …) : la copie la reçoit, comme l\'original à son montage', async () => {
    const el = window.document.createElement('mjs-carte')
    el.titre = 'PROP'
    const k  = window.µ.clone(el)
    window.document.body.append(el, k)
    await attendre(() => [el, k].every((x: any) => !!x._mjs_is_mounted && !!x._shadow?.querySelector('.titre')))
    await pause(30)
    assert.equal(texte(el, '.titre'), 'PROP')
    assert.equal(texte(k, '.titre'), 'PROP')
  })

  it('original monté : la copie reprend ce qu\'il affiche — une propriété écrite sur sa balise après son montage, qu\'il ne lit pas, ne passe pas dans la copie', async () => {
    const el = window.document.createElement('mjs-carte')
    el.titre = 'AVANT'
    window.document.body.append(el)
    await attendre(() => !!el._mjs_is_mounted && !!el._shadow?.querySelector('.titre'))
    await pause(30)
    el.titre = 'APRÈS'
    const k  = window.µ.clone(el)
    window.document.body.append(k)
    await attendre(() => !!k._mjs_is_mounted && !!k._shadow?.querySelector('.titre'))
    await pause(30)
    assert.equal(texte(el, '.titre'), 'AVANT')
    assert.equal(texte(k, '.titre'), 'AVANT')
  })

  it('une variable homonyme d\'une méthode ($compte et @compte) : la balise pas encore montée porte déjà la méthode, sa copie garde la valeur de la variable', async () => {
    const o = window.document.createElement('mjs-homonyme')
    window.document.body.append(o)
    await attendre(() => !!o._mjs_is_mounted && !!o._shadow?.querySelector('.c'))
    await pause(30)
    await clic(o, 3)
    const k1 = window.µ.clone(o)
    assert.ok(Object.prototype.hasOwnProperty.call(k1, 'compte') && typeof k1.compte === 'function', 'la copie pas encore posée porte sa méthode compte')
    const k2 = window.µ.clone(k1)
    window.document.body.append(k1, k2)
    await attendre(() => [k1, k2].every((x: any) => !!x._mjs_is_mounted && !!x._shadow?.querySelector('.c')))
    await pause(30)
    assert.deepEqual([texte(o, '.c'), texte(k1, '.c'), texte(k2, '.c')], ['3', '3', '3'])
  })

  it('la copie d\'une copie pas encore posée part de l\'état qui attend la première ; une prop posée ensuite en propriété sur la première passe devant, comme à son montage', async () => {
    const n  = texte(original, '.n')
    const k1 = window.µ.clone(original)
    k1.titre = 'PROP'
    const k2 = window.µ.clone(k1)
    window.document.body.append(k1, k2)
    await attendre(() => [k1, k2].every((x: any) => !!x._mjs_is_mounted && !!x._shadow?.querySelector('.n')))
    await pause(30)
    assert.notEqual(n, '0', 'l\'original a quitté son état de départ')
    assert.deepEqual([texte(k1, '.n'), texte(k1, '.titre')], [n, 'PROP'])
    assert.deepEqual([texte(k2, '.n'), texte(k2, '.titre')], [n, 'PROP'])
  })

  it('un composant léger (mjs-light), dont les enfants sont sa vue : seule sa balise est copiée, la copie construit la sienne avec l\'état copié', async () => {
    // happy-dom construit la balise avant d'y poser l'attribut `mjs-light` : le repli statique de la classe la dit légère, sa copie aussi
    window.customElements.get('mjs-leger').mjsLight = true
    const l = window.document.createElement('mjs-leger')
    window.document.body.append(l)
    assert.ok(l._mjs_isLight === true && l._shadow === l, 'un composant léger')
    await attendre(() => !!l._mjs_is_mounted && !!l.querySelector('.kp'))
    await pause(30)
    for (let i = 0; i < 3; i++) l.querySelector('.kp').click()
    await pause(30)
    const k = window.µ.clone(l)
    window.document.body.append(k)
    await attendre(() => !!k._mjs_is_mounted && !!k.querySelector('.k'))
    await pause(30)
    assert.equal(k.querySelectorAll('.kp').length, 1, 'une seule vue dans la copie')
    assert.equal(k.querySelector('.k').textContent, '3')
    k.querySelector('.kp').click()
    await pause(30)
    assert.deepEqual([l.querySelector('.k').textContent, k.querySelector('.k').textContent], ['3', '4'])
  })

  it('deux variables qui tiennent le même objet : dans la copie aussi, elles tiennent le même — sa copie, pas celui de l\'original', async () => {
    window.document.body.insertAdjacentHTML('beforeend', '<mjs-partage></mjs-partage>')
    const p = window.document.body.querySelector('mjs-partage')
    await attendre(() => !!p._mjs_is_mounted && !!p._shadow?.querySelector('.ab'))
    await pause(30)
    p.partager()
    await pause(30)
    const k = window.µ.clone(p)
    window.document.body.append(k)
    await attendre(() => !!k._mjs_is_mounted && !!k._shadow?.querySelector('.ab'))
    await pause(30)
    k.changerA()
    await pause(30)
    assert.deepEqual([texte(p, '.ab'), texte(k, '.ab')], ['1/1', '99/99'])
  })

  it('une donnée reçue en JSON qui porte les clés __proto__, constructor, prototype : la copie ne les reprend pas, son objet reste un objet simple', async () => {
    const p = window.document.body.querySelector('mjs-partage')
    p.charger('{"__proto__": {"pollue": 1}, "constructor": {"x": 1}, "prototype": 2, "ok": 3}')
    await pause(30)
    assert.deepEqual(local(Object.keys(brut(p._state.data))), ['__proto__', 'constructor', 'prototype', 'ok'], 'l\'original tient la donnée telle que reçue')
    const k = window.µ.clone(p)
    window.document.body.append(k)
    await attendre(() => !!k._mjs_is_mounted && !!k._shadow?.querySelector('.ab'))
    await pause(30)
    const d = brut(k._state.data)
    assert.deepEqual(local(Object.keys(d)), ['ok'])
    assert.equal(d.ok, 3)
    assert.equal(d.pollue, undefined, 'aucun prototype glissé par la clé __proto__')
    assert.ok(Object.getPrototypeOf(d) === window.eval('Object.prototype'), 'le prototype d\'un objet simple')
  })
})
