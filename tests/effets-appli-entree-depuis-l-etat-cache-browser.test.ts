// un effet CSS de l'appli sans `@keyframes`, posé sur le cycle de vie d'une balise (`:in`, `:transition`) : ses déclarations sont l'état
// caché — à l'entrée, la balise part d'elles et arrive à son état normal, sans jamais reculer ni sauter ; avec `delay`, elle les garde
// pendant son retard ; retirée pendant son entrée puis remise, elle ne va jamais à contresens. À la sortie (`:out`), elle y va ; remise
// pendant cette sortie (la balise d'un `{if}`, la ligne d'un `{for}`), c'est la même balise qui revient sur ses pas. Un effet à
// `@keyframes` se joue tel qu'il est écrit, une fois : `from` seul part de son image et arrive à l'état normal ; `to` seul ou un
// pourcentage seul partent de l'état normal, passent par leur image, et la balise retrouve son état normal à la fin.
// Chaque forme a sa balise ; toutes sont jouées ensemble dans la page, l'opacité relevée à chaque image, sous les trois moteurs.
// `MJS_EFFETS_APPLI_RELEVES=1` écrit les relevés de chaque forme
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { charger, construire, graves } from './helpers/liaison-navigateur.js'

const EFFETS = `<effects>
  *ebcache(o: 0) =
    opacity: $o
  *ebde(o: 0) =
    @keyframes
      from
        opacity: $o
  *ebvers(o: 0) =
    @keyframes
      to
        opacity: $o
  *ebmilieu(o: 0) =
    @keyframes
      50%
        opacity: $o
  *ebdeux(o: 0) =
    @keyframes
      from
        opacity: $o
      to
        opacity: 1
</effects>
`
const BALISE = (ouvert: boolean, attrs: string) => `<script>\n  $v    = ${ouvert}\n  @voir = (v) -> $v = v\n</script>\n{if $v}<p class="p" ${attrs}>x</p>{end}\n<p class="pret">prêt</p>\n`
// la même, ligne d'une liste
const LIGNE  = (attrs: string) => `<script>\n  $l    = [{ id: 1 }]\n  @voir = (v) -> $l = if v then [{ id: 1 }] else []\n</script>\n<ul>{for r in $l by id}<li class="p" ${attrs}>{r.id}</li>{end}</ul>\n<p class="pret">prêt</p>\n`
const R      = 'duration: 300ms, easing: linear'

// les gestes : [attente en ms, balise montrée ou retirée] ; la règle : ce que les images doivent montrer
type Forme = { nom: string, attrs: string, ouvert?: boolean, ligne?: boolean, gestes: [number, boolean][], regle: 'cache' | 'retard' | 'sens' | 'sortie' | 'revient' | 'ecrite' }
const FORMES: Forme[] = [
  { nom: 'sans @keyframes, :in', attrs: `:in=*ebcache(${R})`, gestes: [[60, true]], regle: 'cache' },
  { nom: 'sans @keyframes, :transition', attrs: `:transition=*ebcache(${R})`, gestes: [[60, true]], regle: 'cache' },
  { nom: 'sans @keyframes, :in avec delay', attrs: `:in=*ebcache(${R}, delay: 150ms)`, gestes: [[60, true]], regle: 'retard' },
  { nom: 'sans @keyframes, :in.shared', attrs: `:in.shared=*ebcache(${R})`, gestes: [[60, true]], regle: 'cache' },
  { nom: 'sans @keyframes, :transition, retirée pendant son entrée puis remise', attrs: ':transition=*ebcache(duration: 400ms, easing: linear)', gestes: [[60, true], [150, false], [120, true]], regle: 'sens' },
  { nom: 'sans @keyframes, :out', attrs: `:out=*ebcache(${R})`, ouvert: true, gestes: [[60, false]], regle: 'sortie' },
  { nom: 'sans @keyframes, :out, remise pendant sa sortie', attrs: ':out=*ebcache(duration: 400ms, easing: linear)', ouvert: true, gestes: [[60, false], [150, true]], regle: 'revient' },
  { nom: 'sans @keyframes, :transition sur la ligne d\'un {for}, remise pendant sa sortie', attrs: ':transition=*ebcache(duration: 400ms, easing: linear)', ligne: true, gestes: [[60, false], [150, true]], regle: 'revient' },
  { nom: '@keyframes, from seul, :in', attrs: `:in=*ebde(${R})`, gestes: [[60, true]], regle: 'cache' },
  { nom: '@keyframes, from et to, :in', attrs: `:in=*ebdeux(${R})`, gestes: [[60, true]], regle: 'cache' },
  { nom: '@keyframes, to seul, :in', attrs: `:in=*ebvers(${R})`, gestes: [[60, true]], regle: 'ecrite' },
  { nom: '@keyframes, 50% seul, :in', attrs: `:in=*ebmilieu(${R})`, gestes: [[60, true]], regle: 'ecrite' }
]
const SOURCES: Record<string, string> = { 'eb.effects.mjs': EFFETS }
FORMES.forEach((f, i) => { SOURCES[`eb-${i}.mjs`] = f.ligne ? LIGNE(f.attrs) : BALISE(!!f.ouvert, f.attrs) })

