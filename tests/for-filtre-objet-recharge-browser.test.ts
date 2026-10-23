// dispatch filtré d'une ligne de {for} (`data-h={it.id === $sel ? it.h : ''}`, `xlink:href`, `@style.color`, `@class{it.id === $sel}`) : quand le choix change, seules l'ancienne et la
// nouvelle ligne sont écrites, et la valeur écrite est celle de l'objet COURANT de la ligne. Une liste rechargée aux mêmes clés (données revenues du serveur, objets neufs)
// laisse les lignes en place : la mise à jour filtrée ne doit pas garder l'ancien objet, ni une entrée d'index d'une clé que la ligne n'a plus.
// Scénarios joués : liste rechargée puis choix changé ; choix changé puis liste rechargée (la ligne choisie prend la valeur neuve tout de suite) ; une clé qui disparaît puis revient ;
// le champ filtré qui change sur une ligne gardée (`it.code`, la clé du `by` restant `id`) ; `{for}` sans clé (objets, puis valeurs simples positionnelles) ; le témoin non filtré (`data-t={it.h}`) ;
// une boucle dans une boucle, dont la valeur écrite vient du groupe parent rechargé ; l'index et un `{const}` lus par la valeur.
// Le code émis est lu aussi : le rattrapage (fonction de la ligne refaite à chaque passe, retrait de l'ancienne clé) n'est émis que là où le défaut est possible ; un filtre sur la clé du `by`
// (`@class{$sel === it.id}` dans `{for it in … by id}`) garde le code d'avant, à l'octet.
// Les trois modes : développement, production en fichiers séparés, production en un seul fichier. Chromium réel.
// Un dernier composant garde le gain du dispatch : mille lignes, le choix change, deux écritures par liste (ancienne et nouvelle ligne) et aucune relecture des lignes.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

// une ligne : sa clé, le champ sur lequel le choix filtre (`code`), puis les trois valeurs écrites (texte, adresse d'icône, couleur)
type Ligne = { id: number, code: string, h: string, cible: string, couleur: string }

const ligne = (id: number, code: string, h: string, cible: string, couleur: string): Ligne => ({ id, code, h, cible, couleur })

// la liste de départ, puis la même liste rechargée (mêmes clés, objets neufs, valeurs changées, code de la première ligne changé), puis la ligne 2 qui revient avec d'autres valeurs
const AVANT = [ligne(1, 'x', 'a', '#a', 'red'), ligne(2, 'y', 'b', '#b', 'green'), ligne(3, 'z', 'c', '#c', 'blue')]
const APRES = [ligne(1, 'w', 'A', '#A', 'maroon'), ligne(2, 'y', 'B', '#B', 'olive'), ligne(3, 'z', 'C', '#C', 'navy')]
const RETOUR = [ligne(1, 'w', 'A', '#A', 'maroon'), ligne(2, 'v', 'Z', '#Z', 'teal'), ligne(3, 'z', 'C', '#C', 'navy')]

const PRET = '<i class="pret"></i>'

// le script commun des composants à lignes clés : la liste, le choix par numéro (`$sel`) et par code (`$code`), le rechargement, le retrait de la ligne 2 et son retour
const SCRIPT_CLE = `  $liste = ${JSON.stringify(AVANT)}
  $sel   = 1
  $code  = 'x'
  @choisir   = (n)-> $sel = n
  @coder     = (c)-> $code = c
  @recharger = -> $liste = ${JSON.stringify(APRES)}
  @retirer   = -> $liste = $liste.filter((l)-> l.id isnt 2)
  @revenir   = -> $liste = ${JSON.stringify(RETOUR)}`

