// Ce qu'un enfant écrit à son réveil (`µawake`) dans sa propriété liée à deux sens, dans les lignes d'un `{for}`, remonte vers sa propre ligne : à son
// arrivée dans le document (ligne neuve, au chargement ou ajoutée plus tard) comme à chaque fois que sa ligne change de place. Une ligne déplacée voit
// ses enfants déconnectés puis reconnectés avant d'avoir repris ses indices ; l'écriture attend que la ligne soit à sa nouvelle place, puis part vers
// la ligne d'ARRIVÉE : elle garde les valeurs qu'elle avait, plus ce que son enfant vient d'écrire. Dans une variable partagée de la page, chaque
// écriture compte de même. Quand le parent change la valeur de la ligne au même moment, il gagne : l'écriture de l'enfant, calculée sur l'ancienne
// valeur, ne l'écrase pas. Une ligne retirée pendant la mise à jour n'écrit plus rien chez son parent.
// Chaque cas se joue dans cinq modes de chargement (développement avec les parents définis avant ou après les enfants, production en un fichier ou
// en fichiers séparés, rendu serveur puis hydratation), dans Chromium et Firefox réels.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MODES, variantes, construire, charger, attendre, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode, Ouverture } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  // un enfant qui ajoute 1 à sa propriété à chaque réveil, et note de quelle ligne il se réveille
  'c-compte.mjs': `<script>\n  µawake -> window.__aw = (window.__aw or []).concat([$lib]); $n = ($n or 0) + 1\n</script>\n<p class="vu">{$n}</p><p class="lib">{$lib}</p>\n`,
  // un enfant qui ajoute le nom de sa ligne à sa liste à chaque réveil : une liste neuve à chaque fois, pas un nombre
  'c-liste.mjs': `<script>\n  vu = (v)-> JSON.stringify(v)\n  µawake -> window.__awl = (window.__awl or []).concat([$lib]); $x = ($x or []).concat([$lib])\n</script>\n<p class="vu">{vu($x)}</p><p class="lib">{$lib}</p>\n`,
  // un enfant qui écrit une mesure neuve à chaque réveil dans une variable que toutes les lignes partagent
  'c-mesure.mjs':`<script>\n  µawake -> $h = (window.__mes = (window.__mes or 0) + 1) * 100\n</script>\n<p class="vu">{$h}</p>\n`,
  // un enfant qui écrit en s'endormant, et note de quelle ligne il s'endort
  'c-adieu.mjs': `<script>\n  µsleep -> window.__dort = (window.__dort or []).concat([$lib]); $x = 'parti'\n</script>\n<p class="vu">{$x}</p><p class="lib">{$lib}</p>\n`,
  'p-compte.mjs': `<script>
  $menu = [{ id: 'a', n: 0 }, { id: 'b', n: 10 }, { id: 'c', n: 20 }, { id: 'd', n: 30 }, { id: 'e', n: 40 }, { id: 'f', n: 50 }]
  inv    = -> $menu = [$menu[1], $menu[0]].concat($menu.slice(2))
  dep    = -> $menu = [$menu[$menu.length - 1]].concat($menu.slice(0, -1))
  ajout  = -> $menu = [{ id: 'z' + $menu.length, n: 100 }].concat($menu)
  shuf   = -> $menu = $menu.map((d, i)-> $menu[(i * 5 + 1) % $menu.length])
  depmaj = -> $menu = [{ id: $menu[$menu.length - 1].id, n: 99 }].concat($menu.slice(0, -1))
  etat   = (l)-> l.map((d)-> d.id + ':' + d.n).join(' ')
</script>
{for d in $menu by id}<section class="groupe" data-id={d.id}><@c-compte n=!{d.n} lib={d.id}></@c-compte></section>{end}
<button class="inv" @click={inv()}>inv</button><button class="dep" @click={dep()}>dep</button><button class="ajout" @click={ajout()}>ajout</button><button class="shuf" @click={shuf()}>shuf</button><button class="depmaj" @click={depmaj()}>depmaj</button>
<p class="etat">{etat($menu)}</p>
`,
  'p-imbrique.mjs': `<script>
  $groupes = [{ id: 'g1', items: [{ id: 'i1', n: 1 }, { id: 'i2', n: 2 }] }, { id: 'g2', items: [{ id: 'i3', n: 3 }] }, { id: 'g3', items: [{ id: 'i4', n: 4 }, { id: 'i5', n: 5 }, { id: 'i6', n: 6 }] }]
  rev  = -> $groupes = $groupes.slice().reverse()
  invi = -> $groupes[0].items = [$groupes[0].items[1], $groupes[0].items[0]].concat($groupes[0].items.slice(2))
  etat = (l)-> l.map((g)-> g.id + '[' + g.items.map((i)-> i.id + ':' + i.n).join(' ') + ']').join(' ')
</script>
{for g in $groupes by id}<section class="groupe" data-id={g.id}>{for i in g.items by id}<div class="item" data-id={i.id}><@c-compte n=!{i.n} lib={i.id}></@c-compte></div>{end}</section>{end}
<button class="rev" @click={rev()}>rev</button><button class="invi" @click={invi()}>invi</button>
<p class="etat">{etat($groupes)}</p>
`,
  'p-liste.mjs': `<script>
  $menu = [{ id: 'a', l: ['a'] }, { id: 'b', l: [] }, { id: 'c', l: ['c', 'c'] }, { id: 'd', l: [] }]
  inv  = -> $menu = [$menu[1], $menu[0]].concat($menu.slice(2))
  rev  = -> $menu = $menu.slice().reverse()
  etat = (l)-> l.map((d)-> d.id + JSON.stringify(d.l)).join(' ')
</script>
{for d in $menu by id}<section class="groupe" data-id={d.id}><@c-liste x=!{d.l} lib={d.id}></@c-liste></section>{end}
<button class="inv" @click={inv()}>inv</button><button class="rev" @click={rev()}>rev</button>
<p class="etat">{etat($menu)}</p>
`,
  'p-partage.mjs': `<script>
  $rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  $h = 0
  inv = -> $rows = [$rows[1], $rows[0], $rows[2]]
  dep = -> $rows = [$rows[2], $rows[0], $rows[1]]
</script>
{for r in $rows by id}<section class="groupe" data-id={r.id}><@c-mesure h=!{$h}></@c-mesure></section>{end}
<button class="inv" @click={inv()}>inv</button><button class="dep" @click={dep()}>dep</button>
<p class="partage">{$h}</p>
`,
  'p-retrait.mjs': `<script>
  $menu = [{ id: 'a', x: 'a0' }, { id: 'b', x: 'b0' }, { id: 'c', x: 'c0' }]
  ret  = -> $menu = $menu.slice(1)
  etat = (l)-> l.map((d)-> d.id + ':' + d.x).join(' ')
</script>
{for d in $menu by id}<section class="groupe" data-id={d.id}><@c-adieu x=!{d.x} lib={d.id}></@c-adieu></section>{end}
<button class="ret" @click={ret()}>ret</button>
<p class="etat">{etat($menu)}</p>
`
}