// joué dans la page : à chaque image, l'opacité de la balise de chaque forme (-1 : pas de balise) ; `g` : l'heure de chaque geste ; `i` : le
// nombre d'images relevées avant lui ; `meme` : la balise de la fin est celle du départ
async function jouer(formes: any[]): Promise<any> {
  const pause  = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const suivis = formes.map((f) => ({ f, el: document.querySelector(f.balise) as any, s: [] as number[][], g: [] as number[], i: [] as number[], depart: null as any }))
  for (const x of suivis) x.depart = x.el._shadow.querySelector('.p')
  const t0     = performance.now()
  let actif    = true
  const image  = () => {
    if (!actif) return
    for (const x of suivis) {
      const p = x.el._shadow.querySelector('.p')
      x.s.push([Math.round(performance.now() - t0), p ? Math.round(Number(getComputedStyle(p).opacity) * 100) / 100 : -1])
    }
    requestAnimationFrame(image)
  }
  requestAnimationFrame(image)
  await Promise.all(suivis.map(async (x) => {
    for (const [ms, v] of x.f.gestes) {
      await pause(ms)
      x.g.push(Math.round(performance.now() - t0))
      x.i.push(x.s.length)
      x.el.voir(v)
    }
  }))
  await pause(900)
  actif = false
  return suivis.map((x) => ({ s: x.s, g: x.g, i: x.i, meme: !!x.depart && x.depart === x.el._shadow.querySelector('.p') }))
}

