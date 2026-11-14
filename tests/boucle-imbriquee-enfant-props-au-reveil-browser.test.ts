// Un composant enfant posé dans la ligne d'une liste intérieure (un `{for}` dans la ligne d'un autre `{for}`, sur deux ou trois niveaux) se
// réveille avec ses props : à son `µawake`, sa prop simple et sa liaison à deux sens portent déjà les valeurs de sa ligne, et ce qu'il écrit
// alors dans la liaison remonte vers sa ligne. Vrai au chargement, pour une ligne ajoutée (intérieure ou extérieure), à chaque déplacement de sa
// ligne (il se réveille alors avec la valeur que sa ligne tient, écriture d'avant comprise) ; une ligne retirée ne change plus rien. L'enfant posé
// dans la ligne extérieure elle-même, et celui d'une liste plate voisine dans le même composant, se réveillent de même. Rendu client
// (développement, parents définis avant ou après leurs enfants ; production en un seul fichier ou en fichiers séparés) et page rendue par le
// serveur puis reprise (`markers`, `positional`, `diff`, `replace`), dont une page où le navigateur ne range pas les lignes comme le serveur :
// ses lignes sont refaites. Chromium, Firefox et WebKit réels.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MODES, variantes, construire, charger, attendre, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode, Ouverture } from './helpers/liaison-navigateur.js'
import { playTogether } from './helpers/engines-together.js'