const BALISES = ['mjs-p-compte', 'mjs-p-liste', 'mjs-p-imbrique', 'mjs-p-partage', 'mjs-p-retrait']

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

// combien de fois chaque ligne s'est réveillée
const compter = (reveils: string[]) => {
  const n: Record<string, number> = {}
  for (const id of reveils) n[id] = (n[id] || 0) + 1
  return n
}

// ce que la page montre : l'état du parent tel qu'il l'imprime, la valeur de l'enfant de chaque ligne, les réveils notés
const LIRE_COMPTE = (balise: string) => `(() => {
  const sh = document.querySelector('${balise}')._shadow
  const vu = (e) => { const c = e.querySelector('mjs-c-compte'); const p = c && c._shadow && c._shadow.querySelector('.vu'); return p ? p.textContent : '(absent)' }
  return {
    etat: sh.querySelector('p.etat').textContent,
    rows: Array.from(sh.querySelectorAll('section.groupe')).map((s) => s.dataset.id + ':' + vu(s)).join(' '),
    reveils: window.__aw || []
  }
})()`

type Modele = { ordre: string[], base: Record<string, number> }

const GESTES: Array<{ bouton: string, deplace: boolean, applique: (m: Modele) => Modele }> = [
  { bouton: 'inv', deplace: true, applique: (m) => ({ ...m, ordre: [m.ordre[1], m.ordre[0], ...m.ordre.slice(2)] }) },
  { bouton: 'dep', deplace: true, applique: (m) => ({ ...m, ordre: [m.ordre[m.ordre.length - 1], ...m.ordre.slice(0, -1)] }) },
  { bouton: 'ajout', deplace: false, applique: (m) => ({ ...m, ordre: ['z' + m.ordre.length, ...m.ordre], base: { ...m.base, ['z' + m.ordre.length]: 100 } }) },
  { bouton: 'shuf', deplace: true, applique: (m) => ({ ...m, ordre: m.ordre.map((_, i) => m.ordre[(i * 5 + 1) % m.ordre.length]) }) },
  { bouton: 'dep', deplace: true, applique: (m) => ({ ...m, ordre: [m.ordre[m.ordre.length - 1], ...m.ordre.slice(0, -1)] }) }
]

