// Un composant qui porte une directive qui lit la balise dans le document — `@transition`, `@in`, `@out`, `@attach`, `@this=!`, un effet
// (`*magnet`) ou `@flip` —, posée sur la ligne de ses listes, ailleurs dans son gabarit ou dans un `{if}` sans rapport : les composants enfants
// des lignes de ses listes (liste plate et liste dans la ligne d'une autre) se réveillent avec leurs props. À son `µawake`, la prop simple et la
// liaison à deux sens portent déjà les valeurs de la ligne, et ce que l'enfant écrit alors dans la liaison remonte vers sa ligne : au
// chargement, pour une ligne ajoutée (dans une ligne qui existe, ou avec la ligne qui la porte), à chaque déplacement de sa ligne (`@flip`
// l'anime), et une ligne retirée (sa transition de sortie jouée) ne change plus rien. Un `@attach` posé sur la ligne reçoit toujours une balise
// déjà dans le document. Rendu client (développement, parents définis avant ou après leurs enfants ; production en un seul fichier ou en
// fichiers séparés) et page rendue par le serveur puis reprise (`markers`, `positional`, `diff`, `replace`). Chromium, Firefox et WebKit réels.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MODES, variantes, construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode, Ouverture } from './helpers/liaison-navigateur.js'

// les directives, chacune posée de trois façons : sur l'élément de chaque ligne, sur une balise hors des listes, dans un `{if}` sans rapport
const DIRECTIVES: Record<string, { ligne: (v: string) => string, ailleurs: string, si: string }> = {
  transition: { ligne: () => ':transition=*fade(duration: 60ms)', ailleurs: '<p class="t" :transition=*fade(duration: 60ms)>t</p>', si: '{if $vu}<p class="t" :transition=*fade(duration: 60ms)>t</p>{end}' },
  in: { ligne: () => ':in=*fade(duration: 60ms)', ailleurs: '<p class="t" :in=*fade(duration: 60ms)>t</p>', si: '{if $vu}<p class="t" :in=*fade(duration: 60ms)>t</p>{end}' },
  out: { ligne: () => ':out=*fade(duration: 60ms)', ailleurs: '<p class="t" :out=*fade(duration: 60ms)>t</p>', si: '{if $vu}<p class="t" :out=*fade(duration: 60ms)>t</p>{end}' },
  attach: { ligne: () => ':attach={noter(el)}', ailleurs: '<div class="t" :attach={noter(el)}></div>', si: '{if $vu}<div class="t" :attach={noter(el)}></div>{end}' },
  this: { ligne: (v) => `:this=!{refs[${v}.id]}`, ailleurs: '<p class="t" :this=!{ref}>t</p>', si: '{if $vu}<p class="t" :this=!{ref}>t</p>{end}' },
  effet: { ligne: () => '*magnet', ailleurs: '<p class="t" *magnet>t</p>', si: '{if $vu}<p class="t" *magnet>t</p>{end}' },
  flip: { ligne: () => ':flip=60', ailleurs: '{for a in $autres by id}<p class="t" :flip=60>{a.id}</p>{end}', si: '{if $vu}{for a in $autres by id}<p class="t" :flip=60>{a.id}</p>{end}{end}' }
}
const PLACES = ['ligne', 'ailleurs', 'si'] as const

const SCRIPT = `<script>
  $plats   = [{ id: 'p1', n: 1 }, { id: 'p2', n: 2 }]
  $groupes = [{ id: 'g1', items: [{ id: 'i1', n: 10 }, { id: 'i2', n: 20 }] }]
  $autres  = [{ id: 'a1' }, { id: 'a2' }]
  $vu      = true
  refs     = {}
  noter    = (el) -> window.__att = (window.__att or []).concat([el.isConnected])
  ajout    = -> $plats = $plats.concat([{ id: 'p9', n: 9 }]); $groupes[0].items = $groupes[0].items.concat([{ id: 'i9', n: 90 }])
  ajoutg   = -> $groupes = $groupes.concat([{ id: 'g2', items: [{ id: 'i7', n: 70 }, { id: 'i8', n: 80 }] }])
  inverse  = -> $plats = $plats.slice().reverse(); $groupes[0].items = $groupes[0].items.slice().reverse(); $autres = $autres.slice().reverse()
  retrait  = -> $plats = $plats.slice(1); $groupes[0].items = $groupes[0].items.slice(1)
  etat     = (pl, gr) -> pl.map((p) -> p.id + ':' + p.n).join(' ') + ' | ' + gr.map((g) -> g.id + '[' + g.items.map((i) -> i.id + ':' + i.n).join(' ') + ']').join(' ')
</script>
`
const BOUTONS = '<button class="ajout" @click={ajout()}>a</button><button class="ajoutg" @click={ajoutg()}>g</button><button class="inverse" @click={inverse()}>i</button><button class="retrait" @click={retrait()}>r</button>'

