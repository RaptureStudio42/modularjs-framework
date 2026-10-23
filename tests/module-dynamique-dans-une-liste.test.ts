// POURQUOI CE FICHIER EXISTE
// Le défaut d'origine : `{for f in $familles}<@module f.comp titre={f.nom}></@module>{end}` échouait à
// l'affichage avec « f is not defined ». Le compilateur posait l'effet qui monte le composant au
// niveau du COMPOSANT hôte, hors de la portée de la ligne : la variable de la boucle (`f`) n'y existait
// pas, et le repère du placeholder (`mjs-mod="0"`) était le même pour toutes les lignes, si bien qu'une
// seule aurait de toute façon été retrouvée.
// Rencontré en refaisant une page à onglets : une famille d'exemples = une ligne de liste, dont le
// composant d'affichage est choisi par un champ de la ligne.
// Ce que ces tests gardent : chaque ligne monte SON composant, avec SES props, quelle que soit la forme
// du nom (variable de boucle, champ, expression, index), dans une boucle imbriquée ou sous un `{if}`
// de ligne ; la liste qui change (ajout, retrait, changement de composant d'une ligne) suit ; le
// `<@module>` hors boucle ne bouge pas. Les noms y sont écrits en entier (`mjs-tuto-card-a`) pour que ce
// fichier ne dépende que de la portée de la ligne ; le nom court a son propre fichier.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterModule, pause, balises, textes } from './helpers/module-dynamique.js'
import { assertAbsent } from './helpers/dom-assert.js'

const CARTE_A = '<script>\n$titre = \'\'\n</script>\n<p class="a">A:{$titre}</p>\n'
const CARTE_B = '<script>\n$titre = \'\'\n</script>\n<p class="b">B:{$titre}</p>\n'
const CARTES  = { 'tuto-card-a': CARTE_A, 'tuto-card-b': CARTE_B }

const FAMILLES = '[{ comp: \'mjs-tuto-card-a\', nom: \'Un\', k: \'a\', on: true }, { comp: \'mjs-tuto-card-b\', nom: \'Deux\', k: \'b\', on: false }, { comp: \'mjs-tuto-card-a\', nom: \'Trois\', k: \'a\', on: true }]'

const hote = (corps: string, init = `$familles = ${FAMILLES}`) => `<script>\n${init}\n@maj = (v) -> $familles = v\n</script>\n${corps}\n`

// le texte de chaque composant monté, dans l'ordre
const rendus = (h: any) => [...h._shadow.querySelectorAll('mjs-tuto-card-a, mjs-tuto-card-b')].map((c: any) => c.localName.slice(14) + ':' + c._shadow.querySelector('p').textContent.trim())

