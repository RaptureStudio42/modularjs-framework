// une ligne de `{for}` ou une branche de `{if}` remise pendant sa sortie, quand sa propre sortie ne joue plus ou se joue hors du moteur
// des transitions. Sortie de la balise déjà finie (`tick`, `*fade`) alors qu'une sortie intérieure plus longue la retient encore
// (`.global`, `:childtransition`) : la balise revient visible, sa sortie repart à rebours depuis sa fin, sans saut ; avec une entrée
// (`:transition`, `:in`), celle-ci part de l'état où la sortie l'a laissée et remonte image par image, jamais invisible jusqu'au bout
// pour se montrer d'un coup. Transition de
// `µanim.create` à fonctions `intro` / `outro` (sur la ligne ou sur une balise intérieure `.global`), `*crossfade`, effet qui se joue une
// fois : rien ne sait la ramener, la ligne est refaite, neuve et visible, sans double. Entrée d'un effet CSS de l'appli (`@keyframes`) après une sortie du catalogue : elle part
// de la position de la sortie, pas de son début. Ligne en `*pixelate` finie avant sa balise .global, puis retirée pour de bon : la
// transition ne laisse rien sur la balise. L'opacité est relevée à chaque image, le retour fait à mi-sortie de la plus longue.
// Développement, production, production en `"proxy": false` ; Chromium, Firefox et WebKit
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const F      = (d: number) => `*fade(duration: ${d}ms)`
const SCRIPT = (plus = '') => `<script>
  $l     = []
  $v     = true
  @poser = (l) -> $l = l
  @voir  = (v) -> $v = v
${plus}</script>
`
const PRET   = '\n<p class="pret">prêt</p>\n'
const LISTE  = (li: string, attrs = 'class="l"') => `<ul ${attrs}>{for r in $l by id}${li}{end}</ul>`
const TIC    = (nom: string) => `  µanim.create '${nom}', (node) ->\n    duration: 150\n    tick: (t) -> node.style.opacity = String(t)\n`
const ASYM   = (nom: string, fill: string) => `  µanim.create '${nom}',\n    intro: (node) -> node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900 }).finished\n    outro: (node) -> node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900${fill} }).finished\n`
const LONGUE = `<span class="s" :out.global=${F(900)}>s</span>`
const SOURCES: Record<string, string> = {
  'sf.effects.mjs': '<effects>\n  *sfclef(o: 0) =\n    @keyframes\n      from\n        opacity: $o\n      to\n        opacity: 1\n</effects>\n',
  'sf-tic.mjs': SCRIPT(TIC('sftic')) + LISTE(`<li :out=*sftic><b>{r.id}</b>${LONGUE}</li>`) + PRET,
  'sf-fondu.mjs': SCRIPT() + LISTE(`<li :out=${F(150)}><b>{r.id}</b>${LONGUE}</li>`) + PRET,
  'sf-si-tic.mjs': SCRIPT(TIC('sfsitic')) + `{if $v}<p class="p" :out=*sfsitic><b>2</b>${LONGUE}</p>{end}` + PRET,
  'sf-si-fondu.mjs': SCRIPT() + `{if $v}<p class="p" :out=${F(150)}><b>2</b>${LONGUE}</p>{end}` + PRET,
  'sf-enfants.mjs': SCRIPT() + LISTE(`<li :out=${F(150)}><b>{r.id}</b><span class="s" :out=${F(900)}>s</span></li>`, 'class="l" :childtransition="all"') + PRET,
  'sf-tr.mjs': SCRIPT() + LISTE(`<li :transition=${F(150)}><b>{r.id}</b>${LONGUE}</li>`) + PRET,
  'sf-in.mjs': SCRIPT() + LISTE(`<li :in=${F(300)} :out=${F(150)}><b>{r.id}</b>${LONGUE}</li>`) + PRET,
  'sf-si-tr.mjs': SCRIPT() + `{if $v}<p class="p" :transition=${F(150)}><b>2</b>${LONGUE}</p>{end}` + PRET,
  'sf-tr-echelle.mjs': SCRIPT() + LISTE(`<li :transition=*scale(duration: 150ms)><b>{r.id}</b>${LONGUE}</li>`) + PRET,
  'sf-tr-enfants.mjs': SCRIPT() + LISTE(`<li :transition=${F(150)}><b>{r.id}</b><span class="s" :out=${F(900)}>s</span></li>`, 'class="l" :childtransition="all"') + PRET,
  'sf-tr-tic.mjs': SCRIPT(TIC('sftrtic')) + LISTE(`<li :transition=*sftrtic><b>{r.id}</b>${LONGUE}</li>`) + PRET,
  'sf-pixel.mjs': SCRIPT() + LISTE(`<li :out=*pixelate(duration: 150ms)><b>{r.id}</b>${LONGUE}</li>`) + PRET,
  'sf-asym.mjs': SCRIPT(ASYM('sfasym', ", fill: 'forwards'")) + LISTE('<li :out=*sfasym><b>{r.id}</b></li>') + PRET,
  'sf-asym-nu.mjs': SCRIPT(ASYM('sfasymnu', '')) + LISTE('<li :out=*sfasymnu><b>{r.id}</b></li>') + PRET,
  'sf-asym-tr.mjs': SCRIPT(ASYM('sfasymtr', ", fill: 'forwards'")) + LISTE('<li :transition=*sfasymtr><b>{r.id}</b></li>') + PRET,
  'sf-asym-int.mjs': SCRIPT(ASYM('sfasymint', ", fill: 'forwards'")) + LISTE(`<li :out=${F(900)}><b>{r.id}</b><span class="s" :out.global=*sfasymint>s</span></li>`) + PRET,
  'sf-joue.mjs': SCRIPT() + LISTE('<li :out=*shake><b>{r.id}</b></li>') + PRET,
  'sf-croise.mjs': SCRIPT() + LISTE('<li :out=*crossfade(key: r.id)><b>{r.id}</b></li>') + PRET,
  'sf-entree-appli.mjs': SCRIPT() + LISTE(`<li :in=*sfclef(duration: 900ms, easing: linear) :out=${F(900)}><b>{r.id}</b></li>`) + PRET
}

