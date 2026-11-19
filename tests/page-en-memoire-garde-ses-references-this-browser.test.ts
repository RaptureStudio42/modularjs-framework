// une page mise en mémoire par le cache des pages (départ vers une autre page) garde ses références `:this=!{x}` : ses minuteries
// continuent de tourner, et celle qui tire pendant ce temps trouve sa balise — la minuterie de réflexion d'un jeu (`µafter … always:
// true`, lancée juste avant le départ) joue son coup, la page revient avec le coup joué ; le tir d'un `µafter 0` posé dans `µmount`,
// page mise en mémoire avant lui, trouve aussi la sienne. Défaut garanti absent : les références étaient vidées au départ (la
// destruction était sautée, pas ce vidage), le tir ne trouvait rien, sans un mot, et la page revenait figée sur « reflechit ».
// Ce qui reste ou part d'une page en mémoire : l'attache (`:attach`) est défaite au départ (`µsleep` joue) et refaite au retour
// (`µawake`) ; une minuterie ordinaire tourne, celle posée avec `pause: true` attend le retour ; revenue, un `{if}` qui retire une balise
// référencée vide toujours sa référence (la marque de la balise lui est rendue avec la référence). La page qui quitte vraiment la mémoire
// (cache vidé, ou évincée par une page plus récente) est défaite comme une page retirée : le nettoyage de `µmount` et `µdestroy` lisent
// encore la référence, vidée ensuite, et ses minuteries s'arrêtent. Chromium, Firefox et WebKit réels, et happy-dom ; développement et
// production (vrai build en un seul fichier, non minifié : le test appelle les noms internes du cache des pages)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const SOURCES: Record<string, string> = {
  'dames.mjs': `<script>
  plateau = null
  pion = null
  $etat = 'attend'
  $montre = true
  note = (quoi) -> window.__journal.push(quoi)
  vu = (quoi) -> note(quoi + ':' + (if plateau then 'la' else 'vide'))
  @refLue = -> if plateau then 'la' else 'vide'
  @pionLu = -> if pion then 'la' else 'vide'
  @cacher = -> $montre = false
  @jouer = ->
    $etat = 'reflechit'
    µafter 300, always: true, ->
      vu('tir')
      if plateau
        plateau.dataset.coup = '1'
        $etat = 'joue'
  µmount ->
    vu('mount')
    µafter 0, ->
      vu('apres0')
      plateau?.classList.add('pret')
    µevery 40, -> window.__tics++
    µevery 40, pause: true, -> window.__ticsPause++
    -> vu('nettoyage')
  µsleep -> vu('sleep')
  µawake -> vu('awake')
  µdestroy -> vu('destroy')
</script>

<a href="/ailleurs">ailleurs</a>
<div class="plateau" :this=!{plateau} :attach={(el) -> note('attache'); -> note('detache')}>{$etat}</div>
{if $montre}<i class="pion" :this=!{pion}>p</i>{end}
`
}

