// *marquee dans Chromium, Firefox et WebKit réels (WebKit seulement s'il est installé) : le mode « balises » (la piste des enfants) n'est envoyé qu'aux applis
// dont une pose en a besoin.
// EN PRODUCTION : le texte défile comme avant ; une balise à balises défile comme avant ; une balise vide qu'un script remplit, dans une appli qui n'a
// aucune pose à balises, garde ses balises en place (seul leur texte défile, recopié sur le calque du texte ; aucune erreur, aucun avertissement) ; avec `unit: child` elles défilent ; une liste {for} qui
// grandit défile ; dans une appli où une autre pose a le mode, la balise remplie par script défile aussi, sans avertissement.
// EN DÉVELOPPEMENT (le fichier entier, le mode est donc là) : le mode se met en route sur une balise que la production aurait construite sans lui (vide, remplie
// par un script avant la pose (`@attach`, `@attach.once`) ou après, sans `unit: child`) : un avertissement, une fois par balise, jamais pour une pose qui demande
// le mode (`unit: child`, `drag`, `axis: both`, `on: scroll`, ou une variable valant `auto` ou `child`), ni pour une balise à balises du gabarit, ni pour une balise de texte.
// CE QUE LE NAVIGATEUR NE GARDE PAS COMME DU TEXTE (section CDATA, instruction, doctype, `<!x>`, U+0000) : des éléments qu'il sépare ainsi défilent en production,
// et le développement se tait.
// EN PRODUCTION AVEC LE FICHIER DE L'EFFET ENTIER (demande explicite du module) : le registre des composants (`µ.instances`) n'existe pas, l'avertissement du développement se tait.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const STYLE = '\n<style>\n:host\n  display: block\ndiv\n  box-sizing: border-box\n.a\n  width: 400px\n  height: 60px\n  margin: 10px\n.logo\n  width: 100px\n  height: 40px\n</style>\n'
const LOGOS = '<div class="logo">A</div><div class="logo">B</div><div class="logo">C</div>'
const SCRIPT = '<script>\n$l = []\n</script>\n'
// de quoi poser du HTML par @html=!{…}, et un réglage tenu par une variable
const SCRIPT_BIS = '<script>\n$l = []\n$h = \'<div class="logo">H1</div><div class="logo">H2</div>\'\n$u = \'auto\'\n</script>\n'
// une fonction que `@attach` appelle avec la balise : elle y pose trois balises, avant la pose de l'effet ; elle finit par `return`,
// sinon Civet rendrait la liste des valeurs de sa boucle, que le développement signale (une attache qui ne rend pas une fonction)
const FILL = `function fill(n) {
  for (const t of ['A', 'B', 'C']) {
    const d = document.createElement('div')
    d.className = 'logo'
    d.textContent = t
    n.appendChild(d)
  }
  return
}`
const SCRIPT_FILL = '<script>\n$l = []\n' + FILL + '\n</script>\n'
// trois balises, la construction que le navigateur ne garde pas entre la première et la suivante
const LOGO = (t: string) => `<div class="logo">${t}</div>`
const AVEC = (construction: string) => LOGO('A') + construction + LOGO('B') + LOGO('C')
// la famille : un commentaire ou rien pour le navigateur, du texte pour qui lit le gabarit tel qu'il est écrit
const FAMILLE: Array<[string, string]> = [
  ['c', '<![CDATA[x]]>'],
  ['i', '<?xml version="1.0"?>'],
  ['d', '<!DOCTYPE html>'],
  ['b', '<!x>'],
  ['z', '\u0000']
]
const BALISES_FAMILLE = FAMILLE.map(([c, b]) => `<div class="a ${c}" *marquee(speed: 4s, gap: 10)>${AVEC(b)}</div>`).join('')
// une construction ouverte sous un enfant avale sa fermante : le texte qui suit entre dans l'enfant, la balise n'a plus qu'un élément pour enfant. Elle défait aussi
// ce qui la suit dans le gabarit (la balise `b` rouverte autour des nœuds suivants) : cette balise-là ferme le gabarit
const BALISE_PROFONDE = '<div class="a n" *marquee(speed: 4s, gap: 10)><b class="logo">x<?</b>texte</div>'
// le navigateur ferme la construction au premier `>` : `b]]>` reste du texte
const BALISE_TEXTE = `<div class="a g" *marquee(speed: 4s, gap: 10)>${AVEC('<![CDATA[a>b]]>')}</div>`
// les poses qui demandent déjà le défilé des balises (le build lit ces réglages, le compilateur n'écrit rien de plus) : une balise qu'un script remplit y défile sans que le développement ait à le dire
const DEMANDES: Array<[string, string]> = [
  ['c', 'unit: child'],
  ['d', 'drag: true'],
  ['x', 'axis: both'],
  ['s', 'on: scroll']
]