const SOURCES: Record<string, string> = {
  // l'attribut filtré sur la clé et sur un autre champ, l'icône `xlink:href` filtrée dans la ligne, et le témoin non filtré
  'ff-attribut.mjs': `<script>
${SCRIPT_CLE}
</script>
<div class="lignes">
  {for it in $liste by id}
    <p class="l" data-h={it.id === $sel ? it.h : ''} data-c={it.code === $code ? it.h : ''} data-e={it.code === $code ? 'oui' : ''} data-k={it.id === $sel ? 'oui' : ''} data-i={it.id === $sel ? it.id : ''} data-t={it.h}><b class="id">{it.id}</b><svg class="s" width="10" height="10"><use class="u" xlink:href={it.id === $sel ? it.cible : '#z'}></use></svg></p>
  {end}
</div>
${PRET}
`,
  // le style filtré, sur la clé et sur un autre champ
  'ff-style.mjs': `<script>
${SCRIPT_CLE}
</script>
<div class="lignes">
  {for it in $liste by id}
    <p class="l" @style.color={it.id === $sel ? it.couleur : ''} @style.outline-color={it.code === $code ? it.couleur : ''}><b class="id">{it.id}</b></p>
  {end}
</div>
${PRET}
`,
  // la classe filtrée, sur la clé et sur un autre champ, puis sur des valeurs simples sans clé
  'ff-classe.mjs': `<script>
${SCRIPT_CLE}
  $noms = ['a', 'b', 'c']
  $nom  = 'a'
  @nommer    = (m)-> $nom = m
  @remplacer = -> $noms = ['x', 'b', 'c']
</script>
<div class="lignes">
  {for it in $liste by id}
    <p class="l" @class{it.id === $sel}="actif" @class{it.code === $code}="code"><b class="id">{it.id}</b></p>
  {end}
</div>
<div class="noms">
  {for t in $noms}
    <a class="n" @class{t === $nom}="on"><b class="id">{t}</b></a>
  {end}
</div>
${PRET}
`,
  // les listes sans clé : des objets (la ligne suit l'objet), puis des valeurs simples (la ligne suit la position)
  'ff-sans-cle.mjs': `<script>
  $objets = ${JSON.stringify([{ id: 1, h: 'a' }, { id: 2, h: 'b' }, { id: 3, h: 'c' }])}
  $noms   = ['a', 'b', 'c']
  $sel    = 1
  $nom    = 'a'
  @choisir   = (n)-> $sel = n
  @nommer    = (m)-> $nom = m
  @recharger = -> $objets = ${JSON.stringify([{ id: 1, h: 'A' }, { id: 2, h: 'B' }, { id: 3, h: 'C' }])}
  @remplacer = -> $noms = ['x', 'b', 'c']
</script>
<div class="objets">
  {for it in $objets}
    <p class="o" data-h={it.id === $sel ? it.h : ''}><b class="id">{it.id}</b></p>
  {end}
</div>
<div class="noms">
  {for t in $noms}
    <p class="p" data-x={t === $nom ? 'oui' : ''} @style.color={t === $nom ? 'red' : ''}><b class="id">{t}</b></p>
  {end}
</div>
${PRET}
`,
  // la valeur écrite lit l'index de la ligne et un `{const}` calculé sur elle : la liste est inversée (mêmes objets, autres places) puis rechargée (objets neufs)
  'ff-portee.mjs': `<script>
  $liste = ${JSON.stringify([{ id: 1, h: 'a' }, { id: 2, h: 'b' }, { id: 3, h: 'c' }])}
  $sel   = 1
  @choisir   = (n)-> $sel = n
  @inverser  = -> $liste = $liste.slice().reverse()
  @recharger = -> $liste = ${JSON.stringify([{ id: 1, h: 'A' }, { id: 2, h: 'B' }, { id: 3, h: 'C' }])}
</script>
<div class="lignes">
  {for i, it in $liste by id}
    {const lib = it.h + '!'}
    <p class="l" data-n={it.id === $sel ? i + 1 : ''} data-l={it.id === $sel ? lib : ''}><b class="id">{it.id}</b></p>
  {end}
</div>
${PRET}
`,
  // une boucle dans une boucle : la valeur écrite vient du groupe parent, rechargé (objets neufs) alors que les lignes intérieures gardent les mêmes objets ; les numéros des lignes
  // sont uniques d'un groupe à l'autre (le choix désigne une seule ligne)
  'ff-imbrique.mjs': `<script>
  $groupes = ${JSON.stringify([{ id: 1, couleur: 'red', items: [{ id: 1 }, { id: 2 }] }, { id: 2, couleur: 'green', items: [{ id: 3 }, { id: 4 }] }])}
  $sel     = 1
  @choisir   = (n)-> $sel = n
  @recolorer = -> $groupes = $groupes.map((g)-> { id: g.id, couleur: g.couleur.toUpperCase(), items: g.items })
</script>
<div class="groupes">
  {for g in $groupes by id}
    <div class="g">
      {for it in g.items by id}
        <p class="l" data-c={it.id === $sel ? g.couleur : ''}><b class="id">{it.id}</b></p>
      {end}
    </div>
  {end}
</div>
${PRET}
`,
  // mille lignes pour chacune des trois écritures filtrées ; `id` compte ses lectures : le choix qui change ne doit relire aucune ligne
  'ff-mille.mjs': `<script>
  window.lecturesId = 0
  ligne = (i)->
    o = { h: 'h' + i }
    Object.defineProperty(o, 'id', { get: (-> window.lecturesId += 1; i), enumerable: true })
    o
  $liste = (ligne(i) for i in [1..1000])
  $sel   = 1
  @choisir = (n)-> $sel = n
</script>
<div class="a">{for it in $liste by id}<i data-h={it.id === $sel ? it.h : ''}></i>{end}</div>
<div class="s">{for it in $liste by id}<i @style.color={it.id === $sel ? 'red' : ''}></i>{end}</div>
<div class="c">{for it in $liste by id}<i @class{it.id === $sel}="actif"></i>{end}</div>
${PRET}
`
}
const BALISES = Object.keys(SOURCES).map((f) => 'mjs-' + f.replace('.mjs', ''))

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

// le composant est monté quand sa dernière balise est dans l'ombre, ou quand il est tombé (la page montre alors un bandeau d'erreur)
const pret = async (page: any, balise: string) => {
  await page.waitForFunction(`(() => {
    const h = document.querySelector('${balise}')
    return !!h && (h.classList.contains('mjs-error') || !!(h._shadow && h._shadow.querySelector('.pret, .mjs-fatal-error')))
  })()`, null, { timeout: 10000 })
  await page.waitForTimeout(150)
}

// un appel sur le composant (`choisir(3)`, `recharger()`…), puis le temps de la mise à jour
const regler = async (page: any, balise: string, appel: string) => {
  await page.evaluate(`(() => { document.querySelector('${balise}').${appel}; return null })()`)
  await page.waitForTimeout(200)
}

