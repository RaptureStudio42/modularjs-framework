// Un prototype pollué (`Object.prototype.nom = …`) ne doit pas devenir, par les réglages d'un effet, une valeur CSS ou un
// texte de la page. Les réglages arrivent aux effets dans un objet sans prototype ; certains effets les recopiaient dans un
// objet ordinaire, où un réglage que la page n'a pas écrit se lisait sur le prototype : *fly posé ou au survol (la
// distance), à la pose et quand un réglage tenu par une variable change, *count quand son suffixe change (le préfixe),
// *filter (une ombre portée), et un effet de l'appli joué en entrée ou en sortie, dont les images et les options passées
// à l'animation laissaient le navigateur lire `composite` ou `iterations` sur le prototype
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const FICHIERS: Record<string, string> = {
  'app.effects.mjs': '<effects>\n  *halo(color: #0ff, size: 12px) =\n    box-shadow: 0 0 $size $color\n</effects>\n',
  'reglages.mjs': `<script>
$d = '300ms'
$dh = '300ms'
$u = ' points'
$vu = false
</script>
<p class="d" *fly(duration: $d, once: false)>posé</p>
<div class="carte"><p class="h" *fly(on: hover, duration: $dh)>survol</p></div>
<p class="n" *count(on: load, duration: 0, suffix: $u)>42</p>
<p class="f" *filter>filtre</p>
{if $vu}<p class="v" @in=*halo @out=*halo(size: 20px)>vie</p>{end}
<button class="lent" @click={$d = '900ms'}>l</button>
<button class="lent-survol" @click={$dh = '900ms'}>ls</button>
<button class="pts" @click={$u = ' pts'}>p</button>
<button class="montrer" @click={$vu = true}>m</button>
<button class="cacher" @click={$vu = false}>c</button>
`,
}

const CLES: Record<string, any> = { distance: '900px', prefix: 'PIEGE ', shadow: '0 0 7px #123456', iterations: 7, composite: 'add' }

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root = mjsTmp(prefixe), srcDir = join(root, 'src'), outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(FICHIERS)) writeFileSync(join(srcDir, nom), src)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function attendre(cond: () => boolean, ms = 4000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await pause(10)
}
// les translations des images d'une animation, en texte
const translations = (a: any) => a.keyframes.map((k: any) => String(k.transform || '')).join(' | ')

