// L'enfant d'une ligne de `{for}` à clé, sans directive, écrit sa liaison à deux sens à son réveil (`µawake`, rejoué à chaque connexion de sa
// balise) : à l'arrivée d'une ligne ajoutée (en fin ou en tête de liste) et au déplacement d'une ligne, ce qu'il écrit remonte vers sa ligne, et
// la ligne affiche aussitôt ce que sa donnée vaut — le texte de la ligne qui lit cette valeur la montre dès la fin de la mise à jour, comme
// l'enfant. Liste plate et liste dans la ligne d'une autre (ligne intérieure ajoutée ou déplacée, ligne extérieure déplacée avec ses lignes).
// Rendu client en développement et en production (un seul fichier). Chromium, Firefox et WebKit réels.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode, Ouverture } from './helpers/liaison-navigateur.js'

// la ligne : le texte de sa donnée, puis l'enfant lié à cette donnée
const ligne = (x: string) => `<div class="r" data-id={${x}.id}><b class="n">{${x}.v}</b><@c-ecrit k={${x}.id} v=!{${x}.v}></@c-ecrit></div>`
const BOUTONS = '<button class="ajout" @click={ajout()}>a</button><button class="tete" @click={tete()}>t</button><button class="inv" @click={inv()}>i</button>'

const SOURCES: Record<string, string> = {
  // un enfant qui note chacun de ses réveils (sa ligne et la valeur qu'il tient alors), puis ajoute un à sa liaison
  'c-ecrit.mjs': `<script>\n  µawake -> window.__aw = (window.__aw or []).concat([$k + '=' + JSON.stringify($v)]); $v += 1\n</script>\n<i class="vu">{$v}</i>\n`,
  'p-plate.mjs': `<script>
  $rows = [{ id: 'p1', v: 10 }, { id: 'p2', v: 20 }]
  ajout = -> $rows = $rows.concat([{ id: 'p3', v: 30 }])
  tete  = -> $rows = [{ id: 'p4', v: 40 }].concat($rows)
  inv   = -> $rows = $rows.slice().reverse()
</script>
{for r in $rows by id}${ligne('r')}{end}
${BOUTONS}
`,
  'p-imbrique.mjs': `<script>
  $groupes = [{ id: 'g1', items: [{ id: 'i1', v: 10 }, { id: 'i2', v: 20 }] }, { id: 'g2', items: [{ id: 'i5', v: 50 }] }]
  premier  = (f) -> $groupes = $groupes.map((g) -> if g.id is 'g1' then Object.assign({}, g, { items: f(g.items) }) else g)
  ajout    = -> premier((l) -> l.concat([{ id: 'i3', v: 30 }]))
  tete     = -> premier((l) -> [{ id: 'i4', v: 40 }].concat(l))
  inv      = -> premier((l) -> l.slice().reverse())
  invg     = -> $groupes = $groupes.slice().reverse()
</script>
{for g in $groupes by id}<section class="g">{for i in g.items by id}${ligne('i')}{end}</section>{end}
${BOUTONS}<button class="invg" @click={invg()}>g</button>
`,
  'p-tous.mjs': '<@p-plate></@p-plate>\n<@p-imbrique></@p-imbrique>\n'
}
const PARENTS = ['plate', 'imbrique'] as const
type Parent = typeof PARENTS[number]

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, ['mjs-p-tous']))
  return cibles.get(mode)!
}

// ce que la page montre, parent par parent, ligne par ligne (`id:valeur`) : la donnée du parent, le texte de chaque ligne, ce que montre son
// enfant ; et les réveils notés
const LIRE = `(() => {
  const sh = document.querySelector('mjs-p-tous')?._shadow
  const parents = {}
  for (const nom of ['plate', 'imbrique']) {
    const p = sh && sh.querySelector('mjs-p-' + nom)
    const s = p && p._shadow
    const st = p && p._state
    const l = s ? Array.from(s.querySelectorAll('.r')) : []
    const vu = (r) => { const c = r.querySelector('mjs-c-ecrit'); const v = c && c._shadow && c._shadow.querySelector('.vu'); return v ? v.textContent : '(absent)' }
    const donnees = !st ? [] : nom === 'plate' ? st.rows.map((r) => r.id + ':' + r.v) : st.groupes.flatMap((g) => g.items.map((i) => i.id + ':' + i.v))
    parents[nom] = { donnees, lignes: l.map((r) => r.dataset.id + ':' + r.querySelector('.n').textContent), vus: l.map((r) => r.dataset.id + ':' + vu(r)) }
  }
  return { parents, reveils: window.__aw || [] }
})()`

type Lu = { parents: Record<Parent, { donnees: string[], lignes: string[], vus: string[] }>, reveils: string[] }

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

// le même geste dans chaque parent qui porte le bouton
const geste = (o: Ouverture, bouton: string) => o.page.evaluate(`(() => {
  for (const nom of ['plate', 'imbrique']) {
    const b = document.querySelector('mjs-p-tous')._shadow.querySelector('mjs-p-' + nom)._shadow.querySelector('.${bouton}')
    if (b) b.click()
  }
})()`)