const SOURCES: Record<string, string> = {
  // à chaque réveil : note sa ligne et la valeur reçue, puis ajoute 1 à sa liaison
  'c-compte.mjs': `<script>\n  µawake -> window.__aw = (window.__aw or []).concat([$lib + '=' + JSON.stringify($n)]); $n += 1\n</script>\n<p class="vu">{$n}</p>\n`,
  // deux niveaux : un enfant dans chaque ligne intérieure, un dans chaque ligne extérieure, et une liste plate voisine
  'p-deux.mjs': `<script>
  $groupes = [{ id: 'g1', n: 100, items: [{ id: 'i1', n: 10 }, { id: 'i2', n: 20 }] }, { id: 'g2', n: 200, items: [{ id: 'i3', n: 30 }] }]
  $plats   = [{ id: 'p1', n: 1 }, { id: 'p2', n: 2 }]
  ajouti = -> $groupes[0].items = [{ id: 'i9', n: 90 }].concat($groupes[0].items)
  ajoutg = -> $groupes = $groupes.concat([{ id: 'g9', n: 900, items: [{ id: 'i8', n: 80 }, { id: 'i7', n: 70 }] }])
  invi   = -> $groupes[0].items = [$groupes[0].items[1], $groupes[0].items[0]].concat($groupes[0].items.slice(2))
  reti   = -> $groupes[0].items = $groupes[0].items.slice(0, -1)
  rev    = -> $groupes = $groupes.slice().reverse()
  etat   = (l)-> l.map((g)-> g.id + ':' + g.n + '[' + g.items.map((i)-> i.id + ':' + i.n).join(' ') + ']').join(' ')
  plat   = (l)-> l.map((p)-> p.id + ':' + p.n).join(' ')
</script>
{for g in $groupes by id}<section class="groupe" data-id={g.id}><@c-compte n=!{g.n} lib={g.id}></@c-compte>{for i in g.items by id}<div class="item" data-id={i.id}><@c-compte n=!{i.n} lib={i.id}></@c-compte></div>{end}</section>{end}
{for p in $plats by id}<@c-compte n=!{p.n} lib={p.id}></@c-compte>{end}
<button class="ajouti" @click={ajouti()}>ajouti</button><button class="ajoutg" @click={ajoutg()}>ajoutg</button><button class="invi" @click={invi()}>invi</button><button class="reti" @click={reti()}>reti</button><button class="rev" @click={rev()}>rev</button>
<p class="etat">{etat($groupes)}</p>
<p class="plat">{plat($plats)}</p>
`,
  // trois niveaux : l'enfant dans la liste la plus intérieure
  'p-trois.mjs': `<script>
  $arbre = [{ id: 'A', b: [{ id: 'B1', c: [{ id: 'c1', n: 1 }, { id: 'c2', n: 2 }] }, { id: 'B2', c: [{ id: 'c3', n: 3 }] }] }]
  ajout = -> $arbre[0].b[0].c = $arbre[0].b[0].c.concat([{ id: 'c9', n: 9 }])
  inv   = -> $arbre[0].b[0].c = [$arbre[0].b[0].c[1], $arbre[0].b[0].c[0]].concat($arbre[0].b[0].c.slice(2))
  ret   = -> $arbre[0].b[0].c = $arbre[0].b[0].c.slice(1)
  rev   = -> $arbre[0].b = $arbre[0].b.slice().reverse()
  etat  = (l)-> l.map((x)-> x.id + '{' + x.b.map((y)-> y.id + '[' + y.c.map((z)-> z.id + ':' + z.n).join(' ') + ']').join(' ') + '}').join(' ')
</script>
{for x in $arbre by id}<section class="a">{for y in x.b by id}<div class="b">{for z in y.c by id}<span class="c" data-id={z.id}><@c-compte n=!{z.n} lib={z.id}></@c-compte></span>{end}</div>{end}</section>{end}
<button class="ajout" @click={ajout()}>ajout</button><button class="inv" @click={inv()}>inv</button><button class="ret" @click={ret()}>ret</button><button class="rev" @click={rev()}>rev</button>
<p class="etat">{etat($arbre)}</p>
`,
  // le navigateur range les lignes autrement que le serveur (groupes et lignes d'un groupe inversés) : la reprise par repères les refait
  'p-refait.mjs': `<script>
  $groupes = if µ._isServer then [{ id: 'g1', items: [{ id: 'i1', n: 10 }, { id: 'i2', n: 20 }] }, { id: 'g2', items: [{ id: 'i3', n: 30 }] }] else [{ id: 'g2', items: [{ id: 'i3', n: 30 }] }, { id: 'g1', items: [{ id: 'i2', n: 20 }, { id: 'i1', n: 10 }] }]
  etat = (l)-> l.map((g)-> g.id + '[' + g.items.map((i)-> i.id + ':' + i.n).join(' ') + ']').join(' ')
</script>
{for g in $groupes by id}<section class="groupe" data-id={g.id}>{for i in g.items by id}<div class="item" data-id={i.id}><@c-compte n=!{i.n} lib={i.id}></@c-compte></div>{end}</section>{end}
<p class="etat">{etat($groupes)}</p>
`
}

const BALISES = ['mjs-p-deux', 'mjs-p-trois', 'mjs-p-refait']

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

const titre = (mode: Mode, variante: string) => mode + (variante ? ` (${variante})` : '')

// la page au repos : deux lectures de suite identiques
async function reposee<T>(lire: () => Promise<T>): Promise<T> {
  let avant = JSON.stringify(await lire())
  for (let i = 0; i < 30; i++) {
    await new Promise((fini) => setTimeout(fini, 100))
    const apres = JSON.stringify(await lire())
    if (apres === avant) return JSON.parse(apres)
    avant = apres
  }
  return JSON.parse(avant)
}

const clic = (o: Ouverture, balise: string, bouton: string) => o.page.evaluate(`document.querySelector('${balise}')._shadow.querySelector('.${bouton}').click()`)

// ce que la page montre : les lignes `<p class="…">` du parent, la valeur que chaque enfant affiche (dans l'ordre du document), les réveils notés
const LIRE = (balise: string) => `(() => {
  const sh = document.querySelector('${balise}')._shadow
  const ps = {}
  for (const p of sh.querySelectorAll('p[class]')) ps[p.className] = p.textContent
  const vus = Array.from(sh.querySelectorAll('mjs-c-compte')).map((c) => { const p = c._shadow && c._shadow.querySelector('.vu'); return p ? p.textContent : '(absent)' })
  return { ps, vus, reveils: window.__aw || [] }
})()`