// une page = une application construite ; `env` : la production réduite, ou le développement (le fichier de l'effet entier) ; `options` : d'autres réglages du build
// (la demande explicite d'un module le fait partir entier, même en production)
type Appli = { nom: string, env: 'prod' | 'dev', options?: Record<string, unknown>, source: string, verifie: (ctx: Ctx) => Promise<void> }
type Ctx   = { page: any, tag: string, lit: (js: string) => Promise<any>, avis: string[] }

// les balises que la pose `classe` tient à l'instant : la piste, les copies, l'animation
const etat = (classe: string) => `(() => { const a = window.__racine(TAG).querySelector('.${classe}'); const r = a.querySelector('[mjs-fx-marquee-run]'); return { strip: a.getAttribute('mjs-fx-marquee-strip'), piste: !!r, copies: r ? r.querySelectorAll('[mjs-fx-marquee-copy]').length : 0, animation: r ? getComputedStyle(r).animationName : null, calque: !!a.querySelector('[mjs-fx-marquee-track]') } })()`
// un script qui remplit la balise de trois balises
const remplir = (classe: string) => `(() => { const a = window.__racine(TAG).querySelector('.${classe}'); for (const t of ['A', 'B', 'C']) { const d = document.createElement('div'); d.className = 'logo'; d.textContent = t; a.appendChild(d) } })()`
const vider = (classe: string) => `(() => { const a = window.__racine(TAG).querySelector('.${classe}'); for (const d of [...a.querySelectorAll('.logo')]) if (!d.closest('[mjs-fx-marquee-copy]')) d.remove() })()`
const gauche = (classe: string) => `(() => { const l = window.__racine(TAG).querySelector('.${classe} .logo'); return l ? Math.round(l.getBoundingClientRect().left * 10) / 10 : null })()`
const attend = async (page: any, js: string) => page.waitForFunction(js, null, { timeout: 10000 })

