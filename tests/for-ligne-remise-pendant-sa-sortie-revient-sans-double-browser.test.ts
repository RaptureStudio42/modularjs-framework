// une ligne retirée d'une liste joue sa sortie animée ; remise dans la liste pendant cette sortie, avec ou sans autre changement entre les
// deux, c'est la MÊME ligne qui revient à sa place : une seule ligne par clé, ses nœuds, sa saisie et l'état de ses composants gardés, sa
// sortie arrêtée (elle ne disparaît pas à la fin de l'ancienne sortie). Remise après la fin de la sortie : une ligne neuve, seule.
// Liste à clé, sans clé, `{for}` imbriqué (ligne qui porte une liste, ligne d'une liste intérieure), liste dans un `{await}`, `*slide`,
// entrée animée en plus, deux clés remises, une clé remise deux fois ; développement et production, Chromium, Firefox et WebKit
// Les sorties qui jouaient avec celle de la ligne reviennent aussi depuis là où elles en sont, jamais de leur fin ni de leur début : celle
// d'une balise intérieure (`.global`, `:childtransition`, son entrée quand elle en a une), celle d'une ligne `.shared` — même quand une autre ligne qui sort garde encore
// ses images clés partagées
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const SORTIE = ':out=*fade(duration: 900ms)'
const POSER  = `<script>
  $l     = []
  @poser = (l) -> $l = l
</script>
`
const SOURCES: Record<string, string> = {
  'dr-enfant.mjs': `<script>
  $compte = 0
  @incr   = -> $compte += 1
</script>
<span class="enf">{$compte}</span>
`,
  'dr-cle.mjs': `${POSER}<ul class="l">{for r in $l by id}<li ${SORTIE}><b>{r.id}</b><input class="f" aria-label="f"><mjs-dr-enfant></mjs-dr-enfant></li>{end}</ul>
<p class="pret">prêt</p>
`,
  'dr-sans.mjs': `${POSER}<ul class="l">{for o in $l}<li ${SORTIE}><b>{o.id}</b><input class="f" aria-label="f"></li>{end}</ul>
<p class="pret">prêt</p>
`,
  'dr-glisse.mjs': `${POSER}<ul class="l">{for r in $l by id}<li :out=*slide(duration: 900ms)><b>{r.id}</b><input class="f" aria-label="f"></li>{end}</ul>
<p class="pret">prêt</p>
`,
  'dr-entree.mjs': `${POSER}<ul class="l">{for r in $l by id}<li :in=*fade(duration: 900ms) ${SORTIE}><b>{r.id}</b><input class="f" aria-label="f"></li>{end}</ul>
<p class="pret">prêt</p>
`,
  'dr-imbrique.mjs': `${POSER}<div class="l">{for g in $l by id}<section ${SORTIE}><b>{g.id}</b><input class="f" aria-label="f">{for x in g.items by id}<p>{x.id}</p>{end}</section>{end}</div>
<p class="pret">prêt</p>
`,
  'dr-interne.mjs': `<script>
  $g     = []
  @poser = (l) -> $g = [{ id: 'g', items: l }]
</script>
<div class="g">{for g in $g by id}<section>{for x in g.items by id}<p ${SORTIE}><b>{x.id}</b><input class="f" aria-label="f"></p>{end}</section>{end}</div>
<p class="pret">prêt</p>
`,
  'dr-attente.mjs': `<script>
  $l     = []
  $p     = Promise.resolve(1)
  @poser = (l) -> $l = l
</script>
<div class="a">{await $p}<em>att</em>{success v}<ul class="l">{for r in $l by id}<li ${SORTIE}><b>{r.id}</b><input class="f" aria-label="f"></li>{end}</ul>{end}</div>
<p class="pret">prêt</p>
`,
  'dr-global.mjs': `${POSER}<ul class="l">{for r in $l by id}<li class="g"><b>{r.id}</b><input class="f" aria-label="f"><span class="s" :out.global=*fade(duration: 900ms)>s</span></li>{end}</ul>
<p class="pret">prêt</p>
`,
  'dr-global-entree.mjs': `${POSER}<ul class="l">{for r in $l by id}<li class="g"><b>{r.id}</b><input class="f" aria-label="f"><span class="s" :transition.global=*fade(duration: 900ms)>s</span></li>{end}</ul>
<p class="pret">prêt</p>
`,
  'dr-enfants.mjs': `${POSER}<ul class="l" :childtransition="all">{for r in $l by id}<li class="g"><b>{r.id}</b><input class="f" aria-label="f"><span class="s" ${SORTIE}>s</span></li>{end}</ul>
<p class="pret">prêt</p>
`,
  'dr-partage.mjs': `${POSER}<ul class="l">{for r in $l by id}<li :out.shared=*fade(duration: 900ms)><b>{r.id}</b><input class="f" aria-label="f"></li>{end}</ul>
<p class="pret">prêt</p>
`,
  'dr-partage-long.mjs': `${POSER}<ul class="l">{for r in $l by id}<li :out.shared=*fade(duration: 1500ms)><b>{r.id}</b><input class="f" aria-label="f"></li>{end}</ul>
<p class="pret">prêt</p>
`
}

