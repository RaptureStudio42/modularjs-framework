// *spotlight CONSTRUIT EN PRODUCTION dans Chromium, Firefox et WebKit réels, un build par pose : ce que le tri des sections laisse à l'application fait ce que le
// réglage demande. Sans réglage neuf (ou avec ceux que la V3 connaissait) : le halo et le liseré suivent la souris, aucun calque de voile, aucun avertissement,
// et le fichier de l'effet ne porte rien du voile. Avec `where: veil` : le calque se pose et le disque suit la souris, le reste de la balise est voilé ; avec
// `smooth` : la lumière traîne puis rejoint la souris ; ensemble, les deux ; tenus par des variables, on passe de l'un à l'autre sur place. Le mot d'un mode
// écrit à la place d'une couleur avertit une fois. Chaque pose ne contient que le code de ses réglages : une section manquante qui casserait une pose se lit
// ici (une erreur de page, un avertissement, ou un geste sans effet). Le bord du voile (`soft`) écrit sans voile pose sa variable sur la balise et, tenu par une
// variable, se suit sur place sans éteindre la lumière ; la lumière toujours allumée (`on: always`) revient au centre avec ou sans retard, et se défait quand la variable
// qui la tient change ; un halo seul dans un navigateur sans animation Web ne dessine rien.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const STYLE   = '\n<style>\n:host\n  display: block\n.b\n  width: 300px\n  height: 200px\n  margin: 10px\n.a\n  display: block\n  width: 300px\n  height: 200px\n  background: #fa0\n</style>\n'
const SCRIPT  = '<script>\n$w = \'veil\'\n$m = 1\n$c = \'#0ff\'\n$r = 0\n$s = 120\n$o = \'always\'\n</script>\n'
const ARRONDI = '<button class="rond" @click={$r = 40}>rond</button>'
const BORD    = '<button class="bord" @click={$s = 40}>bord</button>'
const SURVOL  = '<button class="survol" @click={$o = \'hover\'}>survol</button>'
const BOUTONS = '<button class="lent" @click={$m = .1}>lent</button><button class="halo" @click={$w = \'both\'}>halo</button><button class="voile" @click={$w = \'veil\'}>voile</button>'

// une pose = une page de production ; `verifie` lit la page et rend ce qu'elle a vu
type Ctx  = { page: any, lit: (js: string) => Promise<any>, boite: () => Promise<{ x: number, y: number, w: number, h: number }>, pixels: (points: Array<[number, number]>) => Promise<number[][]>, script: string, erreurs: string[] }
type Pose = { nom: string, source: string, verifie: (ctx: Ctx) => Promise<any>, avant?: string }

const POSES: Pose[] = []
const poser = (nom: string, balise: string, verifie: Pose['verifie'], pied = '', avant = '') => POSES.push({ nom, source: SCRIPT + `<div class="b"><div class="a" ${balise}>Un cadre</div></div>` + pied + STYLE, verifie, avant })

// un navigateur sans animation Web (les anciens) : la pose est faite avant le chargement de la page
const SANS_ANIMATION = 'delete Element.prototype.animate'

const orange = (p: number[]) => p[0] > 200 && p[1] > 120 && p[2] < 80
const sombre = (p: number[]) => p[0] < 70 && p[1] < 70 && p[2] < 70

const a       = `window.__racine(TAG).querySelector('.a')`
const calque  = `${a}.querySelector('[mjs-fx-layer="spotlight"]')`
const disque  = `(() => { const c = ${calque}; if (!c) return null; const t = getComputedStyle(c.firstChild).translate; const v = t === 'none' ? [] : t.split(' ').map(parseFloat); return [v[0] || 0, v[1] || 0] })()`
const halo    = `(() => { const t = getComputedStyle(${a}, '::after').translate; if (t === 'none') return null; const v = t.split(' ').map(parseFloat); return [v[0] || 0, v[1] || 0] })()`
const lisere  = `[${a}.style.getPropertyValue('--mjs-fx-spot-x'), ${a}.style.getPropertyValue('--mjs-fx-spot-y')]`
const allume  = `${a}.hasAttribute('mjs-fx-spot-on')`
const vivant  = `${a}.hasAttribute('mjs-fx-live')`
const bord    = `${a}.style.getPropertyValue('--mjs-spotlight-soft')`
const bouton  = (c: string) => `window.__racine(TAG).querySelector('.${c}')`

