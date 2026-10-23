// Éditeur de texte riche du cœur (<@@editor>) : le nom caché de chaque ligne à cocher (`data-key`), joué dans happy-dom en construction de développement.
// Le mode « répondre » retient les cases cochées par le NOM de leur ligne et non par sa position : la coche reste sur sa ligne quand l'auteur modifie la liste.
// - le nom est une lettre minuscule suivie de trois caractères [a-z0-9] (jamais que des chiffres), gardé dans le HTML du modèle sur la ligne (`<li data-key="…">`) ; un
//   autre nom, ou un nom posé ailleurs que sur une ligne à cocher, est retiré par le nettoyeur ;
// - l'éditeur de l'auteur (saisie, outil des cases) donne un nom neuf à toute ligne qui n'en a pas (ligne créée, texte ancien) et renomme tout doublon : Entrée au milieu d'une
//   ligne (la première garde son nom, la nouvelle en reçoit un neuf), ligne copiée, texte collé qui porte déjà des noms ; une ligne vide ne prend le nom de personne ; un nom neuf
//   n'est jamais celui d'une autre ligne ;
// - mode « répondre » : `checked` est la liste des noms cochés, le formulaire envoie le nom de chaque ligne cochée, la remise à zéro rend les noms de départ, un nom inconnu du
//   texte est ignoré ;
// - repli : une ligne sans nom se désigne par sa position dans le texte (0, 1, 2…), comme avant : un texte sans aucun nom marche exactement comme avant ; un nom déjà porté par une
//   ligne plus haute ne compte pas pour la suivante, qui se désigne par sa position.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monter } from './helpers/editeur-riche.js'

const TEXTE    = '<p>Cochez</p><ul data-checklist><li data-key="aa11">Un</li><li data-key="bb22">Deux<ul data-checklist><li data-key="cc33">Deux-un</li></ul></li><li data-key="dd44">Trois</li></ul>'
const ANCIEN   = '<p>Avant</p><ul data-checklist><li>Pomme</li><li data-checked>Poire</li><li>Prune</li></ul>'
const MIXTE    = '<ul data-checklist><li>A</li><li data-key="cc33">B</li><li>C</li></ul>'
const DOUBLES  = '<ul data-checklist><li data-key="aa11">X</li><li data-key="aa11">Y</li><li data-key="bb22">Z</li></ul>'
const SANS     = '<ul data-checklist><li data-key="aa11">A</li><li>B</li></ul>'
const INVALIDE = '<ul data-checklist><li data-key="AB12">a</li><li data-key="abc">b</li><li data-key="abcde">c</li><li data-key="1abc">d</li><li data-key="a-b1">e</li><li data-key="ok99" data-checked>f</li></ul><ul><li data-key="zz11">g</li></ul><ol><li data-key="yy22">h</li></ol>'

const HOTE = `<script>
  $texte    = '${TEXTE}'
  $coches   = ['bb22']
  $ancien   = '${ANCIEN}'
  $cancien  = [1]
  $mixte    = '${MIXTE}'
  $cmixte   = [2, 'cc33']
  $doubles  = '${DOUBLES}'
  $cdoubles = ['aa11']
  $vieux    = '${ANCIEN}'
  $inval    = '${INVALIDE}'
  $sans     = '${SANS}'
  $reps     = []

  @noterReps = (e)->
    $reps = [...$reps, e.type + ':' + JSON.stringify(e.data)]

  µmount ->
    window.__poser = (nom, v)->
      if nom == 'texte' then $texte = v
      else if nom == 'coches' then $coches = v
      else if nom == 'cmixte' then $cmixte = v
      else if nom == 'cdoubles' then $cdoubles = v
    window.__etat = -> { texte: $texte, coches: $coches, vieux: $vieux, cancien: $cancien }
</script>

<form class="f" @noUJS>
  <@@editor class="a" name="modele" value=!{$texte}></@@editor>
  <@@editor class="v" name="vieux" value=!{$vieux}></@@editor>
  <@@editor class="i" name="inval" toolbar="none" value={$inval}></@@editor>
  <@@editor class="s" name="sans" toolbar="bold italic" value=!{$sans}></@@editor>
  <@@editor class="r" name="reps[]" answer value={$texte} checked=!{$coches} @change={@noterReps(e)}></@@editor>
  <@@editor class="n" name="anc[]" answer value={$ancien} checked=!{$cancien}></@@editor>
  <@@editor class="m" name="mix[]" answer value={$mixte} checked=!{$cmixte}></@@editor>
  <@@editor class="d" name="dbl[]" answer value={$doubles} checked=!{$cdoubles}></@@editor>
  <button type="reset" class="rz">reset</button>
</form>
<pre class="evr">{$reps.join(',')}</pre>
`

