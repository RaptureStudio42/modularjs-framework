// SSR — `reflectFieldState` recopie l'état COURANT d'un champ de formulaire dans ses attributs, seule chose que la sérialisation du HTML
// écrit : `value` des champs de saisie, `checked` des cases et des boutons radio, `selected` des options d'une liste, texte d'un
// `<textarea>`. Un champ dont l'état est déjà celui de ses attributs n'est pas touché ; un mot de passe et un fichier ne sont JAMAIS
// écrits, même quand leur valeur est lisible. Les deux moteurs de rendu partagent cette fonction (le moteur navigateur en injecte le texte).

import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import * as rendu from '../src/server/renderToString.js'

describe('reflectFieldState — l\'état d\'un champ recopié dans ses attributs', function () {
  let window: any

  // le corps d'un document neuf qui porte ce HTML
  const monde = (html: string): any => {
    window = new Window()
    window.document.body.innerHTML = html
    return window.document.body
  }

  afterEach(async () => { await window?.happyDOM?.close?.() })

  describe('champs de saisie', () => {
    it('un champ dont la valeur a changé reçoit la nouvelle dans son attribut `value`', () => {
      const corps  = monde('<input type="text" value="avant">')
      const champ  = corps.querySelector('input')
      champ.value = 'après'
      rendu.reflectFieldState(champ)
      assert.equal(champ.getAttribute('value'), 'après')
      assert.equal(corps.innerHTML, '<input type="text" value="après">')
    })

    it('un champ sans attribut `value` en reçoit un quand une valeur lui a été écrite', () => {
      const corps = monde('<input type="text">')
      const champ = corps.querySelector('input')
      champ.value = 'Ada'
      rendu.reflectFieldState(champ)
      assert.equal(corps.innerHTML, '<input type="text" value="Ada">')
    })

    for (const [type, valeur] of [['range', '30'], ['color', '#ff8800'], ['number', '12'], ['email', 'ada@exemple.fr'], ['search', 'mots'], ['tel', '0102030405'], ['url', 'https://exemple.fr'], ['date', '2026-10-18'], ['time', '21:30']]) {
      it(`un champ de type ${type} lié à une variable : la valeur passe dans l'attribut`, () => {
        const corps = monde(`<input type="${type}" value="">`)
        const champ = corps.querySelector('input')
        champ.value = valeur
        rendu.reflectFieldState(champ)
        assert.equal(champ.getAttribute('value'), valeur)
      })
    }

    it('un champ dont la valeur est celle de son attribut n\'est pas touché', () => {
      const corps = monde('<input type="text" value="Ada" class="nom"><input type="range" min="0" max="3" value="1.5">')
      const avant = corps.innerHTML
      for (const champ of corps.querySelectorAll('input')) rendu.reflectFieldState(champ)
      assert.equal(corps.innerHTML, avant)
    })

    it('un champ vide qui n\'a pas d\'attribut `value` n\'en reçoit pas', () => {
      const corps = monde('<input type="text"><input type="search">')
      for (const champ of corps.querySelectorAll('input')) rendu.reflectFieldState(champ)
      assert.equal(corps.innerHTML, '<input type="text"><input type="search">')
    })

    it('un champ vidé perd la valeur que son attribut portait', () => {
      const corps = monde('<input type="text" value="abc">')
      const champ = corps.querySelector('input')
      champ.value = ''
      rendu.reflectFieldState(champ)
      assert.equal(champ.getAttribute('value'), '')
    })

    it('un champ caché ou un bouton garde sa valeur', () => {
      const corps = monde('<input type="hidden" value="jeton"><input type="submit" value="Envoyer">')
      const avant = corps.innerHTML
      for (const champ of corps.querySelectorAll('input')) rendu.reflectFieldState(champ)
      assert.equal(corps.innerHTML, avant)
    })

    it('un type écrit en capitales ou inconnu se lit comme le navigateur le lit', () => {
      const corps = monde('<input type="TEXT" value=""><input type="inconnu" value="">')
      const [a, b] = Array.from(corps.querySelectorAll('input')) as any[]
      a.value = 'un'
      b.value = 'deux'
      rendu.reflectFieldState(a)
      rendu.reflectFieldState(b)
      assert.equal(a.getAttribute('value'), 'un')
      assert.equal(b.getAttribute('value'), 'deux')
    })
  })

  describe('mot de passe et fichier', () => {
    it('la valeur d\'un mot de passe n\'est jamais écrite', () => {
      const corps = monde('<input type="password" value=""><input type="PASSWORD" value="">')
      for (const champ of corps.querySelectorAll('input')) {
        champ.value = 'mot-de-passe-secret'
        rendu.reflectFieldState(champ)
      }
      assert.ok(!corps.innerHTML.includes('mot-de-passe-secret'), corps.innerHTML)
    })

    it('un champ devenu mot de passe n\'est pas écrit non plus', () => {
      const corps = monde('<input type="text" value="">')
      const champ = corps.querySelector('input')
      champ.value = 'secret-d-hier'
      champ.type = 'password'
      rendu.reflectFieldState(champ)
      assert.ok(!corps.innerHTML.includes('secret-d-hier'), corps.innerHTML)
    })

    it('un champ fichier n\'est jamais écrit, même quand sa valeur est lisible', () => {
      const ecrits: string[] = []
      const fichier = { localName: 'input', type: 'file', value: 'C:\\fakepath\\releve.pdf', getAttribute: () => null, hasAttribute: () => false, setAttribute: (nom: string) => ecrits.push(nom), removeAttribute: (nom: string) => ecrits.push(nom) }
      rendu.reflectFieldState(fichier)
      assert.deepEqual(ecrits, [])
    })
  })

  describe('cases à cocher et boutons radio', () => {
    it('une case cochée reçoit `checked`, une case décochée le perd', () => {
      const corps = monde('<input type="checkbox" class="a"><input type="checkbox" class="b" checked="">')
      const [a, b] = Array.from(corps.querySelectorAll('input')) as any[]
      a.checked = true
      b.checked = false
      rendu.reflectFieldState(a)
      rendu.reflectFieldState(b)
      assert.equal(a.hasAttribute('checked'), true)
      assert.equal(b.hasAttribute('checked'), false)
    })

    it('une case déjà en accord avec son attribut n\'est pas touchée', () => {
      const corps = monde('<input type="checkbox" checked="checked"><input type="checkbox">')
      const avant = corps.innerHTML
      for (const champ of corps.querySelectorAll('input')) rendu.reflectFieldState(champ)
      assert.equal(corps.innerHTML, avant)
    })

    it('la valeur d\'une case n\'est jamais copiée en `value` (« on » par défaut)', () => {
      const corps = monde('<input type="checkbox"><input type="radio" name="g">')
      for (const champ of corps.querySelectorAll('input')) {
        champ.checked = true
        rendu.reflectFieldState(champ)
      }
      assert.ok(!/\bvalue=/.test(corps.innerHTML), corps.innerHTML)
    })

    it('dans un groupe de boutons radio, seul le bouton choisi porte `checked`', () => {
      const corps = monde('<input type="radio" name="o" value="a" checked=""><input type="radio" name="o" value="b"><input type="radio" name="o" value="c" checked="">')
      const [a, b, c] = Array.from(corps.querySelectorAll('input')) as any[]
      b.checked = true
      for (const champ of [a, b, c]) rendu.reflectFieldState(champ)
      assert.deepEqual([a, b, c].map((r) => r.hasAttribute('checked')), [false, true, false])
      assert.deepEqual([a, b, c].map((r) => r.checked), [false, true, false], 'et l\'état lui-même ne bouge pas')
    })
  })

  describe('listes', () => {
    const attributs = (liste: any): boolean[] => Array.from(liste.options).map((o: any) => o.hasAttribute('selected'))

    it('l\'option choisie par la valeur de la liste porte `selected`, l\'ancienne le perd', () => {
      const corps = monde('<select><option value="fr">F</option><option value="en" selected="">E</option><option value="de">D</option></select>')
      const liste = corps.querySelector('select')
      liste.value = 'de'
      rendu.reflectFieldState(liste)
      assert.deepEqual(attributs(liste), [false, false, true])
      assert.equal(liste.value, 'de', 'et le choix lui-même ne bouge pas')
    })

    it('une liste où rien n\'a été écrit en dur reçoit `selected` sur l\'option choisie', () => {
      const corps = monde('<select><option value="fr">F</option><option value="en">E</option></select>')
      const liste = corps.querySelector('select')
      liste.value = 'en'
      rendu.reflectFieldState(liste)
      assert.deepEqual(attributs(liste), [false, true])
    })

    it('une liste dont le choix est celui que le navigateur fait seul n\'est pas touchée', () => {
      const corps = monde('<select><option value="fr">F</option><option value="en">E</option></select>')
      const avant = corps.innerHTML
      rendu.reflectFieldState(corps.querySelector('select'))
      assert.equal(corps.innerHTML, avant)
    })

    it('la première option désactivée ne compte pas pour le choix du navigateur', () => {
      const corps = monde('<select><option value="" disabled="">Choisir</option><option value="a">A</option></select>')
      const liste = corps.querySelector('select')
      const avant = corps.innerHTML
      rendu.reflectFieldState(liste)
      assert.equal(corps.innerHTML, avant, 'choisie seule, la première option utilisable n\'écrit rien')
      liste.value = ''
      rendu.reflectFieldState(liste)
      assert.deepEqual(attributs(liste), [true, false], 'le choix de l\'option désactivée, lui, s\'écrit')
    })

    it('une option d\'un groupe désactivé ne compte pas non plus', () => {
      const corps = monde('<select><optgroup label="g" disabled=""><option value="x">X</option></optgroup><option value="y">Y</option></select>')
      const avant = corps.innerHTML
      rendu.reflectFieldState(corps.querySelector('select'))
      assert.equal(corps.innerHTML, avant)
    })

    it('quand deux options écrivent `selected`, la dernière l\'emporte : rien à réécrire', () => {
      const corps = monde('<select><option value="p" selected="">P</option><option value="q" selected="">Q</option></select>')
      const avant = corps.innerHTML
      rendu.reflectFieldState(corps.querySelector('select'))
      assert.equal(corps.innerHTML, avant)
    })

    it('une liste de plusieurs lignes n\'a pas de choix par défaut : celui qui est fait s\'écrit', () => {
      const corps = monde('<select size="3"><option value="p">P</option><option value="q">Q</option></select>')
      const liste = corps.querySelector('select')
      const avant = corps.innerHTML
      rendu.reflectFieldState(liste)
      assert.equal(corps.innerHTML, avant, 'rien de choisi, rien à écrire')
      liste.value = 'q'
      rendu.reflectFieldState(liste)
      assert.deepEqual(attributs(liste), [false, true])
    })

    it('les options d\'un groupe sont lues aussi', () => {
      const corps = monde('<select><option value="a">A</option><optgroup label="g"><option value="b">B</option><option value="c">C</option></optgroup></select>')
      const liste = corps.querySelector('select')
      liste.value = 'c'
      rendu.reflectFieldState(liste)
      assert.deepEqual(attributs(liste), [false, false, true])
    })

    it('une liste à choix multiple porte autant de `selected` que d\'options choisies', () => {
      const corps = monde('<select multiple=""><option value="a" selected="">A</option><option value="b">B</option><option value="c">C</option></select>')
      const liste = corps.querySelector('select')
      liste.options[0].selected = false
      liste.options[1].selected = true
      liste.options[2].selected = true
      rendu.reflectFieldState(liste)
      assert.deepEqual(attributs(liste), [false, true, true])
    })
  })

  describe('zones de texte', () => {
    it('le texte d\'une zone dont la valeur a changé est celui de sa valeur', () => {
      const corps = monde('<textarea>avant</textarea>')
      const zone  = corps.querySelector('textarea')
      zone.value = 'après\nsur deux lignes'
      rendu.reflectFieldState(zone)
      assert.equal(corps.innerHTML, '<textarea>après\nsur deux lignes</textarea>')
    })

    it('une zone dont le texte est déjà sa valeur n\'est pas touchée', () => {
      const corps = monde('<textarea>texte</textarea><textarea></textarea>')
      const avant = corps.innerHTML
      for (const zone of corps.querySelectorAll('textarea')) rendu.reflectFieldState(zone)
      assert.equal(corps.innerHTML, avant)
    })

    it('un saut de ligne en tête s\'écrit en double : le parseur d\'un navigateur retire le premier', () => {
      const corps = monde('<textarea></textarea>')
      const zone  = corps.querySelector('textarea')
      zone.value = '\nsuite'
      rendu.reflectFieldState(zone)
      assert.equal(corps.innerHTML, '<textarea>\n\nsuite</textarea>')
    })

    it('un saut de ligne en tête écrit en dur par un script, sans être doublé, est corrigé', () => {
      const corps = monde('<textarea></textarea>')
      const zone  = corps.querySelector('textarea')
      zone.textContent = '\nabc'
      assert.equal(zone.value, '\nabc')
      rendu.reflectFieldState(zone)
      assert.equal(corps.innerHTML, '<textarea>\n\nabc</textarea>')
    })

    // happy-dom rend la valeur telle qu'elle a été écrite, retours chariot compris ; un navigateur la rend avec des sauts de ligne `\n` seuls,
    // et son parseur normalise le texte avant de retirer le premier saut : c'est CETTE valeur-là que la page doit redire
    it('un retour chariot suivi d\'un saut de ligne en tête s\'écrit comme un saut de ligne en tête', () => {
      const corps = monde('<textarea></textarea>')
      const zone  = corps.querySelector('textarea')
      zone.value = '\r\nsuite'
      rendu.reflectFieldState(zone)
      assert.equal(corps.innerHTML, '<textarea>\n\nsuite</textarea>')
    })

    it('un retour chariot seul en tête s\'écrit comme un saut de ligne en tête', () => {
      const corps = monde('<textarea></textarea>')
      const zone  = corps.querySelector('textarea')
      zone.value = '\rsuite'
      rendu.reflectFieldState(zone)
      assert.equal(corps.innerHTML, '<textarea>\n\nsuite</textarea>')
    })

    it('une zone qui ne contient qu\'un retour chariot et un saut de ligne s\'écrit avec deux sauts de ligne', () => {
      const corps = monde('<textarea></textarea>')
      const zone  = corps.querySelector('textarea')
      zone.value = '\r\n'
      rendu.reflectFieldState(zone)
      assert.equal(corps.innerHTML, '<textarea>\n\n</textarea>')
    })

    it('les retours chariot du milieu du texte s\'écrivent en sauts de ligne', () => {
      const corps = monde('<textarea></textarea>')
      const zone  = corps.querySelector('textarea')
      zone.value = 'un\r\ndeux\rtrois\nquatre'
      rendu.reflectFieldState(zone)
      assert.equal(corps.innerHTML, '<textarea>un\ndeux\ntrois\nquatre</textarea>')
    })

    it('une valeur à retours chariot qui redit le texte du balisage ne le touche pas', () => {
      const corps = monde('<textarea>un\ndeux</textarea>')
      const avant = corps.innerHTML
      const zone  = corps.querySelector('textarea')
      zone.value = 'un\r\ndeux'
      rendu.reflectFieldState(zone)
      assert.equal(corps.innerHTML, avant)
    })

    it('un second passage sur une valeur à retours chariot ne change plus rien', () => {
      const corps = monde('<textarea></textarea>')
      const zone  = corps.querySelector('textarea')
      zone.value = '\r\nun\r\ndeux'
      rendu.reflectFieldState(zone)
      const premier = corps.innerHTML
      rendu.reflectFieldState(zone)
      assert.equal(corps.innerHTML, premier)
      assert.equal(premier, '<textarea>\n\nun\ndeux</textarea>')
    })

    it('un second passage ne change plus rien', () => {
      const corps = monde('<textarea></textarea><input type="text"><select><option value="a">A</option><option value="b">B</option></select>')
      const [zone, champ, liste] = [corps.querySelector('textarea'), corps.querySelector('input'), corps.querySelector('select')]
      zone.value  = '\nsuite'
      champ.value = 'Ada'
      liste.value = 'b'
      for (const el of [zone, champ, liste]) rendu.reflectFieldState(el)
      const premier = corps.innerHTML
      for (const el of [zone, champ, liste]) rendu.reflectFieldState(el)
      assert.equal(corps.innerHTML, premier)
    })
  })

  describe('l\'état lui-même', () => {
    it('recopier les attributs ne change l\'état d\'aucun champ', () => {
      const corps = monde('<input type="text" value="a"><input type="range" min="0" max="3" step="0.01" value=""><input type="color" value=""><input type="checkbox" checked=""><input type="radio" name="g" checked=""><input type="radio" name="g"><select><option value="x" selected="">X</option><option value="y">Y</option></select><select multiple=""><option value="p" selected="">P</option><option value="q">Q</option></select><textarea>t</textarea>')
      const [texte, curseur, couleur, case1, radio1, radio2] = Array.from(corps.querySelectorAll('input')) as any[]
      const [liste, multiple] = Array.from(corps.querySelectorAll('select')) as any[]
      const zone = corps.querySelector('textarea')
      texte.value   = 'Ada'
      curseur.value = '1.4'
      couleur.value = '#ff8800'
      case1.checked = false
      radio2.checked = true
      liste.value   = 'y'
      multiple.options[1].selected = true
      zone.value    = 'neuf'
      const etat = (): string => JSON.stringify([texte.value, curseur.value, couleur.value, case1.checked, radio1.checked, radio2.checked, liste.value, Array.from(multiple.options).map((o: any) => o.selected), zone.value])
      const avant = etat()
      for (const el of corps.querySelectorAll('input, select, textarea')) rendu.reflectFieldState(el)
      assert.equal(etat(), avant)
    })
  })

  describe('le reste du document', () => {
    it('un élément qui n\'est pas un champ n\'est pas touché', () => {
      const corps = monde('<div value="x">t</div><button value="b">b</button><p>texte</p>')
      const avant = corps.innerHTML
      for (const el of corps.children) rendu.reflectFieldState(el)
      assert.equal(corps.innerHTML, avant)
    })

    it('un nœud texte passé par erreur ne fait rien', () => {
      const corps = monde('texte seul')
      assert.doesNotThrow(() => rendu.reflectFieldState(corps.firstChild))
    })
  })
})