describe('prototype pollué : les effets qui recopient leurs réglages ne lisent que les clés propres', function () {
  this.timeout(180000)
  const builds: Record<string, string> = {}
  before(async function () {
    this.timeout(240000)
    builds.developpement = await construire('reglages-recopies-dev', false)
    builds.production = await construire('reglages-recopies-prod', true)
  })
  after(async () => { await terminateSharedWorkerPool() })

  for (const mode of ['developpement', 'production']) {
    describe(mode, function () {
      let window: any
      let comp: any
      const anims: any[] = []
      const de = (el: any) => anims.filter((a) => a.el === el)

      before(async () => {
        window = new Window({ url: 'http://localhost/' })
        window.Element.prototype.animate = function (keyframes: any, opts: any) {
          let fin: any
          const a: any = { el: this, keyframes, opts, finished: new Promise((r) => { fin = r }), cancel() { fin(a) }, pause() {}, play() {}, finish() { fin(a) }, effect: { getComputedTiming: () => ({ progress: 1 }) } }
          anims.push(a)
          setTimeout(() => fin(a), 5)
          return a
        }
        // un observateur piloté par le test : la balise posée attend l'écran, tenue cachée, jusqu'à ce qu'on la montre
        window.__io = []
        window.IntersectionObserver = class { cb: any; els: any[] = []; constructor(cb: any) { this.cb = cb; window.__io.push(this) } observe(el: any) { this.els.push(el) } unobserve(el: any) { this.els = this.els.filter((e) => e !== el) } disconnect() { this.els = [] } }
        window.eval(builds[mode])
        window.eval(Object.keys(CLES).map((k) => `Object.prototype[${JSON.stringify(k)}] = ${JSON.stringify(CLES[k])};`).join('\n'))
        window.document.body.innerHTML = '<mjs-reglages></mjs-reglages>'
        comp = window.document.querySelector('mjs-reglages')
        await attendre(() => !!comp._shadow?.querySelector('.f') && window.__io.some((io: any) => io.els.includes(comp._shadow.querySelector('.d'))))
      })
      after(async () => {
        window.eval(Object.keys(CLES).map((k) => `delete Object.prototype[${JSON.stringify(k)}];`).join('\n'))
        await window.happyDOM.close()
      })

      it('*fly posé : aucune distance héritée, à l\'entrée puis après un réglage changé', async () => {
        const d = comp._shadow.querySelector('.d')
        const voir = (oui: boolean) => { for (const io of window.__io) if (io.els.includes(d)) io.cb([{ target: d, isIntersecting: oui, intersectionRatio: oui ? 1 : 0 }]) }
        const bouge = (l: any[]) => l.filter((a) => /translate/.test(translations(a)))
        let avant = de(d).length
        voir(true)
        await attendre(() => bouge(de(d).slice(avant)).length > 0)
        const entrees = bouge(de(d).slice(avant))
        assert.ok(entrees.length > 0, 'l\'entrée joue à l\'écran')
        for (const a of entrees) assert.equal(/900px/.test(translations(a)), false, 'à l\'entrée : ' + translations(a))
        await pause(60)
        // la balise, l'effet et ses réglages retenus ne sont lisibles qu'en développement (noms raccourcis en production)
        const off = mode === 'developpement' ? d._mjs_fxOff.fly : null
        comp._shadow.querySelector('.lent').click()
        await pause(60)
        if (off) {
          assert.equal(d._mjs_fxOff.fly, off, 'le réglage changé est pris sur place, sans reposer l\'effet')
          assert.equal(d._mjs_fxOff.fly._s.duration, '900ms')
        }
        voir(false)
        await pause(150)
        avant = de(d).length
        voir(true)
        await attendre(() => bouge(de(d).slice(avant)).length > 0)
        const reprises = bouge(de(d).slice(avant))
        assert.ok(reprises.length > 0, 'l\'entrée rejoue à l\'écran')
        for (const a of reprises) assert.equal(/900px/.test(translations(a)), false, 'après le réglage changé : ' + translations(a))
      })

      it('*fly au survol : aucune distance héritée, à la pose puis après un réglage changé', async () => {
        const h = comp._shadow.querySelector('.h')
        const carte = comp._shadow.querySelector('.carte')
        carte.dispatchEvent(new window.Event('pointerenter'))
        await attendre(() => de(h).length > 0)
        assert.ok(de(h).length > 0, 'l\'entrée joue au survol')
        for (const a of de(h)) assert.equal(/900px/.test(translations(a)), false, 'au survol : ' + translations(a))
        carte.dispatchEvent(new window.Event('pointerleave'))
        await pause(40)
        const off = mode === 'developpement' ? h._mjs_fxOff.fly : null
        comp._shadow.querySelector('.lent-survol').click()
        await pause(40)
        if (off) {
          assert.equal(h._mjs_fxOff.fly, off, 'le réglage changé est pris sur place, sans reposer l\'effet')
          assert.equal(h._mjs_fxOff.fly._s.duration, '900ms')
        }
        const avant = de(h).length
        carte.dispatchEvent(new window.Event('pointerenter'))
        await attendre(() => de(h).length > avant)
        const apres = de(h).slice(avant)
        assert.ok(apres.length > 0, 'l\'entrée rejoue au survol suivant')
        for (const a of apres) assert.equal(/900px/.test(translations(a)), false, 'après le réglage changé : ' + translations(a))
      })

      it('*count : le suffixe changé n\'ajoute aucun préfixe hérité', async () => {
        const n = comp._shadow.querySelector('.n')
        await attendre(() => /points/.test(n.textContent))
        assert.equal(n.textContent.includes('PIEGE'), false, 'à la pose : ' + n.textContent)
        comp._shadow.querySelector('.pts').click()
        await attendre(() => /pts$/.test(n.textContent))
        assert.match(n.textContent, /42 pts$/)
        assert.equal(n.textContent.includes('PIEGE'), false, 'après le suffixe changé : ' + n.textContent)
      })

      it('*filter : aucune ombre héritée dans la valeur du filtre', async () => {
        const f = comp._shadow.querySelector('.f')
        await attendre(() => f.style.getPropertyValue('--mjs-fx-filter-value') !== '')
        const valeur = f.style.getPropertyValue('--mjs-fx-filter-value')
        assert.notEqual(valeur, '', 'le filtre est posé')
        assert.equal(/123456|drop-shadow/.test(valeur), false, valeur)
      })

      it('effet de l\'appli en entrée et en sortie : ni image ni option héritée', async () => {
        comp._shadow.querySelector('.montrer').click()
        await attendre(() => !!comp._shadow.querySelector('.v') && de(comp._shadow.querySelector('.v')).length > 0)
        const v = comp._shadow.querySelector('.v')
        const entree = de(v)[0]
        assert.ok(entree, 'l\'entrée joue')
        assert.equal(entree.keyframes[0].composite, undefined, 'image de l\'entrée')
        assert.equal(entree.opts.iterations, undefined, 'options de l\'entrée')
        comp._shadow.querySelector('.cacher').click()
        await attendre(() => de(v).some((a) => a.keyframes[0] && a.keyframes[0].offset === 1))
        const sortie = de(v).find((a) => a.keyframes[0] && a.keyframes[0].offset === 1)
        assert.ok(sortie, 'la sortie joue')
        assert.equal(sortie.keyframes[0].boxShadow, '0 0 20px #0ff', 'l\'état de sortie est celui de l\'effet')
        assert.equal(sortie.keyframes[0].composite, undefined, 'image de la sortie')
        assert.equal(sortie.opts.iterations, undefined, 'options de la sortie')
      })
    })
  }
})
