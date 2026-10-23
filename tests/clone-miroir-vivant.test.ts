// µclone el, mirror: true (rune) et µ.clone(el, { mirror: true }) (JavaScript) : le MIROIR VIVANT d'un composant — une balise neuve du même
// composant dont les variables `$` SONT celles de l'original (le même objet d'état). Construction réelle (le vrai Bundler), montée dans happy-dom.
//   1. le miroir naît avec l'état du moment : son script ($n = 0, une liste remplie au premier niveau) ne remet rien à zéro ;
//   2. +1 dans le miroir : l'original suit, dérivé compris ; +1 dans l'original : le miroir suit ;
//   3. saisie liée dans le miroir : l'original la voit, et l'inverse ;
//   4. prop changée par le parent de l'original : le miroir la voit ; l'attribut recopié sur la balise d'un miroir ne la remet pas à sa valeur de départ ;
//   5. liste ($items.push) et objet profond, dans les deux sens ; liste remplacée par un miroir ;
//   6. deux miroirs, miroir d'un miroir : un seul état ;
//   7. enfant rendu dans le gabarit : instance neuve, son état n'est pas partagé, sa prop suit l'état commun ;
//   8. µmount et reffets : dans chaque instance, comme dans tout composant ; `@@isMirror` vrai dans un miroir, faux dans l'original ;
//   9. miroir retiré : le groupe ne le tient plus, l'original continue ; remis : il reprend l'état du moment ;
//  10. original retiré : les miroirs gardent l'état, écrivent et se préviennent — dérivé, liste et objet compris ; l'état ne tient plus l'original ;
//  11. erreurs : balise qui n'est pas un composant (même erreur que µclone), option inconnue (français et anglais) ; `mirror: false` : la copie ;
//  12. rune en CoffeeScript, µ.clone en JavaScript ;
//  13. fuite : 1 000 miroirs créés puis retirés — le groupe n'en garde aucun, l'état n'en tient aucun ; une écriture coûte selon le nombre d'instances

import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { compilerScript } from './helpers/navigateurs-compiles.js'
import { attendre, pause } from './helpers/coeur-monter.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { SOURCES_MIROIR } from './helpers/composants-miroir.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'

// un composant léger en calcul, pour les mille miroirs
const SOURCES_EN_PLUS: Record<string, string> = {
  'pastille.mjs': [
    '<script>',
    '  $n = 0',
    '  $l = [1]',
    '</script>',
    '<b class="n">{$n}</b>',
    '<button class="plus" @click={$n++}>+</button>',
    ''
  ].join('\n')
}