// un parent par directive et par place : une liste plate et une liste dans la ligne d'une autre, un enfant `c-compte` dans chaque ligne
function parentSource(nom: string, place: typeof PLACES[number]): string {
  const d   = DIRECTIVES[nom]
  const dp  = place === 'ligne' ? ' ' + d.ligne('p') : ''
  const di  = place === 'ligne' ? ' ' + d.ligne('i') : ''
  const hors = place === 'ailleurs' ? d.ailleurs + '\n' : place === 'si' ? d.si + '\n' : ''
  const lib = `${nom}-${place}/`
  return SCRIPT + hors +
    `{for p in $plats by id}<div class="r"${dp}><@c-compte n=!{p.n} lib={'${lib}' + p.id}></@c-compte></div>{end}\n` +
    `{for g in $groupes by id}<section>{for i in g.items by id}<div class="r"${di}><@c-compte n=!{i.n} lib={'${lib}' + i.id}></@c-compte></div>{end}</section>{end}\n` +
    `<p class="etat">{etat($plats, $groupes)}</p>\n${BOUTONS}\n`
}

const PARENTS: string[] = []
const SOURCES: Record<string, string> = {
  // à chaque réveil : note sa ligne et la valeur reçue, puis ajoute 1 à sa liaison
  'c-compte.mjs': `<script>\n  µawake -> window.__aw = (window.__aw or []).concat([$lib + '=' + JSON.stringify($n)]); $n += 1\n</script>\n<p class="vu">{$n}</p>\n`
}
for (const nom of Object.keys(DIRECTIVES)) for (const place of PLACES) {
  PARENTS.push(`${nom}-${place}`)
  SOURCES[`p-${nom}-${place}.mjs`] = parentSource(nom, place)
}
// la page : tous les parents côte à côte
SOURCES['p-tous.mjs'] = PARENTS.map((p) => `<@p-${p}></@p-${p}>`).join('\n') + '\n'

const BALISES = ['mjs-p-tous']
// le rendu serveur se joue dans ses quatre modes de reprise : `markers`, `positional` et `diff` adoptent le HTML du serveur, `replace` le refait
const JEUX: [Mode, string][] = MODES.flatMap((m): [Mode, string][] => variantes(m).map((v): [Mode, string] => [m, v]))

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

// ce que la page montre, parent par parent : sa ligne d'état, la valeur de chaque enfant vivant (dans l'ordre du document, hors lignes en
// sortie) ; les réveils notés et ce que `@attach` a vu
const LIRE = `(() => {
  const tous = document.querySelector('mjs-p-tous')
  const sh = tous && tous._shadow
  const parents = {}
  const vivant = (c) => { for (let n = c; n; n = n.parentNode) if (n._mjs_dying) return false; return true }
  if (sh) for (const p of sh.querySelectorAll('*')) {
    if (!p.localName.startsWith('mjs-p-')) continue
    const s = p._shadow
    const etat = s && s.querySelector('.etat')
    parents[p.localName.slice(6)] = { etat: etat ? etat.textContent : '(absent)', vus: s ? Array.from(s.querySelectorAll('mjs-c-compte')).filter(vivant).map((c) => c._shadow && c._shadow.querySelector('.vu') ? c._shadow.querySelector('.vu').textContent : '(absent)') : [] }
  }
  return { parents, reveils: window.__aw || [], att: window.__att || [] }
})()`

type Lu = { parents: Record<string, { etat: string, vus: string[] }>, reveils: string[], att: boolean[] }

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

const DEPART: Record<string, number> = { p1: 1, p2: 2, p9: 9, i1: 10, i2: 20, i9: 90, i7: 70, i8: 80 }

