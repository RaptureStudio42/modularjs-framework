// {for} : une ligne se crée en peu d'appels. Son gabarit se bâtit dans le rappel de ligne, sans fonction ni objet entre eux ; ses nœuds se
// lisent de frère en frère, chacun depuis le plus proche déjà lu, aucun chemin n'est descendu deux fois ; et le gabarit de la liste en
// cours est gardé d'une ligne à la suivante, sans être cherché dans la table à chaque ligne. Le code compilé est lu, puis les appels sont
// comptés dans Chromium pendant la création et l'ajout de 300 lignes : ils suivent une borne par ligne. Deux listes aux gabarits
// différents, créées l'une dans l'autre, gardent chacune ses lignes

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger } from './helpers/liaison-navigateur.js'

const BALISE  = 'mjs-lignes-comptees'
const GROUPES = 'mjs-lignes-groupees'
const N      = 300

const SOURCES: Record<string, string> = {
  'lignes-comptees.mjs': `<script lang="js">
  $data = µ.raw([]);
  $selected = -1;
  @poser = function(a) { $data = a; };
  @select = function(id) { $selected = id; };
  @remove = function(id) { $data = µ.raw($data.filter((d) => d.id !== id)); };
</script>
<table><tbody>
  {for row in $data by id}
    <tr :class{$selected === row.id}="danger">
      <td class="col-md-1">{row.id}</td>
      <td class="col-md-4"><a @click={@select(row.id)}>{row.label}</a></td>
      <td class="col-md-1"><a @click={@remove(row.id)}><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
      <td class="col-md-6"></td>
    </tr>
  {end}
</tbody></table>
`,
  // deux gabarits à racine unique clonés tour à tour : la ligne d'un groupe, puis ses cases, puis le groupe suivant
  'lignes-groupees.mjs': `<script lang="js">
  $groupes = [];
  $data = µ.raw([]);
  @grouper = function(g) { $groupes = g; };
  @poser = function(a) { $data = a; };
</script>
<ul class="groupes">
  {for g in $groupes by id}
    <li class="groupe"><b>{g.nom}</b><i>{for c in g.cases}<span class="case">{c}</span>{end}</i></li>
  {end}
</ul>
<ol>{for row in $data by id}<li class="ligne"><u>{row.id}</u><s>{row.label}</s></li>{end}</ol>
`
}

// compteurs posés dans la page : lectures de nœud voisin, recherches d'un gabarit dans sa table (une table lue par un HTML), copies de nœud
const COMPTEURS = `(() => {
  const c = window.__n = { nav: 0, get: 0, copies: 0, on: false }
  for (const p of ['firstChild', 'nextSibling', 'childNodes']) {
    const d = Object.getOwnPropertyDescriptor(Node.prototype, p)
    const g = d.get
    d.get = function() { if (c.on) c.nav++; return g.call(this) }
    Object.defineProperty(Node.prototype, p, d)
  }
  const get = Map.prototype.get
  Map.prototype.get = function(k) { if (c.on && typeof k === 'string' && k[0] === '<') c.get++; return get.call(this, k) }
  const copie = Node.prototype.cloneNode
  Node.prototype.cloneNode = function(profond) { if (c.on) c.copies++; return copie.call(this, profond) }
})()`

// une écriture de la page, comptée jusqu'au rendu fait ; rend les comptes et ce que l'écran montre
const compter = (geste: string) => `(async () => {
  const el = document.querySelector('${BALISE}')
  const c  = window.__n
  c.nav = c.get = c.copies = 0
  c.on  = true
  ${geste}
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60)))
  c.on = false
  const trs = [...el._shadow.querySelectorAll('tbody > tr')]
  return { nav: c.nav, get: c.get, copies: c.copies, lignes: trs.length, premiere: trs[0] ? trs[0].textContent.replace(/\\s+/g, ' ').trim() : '', derniere: trs.length ? trs[trs.length - 1].textContent.replace(/\\s+/g, ' ').trim() : '' }
})()`
const LIGNES = (de: number, a: number) => `Array.from({ length: ${a - de + 1} }, (_, i) => µ.raw({ id: ${de} + i, label: 'L' + (${de} + i) }))`

const cible = construire('dev-parents-avant', SOURCES, [BALISE, GROUPES])