// le composant a survécu : un plantage vide son ombre, lui pose la classe `mjs-error` et y met un bandeau `mjs-fatal-error`
const vivant = (page: any, balise: string): Promise<boolean> => page.evaluate(`(() => {
  const h = document.querySelector('${balise}')
  return !h.classList.contains('mjs-error') && !h._shadow.querySelector('.mjs-fatal-error') && !!h._shadow.querySelector('.pret')
})()`)

// note un écart, sans arrêter le cas : tous les écarts d'un cas sont rendus ensemble
const verifier = (ecarts: string[], quoi: string, lu: unknown, attendu: unknown) => {
  if (JSON.stringify(lu) !== JSON.stringify(attendu)) ecarts.push(`${quoi} : attendu ${JSON.stringify(attendu)}, lu ${JSON.stringify(lu) ?? 'rien'}`)
}

// ce que la page montre des éléments `sel` du composant, un texte par élément : le numéro de sa ligne (`.id`), deux-points, puis la valeur du champ demandé ; `-` quand rien n'est posé
// (attribut absent, style vide, classe absente) ; la fonction tourne dans la page
const LIRE = ([balise, sel, champ]: [string, string, string]): string[] => {
  const hote = (document.querySelector(balise) as any)._shadow
  return Array.from(hote.querySelectorAll(sel) as ArrayLike<any>).map((n: any) => {
    const id = (n.querySelector('.id') ?? n.closest('.l').querySelector('.id')).textContent
    let valeur: string | null
    if (champ.startsWith('classe:')) valeur = n.classList.contains(champ.slice(7)) ? 'oui' : null
    else if (champ.startsWith('style.')) valeur = n.style[champ.slice(6)] || null
    else valeur = n.getAttribute(champ)
    return `${id}:${valeur ?? '-'}`
  })
}

const voir = async (page: any, ecarts: string[], quoi: string, balise: string, sel: string, champ: string, attendu: string[]) => {
  verifier(ecarts, quoi, await page.evaluate(LIRE, [balise, sel, champ]), attendu)
}

