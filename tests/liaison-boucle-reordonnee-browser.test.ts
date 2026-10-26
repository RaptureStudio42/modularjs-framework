// Réordonner, ajouter ou retirer des lignes d'un `{for}` dont les éléments portent un composant lié à deux sens à une propriété de l'élément
// (`x=!{d.lignes}`, `value=!{d.n}`) ne mêle JAMAIS les valeurs des éléments : chaque ligne garde ses données, dans la variable du parent comme
// chez son enfant. Une ligne déplacée voit ses enfants déconnectés puis reconnectés ; tout ce qu'un enfant écrit dans sa propriété liée à ce
// moment (la valeur d'un attribut relue, `µawake` rejoué à chaque connexion) part vers le gestionnaire de sa ligne, qui lit l'élément par l'indice
// gardé sur le nœud : tant que la ligne n'a pas repris sa place, c'est l'indice de l'ancienne, et l'écriture tombe chez l'élément qui l'occupe.
// Les écritures des enfants attendent donc la fin de la réconciliation de la liste, puis remontent vers la bonne ligne.
// Sont joués : les listes (tableaux, objets) et les nombres, les modules du cœur (sortable, number, select, tabs, checkbox, switch) et les
// enfants du projet, un enfant qui réécrit sa propriété à chaque réveil, des boucles imbriquées ; dans quatre modes de chargement (développement
// avec les parents définis avant ou après les enfants, production en un fichier ou en fichiers séparés) et le rendu serveur, dans Chromium et
// Firefox réels.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MODES, variantes, construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode, Ouverture } from './helpers/liaison-navigateur.js'

// l'état du parent, imprimé en JSON : ce qu'il croit de ses lignes
const PARENT = (donnees: string, corps: string) => `<script>
  $menu = ${donnees}
  inv    = -> $menu = [$menu[1], $menu[0]].concat($menu.slice(2))
  dep    = -> $menu = [$menu[$menu.length - 1]].concat($menu.slice(0, -1))
  ajout  = -> $menu = [NEUF].concat($menu)
  ret    = -> $menu = $menu.slice(1)
  retmil = -> $menu = [$menu[0]].concat($menu.slice(2))
  invi   = -> $menu[0].items = [$menu[0].items[1], $menu[0].items[0]]
  etat   = (l)-> JSON.stringify(l)
</script>
${corps}
<button class="inv" @click={inv()}>inv</button><button class="dep" @click={dep()}>dep</button><button class="ajout" @click={ajout()}>ajout</button><button class="ret" @click={ret()}>ret</button><button class="retmil" @click={retmil()}>retmil</button><button class="invi" @click={invi()}>invi</button>
<p class="etat">{etat($menu)}</p>
`

const ids = (...l: string[]) => l.map((id) => ({ id }))

const PROJET = () => [
  { id: 'm1', lignes: ids('l11', 'l12'), o: { k: [1, 2] }, n: 1 },
  { id: 'm2', lignes: ids('l21', 'l22', 'l23'), o: { k: [3] }, n: 2 },
  { id: 'm3', lignes: [], o: { k: [] }, n: 3 }
]
const NEUF_PROJET = { id: 'm4', lignes: ids('l41'), o: { k: [9] }, n: 4 }

const COEUR = () => [
  { id: 'm1', lignes: ids('l11', 'l12'), n: 1, sel: ['a'], t: 'x', ck: true, sw: false },
  { id: 'm2', lignes: ids('l21', 'l22', 'l23'), n: 2, sel: ['b', 'c'], t: 'y', ck: false, sw: true },
  { id: 'm3', lignes: [], n: 3, sel: [], t: 'x', ck: true, sw: true }
]
const NEUF_COEUR = { id: 'm4', lignes: ids('l41'), n: 4, sel: ['a', 'b'], t: 'y', ck: false, sw: false }

const EVEIL = () => [
  { id: 'm1', lignes: ids('l11', 'l12') },
  { id: 'm2', lignes: ids('l21', 'l22', 'l23') },
  { id: 'm3', lignes: [] }
]
const NEUF_EVEIL = { id: 'm4', lignes: ids('l41') }

const IMBRIQUE = () => [
  { id: 'm1', items: [{ id: 'a', v: ids('a1') }, { id: 'b', v: ids('b1', 'b2') }] },
  { id: 'm2', items: [{ id: 'c', v: ids('c1') }] },
  { id: 'm3', items: [] }
]
const NEUF_IMBRIQUE = { id: 'm4', items: [{ id: 'd', v: ids('d1') }] }

