// une prop écrite en clair sur la balise (`<mjs-volet ouvert="true">`) ou par `mjs-props` est la valeur de DÉPART : le composant
// qui l'écrit ensuite (`$ouvert = false`) la garde quand sa ligne bouge dans un `{for … by id}` retourné, quand sa page revient du
// cache des pages (`µ.pageCache`, nœuds parqués puis remis) et quand une balise racine à `mjs-props` est déplacée. Défaut garanti
// absent : l'élément remis dans la page relisait l'attribut à sa reconnexion, la ligne déplacée rouvrait son volet.
// Une prop liée (`ouvert={$o}`) que le composant a écrite lui-même est gardée de même quand sa ligne bouge : le parent ne la réécrit que
// quand il en change la valeur. Formes qui restent comme avant : le parent qui change lui-même la prop, un attribut que le parent réécrit
// (`setAttribute`), une ligne recréée (et non déplacée), qui repart de la valeur écrite. Chromium et Firefox réels, développement
// et production (vrai build en un seul fichier, non minifié : le test appelle les noms internes du cache des pages)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const SOURCES: Record<string, string> = {
  'hote.mjs': `<script>
  $rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
  $o = true
</script>

<a href="/ailleurs">ailleurs</a>
<button class="retourner" @click={$rows = $rows.slice().reverse()}>r</button><button class="recreer" @click={$rows = [{ id: 4 }, { id: 5 }]}>n</button><button class="o0" @click={$o = false}>0</button><button class="o1" @click={$o = true}>1</button>
<ul class="a">{for r in $rows by id}<li><mjs-volet ouvert="true"></mjs-volet></li>{end}</ul>
<ul class="c">{for r in $rows by id}<li><mjs-volet ouvert={$o}></mjs-volet></li>{end}</ul>
`,
  'volet.mjs': `<script>
  $ouvert ?= false
</script>

<p class="v">{$ouvert ? 'oui' : 'non'}</p><button class="f" @click={$ouvert = false}>f</button>
`
}

// ce que la page relève à chaque étape : le volet de chaque ligne, « oui » (ouvert) ou « non »
async function scene() {
  const w: any     = window
  const pause      = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const zone: any  = document.getElementById('zone')
  const zone2: any = document.getElementById('zone2')
  const hote: any  = document.querySelector('mjs-hote')
  const ombre      = (x: any) => x._shadow || x.shadowRoot || x
  const volets     = (cls: string) => [...ombre(hote).querySelectorAll('ul.' + cls + ' mjs-volet')]
  const racines    = () => [...zone2.querySelectorAll('mjs-volet')]
  const lu         = (l: any[]) => l.map((v: any) => ombre(v).querySelector('p.v')?.textContent ?? '?').join(',')
  const prets      = (l: any[], n: number) => l.length === n && l.every((v: any) => /^(oui|non)$/.test(ombre(v).querySelector('p.v')?.textContent ?? ''))
  const clic       = async (x: any, sel: string) => {
    const b = ombre(x).querySelector(sel)
    if (!b) throw new Error(sel + ' absent : ' + ombre(x).innerHTML.slice(0, 700))
    b.click()
    await pause(80)
  }
  const fermer     = async (l: any[]) => { l.forEach((v: any) => ombre(v).querySelector('button.f').click()); await pause(80) }
  // départ comme la navigation : l'arbre est rangé dans le cache des pages, retiré, puis remis tel quel
  const aller      = async (z: any, chemin: string) => {
    w.µ._mjs_navHibernate(z, chemin)
    z.replaceChildren()
    await pause(60)
    const n = w.µ.pageCache.get(chemin)
    for (const x of n) x._mjs_page_cached = false
    z.append(...n)
    await pause(120)
  }
  const r: Record<string, string> = {}
  for (let i = 0; i < 150 && !(prets(volets('a'), 3) && prets(volets('c'), 3)); i++) await pause(20)
  r.depart = lu(volets('a')) + ' | ' + lu(volets('c'))
  await fermer([...volets('a'), ...volets('c')])
  r.fermes = lu(volets('a')) + ' | ' + lu(volets('c'))
  await clic(hote, 'button.retourner')
  await pause(70)
  r.retournee = lu(volets('a')) + ' | ' + lu(volets('c'))
  await clic(hote, 'button.o0')
  await clic(hote, 'button.o1')
  r.parentEcrit = lu(volets('c'))
  volets('a')[0].setAttribute('ouvert', 'true')
  await pause(80)
  r.attributReecrit = lu(volets('a'))
  await clic(hote, 'button.recreer')
  for (let i = 0; i < 100 && !prets(volets('a'), 2); i++) await pause(20)
  await pause(80)
  r.recreees = lu(volets('a')) + ' | ' + lu(volets('c'))
  await fermer(volets('a'))
  await aller(zone, '/accueil')
  r.cacheDesPages = lu(volets('a'))
  // balises racines à `mjs-props` (la forme du rendu serveur), déplacées puis rangées dans le cache des pages
  zone2.innerHTML = '<mjs-volet mjs-props=\'{"ouvert":true}\'></mjs-volet>'.repeat(3)
  for (let i = 0; i < 150 && !prets(racines(), 3); i++) await pause(20)
  r.propsDepart = lu(racines())
  await fermer(racines())
  racines().reverse().forEach((v: any) => zone2.append(v))
  await pause(120)
  r.propsDeplacees = lu(racines())
  await aller(zone2, '/autre')
  r.propsCache = lu(racines())
  return r
}

const ATTENDU = {
  depart:          'oui,oui,oui | oui,oui,oui',
  fermes:          'non,non,non | non,non,non',
  retournee:       'non,non,non | non,non,non',
  parentEcrit:     'oui,oui,oui',
  attributReecrit: 'oui,non,non',
  recreees:        'oui,oui | oui,oui',
  cacheDesPages:   'non,non',
  propsDepart:     'oui,oui,oui',
  propsDeplacees:  'non,non,non',
  propsCache:      'non,non,non'
}

describe('prop écrite par le composant : gardée quand sa ligne bouge, quand sa page revient du cache, à mjs-props', function () {
  this.timeout(240000)
  const scripts: Record<string, string> = {}

  before(async () => {
    for (const env of ['dev', 'prod'] as const) {
      const root   = mjsTmp('props-gardees-' + env)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
      const prod      = env === 'prod'
      const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js') }
      if (prod) Object.assign(opts, { env: 'prod', js: 'bundle', minify: false })
      const bundler = new Bundler(opts)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      if (prod) {
        scripts[env] = readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '') + '\nglobalThis.µ = µ;'
        continue
      }
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
      scripts[env] = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const moteur of ['chromium', 'firefox'] as const) {
    for (const env of ['dev', 'prod'] as const) {
      it(`${moteur}, ${env} : liste retournée, retour du cache des pages, mjs-props ; parent qui écrit, ligne recréée comme avant`, async function () {
        const playwright: any = await import('playwright')
        if (!existsSync(playwright[moteur].executablePath())) this.skip()
        const navigateur = await playwright[moteur].launch()
        try {
          const page    = await navigateur.newPage()
          const erreurs: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(e.message))
          await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="zone"><mjs-hote></mjs-hote></div><div id="zone2"></div><script>${scripts[env]}</script></body></html>`, { waitUntil: 'load' })
          const vu = await page.evaluate(scene)
          assert.deepEqual(erreurs, [])
          assert.deepEqual(vu, ATTENDU)
        } finally {
          await navigateur.close()
        }
      })
    }
  }
})
