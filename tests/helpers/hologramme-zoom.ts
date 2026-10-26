// Aides des tests navigateur du zoom de *hologram : une page construite par le vrai moteur (les cartes dans un composant, des voisins
// positionnés sur le trajet de leur retour), ouverte dans Chromium ou Firefox ; un relevé pris à chaque image d'animation ; les
// attentes communes. Le dossier temporaire est rendu par le nettoyeur du harnais (tmp-sweep).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './tmp.js'
import { libellesDuManifeste } from './libelles-manifeste.js'
import { Bundler } from '../../src/bundler/index.js'
import { stripEsm } from '../../src/server/renderToString.js'

export async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// le préfixe public de la sortie : les images que la construction copie ne sont servies qu'à cette adresse exacte
export const PREFIXE = '/assets/site'

// la pente des cartes de l'atelier : sa transition dure une seconde quand le pointeur est ailleurs
export const PENTE = '*tilt(max: 14.29, scale: 1, perspective: 600, follow: 130ms, duration: 1000ms, wait: 650ms, bounce: 0.28)'

const PAYS = '<@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option>'

// deux cartes (la seconde en haut à droite), quatre voisins positionnés : trois grands, sur le trajet du centre de la première quand elle
// rentre de l'écran vers sa place (de 350,400 à 160,200), le dernier loin de tout ; deux champs <@@select> du cœur, une boîte
// `z-index: 1` qui a son propre empilement
export function page(zoom: string, plus = '', extra = '', css = ''): string {
  return `<div class="carte a" *hologram(rays, ${zoom}${extra}) ${plus}><b>A</b></div>
<div class="carte b" *hologram(rays, ${zoom}) ${plus}><b>B</b></div>
<@@select class="s1" name="s1" value="fr">${PAYS}</@@select>
<@@select class="s2" name="s2" value="fr">${PAYS}</@@select>
<@@select class="s3" name="s3" value="fr">${PAYS}</@@select>
<div class="boite">boîte</div>
<style>
.carte
  width: 200px
  height: 280px
  margin: 60px 0 0 60px
  border-radius: 10px
  background: linear-gradient(135deg, #2a4a6a, #7a5a9a)
  color: #fff
.b
  position: absolute
  left: 540px
  top: 0
  margin: 0
  width: 100px
  height: 140px
.s1
  position: absolute
  left: 300px
  top: 300px
  width: 160px
  height: 200px
.s2
  position: absolute
  left: 270px
  top: 150px
  width: 160px
  height: 150px
.s3
  position: absolute
  left: 540px
  top: 700px
  width: 140px
.boite
  position: absolute
  z-index: 1
  left: 280px
  top: 200px
  width: 170px
  height: 120px
  background: #c33
${css}</style>`
}

export interface Construit { js: string, sortie: string }

// construit des composants `<nom>.mjs` ; développement par défaut (le fichier de l'effet part entier), `prod` pour la production
export async function construire(sources: Record<string, string>, racine: string, env?: 'prod'): Promise<Construit> {
  const root   = mjsTmp(racine)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [n, source] of Object.entries(sources)) writeFileSync(join(srcDir, n), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: PREFIXE, ...(env ? { env, minify: false } : {}) } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const js    = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  return { js, sortie: outDir }
}

