// une transition garde sa première image jusqu'à son départ. Le navigateur donne son heure de départ à une animation après coup ; plus
// tardive que l'image (page occupée), l'animation attend son heure. Ici le test repousse cette heure, pour chaque lancement qu'une
// animation attend encore une microtâche après (créée ou relancée par le framework sans qu'il lui pose son heure) et pour chaque animation
// CSS née du geste, pourvu qu'elle joue ; la balise est relevée à chaque image, sous les trois moteurs, sans retard puis avec :
//  - entrée à `delay`, du moteur ou partagée (`.shared`) : cachée pendant son retard et jusqu'à son départ, jamais à son état normal ;
//  - effet posé sur une balise, dans une appli sans directive de bloc (`*fade` sur la ligne d'une liste) : la ligne arrivée ne revient
//    jamais en arrière, son état normal ne se voit pas avant qu'elle joue ;
//  - effet CSS de l'appli ou transition `.shared` remis pendant sa sortie : il revient sur ses pas, son heure de départ posée par le
//    framework — il n'attend rien, la balise ne recule pas.
// `MJS_TENUE_RELEVES=1` écrit les relevés de chaque cas
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { charger, construire, graves } from './helpers/liaison-navigateur.js'

const SI = (ouvert: boolean, attrs: string) => `<script>\n  $v    = ${ouvert}\n  @voir = (v) -> $v = v\n</script>\n{if $v}<p class="p" ${attrs}>x</p>{end}\n<p class="pret">prêt</p>\n`
const APPLIS: Record<string, Record<string, string>> = {
  blocs: {
    'td.effects.mjs': '<effects>\n  *tdclef(o: 0) =\n    @keyframes\n      from\n        opacity: $o\n      to\n        opacity: 1\n</effects>\n',
    'td-delai.mjs': SI(false, ':in=*fade(duration: 200ms, delay: 150ms)'),
    'td-partage.mjs': SI(false, ':in.shared=*fade(duration: 200ms, delay: 150ms)'),
    'td-appli.mjs': SI(true, ':transition=*tdclef(duration: 600ms, easing: linear)'),
    'td-retour.mjs': SI(true, ':transition.shared=*fade(duration: 400ms)')
  },
  // aucune directive de bloc dans cette appli : l'effet est posé sur la ligne
  posee: { 'td-posee.mjs': '<script>\n  $l     = []\n  @poser = (l) -> $l = l\n</script>\n<ul>{for r in $l by id}<li class="p" *fade(duration: 300ms)>{r.id}</li>{end}</ul>\n<p class="pret">prêt</p>\n' }
}
const RETARD = 80

// les gestes : [attente en ms, méthode de la balise, valeur, opacité sous laquelle la balise doit être passée avant le geste]
type Cas = { nom: string, appli: string, balise: string, gestes: [number, string, any, number?][], regle: 'retard' | 'entree' | 'retour' }
const CAS: Cas[] = [
  { nom: 'entrée à delay', appli: 'blocs', balise: 'mjs-td-delai', gestes: [[60, 'voir', true]], regle: 'retard' },
  { nom: 'entrée .shared à delay', appli: 'blocs', balise: 'mjs-td-partage', gestes: [[60, 'voir', true]], regle: 'retard' },
  { nom: 'effet CSS de l\'appli remis pendant sa sortie', appli: 'blocs', balise: 'mjs-td-appli', gestes: [[60, 'voir', false], [0, 'voir', true, 0.7]], regle: 'retour' },
  { nom: 'transition .shared remise pendant sa sortie', appli: 'blocs', balise: 'mjs-td-retour', gestes: [[60, 'voir', false], [0, 'voir', true, 0.7]], regle: 'retour' },
  { nom: 'effet posé sur la ligne d\'une liste, sans directive de bloc', appli: 'posee', balise: 'mjs-td-posee', gestes: [[60, 'poser', [{ id: 1 }, { id: 2 }]]], regle: 'entree' }
]

// joué dans la page : à chaque image, l'opacité de la balise de chaque cas (-1 : pas de balise) ; `g` : l'heure de chaque geste ; `i` : le
// nombre d'images relevées avant lui
async function jouer(arg: any): Promise<any> {
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
  // l'heure de départ repoussée : une fois par lancement en attente (sa promesse `ready`), et seulement si l'animation joue quand le
  // navigateur la lance
  const repousser = (a: any) => {
    if (!arg.retard || !a.pending || a.__tdLancement === a.ready) return
    a.__tdLancement = a.ready
    a.ready.then(() => { if (a.playState === 'running' && a.startTime != null) a.startTime = Number(a.startTime) + arg.retard }, () => null)
  }
  const animate = Element.prototype.animate
  const reverse = Animation.prototype.reverse
  Element.prototype.animate   = function (this: any, ...a: any[]) { const x = animate.apply(this, a as any); queueMicrotask(() => repousser(x)); return x }
  Animation.prototype.reverse = function (this: any) { reverse.call(this); queueMicrotask(() => repousser(this)) }
  const suivis = arg.cas.map((c: any) => ({ c, el: document.querySelector(c.balise) as any, s: [] as number[][], g: [] as number[], i: [] as number[] }))
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
  await Promise.all(suivis.map(async (x: any) => {
    for (const [ms, methode, valeur, sous] of x.c.gestes) {
      await pause(ms)
      while (sous != null && !(x.s.length && x.s[x.s.length - 1][1] >= 0 && x.s[x.s.length - 1][1] <= sous)) await new Promise((r) => requestAnimationFrame(r))
      x.g.push(Math.round(performance.now() - t0))
      x.i.push(x.s.length)
      x.el[methode](valeur)
      // les animations CSS nées du geste (mode partagé) : lues dans la tâche d'après, encore en attente
      setTimeout(() => { for (const p of x.el._shadow.querySelectorAll('.p')) for (const a of p.getAnimations()) repousser(a) })
    }
  }))
  await pause(1000)
  actif = false
  return suivis.map((x: any) => ({ s: x.s, g: x.g, i: x.i }))
}