// chaque cas sur son propre composant : ils se jouent ensemble, dans la même page. `suivi` : la balise dont la sortie doit revenir depuis
// sa position (`''` : la ligne elle-même) ; `juste` : le premier relevé, tant de millisecondes après la remise (60 par défaut), avec
// l'opacité de la ligne ; `lignesJuste` : les lignes à ce moment-là, quand une autre ligne sort encore
const CAS: Record<string, { balise: string, lignes: string, pas: (number | number[])[], remises: number[], attendu: number[], neuve?: boolean, entree?: boolean, suivi?: string, juste?: number, lignesJuste?: number[] }> = {
  'cle, autre changement entre retrait et remise': { balise: 'dr-cle', lignes: 'ul.l > li', pas: [[1, 2, 3, 4], [1, 3, 4], 150, [1, 3, 4, 9], 150, [1, 2, 3, 4, 9]], remises: [2], attendu: [1, 2, 3, 4, 9] },
  'cle, retrait puis remise seuls': { balise: 'dr-cle', lignes: 'ul.l > li', pas: [[1, 2, 3, 4], [1, 3, 4], 150, [1, 2, 3, 4]], remises: [2], attendu: [1, 2, 3, 4] },
  'cle, deux cles remises': { balise: 'dr-cle', lignes: 'ul.l > li', pas: [[1, 2, 3, 4, 5], [1, 3, 5], 150, [1, 3, 5, 9], 150, [1, 2, 3, 4, 5, 9]], remises: [2, 4], attendu: [1, 2, 3, 4, 5, 9] },
  'cle, remise deux fois': { balise: 'dr-cle', lignes: 'ul.l > li', pas: [[1, 2, 3, 4], [1, 3, 4], 150, [1, 2, 3, 4], 150, [1, 3, 4, 9], 150, [1, 2, 3, 4, 9]], remises: [2], attendu: [1, 2, 3, 4, 9] },
  'cle, remise apres la fin de la sortie': { balise: 'dr-cle', lignes: 'ul.l > li', pas: [[1, 2, 3, 4], [1, 3, 4], 1300, [1, 2, 3, 4]], remises: [2], attendu: [1, 2, 3, 4], neuve: true },
  'sans cle': { balise: 'dr-sans', lignes: 'ul.l > li', pas: [[1, 2, 3, 4], [1, 3, 4], 150, [1, 3, 4, 9], 150, [1, 2, 3, 4, 9]], remises: [2], attendu: [1, 2, 3, 4, 9] },
  'sortie *slide': { balise: 'dr-glisse', lignes: 'ul.l > li', pas: [[1, 2, 3, 4], [1, 3, 4], 150, [1, 3, 4, 9], 150, [1, 2, 3, 4, 9]], remises: [2], attendu: [1, 2, 3, 4, 9] },
  'entree animee en plus': { balise: 'dr-entree', lignes: 'ul.l > li', pas: [[1, 2, 3, 4], [1, 3, 4], 300, [1, 3, 4, 9], 150, [1, 2, 3, 4, 9]], remises: [2], attendu: [1, 2, 3, 4, 9], entree: true },
  'ligne qui porte une liste': { balise: 'dr-imbrique', lignes: 'div.l > section', pas: [[1, 2, 3, 4], [1, 3, 4], 150, [1, 3, 4, 9], 150, [1, 2, 3, 4, 9]], remises: [2], attendu: [1, 2, 3, 4, 9] },
  'ligne d une liste interieure': { balise: 'dr-interne', lignes: 'div.g section > p', pas: [[1, 2, 3, 4], [1, 3, 4], 150, [1, 3, 4, 9], 150, [1, 2, 3, 4, 9]], remises: [2], attendu: [1, 2, 3, 4, 9] },
  'liste dans un {await}': { balise: 'dr-attente', lignes: 'ul.l > li', pas: [[1, 2, 3, 4], [1, 3, 4], 150, [1, 3, 4, 9], 150, [1, 2, 3, 4, 9]], remises: [2], attendu: [1, 2, 3, 4, 9] },
  'sortie interieure .global': { balise: 'dr-global', lignes: 'ul.l > li', pas: [[1, 2, 3, 4], [1, 3, 4], 150, [1, 2, 3, 4]], remises: [2], attendu: [1, 2, 3, 4], suivi: '.s' },
  'balise interieure a entree, :transition.global': { balise: 'dr-global-entree', lignes: 'ul.l > li', pas: [[1, 2, 3, 4], [1, 3, 4], 150, [1, 2, 3, 4]], remises: [2], attendu: [1, 2, 3, 4], suivi: '.s', entree: true },
  'sortie des balises interieures, :childtransition': { balise: 'dr-enfants', lignes: 'ul.l > li', pas: [[1, 2, 3, 4], [1, 3, 4], 150, [1, 2, 3, 4]], remises: [2], attendu: [1, 2, 3, 4], suivi: '.s' },
  'sortie partagee (.shared)': { balise: 'dr-partage', lignes: 'ul.l > li', pas: [[1, 2, 3, 4], [1, 3, 4], 150, [1, 2, 3, 4]], remises: [2], attendu: [1, 2, 3, 4], suivi: '' },
  'sortie partagee, une autre ligne sort encore': { balise: 'dr-partage-long', lignes: 'ul.l > li', pas: [[1, 2, 3, 4], [1, 3, 4], 300, [1, 4], 100, [1, 2, 4]], remises: [2], attendu: [1, 2, 4], suivi: '', juste: 800, lignesJuste: [1, 2, 3, 4] }
}