// chaque cas sur sa propre balise, tous joués ensemble dans la même page. `si` : un `{if}` plutôt qu'une ligne de `{for}` ; `cible` :
// la balise intérieure suivie plutôt que la ligne ; `courte` : la sortie suivie dure 150 ms, finie au retour, et le retour autant sauf
// `duree` ; `refaite` : la ligne
// revient neuve ; `entree` : la ligne attend la fin de son entrée avant d'être retirée
type Cas = { balise: string, si?: boolean, cible?: string, courte?: boolean, duree?: number, refaite?: boolean, entree?: boolean }
const CAS: Record<string, Cas> = {
  'ligne en tick, finie avant sa balise .global': { balise: 'sf-tic', courte: true },
  'ligne en *fade, finie avant sa balise .global': { balise: 'sf-fondu', courte: true },
  '{if} en tick, fini avant sa balise .global': { balise: 'sf-si-tic', si: true, courte: true },
  '{if} en *fade, fini avant sa balise .global': { balise: 'sf-si-fondu', si: true, courte: true },
  'ligne finie avant ses balises :childtransition': { balise: 'sf-enfants', courte: true },
  'ligne en :transition *fade, finie avant sa balise .global': { balise: 'sf-tr', courte: true },
  'ligne :in et :out du moteur, finie avant sa balise .global': { balise: 'sf-in', courte: true, duree: 300 },
  '{if} en :transition, fini avant sa balise .global': { balise: 'sf-si-tr', si: true, courte: true },
  'ligne en :transition *scale, finie avant sa balise .global': { balise: 'sf-tr-echelle', courte: true },
  'ligne en :transition, finie avant ses balises :childtransition': { balise: 'sf-tr-enfants', courte: true },
  'ligne en :transition tick, finie avant sa balise .global': { balise: 'sf-tr-tic', courte: true },
  'ligne µanim.create intro / outro en :out, fill forwards': { balise: 'sf-asym', refaite: true },
  'ligne µanim.create intro / outro en :out, sans fill': { balise: 'sf-asym-nu', refaite: true },
  'ligne µanim.create intro / outro en :transition': { balise: 'sf-asym-tr', refaite: true },
  'balise interieure .global en µanim.create intro / outro': { balise: 'sf-asym-int', cible: '.s', refaite: true },
  'ligne en :out d un effet qui se joue une fois (*shake)': { balise: 'sf-joue', refaite: true },
  'ligne en :out *crossfade': { balise: 'sf-croise', refaite: true },
  'ligne :in effet de l appli a @keyframes, :out *fade': { balise: 'sf-entree-appli', entree: true }
}

