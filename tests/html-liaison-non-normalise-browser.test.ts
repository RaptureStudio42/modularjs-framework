// `@html=!{…}` d'une balise éditable n'écrit le contenu que si la VALEUR a changé depuis la dernière écriture. Un HTML que le navigateur ne relit pas à l'identique (paragraphe non
// fermé, attributs sans guillemets) n'est jamais égal à `innerHTML` une fois écrit : comparer les deux faisait réécrire le contenu à chaque passage de l'effet, avec ses conséquences
// visibles — le code actif d'un `onerror` rejoué et l'image rechargée, les nœuds refaits, le curseur d'un `contenteditable` renvoyé au début.
// Les passages d'effet sans changement de valeur : la création (la pose initiale et l'effet de la branche), un modèle remplacé par un objet de même HTML, le règlement d'un autre
// `{await}` tant que la branche est affichée, une liste de `{for}` refaite avec les mêmes lignes.
// La liaison à deux sens reste ce qu'elle était : la frappe remonte au modèle (HTML relu du navigateur), une valeur venue du modèle redescend, sans boucle ni curseur qui saute.
// `@text=!{…}` : `textContent` se relit à l'identique, la liaison n'écrit jamais deux fois la même chaîne (retour chariot, NUL, demi-paire de substitution, nombre, null, false).
// Les trois modes : développement, production en fichiers séparés, production en un seul fichier. Chromium réel.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

// un HTML que le navigateur relit autrement : paragraphes non fermés, attributs sans guillemets, et une image dont le code `onerror` tourne chaque fois qu'elle est refaite
const HTML = '<p>un<p>deux<img src=x onerror=window.__n=(window.__n||0)+1>'

// les valeurs de `@text` : chacune doit se relire à l'identique
const VALEURS = ['a\r\nb', 'a\u0000b', '\ud800', ' ', '', '<b>x</b>', 'long ' + 'x'.repeat(5000), 0, null, false]

const SOURCES: Record<string, string> = {
  // à la racine : le modèle est un objet dont on peut changer la propriété ou seulement l'objet ; `.modele` montre le HTML du modèle en texte
  'hn-racine.mjs': `<script>
  $a = { corps: '${HTML}', n: 0 }
  @meme  = -> $a = { corps: $a.corps, n: $a.n + 1 }
  @autre = -> $a = { corps: '<i>autre', n: 0 }
  @retour = -> $a = { corps: '${HTML}', n: 0 }
</script>
<div class="ed" contenteditable="true" @html=!{$a.corps}></div>
<p class="modele">{$a.corps}</p>
<p class="n">{$a.n}</p>
`,
  // dans la branche {success} d'un {await}, un autre {await} se règle plus tard : son règlement rejoue tous les effets
  'hn-branche.mjs': `<script>
  $p  = Promise.resolve({ corps: '${HTML}' })
  fin = null
  $q  = new Promise((res) -> fin = res)
  @regler = -> fin(1)
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <div class="ed" contenteditable="true" @html=!{v.corps}></div>
{end}
{await $q}
  <i class="att2">attente</i>
{success w}
  <b class="fini">fini</b>
{end}
`,
  // dans la ligne d'un {for} à clé : refaire la liste avec les mêmes lignes met la ligne à jour sur place
  'hn-pour.mjs': `<script>
  $liste = [{ k: 1, corps: '${HTML}' }]
  @refaire = -> $liste = [{ k: 1, corps: $liste[0].corps }]
  @retour  = -> $liste = [{ k: 1, corps: '${HTML}' }]
</script>
{for it in $liste by k}
  <div class="ed" contenteditable="true" @html=!{it.corps}></div>
{end}
`,
  // `@text` : la chaîne `i` de la liste, posée deux fois de suite dans un objet neuf
  'hn-texte.mjs': `<script>
  valeurs = ${JSON.stringify(VALEURS)}
  $a = { t: 'init' }
  @poser = (i) -> $a = { t: valeurs[i] }
</script>
<div class="ed" contenteditable="true" @text=!{$a.t}></div>
`
}
const BALISES = Object.keys(SOURCES).map((f) => 'mjs-' + f.replace('.mjs', ''))

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