const DEPART: Record<string, number> = { p1: 10, p2: 20, p3: 30, p4: 40, i1: 10, i2: 20, i3: 30, i4: 40, i5: 50 }
type Ordre = Record<Parent, string[]>
// l'ordre des lignes après chaque geste ; `neuve` : la ligne ajoutée, dont l'enfant se réveille à son arrivée ; un déplacement réveille au
// moins un enfant dans chaque parent qui le joue
const GESTES: { bouton: string, ordre: Ordre, neuve?: Record<Parent, string>, deplace: Parent[] }[] = [
  { bouton: 'ajout', ordre: { plate: ['p1', 'p2', 'p3'], imbrique: ['i1', 'i2', 'i3', 'i5'] }, neuve: { plate: 'p3', imbrique: 'i3' }, deplace: [] },
  { bouton: 'tete', ordre: { plate: ['p4', 'p1', 'p2', 'p3'], imbrique: ['i4', 'i1', 'i2', 'i3', 'i5'] }, neuve: { plate: 'p4', imbrique: 'i4' }, deplace: [] },
  { bouton: 'inv', ordre: { plate: ['p3', 'p2', 'p1', 'p4'], imbrique: ['i3', 'i2', 'i1', 'i4', 'i5'] }, deplace: ['plate', 'imbrique'] },
  { bouton: 'invg', ordre: { plate: ['p3', 'p2', 'p1', 'p4'], imbrique: ['i5', 'i3', 'i2', 'i1', 'i4'] }, deplace: ['imbrique'] }
]

// chaque réveil d'un enfant voit la valeur que sa ligne tient alors : celle de départ, puis celle que son réveil précédent a écrite
function reveilsParLigne(reveils: string[], contexte: string): Record<string, number> {
  const n: Record<string, number> = {}
  for (const r of reveils) {
    const [id, v] = r.split('=')
    n[id] = (n[id] || 0)
    assert.equal(v, String(DEPART[id] + n[id]), `${contexte} : le réveil ${n[id] + 1} de l'enfant de ${id} voit la valeur de sa ligne`)
    n[id]++
  }
  return n
}

function verifier(lu: Lu, ordre: Ordre, contexte: string): Record<string, number> {
  const n = reveilsParLigne(lu.reveils, contexte)
  for (const parent of PARENTS) {
    const attendu = ordre[parent].map((id) => id + ':' + (DEPART[id] + (n[id] || 0)))
    const vu = lu.parents[parent]
    assert.deepEqual(vu.donnees, attendu, `${contexte}, ${parent} : chaque ligne a reçu ce que son enfant a écrit à chaque réveil`)
    assert.deepEqual(vu.lignes, attendu, `${contexte}, ${parent} : chaque ligne affiche ce que sa donnée vaut, écriture de son enfant comprise`)
    assert.deepEqual(vu.vus, attendu, `${contexte}, ${parent} : chaque enfant montre la valeur de sa ligne`)
  }
  return n
}

const compte = (n: Record<string, number>, prefixe: string) => Object.keys(n).filter((id) => id.startsWith(prefixe)).reduce((s, id) => s + n[id], 0)
const MODES_JOUES: Mode[] = ['dev-parents-avant', 'bundle']

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`ligne ajoutée ou déplacée : l'écriture de son enfant au réveil s'affiche (${nom} réel)`, function () {
  this.timeout(300000)
  let present = false
  let browser: any

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) { console.log(`  ℹ️  ${nom} non installé, test des lignes ajoutées ou déplacées sauté. Activer : \`npx playwright install ${nom}\``); return }
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES_JOUES) {
    it(`${mode} : liste plate et liste dans une liste ; lignes ajoutées en fin et en tête, lignes déplacées`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-tous')
      try {
        await o.page.waitForFunction('(window.__aw || []).length >= 5', null, { timeout: 8000 }).catch(() => {})
        let lu = await reposee(o)
        assert.deepEqual(graves(o), [], 'aucune erreur au chargement')
        let n = verifier(lu, { plate: ['p1', 'p2'], imbrique: ['i1', 'i2', 'i5'] }, 'au chargement')
        for (const [i, g] of GESTES.entries()) {
          const avant = n
          await geste(o, g.bouton)
          lu = await reposee(o)
          const contexte = `${g.bouton} (geste ${i + 1})`
          assert.deepEqual(graves(o), [], `${contexte} : aucune erreur, aucun plantage de composant`)
          n = verifier(lu, g.ordre, contexte)
          if (g.neuve) for (const parent of PARENTS) assert.ok((n[g.neuve[parent]] || 0) >= 1, `${contexte}, ${parent} : l'enfant de la ligne ajoutée s'est réveillé`)
          for (const parent of g.deplace) {
            const prefixe = parent === 'plate' ? 'p' : 'i'
            assert.ok(compte(n, prefixe) > compte(avant, prefixe), `${contexte}, ${parent} : le déplacement a réveillé au moins un enfant`)
          }
        }
      } finally {
        await o.fermer()
      }
    })
  }
})