const MODES = [{ nom: 'développement', prod: false, proxy: true }, { nom: 'production', prod: true, proxy: true }, { nom: 'production, "proxy": false', prod: true, proxy: false }]
const enveloppe = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}</body></html>`
const CORPS     = Object.entries(CAS).map(([nom, c]) => `<mjs-${c.balise} data-cas="${nom}"></mjs-${c.balise}>`).join('') + '<mjs-sf-pixel data-cas="*pixelate"></mjs-sf-pixel>'

async function construire(prod: boolean, proxy: boolean): Promise<Cible> {
  const root   = mjsTmp('sf-' + (prod ? 'prod' : 'dev') + (proxy ? '' : '-sans-proxy'))
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), source)
  const base: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js') }
  if (prod) Object.assign(base, { env: 'prod', js: 'bundle', urlPrefix: '/out' })
  if (!proxy) base.proxy = false
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

// joué dans la page : chaque relevé dans une image, le geste du retour aussi, juste après le relevé qui le précède
async function jouer(arg: any): Promise<any> {
  const nom      = arg[0]
  const c        = arg[1]
  const pause    = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const image    = () => new Promise<number>((r) => requestAnimationFrame(r))
  const el       = document.querySelector('[data-cas="' + nom + '"]') as any
  const om       = el._shadow
  const objets   = {} as any
  const liste    = (ids: number[]) => ids.map((i) => objets[i] || (objets[i] = { id: i }))
  const balises  = (): any[] => Array.from(om.querySelectorAll(c.si ? 'p.p' : 'ul.l > li')).filter((n: any) => n.querySelector('b').textContent === '2')
  const op       = (n: any) => n && n.isConnected ? Math.round(Number(getComputedStyle(n).opacity) * 1000) / 1000 : -1
  const cible    = (n: any) => n && c.cible ? n.querySelector(c.cible) : n
  const retirer  = () => c.si ? el.voir(false) : el.poser(liste([1, 3]))
  const remettre = () => c.si ? el.voir(true) : el.poser(liste([1, 2, 3]))
  if (!c.si) el.poser(liste([1, 2, 3]))
  await pause(c.entree ? 1100 : 400)
  const b0   = balises()[0]
  const traj = [] as any[]
  const t0   = performance.now()
  let tRet   = -1
  retirer()
  // une image, un relevé : [temps, opacité de la balise suivie, balises de la clé] ; à mi-sortie de la plus longue, le geste dans la même image
  while (performance.now() - t0 < 1400) {
    // l'heure de l'image, celle que les animations lisent : un relevé fait tard dans l'image ne fausse pas l'écart au suivant
    const t = (await image()) - t0
    traj.push([Math.round(t), op(cible(b0)), balises().length])
    if (tRet < 0 && t >= 450) {
      tRet = t
      remettre()
    }
  }
  await pause(300)
  // machine chargée : jusqu'à 3 s de plus pour que les animations de la balise finissent ; une animation restée pour de bon se voit encore
  for (let i = 0; i < 30 && balises().some((n: any) => n.getAnimations({ subtree: true }).length); i++) await pause(100)
  const fin = balises()
  return { tRet: Math.round(tRet), traj, fin: fin.length + ' balise, ' + (fin[0] === b0 ? 'la meme' : 'une autre') + ', opacite ' + op(cible(fin[0])) + ' / ' + op(fin[0]) + ', animations ' + (fin[0] ? fin[0].getAnimations({ subtree: true }).length : -1) }
}

// joué dans la page : ligne en `*pixelate`, sortie finie avant sa balise .global, retirée pour de bon ; la libération de la transition
// rend à la balise son style d'avant (aucun), au plus tard avec son retrait
async function pixel(): Promise<string> {
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const el    = document.querySelector('mjs-sf-pixel') as any
  el.poser([{ id: 1 }, { id: 2 }])
  await pause(400)
  const li = Array.from(el._shadow.querySelectorAll('ul.l > li')).find((n: any) => n.querySelector('b').textContent === '2') as any
  el.poser([{ id: 1 }])
  await pause(1300)
  return (li.isConnected ? 'encore la' : 'retiree') + ', style ' + li.getAttribute('style')
}

// le premier écart à la valeur du geste (relevée dans l'image du geste, juste avant lui) plus grand que ce que la durée écoulée depuis
// permet : 3 fois la pente moyenne de la transition suivie et 0,1 de marge. Une sortie finie qui revient d'un coup fait 1 dès l'image
// suivante ; une entrée qui repart de son début, 0,5
function saut(traj: any[], depuis: number, duree: number): string {
  const geste = traj.find((y) => y[0] >= depuis)
  if (!geste || geste[1] < 0) return 'aucun releve au geste'
  const [t0, o0] = geste
  for (const [t, o] of traj) {
    if (t <= t0 || o < 0) continue
    if (Math.abs(o - o0) > (t - t0) / duree * 3 + 0.1) return `saut de ${o0} a ${o} en ${Math.round(t - t0)} ms apres le geste`
  }
  return 'aucun'
}

// invisible tout du long : opacité sous 0,05 à chaque image des neuf premiers dixièmes du retour suivi, qu'une entrée de 0 à 1 quitte
// dès ses premières images, même partie une ou deux images en retard ; deux images au moins après le geste (une seule, relevée avant que
// l'animation n'écrive la sienne, ne prouve rien). Une balise invisible pendant toute son entrée puis montrée d'un coup à sa fin, ce que
// `saut` ne voit plus quand c'est tard
function invisible(traj: any[], depuis: number, duree: number): string {
  const vus = traj.filter((y) => y[0] > depuis && y[0] <= depuis + duree * 0.9 && y[1] >= 0)
  return vus.length > 1 && vus.every((y) => y[1] < 0.05) ? `sous 0,05 a chaque image jusqu a ${vus[vus.length - 1][0] - depuis} ms apres le geste` : 'jamais'
}

// ce que la page a montré, en mots : comparé tel quel à ce qui est attendu
function resumer(c: Cas, r: any): Record<string, string> {
  const apres  = r.traj.filter((y: any) => y[0] >= r.tRet)
  const double = Math.max(...r.traj.map((y: any) => y[2]))
  let haut     = -1
  let sens     = 'remonte sans redescendre'
  for (const [t, o] of apres) {
    if (o < 0) break
    if (o < haut - 0.03) { sens = `redescend de ${haut} a ${o}, ${t - r.tRet} ms apres le retour`; break }
    haut = Math.max(haut, o)
  }
  if (c.refaite) return { double: double > 1 ? double + ' balises' : 'non', fin: r.fin }
  const duree = c.duree ?? (c.courte ? 150 : 900)
  return { saut: saut(r.traj, r.tRet, duree), invisible: invisible(r.traj, r.tRet, duree), sens, double: double > 1 ? double + ' balises' : 'non', fin: r.fin }
}

function attendu(c: Cas): Record<string, string> {
  if (c.refaite) return { double: 'non', fin: '1 balise, une autre, opacite 1 / 1, animations 0' }
  return { saut: 'aucun', invisible: 'jamais', sens: 'remonte sans redescendre', double: 'non', fin: '1 balise, la meme, opacite 1 / 1, animations 0' }
}

const NAVIGATEURS = (process.env.SF_NAVS || 'chromium,firefox,webkit').split(',')
const cibles      = new Map<string, Promise<Cible>>()
const cible       = (prod: boolean, proxy: boolean) => {
  const k = prod + '-' + proxy
  if (!cibles.has(k)) cibles.set(k, construire(prod, proxy))
  return cibles.get(k) as Promise<Cible>
}
const PRET_JS = `Array.from(document.querySelectorAll('[data-cas]')).every((e) => !!(e._shadow && e._shadow.querySelector('.pret')))`

for (const nav of NAVIGATEURS) describe(`balise remise après la fin de sa propre sortie, ou pendant une sortie menée hors du moteur (${nav})`, function () {
  this.timeout(150000)
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
  for (const m of MODES) it(`${m.nom} : sortie finie, µanim.create à intro / outro, entrée d'un effet de l'appli`, async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(m.prod, m.proxy), 'mjs-sf-tic')
    try {
      await o.page.waitForFunction(PRET_JS, null, { timeout: 15000 })
      await o.page.waitForTimeout(300)
      const obtenu: Record<string, unknown> = {}
      const voulu: Record<string, unknown>  = {}
      await Promise.all(Object.entries(CAS).map(async ([nom, c]) => {
        const r     = await o.page.evaluate(jouer, [nom, c])
        obtenu[nom] = resumer(c, r)
        voulu[nom]  = attendu(c)
      }))
      obtenu['*pixelate finie avant sa balise .global, retiree'] = await o.page.evaluate(pixel)
      voulu['*pixelate finie avant sa balise .global, retiree']  = 'retiree, style null'
      assert.deepEqual(obtenu, voulu)
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally { await o.fermer() }
  })
})
