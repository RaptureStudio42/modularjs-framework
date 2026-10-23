// « Réduire les animations » demandé par le système : une transition du cycle de vie ne joue pas, mais
// ses quatre événements partent comme sans la préférence — `@introstart`, `@introend`, `@outrostart`,
// `@outroend`. Une appli qui enchaîne son état sur `@outroend` réagit pour ces visiteurs aussi : la
// balise entre et sort tout de suite, sans animation. happy-dom n'a ni `animate()` ni préférence
// système : un faux `animate` enregistre chaque animation, un faux `matchMedia` dit la préférence.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SUIVI = '@introstart={$debut = $debut + 1} @introend={$fin = $fin + 1} @outrostart={$sortie = $sortie + 1} @outroend={$sorti = $sorti + 1}'
const ETAT  = '<script>\n$vu = false\n$debut = 0\n$fin = 0\n$sortie = 0\n$sorti = 0\n</script>\n<i class="n">{$debut}/{$fin}/{$sortie}/{$sorti}</i>\n'

const COMPOSANTS: Record<string, string> = {
  'calme-ev-vole':   ETAT + `{if $vu}<p class="v" @in=*fly(up, distance: 200, duration: 2s) @out=*fade(300ms) ${SUIVI}>vole</p>{end}`,
  'calme-ev-glisse': ETAT + `{if $vu}<p class="s" @transition=*slide(x, duration: 250ms) ${SUIVI}>glisse</p>{end}`,
  'calme-ev-maison': "<script>\nµanim.create 'tourne', css: (t) -> { transform: \"rotate(#{t * 90}deg)\" }\n$vu = false\n$debut = 0\n$fin = 0\n$sortie = 0\n$sorti = 0\n</script>\n<i class=\"n\">{$debut}/{$fin}/{$sortie}/{$sorti}</i>\n" + `{if $vu}<p class="m" @in=*tourne(duration: 8s) @out=*tourne(duration: 8s) ${SUIVI}>maison</p>{end}`,
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('transitions du cycle de vie en mouvement réduit : les événements partent', function () {
  this.timeout(60000)
  let window: any
  let reduit = true
  let animateAvant: any

  before(async () => {
    const root   = mjsTmp('transitions-calmes-evenements')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    animateAvant = window.Element.prototype.animate
    window.Element.prototype.animate = function (keyframes: any, opts: any) {
      let fin: any
      const a: any = {
        el: this, keyframes, opts, currentTime: 0,
        finished: new Promise((r) => { fin = r }),
        effect: { getComputedTiming: () => ({ progress: a.done ? 1 : 0 }) },
        cancel() { a.cancelled = true; fin(a) },
        pause() {}, play() {}, finish() { a.done = true; fin(a) },
      }
      const d = typeof opts === 'number' ? opts : (opts?.duration ?? 0)
      setTimeout(() => { if (!a.cancelled) { a.done = true; fin(a) } }, Math.min(5, d))
      return a
    }
    window.matchMedia = (q: string) => ({ media: q, matches: reduit && /prefers-reduced-motion:\s*reduce/.test(q), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    if (animateAvant === undefined) delete window?.Element?.prototype?.animate
    else if (window) window.Element.prototype.animate = animateAvant
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // entrée puis sortie d'une balise ; rend le compteur des quatre événements après chacune
  async function allerRetour(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow)
    await new Promise((r) => setTimeout(r, 20))
    const lire = () => comp._shadow.querySelector('.n').textContent
    comp._set('vu', true)
    await attendre(() => !!comp._shadow.querySelector(sel))
    await attendre(() => lire() === '1/1/0/0')
    const entree = lire()
    comp._set('vu', false)
    await attendre(() => !comp._shadow.querySelector(sel))
    await attendre(() => lire() === '1/1/1/1')
    return { entree, sortie: lire(), parti: !comp._shadow.querySelector(sel) }
  }

  it('mouvement réduit : @in=*fly, @out=*fade — introstart, introend, outrostart, outroend partent', async () => {
    reduit = true
    const r = await allerRetour('mjs-calme-ev-vole', '.v')
    assert.deepEqual(r, { entree: '1/1/0/0', sortie: '1/1/1/1', parti: true })
  })

  it('mouvement réduit : @transition=*slide — les quatre événements partent', async () => {
    reduit = true
    const r = await allerRetour('mjs-calme-ev-glisse', '.s')
    assert.deepEqual(r, { entree: '1/1/0/0', sortie: '1/1/1/1', parti: true })
  })

  it('mouvement réduit : une transition créée par µanim.create — les quatre événements partent', async () => {
    reduit = true
    const r = await allerRetour('mjs-calme-ev-maison', '.m')
    assert.deepEqual(r, { entree: '1/1/0/0', sortie: '1/1/1/1', parti: true })
  })

  it('sans préférence : les mêmes événements partent (témoin)', async () => {
    reduit = false
    const vole = await allerRetour('mjs-calme-ev-vole', '.v')
    assert.deepEqual(vole, { entree: '1/1/0/0', sortie: '1/1/1/1', parti: true })
  })
})
