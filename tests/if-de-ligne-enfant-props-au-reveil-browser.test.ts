// Un composant enfant placé dans un `{if}` d'une ligne de `{for}` (liste plate et liste dans la ligne d'une autre ; `{if}` seul ou avec
// `{else}`) se réveille avec ses props : à son `µawake`, la prop simple et la liaison à deux sens portent déjà les valeurs de la ligne, et ce
// qu'il écrit alors dans la liaison remonte vers sa ligne, qui affiche aussitôt ce que sa donnée vaut. Au chargement, quand la condition retombe
// puis se relève (branche refaite dans une ligne déjà dans la page), pour une ligne ajoutée ; ligne sans directive, ligne qui porte `@attach` ou
// `@transition`, branche qui porte `@attach` autour de l'enfant (chaque `@attach` reçoit une balise déjà dans le document). Rendu client
// (développement, parents définis avant ou après leurs enfants ; production en un seul fichier ou en fichiers séparés) et page rendue par le
// serveur (`markers`, `replace`). Chromium, Firefox et WebKit réels.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode, Ouverture } from './helpers/liaison-navigateur.js'

// où vit la directive : nulle part, sur l'élément de la ligne, ou sur une balise de la branche qui entoure l'enfant
const VARIANTES: Record<string, { ligne: string, autour: boolean }> = {
  sans: { ligne: '', autour: false },
  attach: { ligne: ' :attach={noter(el)}', autour: false },
  transition: { ligne: ' :transition=*fade(duration: 60ms)', autour: false },
  branche: { ligne: '', autour: true }
}
const PARENTS = Object.keys(VARIANTES)

const SCRIPT = `<script>
  $plats   = [{ id: 'p1', n: 1, ok: true }, { id: 'p2', n: 2, ok: false }]
  $autres  = [{ id: 'q1', n: 3, ok: true }, { id: 'q2', n: 4, ok: false }]
  $groupes = [{ id: 'g1', items: [{ id: 'i1', n: 10, ok: true }, { id: 'i2', n: 20, ok: false }] }]
  noter    = (el) -> window.__att = (window.__att or []).concat([el.isConnected])
  inv      = (l) -> l.map((x) -> ({ id: x.id, n: x.n, ok: not x.ok }))
  bascule  = -> $plats = inv($plats); $autres = inv($autres); $groupes = $groupes.map((g) -> ({ id: g.id, items: inv(g.items) }))
  ajout    = -> $plats = $plats.concat([{ id: 'p9', n: 9, ok: true }]); $autres = $autres.concat([{ id: 'q9', n: 5, ok: false }]); $groupes[0].items = $groupes[0].items.concat([{ id: 'i9', n: 90, ok: true }])
  ids      = (l) -> l.map((x) -> x.id + ':' + x.n).join(' ')
  etat     = (pl, au, gr) -> ids(pl) + ' | ' + ids(au) + ' | ' + gr.map((g) -> g.id + '[' + ids(g.items) + ']').join(' ')
</script>
`
const BOUTONS = '<button class="bascule" @click={bascule()}>b</button><button class="ajout" @click={ajout()}>a</button>'

// l'enfant d'une branche : `x` est l'élément de la ligne, `suffixe` dit la branche (`e` pour `{else}`)
function enfant(x: string, lib: string, suffixe: string, autour: boolean): string {
  const c = `<@c-compte n=!{${x}.n} lib={'${lib}' + ${x}.id${suffixe ? ` + '${suffixe}'` : ''}}></@c-compte>`
  return autour ? `<span :attach={noter(el)}>${c}</span>` : c
}

// un parent par variante : un `{if}` seul dans une liste plate, un `{if}`/`{else}` dans une liste plate et dans une liste dans une liste
function parentSource(nom: string): string {
  const v   = VARIANTES[nom]
  const lib = `${nom}/`
  const si  = (x: string) => `{if ${x}.ok}${enfant(x, lib, '', v.autour)}{end}`
  const ou  = (x: string) => `{if ${x}.ok}${enfant(x, lib, '', v.autour)}{else}${enfant(x, lib, 'e', v.autour)}{end}`
  return SCRIPT +
    `{for p in $plats by id}<div class="r"${v.ligne}><b class="n">{p.n}</b>${si('p')}</div>{end}\n` +
    `{for q in $autres by id}<div class="r"${v.ligne}><b class="n">{q.n}</b>${ou('q')}</div>{end}\n` +
    `{for g in $groupes by id}<section>{for i in g.items by id}<div class="r"${v.ligne}><b class="n">{i.n}</b>${ou('i')}</div>{end}</section>{end}\n` +
    `<p class="etat">{etat($plats, $autres, $groupes)}</p>\n${BOUTONS}\n`
}

const SOURCES: Record<string, string> = {
  // à chaque réveil : note sa ligne, sa branche et la valeur reçue, puis ajoute 1 à sa liaison
  'c-compte.mjs': `<script>\n  µawake -> window.__aw = (window.__aw or []).concat([$lib + '=' + JSON.stringify($n)]); $n += 1\n</script>\n<p class="vu">{$lib}:{$n}</p>\n`
}
for (const nom of PARENTS) SOURCES[`p-${nom}.mjs`] = parentSource(nom)
SOURCES['p-tous.mjs'] = PARENTS.map((p) => `<@p-${p}></@p-${p}>`).join('\n') + '\n'