for (const nom of ['chromium', 'firefox'] as const) describe(`écriture de l'enfant à son réveil dans les lignes d'un {for} (${nom} réel)`, function () {
  this.timeout(300000)
  let present = false
  let browser: any

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) { console.log(`  ℹ️  ${nom} non installé, test de l'écriture au réveil sauté. Activer : \`npx playwright install ${nom}\``); return }
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES) for (const variante of variantes(mode)) {
    it(`compteur au réveil, ${titre(mode, variante)} : lignes neuves, déplacées, ajoutées et mélangées gardent chacune ce que leur enfant a écrit`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-compte', variante)
      try {
        await attendre(o.page, 'mjs-p-compte', 6)
        let m: Modele = { ordre: ['a', 'b', 'c', 'd', 'e', 'f'], base: { a: 0, b: 10, c: 20, d: 30, e: 40, f: 50 } }
        let lu = await reposee(() => o.page.evaluate(LIRE_COMPTE('mjs-p-compte')) as Promise<any>)
        // chaque ligne vaut sa valeur de départ plus un par réveil
        const attendu = () => {
          const n = compter(lu.reveils)
          return m.ordre.map((id) => id + ':' + (m.base[id] + (n[id] || 0))).join(' ')
        }
        assert.deepEqual(graves(o), [], 'aucune erreur au chargement')
        assert.equal(lu.etat, attendu(), 'au chargement, le parent a reçu ce que chaque enfant a écrit à son premier réveil')
        assert.equal(lu.rows, lu.etat, 'au chargement, chaque enfant montre la valeur de sa ligne')
        for (const [i, geste] of GESTES.entries()) {
          const reveilsAvant = lu.reveils.length
          m = geste.applique(m)
          await clic(o, 'mjs-p-compte', geste.bouton)
          lu = await reposee(() => o.page.evaluate(LIRE_COMPTE('mjs-p-compte')) as Promise<any>)
          const contexte = `geste ${i + 1} (${geste.bouton})`
          assert.deepEqual(graves(o), [], `${contexte} : aucune erreur, aucun plantage de composant`)
          assert.ok(lu.reveils.length > reveilsAvant, `${contexte} : au moins un enfant s'est réveillé (${reveilsAvant} réveils avant, ${lu.reveils.length} après)`)
          if (!geste.deplace) assert.equal(lu.reveils.length, reveilsAvant + 1, `${contexte} : seule la ligne neuve se réveille`)
          assert.equal(lu.etat, attendu(), `${contexte} : le parent garde, pour chaque ligne, sa valeur et ce que son enfant a écrit en se réveillant`)
          assert.equal(lu.rows, lu.etat, `${contexte} : chaque enfant montre la valeur de sa ligne`)
        }
      } finally {
        await o.fermer()
      }
    })

    it(`le parent qui change la valeur d'une ligne en la déplaçant gagne, ${titre(mode, variante)} : l'écriture de l'enfant calculée sur l'ancienne valeur ne l'écrase pas`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-compte', variante)
      try {
        await attendre(o.page, 'mjs-p-compte', 6)
        const avant = await reposee(() => o.page.evaluate(LIRE_COMPTE('mjs-p-compte')) as Promise<any>)
        assert.equal(avant.etat, 'a:1 b:11 c:21 d:31 e:41 f:51', 'au chargement, chaque ligne a gagné 1 au premier réveil')
        await clic(o, 'mjs-p-compte', 'depmaj')
        const apres = await reposee(() => o.page.evaluate(LIRE_COMPTE('mjs-p-compte')) as Promise<any>)
        assert.deepEqual(graves(o), [], 'aucune erreur, aucun plantage de composant')
        assert.ok(apres.reveils.length > avant.reveils.length, 'la ligne déplacée s\'est réveillée')
        assert.equal(apres.etat, 'f:99 a:1 b:11 c:21 d:31 e:41', 'la valeur que le parent a posée sur la ligne déplacée est celle qu\'elle garde, les autres lignes ne bougent pas')
        assert.equal(apres.rows, apres.etat, 'chaque enfant montre la valeur de sa ligne')
      } finally {
        await o.fermer()
      }
    })

    it(`liste au réveil, ${titre(mode, variante)} : la liste neuve qu'un enfant écrit en se réveillant remonte vers sa ligne, déplacée ou non`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-liste', variante)
      const lire = () => o.page.evaluate(`(() => {
        const sh = document.querySelector('mjs-p-liste')._shadow
        const vu = (e) => { const c = e.querySelector('mjs-c-liste'); const p = c && c._shadow && c._shadow.querySelector('.vu'); return p ? p.textContent : '(absent)' }
        return { etat: sh.querySelector('p.etat').textContent, rows: Array.from(sh.querySelectorAll('section.groupe')).map((s) => s.dataset.id + vu(s)).join(' '), reveils: window.__awl || [] }
      })()`) as Promise<any>
      try {
        await attendre(o.page, 'mjs-p-liste', 4)
        const depart: Record<string, string[]> = { a: ['a'], b: [], c: ['c', 'c'], d: [] }
        let ordre = ['a', 'b', 'c', 'd']
        const attendu = (reveils: string[]) => {
          const n = compter(reveils)
          return ordre.map((id) => id + JSON.stringify([...depart[id], ...Array(n[id] || 0).fill(id)])).join(' ')
        }
        let lu = await reposee(lire)
        assert.deepEqual(graves(o), [], 'aucune erreur au chargement')
        assert.equal(lu.etat, attendu(lu.reveils), 'au chargement, le parent a reçu la liste que chaque enfant a écrite à son premier réveil')
        assert.equal(lu.rows, lu.etat, 'au chargement, chaque enfant montre la liste de sa ligne')
        const gestes: Array<{ bouton: string, applique: () => void }> = [
          { bouton: 'inv', applique: () => { ordre = [ordre[1], ordre[0], ...ordre.slice(2)] } },
          { bouton: 'rev', applique: () => { ordre = [...ordre].reverse() } },
          { bouton: 'inv', applique: () => { ordre = [ordre[1], ordre[0], ...ordre.slice(2)] } }
        ]
        for (const [i, geste] of gestes.entries()) {
          const reveilsAvant = lu.reveils.length
          geste.applique()
          await clic(o, 'mjs-p-liste', geste.bouton)
          lu = await reposee(lire)
          const contexte = `geste ${i + 1} (${geste.bouton})`
          assert.deepEqual(graves(o), [], `${contexte} : aucune erreur, aucun plantage de composant`)
          assert.ok(lu.reveils.length > reveilsAvant, `${contexte} : au moins un enfant s'est réveillé`)
          assert.equal(lu.etat, attendu(lu.reveils), `${contexte} : le parent garde, pour chaque ligne, sa liste et ce que son enfant y a ajouté en se réveillant`)
          assert.equal(lu.rows, lu.etat, `${contexte} : chaque enfant montre la liste de sa ligne`)
        }
      } finally {
        await o.fermer()
      }
    })

    it(`lignes dans des lignes, ${titre(mode, variante)} : l'écriture de chaque enfant au réveil remonte vers sa ligne, groupes inversés ou lignes d'un groupe échangées`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-imbrique', variante)
      try {
        await attendre(o.page, 'mjs-p-imbrique', 6)
        const depart: Record<string, number> = { i1: 1, i2: 2, i3: 3, i4: 4, i5: 5, i6: 6 }
        const groupes: Record<string, string[]> = { g1: ['i1', 'i2'], g2: ['i3'], g3: ['i4', 'i5', 'i6'] }
        let ordre = ['g1', 'g2', 'g3']
        const lire = () => o.page.evaluate(`(() => {
          const sh = document.querySelector('mjs-p-imbrique')._shadow
          const vu = (e) => { const c = e.querySelector('mjs-c-compte'); const p = c && c._shadow && c._shadow.querySelector('.vu'); return p ? p.textContent : '(absent)' }
          const rows = Array.from(sh.querySelectorAll('section.groupe')).map((g) => g.dataset.id + '[' + Array.from(g.querySelectorAll('.item')).map((i) => i.dataset.id + ':' + vu(i)).join(' ') + ']').join(' ')
          return { etat: sh.querySelector('p.etat').textContent, rows, reveils: window.__aw || [] }
        })()`) as Promise<any>
        const attendu = (reveils: string[]) => {
          const n = compter(reveils)
          return ordre.map((g) => g + '[' + groupes[g].map((id) => id + ':' + (depart[id] + (n[id] || 0))).join(' ') + ']').join(' ')
        }
        let lu = await reposee(lire)
        assert.deepEqual(graves(o), [], 'aucune erreur au chargement')
        assert.equal(lu.etat, attendu(lu.reveils), 'au chargement, le parent a reçu ce que chaque enfant a écrit à son premier réveil')
        assert.equal(lu.rows, lu.etat, 'au chargement, chaque enfant montre la valeur de sa ligne')
        // `invi` échange les deux premières lignes du premier groupe affiché
        const invi = () => { const g = groupes[ordre[0]]; groupes[ordre[0]] = [g[1], g[0], ...g.slice(2)] }
        const rev  = () => { ordre = [...ordre].reverse() }
        const gestes: Array<{ bouton: string, applique: () => void }> = [
          { bouton: 'invi', applique: invi },
          { bouton: 'rev', applique: rev },
          { bouton: 'invi', applique: invi },
          { bouton: 'rev', applique: rev }
        ]
        for (const [i, geste] of gestes.entries()) {
          const reveilsAvant = lu.reveils.length
          geste.applique()
          await clic(o, 'mjs-p-imbrique', geste.bouton)
          lu = await reposee(lire)
          const contexte = `geste ${i + 1} (${geste.bouton})`
          assert.deepEqual(graves(o), [], `${contexte} : aucune erreur, aucun plantage de composant`)
          assert.ok(lu.reveils.length > reveilsAvant, `${contexte} : au moins un enfant s'est réveillé`)
          assert.equal(lu.etat, attendu(lu.reveils), `${contexte} : le parent garde, pour chaque ligne, sa valeur et ce que son enfant a écrit en se réveillant`)
          assert.equal(lu.rows, lu.etat, `${contexte} : chaque enfant montre la valeur de sa ligne`)
        }
      } finally {
        await o.fermer()
      }
    })

    it(`variable partagée par toutes les lignes, ${titre(mode, variante)} : chaque mesure qu'un enfant écrit à son réveil devient la valeur du parent`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-partage', variante)
      const lire = () => o.page.evaluate(`(() => {
        const sh = document.querySelector('mjs-p-partage')._shadow
        const vu = (e) => { const c = e.querySelector('mjs-c-mesure'); const p = c && c._shadow && c._shadow.querySelector('.vu'); return p ? p.textContent : '(absent)' }
        return { partage: sh.querySelector('p.partage').textContent, mesures: window.__mes || 0, rows: Array.from(sh.querySelectorAll('section.groupe')).map(vu) }
      })()`) as Promise<any>
      try {
        await attendre(o.page, 'mjs-p-partage', 3)
        let lu = await reposee(lire)
        assert.deepEqual(graves(o), [], 'aucune erreur au chargement')
        assert.equal(lu.mesures, 3, 'au chargement, les trois enfants ont mesuré')
        assert.equal(lu.partage, '300', 'au chargement, le parent garde la dernière mesure')
        assert.deepEqual(lu.rows, ['300', '300', '300'], 'au chargement, chaque enfant montre la valeur du parent')
        for (const [i, bouton] of ['inv', 'dep', 'inv'].entries()) {
          const mesuresAvant = lu.mesures
          await clic(o, 'mjs-p-partage', bouton)
          lu = await reposee(lire)
          const contexte = `geste ${i + 1} (${bouton})`
          assert.deepEqual(graves(o), [], `${contexte} : aucune erreur, aucun plantage de composant`)
          assert.ok(lu.mesures > mesuresAvant, `${contexte} : au moins un enfant s'est réveillé et a mesuré`)
          assert.equal(lu.partage, String(lu.mesures * 100), `${contexte} : le parent garde la dernière mesure`)
          assert.deepEqual(lu.rows, [0, 1, 2].map(() => String(lu.mesures * 100)), `${contexte} : chaque enfant montre la valeur du parent`)
        }
      } finally {
        await o.fermer()
      }
    })

    it(`ligne retirée, ${titre(mode, variante)} : l'enfant qui s'endort en écrivant n'écrit rien chez son parent, les autres lignes ne changent pas`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-retrait', variante)
      const lire = () => o.page.evaluate(`(() => {
        const sh = document.querySelector('mjs-p-retrait')._shadow
        const vu = (e) => { const c = e.querySelector('mjs-c-adieu'); const p = c && c._shadow && c._shadow.querySelector('.vu'); return p ? p.textContent : '(absent)' }
        return { etat: sh.querySelector('p.etat').textContent, rows: Array.from(sh.querySelectorAll('section.groupe')).map((s) => s.dataset.id + ':' + vu(s)).join(' '), dort: window.__dort || [], remontes: window.__binds }
      })()`) as Promise<any>
      try {
        await attendre(o.page, 'mjs-p-retrait', 3)
        let lu = await reposee(lire)
        assert.equal(lu.etat, 'a:a0 b:b0 c:c0', 'au chargement, chaque ligne garde sa valeur')
        const [dortAvant, remontesAvant] = [lu.dort.length, lu.remontes.length]
        await clic(o, 'mjs-p-retrait', 'ret')
        lu = await reposee(lire)
        const remontes = lu.remontes.slice(remontesAvant) as string[]
        assert.deepEqual(graves(o), [], 'aucune erreur, aucun plantage de composant')
        assert.deepEqual(lu.dort.slice(dortAvant), ['a'], 'la ligne retirée a été endormie, elle seule')
        assert.equal(lu.etat, 'b:b0 c:c0', 'les lignes qui restent gardent leur valeur')
        assert.equal(lu.rows, 'b:b0 c:c0', 'chaque enfant qui reste montre la valeur de sa ligne')
        assert.ok(!remontes.some((r) => r.includes('"parti"')), `l'enfant de la ligne retirée n'a rien écrit chez son parent (remontés : ${remontes.join(' ; ')})`)
      } finally {
        await o.fermer()
      }
    })
  }
})
