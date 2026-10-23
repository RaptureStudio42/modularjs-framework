// Éditeur de texte riche du cœur en mode « répondre » (<@@editor answer checked=!{…}>) dans Chromium, Firefox et WebKit réels, en
// construction de développement ET de production : le texte (le modèle écrit par l'auteur) est figé, seules les cases se cochent.
// - la zone est un groupe (jamais un champ de saisie), chaque ligne à cocher est une case ARIA (`role="checkbox"`, `aria-checked`,
//   un arrêt de tabulation) dans sa liste, la barre ne sert à rien ;
// - le modèle de ce fichier n'a aucun nom de ligne (`data-key`) : chaque ligne se désigne par sa POSITION, le repli d'une ligne sans nom
//   (les noms des lignes sont l'objet de core-editeur-lignes-nommees*.test.ts) ; `checked=!{…}` dit les cases cochées par leur position
//   (0, 1, 2… dans l'ordre du texte, sous-listes comprises) ; l'état coché du modèle (`data-checked`) n'est jamais lu ; le modèle
//   (`value`) n'est jamais réécrit par un cochage ;
// - cocher à la souris (la marge de la ligne) ou à l'Espace annonce `change` (`e.data` = les positions cochées, dans l'ordre du texte),
//   la variable liée et les champs du formulaire sont déjà à jour ; rien quand la page pose elle-même les cases, rien pour `form.reset()` ;
// - un champ caché par case cochée, sous `name` ; `readonly` montre les réponses sans les laisser changer (les champs partent),
//   `disabled` les grise (aucun champ) ; les valeurs refusées (hors du texte, négatives, non entières, noms de la mauvaise forme)
//   sont ignorées sans bruit.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { BUILDS, MOTEURS, MODELE, ouvrir, type Session } from './helpers/editeur-riche.js'