// le composant est monté quand sa balise éditable est dans l'ombre ; le temps de laisser l'image ratée dire son erreur, ce qui lance son code `onerror`
const pret = async (page: any, balise: string) => {
  await page.waitForFunction(`!!document.querySelector('${balise}')?._shadow?.querySelector('.ed')`, null, { timeout: 10000 })
  await page.waitForTimeout(500)
}

// un appel sur le composant (`meme()`, `regler()`…), puis le temps de la mise à jour et de l'erreur de l'image refaite
const regler = async (page: any, balise: string, appel: string) => {
  await page.evaluate(`(() => { document.querySelector('${balise}').${appel}; return null })()`)
  await page.waitForTimeout(500)
}

// ce que lit une expression sur la page : `h` est le composant, `ed` la balise éditable, `ps` ses paragraphes
const lire = (page: any, balise: string, expr: string): Promise<any> => page.evaluate(`(() => {
  const h  = document.querySelector('${balise}')
  const ed = h._shadow.querySelector('.ed')
  const ps = ed.querySelectorAll('p')
  return ${expr}
})()`)

// combien de fois le code `onerror` a tourné
const executions = (page: any): Promise<number> => page.evaluate('window.__n || 0')

// garde l'image et le nœud de texte « deux » : si le contenu est réécrit, ce ne sont plus les mêmes nœuds
const garder = (page: any, balise: string) => lire(page, balise, '(window.__gardes = { img: ed.querySelector(\'img\'), texte: ps[1].firstChild }, null)')
const memes  = (page: any, balise: string): Promise<boolean> => lire(page, balise, 'ed.querySelector(\'img\') === window.__gardes.img && ps[1].firstChild === window.__gardes.texte')