// le halo (translate du pseudo-élément) ou le disque du voile (décalage du centre du calque : la souris moins le centre de la balise) a rejoint la souris
const halo_en   = (x: number, y: number) => `(() => { const t = ${halo}; return !!t && Math.abs(t[0] - ${x}) < 0.6 && Math.abs(t[1] - ${y}) < 0.6 })()`
const disque_en = (x: number, y: number) => `(() => { const t = ${disque}; return !!t && Math.abs(t[0] - ${x - 150}) < 0.6 && Math.abs(t[1] - ${y - 100}) < 0.6 })()`

poser('sans réglage neuf : le halo et le liseré suivent la souris, rien du voile ni de l\'avertissement', '*spotlight', async ({ page, lit, boite, script }) => {
  assert.equal(script.includes('mjs-fx-veil-on'), false, 'le fichier de l\'effet ne porte pas le voile')
  assert.equal(script.includes('est lu comme une couleur'), false, 'ni l\'avertissement')
  const b = await boite()
  assert.equal(await lit(allume), false, 'éteinte au repos')
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForFunction(`${vivant} && ${halo_en(100, 80)}`, null, { timeout: 8000 })
  assert.equal(await lit(allume), true, 'allumée pendant le survol')
  assert.deepEqual(await lit(lisere), ['100.0px', '80.0px'], 'le liseré est sous la souris')
  assert.equal(await lit(`!!${calque}`), false, 'aucun calque de voile')
  await page.mouse.move(b.x + 220, b.y + 120, { steps: 2 })
  await page.waitForFunction(halo_en(220, 120), null, { timeout: 8000 })
  assert.deepEqual(await lit(lisere), ['220.0px', '120.0px'])
  await page.mouse.move(2, 2, { steps: 3 })
  await page.waitForFunction(`!${allume} && !${vivant}`, null, { timeout: 8000 })
  assert.match((await lit(lisere)).join(' '), /^[\d.]+px [\d.]+px$/, 'à la sortie, le liseré s\'éteint là où la lumière était (comme avant : seul `on: always` rend la lumière au centre)')
})

poser('les réglages de la V3 (liseré seul, toujours allumé) : allumé au repos, sous la souris, rien du voile', '*spotlight(color: #0ff, where: border, size: 240, fill: .4, width: 3, on: always)', async ({ page, lit, boite, script }) => {
  assert.equal(script.includes('mjs-fx-veil-on'), false)
  const b = await boite()
  assert.equal(await lit(allume), true, 'allumé dès la pose')
  assert.equal(await lit(`${a}.getAttribute('mjs-fx-spot-where')`), 'border')
  assert.equal(await lit(`getComputedStyle(${a}, '::before').opacity`), '1')
  assert.equal(await lit(`getComputedStyle(${a}, '::after').display`), 'none', 'where: border n\'a pas de halo')
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForFunction(`${lisere}[0] === '100.0px'`, null, { timeout: 8000 })
  assert.deepEqual(await lit(lisere), ['100.0px', '80.0px'])
  assert.equal(await lit(`${a}.style.getPropertyValue('--mjs-spotlight-width')`), '3px')
  await page.mouse.move(2, 2, { steps: 3 })
  await page.waitForFunction(`${lisere}[0] === ''`, null, { timeout: 8000 })
  assert.equal(await lit(allume), true, 'toujours allumé après la sortie')
})

poser('where: fill, fill, size et radius : le halo suit la souris, le liseré n\'est pas posé', '*spotlight(where: fill, fill: .5, size: 300, radius: 12)', async ({ page, lit, boite }) => {
  const b = await boite()
  assert.equal(await lit(`${a}.getAttribute('mjs-fx-spot-where')`), 'fill')
  await page.mouse.move(b.x + 60, b.y + 150, { steps: 3 })
  await page.waitForFunction(halo_en(60, 150), null, { timeout: 8000 })
  assert.deepEqual(await lit(lisere), ['', ''], 'aucune variable : le halo est posé par l\'animation de son pseudo-élément')
  assert.equal(await lit(`getComputedStyle(${a}, '::before').display`), 'none', 'where: fill n\'a pas de liseré')
})