// ce que la page relève à chaque étape : le journal du composant (chaque entrée lue avec la référence, « la » ou « vide »), son
// affichage, ses minuteries
async function scene() {
  const w: any    = window
  const pause     = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const zone: any = document.getElementById('zone')
  const ombre     = (x: any) => x._shadow || x.shadowRoot || x
  const plateau   = (x: any) => ombre(x).querySelector('.plateau')
  const lire      = () => w.__journal.splice(0).join(' ')
  // départ comme la navigation : l'arbre rangé dans le cache des pages, puis remplacé par la page suivante ; retour : remis tel quel
  const partir    = (chemin: string) => { w.µ._mjs_navHibernate(zone, chemin); zone.replaceChildren(document.createElement('p')) }
  const revenir   = async (chemin: string) => {
    const n = w.µ.pageCache.get(chemin)
    zone.replaceChildren()
    for (const x of n) x._mjs_page_cached = false
    zone.append(...n)
    await pause(120)
  }
  const monter    = async () => {
    zone.innerHTML = '<mjs-dames></mjs-dames>'
    const d = zone.querySelector('mjs-dames')
    for (let i = 0; i < 150 && !(plateau(d) && w.__journal.some((x: string) => x.startsWith('apres0'))); i++) await pause(20)
    return d
  }
  w.__journal   = []
  w.__tics      = 0
  w.__ticsPause = 0
  const r: Record<string, unknown> = {}
  // la minuterie de réflexion lancée, la page part aussitôt ; le tir arrive pendant qu'elle est en mémoire
  const d = await monter()
  r.monte = lire()
  d.jouer()
  partir('/dames')
  const t0 = w.__tics, p0 = w.__ticsPause
  await pause(450)
  r.enMemoire     = lire()
  r.ticsEnMemoire = [w.__tics > t0, w.__ticsPause === p0]
  await revenir('/dames')
  r.retour = lire()
  r.ecran  = [plateau(d).textContent, plateau(d).dataset.coup ?? '-', d.refLue()]
  const p1 = w.__ticsPause
  await pause(150)
  r.ticsPauseRepris = w.__ticsPause > p1
  // revenue du cache, un bloc qui retire une balise référencée vide toujours sa référence
  const pionAvant = d.pionLu()
  d.cacher()
  await pause(80)
  r.pionRetire = [pionAvant, d.pionLu()]
  // cache vidé : la page quitte la mémoire pour de bon
  partir('/dames')
  await pause(80)
  r.departBis    = lire()
  r.refEnMemoire = d.refLue()
  w.µ.pageCache.clear()
  await pause(80)
  r.cacheVide     = lire()
  r.refApresCache = d.refLue()
  const t1 = w.__tics
  await pause(150)
  r.ticsArretes = w.__tics === t1
  // `µafter 0` posé dans `µmount` : la page part après le µmount, avant le tir (même tâche)
  zone.innerHTML = '<mjs-dames></mjs-dames>'
  const d2: any = zone.querySelector('mjs-dames')
  for (let i = 0; i < 2000 && !w.__journal.some((x: string) => x.startsWith('mount')); i++) await Promise.resolve()
  r.montageAvantTir = w.__journal.some((x: string) => x.startsWith('mount')) && !w.__journal.some((x: string) => x.startsWith('apres0'))
  partir('/dames2')
  await pause(80)
  r.apres0 = lire()
  await revenir('/dames2')
  r.retour2 = [lire(), plateau(d2).classList.contains('pret')]
  // évincée par des pages plus récentes
  partir('/dames2')
  await pause(80)
  lire()
  for (let i = 0; i < w.µ.pageCache.maxSize; i++) w.µ.pageCache.set('/autre' + i, [])
  await pause(80)
  r.evincee = [lire(), d2.refLue()]
  return r
}

// `µawake` joue à chaque connexion, avant le rendu : au premier montage, la référence n'est pas encore posée
const ATTENDU = {
  monte:           'awake:vide attache mount:la apres0:la',
  enMemoire:       'detache sleep:la tir:la',
  ticsEnMemoire:   [true, true],
  retour:          'awake:la attache',
  ecran:           ['joue', '1', 'la'],
  ticsPauseRepris: true,
  pionRetire:      ['la', 'vide'],
  departBis:       'detache sleep:la',
  refEnMemoire:    'la',
  cacheVide:       'nettoyage:la destroy:la',
  refApresCache:   'vide',
  ticsArretes:     true,
  montageAvantTir: true,
  apres0:          'awake:vide attache mount:la detache sleep:la apres0:la',
  retour2:         ['awake:la attache', true],
  evincee:         ['nettoyage:la destroy:la', 'vide']
}

describe('page mise en mémoire par le cache des pages : ses références `:this` restent, ses minuteries les trouvent', function () {
  this.timeout(240000)
  const scripts: Record<string, string> = {}

  before(async () => {
    for (const env of ['dev', 'prod'] as const) {
      const root   = mjsTmp('page-memoire-' + env)
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

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    for (const env of ['dev', 'prod'] as const) {
      it(`${moteur}, ${env} : départ, tir en mémoire, retour, cache vidé, µafter 0 du µmount, page évincée`, async function () {
        const playwright: any = await import('playwright')
        if (!existsSync(playwright[moteur].executablePath())) this.skip()
        const navigateur = await playwright[moteur].launch()
        try {
          const page    = await navigateur.newPage()
          const erreurs: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(e.message))
          page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text().slice(0, 200)) })
          await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="zone"></div><script>${scripts[env]}</script></body></html>`, { waitUntil: 'load' })
          const vu = await page.evaluate(scene)
          assert.deepEqual(vu, ATTENDU)
          assert.deepEqual(erreurs, [])
        }
        finally {
          await navigateur.close()
        }
      })
    }
  }

  for (const env of ['dev', 'prod'] as const) {
    it(`happy-dom, ${env} : le même parcours`, async () => {
      const window: any = new Window({ url: 'http://localhost/' })
      try {
        window.document.body.innerHTML = '<div id="zone"></div>'
        window.eval(scripts[env])
        // l'objet rendu vient du royaume de la fenêtre (autre prototype) : comparé par sa copie
        const vu = JSON.parse(JSON.stringify(await window.eval(`(${scene.toString()})()`)))
        assert.deepEqual(vu, ATTENDU)
      }
      finally {
        await window.happyDOM?.close?.()
      }
    })
  }
})
