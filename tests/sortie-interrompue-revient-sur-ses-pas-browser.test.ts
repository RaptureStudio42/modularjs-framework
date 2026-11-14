// une balise retirée joue sa sortie ; remise pendant cette sortie (ligne de `{for}`, branche de `{if}`), sa sortie revient sur ses pas,
// depuis là où elle en est, pour toutes les formes de transition : du catalogue (`*fade`, un alias du fichier d'effets), créée par
// `µanim.create` (fonction, objet, `tick`), effet CSS de l'appli (déclarations, `@keyframes`), sur la balise elle-même ou sur une balise
// intérieure `.global`. L'opacité est relevée à chaque image (`requestAnimationFrame`), le retour fait à mi-sortie : depuis le retour,
// aucun saut d'une image à la suivante plus grand que ce que la durée écoulée permet (ni reprise au début, ni saut directement à la fin),
// aucune descente, puis la balise d'avant, seule, opaque, sans animation qui traîne. Remise puis retirée de nouveau une microtâche plus tard, la balise finit sa sortie
// depuis là où elle en est, sans disparaître d'un coup. Évènements du retour comme le `{if}` et Svelte : `@introstart` et `@introend`
// une fois chacun quand la balise a une entrée, aucun pour une sortie seule ; `@outroend` jamais pour la sortie interrompue.
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

const DUREE  = 900
const F      = (d: number) => `*fade(duration: ${d}ms)`
const SCRIPT = (plus = '') => `<script>
  $l     = []
  $v     = true
  @poser = (l) -> $l = l
  @voir  = (v) -> $v = v
  @ev    = (n) ->
    w    = (window.__sr ||= {})
    w[n] = (w[n] ?? 0) + 1
${plus}</script>
`
const PRET  = '\n<p class="pret">prêt</p>\n'
const LISTE = (li: string) => `<ul class="l">{for r in $l by id}${li}{end}</ul>`
const CREE  = (nom: string, corps: string) => `  µanim.create '${nom}', (node) ->\n    duration: ${DUREE}\n    ${corps}\n`
const EVS   = (p: string, cle: string) => `@introstart={@ev('${p}-is'${cle})} @introend={@ev('${p}-ie'${cle})} @outrostart={@ev('${p}-os'${cle})} @outroend={@ev('${p}-oe'${cle})}`
const SOURCES: Record<string, string> = {
  'sr.effects.mjs': '<effects>\n  *srsort(o: 0) =\n    opacity: $o\n  *srclef(o: 0) =\n    @keyframes\n      from\n        opacity: $o\n      to\n        opacity: 1\n  *srfondu = *fade(duration: 900ms)\n</effects>\n',
  'sr-fondu.mjs': SCRIPT() + LISTE(`<li :out=${F(DUREE)}><b>{r.id}</b></li>`) + PRET,
  'sr-fonction.mjs': SCRIPT(CREE('srfonction', 'css: (t) -> { opacity: t }')) + LISTE('<li :out=*srfonction><b>{r.id}</b></li>') + PRET,
  'sr-objet.mjs': SCRIPT(`  µanim.create 'srobjet',\n    duration: ${DUREE}\n    css: (t) -> { opacity: t }\n`) + LISTE('<li :out=*srobjet><b>{r.id}</b></li>') + PRET,
  'sr-image.mjs': SCRIPT(CREE('srimage', 'tick: (t) -> node.style.opacity = String(t)')) + LISTE('<li :out=*srimage><b>{r.id}</b></li>') + PRET,
  'sr-interieure.mjs': SCRIPT(CREE('srinterieure', 'css: (t) -> { opacity: t }')) + LISTE('<li><b>{r.id}</b><span class="s" :out.global=*srinterieure>s</span></li>') + PRET,
  'sr-image-finie.mjs': SCRIPT(`  µanim.create 'srcourte', (node) ->\n    duration: 200\n    tick: (t) -> node.style.opacity = String(t)\n`) + LISTE(`<li :out=${F(DUREE)}><b>{r.id}</b><span class="s" :out.global=*srcourte>s</span></li>`) + PRET,
  'sr-appli.mjs': SCRIPT() + LISTE(`<li :out=*srsort(duration: ${DUREE}ms, easing: linear)><b>{r.id}</b></li>`) + PRET,
  'sr-appli-images.mjs': SCRIPT() + LISTE(`<li :out=*srclef(duration: ${DUREE}ms, easing: linear)><b>{r.id}</b></li>`) + PRET,
  'sr-appli-entree.mjs': SCRIPT() + LISTE(`<li :transition=*srsort(duration: ${DUREE}ms, easing: linear)><b>{r.id}</b></li>`) + PRET,
  'sr-alias.mjs': SCRIPT() + LISTE('<li :out=*srfondu><b>{r.id}</b></li>') + PRET,
  'sr-si.mjs': SCRIPT() + `{if $v}<p class="p" :out=${F(DUREE)}><b>2</b></p>{end}` + PRET,
  'sr-si-partage.mjs': SCRIPT() + `{if $v}<p class="p" :out.shared=${F(DUREE)}><b>2</b></p>{end}` + PRET,
  'sr-si-entree.mjs': SCRIPT() + `{if $v}<p class="p" :transition=${F(DUREE)}><b>2</b></p>{end}` + PRET,
  'sr-ev.mjs': SCRIPT() + LISTE(`<li :transition=${F(600)} ${EVS('ev-r', ' + r.id')}><b>{r.id}</b><span class="s" :transition.global=${F(600)} ${EVS('ev-s', ' + r.id')}>s</span></li>`) + PRET,
  'sr-ev-sortie.mjs': SCRIPT() + LISTE(`<li :out=${F(600)} ${EVS('eo-r', ' + r.id')}><b>{r.id}</b></li>`) + PRET,
  'sr-ev-si.mjs': SCRIPT() + `{if $v}<p class="p" :transition=${F(600)} ${EVS('es', '')}><b>2</b></p>{end}` + PRET,
  'sr-ev-si-sortie.mjs': SCRIPT() + `{if $v}<p class="p" :out=${F(600)} ${EVS('eso', '')}><b>2</b></p>{end}` + PRET
}