const SOURCES: Record<string, string> = {
  // un enfant qui montre sa propriété `x` telle qu'il la tient
  'c-tab.mjs': `<script>\n  vu = (v)-> JSON.stringify(v)\n</script>\n<p class="vu">{vu($x)}</p>\n`,
  'c-nb.mjs': `<p class="vu">{$x}</p>\n`,
  // un enfant qui réécrit sa propriété à chaque connexion de sa balise : à la première, et à chaque déplacement de sa ligne
  'c-eveil.mjs': `<script>\n  vu = (v)-> JSON.stringify(v)\n  µawake -> $x = Array.from($x or [])\n</script>\n<p class="vu">{vu($x)}</p>\n`,
  'p-projet.mjs': PARENT(JSON.stringify(PROJET()), `{for d in $menu by id}
  <section class="groupe" data-id={d.id}>
    <@c-tab x=!{d.lignes}></@c-tab>
    <@c-tab x=!{d.o}></@c-tab>
    <@c-nb x=!{d.n}></@c-nb>
  </section>
{end}`).replace('NEUF', JSON.stringify(NEUF_PROJET)),
  'p-coeur.mjs': PARENT(JSON.stringify(COEUR()), `{for d in $menu by id}
  <section class="groupe" data-id={d.id}>
    <@@sortable class="lignes" value=!{d.lignes} group="menu">
      {for l in d.lignes by id}
        <div class="ligne" data-id={l.id}>{l.id}</div>
      {end}
    </@@sortable>
    <@@number value=!{d.n}></@@number>
    <@@select multiple value=!{d.sel}>
      <@@option value="a">A</@@option>
      <@@option value="b">B</@@option>
      <@@option value="c">C</@@option>
    </@@select>
    <@@tabs value=!{d.t}><span value="x">X</span><span value="y">Y</span></@@tabs>
    <@@checkbox checked=!{d.ck}>c</@@checkbox>
    <@@switch checked=!{d.sw}>s</@@switch>
  </section>
{end}`).replace('NEUF', JSON.stringify(NEUF_COEUR)),
  'p-eveil.mjs': PARENT(JSON.stringify(EVEIL()), `{for d in $menu by id}
  <section class="groupe" data-id={d.id}>
    <@c-eveil x=!{d.lignes}></@c-eveil>
  </section>
{end}`).replace('NEUF', JSON.stringify(NEUF_EVEIL)),
  'p-imbrique.mjs': PARENT(JSON.stringify(IMBRIQUE()), `{for g in $menu by id}
  <section class="groupe" data-id={g.id}>
    {for l in g.items by id}
      <div class="item" data-id={l.id}><@c-eveil x=!{l.v}></@c-eveil></div>
    {end}
  </section>
{end}`).replace('NEUF', JSON.stringify(NEUF_IMBRIQUE))
}

type Genre = 'projet' | 'coeur' | 'eveil' | 'imbrique'
const GENRES: Genre[] = ['projet', 'coeur', 'eveil', 'imbrique']
const DEPART: Record<Genre, () => any[]> = { projet: PROJET, coeur: COEUR, eveil: EVEIL, imbrique: IMBRIQUE }
const NEUF: Record<Genre, any> = { projet: NEUF_PROJET, coeur: NEUF_COEUR, eveil: NEUF_EVEIL, imbrique: NEUF_IMBRIQUE }

// la suite des gestes jouée sur une même page, et ce que le parent doit en tenir
const GESTES: Array<{ bouton: string, genres?: Genre[], applique: (m: any[], genre: Genre) => any[] }> = [
  { bouton: 'invi', genres: ['imbrique'], applique: (m) => { m[0].items = [m[0].items[1], m[0].items[0]]; return m } },
  { bouton: 'inv', applique: (m) => [m[1], m[0], ...m.slice(2)] },
  { bouton: 'dep', applique: (m) => [m[m.length - 1], ...m.slice(0, -1)] },
  { bouton: 'ajout', applique: (m, genre) => [JSON.parse(JSON.stringify(NEUF[genre])), ...m] },
  { bouton: 'retmil', applique: (m) => [m[0], ...m.slice(2)] },
  { bouton: 'inv', applique: (m) => [m[1], m[0], ...m.slice(2)] },
  { bouton: 'ret', applique: (m) => m.slice(1) }
]

// ce que montrent les enfants de chaque ligne, dans la forme des données du parent
const LIRE = `(() => {
  const genre = %GENRE%
  const sh = document.querySelector('mjs-p-' + genre)._shadow
  const vu = (e) => { const p = e && e._shadow && e._shadow.querySelector('.vu'); return p ? p.textContent : '(absent)' }
  const json = (e) => { try { return JSON.parse(vu(e)) } catch (x) { return vu(e) } }
  const etat = (e, k) => { const v = e && e._state ? e._state[k] : '(absent)'; return JSON.parse(JSON.stringify(v === undefined ? null : v)) }
  const rows = Array.from(sh.querySelectorAll('section.groupe')).map((s) => {
    if (genre === 'projet') { const t = s.querySelectorAll('mjs-c-tab'); return { id: s.dataset.id, lignes: json(t[0]), o: json(t[1]), n: Number(vu(s.querySelector('mjs-c-nb'))) } }
    if (genre === 'eveil') return { id: s.dataset.id, lignes: json(s.querySelector('mjs-c-eveil')) }
    if (genre === 'imbrique') return { id: s.dataset.id, items: Array.from(s.querySelectorAll('.item')).map((i) => ({ id: i.dataset.id, v: json(i.querySelector('mjs-c-eveil')) })) }
    const q = (n, k) => etat(s.querySelector('mjs-core-' + n), k)
    return { id: s.dataset.id, lignes: q('sortable', 'value'), n: q('number', 'value'), sel: q('select', 'value'), t: q('tabs', 'value'), ck: q('checkbox', 'checked'), sw: q('switch', 'checked') }
  })
  const rendu = Array.from(sh.querySelectorAll('section.groupe')).map((s) => Array.from(s.querySelectorAll('.ligne')).map((l) => l.dataset.id))
  return { rows: JSON.stringify(rows), etat: sh.querySelector('p.etat').textContent, rendu: JSON.stringify(rendu) }
})()`