poser('where: veil : le calque se pose sous la souris, le reste de la balise est voilé, le calque part à la sortie', '*spotlight(where: veil)', async ({ page, lit, boite, pixels, script }) => {
  assert.equal(script.includes('mjs-fx-veil-on'), true, 'le fichier de l\'effet porte le voile')
  const b = await boite()
  assert.equal(await lit(`!!${calque}`), false, 'pas de calque au repos')
  await page.mouse.move(b.x + 50, b.y + 40, { steps: 3 })
  await page.waitForFunction(disque_en(50, 40), null, { timeout: 8000 })
  assert.equal(await lit(`${calque}.hasAttribute('mjs-fx-veil-on')`), true, 'le calque est allumé')
  await page.waitForTimeout(500)
  const [dessous, loin] = await pixels([[b.x + 50, b.y + 40], [b.x + 280, b.y + 180]])
  assert.ok(orange(dessous), `sous la souris, la balise se voit : ${dessous}`)
  assert.ok(sombre(loin), `loin de la souris, le voile : ${loin}`)
  await page.mouse.move(b.x + 200, b.y + 150, { steps: 2 })
  await page.waitForFunction(disque_en(200, 150), null, { timeout: 8000 })
  await page.mouse.move(2, 2, { steps: 3 })
  await page.waitForFunction(`!${calque}`, null, { timeout: 8000 })
})

poser('where: veil, soft et on: always : le calque est là dès la pose, le trou revient au centre à la sortie', '*spotlight(where: veil, soft: 80, on: always)', async ({ page, lit, boite }) => {
  const b = await boite()
  assert.equal(await lit(`${calque}.hasAttribute('mjs-fx-veil-on')`), true, 'allumé dès la pose')
  assert.equal(await lit(`getComputedStyle(${calque}.firstChild).width`), '320px', 'size 160 + 2 × soft 80')
  await page.mouse.move(b.x + 60, b.y + 40, { steps: 3 })
  await page.waitForFunction(disque_en(60, 40), null, { timeout: 8000 })
  await page.mouse.move(2, 2, { steps: 3 })
  await page.waitForFunction(`${disque}[0] === 0 && ${disque}[1] === 0`, null, { timeout: 8000 })
})

poser('smooth seul : le halo et le liseré traînent derrière la souris puis la rejoignent', '*spotlight(smooth: .15)', async ({ page, lit, boite, script }) => {
  assert.equal(script.includes('mjs-fx-veil-on'), false, 'le retard n\'est pas le voile')
  const b = await boite()
  await page.mouse.move(b.x + 40, b.y + 40, { steps: 2 })
  await page.waitForFunction(halo_en(40, 40), null, { timeout: 8000 })
  await page.mouse.move(b.x + 240, b.y + 40, { steps: 1 })
  const tot = await lit(halo)
  assert.ok(tot[0] < 240 - 20, `juste après le saut, la lumière est en retard : ${tot}`)
  await page.waitForFunction(`${halo_en(240, 40)} && ${lisere}[0] === '240.0px'`, null, { timeout: 8000 })
  assert.equal(await lit(`!!${calque}`), false, 'aucun calque de voile')
})

poser('smooth: 1 : la lumière colle à la souris', '*spotlight(smooth: 1)', async ({ page, lit, boite }) => {
  const b = await boite()
  await page.mouse.move(b.x + 40, b.y + 40, { steps: 2 })
  await page.mouse.move(b.x + 240, b.y + 40, { steps: 1 })
  await page.waitForFunction(halo_en(240, 40), null, { timeout: 8000 })
  assert.equal((await lit(lisere))[0], '240.0px')
})

poser('where: veil et smooth : le disque du voile traîne puis rejoint la souris', '*spotlight(where: veil, smooth: .15)', async ({ page, lit, boite }) => {
  const b = await boite()
  await page.mouse.move(b.x + 40, b.y + 40, { steps: 2 })
  await page.waitForFunction(disque_en(40, 40), null, { timeout: 8000 })
  await page.mouse.move(b.x + 240, b.y + 40, { steps: 1 })
  const tot = await lit(disque)
  assert.ok(tot[0] < 240 - 150 - 20, `juste après le saut, le trou est en retard : ${tot}`)
  await page.waitForFunction(disque_en(240, 40), null, { timeout: 8000 })
})

poser('le mot d\'un mode écrit à la place d\'une couleur : un avertissement, une seule fois', '*spotlight(veil)', async ({ page, boite, erreurs }) => {
  const b = await boite()
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForFunction(halo_en(100, 80), null, { timeout: 8000 })
  // en production, le texte vient du tableau des messages (un fichier à part, que cette page ne sert pas) : le message se lit par sa clé ; le chargement qui échoue n'est pas l'objet
  const avis = erreurs.filter((e) => e.startsWith('[ModularJS]'))
  assert.equal(avis.length, 1, `un seul avertissement : ${erreurs}`)
  assert.match(avis[0], /spotlightWhere/)
  assert.match(avis[0], /veil/)
  erreurs.length = 0
})