describe('{for} — création d\'une ligne en peu d\'appels', function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('code compilé : le gabarit est bâti dans le rappel de ligne, et ses cinq nœuds se lisent en sept pas', async () => {
    const out = join((await cible).racine, 'out')
    const js  = readdirSync(out).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(out, f), 'utf-8')).find((s) => s.includes('µ._mjs_cloneEl("<tr'))
    assert.ok(js, 'gabarit de la ligne introuvable dans le code compilé')
    const debut = js.indexOf('µ._mjs_cloneEl("<tr')
    const rappel = js.slice(js.lastIndexOf('(row, index, __a) =>', debut), debut)
    assert.match(rappel, /^\(row, index, __a\) => \{\s*let _mjs_fr, __nodes = __a;\s*if \(!__a\) \{\s*_mjs_fr = $/, 'aucune fonction ni objet entre le rappel de ligne et son gabarit : ' + rappel)
    const fin = js.indexOf('__nodes = _mjs_refs;', debut)
    assert.ok(fin !== -1, 'les réfs du gabarit sont posées dans le rappel de ligne')
    const pas = js.slice(debut, fin).match(/\.(?:firstChild|nextSibling|childNodes)\b/g) ?? []
    assert.ok(pas.length <= 7, `lectures de nœud voisin dans le gabarit : ${pas.length} (7 au plus pour la ligne, son texte, ses deux liens et le texte du premier)\n${js.slice(debut, fin)}`)
  })

  it('créer puis ajouter 300 lignes : sept lectures de nœud voisin par ligne au plus, une copie par ligne, et le gabarit n\'est pas cherché à chaque ligne', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible, BALISE)
    try {
      await o.page.waitForFunction(`!!document.querySelector('${BALISE}')?._shadow?.querySelector('tbody')`, null, { timeout: 10000 })
      await o.page.evaluate(COMPTEURS)
      const creer   = await o.page.evaluate(compter(`el.poser(µ.raw(${LIGNES(1, N)}))`))
      const ajouter = await o.page.evaluate(compter(`el.poser(µ.raw([...el._state.data, ...${LIGNES(N + 1, 2 * N)}]))`))
      assert.deepEqual([creer.lignes, creer.premiere, creer.derniere], [N, '1L1', N + 'L' + N], 'les 300 lignes créées')
      assert.deepEqual([ajouter.lignes, ajouter.premiere, ajouter.derniere], [2 * N, '1L1', 2 * N + 'L' + 2 * N], 'les 300 lignes ajoutées')
      for (const [nom, c] of [['créer', creer], ['ajouter', ajouter]] as const) {
        assert.ok(c.nav <= 7 * N + 40, `${nom} : ${c.nav} lectures de nœud voisin pour ${N} lignes (7 par ligne au plus)`)
        assert.ok(c.copies <= N + 5, `${nom} : ${c.copies} copies de nœud pour ${N} lignes (une par ligne)`)
        assert.ok(c.get <= 2, `${nom} : ${c.get} recherches du gabarit dans sa table pour ${N} lignes (le gabarit de la liste en cours est gardé, aucune par ligne)`)
      }
      assert.deepEqual(o.erreurs, [])
    }
    finally {
      await o.fermer()
    }
  })

  it('deux listes aux gabarits différents, l\'une dans l\'autre : chaque ligne reçoit le sien', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible, GROUPES)
    try {
      await o.page.waitForFunction(`!!document.querySelector('${GROUPES}')?._shadow?.querySelector('ul.groupes')`, null, { timeout: 10000 })
      const lu = await o.page.evaluate(`(async () => {
        const el = document.querySelector('${GROUPES}')
        el.grouper([{ id: 1, nom: 'A', cases: ['a1', 'a2'] }, { id: 2, nom: 'B', cases: [] }, { id: 3, nom: 'C', cases: ['c1', 'c2', 'c3'] }])
        el.poser(µ.raw(${LIGNES(1, 3)}))
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60)))
        el.grouper([...el._state.groupes, { id: 4, nom: 'D', cases: ['d1'] }])
        el.poser(µ.raw([...el._state.data, ...${LIGNES(4, 5)}]))
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60)))
        const sh = el._shadow
        return { groupes: [...sh.querySelectorAll('li.groupe')].map((li) => li.querySelector('b').textContent + ':' + [...li.querySelectorAll('span.case')].map((s) => s.textContent).join(',')), lignes: [...sh.querySelectorAll('ol > li.ligne')].map((li) => li.children.length + '/' + li.textContent) }
      })()`)
      assert.deepEqual(lu.groupes, ['A:a1,a2', 'B:', 'C:c1,c2,c3', 'D:d1'])
      assert.deepEqual(lu.lignes, ['2/1L1', '2/2L2', '2/3L3', '2/4L4', '2/5L5'])
      assert.deepEqual(o.erreurs, [])
    }
    finally {
      await o.fermer()
    }
  })
})