const FORME = /^[a-z][a-z0-9]{3}$/
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('éditeur riche : le nom caché des lignes à cocher (happy-dom)', function () {
  this.timeout(180000)
  let window: any
  let hote: any

  const ed      = (c: string): any => hote._shadow.querySelector('.' + c)
  const surface = (c: string): any => ed(c)._shadow.querySelector('.surface')
  const lignes  = (c: string): any[] => Array.from(surface(c).querySelectorAll('.line'))
  const etats   = (c: string): string => lignes(c).map((l: any) => l.getAttribute('aria-checked')).join(',')
  const hidden  = (c: string): any[] => Array.from(ed(c).children).filter((x: any) => x.localName === 'input' && x.type === 'hidden')
  const champs  = (c: string): string[] => hidden(c).map((x: any) => x.name + '=' + x.value)
  const valeur  = (c: string): string => hidden(c)[0]?.value ?? ''
  const journal = (): string => hote._shadow.querySelector('.evr').textContent
  const etat    = (): any => window.__etat()
  const cles    = (html: string): string[] => Array.from(html.matchAll(/data-key="([^"]*)"/g)).map((m) => m[1])
  const items   = (c: string): any[] => Array.from(surface(c).querySelectorAll('ul[data-checklist] > li'))
  const saisie  = async (c: string) => { surface(c).dispatchEvent(new window.Event('input', { bubbles: true })); await pause(60) }
  const espace  = async (c: string, i: number) => { lignes(c)[i].dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })); await pause(60) }
  const poser   = async (nom: string, v: any) => { window.__poser(nom, v); await pause(150) }
  // la ligne de l'auteur dont le texte propre (avant sa sous-liste) est celui-ci
  const li      = (c: string, texte: string): any => items(c).find((x: any) => x.firstChild?.nodeValue === texte)
  // le navigateur recopie les attributs de la ligne coupée : la copie sans enfants, avec ce texte
  const copie   = (modele: any, texte: string): any => { const n = modele.cloneNode(false); n.textContent = texte; return n }

  before(async () => {
    ;({ window, hote } = await monter(HOTE, 'editeur-lignes-nommees'))
    await attendre(() => ['a', 'v', 'i', 's', 'r', 'n', 'm', 'd'].every((c) => !!ed(c)?._shadow?.querySelector('.surface')), 10000)
    await pause(300)
  })

  after(async () => { await terminateSharedWorkerPool() })

  // l'auteur repart du texte de départ et les cases de leur départ : un essai qui échoue en cours de route ne dérange pas les suivants
  beforeEach(async () => {
    await poser('texte', '<p>.</p>')
    await poser('texte', TEXTE)
    await poser('coches', ['bb22'])
  })

  describe('le HTML du modèle', () => {
    it('le nom d\'une ligne à cocher (une lettre minuscule puis trois caractères [a-z0-9]) est gardé dans le HTML propre, avant data-checked', function () {
      assert.equal(valeur('a'), TEXTE, 'le champ du formulaire de l\'auteur porte les noms')
      assert.equal(surface('a').innerHTML.replace(/ aria-description="[^"]*"/g, '').replace(/=""/g, ''), TEXTE, 'la surface aussi')
    })

    it('un nom d\'une autre forme, ou posé ailleurs que sur une ligne à cocher, est retiré', function () {
      assert.equal(valeur('i'), '<ul data-checklist><li>a</li><li>b</li><li>c</li><li>d</li><li>e</li><li data-key="ok99" data-checked>f</li></ul><ul><li>g</li></ul><ol><li>h</li></ol>')
    })

    it('le mode « répondre » ne montre aucun nom : ni dans le texte, ni dans une valeur de la page', function () {
      assert.ok(!surface('r').textContent.match(/aa11|bb22|cc33|dd44/), surface('r').textContent)
      assert.equal(etat().texte, TEXTE, 'le modèle de la page n\'est pas réécrit')
    })
  })

  describe('mode « répondre » : les cases se désignent par le nom de leur ligne', () => {
    it('checked pose les cases par nom, un champ par case cochée, le nom est la valeur du champ', function () {
      assert.equal(etats('r'), 'false,true,false,false', etats('r'))
      assert.deepEqual(champs('r'), ['reps[]=bb22'])
      assert.equal(lignes('r')[1].getAttribute('aria-checked'), 'true')
      assert.equal(lignes('r')[1].parentNode.hasAttribute('data-checked'), true, 'la ligne de liste est marquée cochée')
    })

    it('un geste coche : change annonce les noms cochés dans l\'ordre du texte, la variable liée et les champs sont à jour, le modèle n\'est pas réécrit', async function () {
      await espace('r', 0)
      assert.equal(etats('r'), 'true,true,false,false')
      assert.equal(JSON.stringify(etat().coches), '["aa11","bb22"]')
      assert.equal(journal(), 'change:["aa11","bb22"]')
      assert.deepEqual(champs('r'), ['reps[]=aa11', 'reps[]=bb22'])
      await espace('r', 3)
      assert.equal(JSON.stringify(etat().coches), '["aa11","bb22","dd44"]', 'Trois (quatrième ligne) a pour nom dd44')
      await espace('r', 1)
      assert.equal(JSON.stringify(etat().coches), '["aa11","dd44"]', 'un second geste décoche')
      assert.equal(etat().texte, TEXTE)
    })

    it('la coche reste sur sa ligne quand l\'auteur ajoute une ligne en haut, en retire une, en déplace une', async function () {
      await poser('coches', ['bb22'])
      assert.equal(etats('r'), 'false,true,false,false')
      const SOUS = '<ul data-checklist><li data-key="cc33">Deux-un</li></ul>'
      await poser('texte', TEXTE.replace('<ul data-checklist><li data-key="aa11">', '<ul data-checklist><li data-key="zz99">Zéro</li><li data-key="aa11">'))
      assert.equal(etats('r'), 'false,false,true,false,false', 'ligne ajoutée en haut : Deux est la troisième, toujours cochée')
      assert.deepEqual(champs('r'), ['reps[]=bb22'])
      await poser('texte', '<ul data-checklist><li data-key="zz99">Zéro</li><li data-key="bb22">Deux' + SOUS + '</li><li data-key="dd44">Trois</li></ul>')
      assert.equal(etats('r'), 'false,true,false,false', 'ligne retirée au-dessus : Deux est la deuxième')
      await poser('texte', '<ul data-checklist><li data-key="dd44">Trois</li><li data-key="bb22">Deux' + SOUS + '</li><li data-key="zz99">Zéro</li></ul>')
      assert.equal(etats('r'), 'false,true,false,false', 'lignes déplacées : Deux est la deuxième')
      await poser('texte', '<ul data-checklist><li data-key="dd44">Trois</li><li data-key="zz99">Zéro</li><li data-key="bb22">Deux' + SOUS + '</li></ul>')
      assert.equal(etats('r'), 'false,false,true,false', 'Deux descend en troisième position et reste cochée')
      await poser('texte', TEXTE)
      assert.equal(etats('r'), 'false,true,false,false')
    })

    it('un nom inconnu du texte est ignoré (ni dessin, ni champ), la variable de la page n\'est réécrite qu\'au premier geste', async function () {
      await poser('coches', ['zzzz', 'bb22', 'x', 7, null, {}, 'AB12', 'dd44', -1, 2.5, true, ['aa11']])
      assert.equal(etats('r'), 'false,true,false,true', 'seuls bb22 et dd44 sont des noms du texte (7, -1, 2.5 : positions qui n\'existent pas ou ne sont pas permises)')
      assert.deepEqual(champs('r'), ['reps[]=bb22', 'reps[]=dd44'])
      assert.equal(etat().coches.length, 12, 'la page n\'est pas réécrite à l\'affichage')
      await espace('r', 0)
      assert.equal(JSON.stringify(etat().coches), '["aa11","bb22","dd44"]', 'au premier geste la liste est nettoyée')
      await poser('coches', 'pas un tableau')
      assert.equal(etats('r'), 'false,false,false,false')
      assert.deepEqual(champs('r'), [])
      await poser('coches', ['bb22'])
    })

    it('form.reset() rend les noms de départ, sans change', async function () {
      await poser('coches', ['bb22'])
      await espace('r', 0)
      await espace('r', 3)
      assert.equal(JSON.stringify(etat().coches), '["aa11","bb22","dd44"]')
      const avant = journal()
      hote._shadow.querySelector('.f').reset()
      await pause(400)
      assert.equal(JSON.stringify(etat().coches), '["bb22"]')
      assert.equal(etats('r'), 'false,true,false,false')
      assert.deepEqual(champs('r'), ['reps[]=bb22'])
      assert.equal(journal(), avant, 'form.reset() n\'annonce pas de change')
    })
  })

  describe('repli : une ligne sans nom se désigne par sa position', () => {
    it('un texte sans aucun nom marche comme avant : positions (entiers ou leur texte), champs et change en positions', async function () {
      assert.equal(etats('n'), 'false,true,false')
      assert.deepEqual(champs('n'), ['anc[]=1'])
      await espace('n', 0)
      assert.deepEqual(champs('n'), ['anc[]=0', 'anc[]=1'])
      assert.equal(JSON.stringify(etat().cancien), '[0,1]', 'la variable liée porte des positions (des entiers), comme avant')
    })

    it('un texte qui mêle lignes nommées et lignes sans nom : la ligne sans nom est sa position dans tout le texte', async function () {
      assert.equal(etats('m'), 'false,true,true', 'C est la ligne 2 (nombre) et B porte son nom cc33')
      assert.deepEqual(champs('m'), ['mix[]=cc33', 'mix[]=2'])
      await poser('cmixte', ['0', 'cc33'])
      assert.equal(etats('m'), 'true,true,false', 'la position peut s\'écrire en texte')
      await poser('cmixte', [1])
      assert.equal(etats('m'), 'false,false,false', 'la position 1 est la ligne B, qui est désignée par son nom : 1 ne la désigne plus')
    })

    it('un nom déjà porté par une ligne plus haute ne compte pas : la ligne suivante se désigne par sa position', async function () {
      assert.equal(etats('d'), 'true,false,false', 'aa11 est la première ligne')
      await poser('cdoubles', [1])
      assert.equal(etats('d'), 'false,true,false', 'la seconde ligne aa11 est la position 1')
      await poser('cdoubles', ['aa11', 'bb22', 1])
      assert.equal(etats('d'), 'true,true,true')
      assert.deepEqual(champs('d'), ['dbl[]=aa11', 'dbl[]=1', 'dbl[]=bb22'])
    })
  })

  describe('l\'éditeur de l\'auteur nomme les lignes', () => {
    it('un texte ancien : toute ligne sans nom en reçoit un neuf au premier geste, le reste du texte ne bouge pas', async function () {
      assert.equal(valeur('v'), ANCIEN, 'rien n\'est nommé tant que l\'auteur ne touche à rien')
      await saisie('v')
      const v = valeur('v')
      const k = cles(v)
      assert.equal(k.length, 3)
      assert.ok(k.every((x) => FORME.test(x)), k.join())
      assert.equal(new Set(k).size, 3)
      assert.equal(v.replace(/ data-key="[^"]*"/g, ''), ANCIEN, 'seuls les noms s\'ajoutent')
      assert.equal(cles(etat().vieux).join(), k.join(), 'la variable liée porte les mêmes noms')
      const avant = valeur('v')
      await saisie('v')
      assert.equal(valeur('v'), avant, 'un second geste ne change plus rien')
    })

    it('une ligne créée à la fin (la copie de la ligne d\'avant, ou une ligne sans attribut) reçoit un nom neuf, la ligne d\'avant garde le sien', async function () {
      const trois = li('a', 'Trois')
      trois.parentNode.appendChild(copie(trois, 'Quatre'))
      const cinq = document_createLi(trois, 'Cinq')
      trois.parentNode.appendChild(cinq)
      await saisie('a')
      const k = cles(valeur('a'))
      assert.equal(k.length, 6)
      assert.deepEqual(k.slice(0, 4), ['aa11', 'bb22', 'cc33', 'dd44'], 'les lignes d\'avant gardent leur nom')
      assert.ok(k[4] !== 'dd44' && k[5] !== 'dd44' && FORME.test(k[4]) && FORME.test(k[5]) && k[4] !== k[5], k.join())
      assert.equal(cles(etat().texte).join(), k.join(), 'la variable liée porte les mêmes noms')
      assert.equal(champs('r').length, 1, 'la case bb22 est toujours cochée')
      cinq.remove()
      trois.parentNode.lastChild.remove()
      await saisie('a')
      assert.equal(valeur('a'), TEXTE, 'les deux lignes retirées, le texte d\'origine revient')
    })

    it('Entrée au milieu d\'une ligne : la première moitié garde le nom, la seconde en reçoit un neuf', async function () {
      const trois = li('a', 'Trois')
      trois.firstChild.nodeValue = 'Tro'
      trois.parentNode.insertBefore(copie(trois, 'is'), trois.nextSibling)
      await saisie('a')
      const k = cles(valeur('a'))
      assert.equal(k.length, 5)
      assert.deepEqual(k.slice(0, 4), ['aa11', 'bb22', 'cc33', 'dd44'])
      assert.ok(FORME.test(k[4]) && !k.slice(0, 4).includes(k[4]), k.join())
      assert.match(valeur('a'), /<li data-key="dd44">Tro<\/li><li data-key="[a-z][a-z0-9]{3}">is<\/li>/)
      trois.nextSibling.remove()
      trois.firstChild.nodeValue = 'Trois'
      await saisie('a')
      assert.equal(valeur('a'), TEXTE)
    })

    it('Entrée au début d\'une ligne : la ligne vide créée au-dessus ne prend pas le nom, la ligne qui a du texte le garde', async function () {
      const deux = li('a', 'Deux')
      const vide = deux.cloneNode(false)
      vide.innerHTML = '<br>'
      deux.parentNode.insertBefore(vide, deux)
      await saisie('a')
      assert.equal(vide.hasAttribute('data-key'), false, 'la ligne vide perd le nom copié')
      assert.equal(valeur('a'), TEXTE, 'la ligne vide n\'est pas dans le texte, Deux garde bb22')
      vide.textContent = 'Zéro'
      await saisie('a')
      const k = cles(valeur('a'))
      assert.equal(k.length, 5)
      assert.ok(FORME.test(k[1]) && !['aa11', 'bb22', 'cc33', 'dd44'].includes(k[1]), `Zéro reçoit un nom neuf : ${k.join()}`)
      assert.equal(k[2], 'bb22', 'Deux garde son nom')
      assert.match(valeur('a'), /<li data-key="aa11">Un<\/li><li data-key="[a-z][a-z0-9]{3}">Zéro<\/li><li data-key="bb22">Deux/)
      vide.remove()
      await saisie('a')
      assert.equal(valeur('a'), TEXTE)
    })

    it('une ligne vide garde un nom que personne d\'autre ne porte (le texte effacé puis retapé garde sa ligne)', async function () {
      const un = li('a', 'Un')
      un.innerHTML = '<br>'
      await saisie('a')
      assert.equal(un.getAttribute('data-key'), 'aa11', 'la ligne vidée garde son nom dans la surface')
      assert.ok(!valeur('a').includes('aa11'), 'sans texte elle n\'est pas dans le texte')
      un.textContent = 'Un bis'
      await saisie('a')
      assert.match(valeur('a'), /<li data-key="aa11">Un bis<\/li>/, 'retapée, elle retrouve son nom')
      un.textContent = 'Un'
      await saisie('a')
      assert.equal(valeur('a'), TEXTE)
    })

    it('ligne copiée-collée, texte collé qui porte déjà des noms : tout doublon est renommé (la ligne du haut garde le sien), un nom encore libre reste', async function () {
      const deux = li('a', 'Deux')
      const racine = deux.parentNode
      const copiee = copie(deux, 'Deux')
      const libre = copie(deux, 'Libre')
      libre.setAttribute('data-key', 'zz99')
      const encore = copie(deux, 'Encore')
      encore.setAttribute('data-key', 'dd44')
      racine.appendChild(copiee)
      racine.appendChild(libre)
      racine.appendChild(encore)
      await saisie('a')
      const k = cles(valeur('a'))
      assert.equal(k.length, 7)
      assert.deepEqual(k.slice(0, 4), ['aa11', 'bb22', 'cc33', 'dd44'])
      assert.equal(k[5], 'zz99', 'un nom libre est gardé')
      assert.ok(FORME.test(k[4]) && FORME.test(k[6]), k.join())
      assert.equal(new Set(k).size, 7, `aucun doublon : ${k.join()}`)
      copiee.remove()
      libre.remove()
      encore.remove()
      await saisie('a')
      assert.equal(valeur('a'), TEXTE)
    })

    it('un nom neuf n\'est jamais celui d\'une autre ligne, même quand le tirage tombe dessus', async function () {
      const trois = li('a', 'Trois')
      const pris = copie(trois, 'Prise')
      pris.setAttribute('data-key', 'a000')
      trois.parentNode.appendChild(pris)
      const neuve = document_createLi(trois, 'Neuve')
      trois.parentNode.appendChild(neuve)
      window.eval('globalThis.__hasard = Math.random; globalThis.__tirages = 0; Math.random = () => (globalThis.__tirages++ < 2 ? 0 : globalThis.__hasard())')
      try {
        await saisie('a')
      } finally {
        window.eval('Math.random = globalThis.__hasard')
      }
      assert.ok(window.eval('globalThis.__tirages') > 2, 'le premier tirage (a000) a été refusé, un autre a suivi')
      const k = cles(valeur('a'))
      assert.equal(k.length, 6)
      assert.equal(k[4], 'a000', 'la ligne qui portait a000 le garde')
      assert.ok(FORME.test(k[5]) && k[5] !== 'a000', k.join())
      pris.remove()
      neuve.remove()
      await saisie('a')
      assert.equal(valeur('a'), TEXTE)
    })

    it('un éditeur dont la barre ne montre pas l\'outil des cases ne crée aucun nom et garde ceux du texte (la même règle que le raccourci des cases)', async function () {
      assert.equal(valeur('s'), SANS)
      const b = li('s', 'B')
      b.parentNode.appendChild(copie(b, 'C'))
      b.parentNode.appendChild(document_createLi(b, 'D'))
      await saisie('s')
      assert.equal(valeur('s'), '<ul data-checklist><li data-key="aa11">A</li><li>B</li><li>C</li><li>D</li></ul>')
      assert.equal(window.eval('document.querySelector("mjs-hote")._shadow.querySelector(".s")._shadow.querySelectorAll("[data-key]").length'), 1)
    })

    it('deux cents lignes sans nom : toutes en reçoivent un, de la bonne forme, tous différents', async function () {
      const trois = li('a', 'Trois')
      const neuves: any[] = []
      for (let i = 0; i < 200; i++) neuves.push(document_createLi(trois, 'L' + i))
      neuves.forEach((n) => trois.parentNode.appendChild(n))
      await saisie('a')
      const k = cles(valeur('a'))
      assert.equal(k.length, 204)
      assert.ok(k.every((x) => FORME.test(x)))
      assert.equal(new Set(k).size, 204)
      neuves.forEach((n) => n.remove())
      await saisie('a')
      assert.equal(valeur('a'), TEXTE)
    })

    it('la coche d\'un répondant reste sur sa ligne quand l\'auteur coupe une ligne en deux (le texte de l\'auteur arrive au mode « répondre »)', async function () {
      await poser('coches', ['dd44'])
      assert.equal(etats('r'), 'false,false,false,true')
      const un = li('a', 'Un')
      un.firstChild.nodeValue = 'U'
      un.parentNode.insertBefore(copie(un, 'n'), un.nextSibling)
      await saisie('a')
      await pause(150)
      assert.equal(etats('r'), 'false,false,false,false,true', 'cinq lignes, Trois (dd44) est la dernière et reste cochée')
      assert.deepEqual(champs('r'), ['reps[]=dd44'])
      un.nextSibling.remove()
      un.firstChild.nodeValue = 'Un'
      await saisie('a')
      await pause(150)
      assert.equal(etats('r'), 'false,false,false,true')
      await poser('coches', ['bb22'])
    })
  })
})

// une ligne neuve : sans aucun attribut, comme un navigateur qui crée la ligne de zéro
function document_createLi(modele: any, texte: string): any {
  const n = modele.ownerDocument.createElement('li')
  n.textContent = texte
  return n
}