poser('une couleur tenue par une variable : elle s\'applique, sans avertissement', '*spotlight(color: $c)', async ({ page, lit, boite }) => {
  const b = await boite()
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForFunction(halo_en(100, 80), null, { timeout: 8000 })
  assert.equal(await lit(`${a}.style.getPropertyValue('--mjs-spotlight-color')`), '#0ff')
})

poser('where et smooth tenus par des variables : le voile, son retard changé sur place, puis le halo', '*spotlight(where: $w, smooth: $m)', async ({ page, lit, boite }) => {
  const b = await boite()
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForFunction(disque_en(100, 80), null, { timeout: 8000 })
  await page.evaluate(`${bouton('lent')}.click()`)
  await page.mouse.move(b.x + 250, b.y + 80, { steps: 1 })
  const tot = await lit(disque)
  assert.ok(tot[0] < 250 - 150 - 20, `le retard a changé sur place : ${tot}`)
  await page.waitForFunction(disque_en(250, 80), null, { timeout: 8000 })
  await page.evaluate(`${bouton('halo')}.click()`)
  await page.waitForFunction(`!${calque}`, null, { timeout: 8000 })
  await page.mouse.move(b.x + 120, b.y + 100, { steps: 2 })
  await page.waitForFunction(halo_en(120, 100), null, { timeout: 8000 })
  await page.evaluate(`${bouton('voile')}.click()`)
  await page.mouse.move(b.x + 80, b.y + 60, { steps: 2 })
  await page.waitForFunction(`!!${calque}`, null, { timeout: 8000 })
}, BOUTONS)

poser('smooth tenu par une variable, sans voile : le retard change sur place', '*spotlight(smooth: $m)', async ({ page, lit, boite, script }) => {
  assert.equal(script.includes('mjs-fx-veil-on'), false)
  const b = await boite()
  await page.mouse.move(b.x + 40, b.y + 40, { steps: 2 })
  await page.waitForFunction(halo_en(40, 40), null, { timeout: 8000 })
  await page.evaluate(`${bouton('lent')}.click()`)
  await page.mouse.move(b.x + 250, b.y + 40, { steps: 1 })
  const tot = await lit(halo)
  assert.ok(tot[0] < 250 - 20, `le retard a changé sur place : ${tot}`)
  await page.waitForFunction(halo_en(250, 40), null, { timeout: 8000 })
}, BOUTONS)

poser('radius tenu par une variable : l\'arrondi change sur place, le halo est rogné à la nouvelle forme', '*spotlight(radius: $r)', async ({ page, lit, boite }) => {
  const b = await boite()
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForFunction(halo_en(100, 80), null, { timeout: 8000 })
  assert.doesNotMatch(await lit(`getComputedStyle(${a}, '::after').clipPath`), /round/, 'sans arrondi, un rognage droit')
  await page.evaluate(`${bouton('rond')}.click()`)
  await page.waitForFunction(`getComputedStyle(${a}).borderTopLeftRadius === '40px'`, null, { timeout: 8000 })
  await page.mouse.move(b.x + 110, b.y + 90, { steps: 2 })
  await page.waitForFunction(`${halo_en(110, 90)} && /round/.test(getComputedStyle(${a}, '::after').clipPath)`, null, { timeout: 8000 })
}, ARRONDI)

poser('le voile posé sur la page entière (`<@document>`) : un calque fixe dans la page, le trou sous la souris, le reste voilé', '', async ({ page, lit, pixels }) => {
  const calquePage = `document.body.querySelector('[mjs-fx-layer="spotlight"]')`
  const disquePage = `(() => { const c = ${calquePage}; if (!c) return null; const v = getComputedStyle(c.firstChild).translate.split(' ').map(parseFloat); return [v[0] || 0, v[1] || 0] })()`
  assert.equal(await lit(`!!${calquePage}`), false, 'pas de calque avant le premier mouvement')
  await page.mouse.move(60, 50, { steps: 3 })
  // le trou suit la souris dans la fenêtre : le décalage du centre du calque (340 × 300 → centre 170, 150)
  await page.waitForFunction(`(() => { const t = ${disquePage}; return !!t && Math.abs(t[0] - (60 - 170)) < 0.6 && Math.abs(t[1] - (50 - 150)) < 0.6 })()`, null, { timeout: 8000 })
  assert.equal(await lit(`getComputedStyle(${calquePage}).position`), 'fixed')
  assert.equal(await lit(`getComputedStyle(document.documentElement).position`), 'static', 'rien de relatif posé sur la page')
  await page.waitForTimeout(500)
  const [dessous, loin] = await pixels([[60, 50], [320, 280]])
  assert.ok(!sombre(dessous), `sous la souris, la page se voit : ${dessous}`)
  assert.ok(sombre(loin), `loin de la souris, le voile : ${loin}`)
}, '<@document *spotlight(where: veil, soft: 40)>')