const enveloppe = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}</body></html>`
const CORPS     = Object.entries(CAS).map(([nom, c]) => `<mjs-${c.balise} data-cas="${nom}"></mjs-${c.balise}>`).join('')

async function construire(prod: boolean): Promise<Cible> {
  const root   = mjsTmp('dr-' + (prod ? 'prod' : 'dev'))
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), source)
  const base: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js') }
  if (prod) Object.assign(base, { env: 'prod', js: 'bundle', urlPrefix: '/out' })
  const bundler = new Bundler(base)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  if (prod) return { mode: 'bundle', racine: root, document: () => enveloppe(`${CORPS}<script type="module" src="/out/bundle.js"></script>`) }
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang   = (f: string) => /^mjs_core-/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : 2
  const script = files.sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  return { mode: 'dev-parents-avant', racine: root, document: () => enveloppe(`${CORPS}<script>${script}</script>`) }
}

// un cas joué dans la page : les listes posées dans l'ordre, la ligne de chaque clé remise marquée avant son retrait (saisie, compteur de
// son composant), puis deux relevés — juste après la remise, puis après la fin qu'aurait eue l'ancienne sortie
const JOUER = (nom: string, c: typeof CAS[string]) => `(async () => {
  const pause    = (ms) => new Promise((r) => setTimeout(r, ms))
  const image    = () => new Promise((r) => requestAnimationFrame(() => r(null)))
  const el       = document.querySelector('[data-cas="${nom}"]'), om = el._shadow
  const objets   = {}
  const liste    = (ids) => ids.map((i) => objets[i] ||= { id: i, items: [{ id: i + 'a' }, { id: i + 'b' }] })
  const lignes   = () => Array.from(om.querySelectorAll('${c.lignes}'))
  const ligne    = (id) => lignes().filter((n) => n.querySelector('b') && n.querySelector('b').textContent === String(id))
  const marquees = {}
  const pas      = ${JSON.stringify(c.pas)}
  const suivi    = ${JSON.stringify(c.suivi ?? null)}
  const cibleDe  = (n) => suivi === '' ? n : n.querySelector(suivi)
  const opacite  = (n) => Number(getComputedStyle(n).opacity)
  const remise   = pas.map((p) => Array.isArray(p)).lastIndexOf(true)
  const avant    = {}
  let premier    = true
  for (let i = 0; i < pas.length; i++) {
    const p = pas[i]
    if (typeof p === 'number') { await pause(p); continue }
    // l'opacité de la balise suivie, lue dans une image juste avant la remise, faite dans la même image : son retour part de là (hors d'une
    // image, WebKit peut rendre un style d'une image en retard sur la position de l'animation)
    if (i === remise && suivi !== null) {
      await image()
      for (const id of ${JSON.stringify(c.remises)}) avant[id] = opacite(cibleDe(ligne(id)[0]))
    }
    el.poser(liste(p))
    if (!premier) continue
    premier = false
    await pause(${c.entree ? 1100 : 300})
    for (const id of ${JSON.stringify(c.remises)}) {
      const n      = ligne(id)[0]
      marquees[id] = n
      n.querySelector('input.f').value = 'tape' + id
      const enf = n.querySelector('mjs-dr-enfant')
      if (enf) enf.incr()
    }
    await pause(30)
  }
  const relever = (fin) => {
    const ids   = lignes().map((n) => n.querySelector('b').textContent).join(',')
    const parts = ['lignes ' + ids]
    for (const id of ${JSON.stringify(c.remises)}) {
      const ns = ligne(id)
      const n  = ns[ns.length - 1]
      if (!n) { parts.push(id + ' absente'); continue }
      parts.push(id + (ns.length > 1 ? ' en ' + ns.length + ' exemplaires,' : '') + ' ' + (n === marquees[id] ? 'meme ligne' : 'ligne neuve') + ', saisie [' + n.querySelector('input.f').value + ']')
      const enf = n.querySelector('mjs-dr-enfant')
      if (enf) parts.push('compteur ' + ((enf._shadow && enf._shadow.querySelector('.enf') || {}).textContent))
      if (n.querySelector('p')) parts.push('liste interieure ' + Array.from(n.querySelectorAll('p')).map((x) => x.textContent).join(','))
      if (suivi !== null && !fin) {
        const o = opacite(cibleDe(n))
        parts.push('retour ' + (o >= avant[id] - 0.05 ? 'depuis sa position' : 'repart de ' + o.toFixed(2) + ', etait a ' + avant[id].toFixed(2)))
      }
      if (suivi && fin) parts.push('balise interieure ' + getComputedStyle(cibleDe(n)).opacity)
      if (fin || ${c.juste ? 'true' : 'false'}) parts.push('opacite ' + getComputedStyle(n).opacity + ', animations ' + n.getAnimations().length + ', hauteur ' + (n.getBoundingClientRect().height > 0 ? 'pleine' : 'nulle'))
    }
    return parts.join(' ; ')
  }
  await pause(${c.juste ?? 60})
  await image()
  const juste = relever(false)
  await pause(1300)
  return { juste, apres: relever(true) }
})()`

// ce que la page doit montrer : la ligne d'avant, ou une ligne neuve pour la remise après la fin de la sortie
function attendu(c: typeof CAS[string]) {
  const ids  = (l: number[]) => 'lignes ' + l.join(',')
  const cles = (fin: boolean) => c.remises.map((id) => {
    const parts = [id + ' ' + (c.neuve ? 'ligne neuve' : 'meme ligne') + ', saisie [' + (c.neuve ? '' : 'tape' + id) + ']']
    if (c.balise === 'dr-cle') parts.push('compteur ' + (c.neuve ? '0' : '1'))
    if (c.balise === 'dr-imbrique') parts.push('liste interieure ' + id + 'a,' + id + 'b')
    if (c.suivi !== undefined && !fin) parts.push('retour depuis sa position')
    if (c.suivi && fin) parts.push('balise interieure 1')
    if (fin || c.juste) parts.push('opacite 1, animations 0, hauteur pleine')
    return parts.join(' ; ')
  }).join(' ; ')
  return { juste: ids(c.lignesJuste ?? c.attendu) + ' ; ' + cles(false), apres: ids(c.attendu) + ' ; ' + cles(true) }
}

const NAVIGATEURS = (process.env.DR_NAVS || 'chromium,firefox,webkit').split(',')
const cibles      = new Map<boolean, Promise<Cible>>()
const cible       = (prod: boolean) => {
  if (!cibles.has(prod)) cibles.set(prod, construire(prod))
  return cibles.get(prod) as Promise<Cible>
}
const PRET = `Array.from(document.querySelectorAll('[data-cas]')).every((e) => !!(e._shadow && e._shadow.querySelector('.pret'))) && !!document.querySelector('[data-cas="liste dans un {await}"]')._shadow.querySelector('ul.l')`

for (const nav of NAVIGATEURS) describe(`{for} : une ligne remise pendant sa sortie animée revient, sans double (${nav})`, function () {
  this.timeout(120000)
  let browser: any = null
  let present      = false
  before(async function () {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) return
    browser = await playwright[nav].launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })
  for (const prod of [false, true]) it(`${prod ? 'production' : 'développement'} : une ligne par clé, la ligne d'avant garde ses nœuds, sa saisie et ses composants`, async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(prod), 'mjs-dr-cle')
    try {
      await o.page.waitForFunction(PRET, null, { timeout: 10000 })
      const obtenu: Record<string, unknown> = {}
      const voulu: Record<string, unknown>  = {}
      await Promise.all(Object.entries(CAS).map(async ([nom, c]) => {
        obtenu[nom] = await o.page.evaluate(JOUER(nom, c))
        voulu[nom]  = attendu(c)
      }))
      assert.deepEqual(obtenu, voulu)
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally { await o.fermer() }
  })
})