type Lu = { ps: Record<string, string>, vus: string[], reveils: string[] }

// chaque réveil porte la ligne de l'enfant (sa prop simple) et un nombre (sa liaison) ; le k-ième réveil d'une ligne voit sa valeur de départ
// plus k : chaque réveil d'avant a écrit 1 de plus, et cette écriture est revenue de la ligne. Rend le nombre de réveils de chaque ligne
function verifierReveils(reveils: string[], depart: Record<string, number>, contexte: string): Record<string, number> {
  const n: Record<string, number> = {}
  for (const r of reveils) {
    const m = /^([a-zA-Z0-9]+)=(-?\d+)$/.exec(r)
    assert.ok(m && m[1] in depart, `${contexte} : l'enfant se réveille avec sa ligne et sa valeur (« ${r} » parmi ${JSON.stringify(reveils)})`)
    const id = m![1]
    const k  = n[id] || 0
    assert.equal(Number(m![2]), depart[id] + k, `${contexte} : le réveil ${k + 1} de ${id} voit la valeur de sa ligne (${JSON.stringify(reveils)})`)
    n[id] = k + 1
  }
  return n
}

type Geste = { bouton: string, applique: () => void }

// le cas d'une page : sa valeur de départ par ligne, l'état attendu (fonction du nombre de réveils), les valeurs que les enfants affichent
// dans l'ordre du document, ses gestes
type Cas = { balise: string, nb: number, depart: Record<string, number>, etat: (n: Record<string, number>) => Record<string, string>, vus: (n: Record<string, number>) => string[], gestes: Geste[] }

function casDeux(): Cas {
  const depart: Record<string, number> = { g1: 100, g2: 200, g9: 900, i1: 10, i2: 20, i3: 30, i7: 70, i8: 80, i9: 90, p1: 1, p2: 2 }
  let ordre = ['g1', 'g2']
  const items: Record<string, string[]> = { g1: ['i1', 'i2'], g2: ['i3'], g9: ['i8', 'i7'] }
  const v = (n: Record<string, number>, id: string) => depart[id] + (n[id] || 0)
  return {
    balise: 'mjs-p-deux',
    nb: 7,
    depart,
    etat: (n) => ({ etat: ordre.map((g) => g + ':' + v(n, g) + '[' + items[g].map((i) => i + ':' + v(n, i)).join(' ') + ']').join(' '), plat: 'p1:' + v(n, 'p1') + ' p2:' + v(n, 'p2') }),
    vus: (n) => [...ordre.flatMap((g) => [g, ...items[g]]), 'p1', 'p2'].map((id) => String(v(n, id))),
    gestes: [
      { bouton: 'ajouti', applique: () => { items.g1 = ['i9', ...items.g1] } },
      { bouton: 'ajoutg', applique: () => { ordre = [...ordre, 'g9'] } },
      { bouton: 'invi', applique: () => { const l = items[ordre[0]]; items[ordre[0]] = [l[1], l[0], ...l.slice(2)] } },
      { bouton: 'reti', applique: () => { items[ordre[0]] = items[ordre[0]].slice(0, -1) } },
      { bouton: 'rev', applique: () => { ordre = [...ordre].reverse() } }
    ]
  }
}

function casTrois(): Cas {
  const depart: Record<string, number> = { c1: 1, c2: 2, c3: 3, c9: 9 }
  let b = ['B1', 'B2']
  const c: Record<string, string[]> = { B1: ['c1', 'c2'], B2: ['c3'] }
  const v = (n: Record<string, number>, id: string) => depart[id] + (n[id] || 0)
  return {
    balise: 'mjs-p-trois',
    nb: 3,
    depart,
    etat: (n) => ({ etat: 'A{' + b.map((y) => y + '[' + c[y].map((z) => z + ':' + v(n, z)).join(' ') + ']').join(' ') + '}' }),
    vus: (n) => b.flatMap((y) => c[y]).map((id) => String(v(n, id))),
    gestes: [
      { bouton: 'ajout', applique: () => { c[b[0]] = [...c[b[0]], 'c9'] } },
      { bouton: 'inv', applique: () => { const l = c[b[0]]; c[b[0]] = [l[1], l[0], ...l.slice(2)] } },
      { bouton: 'rev', applique: () => { b = [...b].reverse() } },
      { bouton: 'ret', applique: () => { c[b[0]] = c[b[0]].slice(1) } }
    ]
  }
}