// la page entière, la lumière toujours allumée avec un retard : quand seule la HAUTEUR de la fenêtre change, la page garde la sienne (`<html>` à hauteur
// automatique : l'observateur de sa taille ne bouge pas) et le centre de la fenêtre n'est plus celui que l'effet avait lu à la pose. La lumière naît et rentre
// au centre d'aujourd'hui, pas à l'ancien (sans quoi elle glisse vers un point à côté, puis saute à l'arrivée quand ses positions sont retirées)
const FILM  = (lecture: string) => `(() => { const f = window.__film = { v: [], fin: false }; const b = () => { if (f.fin) return; f.v.push(${lecture}); requestAnimationFrame(b) }; requestAnimationFrame(b) })()`
const FINI  = '(() => { window.__film.fin = true; return window.__film.v })()'
poser('le voile de la page entière, toujours allumé avec un retard, la hauteur de la fenêtre change seule : la lumière naît au vrai centre et y rentre sans saut', '', async ({ page, lit }) => {
  const disquePage = `(() => { const c = document.body.querySelector('[mjs-fx-layer="spotlight"]'); if (!c) return null; const t = getComputedStyle(c.firstChild).translate; const v = t === 'none' ? [] : t.split(' ').map(parseFloat); return [v[0] || 0, v[1] || 0] })()`
  // la fenêtre perd 50 px de hauteur (340 × 300 → 340 × 250), la page garde les siens : son centre passe de 150 à 125
  await page.setViewportSize({ width: 340, height: 250 })
  await page.waitForTimeout(400)
  assert.equal(await lit('document.documentElement.clientHeight'), 250, 'la fenêtre a changé de hauteur')
  assert.ok(await lit('document.documentElement.getBoundingClientRect().height') < 240, 'et la page garde sa hauteur : l\'observateur de sa taille ne bouge pas')
  // la première entrée, la souris au vrai centre : la lumière naît dessous et n\'a nulle part où aller
  await page.evaluate(FILM(disquePage))
  await page.mouse.move(170, 125, { steps: 1 })
  await page.waitForTimeout(600)
  const naissance: Array<[number, number] | null> = await lit(FINI)
  assert.ok(naissance.length >= 5, `des images relevées (${naissance.length})`)
  assert.ok(naissance.every((v) => v && Math.abs(v[0]) < 1 && Math.abs(v[1]) < 1), `la lumière naît sous la souris, au centre d'aujourd'hui (${naissance.slice(0, 5).map((v) => v && v.join(' ')).join(' | ')})`)
  // elle suit la souris, loin du centre, puis la souris sort : elle glisse jusqu'au centre d'aujourd'hui et n'y saute pas
  await page.mouse.move(300, 30, { steps: 2 })
  await page.waitForFunction(`(() => { const t = ${disquePage}; return !!t && Math.abs(t[0] - 130) < 0.6 && Math.abs(t[1] + 95) < 0.6 })()`, null, { timeout: 8000 })
  await page.evaluate(FILM(disquePage))
  await page.evaluate(`document.documentElement.dispatchEvent(new PointerEvent('pointerleave'))`)
  await page.waitForTimeout(2600)
  const retour: Array<[number, number]> = await lit(FINI)
  const glisse = retour.filter((v) => v[0] !== 0 || v[1] !== 0)
  assert.ok(glisse.length >= 5, `des places intermédiaires entre la souris et le centre (${glisse.length})`)
  const derniere = glisse[glisse.length - 1]
  assert.ok(Math.hypot(derniere[0], derniere[1]) < 1.5, `la dernière place avant l'arrivée est le centre d'aujourd'hui, pas un point à côté (${derniere.join(' ')})`)
  assert.ok(glisse.every((v, i) => i === 0 || Math.hypot(v[0], v[1]) <= Math.hypot(glisse[i - 1][0], glisse[i - 1][1]) + 0.5), 'elle se rapproche du centre sans reculer')
}, '<@document *spotlight(where: veil, on: always, smooth: .15)>')

poser('tous les réglages ensemble : le voile, sa couleur, son retard, toujours allumé', '*spotlight(where: veil, soft: 30, smooth: .3, on: always, color: #08f, size: 120, fill: .9)', async ({ page, lit, boite }) => {
  const b = await boite()
  assert.equal(await lit(`${calque}.hasAttribute('mjs-fx-veil-on')`), true)
  assert.equal(await lit(`getComputedStyle(${calque}.firstChild).width`), '180px', 'size 120 + 2 × soft 30')
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForFunction(disque_en(100, 80), null, { timeout: 8000 })
})