describe('<@module> dans un {for}', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('nom = champ de la ligne (`f.comp`), prop lue sur la ligne (`titre={f.nom}`) : chaque ligne monte SON composant', async () => {
    const { hote: h, erreurs } = await monterModule({ hote: hote('{for f in $familles}<@module f.comp titre={f.nom}></@module>{end}'), ...CARTES })
    assert.deepEqual(erreurs(), [])
    assert.deepEqual(rendus(h), ['a:A:Un', 'b:B:Deux', 'a:A:Trois'])
  })

  it('nom = la variable de boucle elle-même (liste de noms)', async () => {
    const { hote: h, erreurs } = await monterModule({ hote: hote('{for c in $familles}<@module c titre="x"></@module>{end}', '$familles = [\'mjs-tuto-card-a\', \'mjs-tuto-card-b\']'), ...CARTES })
    assert.deepEqual(erreurs(), [])
    assert.deepEqual(rendus(h), ['a:A:x', 'b:B:x'])
  })

  it('nom = expression construite à partir de la ligne (`\'mjs-tuto-card-\'+f.k`)', async () => {
    const { hote: h, erreurs } = await monterModule({ hote: hote('{for f in $familles}<@module \'mjs-tuto-card-\'+f.k titre={f.nom}></@module>{end}'), ...CARTES })
    assert.deepEqual(erreurs(), [])
    assert.deepEqual(rendus(h), ['a:A:Un', 'b:B:Deux', 'a:A:Trois'])
  })

  it('nom = lecture par l\'index de la ligne (`noms[i]`)', async () => {
    const { hote: h, erreurs } = await monterModule({ hote: hote('{for i, f in $familles}<@module noms[i] titre={f.nom}></@module>{end}', `$familles = ${FAMILLES}\nnoms = ['mjs-tuto-card-b', 'mjs-tuto-card-a', 'mjs-tuto-card-b']`), ...CARTES })
    assert.deepEqual(erreurs(), [])
    assert.deepEqual(rendus(h), ['b:B:Un', 'a:A:Deux', 'b:B:Trois'])
  })

  it('{for} imbriqué : le nom et les props lisent la ligne interne ET la ligne externe', async () => {
    const corps = '{for g in $groupes}{for f in g.items}<@module f.comp titre={g.nom+f.nom}></@module>{end}{end}'
    const init  = '$groupes = [{ nom: \'G1-\', items: [{ comp: \'mjs-tuto-card-a\', nom: \'x\' }, { comp: \'mjs-tuto-card-b\', nom: \'y\' }] }, { nom: \'G2-\', items: [{ comp: \'mjs-tuto-card-b\', nom: \'z\' }] }]'
    const { hote: h, erreurs } = await monterModule({ hote: `<script>\n${init}\n</script>\n${corps}\n`, ...CARTES })
    assert.deepEqual(erreurs(), [])
    assert.deepEqual(rendus(h), ['a:A:G1-x', 'b:B:G1-y', 'b:B:G2-z'])
  })

  it('<@module> dans un {if} de la ligne : monté seulement pour les lignes dont la condition est vraie', async () => {
    const { hote: h, erreurs } = await monterModule({ hote: hote('{for f in $familles}{if f.on}<@module f.comp titre={f.nom}></@module>{end}{end}'), ...CARTES })
    assert.deepEqual(erreurs(), [])
    assert.deepEqual(rendus(h), ['a:A:Un', 'a:A:Trois'])
  })

  it('<@module> entouré de frères dans la ligne : ordre et contenu gardés', async () => {
    const { hote: h, erreurs } = await monterModule({ hote: hote('{for f in $familles}<section class="l"><h2>{f.nom}</h2><@module f.comp titre={f.nom}></@module><hr></section>{end}'), ...CARTES })
    assert.deepEqual(erreurs(), [])
    assert.deepEqual(textes({ _shadow: h._shadow }, 'section h2'), ['Un', 'Deux', 'Trois'])
    assert.deepEqual(rendus(h), ['a:A:Un', 'b:B:Deux', 'a:A:Trois'])
    assert.equal(h._shadow.querySelectorAll('section.l > hr').length, 3)
  })

  it('la liste change : une ligne ajoutée monte son composant, une ligne retirée disparaît', async () => {
    const { hote: h, erreurs } = await monterModule({ hote: hote('{for f in $familles}<@module f.comp titre={f.nom}></@module>{end}'), ...CARTES })
    h.maj([...h._state.familles, { comp: 'mjs-tuto-card-b', nom: 'Quatre' }])
    await pause(120)
    assert.deepEqual(rendus(h), ['a:A:Un', 'b:B:Deux', 'a:A:Trois', 'b:B:Quatre'])
    h.maj(h._state.familles.slice(1))
    await pause(120)
    assert.deepEqual(rendus(h), ['b:B:Deux', 'a:A:Trois', 'b:B:Quatre'])
    assert.deepEqual(erreurs(), [])
  })

  it('le composant d\'UNE ligne change : seule cette ligne est remontée, les autres gardent leur nœud', async () => {
    const { hote: h } = await monterModule({ hote: hote('{for f in $familles}<@module f.comp titre={f.nom}></@module>{end}'), ...CARTES })
    const avant = [...h._shadow.querySelectorAll('mjs-tuto-card-a, mjs-tuto-card-b')]
    h.maj(h._state.familles.map((f: any, i: number) => i === 1 ? { ...f, comp: 'mjs-tuto-card-a' } : f))
    await pause(150)
    assert.deepEqual(rendus(h), ['a:A:Un', 'a:A:Deux', 'a:A:Trois'])
    const apres = [...h._shadow.querySelectorAll('mjs-tuto-card-a, mjs-tuto-card-b')]
    assert.equal(apres[0] === avant[0] && apres[2] === avant[2], true, 'lignes 1 et 3 : même nœud')
  })

  it('une variable lue par la prop d\'une ligne change : le composant monté la reçoit sans être remonté', async () => {
    const { hote: h } = await monterModule({ hote: hote('{for f in $familles}<@module f.comp titre={f.nom+$s}></@module>{end}', `$familles = ${FAMILLES}\n$s = ''\n@suf = (v) -> $s = v`), ...CARTES })
    const avant = h._shadow.querySelector('mjs-tuto-card-a')
    h.suf('!')
    await pause(150)
    assert.deepEqual(rendus(h), ['a:A:Un!', 'b:B:Deux!', 'a:A:Trois!'])
    assert.equal(h._shadow.querySelector('mjs-tuto-card-a') === avant, true)
  })

  it('nom COURT dans une ligne (`f.comp` = `tuto-card-a`) : les deux défauts se combinent sans se gêner', async () => {
    const { hote: h, erreurs } = await monterModule({ hote: hote('{for f in $familles}<@module f.comp titre={f.nom}></@module>{end}', '$familles = [{ comp: \'tuto-card-a\', nom: \'Un\' }, { comp: \'tuto-card-b\', nom: \'Deux\' }]'), ...CARTES })
    assert.deepEqual(erreurs(), [])
    assert.deepEqual(rendus(h), ['a:A:Un', 'b:B:Deux'])
  })

  it('garde — hors boucle, <@module> monte comme avant', async () => {
    const { hote: h, erreurs } = await monterModule({ hote: `<script>\n$comp = 'mjs-tuto-card-b'\n</script>\n<@module $comp titre="Seul"></@module>\n`, ...CARTES })
    assert.deepEqual(erreurs(), [])
    assert.deepEqual(rendus(h), ['b:B:Seul'])
  })
})