const BALISES = ['mjs-p-tous']
// rendu client dans ses quatre modes ; rendu serveur repris par repères (`markers`) ou refait (`replace`)
const JEUX: [Mode, string][] = [['dev-parents-avant', ''], ['dev-enfants-avant', ''], ['bundle', ''], ['split', ''], ['ssr', 'markers'], ['ssr', 'replace']]

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

// ce que la page montre, parent par parent : sa ligne d'état, ce que chaque ligne affiche de sa donnée et ce que montre chaque enfant vivant
// (dans l'ordre du document, hors nœuds en sortie) ; les réveils notés et ce que `@attach` a vu
const LIRE = `(() => {
  const tous = document.querySelector('mjs-p-tous')
  const sh = tous && tous._shadow
  const parents = {}
  const vivant = (c) => { for (let n = c; n; n = n.parentNode) if (n._mjs_dying) return false; return true }
  if (sh) for (const p of sh.querySelectorAll('*')) {
    if (!p.localName.startsWith('mjs-p-')) continue
    const s = p._shadow
    const etat = s && s.querySelector('.etat')
    parents[p.localName.slice(6)] = { etat: etat ? etat.textContent : '(absent)', lignes: s ? Array.from(s.querySelectorAll('.r > .n')).filter(vivant).map((b) => b.textContent) : [], vus: s ? Array.from(s.querySelectorAll('mjs-c-compte')).filter(vivant).map((c) => c._shadow && c._shadow.querySelector('.vu') ? c._shadow.querySelector('.vu').textContent : '(absent)') : [] }
  }
  return { parents, reveils: window.__aw || [], att: window.__att || [] }
})()`

type Lu = { parents: Record<string, { etat: string, lignes: string[], vus: string[] }>, reveils: string[], att: boolean[] }

// la page au repos : deux lectures de suite identiques
async function reposee(o: Ouverture): Promise<Lu> {
  let avant = JSON.stringify(await o.page.evaluate(LIRE))
  for (let i = 0; i < 40; i++) {
    await new Promise((fini) => setTimeout(fini, 120))
    const apres = JSON.stringify(await o.page.evaluate(LIRE))
    if (apres === avant) return JSON.parse(apres)
    avant = apres
  }
  return JSON.parse(avant)
}

// le même geste dans chaque parent
const geste = (o: Ouverture, bouton: string) => o.page.evaluate(`(() => {
  for (const p of document.querySelector('mjs-p-tous')._shadow.querySelectorAll('*')) if (p.localName.startsWith('mjs-p-')) p._shadow.querySelector('.${bouton}').click()
})()`)

const DEPART: Record<string, number> = { p1: 1, p2: 2, p9: 9, q1: 3, q2: 4, q9: 5, i1: 10, i2: 20, i9: 90 }

// ce que chaque parent tient : les lignes de ses trois listes et la condition de chacune ; `{if}` seul pour la première, avec `{else}` ensuite
type Modele = { plats: string[], autres: string[], groupes: [string, string[]][], ok: Record<string, boolean> }
const depart = (): Modele => ({ plats: ['p1', 'p2'], autres: ['q1', 'q2'], groupes: [['g1', ['i1', 'i2']]], ok: { p1: true, p2: false, q1: true, q2: false, i1: true, i2: false } })
const toutes = (m: Modele) => [...m.plats, ...m.autres, ...m.groupes.flatMap((g) => g[1])]
// ce que chaque ligne affiche de sa donnée se vérifie au chargement et après chaque bascule (branche refaite dans une ligne déjà dans la page :
// son enfant attend pour se réveiller la fin de la réconciliation) ; après un ajout, dans les lignes qui portent une directive, peuplées une
// fois dans la page (leurs enfants attendent de même). Une ligne neuve sans directive se peuple avant d'entrer dans la page : son enfant se
// réveille à l'insertion, sans attendre, et ce que la ligne affiche alors n'est pas vérifié ici
const TOUS = () => true
const GESTES: { bouton: string, applique: (m: Modele) => void, textes: (parent: string) => boolean }[] = [
  { bouton: 'bascule', applique: (m) => { for (const id of toutes(m)) m.ok[id] = !m.ok[id] }, textes: TOUS },
  { bouton: 'bascule', applique: (m) => { for (const id of toutes(m)) m.ok[id] = !m.ok[id] }, textes: TOUS },
  { bouton: 'ajout', applique: (m) => { m.plats.push('p9'); m.autres.push('q9'); m.groupes[0][1].push('i9'); Object.assign(m.ok, { p9: true, q9: false, i9: true }) }, textes: (parent) => VARIANTES[parent].ligne !== '' },
  { bouton: 'bascule', applique: (m) => { for (const id of toutes(m)) m.ok[id] = !m.ok[id] }, textes: TOUS }
]