poser('soft écrit sans le voile : la variable du bord est posée sur la balise, comme avant le tri des sections', '*spotlight(soft: 80)', async ({ lit, script }) => {
  assert.equal(script.includes('mjs-fx-veil-on'), false, 'le bord n\'est pas le voile')
  assert.equal(await lit(bord), '80px')
})

poser('soft tenu par une variable, sans voile : le bord change sur place, la lumière reste allumée', '*spotlight(soft: $s)', async ({ page, lit, boite }) => {
  const b = await boite()
  assert.equal(await lit(bord), '120px')
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForFunction(`${vivant} && ${halo_en(100, 80)}`, null, { timeout: 8000 })
  assert.equal(await lit(allume), true, 'allumée pendant le survol')
  await page.evaluate(`${bouton('bord')}.click()`)
  await page.waitForTimeout(300)
  assert.equal(await lit(allume), true, 'la lumière reste allumée quand la variable change : l\'effet n\'est pas relancé')
  assert.equal(await lit(vivant), true)
  assert.equal(await lit(bord), '40px', 'la variable du bord est mise à jour sur place')
  await page.mouse.move(b.x + 200, b.y + 120, { steps: 2 })
  await page.waitForFunction(halo_en(200, 120), null, { timeout: 8000 })
}, BORD)

poser('on: always avec un retard : la lumière naît au centre, rejoint la souris, revient au centre à la sortie, puis repart de là', '*spotlight(on: always, smooth: .15)', async ({ page, lit, boite }) => {
  const b = await boite()
  assert.equal(await lit(allume), true, 'allumée dès la pose')
  assert.equal(await lit(halo), null, 'au repos, le halo est celui de la feuille, au centre')
  await page.mouse.move(b.x + 240, b.y + 40, { steps: 1 })
  const tot = await lit(halo)
  assert.ok(tot && tot[0] < 200 && tot[1] > 60, `la première fois, la lumière part du centre et non de la souris : ${tot}`)
  await page.waitForFunction(`${halo_en(240, 40)} && ${lisere}[0] === '240.0px'`, null, { timeout: 8000 })
  await page.mouse.move(2, 2, { steps: 3 })
  await page.waitForFunction(`${halo} === null && ${lisere}[0] === '' && ${lisere}[1] === ''`, null, { timeout: 8000 })
  assert.equal(await lit(allume), true, 'toujours allumée après la sortie')
  await page.mouse.move(b.x + 60, b.y + 150, { steps: 2 })
  await page.waitForFunction(halo_en(60, 150), null, { timeout: 8000 })
})

// un relevé à chaque image, posé avant la sortie de la souris : la lumière toujours allumée avec un retard ne doit pas être au centre dès la première image
// qui suit la sortie, mais s'en rapprocher image après image ; ses positions ne sont retirées (la feuille la pose au centre) qu'à son arrivée
const releve = (lecture: string) => `(() => { window.__releve = []; const fin = performance.now() + 4000; const boucle = () => { window.__releve.push(${lecture}); if (performance.now() < fin) requestAnimationFrame(boucle) }; requestAnimationFrame(boucle) })()`

poser('on: always avec un retard : à la sortie, le halo et le liseré glissent jusqu\'au centre, image après image', '*spotlight(on: always, smooth: .15)', async ({ page, lit, boite }) => {
  const b = await boite()
  await page.mouse.move(b.x + 240, b.y + 40, { steps: 1 })
  await page.waitForFunction(`${halo_en(240, 40)} && ${lisere}[0] === '240.0px'`, null, { timeout: 8000 })
  await page.evaluate(releve(`[${lisere}[0], ${halo}, ${vivant}]`))
  await page.mouse.move(2, 2, { steps: 1 })
  await page.waitForFunction(`${halo} === null && ${lisere}[0] === ''`, null, { timeout: 8000 })
  await page.waitForTimeout(200)
  const vus: Array<[string, number[] | null, boolean]> = await lit('window.__releve')
  const depart = vus.findIndex((v) => v[0] !== '240.0px')
  assert.ok(depart >= 0, 'la sortie a changé le liseré')
  assert.notEqual(vus[depart][0], '', 'le liseré n\'est pas au centre (variable retirée) dès la première image qui suit la sortie')
  assert.notEqual(vus[depart][1], null, 'le halo n\'est pas au centre dès la première image qui suit la sortie')
  const glisse = vus.slice(depart).filter((v) => v[0] !== '')
  assert.ok(glisse.every((v) => v[2] === true), 'promue (mjs-fx-live) tant qu\'elle glisse')
  assert.equal(vus[vus.length - 1][2], false, 'chez elle, elle n\'est plus promue')
  const rim  = vus.slice(depart).map((v) => v[0]).filter((v) => v !== '').map(parseFloat)
  const halos = vus.slice(depart).map((v) => v[1]).filter((v) => v !== null).map((v) => (v as number[])[0])
  for (const [nom, suite] of [['liseré', rim], ['halo', halos]] as Array<[string, number[]]>) {
    assert.ok(suite.length >= 3, `${nom} : des places intermédiaires entre la souris et le centre (${suite})`)
    assert.ok(suite.every((x, i) => x < 240 && x >= 150 && (i === 0 || x <= suite[i - 1])), `${nom} : il se rapproche du centre sans reculer (${suite})`)
  }
})