// ce qu'un cas manque à sa règle, en mots (rien : il est juste)
function manquements(c: Cas, r: { s: number[][], g: number[], i: number[] }): string[] {
  const v: string[] = []
  // les images de la balise relevées après le geste `k` et avant le suivant
  const apres  = (k: number) => r.s.slice(r.i[k], k + 1 < r.i.length ? r.i[k + 1] : r.s.length).filter((y) => y[1] >= 0)
  const recule = (l: number[][]) => l.find((y, i) => i > 0 && y[1] < l[i - 1][1] - 0.05)
  const fin    = r.s[r.s.length - 1][1]
  const e      = apres(0)
  if (!e.length || r.s.slice(r.i[0]).filter((y) => y[1] >= 0).length < 5) return [`balise relevée ${e.length} fois après le premier geste`]
  if (c.regle === 'retard' || c.regle === 'entree') {
    const a = recule(e)
    // la première image relevée : pas plus haut que ce que le temps passé depuis le geste permet (300 ms pour toute la course)
    if (e[0][1] > 0.15 + (e[0][0] - r.g[0]) / 300) v.push(`l'entrée part de ${e[0][1]}, pas de son image de départ`)
    if (a) v.push(`l'entrée recule jusqu'à ${a[1]}, ${a[0] - r.g[0]} ms après son arrivée`)
  }
  if (c.regle === 'retard') {
    const tot = e.find((y) => y[0] - r.g[0] < 130 && y[1] > 0.05)
    if (tot) v.push(`à ${tot[1]} pendant son retard, ${tot[0] - r.g[0]} ms après son arrivée`)
  }
  if (c.regle === 'retour') {
    const sortie = e.find((y, i) => i > 0 && y[1] > e[i - 1][1] + 0.05)
    const retour = apres(1)
    const niveau = e[e.length - 1][1]
    const bas    = retour.find((y) => y[1] < niveau - 0.08)
    if (sortie) v.push(`remonte jusqu'à ${sortie[1]} pendant sa sortie`)
    if (niveau > 0.75 || niveau < 0.15) v.push(`remise à ${niveau} : la sortie n'était pas en cours`)
    if (bas) v.push(`remise à ${niveau}, elle recule jusqu'à ${bas[1]}, ${bas[0] - r.g[1]} ms après son retour`)
  }
  if (fin < 0.99) v.push(`à la fin : ${fin} — attendu : la balise à son état normal`)
  return v
}

for (const nav of ['chromium', 'firefox', 'webkit']) describe(`une transition garde sa première image jusqu'à son départ (${nav})`, function () {
  this.timeout(120000)
  let browser: any = null
  let present      = false
  const cibles     = new Map<string, Promise<any>>()
  const cible      = (appli: string) => {
    if (!cibles.has(appli)) cibles.set(appli, construire('dev-parents-avant', APPLIS[appli], []))
    return cibles.get(appli) as Promise<any>
  }
  before(async function () {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (present) browser = await playwright[nav].launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const retard of [0, RETARD]) for (const appli of Object.keys(APPLIS)) it(`${retard ? `heure de départ repoussée de ${retard} ms` : 'sans retard'} : ${CAS.filter((c) => c.appli === appli).map((c) => c.nom).join(' ; ')}`, async function () {
    if (!present) { this.skip(); return }
    const cas   = CAS.filter((c) => c.appli === appli)
    const b     = await cible(appli)
    const corps = cas.map((c) => `<${c.balise}></${c.balise}>`).join('')
    const o     = await charger(browser, { ...b, document: () => b.document('i', '').replace('<i></i>', corps) }, cas[0].balise)
    try {
      await o.page.waitForFunction(`Array.from(document.querySelectorAll('body > *')).every((e) => e.tagName === 'SCRIPT' || !!(e._shadow && e._shadow.querySelector('.pret')))`, null, { timeout: 30000 })
      await o.page.waitForTimeout(200)
      const releves = await o.page.evaluate(jouer, { retard, cas: cas.map((c) => ({ balise: c.balise, gestes: c.gestes })) })
      const rouges: string[] = []
      cas.forEach((c, i) => {
        const v = manquements(c, releves[i])
        if (process.env.MJS_TENUE_RELEVES) console.log(`      ${c.nom} | gestes à ${releves[i].g.join(', ')} ms | ${releves[i].s.filter((y: number[]) => y[0] >= releves[i].g[0] - 20).map((y: number[]) => `${y[0]}:${y[1] < 0 ? '-' : y[1]}`).join(' ')}`)
        if (v.length) rouges.push(`${c.nom}\n    ${v.join('\n    ')}`)
      })
      if (rouges.length) assert.fail(`${rouges.length} cas sur ${cas.length} manquent à leur règle :\n  ` + rouges.join('\n  '))
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally { await o.fermer() }
  })
})