function casRefait(): Cas {
  const depart: Record<string, number> = { i1: 10, i2: 20, i3: 30 }
  const v = (n: Record<string, number>, id: string) => depart[id] + (n[id] || 0)
  return {
    balise: 'mjs-p-refait',
    nb: 3,
    depart,
    etat: (n) => ({ etat: `g2[i3:${v(n, 'i3')}] g1[i2:${v(n, 'i2')} i1:${v(n, 'i1')}]` }),
    vus: (n) => ['i3', 'i2', 'i1'].map((id) => String(v(n, id))),
    gestes: []
  }
}

async function jouer(o: Ouverture, cas: Cas) {
  const lire = () => o.page.evaluate(LIRE(cas.balise)) as Promise<Lu>
  await attendre(o.page, cas.balise, cas.nb)
  let lu = await reposee(lire)
  assert.deepEqual(graves(o), [], 'aucune erreur au chargement')
  let n = verifierReveils(lu.reveils, cas.depart, 'au chargement')
  for (const [id, nb] of Object.entries(n)) assert.ok(nb >= 1, `au chargement, ${id} s'est réveillé`)
  assert.deepEqual(lu.ps, cas.etat(n), 'au chargement, chaque ligne a reçu ce que son enfant a écrit à son réveil')
  assert.deepEqual(lu.vus, cas.vus(n), 'au chargement, chaque enfant montre la valeur de sa ligne')
  for (const [i, geste] of cas.gestes.entries()) {
    geste.applique()
    await clic(o, cas.balise, geste.bouton)
    lu = await reposee(lire)
    const contexte = `geste ${i + 1} (${geste.bouton})`
    assert.deepEqual(graves(o), [], `${contexte} : aucune erreur, aucun plantage de composant`)
    n = verifierReveils(lu.reveils, cas.depart, contexte)
    assert.deepEqual(lu.ps, cas.etat(n), `${contexte} : chaque ligne garde sa valeur et ce que son enfant a écrit à chaque réveil`)
    assert.deepEqual(lu.vus, cas.vus(n), `${contexte} : chaque enfant montre la valeur de sa ligne`)
  }
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) playTogether(describe(`enfant d'une ligne de liste imbriquée : props au réveil, écriture qui remonte (${nom} réel)`, function () {
  this.timeout(300000)
  let present = false
  let browser: any

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) { console.log(`  ℹ️  ${nom} non installé, test des props au réveil dans une liste imbriquée sauté. Activer : \`npx playwright install ${nom}\``); return }
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES) for (const variante of variantes(mode)) {
    it(`deux niveaux, ${titre(mode, variante)} : enfants des lignes intérieures, extérieures et d'une liste voisine ; ligne ajoutée, déplacée, retirée`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-deux', variante)
      try {
        await jouer(o, casDeux())
      } finally {
        await o.fermer()
      }
    })

    it(`trois niveaux, ${titre(mode, variante)} : enfant de la liste la plus intérieure ; ligne ajoutée, déplacée, retirée`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-trois', variante)
      try {
        await jouer(o, casTrois())
      } finally {
        await o.fermer()
      }
    })

    if (mode === 'ssr') it(`lignes rangées autrement que par le serveur, ${titre(mode, variante)} : les lignes refaites réveillent leurs enfants avec leurs props`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-refait', variante)
      try {
        await jouer(o, casRefait())
      } finally {
        await o.fermer()
      }
    })
  }
}))