poser('on: always avec un retard : la souris revient pendant le glissement, la lumière la rejoint et reste sous elle', '*spotlight(on: always, smooth: .15)', async ({ page, lit, boite }) => {
  const b = await boite()
  await page.mouse.move(b.x + 240, b.y + 40, { steps: 1 })
  await page.waitForFunction(`${halo_en(240, 40)} && ${lisere}[0] === '240.0px'`, null, { timeout: 8000 })
  await page.mouse.move(2, 2, { steps: 1 })
  await page.waitForTimeout(80)
  await page.mouse.move(b.x + 60, b.y + 150, { steps: 1 })
  await page.waitForFunction(`${halo_en(60, 150)} && ${lisere}[0] === '60.0px'`, null, { timeout: 8000 })
  await page.waitForTimeout(400)
  assert.equal(await lit(`${lisere}[0]`), '60.0px', 'arrivée sous la souris, la lumière n\'est pas remise au centre')
  assert.equal(await lit(vivant), true, 'toujours promue pendant le survol')
})

poser('where: veil, on: always avec un retard : à la sortie, le trou glisse jusqu\'au centre, image après image', '*spotlight(where: veil, smooth: .15, on: always)', async ({ page, lit, boite }) => {
  const b = await boite()
  await page.mouse.move(b.x + 240, b.y + 40, { steps: 1 })
  await page.waitForFunction(disque_en(240, 40), null, { timeout: 8000 })
  await page.evaluate(releve(`[${disque}[0], ${calque}.hasAttribute('mjs-fx-live')]`))
  await page.mouse.move(2, 2, { steps: 1 })
  await page.waitForFunction(`${disque}[0] === 0`, null, { timeout: 8000 })
  await page.waitForTimeout(200)
  const vus: Array<[number, boolean]> = await lit('window.__releve')
  const depart = vus.findIndex((v) => Math.abs(v[0] - 90) > 0.6)
  assert.ok(depart >= 0, 'la sortie a déplacé le disque')
  assert.notEqual(vus[depart][0], 0, 'le trou n\'est pas au centre dès la première image qui suit la sortie')
  assert.ok(vus.slice(depart).filter((v) => v[0] !== 0).every((v) => v[1] === true), 'le calque est promu (mjs-fx-live) tant que le trou glisse')
  assert.equal(vus[vus.length - 1][1], false, 'chez lui, le trou n\'est plus promu')
  const suite = vus.slice(depart).map((v) => v[0]).filter((v) => v !== 0)
  assert.ok(suite.length >= 3, `des places intermédiaires entre la souris et le centre (${suite})`)
  assert.ok(suite.every((x, i) => x < 90 && x >= 0 && (i === 0 || x <= suite[i - 1])), `il se rapproche du centre sans reculer (${suite})`)
})

poser('on: tenu par une variable : toujours allumée au départ, l\'effet est relancé quand la variable passe à hover', '*spotlight(on: $o)', async ({ page, lit, boite }) => {
  const b = await boite()
  assert.equal(await lit(allume), true, 'allumée dès la pose')
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForFunction(`${lisere}[0] === '100.0px'`, null, { timeout: 8000 })
  await page.mouse.move(2, 2, { steps: 3 })
  await page.waitForFunction(`${lisere}[0] === ''`, null, { timeout: 8000 })
  assert.equal(await lit(allume), true, 'toujours allumée après la sortie')
  await page.evaluate(`${bouton('survol')}.click()`)
  await page.waitForFunction(`!${allume}`, null, { timeout: 8000 })
}, SURVOL)