const APPLIS: Appli[] = [
  {
    nom: 'production, sans pose à balises : le texte défile, une balise remplie par script garde ses balises en place (seul leur texte défile)',
    env: 'prod',
    source: SCRIPT + `<div class="a t" *marquee(speed: 4s)>Un texte qui défile</div><div class="a v" *marquee(speed: 4s, gap: 10)></div>` + STYLE,
    verifie: async ({ page, lit, avis }) => {
      assert.deepEqual(await lit(etat('t')), { strip: null, piste: false, copies: 0, animation: null, calque: true }, 'le texte garde son calque')
      assert.equal(await lit(`getComputedStyle(window.__racine(TAG).querySelector('.t [mjs-fx-marquee-track]')).animationName`), 'mjs-fx-marquee')
      await page.evaluate(remplir('v'))
      await page.waitForTimeout(500)
      const avant = await lit(gauche('v'))
      assert.equal(await lit(`window.__racine(TAG).querySelectorAll('.v .logo').length`), 3, 'les trois balises sont arrivées')
      await page.waitForTimeout(900)
      assert.deepEqual(await lit(etat('v')), { strip: null, piste: false, copies: 0, animation: null, calque: true }, 'aucune piste des enfants : le code n\'est pas là')
      assert.equal(await lit(gauche('v')), avant, 'les balises ajoutées restent en place : la première ne bouge pas')
      assert.match(await lit(`window.__racine(TAG).querySelector('.v [mjs-fx-marquee-track]').textContent`), /ABC/, 'le calque du texte recopie le texte des balises ajoutées, et c\'est lui qui défile')
      assert.deepEqual(avis, [])
    }
  },
  {
    nom: 'production, avec le mode : balises du gabarit, unit: child, liste {for}, balise remplie par script',
    env: 'prod',
    source: SCRIPT + `<div class="a b" *marquee(speed: 4s, gap: 10)>${LOGOS}</div>`
      + `<div class="a u" *marquee(unit: child, speed: 4s, gap: 10)></div>`
      + `<div class="a s" *marquee(speed: 4s, gap: 10)></div>`
      + `<div class="a l" *marquee(speed: 4s)>{for i in $l}<div class="logo">{i}</div>{end}</div>`
      + `<button class="remplir" @click={$l = [1, 2, 3]}>remplir</button>` + STYLE,
    verifie: async ({ page, lit, avis }) => {
      const b = await lit(etat('b'))
      assert.equal(b.strip, 'kids')
      assert.ok(b.copies >= 1, 'les balises du gabarit défilent : ' + b.copies + ' copie(s)')
      assert.equal(b.animation, 'mjs-fx-marquee-run')
      // la liste vide commence en texte, puis passe à la piste quand elle grandit
      assert.equal((await lit(etat('l'))).piste, false)
      await page.evaluate(`window.__racine(TAG).querySelector('.remplir').click()`)
      await attend(page, `!!window.__racine(TAG).querySelector('.l > [mjs-fx-marquee-run]')`)
      assert.equal((await lit(etat('l'))).strip, 'kids')
      // `unit: child` : la balise vide qu'un script remplit défile
      await page.evaluate(remplir('u'))
      await attend(page, `!!window.__racine(TAG).querySelector('.u > [mjs-fx-marquee-run]')`)
      const u = await lit(etat('u'))
      assert.equal(u.strip, 'kids')
      assert.equal(u.animation, 'mjs-fx-marquee-run')
      // sans `unit: child`, mais dans une appli où une autre pose a le mode : le code est là, la balise défile aussi — et la production se tait
      await page.evaluate(remplir('s'))
      await attend(page, `!!window.__racine(TAG).querySelector('.s > [mjs-fx-marquee-run]')`)
      assert.equal((await lit(etat('s'))).strip, 'kids')
      await page.waitForTimeout(300)
      assert.deepEqual(avis, [], 'aucun avertissement en production')
    }
  },
  {
    nom: 'développement : l\'avertissement paraît une fois pour la balise remplie par script, jamais pour les autres',
    env: 'dev',
    source: SCRIPT + `<div class="a s" *marquee(speed: 4s, gap: 10)></div>`
      + `<div class="a u" *marquee(unit: child, speed: 4s, gap: 10)></div>`
      + `<div class="a b" *marquee(speed: 4s, gap: 10)>${LOGOS}</div>`
      + `<div class="a l" *marquee(speed: 4s)>{for i in $l}<div class="logo">{i}</div>{end}</div>`
      + `<button class="remplir" @click={$l = [1, 2, 3]}>remplir</button>` + STYLE,
    verifie: async ({ page, lit, avis, tag }) => {
      // rien n'a encore été rempli, et le gabarit n'a rien promis de faux : aucun avertissement
      await page.waitForTimeout(400)
      assert.deepEqual(avis, [], 'la balise à balises du gabarit, la liste vide et unit: child ne disent rien')
      await page.evaluate(`window.__racine(TAG).querySelector('.remplir').click()`)
      await attend(page, `!!window.__racine(TAG).querySelector('.l > [mjs-fx-marquee-run]')`)
      await page.evaluate(remplir('u'))
      await attend(page, `!!window.__racine(TAG).querySelector('.u > [mjs-fx-marquee-run]')`)
      await page.waitForTimeout(300)
      assert.deepEqual(avis, [], 'la liste {for} qui grandit et la pose à unit: child ne disent rien non plus')
      // la balise que le gabarit ne promettait pas de remplir : elle défile (le fichier entier est là) et le développement le dit
      await page.evaluate(remplir('s'))
      await attend(page, `!!window.__racine(TAG).querySelector('.s > [mjs-fx-marquee-run]')`)
      await page.waitForTimeout(300)
      assert.equal(avis.length, 1, 'un avertissement : ' + JSON.stringify(avis))
      assert.match(avis[0], /^\[ModularJS\] \*marquee/)
      assert.match(avis[0], /unit: child/)
      assert.match(avis[0], /production/)
      assert.ok(avis[0].includes('<' + tag + '>'), 'il nomme le composant : ' + avis[0])
      // la balise bascule du texte à la piste et retour, plusieurs fois : toujours un seul avertissement
      for (let i = 0; i < 3; i++) {
        await page.evaluate(vider('s'))
        await attend(page, `!window.__racine(TAG).querySelector('.s > [mjs-fx-marquee-run]')`)
        await page.evaluate(remplir('s'))
        await attend(page, `!!window.__racine(TAG).querySelector('.s > [mjs-fx-marquee-run]')`)
      }
      await page.waitForTimeout(600)
      assert.equal(avis.length, 1, 'toujours un seul avertissement après trois bascules : ' + JSON.stringify(avis))
      assert.equal((await lit(etat('b'))).strip, 'kids', 'la balise à balises du gabarit défile')
    }
  },
  {
    nom: 'production : des balises séparées par un blanc écrit en entité, ou posées par @html=!{…}, défilent ; un texte nu garde son calque',
    env: 'prod',
    source: SCRIPT_BIS + `<div class="a n" *marquee(speed: 4s, gap: 10)>&nbsp;${LOGOS}</div>`
      + `<div class="a e" *marquee(speed: 4s, gap: 10)><div class="logo">A</div>&ensp;<div class="logo">B</div>&#32;<div class="logo">C</div>&Tab;</div>`
      + `<div class="a h" *marquee(speed: 4s, gap: 10) @html=!{$h}></div>`
      + `<div class="a x" *marquee(speed: 4s, gap: 10)>Soldes&nbsp;${LOGOS}</div>` + STYLE,
    verifie: async ({ page, lit, avis }) => {
      for (const c of ['n', 'e', 'h']) {
        await attend(page, `!!window.__racine(TAG).querySelector('.${c} > [mjs-fx-marquee-run]')`)
        const e = await lit(etat(c))
        assert.equal(e.strip, 'kids', `.${c} : les balises défilent sur la piste : ` + JSON.stringify(e))
        assert.ok(e.copies >= 1, `.${c} : ` + e.copies + ' copie(s)')
        assert.equal(e.animation, 'mjs-fx-marquee-run')
      }
      assert.deepEqual(await lit(etat('x')), { strip: null, piste: false, copies: 0, animation: null, calque: true }, 'un texte nu avec des balises garde le calque du texte')
      await page.waitForTimeout(300)
      assert.deepEqual(avis, [])
    }
  },
  {
    nom: 'développement : aucun avertissement pour des balises que le gabarit écrit (blanc en entité, @html=!{…})',
    env: 'dev',
    source: SCRIPT_BIS + `<div class="a n" *marquee(speed: 4s, gap: 10)>&nbsp;${LOGOS}</div>`
      + `<div class="a e" *marquee(speed: 4s, gap: 10)><div class="logo">A</div>&ensp;<div class="logo">B</div>&#32;<div class="logo">C</div>&Tab;</div>`
      + `<div class="a h" *marquee(speed: 4s, gap: 10) @html=!{$h}></div>` + STYLE,
    verifie: async ({ page, lit, avis }) => {
      for (const c of ['n', 'e', 'h']) {
        await attend(page, `!!window.__racine(TAG).querySelector('.${c} > [mjs-fx-marquee-run]')`)
        assert.equal((await lit(etat(c))).strip, 'kids', `.${c} défile sur la piste`)
      }
      await page.waitForTimeout(600)
      assert.deepEqual(avis, [], 'le gabarit écrit ces balises : le développement ne dit rien')
    }
  },
  {
    nom: 'développement : aucun avertissement pour unit tenu par une variable sur des balises du gabarit',
    env: 'dev',
    source: SCRIPT_BIS + `<div class="a v" *marquee(unit: $u, speed: 4s, gap: 10)>${LOGOS}</div>` + STYLE,
    verifie: async ({ page, lit, avis }) => {
      await attend(page, `!!window.__racine(TAG).querySelector('.v > [mjs-fx-marquee-run]')`)
      assert.equal((await lit(etat('v'))).strip, 'kids')
      await page.waitForTimeout(600)
      assert.deepEqual(avis, [], 'unit est tenu par une variable : le défilé des balises est gardé en production, quelle que soit sa valeur')
    }
  },
  {
    nom: 'production : des balises séparées par une section CDATA, une instruction, un doctype, <!x> ou U+0000 défilent ; `b]]>` reste du texte',
    env: 'prod',
    source: SCRIPT_BIS + BALISES_FAMILLE + BALISE_TEXTE + BALISE_PROFONDE + STYLE,
    verifie: async ({ page, lit, avis }) => {
      for (const c of [...FAMILLE.map(([k]) => k), 'n']) {
        await attend(page, `!!window.__racine(TAG).querySelector('.${c} > [mjs-fx-marquee-run]')`)
        const e = await lit(etat(c))
        assert.equal(e.strip, 'kids', `.${c} : les balises défilent sur la piste : ` + JSON.stringify(e))
        assert.ok(e.copies >= 1, `.${c} : ` + e.copies + ' copie(s)')
        assert.equal(e.animation, 'mjs-fx-marquee-run')
      }
      await attend(page, `!!window.__racine(TAG).querySelector('.g [mjs-fx-marquee-track]')`)
      assert.deepEqual(await lit(etat('g')), { strip: null, piste: false, copies: 0, animation: null, calque: true }, 'un texte reste un texte : le calque')
      assert.match(await lit(`window.__racine(TAG).querySelector('.g [mjs-fx-marquee-track]').textContent`), /b\]\]>/)
      await page.waitForTimeout(300)
      assert.deepEqual(avis, [])
    }
  },
  {
    nom: 'développement : aucun avertissement pour des balises séparées par ce que le navigateur ne garde pas comme du texte',
    env: 'dev',
    source: SCRIPT_BIS + BALISES_FAMILLE + BALISE_TEXTE + BALISE_PROFONDE + STYLE,
    verifie: async ({ page, lit, avis }) => {
      for (const c of [...FAMILLE.map(([k]) => k), 'n']) {
        await attend(page, `!!window.__racine(TAG).querySelector('.${c} > [mjs-fx-marquee-run]')`)
        assert.equal((await lit(etat(c))).strip, 'kids', `.${c} défile sur la piste`)
      }
      await attend(page, `!!window.__racine(TAG).querySelector('.g [mjs-fx-marquee-track]')`)
      assert.equal((await lit(etat('g'))).calque, true, 'un texte reste un texte : le calque')
      await page.waitForTimeout(600)
      assert.deepEqual(avis, [], 'le compilateur a écrit unit: child : le développement ne dit rien')
    }
  },
  {
    nom: 'développement : @attach et @attach.once qui remplissent la balise, avant la pose ou après, avertissent, une fois par balise',
    env: 'dev',
    // `k` et `o` : la fonction remplit la balise AVANT la pose de l'effet (l'attribut est écrit avant lui) ; `a` et `p` : après
    source: SCRIPT_FILL + `<div class="a k" @attach={fill} *marquee(speed: 4s, gap: 10)></div><div class="a o" @attach.once={fill} *marquee(speed: 4s, gap: 10)></div>`
      + `<div class="a a2" *marquee(speed: 4s, gap: 10) @attach={fill}></div><div class="a p" *marquee(speed: 4s, gap: 10) @attach.once={fill}></div>` + STYLE,
    verifie: async ({ page, avis, tag }) => {
      for (const c of ['k', 'o', 'a2', 'p']) await attend(page, `!!window.__racine(TAG).querySelector('.${c} > [mjs-fx-marquee-run]')`)
      await page.waitForTimeout(500)
      assert.equal(avis.length, 4, 'un avertissement par balise : ' + JSON.stringify(avis))
      for (const a of avis) {
        assert.match(a, /^\[ModularJS\] \*marquee/)
        assert.match(a, /unit: child/)
        assert.match(a, /production/)
        assert.ok(a.includes('<' + tag + '>'), 'il nomme le composant : ' + a)
      }
      // la balise passe de la piste au texte et retour : toujours un avertissement par balise
      for (const c of ['k', 'o', 'a2', 'p']) {
        await page.evaluate(vider(c))
        await attend(page, `!window.__racine(TAG).querySelector('.${c} > [mjs-fx-marquee-run]')`)
        await page.evaluate(remplir(c))
        await attend(page, `!!window.__racine(TAG).querySelector('.${c} > [mjs-fx-marquee-run]')`)
      }
      await page.waitForTimeout(600)
      assert.equal(avis.length, 4, 'toujours un seul avertissement par balise : ' + JSON.stringify(avis))
    }
  },
  {
    nom: 'développement : unit: auto en clair sur une balise vide qu\'un script remplit avertit ; unit tenu par une variable valant auto, et un texte avec des balises en ligne, non',
    env: 'dev',
    source: SCRIPT_BIS + `<div class="a e" *marquee(unit: auto, speed: 4s, gap: 10)></div>`
      + `<div class="a v" *marquee(unit: $u, speed: 4s, gap: 10)></div>`
      + `<div class="a x" *marquee(speed: 4s, gap: 10)>Bonjour <b>vous</b></div>` + STYLE,
    verifie: async ({ page, lit, avis }) => {
      await page.waitForTimeout(500)
      assert.deepEqual(avis, [], 'rien n\'est rempli, et un texte avec des balises en ligne garde son calque : rien à dire')
      assert.equal((await lit(etat('x'))).calque, true)
      // la variable vaut auto : le build garde le mode, la production fait défiler ces balises ; le développement se tait
      await page.evaluate(remplir('v'))
      await attend(page, `!!window.__racine(TAG).querySelector('.v > [mjs-fx-marquee-run]')`)
      await page.waitForTimeout(400)
      assert.deepEqual(avis, [], 'unit: $u valant auto sur une balise vide remplie par un script : aucun avertissement')
      // auto écrit en clair vaut le défaut : le compilateur n'envoie pas le mode pour une balise vide, le développement le dit
      await page.evaluate(remplir('e'))
      await attend(page, `!!window.__racine(TAG).querySelector('.e > [mjs-fx-marquee-run]')`)
      await page.waitForTimeout(400)
      assert.equal(avis.length, 1, 'un avertissement : ' + JSON.stringify(avis))
      assert.match(avis[0], /unit: child/)
    }
  },
  {
    nom: 'développement : une pose qui demande déjà le défilé des balises (unit: child, drag, axis: both, on: scroll) n\'avertit pas quand un script lui donne des balises',
    env: 'dev',
    // `c`, `d`, `x`, `s` : la fonction remplit la balise AVANT la pose ; `u` : vide à la pose, un script la remplit après (la balise passe du calque à la piste)
    source: SCRIPT_FILL + DEMANDES.map(([c, r]) => `<div class="a ${c}" @attach={fill} *marquee(${r}, speed: 4s, gap: 10)></div>`).join('') + `<div class="a u" *marquee(unit: child, speed: 4s, gap: 10)></div>` + STYLE,
    verifie: async ({ page, lit, avis }) => {
      for (const [c] of DEMANDES) await attend(page, `window.__racine(TAG).querySelector('.${c}').getAttribute('mjs-fx-marquee-strip') === 'kids'`)
      await page.waitForTimeout(500)
      assert.deepEqual(avis, [], 'des balises déjà là à la pose, sur une pose qui demande le défilé : rien à dire')
      await page.evaluate(remplir('u'))
      await attend(page, `window.__racine(TAG).querySelector('.u').getAttribute('mjs-fx-marquee-strip') === 'kids'`)
      await page.waitForTimeout(500)
      assert.deepEqual(avis, [], 'des balises qui arrivent après la pose, sur une pose à unit: child : rien à dire non plus')
      assert.equal((await lit(etat('u'))).piste, true)
    }
  },
  {
    nom: 'production avec le fichier de l\'effet entier (demande explicite du module) : aucun avertissement du développement, les balises remplies par script défilent',
    env: 'prod',
    options: { runtime: ['fx_marquee'] },
    // `k` : la fonction remplit la balise avant la pose ; `s` : vide, un script la remplit après
    source: SCRIPT_FILL + `<div class="a k" @attach={fill} *marquee(speed: 4s, gap: 10)></div><div class="a s" *marquee(speed: 4s, gap: 10)></div>` + STYLE,
    verifie: async ({ page, lit, avis }) => {
      await attend(page, `!!window.__racine(TAG).querySelector('.k > [mjs-fx-marquee-run]')`)
      await page.evaluate(remplir('s'))
      await attend(page, `!!window.__racine(TAG).querySelector('.s > [mjs-fx-marquee-run]')`)
      await page.waitForTimeout(500)
      assert.deepEqual(avis, [], 'le fichier entier est là mais pas le registre des composants : ni avertissement ni clé de libellé affichée')
      assert.equal((await lit(etat('k'))).strip, 'kids')
      assert.equal((await lit(etat('s'))).strip, 'kids')
    }
  }
]