// les écritures dans le DOM pendant un appel (attributs, styles, classes) et les relectures de `id` : les méthodes natives sont espionnées le temps de l'appel, puis rendues
const compter = (page: any, balise: string, appel: string): Promise<Record<string, number>> => page.evaluate(`(async () => {
  const n = { attributs: 0, styles: 0, classes: 0, lectures: 0 }
  const poses = []
  const espion = (proto, nom, cle) => {
    const origine = proto[nom]
    proto[nom] = function (...a) { n[cle] += 1; return origine.apply(this, a) }
    poses.push(() => { proto[nom] = origine })
  }
  for (const nom of ['setAttribute', 'removeAttribute', 'setAttributeNS', 'removeAttributeNS']) espion(Element.prototype, nom, 'attributs')
  for (const nom of ['setProperty', 'removeProperty']) espion(CSSStyleDeclaration.prototype, nom, 'styles')
  for (const nom of ['add', 'remove', 'toggle']) espion(DOMTokenList.prototype, nom, 'classes')
  window.lecturesId = 0
  document.querySelector('${balise}').${appel}
  await new Promise((r) => setTimeout(r, 300))
  n.lectures = window.lecturesId
  for (const rendre of poses) rendre()
  return n
})()`)

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`dispatch filtré d'une ligne de {for} : l'objet courant de la ligne (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test du dispatch filtré sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // ouvre le composant, joue le scénario, puis exige qu'aucun écart n'ait été noté et qu'aucune erreur n'ait été dite par la page
  const jouer = async (balise: string, scenario: (page: any, ecarts: string[]) => Promise<void>) => {
    const o      = await charger(browser, await cible(mode), balise)
    const ecarts = [] as string[]
    try {
      await pret(o.page, balise)
      verifier(ecarts, 'composant vivant, à la création', await vivant(o.page, balise), true)
      await scenario(o.page, ecarts)
      verifier(ecarts, 'composant vivant, à la fin', await vivant(o.page, balise), true)
      assert.deepEqual([...ecarts, ...graves(o).map((g) => `erreur de la page : ${g}`)], [])
    } finally {
      await o.fermer()
    }
  }

  it('les composants se compilent', async function () {
    if (!present) { this.skip(); return }
    await cible(mode)
  })

  it('attribut : le témoin non filtré suit la liste rechargée', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-attribut'
    await jouer(B, async (page, ecarts) => {
      await voir(page, ecarts, 'data-t, à la création', B, '.l', 'data-t', ['1:a', '2:b', '3:c'])
      await regler(page, B, 'recharger()')
      await voir(page, ecarts, 'data-t, liste rechargée', B, '.l', 'data-t', ['1:A', '2:B', '3:C'])
    })
  })

  it('attribut et icône : liste rechargée aux mêmes clés, puis le choix change', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-attribut'
    await jouer(B, async (page, ecarts) => {
      await voir(page, ecarts, 'data-h, à la création', B, '.l', 'data-h', ['1:a', '2:-', '3:-'])
      await voir(page, ecarts, 'xlink:href, à la création', B, '.u', 'xlink:href', ['1:#a', '2:#z', '3:#z'])
      await regler(page, B, 'recharger()')
      await voir(page, ecarts, 'data-h, liste rechargée', B, '.l', 'data-h', ['1:A', '2:-', '3:-'])
      await voir(page, ecarts, 'xlink:href, liste rechargée', B, '.u', 'xlink:href', ['1:#A', '2:#z', '3:#z'])
      await regler(page, B, 'choisir(3)')
      await voir(page, ecarts, 'data-h, choix 3', B, '.l', 'data-h', ['1:-', '2:-', '3:C'])
      await voir(page, ecarts, 'xlink:href, choix 3', B, '.u', 'xlink:href', ['1:#z', '2:#z', '3:#C'])
      await regler(page, B, 'choisir(2)')
      await voir(page, ecarts, 'data-h, choix 2', B, '.l', 'data-h', ['1:-', '2:B', '3:-'])
      await voir(page, ecarts, 'xlink:href, choix 2', B, '.u', 'xlink:href', ['1:#z', '2:#B', '3:#z'])
    })
  })

  it('attribut et icône : le choix change, puis la liste est rechargée aux mêmes clés', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-attribut'
    await jouer(B, async (page, ecarts) => {
      await regler(page, B, 'choisir(2)')
      await voir(page, ecarts, 'data-h, choix 2', B, '.l', 'data-h', ['1:-', '2:b', '3:-'])
      await regler(page, B, 'recharger()')
      await voir(page, ecarts, 'data-h, liste rechargée (la ligne choisie prend la valeur neuve)', B, '.l', 'data-h', ['1:-', '2:B', '3:-'])
      await voir(page, ecarts, 'xlink:href, liste rechargée', B, '.u', 'xlink:href', ['1:#z', '2:#B', '3:#z'])
      await regler(page, B, 'choisir(1)')
      await voir(page, ecarts, 'data-h, choix 1', B, '.l', 'data-h', ['1:A', '2:-', '3:-'])
      await voir(page, ecarts, 'xlink:href, choix 1', B, '.u', 'xlink:href', ['1:#A', '2:#z', '3:#z'])
    })
  })

  it('attribut : une clé qui disparaît puis revient avec un objet neuf, les autres lignes rechargées', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-attribut'
    await jouer(B, async (page, ecarts) => {
      await regler(page, B, 'retirer()')
      await voir(page, ecarts, 'data-h, ligne 2 retirée', B, '.l', 'data-h', ['1:a', '3:-'])
      await regler(page, B, 'choisir(2)')
      await voir(page, ecarts, 'data-h, choix d\'une ligne absente', B, '.l', 'data-h', ['1:-', '3:-'])
      await regler(page, B, 'revenir()')
      await voir(page, ecarts, 'data-h, ligne 2 revenue', B, '.l', 'data-h', ['1:-', '2:Z', '3:-'])
      await regler(page, B, 'choisir(3)')
      await voir(page, ecarts, 'data-h, choix 3', B, '.l', 'data-h', ['1:-', '2:-', '3:C'])
      await regler(page, B, 'choisir(2)')
      await voir(page, ecarts, 'data-h, choix 2', B, '.l', 'data-h', ['1:-', '2:Z', '3:-'])
    })
  })

  it('attribut : le champ filtré (`code`) change sur une ligne gardée, l\'ancien code ne désigne plus rien', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-attribut'
    await jouer(B, async (page, ecarts) => {
      await voir(page, ecarts, 'data-c, à la création', B, '.l', 'data-c', ['1:a', '2:-', '3:-'])
      await regler(page, B, 'recharger()')
      await voir(page, ecarts, 'data-c, liste rechargée (la ligne 1 a pour code w)', B, '.l', 'data-c', ['1:-', '2:-', '3:-'])
      await regler(page, B, 'coder(\'q\')')
      await voir(page, ecarts, 'data-c, code q (aucune ligne)', B, '.l', 'data-c', ['1:-', '2:-', '3:-'])
      await regler(page, B, 'coder(\'x\')')
      await voir(page, ecarts, 'data-c, ancien code x', B, '.l', 'data-c', ['1:-', '2:-', '3:-'])
      await regler(page, B, 'coder(\'w\')')
      await voir(page, ecarts, 'data-c, code w', B, '.l', 'data-c', ['1:A', '2:-', '3:-'])
      await regler(page, B, 'coder(\'y\')')
      await voir(page, ecarts, 'data-c, code y', B, '.l', 'data-c', ['1:-', '2:B', '3:-'])
    })
  })

  it('style : liste rechargée puis le choix change ; le choix change puis la liste est rechargée', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-style'
    await jouer(B, async (page, ecarts) => {
      await voir(page, ecarts, 'color, à la création', B, '.l', 'style.color', ['1:red', '2:-', '3:-'])
      await regler(page, B, 'recharger()')
      await voir(page, ecarts, 'color, liste rechargée', B, '.l', 'style.color', ['1:maroon', '2:-', '3:-'])
      await regler(page, B, 'choisir(3)')
      await voir(page, ecarts, 'color, choix 3', B, '.l', 'style.color', ['1:-', '2:-', '3:navy'])
      await regler(page, B, 'choisir(2)')
      await regler(page, B, 'revenir()')
      await voir(page, ecarts, 'color, liste rechargée après le choix 2', B, '.l', 'style.color', ['1:-', '2:teal', '3:-'])
      await regler(page, B, 'choisir(1)')
      await voir(page, ecarts, 'color, choix 1', B, '.l', 'style.color', ['1:maroon', '2:-', '3:-'])
    })
  })

  it('style : le champ filtré (`code`) change sur une ligne gardée, l\'ancien code ne désigne plus rien', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-style'
    await jouer(B, async (page, ecarts) => {
      await voir(page, ecarts, 'outline-color, à la création', B, '.l', 'style.outlineColor', ['1:red', '2:-', '3:-'])
      await regler(page, B, 'recharger()')
      await voir(page, ecarts, 'outline-color, liste rechargée', B, '.l', 'style.outlineColor', ['1:-', '2:-', '3:-'])
      await regler(page, B, 'coder(\'q\')')
      await voir(page, ecarts, 'outline-color, code q (aucune ligne)', B, '.l', 'style.outlineColor', ['1:-', '2:-', '3:-'])
      await regler(page, B, 'coder(\'x\')')
      await voir(page, ecarts, 'outline-color, ancien code x', B, '.l', 'style.outlineColor', ['1:-', '2:-', '3:-'])
      await regler(page, B, 'coder(\'w\')')
      await voir(page, ecarts, 'outline-color, code w', B, '.l', 'style.outlineColor', ['1:maroon', '2:-', '3:-'])
    })
  })

  it('classe : liste rechargée aux mêmes clés puis le choix change (témoin : la classe ne lit que la clé)', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-classe'
    await jouer(B, async (page, ecarts) => {
      await voir(page, ecarts, 'actif, à la création', B, '.l', 'classe:actif', ['1:oui', '2:-', '3:-'])
      await regler(page, B, 'recharger()')
      await regler(page, B, 'choisir(3)')
      await voir(page, ecarts, 'actif, choix 3 après le rechargement', B, '.l', 'classe:actif', ['1:-', '2:-', '3:oui'])
      await regler(page, B, 'choisir(2)')
      await voir(page, ecarts, 'actif, choix 2', B, '.l', 'classe:actif', ['1:-', '2:oui', '3:-'])
    })
  })

  it('classe : le champ filtré (`code`) change sur une ligne gardée, l\'ancien code ne désigne plus rien', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-classe'
    await jouer(B, async (page, ecarts) => {
      await voir(page, ecarts, 'code, à la création', B, '.l', 'classe:code', ['1:oui', '2:-', '3:-'])
      await regler(page, B, 'recharger()')
      await voir(page, ecarts, 'code, liste rechargée', B, '.l', 'classe:code', ['1:-', '2:-', '3:-'])
      await regler(page, B, 'coder(\'q\')')
      await voir(page, ecarts, 'code, code q (aucune ligne)', B, '.l', 'classe:code', ['1:-', '2:-', '3:-'])
      await regler(page, B, 'coder(\'x\')')
      await voir(page, ecarts, 'code, ancien code x', B, '.l', 'classe:code', ['1:-', '2:-', '3:-'])
      await regler(page, B, 'coder(\'w\')')
      await voir(page, ecarts, 'code, code w', B, '.l', 'classe:code', ['1:oui', '2:-', '3:-'])
    })
  })

  it('classe sur des valeurs simples sans clé : la ligne garde sa position, l\'ancienne valeur ne désigne plus rien', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-classe'
    await jouer(B, async (page, ecarts) => {
      await voir(page, ecarts, 'on, à la création', B, '.n', 'classe:on', ['a:oui', 'b:-', 'c:-'])
      await regler(page, B, 'remplacer()')
      await voir(page, ecarts, 'on, valeur remplacée', B, '.n', 'classe:on', ['x:-', 'b:-', 'c:-'])
      await regler(page, B, 'nommer(\'b\')')
      await voir(page, ecarts, 'on, valeur b', B, '.n', 'classe:on', ['x:-', 'b:oui', 'c:-'])
      await regler(page, B, 'nommer(\'a\')')
      await voir(page, ecarts, 'on, ancienne valeur a', B, '.n', 'classe:on', ['x:-', 'b:-', 'c:-'])
      await regler(page, B, 'nommer(\'x\')')
      await voir(page, ecarts, 'on, valeur x', B, '.n', 'classe:on', ['x:oui', 'b:-', 'c:-'])
    })
  })

  it('sans clé, des objets : la liste rechargée (objets neufs) puis le choix change', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-sans-cle'
    await jouer(B, async (page, ecarts) => {
      await voir(page, ecarts, 'data-h, à la création', B, '.o', 'data-h', ['1:a', '2:-', '3:-'])
      await regler(page, B, 'recharger()')
      await voir(page, ecarts, 'data-h, liste rechargée', B, '.o', 'data-h', ['1:A', '2:-', '3:-'])
      await regler(page, B, 'choisir(2)')
      await voir(page, ecarts, 'data-h, choix 2', B, '.o', 'data-h', ['1:-', '2:B', '3:-'])
      await regler(page, B, 'choisir(3)')
      await voir(page, ecarts, 'data-h, choix 3', B, '.o', 'data-h', ['1:-', '2:-', '3:C'])
    })
  })

  it('sans clé, des valeurs simples : attribut et style suivent la valeur de la position, l\'ancienne valeur ne désigne plus rien', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-sans-cle'
    await jouer(B, async (page, ecarts) => {
      await voir(page, ecarts, 'data-x, à la création', B, '.p', 'data-x', ['a:oui', 'b:-', 'c:-'])
      await regler(page, B, 'remplacer()')
      await voir(page, ecarts, 'data-x, valeur remplacée', B, '.p', 'data-x', ['x:-', 'b:-', 'c:-'])
      await regler(page, B, 'nommer(\'b\')')
      await voir(page, ecarts, 'data-x, valeur b', B, '.p', 'data-x', ['x:-', 'b:oui', 'c:-'])
      await regler(page, B, 'nommer(\'a\')')
      await voir(page, ecarts, 'data-x, ancienne valeur a', B, '.p', 'data-x', ['x:-', 'b:-', 'c:-'])
      await voir(page, ecarts, 'color, ancienne valeur a', B, '.p', 'style.color', ['x:-', 'b:-', 'c:-'])
      await regler(page, B, 'nommer(\'x\')')
      await voir(page, ecarts, 'data-x, valeur x', B, '.p', 'data-x', ['x:oui', 'b:-', 'c:-'])
      await voir(page, ecarts, 'color, valeur x', B, '.p', 'style.color', ['x:red', 'b:-', 'c:-'])
    })
  })

  it('attribut : valeur constante ou champ filtré lui-même (le code d\'avant), liste rechargée puis le choix change', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-attribut'
    await jouer(B, async (page, ecarts) => {
      await voir(page, ecarts, 'data-k, à la création', B, '.l', 'data-k', ['1:oui', '2:-', '3:-'])
      await voir(page, ecarts, 'data-i, à la création', B, '.l', 'data-i', ['1:1', '2:-', '3:-'])
      await regler(page, B, 'recharger()')
      await regler(page, B, 'choisir(3)')
      await voir(page, ecarts, 'data-k, choix 3 après le rechargement', B, '.l', 'data-k', ['1:-', '2:-', '3:oui'])
      await voir(page, ecarts, 'data-i, choix 3 après le rechargement', B, '.l', 'data-i', ['1:-', '2:-', '3:3'])
      await regler(page, B, 'choisir(2)')
      await voir(page, ecarts, 'data-k, choix 2', B, '.l', 'data-k', ['1:-', '2:oui', '3:-'])
      await voir(page, ecarts, 'data-i, choix 2', B, '.l', 'data-i', ['1:-', '2:2', '3:-'])
    })
  })

  it('attribut : valeur constante sur un champ filtré qui change (`code`), l\'ancien code ne désigne plus rien', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-attribut'
    await jouer(B, async (page, ecarts) => {
      await voir(page, ecarts, 'data-e, à la création', B, '.l', 'data-e', ['1:oui', '2:-', '3:-'])
      await regler(page, B, 'recharger()')
      await voir(page, ecarts, 'data-e, liste rechargée (la ligne 1 a pour code w)', B, '.l', 'data-e', ['1:-', '2:-', '3:-'])
      await regler(page, B, 'coder(\'q\')')
      await regler(page, B, 'coder(\'x\')')
      await voir(page, ecarts, 'data-e, ancien code x', B, '.l', 'data-e', ['1:-', '2:-', '3:-'])
      await regler(page, B, 'coder(\'w\')')
      await voir(page, ecarts, 'data-e, code w', B, '.l', 'data-e', ['1:oui', '2:-', '3:-'])
    })
  })

  it('l\'index et un `{const}` lus par la valeur : la liste inversée puis rechargée, la valeur est celle de la ligne au choix suivant', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-portee'
    await jouer(B, async (page, ecarts) => {
      await voir(page, ecarts, 'data-n, à la création', B, '.l', 'data-n', ['1:1', '2:-', '3:-'])
      await voir(page, ecarts, 'data-l, à la création', B, '.l', 'data-l', ['1:a!', '2:-', '3:-'])
      await regler(page, B, 'inverser()')
      await voir(page, ecarts, 'data-n, liste inversée (la ligne choisie prend sa nouvelle place)', B, '.l', 'data-n', ['3:-', '2:-', '1:3'])
      await regler(page, B, 'choisir(3)')
      await voir(page, ecarts, 'data-n, choix 3 (sa place est la première)', B, '.l', 'data-n', ['3:1', '2:-', '1:-'])
      await regler(page, B, 'recharger()')
      await voir(page, ecarts, 'data-l, liste rechargée', B, '.l', 'data-l', ['1:-', '2:-', '3:C!'])
      await voir(page, ecarts, 'data-n, liste rechargée', B, '.l', 'data-n', ['1:-', '2:-', '3:3'])
      await regler(page, B, 'choisir(2)')
      await voir(page, ecarts, 'data-l, choix 2', B, '.l', 'data-l', ['1:-', '2:B!', '3:-'])
      await voir(page, ecarts, 'data-n, choix 2', B, '.l', 'data-n', ['1:-', '2:2', '3:-'])
    })
  })

  it('boucle imbriquée : la valeur du groupe parent rechargé (objets neufs, mêmes lignes intérieures) est lue au choix suivant', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-imbrique'
    await jouer(B, async (page, ecarts) => {
      await voir(page, ecarts, 'data-c, à la création', B, '.l', 'data-c', ['1:red', '2:-', '3:-', '4:-'])
      await regler(page, B, 'recolorer()')
      await voir(page, ecarts, 'data-c, groupes rechargés (la ligne choisie prend la valeur neuve)', B, '.l', 'data-c', ['1:RED', '2:-', '3:-', '4:-'])
      await regler(page, B, 'choisir(4)')
      await voir(page, ecarts, 'data-c, choix 4', B, '.l', 'data-c', ['1:-', '2:-', '3:-', '4:GREEN'])
      await regler(page, B, 'choisir(2)')
      await voir(page, ecarts, 'data-c, choix 2', B, '.l', 'data-c', ['1:-', '2:RED', '3:-', '4:-'])
    })
  })

  it('le gain du dispatch : mille lignes, le choix change, deux écritures par liste et aucune relecture des lignes', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-ff-mille'
    await jouer(B, async (page, ecarts) => {
      const n = await page.evaluate(`document.querySelector('${B}')._shadow.querySelectorAll('.a i, .s i, .c i').length`)
      verifier(ecarts, 'lignes posées (trois listes de mille)', n, 3000)
      verifier(ecarts, 'écritures et relectures quand le choix passe de 1 à 500', await compter(page, B, 'choisir(500)'), { attributs: 2, styles: 2, classes: 2, lectures: 0 })
      verifier(ecarts, 'écritures et relectures quand le choix passe de 500 à 3', await compter(page, B, 'choisir(3)'), { attributs: 2, styles: 2, classes: 2, lectures: 0 })
      const lu = await page.evaluate(`(() => { const a = document.querySelector('${B}')._shadow.querySelectorAll('.a i'); return [a[2].getAttribute('data-h'), a[499].getAttribute('data-h'), a[0].getAttribute('data-h')] })()`)
      verifier(ecarts, 'data-h des lignes 3, 500 et 1 après les deux choix', lu, ['h3', null, null])
    })
  })
})

// le code émis : la liaison filtrée n'émet son rattrapage que là où le défaut est possible, et garde le code d'avant, à l'octet, ailleurs
describe('dispatch filtré d\'une ligne de {for} : le code émis ne grossit que là où le défaut est possible', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  const SCRIPT = `<script>
  $liste   = [{ id: 1, code: 'x', h: 'a', couleur: 'red' }]
  $groupes = [{ id: 1, couleur: 'red', items: [{ id: 1 }] }]
  $noms    = ['a', 'b']
  $sel     = 1
  $nom     = 'a'
  $couleur = 'red'