// la portée du nœud ne sert pas qu'aux boucles : un `<@module>` dans un `{if}` ouvert plus tard, ou
// dont les attributs sont dynamiques, doit lui aussi trouver son composant
describe('<@module> dans une branche et avec des attributs dynamiques', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('variable CONSTANTE dans un {if} ouvert plus tard : le composant est monté à l\'ouverture (avant, rien ne se montait)', async () => {
    const h0 = '<script>\n$ouvert = false\ncomp = \'mjs-tuto-card-a\'\n@ouvrir = (v) -> $ouvert = v\n</script>\n{if $ouvert}<@module comp titre="Tard"></@module>{end}\n'
    const { hote: h, erreurs } = await monterModule({ hote: h0, ...CARTES })
    assert.deepEqual(rendus(h), [])
    h.ouvrir(true)
    await pause(120)
    assert.deepEqual(rendus(h), ['a:A:Tard'])
    assert.deepEqual(erreurs(), [])
  })

  it('variable RÉACTIVE jamais modifiée (`$comp = \'…\'`) dans un {if} ouvert plus tard : monté à l\'ouverture', async () => {
    const h0 = '<script>\n$ouvert = false\n$comp = \'mjs-tuto-card-a\'\n@ouvrir = (v) -> $ouvert = v\n</script>\n<p>avant</p>\n{if $ouvert}<@module $comp titre="Tard"></@module>{end}\n'
    const { hote: h, erreurs } = await monterModule({ hote: h0, ...CARTES })
    h.ouvrir(true)
    await pause(150)
    assert.deepEqual(rendus(h), ['a:A:Tard'])
    assert.deepEqual(erreurs(), [])
  })

  it('nom DÉRIVÉ de la condition du {if} (`$comp = $tout ? … : \'\'`) : monté quand le {if} s\'ouvre — le cas de la page à onglets', async () => {
    const h0 = '<script>\n$tout = false\n$comp = $tout ? \'mjs-tuto-card-a\' : \'\'\n@tout = (v) -> $tout = v\n</script>\n{if $tout}<@module $comp titre="Onglet"></@module>{end}\n'
    const { hote: h, erreurs } = await monterModule({ hote: h0, ...CARTES })
    h.tout(true)
    await pause(150)
    assert.deepEqual(rendus(h), ['a:A:Onglet'])
    assert.deepEqual(erreurs(), [])
  })

  it('le {if} se referme puis se rouvre : le composant est remonté à chaque ouverture', async () => {
    const h0 = '<script>\n$ouvert = true\n$comp = \'mjs-tuto-card-b\'\n@ouvrir = (v) -> $ouvert = v\n</script>\n{if $ouvert}<@module $comp titre="Deux fois"></@module>{end}\n'
    const { hote: h } = await monterModule({ hote: h0, ...CARTES })
    assert.deepEqual(rendus(h), ['b:B:Deux fois'])
    h.ouvrir(false)
    await pause(100)
    assert.deepEqual(rendus(h), [])
    h.ouvrir(true)
    await pause(120)
    assert.deepEqual(rendus(h), ['b:B:Deux fois'])
  })

  it('attributs dynamiques `class={…}` et `data-*={…}` : posés sur le composant, suivis quand ils changent, dans une ligne', async () => {
    const { hote: h } = await monterModule({ hote: hote('{for f in $familles}<@module f.comp class={f.on ? \'actif\' : \'\'} data-nom={f.nom + $s}></@module>{end}', `$familles = ${FAMILLES}\n$s = ''\n@suf = (v) -> $s = v`), ...CARTES })
    const cs = [...h._shadow.querySelectorAll('mjs-tuto-card-a, mjs-tuto-card-b')]
    assert.deepEqual(cs.map((c: any) => c.getAttribute('class') || ''), ['actif', '', 'actif'])
    assert.deepEqual(cs.map((c: any) => c.getAttribute('data-nom')), ['Un', 'Deux', 'Trois'])
    h.suf('?')
    await pause(120)
    assert.deepEqual([...h._shadow.querySelectorAll('mjs-tuto-card-a, mjs-tuto-card-b')].map((c: any) => c.getAttribute('data-nom')), ['Un?', 'Deux?', 'Trois?'])
  })

  it('garde — les enfants du <@module> sont déplacés vers le slot du composant monté', async () => {
    const AVEC_SLOT = '<script>\n$titre = \'\'\n</script>\n<section><slot></slot></section>\n'
    const { hote: h } = await monterModule({ hote: '<script>\n$comp = \'mjs-tuto-slot\'\n</script>\n<@module $comp><b class="x">projeté</b></@module>\n', 'tuto-slot': AVEC_SLOT })
    const c = h._shadow.querySelector('mjs-tuto-slot')
    assert.equal(c.querySelector('b.x').textContent, 'projeté', 'l\'enfant est dans le light DOM du composant, donc assigné à son <slot>')
  })

  it('garde — <@element> avec une balise native garde son comportement', async () => {
    const { hote: h } = await monterModule({ hote: '<script>\n$niveau = \'h2\'\n@niveau = (v) -> $niveau = v\n</script>\n<@element $niveau class="t">Titre</@element>\n' })
    assert.equal(h._shadow.querySelector('h2.t').textContent, 'Titre')
    h.niveau('h3')
    await pause(80)
    assert.equal(h._shadow.querySelector('h3.t').textContent, 'Titre')
    assertAbsent(h._shadow.querySelector('h2'))
  })

  it('garde — l\'ancien composant démonté n\'appelle plus le gestionnaire du <@module>', async () => {
    const EMET = '<script>\n@envoyer = -> µemit \'copier\', \'bonjour\'\n</script>\n<button class="b" @click={@envoyer()}>b</button>\n'
    const h0   = '<script>\n$comp = \'mjs-tuto-emet\'\n$n = 0\n@maj = (c) -> $comp = c\n@compter = -> $n += 1\n</script>\n<@module $comp @copier={@compter()}></@module><i class="n">{$n}</i>\n'
    const { hote: h } = await monterModule({ hote: h0, 'tuto-emet': EMET, ...CARTES })
    const ancien = h._shadow.querySelector('mjs-tuto-emet')
    ancien._shadow.querySelector('.b').click()
    await pause(60)
    h.maj('mjs-tuto-card-a')
    await pause(100)
    ancien._shadow.querySelector('.b').click()
    await pause(60)
    assert.equal(h._shadow.querySelector('.n').textContent.trim(), '1', 'un seul appel : celui d\'avant le changement')
  })
})