describe('*marquee — le mode « balises » ne part que si une pose le demande (navigateurs réels)', function () {
  this.timeout(1800000)
  const scripts: string[] = []

  before(async () => {
    for (const [i, appli] of APPLIS.entries()) {
      const root   = mjsTmp('marquee-tri-nav-' + i)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'z-' + i + '.mjs'), appli.source)
      // un seul fichier (le manifeste) : les noms réduits des morceaux ne se heurtent pas
      const manifeste = join(outDir, 'bundle.js')
      const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle' }
      if (appli.env === 'prod') options.env = 'prod'
      if (appli.options) Object.assign(options, appli.options)
      const bundler = new Bundler(options)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [], appli.nom)
      scripts.push(stripEsm(readFileSync(manifeste, 'utf-8')))
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Array<'chromium' | 'firefox' | 'webkit'>) {
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

      APPLIS.forEach((appli, i) => {
        it(appli.nom, async () => {
          const tag     = 'mjs-z-' + i
          const page    = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage()
          const erreurs: string[] = []
          const avis: string[]    = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => {
            if (m.type() === 'error') erreurs.push(m.text())
            else if (m.type() === 'warning' && m.text().startsWith('[ModularJS]')) avis.push(m.text())
          })
          await page.addInitScript(`window.__racine = (tag) => {
            const el = document.querySelector(tag)
            if (!el) return null
            if (el.shadowRoot) return el.shadowRoot
            for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
            return el
          }`)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><${tag}></${tag}><script>${scripts[i]}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(`!!window.__racine('${tag}')?.querySelector('.a')`, null, { timeout: 20000 })
          await page.waitForTimeout(300)
          // TAG est remplacé par la balise du composant dans chaque expression lue dans la page
          const lit = (js: string) => page.evaluate(js.replace(/TAG/g, `'${tag}'`))
          const evaluate = page.evaluate.bind(page)
          page.evaluate = (js: any, ...args: any[]) => evaluate(typeof js === 'string' ? js.replace(/TAG/g, `'${tag}'`) : js, ...args)
          const waitForFunction = page.waitForFunction.bind(page)
          page.waitForFunction = (js: any, ...args: any[]) => waitForFunction(typeof js === 'string' ? js.replace(/TAG/g, `'${tag}'`) : js, ...args)
          try {
            await appli.verifie({ page, tag, lit, avis })
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