</script>
`

  const emis = async (gabarit: string): Promise<string> => String((await transpile(`${SCRIPT}${gabarit}\n`, { moduleName: 'emis' })).output)

  // `filtree` : l'index de la liaison existe ; `garde` : la fonction de la ligne n'est refaite que si la clé est inédite ou détenue par une autre ligne (la forme d'avant, sinon elle est
  // refaite à chaque passe) ; `lache` : la ligne lâche l'entrée de son ancienne clé
  const forme = async (gabarit: string) => {
    const sortie = await emis(gabarit)
    return { filtree: /_mjs_filterFns/.test(sortie), garde: /if \(__f0 === void 0 \|\| __idx\.get\(__k\) !== __f0\)/.test(sortie), lache: /_mjs_pk/.test(sortie) }
  }

  type Attendu = { garde?: boolean, lache: boolean }

  // un gabarit par ligne : tous les écarts du tableau sont rendus ensemble
  const verifierFormes = async (cas: Record<string, [string, Attendu]>) => {
    const ecarts: string[] = []
    for (const [nom, [gabarit, attendu]] of Object.entries(cas)) {
      const lu = await forme(gabarit)
      if (!lu.filtree) { ecarts.push(`${nom} : la liaison n'est pas filtrée`); continue }
      if (attendu.garde !== undefined && lu.garde !== attendu.garde) ecarts.push(`${nom} : fonction ${attendu.garde ? 'refaite seulement si la clé est inédite (forme d\'avant)' : 'refaite à chaque passe'} attendue, lu ${lu.garde ? 'la forme d\'avant' : 'refaite à chaque passe'}`)
      if (lu.lache !== attendu.lache) ecarts.push(`${nom} : ${attendu.lache ? 'retrait de l\'ancienne clé' : 'aucun retrait de l\'ancienne clé'} attendu, lu ${lu.lache ? 'un retrait' : 'aucun retrait'}`)
    }
    assert.deepEqual(ecarts, [])
  }

  it('@class : la ligne lâche son ancienne clé seulement si le champ filtré n\'est pas la clé du by (ou sans by)', async () => {
    await verifierFormes({
      'filtre sur la clé du by':      ['{for it in $liste by id}<p @class{it.id === $sel}="a">{it.id}</p>{end}', { lache: false }],
      'filtre sur un autre champ':    ['{for it in $liste by id}<p @class{it.code === $sel}="a">{it.id}</p>{end}', { lache: true }],
      'boucle sans by':               ['{for it in $liste}<p @class{it.id === $sel}="a">{it.id}</p>{end}', { lache: true }],
      'valeurs simples sans by':      ['{for t in $noms}<p @class{t === $nom}="a">{t}</p>{end}', { lache: true }]
    })
  })

  it('attribut : la fonction est refaite à chaque passe seulement si la valeur lit la ligne, et la ligne lâche son ancienne clé seulement si le champ filtré n\'est pas la clé du by', async () => {
    await verifierFormes({
      'by, valeur constante':                       ['{for it in $liste by id}<p data-k={it.id === $sel ? \'oui\' : \'\'}>{it.id}</p>{end}', { garde: true, lache: false }],
      'by, valeur = le champ filtré':               ['{for it in $liste by id}<p data-i={it.id === $sel ? it.id : \'\'}>{it.id}</p>{end}', { garde: true, lache: false }],
      'by, forme booléenne':                        ['{for it in $liste by id}<p aria-selected={it.id === $sel}>{it.id}</p>{end}', { garde: true, lache: false }],
      'by, valeur lue dans l\'état':                ['{for it in $liste by id}<p data-s={it.id === $sel ? $couleur : \'\'}>{it.id}</p>{end}', { garde: true, lache: false }],
      'by, valeur = un autre champ':                ['{for it in $liste by id}<p data-h={it.id === $sel ? it.h : \'\'}>{it.id}</p>{end}', { garde: false, lache: false }],
      'by, valeur = l\'index':                      ['{for i, it in $liste by id}<p data-n={it.id === $sel ? i : \'\'}>{it.id}</p>{end}', { garde: false, lache: false }],
      'by, valeur = un {const}':                    ['{for it in $liste by id}{const lib = it.h}<p data-l={it.id === $sel ? lib : \'\'}>{it.id}</p>{end}', { garde: false, lache: false }],
      'by, valeur = la ligne parente':              ['{for g in $groupes by id}{for it in g.items by id}<p data-c={it.id === $sel ? g.couleur : \'\'}>{it.id}</p>{end}{end}', { garde: false, lache: false }],
      'autre champ, valeur constante':              ['{for it in $liste by id}<p data-c={it.code === $sel ? \'oui\' : \'\'}>{it.id}</p>{end}', { garde: true, lache: true }],
      'autre champ, valeur = le champ filtré':      ['{for it in $liste by id}<p data-c={it.code === $sel ? it.code : \'\'}>{it.id}</p>{end}', { garde: true, lache: true }],
      'autre champ, valeur = un autre champ':       ['{for it in $liste by id}<p data-c={it.code === $sel ? it.h : \'\'}>{it.id}</p>{end}', { garde: false, lache: true }],
      'boucle sans by, valeur constante':           ['{for it in $liste}<p data-k={it.id === $sel ? \'oui\' : \'\'}>{it.id}</p>{end}', { garde: true, lache: true }],
      'valeurs simples, valeur constante':          ['{for t in $noms}<p data-x={t === $nom ? \'oui\' : \'\'}>{t}</p>{end}', { garde: true, lache: true }],
      'valeurs simples, valeur = l\'élément':       ['{for t in $noms}<p data-x={t === $nom ? t : \'\'}>{t}</p>{end}', { garde: false, lache: true }]
    })
  })

  it('@style : mêmes règles que l\'attribut', async () => {
    await verifierFormes({
      'by, valeur constante':                       ['{for it in $liste by id}<p @style.color={it.id === $sel ? \'red\' : \'\'}>{it.id}</p>{end}', { garde: true, lache: false }],
      'by, valeur = un autre champ':                ['{for it in $liste by id}<p @style.color={it.id === $sel ? it.couleur : \'\'}>{it.id}</p>{end}', { garde: false, lache: false }],
      'autre champ, valeur constante':              ['{for it in $liste by id}<p @style.color={it.code === $sel ? \'red\' : \'\'}>{it.id}</p>{end}', { garde: true, lache: true }],
      'autre champ, valeur = un autre champ':       ['{for it in $liste by id}<p @style.color={it.code === $sel ? it.couleur : \'\'}>{it.id}</p>{end}', { garde: false, lache: true }]
    })
  })

  it('filtre sur la clé du by : le code émis est celui d\'avant, à l\'octet (classe, attribut, style)', async () => {
    const classe   = await emis('{for it in $liste by id}<p @class{it.id === $sel}="a">{it.id}</p>{end}')
    const attribut = await emis('{for it in $liste by id}<p data-k={it.id === $sel ? \'oui\' : \'\'}>{it.id}</p>{end}')
    const style    = await emis('{for it in $liste by id}<p @style.color={it.id === $sel ? \'red\' : \'\'}>{it.id}</p>{end}')
    const queue    = String.raw`\(_mjsThis\._mjs_filtIdxKeys \?\?= new Set\(\)\)\.add\('[^']+'\); \(__nodes\._mjs_filterKeys \?\?= \{\}\)\['[^']+'\] = __k; \} \}`
    const corps    = String.raw`const __fns = \(__nodes\._mjs_filterFns \?\?= \{\}\); const __f0 = __fns\['[^']+'\]; if \(__f0 === void 0 \|\| __idx\.get\(__k\) !== __f0\) \{ const __f = \(_mjs_match\) => \{ let _mjs_node = _mjs_n\w+; if \(_mjs_match\) \{ [^;]+; \} else \{ [^;]+; \} \}; __idx\.set\(__k, __f\); __fns\['[^']+'\] = __f; \} `
    assert.match(classe, new RegExp(String.raw`const __fns = \(__nodes\._mjs_filterFns \?\?= \{\}\); if \(__fns\['[^']+'\] === void 0 \|\| __idx\.get\(__k\) !== _mjs_n\w+\) \{ __idx\.set\(__k, _mjs_n\w+\); __fns\['[^']+'\] = _mjs_n\w+; \} ` + queue), 'classe')
    assert.match(attribut, new RegExp(corps + queue), 'attribut')
    assert.match(style, new RegExp(corps + queue), 'style')
  })
})
