// un composant seulement déplacé (`autreZone.append(el)` : retiré puis remis dans le même tour) garde ses références `:this=!{x}`,
// comme s'il n'avait pas bougé : chacune reste dans sa liste et chaque balise garde sa marque — celle d'une balise, celle d'un composant
// enfant (qui a ses propres références) et celle posée hors de tout bloc. Après le déplacement, un `{if}` qui retire ses balises remet
// leurs références à `null`, comme chez un témoin resté en place ; retiré ensuite pour de bon, le composant vide toutes ses références,
// après `µdestroy`, qui les lit encore. Défaut garanti absent : le déplacement vidait la liste et les marques sans un mot, le `{if}`
// laissait la référence sur la balise retirée, et le retrait final ne la vidait jamais. Ce que fait le déplacement de ses attaches et
// de ses effets : l'attache (`:attach`) est défaite puis refaite, l'effet (`*nom`) retiré puis reposé, le reffet (`µeffect`) nettoyé
// puis relancé, avec `µsleep` et `µawake`. Chromium, Firefox et WebKit réels ; développement et production (vrai build en un seul fichier, non minifié : le test lit
// la liste et les marques internes)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const SOURCES: Record<string, string> = {
  'fiche.mjs': `<script>
  el = null
  puce = null
  fixe = null
  $montre = true
  note = (quoi) -> window.__journal.push(quoi)
  etat = -> (if el then 'la' else 'vide') + '/' + (if puce then 'la' else 'vide') + '/' + (if fixe then 'la' else 'vide')
  @vu = -> etat()
  @cacher = -> $montre = false
  µeffect ->
    note('effet:' + $montre)
    -> note('fin-effet')
  µsleep -> note('sleep')
  µawake -> note('awake')
  µdestroy -> note('destroy:' + etat())
</script>

{if $montre}<b :this=!{el}>x</b><@puce :this=!{puce}></@puce>{end}
<span class="fixe" :this=!{fixe} :attach={(n) -> note('attache'); -> note('detache')} *tilt>y</span>
`,
  'puce.mjs': `<script>
  i = null
</script>
<i :this=!{i}>p</i>
`
}

// relevé de chaque étape : ce que lit le composant (balise du bloc / composant enfant du bloc / balise hors bloc), le nombre de
// références dans sa liste, le nombre de balises marquées dans son ombre, et le journal (trié quand plusieurs composants y écrivent)
async function scene() {
  const w: any     = window
  const pause      = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const zone: any  = document.getElementById('zone')
  const zone2: any = document.getElementById('zone2')
  const ombre      = (x: any) => x._shadow || x.shadowRoot || x
  const lire       = () => w.__journal.splice(0).join(' ')
  const lireTrie   = () => w.__journal.splice(0).sort().join(' ')
  const refs       = (x: any) => x._mjs_attachments ? [...x._mjs_attachments].filter((t: any) => t._mjs_ref).length : 0
  const marques    = (x: any) => [...ombre(x).querySelectorAll('*')].filter((e: any) => e._mjs_ref_td).length
  const releve     = (x: any) => [x.vu(), refs(x), marques(x)]
  // l'effet `*tilt` posé sur la balise hors bloc : sa poignée de retrait, neuve à chaque pose
  const effet      = (x: any) => { const c = ombre(x).querySelector('.fixe'); return c && c._mjs_fxOff ? c._mjs_fxOff.tilt : undefined }
  w.__journal = []
  zone.innerHTML = '<mjs-fiche></mjs-fiche><mjs-fiche></mjs-fiche><mjs-fiche></mjs-fiche>'
  const [d, t, e]: any[] = [...zone.querySelectorAll('mjs-fiche')]
  const pret = (x: any) => typeof x.vu === 'function' && x.vu() === 'la/la/la'
  for (let i = 0; i < 150 && !(pret(d) && pret(t) && pret(e)); i++) await pause(20)
  await pause(40)
  const r: Record<string, unknown> = {}
  const poignee = effet(d)
  r.avant = [releve(d), releve(t), releve(e), poignee ? 'pose' : 'absent']
  lire()
  // déplacé dans une autre zone : rien ne se perd
  zone2.append(d)
  await pause(60)
  const poignee2 = effet(d)
  r.deplace = [...releve(d), !poignee2 ? 'absent' : poignee2 === poignee ? 'garde' : 'repose', lire()]
  // le bloc se ferme : le déplacé vide ses références comme le témoin resté en place
  d.cacher()
  t.cacher()
  await pause(60)
  r.blocFerme = [releve(d), releve(t)]
  lire()
  // retirés pour de bon : tout se vide, après µdestroy
  d.remove()
  t.remove()
  await pause(60)
  r.retires = [releve(d), releve(t), lireTrie()]
  // un autre déplacé, retiré bloc ouvert
  zone2.append(e)
  await pause(60)
  r.deplace2 = releve(e)
  lire()
  e.remove()
  await pause(60)
  r.retire2 = [...releve(e), lire()]
  return r
}

const ATTENDU = {
  avant:     [['la/la/la', 3, 3], ['la/la/la', 3, 3], ['la/la/la', 3, 3], 'pose'],
  deplace:   ['la/la/la', 3, 3, 'repose', 'detache fin-effet sleep awake attache effet:true'],
  blocFerme: [['vide/vide/la', 1, 1], ['vide/vide/la', 1, 1]],
  retires:   [['vide/vide/vide', 0, 0], ['vide/vide/vide', 0, 0], 'destroy:vide/vide/la destroy:vide/vide/la detache detache fin-effet fin-effet sleep sleep'],
  deplace2:  ['la/la/la', 3, 3],
  retire2:   ['vide/vide/vide', 0, 0, 'detache fin-effet sleep destroy:la/la/la']
}

describe('composant seulement déplacé : ses références `:this` restent inscrites, un bloc qui retire leur balise les vide encore', function () {
  this.timeout(240000)
  const scripts: Record<string, string> = {}

  before(async () => {
    for (const env of ['dev', 'prod'] as const) {
      const root   = mjsTmp('deplace-refs-' + env)
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
      assert.equal(stats.errors.length, 0, stats.errors.map((x: any) => x.message).join('\n'))
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
      it(`${moteur}, ${env} : déplacé, bloc fermé, retiré ; un autre déplacé puis retiré bloc ouvert`, async function () {
        const playwright: any = await import('playwright')
        if (!existsSync(playwright[moteur].executablePath())) this.skip()
        const navigateur = await playwright[moteur].launch()
        try {
          const page = await navigateur.newPage()
          const erreurs: string[] = []
          page.on('pageerror', (x: any) => erreurs.push(x.message))
          page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text().slice(0, 200)) })
          await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="zone"></div><div id="zone2"></div><script>${scripts[env]}</script></body></html>`, { waitUntil: 'load' })
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
})