describe('µclone mirror: true — le miroir vivant d\'un composant partage l\'état de l\'original (happy-dom)', function () {
  this.timeout(180000)

  let window: any, hote: any, zone: any, original: any, m1: any, m2: any, m3: any
  const texte = (el: any, sel: string) => el._shadow.querySelector(sel).textContent
  const brut  = (v: any) => window.µ._mjs_toRaw(v)
  const clic  = async (el: any, sel = '.plus', n = 1) => { for (let i = 0; i < n; i++) el._shadow.querySelector(sel).click(); await pause(30) }
  const monte = (els: any[]) => attendre(() => els.every((x: any) => !!x._mjs_is_mounted && !!x._shadow?.querySelector('.n')), 10000)
  const tous  = (sel: string) => [original, m1, m2, m3].filter(Boolean).map((x: any) => texte(x, sel))
  const miroir = async (de: any) => {
    const m = hote.miroir(de)
    zone.append(m)
    await monte([m])
    await pause(40)
    return m
  }

  before(async () => {
    const code = await compilerScript('clone-miroir-vivant', { ...SOURCES_MIROIR, ...SOURCES_EN_PLUS })
    window = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    window.eval('window.__monte = []; window.__vus = [];')
    window.eval(code)
    window.document.body.innerHTML = '<mjs-liste></mjs-liste>'
    hote = window.document.querySelector('mjs-liste')
    await attendre(() => !!hote._shadow && !!hote._shadow.querySelector('mjs-carte')?._mjs_is_mounted && !!hote._shadow.querySelector('mjs-carte')._shadow?.querySelector('.n'))
    await pause(80)
    original = hote._shadow.querySelector('mjs-carte')
    zone     = hote._shadow.querySelector('.zone')
    // l'original s'éloigne de son état de départ
    await clic(original, '.plus', 5)
    original.ajouter('b')
    await pause(30)
  })

  after(async () => {
    await window?.happyDOM?.close?.()
    await terminateSharedWorkerPool()
  })

  it('le miroir naît avec l\'état du moment : son script ne remet rien à zéro, même une liste remplie au premier niveau', async () => {
    m1 = await miroir(original)
    assert.ok(m1 !== original && m1.localName === 'mjs-carte')
    assert.ok(m1._state === original._state, 'le même objet d\'état')
    assert.deepEqual([texte(m1, '.n'), texte(m1, '.double'), texte(m1, '.titre'), texte(m1, '.noms'), texte(m1, '.remplie')], ['5', '10', 'Bonjour', 'a,b', '1,2'])
    assert.deepEqual([texte(original, '.n'), texte(original, '.noms'), texte(original, '.remplie')], ['5', 'a,b', '1,2'])
    assert.equal(m1.querySelector('.glisse')?.textContent, 'glissé', 'le contenu glissé est recopié')
    assert.equal(m1.isMirror, true)
    assert.equal(original.isMirror, false)
  })

  it('+1 dans le miroir : l\'original suit, dérivé compris ; +1 dans l\'original : le miroir suit', async () => {
    await clic(m1)
    assert.deepEqual(tous('.n'), ['6', '6'])
    assert.deepEqual(tous('.double'), ['12', '12'])
    await clic(original, '.plus', 2)
    assert.deepEqual(tous('.n'), ['8', '8'])
    assert.deepEqual(tous('.double'), ['16', '16'])
  })

  it('saisie liée dans le miroir : l\'original la voit, et l\'inverse', async () => {
    const saisir = async (el: any, v: string) => {
      const i = el._shadow.querySelector('.saisie')
      i.value = v
      i.dispatchEvent(new window.Event('input', { bubbles: true }))
      await pause(30)
    }
    await saisir(m1, 'salut')
    assert.deepEqual(tous('.texte'), ['salut', 'salut'])
    assert.equal(original._shadow.querySelector('.saisie').value, 'salut')
    await saisir(original, 'oui')
    assert.deepEqual(tous('.texte'), ['oui', 'oui'])
    assert.equal(m1._shadow.querySelector('.saisie').value, 'oui')
  })

  it('prop changée par le parent de l\'original : le miroir la voit ; l\'attribut recopié sur un miroir ne la remet pas à sa valeur de départ', async () => {
    hote.titrer('Salut')
    await pause(40)
    assert.deepEqual(tous('.titre'), ['Salut', 'Salut'])
    // une balise posée avec un attribut, renommée par son script, puis copiée en miroir : l'attribut recopié n'est pas relu dans l'état commun
    const el = window.document.createElement('mjs-carte')
    el.setAttribute('titre', 'Statique')
    window.document.body.append(el)
    await monte([el])
    await pause(30)
    assert.equal(texte(el, '.titre'), 'Statique')
    el.renommer('Changé')
    await pause(30)
    const k = window.µ.clone(el, { mirror: true })
    assert.equal(k.getAttribute('titre'), 'Statique', 'les attributs sont recopiés')
    window.document.body.append(k)
    await monte([k])
    await pause(40)
    assert.deepEqual([texte(el, '.titre'), texte(k, '.titre')], ['Changé', 'Changé'])
    el.remove()
    k.remove()
  })

  it('liste ($items.push) et objet profond, dans les deux sens ; une liste remplacée par un miroir reste suivie', async () => {
    m1.ajouter('c')
    await pause(30)
    assert.deepEqual(tous('.noms'), ['a,b,c', 'a,b,c'])
    original.ajouter('d')
    await pause(30)
    assert.deepEqual(tous('.noms'), ['a,b,c,d', 'a,b,c,d'])
    m1.creuser()
    await pause(30)
    assert.deepEqual(tous('.profond'), ['2', '2'])
    original.creuser()
    await pause(30)
    assert.deepEqual(tous('.profond'), ['3', '3'])
    m1.remplacer()
    await pause(30)
    assert.deepEqual(tous('.noms'), ['z', 'z'])
    original.ajouter('y')
    await pause(30)
    m1.ajouter('x')
    await pause(30)
    assert.deepEqual(tous('.noms'), ['z,y,x', 'z,y,x'])
  })

  it('deux miroirs, miroir d\'un miroir : un seul état, chaque écriture redessine toutes les instances', async () => {
    m2 = await miroir(original)
    m3 = await miroir(m1)
    assert.ok(m3._state === original._state && m2._state === original._state)
    assert.deepEqual(tous('.n'), ['8', '8', '8', '8'])
    await clic(m3)
    assert.deepEqual(tous('.n'), ['9', '9', '9', '9'])
    assert.deepEqual(tous('.double'), ['18', '18', '18', '18'])
    await clic(m2)
    assert.deepEqual(tous('.n'), ['10', '10', '10', '10'])
  })

  it('enfant rendu dans le gabarit du miroir : instance neuve, son état n\'est pas partagé, sa prop suit l\'état commun', async () => {
    const enfant = (el: any) => el._shadow.querySelector('mjs-compteur')
    assert.ok(enfant(m1) !== enfant(original))
    await clic(enfant(m1), '.propre-plus')
    assert.equal(texte(enfant(m1), '.propre'), '1')
    assert.equal(texte(enfant(original), '.propre'), '0')
    assert.ok(enfant(m1)._state !== enfant(original)._state)
    await clic(m2)
    assert.deepEqual([original, m1, m2, m3].map((x: any) => texte(enfant(x), '.base')), ['11', '11', '11', '11'])
  })

  it('µmount et reffets jouent dans chaque instance ; @@isMirror vaut true dans un miroir, false dans l\'original', async () => {
    const monteLe = (el: any) => [...window.__monte.filter((x: any) => x[0] === el.uid).map((x: any) => x[1])]
    assert.deepEqual(monteLe(original), [false])
    for (const m of [m1, m2, m3]) assert.deepEqual(monteLe(m), [true])
    const avant = window.__vus.length
    await clic(original)
    await pause(30)
    const vus = window.__vus.slice(avant)
    for (const el of [original, m1, m2, m3]) assert.ok(vus.includes(el.uid + ':12'), JSON.stringify(vus))
  })

  it('miroir retiré : le groupe ne le tient plus, l\'original continue ; remis, il reprend l\'état du moment', async () => {
    const g = original._mjs_twins
    m2.remove()
    await pause(30)
    assert.ok(!g.m.includes(m2), 'le miroir retiré quitte le groupe')
    const n = Number(texte(original, '.n'))
    await clic(original)
    assert.deepEqual([original, m1, m3].map((x: any) => texte(x, '.n')), [String(n + 1), String(n + 1), String(n + 1)])
    zone.append(m2)
    await monte([m2])
    await pause(40)
    assert.ok(g.m.includes(m2))
    assert.equal(texte(m2, '.n'), String(n + 1))
    await clic(m2)
    assert.deepEqual(tous('.n'), Array(4).fill(String(n + 2)))
  })

  it('original retiré : les miroirs gardent l\'état, écrivent et se préviennent — dérivé, liste et objet compris ; l\'état ne tient plus l\'original', async () => {
    const g = original._mjs_twins, etat = original._state, parent = original.parentNode
    original.remove()
    await pause(30)
    assert.ok(!g.m.includes(original) && g.h !== original && g.m.includes(g.h), 'la maison passe à un miroir présent')
    const n = Number(texte(m1, '.n'))
    await clic(m1)
    const restants = [m1, m2, m3]
    assert.deepEqual(restants.map((x: any) => texte(x, '.n')), Array(3).fill(String(n + 1)))
    assert.deepEqual(restants.map((x: any) => texte(x, '.double')), Array(3).fill(String((n + 1) * 2)))
    m3.ajouter('w')
    await pause(30)
    assert.deepEqual(restants.map((x: any) => texte(x, '.noms')), Array(3).fill('z,y,x,w'))
    m2.creuser()
    await pause(30)
    assert.deepEqual(restants.map((x: any) => texte(x, '.profond')), Array(3).fill('4'))
    // les enveloppes de l'état sont celles de la maison présente, pas de l'original
    for (const k of ['items', 'profond', 'remplie']) assert.ok(g.h._mjs_proxyCache.get(brut(etat[k])) === etat[k], k)
    // remis dans la page, l'original reprend l'état du moment
    parent.prepend(original)
    await monte([original])
    await pause(40)
    assert.deepEqual([texte(original, '.n'), texte(original, '.double'), texte(original, '.noms')], [String(n + 1), String((n + 1) * 2), 'z,y,x,w'])
    await clic(original)
    assert.deepEqual(tous('.n'), Array(4).fill(String(n + 2)))
  })

  it('erreurs : balise qui n\'est pas un composant (même erreur que µclone), option inconnue (français et anglais) ; mirror: false rend une copie', () => {
    const pasComposant = /^\[ModularJS\] µclone : (<div>|null) n'est pas un composant MJS, ou sa définition n'est pas encore chargée — aucun état à copier\. Pour copier une balise ordinaire, écrivez el\.cloneNode\(true\)\.$/
    for (const el of [window.document.createElement('div'), null]) {
      assert.throws(() => window.µ.clone(el, { mirror: true }), (e: any) => pasComposant.test(e.message) || assert.fail(e.message))
    }
    const option = (o: string) => new RegExp('^\\[ModularJS\\] µclone : option « ' + o + ' » inconnue — la seule option est mirror : µclone el, mirror: true rend un miroir vivant, qui partage l\'état de l\'original\\.$')
    assert.throws(() => window.µ.clone(m1, { miroir: true }), (e: any) => option('miroir').test(e.message) || assert.fail(e.message))
    assert.throws(() => window.µ.clone(m1, true), (e: any) => option('true').test(e.message) || assert.fail(e.message))
    assert.match('[ModularJS] ' + RUNTIME_LABELS.fr.err.cloneOption.replace('{opt}', 'miroir'), option('miroir'))
    assert.match(RUNTIME_LABELS.en.err.cloneOption.replace('{opt}', 'miroir'), /^µclone: unknown option "miroir" — the only option is mirror: µclone el, mirror: true returns a live mirror, which shares the state of the original\.$/)
    const copie = window.µ.clone(m1, { mirror: false })
    assert.ok(copie._state !== m1._state && copie.isMirror === false, 'mirror: false : la copie indépendante')
  })

  it('rune en CoffeeScript et µ.clone en JavaScript : le même miroir', async () => {
    window.document.body.insertAdjacentHTML('beforeend', '<mjs-cofmiroir></mjs-cofmiroir><mjs-jsmiroir></mjs-jsmiroir>')
    const cof = window.document.querySelector('mjs-cofmiroir'), js = window.document.querySelector('mjs-jsmiroir')
    await attendre(() => typeof cof.miroir === 'function' && typeof js.miroir === 'function')
    const a = cof.miroir(m1), b = js.miroir(m1)
    zone.append(a, b)
    await monte([a, b])
    await pause(40)
    assert.ok(a._state === m1._state && b._state === m1._state && a.isMirror && b.isMirror)
    await clic(a)
    const n = texte(m1, '.n')
    assert.deepEqual([texte(b, '.n'), texte(original, '.n')], [n, n])
    a.remove()
    b.remove()
    await pause(30)
  })

  it('fuite : 1 000 miroirs créés puis retirés — le groupe n\'en garde aucun, l\'état n\'en tient aucun', async () => {
    const p = window.document.createElement('mjs-pastille')
    window.document.body.append(p)
    await monte([p])
    const boite = window.document.createElement('div')
    window.document.body.append(boite)
    const miroirs = Array.from({ length: 1000 }, () => window.µ.clone(p, { mirror: true }))
    boite.append(...miroirs)
    await monte(miroirs)
    await pause(60)
    const g = p._mjs_twins
    assert.equal(g.m.length, 1001)
    window.µ._set(p, 'n', 7)
    await pause(30)
    assert.deepEqual([texte(miroirs[0], '.n'), texte(miroirs[999], '.n')], ['7', '7'])
    // une liste écrite par un miroir est enveloppée par la maison (l'original présent), pas par le miroir
    window.µ._set(miroirs[5], 'l', [9])
    await pause(30)
    assert.ok(p._mjs_proxyCache.get(brut(p._state.l)) === p._state.l)
    boite.remove()
    await pause(60)
    assert.equal(g.m.length, 1)
    assert.ok(g.m[0] === p && g.h === p)
    // retiré, un miroir qui écrit encore prévient le groupe sans y revenir
    window.µ._set(miroirs[3], 'n', 8)
    await pause(30)
    assert.equal(texte(p, '.n'), '8')
    assert.equal(g.m.length, 1)
    p.remove()
  })
})