// ce que chaque parent tient : l'ordre de ses lignes, geste après geste
type Modele = { plats: string[], groupes: [string, string[]][] }
const GESTES: { bouton: string, applique: (m: Modele) => void }[] = [
  { bouton: 'ajout', applique: (m) => { m.plats.push('p9'); m.groupes[0][1].push('i9') } },
  { bouton: 'ajoutg', applique: (m) => { m.groupes.push(['g2', ['i7', 'i8']]) } },
  { bouton: 'inverse', applique: (m) => { m.plats.reverse(); m.groupes[0][1].reverse() } },
  { bouton: 'retrait', applique: (m) => { m.plats.shift(); m.groupes[0][1].shift() } }
]

// chaque réveil porte le parent et la ligne de l'enfant (sa prop simple) et un nombre (sa liaison) ; le k-ième réveil d'une ligne voit sa
// valeur de départ plus k : chaque réveil d'avant a écrit 1 de plus, et cette écriture est revenue de la ligne. Rend, par parent, le nombre de
// réveils de chaque ligne
function verifierReveils(reveils: string[], contexte: string): Record<string, Record<string, number>> {
  const n: Record<string, Record<string, number>> = {}
  for (const r of reveils) {
    const m = /^([a-z]+-[a-z]+)\/([a-z0-9]+)=(-?\d+)$/.exec(r)
    assert.ok(m && PARENTS.includes(m[1]) && m[2] in DEPART, `${contexte} : l'enfant se réveille avec sa ligne et sa valeur (« ${r} »)`)
    const [, parent, id, v] = m!
    const k = (n[parent] ||= {})[id] || 0
    assert.equal(Number(v), DEPART[id] + k, `${contexte}, ${parent} : le réveil ${k + 1} de ${id} voit la valeur de sa ligne (${reveils.filter((x) => x.startsWith(parent + '/')).join(' ')})`)
    n[parent][id] = k + 1
  }
  return n
}

function verifier(lu: Lu, m: Modele, contexte: string) {
  const n = verifierReveils(lu.reveils, contexte)
  const v = (parent: string, id: string) => DEPART[id] + ((n[parent] || {})[id] || 0)
  for (const parent of PARENTS) {
    const vu = lu.parents[parent]
    assert.ok(vu, `${contexte} : le parent ${parent} est monté`)
    for (const id of [...m.plats, ...m.groupes.flatMap((g) => g[1])]) assert.ok(((n[parent] || {})[id] || 0) >= 1, `${contexte}, ${parent} : l'enfant de ${id} s'est réveillé`)
    const etat = m.plats.map((id) => id + ':' + v(parent, id)).join(' ') + ' | ' + m.groupes.map(([g, ids]) => g + '[' + ids.map((id) => id + ':' + v(parent, id)).join(' ') + ']').join(' ')
    assert.equal(vu.etat, etat, `${contexte}, ${parent} : chaque ligne a reçu ce que son enfant a écrit à chaque réveil`)
    assert.deepEqual(vu.vus, [...m.plats, ...m.groupes.flatMap((g) => g[1])].map((id) => String(v(parent, id))), `${contexte}, ${parent} : chaque enfant montre la valeur de sa ligne`)
  }
  assert.ok(lu.att.length > 0 && lu.att.every((x) => x === true), `${contexte} : chaque @attach reçoit une balise déjà dans le document (${JSON.stringify(lu.att)})`)
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`directive qui lit la balise dans le document : enfants de ligne réveillés avec leurs props (${nom} réel)`, function () {
  this.timeout(300000)
  let present = false
  let browser: any

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) { console.log(`  ℹ️  ${nom} non installé, test des props au réveil sous directive sauté. Activer : \`npx playwright install ${nom}\``); return }
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const [mode, variante] of JEUX) {
    it(`${mode}${variante ? ` (${variante})` : ''} : ${PARENTS.length} parents, liste plate et imbriquée ; lignes ajoutées, déplacées, retirées`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-tous', variante)
      try {
        await o.page.waitForFunction(`(window.__aw || []).length >= ${PARENTS.length * 4}`, null, { timeout: 8000 }).catch(() => {})
        const m: Modele = { plats: ['p1', 'p2'], groupes: [['g1', ['i1', 'i2']]] }
        let lu = await reposee(o)
        assert.deepEqual(graves(o), [], 'aucune erreur au chargement')
        verifier(lu, m, 'au chargement')
        for (const g of GESTES) {
          g.applique(m)
          await geste(o, g.bouton)
          lu = await reposee(o)
          assert.deepEqual(graves(o), [], `${g.bouton} : aucune erreur, aucun plantage de composant`)
          verifier(lu, m, g.bouton)
        }
      } finally {
        await o.fermer()
      }
    })
  }
})