// construit en production, minifié, en un seul fichier (le manifeste) : le tri des sections n'y agit qu'en production, et les noms réduits des morceaux
// ne se heurtent pas. Une application par construction : les sections gardées sont celles de ses seuls réglages.
export async function construireProd(sources: Record<string, string>, racine: string): Promise<Construit> {
  const root      = mjsTmp(racine)
  const srcDir    = join(root, 'src')
  const outDir    = join(root, 'out')
  const manifeste = join(outDir, 'bundle.js')
  mkdirSync(srcDir, { recursive: true })
  for (const [n, source] of Object.entries(sources)) writeFileSync(join(srcDir, n), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, urlPrefix: PREFIXE, js: 'bundle', env: 'prod' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return { js: stripEsm(readFileSync(manifeste, 'utf-8')), sortie: outDir }
}

// la page ouverte : les erreurs de la console et de la page sont rendues (une liste vide est la norme)
export async function ouvrir(browser: any, construit: Construit, tag: string, options: any = {}, avant = '', attente = '.carte') {
  const p = await browser.newPage({ viewport: { width: 700, height: 800 }, ...options })
  const erreurs: string[] = []
  // le transpileur des tests enveloppe les fonctions nommées dans `__name` : la page, qui reçoit leur texte, doit le connaître
  await p.addInitScript('window.__name = function (f) { return f }')
  if (avant) await p.addInitScript(avant)
  p.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
  p.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
  await p.route('http://t.test/**', (route: any) => {
    const chemin = new URL(route.request().url()).pathname
    const nomF   = chemin.startsWith(PREFIXE + '/') ? chemin.slice(PREFIXE.length + 1) : ''
    const image  = /^(mjs_hologram_[a-z-]+-[0-9a-z]{5})\.(png|webp|jpg)$/.exec(nomF)
    if (image) return route.fulfill({ contentType: 'image/' + (image[2] === 'jpg' ? 'jpeg' : image[2]), body: readFileSync(join(construit.sortie, image[1] + '.' + image[2])) })
    const dos = /^(?:.*\/)?([\w.-]+\.(?:png|webp|jpg|svg))$/.exec(nomF)
    if (dos && existsSync(join(construit.sortie, dos[1]))) return route.fulfill({ contentType: 'image/' + (dos[1].endsWith('.svg') ? 'svg+xml' : dos[1].endsWith('.png') ? 'png' : dos[1].endsWith('.webp') ? 'webp' : 'jpeg'), body: readFileSync(join(construit.sortie, dos[1])) })
    if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;font:16px sans-serif}</style></head><body><${tag}></${tag}><script>${construit.js}</script></body></html>` })
  })
  await p.goto('http://t.test/', { waitUntil: 'load' })
  await p.waitForFunction(([t, a]: string[]) => !!(document.querySelector(t) as any)?._shadow?.querySelector(a), [tag, attente], { polling: 100 })
  await p.waitForTimeout(300)
  return { p, erreurs }
}

export const boite = (p: any, tag: string, sel: string) => p.evaluate(([t, s]: string[]) => {
  const r = ((document.querySelector(t) as any)._shadow.querySelector(s) as HTMLElement).getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}, [tag, sel])

// la carte `sel` agrandie par un clic en son centre, posée (sa boîte ne bouge plus), la souris restée au point du clic
export async function agrandit(p: any, tag: string, sel: string) {
  const z = await boite(p, tag, sel)
  await p.mouse.click(z.x + z.w / 2, z.y + z.h / 2)
  await p.waitForFunction(([t, s]: string[]) => /zoomed/.test(((document.querySelector(t) as any)._shadow.querySelector(s) as HTMLElement).getAttributeNames().join(' ')), [tag, sel], { polling: 100 })
  let avant = JSON.stringify(await boite(p, tag, sel))
  for (let i = 0; i < 100; i++) {
    await p.waitForTimeout(150)
    const apres = JSON.stringify(await boite(p, tag, sel))
    if (apres === avant && i > 8) break
    avant = apres
  }
  // et le ressort fini : la marque de vol est partie. Une machine chargée peut ne rendre aucune image entre deux lectures, et la boîte paraît alors posée
  await p.waitForFunction(([t, s]: string[]) => !/-fly/.test(((document.querySelector(t) as any)._shadow.querySelector(s) as HTMLElement).getAttributeNames().join(' ')), [tag, sel], { polling: 100, timeout: 30000 })
  return z
}

// le relevé, dans la page : à chaque image d'animation, la boîte de la carte, ses marques, sa matrice, et ce que `elementFromPoint` rend
// sur la ligne médiane de la carte (toujours dans sa surface, même tournée) à l'endroit où elle recouvre un voisin. S'arrête quand la carte,
// vue agrandie puis revenue, n'a plus aucune marque pendant vingt images
export const RELEVE = async ([tag, sel, _repos, voisins]: [string, string, { x: number, y: number, w: number, h: number }, string[]]) => {
  const racine  = (document.querySelector(tag) as any)._shadow as ShadowRoot
  const carte   = racine.querySelector(sel) as HTMLElement
  const liste   = voisins.map((s) => racine.querySelector(s) as HTMLElement)
  const marques = () => carte.getAttributeNames().filter((n) => n.startsWith('mjs-fx-hologram')).sort().join(' ')
  const points: any[] = []
  const debut = performance.now()
  let vu    = false
  let calme = 0
  await new Promise<void>((fini) => {
    const image = (now: number) => {
      const r = carte.getBoundingClientRect()
      const m = marques()
      if (/zoomed/.test(m)) vu = true
      const cy   = (r.top + r.bottom) / 2
      const sous = liste.map((v) => {
        const b = v.getBoundingClientRect()
        const g = Math.max(r.left, b.left), d = Math.min(r.right, b.right)
        if (d - g < 20 || cy < b.top || cy > b.bottom) return null
        const haut = racine.elementFromPoint((g + d) / 2, cy) as HTMLElement | null
        return { voisin: v.className, carte: !!haut && (haut === carte || carte.contains(haut) || !!haut.closest('[mjs-fx~="hologram"]')), rendu: haut ? haut.tagName + '.' + haut.className : null }
      })
      const t = getComputedStyle(carte).transform
      const mat = t === 'none' ? null : new DOMMatrix(t)
      const course = carte.getAnimations().filter((a: any) => a.transitionProperty === 'transform').length
      points.push({ t: Math.round(now - debut), x: r.left, y: r.top, w: r.width, h: r.height, marques: m, sous, cos: mat ? mat.m11 / mat.m22 : 1, dos: !!racine.querySelector('[mjs-fx-layer="hologram-back"]'), course })
      if (vu && !/zoomed/.test(m) && course === 0 && !/-up|-3d/.test(m)) calme++
      else calme = 0
      if (calme >= 20 || now - debut > 20000) fini()
      else requestAnimationFrame(image)
    }
    requestAnimationFrame(image)
  })
  // la carte est « loin » tant que sa boîte diffère de la dernière relevée, celle du repos (`tol` px : une pente d'*tilt encore inclinée y change la boîte)
  const fin = points[points.length - 1]
  const tol = 0.5
  for (const x of points) x.loin = Math.abs(x.x - fin.x) > tol || Math.abs(x.y - fin.y) > tol || Math.abs(x.w - fin.w) > tol || Math.abs(x.h - fin.h) > tol
  return points
}

// le relevé commence avant le geste : il tourne dans la page pendant que le geste est fait
export async function releve(p: any, tag: string, repos: any, geste: () => Promise<void>, sel = '.a', voisins = ['.s1', '.s2', '.boite']) {
  const fait = p.evaluate(RELEVE, [tag, sel, repos, voisins])
  await p.waitForTimeout(100)
  await geste()
  const points = await fait
  if (process.env.MJS_TRACE_ZOOM) console.log(points.filter((x: any, i: number) => i % 3 === 0 || x.sous.some((q: any) => q && !q.carte)).map((x: any) => `${x.t} x${Math.round(x.x)} y${Math.round(x.y)} w${Math.round(x.w)} cos${x.cos.toFixed(2)} ${x.loin ? 'LOIN' : 'repos'} [${x.marques.replace(/mjs-fx-hologram-/g, '')}] dos${x.dos ? 1 : 0} tr${x.course} ${x.sous.filter(Boolean).map((q: any) => q.voisin + (q.carte ? '+' : '-')).join(' ')}`).join('\n'))
  return points
}

// ce que le retour doit tenir : la carte au premier plan tant qu'elle n'est pas revenue, jamais un voisin devant elle
export function exige(points: any[], quoi: string, tol = 0.5) {
  const fin0 = points[points.length - 1]
  for (const x of points) x.loin = Math.abs(x.x - fin0.x) > tol || Math.abs(x.y - fin0.y) > tol || Math.abs(x.w - fin0.w) > tol || Math.abs(x.h - fin0.h) > tol
  const loin = points.filter((x) => x.loin && !/zoomed/.test(x.marques))
  const duree = loin.length > 1 ? loin[loin.length - 1].t - loin[0].t : 0
  // une machine très chargée n'affiche que quelques images par seconde : le retour est vu s'il l'est en deux relevés au moins, sur une durée d'au moins 200 ms
  assert.ok(loin.length >= 2 && duree >= 200, `${quoi} : le retour a été vu, image par image (${loin.length} relevés sur ${duree} ms)`)
  const sansRang = loin.filter((x) => !/mjs-fx-hologram-up/.test(x.marques))
  assert.equal(sansRang.length, 0, `${quoi} : la carte perd son rang avant d'être revenue — ${sansRang.length} relevés sur ${loin.length}, le premier à ${sansRang[0]?.t} ms (${sansRang[0] ? Math.round(sansRang[0].x) + ',' + Math.round(sansRang[0].y) + ' ' + Math.round(sansRang[0].w) + ' px' : ''})`)
  const croise = loin.flatMap((x) => x.sous.filter(Boolean).map((s: any) => ({ ...s, t: x.t })))
  assert.ok(croise.length >= 2, `${quoi} : le retour survole bien des voisins (${croise.length} relevés)`)
  const dessous = croise.filter((s: any) => !s.carte)
  assert.equal(dessous.length, 0, `${quoi} : un voisin passe devant la carte — ${dessous.length} relevés sur ${croise.length}, ex. ${JSON.stringify(dessous[0])}`)
  const fin = points[points.length - 1]
  assert.ok(!/mjs-fx-hologram-up/.test(fin.marques), `${quoi} : au repos, l'attribut est parti (${fin.marques})`)
}

// le vol, relevé dans la page : à chaque image d'animation, la boîte de la carte, ses marques et le nombre de transitions de `transform` qui courent.
// Le geste est daté par la page elle-même, avec la même horloge que les images : l'événement `type` (`pointerdown` pour un clic ailleurs, `click` pour un clic
// sur la carte, `keydown` pour une touche). Le relevé finit quand la boîte n'a pas bougé pendant 45 images, `minimum` ms au moins après le geste (une carte
// immobile un instant, puis qui glisse, ne l'arrête pas trop tôt).
export const FLIGHT = async ([tag, sel, type, minimum]: [string, string, string, number]) => {
  const root  = (document.querySelector(tag) as any)._shadow as ShadowRoot
  const card  = root.querySelector(sel) as HTMLElement
  let t0      = -1
  const touch = () => { if (t0 < 0) t0 = performance.now() }
  window.addEventListener(type, touch, true)
  const frames: any[] = []
  let still = 0
  let last  = ''
  ;(window as any).__flightFrames = 0
  await new Promise<void>((done) => {
    const frame = (now: number) => {
      ;(window as any).__flightFrames++
      const r    = card.getBoundingClientRect()
      const key  = [r.left, r.top, r.width, r.height].map((v) => v.toFixed(2)).join(' ')
      const back = root.querySelector('[mjs-fx-layer="hologram-back"]')
      frames.push({ rx: parseFloat(card.style.getPropertyValue('--mjs-fx-hologram-rx') || '0'), back: !!back, turned: !!back && back.hasAttribute('mjs-fx-hologram-turned'), t: now, x: r.left, y: r.top, w: r.width, h: r.height, marks: card.getAttributeNames().filter((n) => n.startsWith('mjs-fx-hologram')).sort().join(' '), run: card.getAnimations().filter((a: any) => a.transitionProperty === 'transform').length, shadow: getComputedStyle(card).boxShadow })
      still = key === last ? still + 1 : 0
      last  = key
      if ((t0 >= 0 && now - t0 > minimum && still >= 45) || now - frames[0].t > 25000) done()
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  window.removeEventListener(type, touch, true)
  return { t0, frames }
}

export interface Frame { rx: number, back: boolean, turned: boolean, t: number, x: number, y: number, w: number, h: number, marks: string, run: number, shadow: string }
export interface Flight { t0: number, frames: Frame[] }

// le relevé tourne dans la page pendant que le geste est fait
export async function fly(p: any, tag: string, type: 'pointerdown' | 'click' | 'keydown', gesture: () => Promise<void>, sel = '.a', minimum = 3000): Promise<Flight> {
  const done = p.evaluate(FLIGHT, [tag, sel, type, minimum])
  // le geste vient quand le relevé a déjà vu quelques images : l'image qui précède le geste existe, même sur une machine chargée
  await p.waitForFunction(() => (window as any).__flightFrames >= 4, null, { polling: 50 })
  await gesture()
  return done
}

const gap = (a: Frame, b: Frame) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h))

// ce que le vol dit :
//   start        combien d'images après le geste avant le premier mouvement (plus de 0,05 px) ; 1 : l'image qui suit
//   duration     de la première image après le geste à la dernière encore à plus de `tol` px de la place finale (ms) : le retard d'une machine chargée à
//                rendre la première image n'y compte pas
//   transitions  les images, du geste à cette dernière image, où une transition de `transform` court sur la balise
//   bare         les images du vol sans le premier plan
//   linger       pour un retour : le temps pendant lequel le premier plan survit à la dernière image encore loin (ms), null s'il ne part pas
//   unflown      les images où la carte bouge (plus de 0,05 px) sans la marque de vol, la dernière exceptée (celle où le ressort se pose et ôte la marque)
//   flyAtRest    la marque de vol est encore là à la fin du relevé
//   grain        le plus long intervalle entre deux images du vol (ms) : sur une machine chargée, la fin du mouvement n'est lue qu'à cette résolution près
//   arrival      l'écart, en px, entre la carte à la dernière image portant la marque de vol et la carte à la fin du relevé : la place lue à la dernière image du vol
//                est la place de repos (Infinity sans marque)
//   shadows      le nombre de valeurs différentes de l'ombre portée vues depuis le geste (3 ou plus : la lueur se fond ; 2 : elle saute)
//   turn         l'étendue de l'angle de tour, de l'image qui précède le geste à la fin du relevé (degrés : 360 pour un tour, de l'aller comme du retour) ; backSeen : le dos a existé ; showed : le dos était montré entre un quart et trois quarts de tour ;
//                backAtRest : il existe encore à la fin du relevé
export function measure(flight: Flight, tol = 1) {
  const { t0, frames } = flight
  const before  = [...frames].reverse().find((f) => f.t < t0) ?? frames[0]
  const after   = frames.filter((f) => f.t >= t0)
  const end     = frames[frames.length - 1]
  const moved   = after.findIndex((f) => gap(f, before) > 0.05)
  const far     = after.filter((f) => gap(f, end) > tol)
  const lastFar = far.length ? far[far.length - 1] : after[0]
  const gone    = frames.find((f) => f.t > lastFar.t && !/mjs-fx-hologram-up/.test(f.marks))
  const lastFly = [...after].reverse().find((f) => /mjs-fx-hologram-fly/.test(f.marks))
  const flown   = after.filter((f, i) => i > 0 && f.t <= lastFar.t && gap(f, after[i - 1]) > 0.05)
  return {
    start:       moved < 0 ? Infinity : moved + 1,
    duration:    Math.round(lastFar.t - after[0].t),
    transitions: after.filter((f) => f.t <= lastFar.t && f.run > 0).length,
    bare:        after.filter((f) => f.t <= lastFar.t && !/mjs-fx-hologram-up/.test(f.marks)).length,
    linger:      gone ? Math.round(gone.t - lastFar.t) : null,
    unflown:     flown.slice(0, -1).filter((f) => !/mjs-fx-hologram-fly/.test(f.marks)).length,
    flyAtRest:   /mjs-fx-hologram-fly/.test(end.marks),
    grain:       Math.round(Math.max(0, ...frames.filter((f, i) => i > 0 && f.t >= t0 && f.t <= lastFar.t + 300).map((f) => f.t - frames[frames.indexOf(f) - 1].t))),
    arrival:     lastFly ? +gap(lastFly, end).toFixed(2) : Infinity,
    shadows:     new Set(after.map((f) => f.shadow)).size,
    turn:        Math.max(before.rx, ...after.map((f) => f.rx)) - Math.min(before.rx, ...after.map((f) => f.rx)),
    backSeen:    after.some((f) => f.back),
    showed:      after.some((f) => f.turned && Math.abs(f.rx) % 360 > 100 && Math.abs(f.rx) % 360 < 260),
    backAtRest:  end.back
  }
}

// le pilote d'images : les images d'animation ne viennent qu'à la demande (`__pas(n)` : n images, de 16,7 ms) ; le mouvement est le même à chaque essai,
// quelle que soit la charge de la machine. Rend le nombre d'images encore demandées.
export const PILOTE = `(() => {
  const w = window
  const file = new Map()
  let n = 0
  w.__t = 0
  w.requestAnimationFrame = (f) => { file.set(++n, f); return n }
  w.cancelAnimationFrame = (id) => { file.delete(id) }
  w.__pas = (k, ms) => {
    for (let i = 0; i < (k || 1); i++) {
      const cur = [...file.values()]
      file.clear()
      w.__t += ms || 16.7
      for (const f of cur) f(w.__t)
    }
    return file.size
  }
})()`

// un registre des écouteurs posés sur le document et la fenêtre : `__ecouteurs()` rend le compte par type
export const REGISTRE = `(() => {
  const w = window
  const pris = new Map()
  const cap = (o) => typeof o === 'boolean' ? o : !!(o && o.capture)
  const ajoute = EventTarget.prototype.addEventListener
  const retire = EventTarget.prototype.removeEventListener
  const cle = (t, type, fn, o) => (t === document ? 'document' : t === window ? 'window' : '') + '|' + type + '|' + cap(o) + '|' + (fn && fn.toString().length)
  EventTarget.prototype.addEventListener = function (type, fn, o) {
    if (this === document || this === window) pris.set(cle(this, type, fn, o) + '|' + (pris.size + Math.random()), type)
    return ajoute.call(this, type, fn, o)
  }
  EventTarget.prototype.removeEventListener = function (type, fn, o) {
    if (this === document || this === window) {
      const k = [...pris.keys()].find((x) => x.startsWith(cle(this, type, fn, o) + '|'))
      if (k) pris.delete(k)
    }
    return retire.call(this, type, fn, o)
  }
  w.__ecouteurs = () => { const r = {}; for (const t of pris.values()) r[t] = (r[t] || 0) + 1; return r }
})()`

// la matrice de la carte : le cosinus de l'angle autour de l'axe vertical (m11 / m22), 1 sans transformation
export const COSINUS = ([t, s]: string[]) => {
  const carte = (document.querySelector(t) as any)._shadow.querySelector(s) as HTMLElement
  const tr = getComputedStyle(carte).transform
  if (tr === 'none') return 1
  const m = new DOMMatrix(tr)
  return m.m11 / m.m22
}

// la part des pixels d'une capture proches (à 30 près par canal) de chaque couleur donnée
export async function couleurs(p: any, png: Buffer, liste: number[][]): Promise<number[]> {
  return p.evaluate(async ([b64, cs]: [string, number[][]]) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const cv = document.createElement('canvas')
    cv.width = img.width
    cv.height = img.height
    const c = cv.getContext('2d') as CanvasRenderingContext2D
    c.drawImage(img, 0, 0)
    const d = c.getImageData(0, 0, cv.width, cv.height).data
    const n = cs.map(() => 0)
    for (let i = 0; i < d.length; i += 4) cs.forEach((k, j) => { if (Math.abs(d[i] - k[0]) < 30 && Math.abs(d[i + 1] - k[1]) < 30 && Math.abs(d[i + 2] - k[2]) < 30) n[j]++ })
    return n.map((x) => x / (d.length / 4))
  }, [png.toString('base64'), liste])
}
