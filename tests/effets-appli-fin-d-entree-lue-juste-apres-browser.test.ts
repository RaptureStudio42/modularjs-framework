// l'entrée d'un effet de l'appli (`:transition`), lue JUSTE APRÈS sa fin sur une page occupée : le fil principal est bloqué par le test
// jusqu'après la fin de l'animation, et l'opacité de la balise est lue dans la tâche qui suit, avant que le navigateur ait traité cette
// fin. La balise est alors à son état normal ; elle ne se relit pas à une position de mi-course (WebKit rend le dernier style calculé
// d'une animation finie qui n'est pas remplie vers l'avant). L'heure est posée par le test : rien ne dépend du hasard de la charge
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { charger, construire, graves } from './helpers/liaison-navigateur.js'

const EFFETS = `<effects>
  *fedeux(o: 0) =
    @keyframes
      from
        opacity: $o
      to
        opacity: 1
  *fecache(o: 0) =
    opacity: $o
</effects>
`
const BALISE = (attrs: string) => `<script>\n  $v    = false\n  @voir = (v) -> $v = v\n</script>\n{if $v}<p class="p" ${attrs}>x</p>{end}\n<p class="pret">prêt</p>\n`
const FORMES = [
  { nom: '@keyframes, from et to', attrs: ':transition=*fedeux(duration: 200ms, easing: linear)' },
  { nom: 'sans @keyframes', attrs: ':transition=*fecache(duration: 200ms, easing: linear)' }
]
const SOURCES: Record<string, string> = { 'fe.effects.mjs': EFFETS }
FORMES.forEach((f, i) => { SOURCES[`fe-${i}.mjs`] = BALISE(f.attrs) })

// joué dans la page, une forme après l'autre, `fois` entrées chacune : [opacité à mi-course, juste après la fin, à l'image suivante, animations restantes]
async function jouer(arg: { balises: string[], fois: number }): Promise<number[][][]> {
  const pause   = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const tache   = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(null); c.port2.postMessage(0) })
  const image   = () => new Promise((r) => requestAnimationFrame(() => r(null)))
  const bloquer = (jusqua: number) => { while (performance.now() < jusqua) { /* fil principal occupé */ } }
  const op      = (n: Element) => Math.round(Number(getComputedStyle(n).opacity) * 100) / 100
  const out: number[][][] = []
  for (const balise of arg.balises) {
    const el              = document.querySelector(balise) as any
    const lus: number[][] = []
    for (let i = 0; i < arg.fois; i++) {
      el.voir(true)
      let p: any = null
      let a: any = null
      for (let k = 0; k < 20 && !a; k++) {
        await image()
        p = el._shadow.querySelector('.p')
        a = p && p.getAnimations()[0]
      }
      if (!a) { lus.push([-1, -1, -1, -1]); continue }
      await a.ready
      const t0 = performance.now() - Number(a.currentTime)
      await pause(90)
      p.style.color = 'red'
      const mi = op(p)
      await pause(50)
      bloquer(t0 + 212)
      await tache()
      const juste = op(p)
      await image()
      await image()
      lus.push([mi, juste, op(p), p.getAnimations().length])
      el.voir(false)
      await pause(400)
    }
    out.push(lus)
  }
  return out
}

for (const nav of (process.env.MJS_EFFETS_NAVS || 'chromium,firefox,webkit').split(',')) describe(`effet de l'appli : l'entrée lue juste après sa fin, fil principal occupé (${nav})`, function () {
  this.timeout(120000)
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

  it('la balise est à son état normal, pas à une position de mi-course', async function () {
    if (!present) { this.skip(); return }
    const cible = await construire('dev-parents-avant', SOURCES, [])
    const corps = FORMES.map((_, i) => `<mjs-fe-${i}></mjs-fe-${i}>`).join('')
    const o     = await charger(browser, { ...cible, document: () => cible.document('i', '').replace('<i></i>', corps) }, 'mjs-fe-0')
    try {
      await o.page.waitForFunction(`Array.from(document.querySelectorAll('body > *')).every((e) => e.tagName === 'SCRIPT' || !!(e._shadow && e._shadow.querySelector('.pret')))`, null, { timeout: 30000 })
      await o.page.waitForTimeout(200)
      const lus              = await o.page.evaluate(jouer, { balises: FORMES.map((_, i) => `mjs-fe-${i}`), fois: 6 })
      const rouges: string[] = []
      FORMES.forEach((f, i) => {
        const faux = lus[i].filter((x: number[]) => x[1] < 0.95)
        console.log(`      ${f.nom} | [mi-course, juste après la fin, deux images après, animations restantes] : ${lus[i].map((x: number[]) => JSON.stringify(x)).join(' ')}`)
        if (lus[i].some((x: number[]) => x[0] < 0)) rouges.push(`${f.nom} : entrée sans animation`)
        if (faux.length) rouges.push(`${f.nom} : ${faux.length} entrées sur ${lus[i].length} relues à ${faux.map((x: number[]) => x[1]).join(', ')} juste après leur fin`)
        if (lus[i].some((x: number[]) => x[2] < 0.99 || x[3] > 0)) rouges.push(`${f.nom} : deux images après la fin, la balise n'est pas à son état normal, au repos`)
      })
      if (rouges.length) assert.fail(`${rouges.length} manquements :\n  ` + rouges.join('\n  '))
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally { await o.fermer() }
  })
})