// ce qu'une forme manque à sa règle, en mots (rien : elle est juste)
function manquements(f: Forme, r: { s: number[][], g: number[], i: number[], meme: boolean }): string[] {
  const v: string[] = []
  // les images de la balise après le geste `k` et avant le suivant
  const apres   = (k: number) => r.s.slice(r.i[k], k + 1 < r.i.length ? r.i[k + 1] : r.s.length).filter((y) => y[1] >= 0)
  const recule  = (l: number[][]) => l.find((y, i) => i > 0 && y[1] < l[i - 1][1] - 0.05)
  const remonte = (l: number[][]) => l.find((y, i) => i > 0 && y[1] > l[i - 1][1] + 0.05)
  const saute   = (l: number[][]) => l.find((y, i) => i > 0 && y[0] - l[i - 1][0] < 50 && Math.abs(y[1] - l[i - 1][1]) > 0.35)
  const mini    = (l: number[][]) => Math.min(...l.map((y) => y[1]))
  const fin     = r.s[r.s.length - 1][1]
  const e       = apres(0)
  if (!e.length || r.s.slice(r.i[0]).filter((y) => y[1] >= 0).length < 5) return [`balise relevée ${e.length} fois après le premier geste`]
  // la course que le temps passé entre le geste et la première image relevée permet (300 ms pour toute la course)
  const jeu     = 0.15 + (e[0][0] - r.g[0]) / 300
  if (f.regle === 'cache' || f.regle === 'retard' || f.regle === 'sens') {
    const a = recule(e)
    const b = saute(e)
    if (e[0][1] > jeu) v.push(`l'entrée part de ${e[0][1]}, pas de son état caché`)
    if (a) v.push(`l'entrée recule jusqu'à ${a[1]}, ${a[0] - r.g[0]} ms après son départ`)
    if (b) v.push(`l'entrée saute à ${b[1]}, ${b[0] - r.g[0]} ms après son départ`)
  }
  if (f.regle === 'retard') {
    const tot = e.find((y) => y[0] - r.g[0] < 130 && y[1] > 0.05)
    if (tot) v.push(`à ${tot[1]} pendant son retard, ${tot[0] - r.g[0]} ms après son arrivée`)
  }
  if (f.regle === 'sens') {
    const a = remonte(apres(1))
    const b = recule(apres(2))
    if (a) v.push(`remonte jusqu'à ${a[1]} pendant son retrait`)
    if (b) v.push(`redescend jusqu'à ${b[1]} pendant son retour`)
  }
  if (f.regle === 'ecrite') {
    if (e[0][1] < 1 - jeu) v.push(`l'animation part de ${e[0][1]}, pas de l'état normal`)
    if (mini(e) > 0.3) v.push(`l'animation ne passe pas par son image (au plus bas : ${mini(e)})`)
  }
  if (f.regle === 'revient') {
    const a = remonte(e)
    const b = recule(apres(1))
    const c = saute(r.s.slice(r.i[0]).filter((y) => y[1] >= 0))
    if (e[0][1] < 1 - jeu) v.push(`la sortie part de ${e[0][1]}, pas de l'état normal`)
    if (a) v.push(`la sortie remonte jusqu'à ${a[1]}`)
    if (e[e.length - 1][1] > 0.85) v.push(`remise à ${e[e.length - 1][1]} : la sortie n'était pas en cours`)
    if (b) v.push(`redescend jusqu'à ${b[1]} pendant son retour`)
    if (c) v.push(`saute à ${c[1]}, ${c[0] - r.g[0]} ms après son retrait`)
    if (!r.meme) v.push('la balise revenue n\'est pas celle qui sortait')
  }
  if (f.regle === 'sortie') {
    const a = remonte(e)
    if (e[0][1] < 1 - jeu) v.push(`la sortie part de ${e[0][1]}, pas de l'état normal`)
    if (a) v.push(`la sortie remonte jusqu'à ${a[1]}`)
    if (mini(e) > 0.3) v.push(`la sortie n'arrive pas à son état caché (au plus bas : ${mini(e)})`)
    if (fin !== -1) v.push('la balise est encore là après sa sortie')
  }
  else if (fin < 0.99) v.push(`à la fin : ${fin} — attendu : la balise à son état normal`)
  return v
}

for (const nav of ['chromium', 'firefox', 'webkit']) describe(`effet CSS de l'appli sur le cycle de vie : l'entrée part de l'état caché (${nav})`, function () {
  this.timeout(90000)
  let browser: any = null
  let present      = false
  before(async function () {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (present) browser = await playwright[nav].launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it(`les ${FORMES.length} formes, image par image`, async function () {
    if (!present) { this.skip(); return }
    const cible = await construire('dev-parents-avant', SOURCES, [])
    const corps = FORMES.map((_, i) => `<mjs-eb-${i}></mjs-eb-${i}>`).join('')
    const o     = await charger(browser, { ...cible, document: () => cible.document('i', '').replace('<i></i>', corps) }, 'mjs-eb-0')
    try {
      await o.page.waitForFunction(`Array.from(document.querySelectorAll('body > *')).every((e) => e.tagName === 'SCRIPT' || !!(e._shadow && e._shadow.querySelector('.pret')))`, null, { timeout: 30000 })
      await o.page.waitForTimeout(200)
      const releves = await o.page.evaluate(jouer, FORMES.map((f, i) => ({ balise: `mjs-eb-${i}`, gestes: f.gestes })))
      const rouges: string[] = []
      FORMES.forEach((f, i) => {
        const v = manquements(f, releves[i])
        if (process.env.MJS_EFFETS_APPLI_RELEVES) console.log(`      ${f.nom} | gestes à ${releves[i].g.join(', ')} ms | ${releves[i].s.filter((y: number[]) => y[0] >= releves[i].g[0] - 20).map((y: number[]) => `${y[0]}:${y[1] < 0 ? '-' : y[1]}`).join(' ')}`)
        if (v.length) rouges.push(`${f.nom} (${f.attrs})\n    ${v.join('\n    ')}`)
      })
      if (rouges.length) assert.fail(`${rouges.length} formes sur ${FORMES.length} manquent à leur règle :\n  ` + rouges.join('\n  '))
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally { await o.fermer() }
  })
})