// chaque cas sur sa propre balise, tous joués ensemble dans la même page. `jeu` : retour (la balise remise au tiers de sa sortie),
// reprise (remise, puis retirée de nouveau une microtâche plus tard), ev (les évènements du retour) ; `si` : un `{if}` plutôt qu'une
// ligne de `{for}` ; `cible` : la balise intérieure suivie plutôt que la ligne
type Cas = { balise: string, jeu: 'retour' | 'reprise' | 'ev', si?: boolean, cible?: string, entree?: boolean, prefixe?: string, courte?: boolean }
const CAS: Record<string, Cas> = {
  'ligne *fade': { balise: 'sr-fondu', jeu: 'retour' },
  'ligne, µanim.create fonction': { balise: 'sr-fonction', jeu: 'retour' },
  'ligne, µanim.create objet': { balise: 'sr-objet', jeu: 'retour' },
  'ligne, µanim.create tick': { balise: 'sr-image', jeu: 'retour' },
  'balise interieure .global, µanim.create fonction': { balise: 'sr-interieure', jeu: 'retour', cible: '.s' },
  'balise interieure .global, tick deja finie au retour': { balise: 'sr-image-finie', jeu: 'retour', cible: '.s', courte: true },
  'ligne, effet CSS de l appli': { balise: 'sr-appli', jeu: 'retour' },
  'ligne, effet CSS de l appli a @keyframes': { balise: 'sr-appli-images', jeu: 'retour' },
  'ligne, effet CSS de l appli en :transition': { balise: 'sr-appli-entree', jeu: 'retour', entree: true },
  'ligne, alias du fichier d effets': { balise: 'sr-alias', jeu: 'retour' },
  '{if} en :out seul': { balise: 'sr-si', jeu: 'retour', si: true },
  '{if} en :out.shared seul': { balise: 'sr-si-partage', jeu: 'retour', si: true },
  'ligne remise puis retiree une microtache plus tard': { balise: 'sr-fondu', jeu: 'reprise' },
  '{if} rouvert puis referme une microtache plus tard': { balise: 'sr-si-entree', jeu: 'reprise', si: true },
  'evenements, ligne et balise interieure en :transition': { balise: 'sr-ev', jeu: 'ev', prefixe: 'ev-' },
  'evenements, ligne en :out seul': { balise: 'sr-ev-sortie', jeu: 'ev', prefixe: 'eo-' },
  'evenements, {if} en :transition': { balise: 'sr-ev-si', jeu: 'ev', si: true, prefixe: 'es-' },
  'evenements, {if} en :out seul': { balise: 'sr-ev-si-sortie', jeu: 'ev', si: true, prefixe: 'eso-' }
}