const lire = (page: any, genre: Genre): Promise<{ rows: string, etat: string, rendu: string }> => page.evaluate(LIRE.replace('%GENRE%', JSON.stringify(genre)))

// le parent monté, ses lignes rendues, et tous les enfants montés (ceux du projet ayant rendu leur ligne `.vu`)
async function pret(page: any, genre: Genre, lignes: number) {
  await page.waitForFunction(`(() => {
    const h = document.querySelector('mjs-p-${genre}')
    const sh = h && h._shadow
    if (!h || !h._mjs_is_mounted || !sh) return false
    if (sh.querySelectorAll('section.groupe').length < ${lignes}) return false
    const enf = Array.from(sh.querySelectorAll('*')).filter((c) => /^mjs-(c-|core-)/.test(c.localName) && c.localName !== 'mjs-core-option')
    return enf.length > 0 && enf.every((c) => c._mjs_is_mounted && (c.localName.startsWith('mjs-core-') || (c._shadow && c._shadow.querySelector('.vu'))))
  })()`, null, { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(250)
}

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, ['mjs-p-projet', 'mjs-p-eveil', 'mjs-p-imbrique']))
  return cibles.get(mode)!
}

const GENRES_PAR_MODE = (mode: Mode): Genre[] => mode === 'ssr' ? GENRES.filter((g) => g !== 'coeur') : GENRES

for (const nom of ['chromium', 'firefox'] as const) describe(`boucle réordonnée, composants liés à deux sens (${nom} réel)`, function () {
  this.timeout(300000)
  let present = false
  let browser: any

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) { console.log(`  ℹ️  ${nom} non installé, test des boucles réordonnées sauté. Activer : \`npx playwright install ${nom}\``); return }
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES) for (const variante of variantes(mode)) for (const genre of GENRES_PAR_MODE(mode)) {
    const quoi = { projet: 'listes, objets et nombres de composants du projet', coeur: 'sortable, number, select, tabs, checkbox et switch', eveil: 'enfant qui réécrit sa liste à chaque réveil', imbrique: 'boucles imbriquées, enfant qui réécrit sa liste à chaque réveil' }[genre]
    it(`${mode}${variante ? ` (${variante})` : ''} — ${quoi} : inverser, déplacer, ajouter en tête, retirer ne mêlent aucune ligne`, async function () {
      if (!present) { this.skip(); return }
      const balise = 'mjs-p-' + genre
      const o: Ouverture = await charger(browser, await cible(mode), balise, variante)
      try {
        await pret(o.page, genre, DEPART[genre]().length)
        let attendu = DEPART[genre]()
        const depart = await lire(o.page, genre)
        assert.deepEqual(graves(o), [], 'aucune erreur au chargement')
        assert.equal(depart.rows, JSON.stringify(attendu), 'au départ, chaque ligne montre ses données')
        for (const [i, geste] of GESTES.entries()) {
          if (geste.genres && !geste.genres.includes(genre)) continue
          attendu = geste.applique(attendu, genre)
          await o.page.evaluate(`document.querySelector('${balise}')._shadow.querySelector('.${geste.bouton}').click()`)
          await o.page.waitForFunction(`document.querySelector('${balise}')?._shadow?.querySelector('p.etat')?.textContent === ${JSON.stringify(JSON.stringify(attendu))}`, null, { timeout: 4000 }).catch(() => {})
          await o.page.waitForTimeout(250)
          const lu = await lire(o.page, genre)
          const contexte = `geste ${i + 1} (${geste.bouton})`
          const remontes = await o.page.evaluate('window.__binds') as string[]
          assert.deepEqual(graves(o), [], `${contexte} : aucune erreur, aucun plantage de composant`)
          assert.equal(lu.etat, JSON.stringify(attendu), `${contexte} : le parent garde les données de chaque ligne (écritures des enfants : ${remontes.join(' ; ')})`)
          assert.equal(lu.rows, JSON.stringify(attendu), `${contexte} : chaque enfant montre les données de sa ligne`)
          if (genre === 'coeur') assert.equal(lu.rendu, JSON.stringify(attendu.map((m: any) => m.lignes.map((l: any) => l.id))), `${contexte} : le contenu glissable de chaque ligne suit sa ligne`)
        }
      } finally {
        await o.fermer()
      }
    })
  }
})