poser('where: fill dans un navigateur sans animation Web : ni halo ni liseré', '*spotlight(where: fill)', async ({ lit }) => {
  assert.equal(await lit(`typeof Element.prototype.animate`), 'undefined', 'le navigateur n\'a plus l\'animation Web')
  assert.equal(await lit(`${a}.getAttribute('mjs-fx-spot-where')`), 'none')
  assert.equal(await lit(`getComputedStyle(${a}, '::after').display`), 'none', 'pas de halo')
  assert.equal(await lit(`getComputedStyle(${a}, '::before').display`), 'none', 'pas de liseré')
}, '', SANS_ANIMATION)

poser('sans animation Web, le halo par défaut n\'est pas dessiné, le liseré l\'est', '*spotlight', async ({ page, lit, boite }) => {
  const b = await boite()
  assert.equal(await lit(`${a}.getAttribute('mjs-fx-spot-where')`), 'border')
  assert.equal(await lit(`getComputedStyle(${a}, '::after').display`), 'none', 'pas de halo')
  assert.notEqual(await lit(`getComputedStyle(${a}, '::before').display`), 'none', 'le liseré reste')
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForFunction(`${lisere}[0] === '100.0px'`, null, { timeout: 8000 })
}, '', SANS_ANIMATION)

describe('*spotlight en production — chaque pose construite avec le seul code de ses réglages', function () {
  this.timeout(1800000)
  const scripts: string[] = []

  before(async () => {
    for (const [i, pose] of POSES.entries()) {
      const root   = mjsTmp('spotlight-prod-' + i)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 't-' + i + '.mjs'), pose.source)
      // un seul fichier (le manifeste) : les noms réduits des morceaux ne se heurtent pas
      const manifeste = join(outDir, 'bundle.js')
      // production au niveau 'warn' : l'avertissement vérifié plus bas reste dans le code envoyé (le défaut 'error' retire ceux du framework)
      const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod', logLevel: 'warn' } as any)
      const stats     = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [], pose.nom)
      scripts.push(stripEsm(readFileSync(manifeste, 'utf-8')))
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Navigateur[]) {
    describe(nom, function () {
      let browser: any

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { await browser?.close() })

      POSES.forEach((pose, i) => {
        it(pose.nom, async () => {
          const tag     = 'mjs-t-' + i
          const page    = await (await browser.newContext({ viewport: { width: 340, height: 300 } })).newPage()
          const erreurs: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[ModularJS]'))) erreurs.push(m.text()) })
          if (pose.avant) await page.addInitScript(pose.avant)
          await page.addInitScript(`window.__racine = (tag) => {
            const el = document.querySelector(tag)
            if (!el) return null
            if (el.shadowRoot) return el.shadowRoot
            for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
            return el
          }`)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${scripts[i]}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(`!!window.__racine('${tag}')?.querySelector('.a')`, null, { timeout: 20000 })
          await page.waitForTimeout(400)
          // TAG est remplacé par la balise du composant dans chaque expression lue dans la page
          const lit = (js: string) => page.evaluate(js.replace(/TAG/g, `'${tag}'`))
          const evaluate = page.evaluate.bind(page)
          page.evaluate = (js: any, ...args: any[]) => evaluate(typeof js === 'string' ? js.replace(/TAG/g, `'${tag}'`) : js, ...args)
          const waitForFunction = page.waitForFunction.bind(page)
          page.waitForFunction = (js: any, ...args: any[]) => waitForFunction(typeof js === 'string' ? js.replace(/TAG/g, `'${tag}'`) : js, ...args)
          const boite = () => lit(`(() => { const r = window.__racine(TAG).querySelector('.a').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`)
          const pixels = async (points: Array<[number, number]>): Promise<number[][]> => {
            const shot = await page.screenshot()
            return evaluate(`(async ([b64, pts]) => {
              const img = new Image()
              img.src = 'data:image/png;base64,' + b64
              await img.decode()
              const cv = document.createElement('canvas')
              cv.width = img.width
              cv.height = img.height
              const c = cv.getContext('2d', { willReadFrequently: true })
              c.drawImage(img, 0, 0)
              return pts.map(([x, y]) => Array.from(c.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3))
            })(${JSON.stringify([shot.toString('base64'), points])})`)
          }
          try {
            await pose.verifie({ page, lit, boite, pixels, script: scripts[i], erreurs })
            assert.deepEqual(erreurs, [])
          }
          finally {
            await page.close()
          }
        })
      })
    })
  }
})