const MODES = [{ nom: 'développement', prod: false, proxy: true }, { nom: 'production', prod: true, proxy: true }, { nom: 'production, "proxy": false', prod: true, proxy: false }]
const enveloppe = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}</body></html>`
const CORPS     = Object.entries(CAS).map(([nom, c]) => `<mjs-${c.balise} data-cas="${nom}"></mjs-${c.balise}>`).join('')

async function construire(prod: boolean, proxy: boolean): Promise<Cible> {
  const root   = mjsTmp('sr-' + (prod ? 'prod' : 'dev') + (proxy ? '' : '-sans-proxy'))
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
  const image    = () => new Promise((r) => requestAnimationFrame(() => r(null)))
  const el       = document.querySelector('[data-cas="' + nom + '"]') as any
  const om       = el._shadow
  const objets   = {} as any
  const liste    = (ids: number[]) => ids.map((i) => objets[i] || (objets[i] = { id: i }))
  const balises  = (): any[] => Array.from(om.querySelectorAll(c.si ? 'p.p' : 'ul.l > li')).filter((n: any) => n.querySelector('b').textContent === '2')
  const op       = (n: any) => n && n.isConnected ? Math.round(Number(getComputedStyle(n).opacity) * 1000) / 1000 : -1
  const retirer  = () => c.si ? el.voir(false) : el.poser(liste([1, 3]))
  const remettre = () => c.si ? el.voir(true) : el.poser(liste([1, 2, 3]))
  const w        = ((window as any).__sr ||= {})
  if (!c.si) el.poser(liste([1, 2, 3]))
  await pause(c.entree ? 1100 : 400)
  if (c.jeu === 'ev') {
    await pause(500)
    const avant: any = { ...w }
    retirer()
    await pause(200)
    remettre()
    await pause(1300)
    const d: any = {}
    for (const k of Object.keys(w)) if (k.startsWith(c.prefixe) && (c.si || k.endsWith('2'))) d[k.replace(/2$/, '')] = (w[k] || 0) - (avant[k] || 0)
    return { ev: d }
  }
  const b0    = balises()[0]
  const cible = (n: any) => n && c.cible ? n.querySelector(c.cible) : n
  const traj  = [] as any[]
  const t0    = performance.now()
  let tRet    = -1
  let parti   = -1
  retirer()
  // une image, un relevé : [temps, opacité de la balise suivie, balises de la clé] ; à mi-sortie, le geste dans la même image
  while (performance.now() - t0 < 1400) {
    await image()
    const t = performance.now() - t0
    traj.push([Math.round(t), op(cible(b0)), balises().length])
    if (parti < 0 && tRet >= 0 && !b0.isConnected) parti = Math.round(t - tRet)
    if (tRet < 0 && t >= 450) {
      tRet = t
      remettre()
      if (c.jeu === 'reprise') {
        await Promise.resolve()
        retirer()
      }
    }
  }
  await pause(300)
  const fin = balises()
  return { tRet: Math.round(tRet), traj, parti, fin: fin.length + ' balise, ' + (fin[0] === b0 ? 'la meme' : 'une autre') + ', opacite ' + op(cible(fin[0])) + ' / ' + op(fin[0]) + ', animations ' + (fin[0] ? fin[0].getAnimations({ subtree: true }).length : -1) }
}

// le premier écart à la valeur du geste (relevée dans l'image du geste, juste avant lui) plus grand que ce que la durée écoulée depuis
// permet : la pente la plus raide d'une courbe du framework (3 fois la moyenne, au départ d'une courbe `cubicOut`) et 0,1 de marge. Un
// vrai saut, à mi-sortie, en fait 0,5 au moins dès l'image suivante (saut à la fin, reprise au début, sortie rejouée), vu tant que
// cette image arrive en moins de 130 ms ; une image en retard sous charge, rattrapée ensuite, reste dans la borne. `duree` : celle de
// la transition suivie
function saut(traj: any[], depuis: number, duree = DUREE): string {
  const geste = traj.find((y) => y[0] >= depuis)
  if (!geste || geste[1] < 0) return 'aucun releve au geste'
  const [t0, o0] = geste
  for (const [t, o] of traj) {
    if (t <= t0 || o < 0) continue
    if (Math.abs(o - o0) > (t - t0) / duree * 3 + 0.1) return `saut de ${o0} a ${o} en ${Math.round(t - t0)} ms apres le geste`
  }
  return 'aucun'
}

// ce que la page a montré, en mots : comparé tel quel à ce qui est attendu
function resumer(c: Cas, r: any): Record<string, string> {
  if (r.ev) return r.ev
  const avant  = r.traj.filter((y: any) => y[0] < r.tRet)
  const apres  = r.traj.filter((y: any) => y[0] >= r.tRet)
  const ob     = avant.length ? avant[avant.length - 1][1] : -1
  const double = Math.max(...r.traj.map((y: any) => y[2]))
  let haut     = -1
  let sens     = 'remonte sans redescendre'
  for (const [t, o] of apres) {
    if (o < 0) break
    if (c.jeu === 'retour' && o < haut - 0.03) { sens = `redescend de ${haut} a ${o}, ${t - r.tRet} ms apres le retour`; break }
    if (c.jeu === 'reprise' && haut >= 0 && o > haut + 0.03) { sens = `remonte de ${haut} a ${o}, ${t - r.tRet} ms apres le second retrait`; break }
    haut = c.jeu === 'retour' ? Math.max(haut, o) : (haut < 0 ? o : Math.min(haut, o))
  }
  if (c.jeu === 'reprise') {
    const attendu = Math.round(0.4 * ob * DUREE)
    const depart  = r.parti < 0 ? 'encore la 1 s apres le second retrait' : r.parti < attendu ? `part d un coup ${r.parti} ms apres le second retrait (opacite ${ob})` : 'part a la fin de sa sortie'
    return { saut: saut(r.traj, r.tRet), sens: sens.replace('remonte sans redescendre', 'redescend sans remonter'), depart, double: double > 1 ? double + ' balises' : 'non' }
  }
  // sortie intérieure de 200 ms, finie avant le retour : jugée sur une durée de référence de 100 ms (ses images, plus rapides que celles
  // des autres cas, se relèvent avec un temps de retard sous charge)
  return { saut: saut(r.traj, r.tRet, c.courte ? 100 : DUREE), sens, double: double > 1 ? double + ' balises' : 'non', fin: r.fin }
}

function attendu(c: Cas): Record<string, string | number> {
  if (c.jeu === 'ev' && c.prefixe === 'eo-') return { 'eo-r-os': 1 }
  if (c.jeu === 'ev' && c.prefixe === 'eso-') return { 'eso-os': 1 }
  if (c.jeu === 'ev' && c.si) return { 'es-os': 1, 'es-is': 1, 'es-ie': 1 }
  if (c.jeu === 'ev') return { 'ev-r-os': 1, 'ev-s-os': 1, 'ev-r-is': 1, 'ev-s-is': 1, 'ev-r-ie': 1, 'ev-s-ie': 1 }
  if (c.jeu === 'reprise') return { saut: 'aucun', sens: 'redescend sans remonter', depart: 'part a la fin de sa sortie', double: 'non' }
  return { saut: 'aucun', sens: 'remonte sans redescendre', double: 'non', fin: '1 balise, la meme, opacite 1 / 1, animations 0' }
}

// les clés d'évènements à zéro ne comptent pas : une clé absente et une clé à 0 disent la même chose
const sansZero = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== 0))

const NAVIGATEURS = (process.env.SR_NAVS || 'chromium,firefox,webkit').split(',')
const cibles      = new Map<string, Promise<Cible>>()
const cible       = (prod: boolean, proxy: boolean) => {
  const k = prod + '-' + proxy
  if (!cibles.has(k)) cibles.set(k, construire(prod, proxy))
  return cibles.get(k) as Promise<Cible>
}
const PRET_JS = `Array.from(document.querySelectorAll('[data-cas]')).every((e) => !!(e._shadow && e._shadow.querySelector('.pret')))`

for (const nav of NAVIGATEURS) describe(`sortie interrompue par le retour de sa balise : elle revient sur ses pas, image par image (${nav})`, function () {
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
  for (const m of MODES) it(`${m.nom} : toutes les formes de transition, {for} et {if}, évènements`, async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(m.prod, m.proxy), 'mjs-sr-fondu')
    try {
      await o.page.waitForFunction(PRET_JS, null, { timeout: 15000 })
      await o.page.waitForTimeout(300)
      const obtenu: Record<string, unknown> = {}
      const voulu: Record<string, unknown>  = {}
      await Promise.all(Object.entries(CAS).map(async ([nom, c]) => {
        const r     = await o.page.evaluate(jouer, [nom, c])
        obtenu[nom] = sansZero(resumer(c, r))
        voulu[nom]  = attendu(c)
      }))
      assert.deepEqual(obtenu, voulu)
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally { await o.fermer() }
  })
})