// l'enfant que montre une ligne : la branche `{if}` quand la condition tient, sinon celle de `{else}` (rien dans la première liste)
function montre(m: Modele, id: string): string | null {
  if (m.ok[id]) return id
  return m.plats.includes(id) ? null : id + 'e'
}

// chaque réveil porte le parent, la ligne et la branche de l'enfant (sa prop simple) et un nombre (sa liaison) ; le k-ième réveil d'une ligne,
// toutes branches confondues, voit sa valeur de départ plus k : chaque réveil d'avant a écrit 1 de plus, et cette écriture est revenue de la
// ligne. Rend, par parent, le nombre de réveils de chaque ligne et la branche du dernier
function verifierReveils(reveils: string[], contexte: string): Record<string, Record<string, { n: number, branche: string }>> {
  const n: Record<string, Record<string, { n: number, branche: string }>> = {}
  for (const r of reveils) {
    const m = /^([a-z]+)\/([a-z]\d)(e?)=(-?\d+)$/.exec(r)
    assert.ok(m && PARENTS.includes(m[1]) && m[2] in DEPART, `${contexte} : l'enfant se réveille avec sa ligne et sa valeur (« ${r} »)`)
    const [, parent, id, e, v] = m!
    const k = ((n[parent] ||= {})[id] || { n: 0 }).n
    assert.equal(Number(v), DEPART[id] + k, `${contexte}, ${parent} : le réveil ${k + 1} de ${id} voit la valeur de sa ligne (${reveils.filter((x) => x.startsWith(parent + '/')).join(' ')})`)
    n[parent][id] = { n: k + 1, branche: id + e }
  }
  return n
}

function verifier(lu: Lu, m: Modele, contexte: string, textes: (parent: string) => boolean = TOUS) {
  const n = verifierReveils(lu.reveils, contexte)
  const v = (parent: string, id: string) => DEPART[id] + ((n[parent] || {})[id] || { n: 0 }).n
  for (const parent of PARENTS) {
    const vu = lu.parents[parent]
    assert.ok(vu, `${contexte} : le parent ${parent} est monté`)
    for (const id of toutes(m)) {
      const b = montre(m, id)
      if (b === null) continue
      const r = (n[parent] || {})[id]
      assert.ok(r && r.branche === b, `${contexte}, ${parent} : l'enfant de ${id} montré (${b}) s'est réveillé en dernier (${r ? r.branche : 'aucun réveil'})`)
    }
    const ids  = (l: string[]) => l.map((id) => id + ':' + v(parent, id)).join(' ')
    const etat = ids(m.plats) + ' | ' + ids(m.autres) + ' | ' + m.groupes.map(([g, l]) => g + '[' + ids(l) + ']').join(' ')
    assert.equal(vu.etat, etat, `${contexte}, ${parent} : chaque ligne a reçu ce que son enfant a écrit à chaque réveil`)
    if (textes(parent)) assert.deepEqual(vu.lignes, toutes(m).map((id) => String(v(parent, id))), `${contexte}, ${parent} : chaque ligne affiche ce que sa donnée vaut, écriture de son enfant comprise`)
    const attendus = toutes(m).map((id) => [id, montre(m, id)] as const).filter(([, b]) => b !== null).map(([id, b]) => `${parent}/${b}:${v(parent, id)}`)
    assert.deepEqual(vu.vus, attendus, `${contexte}, ${parent} : chaque enfant montre sa ligne, sa branche et la valeur de sa ligne`)
  }
  assert.ok(lu.att.length > 0 && lu.att.every((x) => x === true), `${contexte} : chaque @attach reçoit une balise déjà dans le document (${JSON.stringify(lu.att)})`)
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`enfant d'un {if} de ligne : réveillé avec ses props (${nom} réel)`, function () {
  this.timeout(300000)
  let present = false
  let browser: any

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) { console.log(`  ℹ️  ${nom} non installé, test des props au réveil dans un {if} de ligne sauté. Activer : \`npx playwright install ${nom}\``); return }
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const [mode, variante] of JEUX) {
    it(`${mode}${variante ? ` (${variante})` : ''} : ${PARENTS.length} parents, {if} seul et {if}/{else}, liste plate et imbriquée ; condition qui retombe et se relève, lignes ajoutées`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-tous', variante)
      try {
        await o.page.waitForFunction(`(window.__aw || []).length >= ${PARENTS.length * 5}`, null, { timeout: 8000 }).catch(() => {})
        const m = depart()
        let lu = await reposee(o)
        assert.deepEqual(graves(o), [], 'aucune erreur au chargement')
        verifier(lu, m, 'au chargement')
        for (const [i, g] of GESTES.entries()) {
          g.applique(m)
          await geste(o, g.bouton)
          lu = await reposee(o)
          assert.deepEqual(graves(o), [], `${g.bouton} (geste ${i + 1}) : aucune erreur, aucun plantage de composant`)
          verifier(lu, m, `${g.bouton} (geste ${i + 1})`, g.textes)
        }
      } finally {
        await o.fermer()
      }
    })
  }
})