for (const build of BUILDS) for (const nom of MOTEURS) describe(`éditeur riche, mode « répondre » (${build}, ${nom} réel)`, function () {
  this.timeout(240000)
  let s: Session | null = null
  let bilan: string[] = []

  const E     = (expr: string): Promise<any> => s!.page.evaluate(expr)
  const pause = (ms = 100) => s!.page.waitForTimeout(ms)
  const check = (nomEssai: string, ok: any, detail: any = '') => { if (!ok) bilan.push(`${nomEssai} — ${String(detail).slice(0, 400)}`) }
  const fin   = () => assert.deepEqual(bilan, [], 'essais en échec')

  const etats   = (c = 'e7'): Promise<string> => E(`__etats('${c}')`)
  const champs  = (c = 'e7'): Promise<string[]> => E(`__champs('${c}')`)
  const coches  = (): Promise<any> => E(`JSON.stringify(__etat().coches)`)
  const journal = (): Promise<string> => E(`__H().querySelector('.evr').textContent`)
  const focus   = (c: string): Promise<number> => E(`__lignes('${c}').findIndex((l) => l.getRootNode().activeElement === l)`)

  // un clic de souris sur la case (la marge gauche) de la ligne `i`
  async function cocher(c: string, i: number) {
    const p = await E(`__coche('${c}', ${i})`)
    await s!.page.mouse.click(p.x, p.y)
    await pause()
  }

  // la page remet l'état de départ de l'hôte
  async function remettre() {
    await E(`window.__poser('modele', ${JSON.stringify(MODELE)})`)
    await E(`window.__poser('coches', [1])`)
    await pause(200)
  }

  before(async () => { s = await ouvrir(nom, build) })

  after(async () => {
    if (s) await s.fermer()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () {
    if (!s) { this.skip(); return }
    bilan = []
  })

  it('la zone est un groupe figé, chaque ligne à cocher est une case ARIA, l\'état du modèle n\'est pas lu', async function () {
    const v = await E(`(() => { const sf = __sf('e7'); return {
      role: sf.getAttribute('role'), label: sf.getAttribute('aria-label'), edit: sf.getAttribute('contenteditable'), multi: sf.getAttribute('aria-multiline'),
      barre: !!__ed('e7')._shadow.querySelector('mjs-core-toolbar'),
      lignes: __lignes('e7').map((l) => [l.getAttribute('role'), l.getAttribute('tabindex'), l.getAttribute('aria-checked'), l.getRootNode().getElementById(l.getAttribute('aria-labelledby'))?.textContent].join('|')),
      coches: [...sf.querySelectorAll('li[data-checked]')].map((li) => li.querySelector('.line').nextElementSibling.textContent),
      titre: sf.querySelector('p').textContent, lien: sf.querySelector('a').getAttribute('href'), numerotee: sf.querySelectorAll('ol > li').length,
      dansListe: __lignes('e7').every((l) => l.parentNode.localName === 'li' && l.parentNode.parentNode.hasAttribute('data-checklist'))
    } })()`)
    check('rôle du groupe, aucun champ de saisie', v.role === 'group' && v.edit === 'false' && v.multi === null, JSON.stringify(v))
    check('sans label, le groupe n\'a pas de nom (« Éditeur de texte » serait faux ici)', v.label === null, v.label)
    check('pas de barre intégrée', v.barre === false)
    check('cinq cases : rôle, arrêt de tabulation, état, texte de la ligne seule (sans la sous-liste)', JSON.stringify(v.lignes) === JSON.stringify(['checkbox|0|false|Un', 'checkbox|0|true|Deux', 'checkbox|0|false|Deux-un', 'checkbox|0|false|Deux-deux', 'checkbox|0|false|Trois avec un lien']), JSON.stringify(v.lignes))
    check('seule la case de `checked` est dessinée cochée (le data-checked du modèle est ignoré)', JSON.stringify(v.coches) === JSON.stringify(['Deux']), JSON.stringify(v.coches))
    check('le reste du texte est là : paragraphe, lien, liste numérotée', v.titre === 'Cochez ce que vous acceptez' && v.lien === 'https://exemple.fr' && v.numerotee === 1, JSON.stringify(v))
    check('chaque case est dans une ligne de liste à cocher', v.dansListe === true)
    check('la barre posée à part ne peut rien y faire (tous les boutons grisés)', await E(`[...__bar('e7')._shadow.querySelectorAll('button')].every((b) => b.getAttribute('aria-disabled') === 'true')`))
    check('la variable liée et le modèle de la page sont intacts', (await coches()) === '[1]' && (await E(`__etat().modele`)) === MODELE)
    check('un champ caché par case cochée, sous le nom', JSON.stringify(await champs()) === JSON.stringify(['reps[]=1']), JSON.stringify(await champs()))
    fin()
  })

  it('un clic sur la case coche : change annoncé, variable et champs déjà à jour, modèle jamais réécrit, jamais d\'input', async function () {
    await remettre()
    await cocher('e7', 0)
    check('la case se dessine cochée', (await etats()) === 'true,true,false,false,false', await etats())
    check('la variable liée porte les positions triées', (await coches()) === '[0,1]', await coches())
    check('change annonce la copie du tableau, et rien d\'autre (pas d\'input)', (await journal()) === 'change:[0,1]', await journal())
    check('un champ par case cochée', JSON.stringify(await champs()) === JSON.stringify(['reps[]=0', 'reps[]=1']), JSON.stringify(await champs()))
    check('FormData les porte dans l\'ordre', JSON.stringify(await E(`new FormData(__H().querySelector('.fa')).getAll('reps[]')`)) === JSON.stringify(['0', '1']))
    check('le modèle de la page n\'a pas bougé', (await E(`__etat().modele`)) === MODELE)
    check('le focus est sur la case cliquée', (await focus('e7')) === 0, await focus('e7'))
    await cocher('e7', 1)
    check('un second clic décoche', (await coches()) === '[0]' && (await journal()) === 'change:[0,1],change:[0]', `${await coches()} ${await journal()}`)
    const t = await E(`__center(__lignes('e7')[2].nextElementSibling)`)
    await s!.page.mouse.click(t.x, t.y)
    await pause()
    check('un clic sur le texte de la ligne ne coche pas (on peut sélectionner du texte)', (await coches()) === '[0]' && (await etats()) === 'true,false,false,false,false', `${await coches()} ${await etats()}`)
    fin()
  })

  it('au clavier : Espace bascule la case qui a le focus, Entrée et la répétition de touche non, Tab passe à la suivante', async function () {
    await remettre()
    await E(`__lignes('e7')[2].focus()`)
    await s!.page.keyboard.press('Space')
    await pause()
    check('Espace coche la case focalisée', (await coches()) === '[1,2]' && (await etats()) === 'false,true,true,false,false', `${await coches()} ${await etats()}`)
    await s!.page.keyboard.press('Tab')
    check('Tab mène à la case suivante', (await focus('e7')) === 3, await focus('e7'))
    await s!.page.keyboard.press('Enter')
    await pause()
    check('Entrée ne coche pas (comme une case native)', (await coches()) === '[1,2]', await coches())
    await s!.page.keyboard.down('Space')
    await s!.page.keyboard.down('Space')
    await s!.page.keyboard.up('Space')
    await pause()
    check('une touche Espace tenue ne bascule qu\'une fois', (await coches()) === '[1,2,3]', await coches())
    await s!.page.keyboard.press('Shift+Tab')
    await s!.page.keyboard.press('Space')
    await pause()
    check('Maj+Tab revient, Espace décoche', (await coches()) === '[1,3]' && (await journal()).endsWith('change:[1,3]'), `${await coches()} ${await journal()}`)
    fin()
  })

  it('la page pose les cases : elles suivent, sans change ; un modèle plus court ignore les positions absentes', async function () {
    await remettre()
    const avant = await journal()
    await E(`window.__poser('coches', [4])`)
    await pause(150)
    check('les cases suivent la variable', (await etats()) === 'false,false,false,false,true', await etats())
    check('un seul champ, celui de la case 4', JSON.stringify(await champs()) === JSON.stringify(['reps[]=4']), JSON.stringify(await champs()))
    check('aucun change quand la page pose elle-même l\'état', (await journal()) === avant, await journal())
    await E(`window.__poser('modele', '<ul data-checklist><li>A</li><li>B</li></ul>')`)
    await pause(200)
    check('nouveau modèle : deux cases, la position 4 n\'existe plus (ni dessin ni champ)', (await etats()) === 'false,false' && (await champs()).length === 0, `${await etats()} ${JSON.stringify(await champs())}`)
    check('la variable de la page n\'est pas réécrite à l\'affichage', (await coches()) === '[4]', await coches())
    await cocher('e7', 0)
    check('au premier geste la valeur est nettoyée : la position périmée disparaît', (await coches()) === '[0]', await coches())
    await remettre()
    check('le modèle d\'origine revient avec ses cases', (await etats()) === 'false,true,false,false,false', await etats())
    fin()
  })

  it('form.reset() rend les cases de départ, sans change, avec un champ par case cochée', async function () {
    await remettre()
    await cocher('e7', 0)
    await cocher('e7', 4)
    check('avant la remise à zéro', (await coches()) === '[0,1,4]', await coches())
    const avant = await journal()
    await E(`__H().querySelector('.fa').reset()`)
    await pause(400)
    check('les cases de départ sont revenues', (await coches()) === '[1]' && (await etats()) === 'false,true,false,false,false', `${await coches()} ${await etats()}`)
    check('un champ, celui de la case de départ', JSON.stringify(await champs()) === JSON.stringify(['reps[]=1']), JSON.stringify(await champs()))
    check('form.reset() n\'annonce pas de change', (await journal()) === avant, await journal())
    fin()
  })

  it('lecture seule : les réponses se voient et partent avec le formulaire, rien ne se coche', async function () {
    check('cases cochées posées par la page, en lecture seule', (await etats('e8')) === 'true,false,true,false,false', await etats('e8'))
    check('chaque case dit qu\'elle est en lecture seule et reste dans l\'ordre de tabulation', await E(`__lignes('e8').every((l) => l.getAttribute('aria-readonly') === 'true' && l.getAttribute('tabindex') === '0')`))
    await cocher('e8', 1)
    await E(`__lignes('e8')[1].focus()`)
    await s!.page.keyboard.press('Space')
    await pause()
    check('ni le clic ni Espace ne changent rien', (await etats('e8')) === 'true,false,true,false,false', await etats('e8'))
    check('les champs partent (comme un champ natif en lecture seule)', JSON.stringify(await champs('e8')) === JSON.stringify(['lecture[]=0', 'lecture[]=2']), JSON.stringify(await champs('e8')))
    fin()
  })

  it('désactivé : cases grisées hors de la tabulation, aucun champ', async function () {
    check('une case cochée dessinée cochée', (await etats('e9')) === 'true,false,false,false,false', await etats('e9'))
    check('aria-disabled, aucun arrêt de tabulation', await E(`__lignes('e9').every((l) => l.getAttribute('aria-disabled') === 'true' && !l.hasAttribute('tabindex'))`))
    await cocher('e9', 1)
    check('un clic ne coche rien', (await etats('e9')) === 'true,false,false,false,false', await etats('e9'))
    check('aucun champ envoyé', (await champs('e9')).length === 0, JSON.stringify(await champs('e9')))
    fin()
  })

  it('valeurs refusées : ce qui n\'est pas une position du texte est ignoré sans bruit', async function () {
    await remettre()
    await E(`window.__poser('coches', ['2', 2.5, -1, 99, null, 'x', true, [1], {}, 3, '3', 0.0, 'AB12', 'abc', 'abcde', 'zzzz'])`)
    await pause(150)
    check('seules les positions 0, 2 et 3 sont cochées (le texte « 2 » compte, les doublons non, un nom de la mauvaise forme ou inconnu rien)', (await etats()) === 'true,false,true,true,false', await etats())
    check('un champ par position valide', JSON.stringify(await champs()) === JSON.stringify(['reps[]=0', 'reps[]=2', 'reps[]=3']), JSON.stringify(await champs()))
    await E(`window.__poser('coches', 'pas un tableau')`)
    await pause(150)
    check('une chaîne ne coche rien', (await etats()) === 'false,false,false,false,false' && (await champs()).length === 0, `${await etats()} ${JSON.stringify(await champs())}`)
    await E(`window.__poser('coches', null)`)
    await pause(150)
    check('null ne coche rien', (await etats()) === 'false,false,false,false,false', await etats())
    check('aucune erreur dans la console', s!.logs.length === 0, s!.logs.join(' | '))
    await remettre()
    fin()
  })
})