// le curseur dans « deux », au caractère `pos`, la balise active
const placer = (page: any, balise: string, pos: number) => lire(page, balise, `(() => {
  ed.focus()
  const sel = h._shadow.getSelection ? h._shadow.getSelection() : document.getSelection()
  const r   = document.createRange()
  r.setStart(ps[1].firstChild, ${pos})
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
  return null
})()`)

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`@html=!{…} avec un HTML que le navigateur relit autrement (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test de @html non normalisé sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // ouvre le composant, joue le scénario, puis exige qu'aucune erreur n'ait été dite par la page
  const jouer = async (balise: string, scenario: (page: any) => Promise<void>) => {
    const o = await charger(browser, await cible(mode), balise)
    try {
      await pret(o.page, balise)
      await scenario(o.page)
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  }

  it('les composants se compilent', async function () {
    if (!present) { this.skip(); return }
    await cible(mode)
  })

  it('racine : le code actif du HTML tourne une fois à la création', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-hn-racine'
    await jouer(B, async (page) => {
      assert.equal(await lire(page, B, 'ps.length + \'/\' + ed.querySelectorAll(\'img\').length'), '2/1', 'le HTML est bien posé')
      assert.equal(await executions(page), 1, 'exécutions de onerror à la création')
    })
  })

  it('racine : un modèle remplacé par un objet de même HTML ne réécrit pas le contenu', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-hn-racine'
    await jouer(B, async (page) => {
      await garder(page, B)
      await regler(page, B, 'meme()')
      assert.equal(await lire(page, B, 'h._shadow.querySelector(\'.n\').textContent'), '1', 'le modèle a bien été remplacé')
      assert.equal(await memes(page, B), true, 'les nœuds de l\'image et du texte sont les mêmes')
      assert.equal(await executions(page), 1, 'exécutions de onerror après le remplacement')
    })
  })

  it('racine : le curseur reste où il est quand le modèle est remplacé par un objet de même HTML', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-hn-racine'
    await jouer(B, async (page) => {
      await placer(page, B, 2)
      await regler(page, B, 'meme()')
      await page.keyboard.type('X')
      assert.equal(await lire(page, B, 'ps[1].textContent'), 'deXux', 'la lettre tapée tombe au curseur')
    })
  })

  it('racine : la frappe remonte au modèle, le curseur suit, le code actif ne repart pas', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-hn-racine'
    await jouer(B, async (page) => {
      await placer(page, B, 2)
      await page.keyboard.type('ab')
      assert.equal(await lire(page, B, 'ps[1].textContent'), 'deabux', 'les lettres tapées tombent dans l\'ordre, au curseur')
      assert.equal(await lire(page, B, 'h._shadow.querySelector(\'.modele\').textContent === ed.innerHTML'), true, 'le modèle est le HTML que le navigateur relit')
      assert.equal(await executions(page), 1, 'exécutions de onerror après la frappe')
    })
  })

  it('racine : une valeur venue du modèle redescend, y compris celle d\'avant la frappe', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-hn-racine'
    await jouer(B, async (page) => {
      await regler(page, B, 'autre()')
      assert.equal(await lire(page, B, 'ed.innerHTML'), '<i>autre</i>', 'la valeur du modèle est écrite')
      await regler(page, B, 'retour()')
      assert.equal(await lire(page, B, 'ps.length + \'/\' + ed.querySelectorAll(\'img\').length'), '2/1', 'le HTML de départ est reposé')
      assert.equal(await executions(page), 2, 'exécutions de onerror : la création et le retour')
      await placer(page, B, 2)
      await page.keyboard.type('Z')
      await regler(page, B, 'retour()')
      assert.equal(await lire(page, B, 'ps[1].textContent'), 'deux', 'la valeur du modèle redescend après une frappe')
    })
  })

  it('{success} : le code actif tourne une fois, y compris quand un autre {await} se règle', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-hn-branche'
    await jouer(B, async (page) => {
      assert.equal(await executions(page), 1, 'exécutions de onerror à la création')
      await garder(page, B)
      await regler(page, B, 'regler()')
      assert.equal(await lire(page, B, 'h._shadow.querySelector(\'.fini\') ? \'réglé\' : \'en attente\''), 'réglé', 'l\'autre {await} s\'est bien réglé')
      assert.equal(await memes(page, B), true, 'les nœuds de l\'image et du texte sont les mêmes')
      assert.equal(await executions(page), 1, 'exécutions de onerror après le règlement')
    })
  })

  it('{success} : le curseur reste où il est quand un autre {await} se règle', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-hn-branche'
    await jouer(B, async (page) => {
      await placer(page, B, 2)
      await regler(page, B, 'regler()')
      await page.keyboard.type('X')
      assert.equal(await lire(page, B, 'ps[1].textContent'), 'deXux', 'la lettre tapée tombe au curseur')
    })
  })

  it('{for} : le code actif tourne une fois, y compris quand la liste est refaite avec les mêmes lignes', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-hn-pour'
    await jouer(B, async (page) => {
      assert.equal(await executions(page), 1, 'exécutions de onerror à la création')
      await garder(page, B)
      await regler(page, B, 'refaire()')
      assert.equal(await memes(page, B), true, 'les nœuds de l\'image et du texte sont les mêmes')
      assert.equal(await executions(page), 1, 'exécutions de onerror après la liste refaite')
    })
  })

  it('{for} : la frappe dans la ligne, puis la valeur de départ remise par le modèle : le contenu redescend', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-hn-pour'
    await jouer(B, async (page) => {
      await placer(page, B, 2)
      await page.keyboard.type('Z')
      assert.equal(await lire(page, B, 'ps[1].textContent'), 'deZux', 'la lettre tapée tombe au curseur')
      await regler(page, B, 'retour()')
      assert.equal(await lire(page, B, 'ps[1].textContent'), 'deux', 'la valeur du modèle redescend après la frappe')
    })
  })

  it('@text : une chaîne posée deux fois de suite n\'est écrite qu\'une fois', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-hn-texte'
    await jouer(B, async (page) => {
      const lus = await page.evaluate(`(async () => {
        const h        = document.querySelector('${B}')
        const ed       = h._shadow.querySelector('.ed')
        const valeurs  = ${JSON.stringify(VALEURS)}
        const pause    = () => new Promise((r) => setTimeout(r, 120))
        const sortie   = []
        for (let i = 0; i < valeurs.length; i++) {
          h.poser(i)
          await pause()
          const obs = new MutationObserver(() => {})
          obs.observe(ed, { childList: true, characterData: true, subtree: true })
          h.poser(i)
          await pause()
          sortie.push('valeur ' + i + ' : ' + obs.takeRecords().length + ' écriture(s), relue ' + (ed.textContent === String(valeurs[i]) ? 'à l\\'identique' : 'DIFFERENTE'))
          obs.disconnect()
        }
        return sortie
      })()`)
      assert.deepEqual(lus, VALEURS.map((_, i) => `valeur ${i} : 0 écriture(s), relue à l'identique`))
    })
  })
})
