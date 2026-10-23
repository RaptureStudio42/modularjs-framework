// *flipcard — une carte à deux faces qui se retourne en 3D : les deux faces marquées, le verso
// inerte tant qu'il est caché, hover / click / view / none, la variable `flipped` suivie sans
// reposer l'effet, le clavier, les refus de compilation, un composant, le retrait sans reste.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const FACES = '<div class="r">recto</div><div class="v">verso</div>'

const COMPOSANTS: Record<string, string> = {
  'fx-carte':          `<div class="a" *flipcard>${FACES}</div>`,
  'fx-carte-regles':   `<div class="a" *flipcard(x, reverse: true, perspective: 500, duration: 1s, easing: ease-in-out, shadow: false, radius: 12)>${FACES}</div>`,
  'fx-carte-rebond':   `<div class="a" *flipcard(easing: bounce-out)>${FACES}</div>`,
  'fx-carte-clic':     `<div class="a" *flipcard(on: click)>${FACES}</div><div class="f" tabindex="0" *flipcard(on: click)>${FACES}</div>`,
  'fx-carte-aucune':   `<div class="a" *flipcard(on: none, flipped: true)>${FACES}</div>`,
  'fx-carte-seule':    '<div class="a" *flipcard><div class="r">recto</div></div>',
  'fx-carte-var':      `<script>\n$ouverte = false\n</script>\n<div class="a" *flipcard(on: none, flipped: $ouverte)>${FACES}</div>\n<button class="t" @click={$ouverte = !$ouverte}>t</button>`,
  'fx-carte-boite':    '<slot></slot>',
  'fx-carte-hote':     `<@fx-carte-boite class="h" *flipcard>${FACES}</@fx-carte-boite>`,
  'fx-carte-natives':  `<a class="a" href="#plus-loin" *flipcard>${FACES}</a><button class="b" *flipcard>${FACES}</button>`,
  'fx-carte-retrait':  `<script>\n$on = true\n</script>\n{if $on}<div class="a" *flipcard>${FACES}</div>{end}\n<button class="t" @click={$on = !$on}>t</button>`,
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *flipcard', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-carte-deux-faces')
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
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string, sel = '.a') {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await pause()
    return comp
  }

  const face   = (el: any, nom: string) => el.querySelector(`[mjs-fx-flipcard-face="${nom}"]`)
  const retourne = (el: any) => el.style.getPropertyValue('--mjs-fx-flipcard-t') === '1'

  it('*flipcard : le premier enfant est le recto, le second le verso, inerte tant qu\'il est caché', async () => {
    const comp = await monter('mjs-fx-carte')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(face(el, 'front') === el.querySelector('.r'), 'face front')
    assert.ok(face(el, 'back') === el.querySelector('.v'), 'face back')
    assert.equal(retourne(el), false)
    assert.equal(el.querySelector('.v').hasAttribute('inert'), true, 'verso caché : inerte')
    assert.equal(el.querySelector('.r').hasAttribute('inert'), false)
    assert.equal(el.hasAttribute('mjs-fx-flipcard-shadow'), true, 'ombre par défaut')
    assert.equal(el.hasAttribute('mjs-fx-flipcard-x'), false, 'axe y par défaut')
    const cmd = el.querySelector(':scope > [mjs-fx-flipcard-turn]')
    assert.ok(!!cmd && cmd.localName === 'button' && el.firstElementChild === cmd, 'on: hover : une commande, le premier enfant, pour que Tab atteigne la carte')
    assert.equal(el.hasAttribute('tabindex') || el.hasAttribute('role'), false, 'la carte elle-même ne reçoit ni tabindex ni rôle')
  })

  it('on: hover — le survol retourne la carte, la sortie la remet ; l\'inert bascule avec elle', async () => {
    const comp = await monter('mjs-fx-carte')
    const el   = comp._shadow.querySelector('.a')
    el.dispatchEvent(new window.PointerEvent('pointerenter'))
    assert.equal(retourne(el), true)
    assert.equal(el.querySelector('.r').hasAttribute('inert'), true, 'recto caché : inerte')
    assert.equal(el.querySelector('.v').hasAttribute('inert'), false)
    el.dispatchEvent(new window.PointerEvent('pointerleave'))
    assert.equal(retourne(el), false)
    assert.equal(el.querySelector('.v').hasAttribute('inert'), true)
  })

  it('on: click — chaque clic retourne ; sa commande pressée aussi (Entrée, Espace), ou Entrée et Espace sur une balise à tabindex', async () => {
    const comp = await monter('mjs-fx-carte-clic', '.f')
    const el   = comp._shadow.querySelector('.a')
    el.click()
    assert.equal(retourne(el), true)
    el.click()
    assert.equal(retourne(el), false)
    // sans tabindex : l'effet pose une commande ; la presser (Entrée, Espace : son clic) retourne la carte
    assert.equal(el.hasAttribute('tabindex'), false)
    const cmd = el.querySelector(':scope > [mjs-fx-flipcard-turn]')
    cmd.click()
    assert.equal(retourne(el), true, 'la commande pressée retourne la carte')
    assert.equal(cmd.getAttribute('aria-pressed'), 'true')
    cmd.click()
    assert.equal(retourne(el), false)
    assert.equal(cmd.getAttribute('aria-pressed'), 'false')
    const f = comp._shadow.querySelector('.f')
    f.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    assert.equal(retourne(f), true, 'Entrée')
    f.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    assert.equal(retourne(f), false, 'Espace')
    f.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }))
    assert.equal(retourne(f), false, 'une autre touche ne fait rien')
  })

  it('on: hover — le focus au clavier sur sa commande retourne la carte, sa perte la remet ; le focus dans le verso la retient ; la commande pressée bascule, Échap remet', async () => {
    const comp = await monter('mjs-fx-carte')
    const el   = comp._shadow.querySelector('.a')
    const verso = el.querySelector('.v')
    const cmd   = el.querySelector(':scope > [mjs-fx-flipcard-turn]')
    // happy-dom ne sait pas dire `:focus-visible` : on le donne vrai (focus pris au clavier)
    // (par le prototype : l'effet interroge la commande elle-même, jamais un champ posé sur l'élément)
    const matches = window.Element.prototype.matches
    window.Element.prototype.matches = function (this: any, q: string) { return this === cmd && q === ':focus-visible' ? true : matches.call(this, q) }
    try {
      cmd.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }))
      assert.equal(retourne(el), true, 'focus : verso')
      cmd.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true, relatedTarget: verso }))
      assert.equal(retourne(el), true, 'le focus passe dans le verso : la carte reste retournée')
      verso.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }))
      el.dispatchEvent(new window.PointerEvent('pointerleave'))
      assert.equal(retourne(el), true, 'focus dans le verso : la sortie du pointeur ne la remet pas')
      verso.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
      assert.equal(retourne(el), false, 'le focus sort de la carte : recto')
      // Entrée et Espace sur la commande : son clic
      cmd.click()
      assert.equal(retourne(el), true, 'la commande pressée bascule')
      cmd.click()
      assert.equal(retourne(el), false, 'pressée encore : recto')
      cmd.click()
      cmd.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      assert.equal(retourne(el), false, 'Échap remet')
    }
    finally {
      window.Element.prototype.matches = matches
    }
  })

  it('on: hover sur un lien ou un bouton : Entrée et Espace gardent leur action, aucun tabindex ajouté', async () => {
    const comp = await monter('mjs-fx-carte-natives', '.b')
    for (const q of ['.a', '.b']) {
      const el = comp._shadow.querySelector(q)
      assert.equal(el.hasAttribute('tabindex'), false, `${q} : focalisable de lui-même, aucun tabindex`)
      for (const key of ['Enter', ' ']) {
        const ev = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        el.dispatchEvent(ev)
        assert.equal(ev.defaultPrevented, false, `${q} : ${key === ' ' ? 'Espace' : 'Entrée'} garde son action (lien suivi, bouton cliqué)`)
      }
      assert.equal(retourne(el), false, `${q} : la touche ne retourne pas la carte (c'est le focus qui la retourne)`)
    }
  })

  it('un tabindex déjà écrit est gardé tel quel et rendu ; la commande de l\'effet part avec lui ; view et none n\'en posent pas', async () => {
    const comp = await monter('mjs-fx-carte-clic', '.f')
    assert.equal(comp._shadow.querySelector('.f').getAttribute('tabindex'), '0')
    window.µ._mjs_fxClear(comp._shadow.querySelector('.f'))
    assert.equal(comp._shadow.querySelector('.f').getAttribute('tabindex'), '0', 'le tabindex de l\'auteur reste')
    assert.equal(!!comp._shadow.querySelector('.f [mjs-fx-flipcard-turn]'), false, 'une balise à tabindex répond elle-même : aucune commande')
    window.µ._mjs_fxClear(comp._shadow.querySelector('.a'))
    assert.equal(!!comp._shadow.querySelector('.a [mjs-fx-flipcard-turn]'), false, 'la commande de l\'effet part avec lui')
    assert.equal(comp._shadow.querySelector('.a').hasAttribute('tabindex'), false)
    const fixe = await monter('mjs-fx-carte-aucune')
    assert.equal(fixe._shadow.querySelector('.a').hasAttribute('tabindex') || !!fixe._shadow.querySelector('.a [mjs-fx-flipcard-turn]'), false, 'on: none : ni tabindex ni commande')
  })

  it('on: none, flipped: true — le verso dès le départ, ni survol ni clic n\'y changent rien', async () => {
    const comp = await monter('mjs-fx-carte-aucune')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(retourne(el), true)
    assert.equal(el.querySelector('.r').hasAttribute('inert'), true)
    el.dispatchEvent(new window.PointerEvent('pointerenter'))
    el.click()
    assert.equal(retourne(el), true)
  })

  it('flipped tenu par une variable : la carte suit, sans que l\'effet soit reposé', async () => {
    const comp = await monter('mjs-fx-carte-var')
    const el   = comp._shadow.querySelector('.a')
    const recto = el.querySelector('.r')
    assert.equal(retourne(el), false)
    comp._shadow.querySelector('.t').click()
    await attendre(() => retourne(el))
    assert.equal(retourne(el), true)
    assert.equal(recto.hasAttribute('inert'), true)
    assert.ok(el.querySelector('.r') === recto, 'mêmes faces, effet gardé')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !retourne(el))
    assert.equal(retourne(el), false)
    assert.equal(el.querySelector('.v').hasAttribute('inert'), true)
  })

  it('*flipcard(x, reverse, perspective, duration, easing, shadow, radius) : chaque réglage lu', async () => {
    const comp = await monter('mjs-fx-carte-regles')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.hasAttribute('mjs-fx-flipcard-x'), true, 'axe x')
    assert.equal(el.style.getPropertyValue('--mjs-fx-flipcard-s'), '-1', 'reverse : l\'autre sens')
    assert.equal(el.style.getPropertyValue('--mjs-flipcard-perspective'), '500px')
    assert.equal(el.style.getPropertyValue('--mjs-flipcard-duration'), '1s')
    assert.equal(el.style.getPropertyValue('--mjs-fx-flipcard-ease'), 'ease-in-out')
    assert.equal(el.hasAttribute('mjs-fx-flipcard-shadow'), false, 'shadow: false : pas d\'ombre')
    assert.equal(el.style.getPropertyValue('--mjs-flipcard-radius'), '12px')
    assert.equal(el.hasAttribute('mjs-fx-flipcard-radius'), true, 'l\'arrondi est donné aux faces')
  })

  it('une courbe de µeasing (bounce-out) devient un linear(…) que le CSS comprend', async () => {
    const comp = await monter('mjs-fx-carte-rebond')
    const el   = comp._shadow.querySelector('.a')
    const v    = el.style.getPropertyValue('--mjs-fx-flipcard-ease')
    assert.match(v, /^linear\((?:-?[\d.]+,){10,}-?[\d.]+\)$/)
    assert.ok(v.startsWith('linear(0,'), 'part de 0')
    assert.ok(v.endsWith(',1)'), 'finit à 1')
  })

  it('le CSS : faces empilées, dos caché, recto et verso tournés, calme si on réduit les animations', () => {
    const css = window.µ._mjs_fxDefs.flipcard.css
    assert.match(css, /\[mjs-fx~="flipcard"\]\{display:grid\}/)
    assert.match(css, /grid-area:1\/1/)
    assert.match(css, /backface-visibility:hidden/)
    assert.match(css, /perspective\(var\(--mjs-flipcard-perspective,1000px\)\)/)
    assert.match(css, /transition:transform var\(--mjs-flipcard-duration,600ms\) var\(--mjs-fx-flipcard-ease,ease\)/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*transition:none/)
  })

  it('moins de deux enfants : un avertissement en console (vouvoiement), aucune marque', async () => {
    const vu: string[] = []
    const vrai = window.µ.warn
    window.µ.warn = (...a: any[]) => { vu.push(a.join(' ')) }
    try {
      const comp = await monter('mjs-fx-carte-seule')
      const el   = comp._shadow.querySelector('.a')
      assert.equal(vu.length, 1, vu.join('|'))
      assert.match(vu[0], /\*flipcard/)
      assert.match(vu[0], /deux enfants/)
      assert.match(vu[0], /Ajoutez-lui/)
      assertAbsent(el.querySelector('[mjs-fx-flipcard-face]'), 'face marquée malgré un seul enfant')
      assert.equal(el.hasAttribute('mjs-fx-flipcard-shadow'), false)
    }
    finally {
      window.µ.warn = vrai
    }
  })

  it('posé sur un composant : les deux faces du composant sont marquées', async () => {
    const comp = await monter('mjs-fx-carte-hote', '.h')
    const hote = comp._shadow.querySelector('.h')
    await pause(30)
    assert.ok(face(hote, 'front') === hote.querySelector('.r'), 'face front')
    assert.ok(face(hote, 'back') === hote.querySelector('.v'), 'face back')
  })

  it('axis: z, perspective: 50, on: auto, duration: vite sont refusés à la compilation', async () => {
    await assert.rejects(compiler('<div *flipcard(z)><i></i><i></i></div>'), /\*flipcard : axis = z/)
    await assert.rejects(compiler('<div *flipcard(perspective: 50)><i></i><i></i></div>'), /\*flipcard : perspective = 50 — permis : int 100\.\.5000/)
    await assert.rejects(compiler('<div *flipcard(on: auto)><i></i><i></i></div>'), /\*flipcard : on = auto/)
    await assert.rejects(compiler('<div *flipcard(duration: vite)><i></i><i></i></div>'), /\*flipcard : duration = vite/)
    await assert.rejects(compiler('<div *flipcard(easing: tourbillon)><i></i><i></i></div>'), /\*flipcard : easing = tourbillon/)
    await assert.rejects(compiler('<div *flipcard(couleur: red)><i></i><i></i></div>'), /couleur/)
    await compiler('<div *flipcard(x, perspective: 5000, easing: bounce-out, on: view)><i></i><i></i></div>')
  })

  it('le retrait de l\'effet rend les faces comme avant : ni marque, ni inert, ni variable', async () => {
    const comp = await monter('mjs-fx-carte-retrait')
    const el   = comp._shadow.querySelector('.a')
    el.dispatchEvent(new window.PointerEvent('pointerenter'))
    assert.ok(face(el, 'back'))
    // le nœud est retiré par le bloc : on défait l'effet sur un nœud qu'on garde en main
    window.µ._mjs_fxClear(el)
    assertAbsent(el.querySelector('[mjs-fx-flipcard-face]'), 'face encore marquée')
    assert.equal(el.querySelector('.r').hasAttribute('inert'), false)
    assert.equal(el.querySelector('.v').hasAttribute('inert'), false)
    assert.equal(el.getAttribute('mjs-fx'), null)
    assert.equal(el.style.cssText, '', 'variables restées : ' + el.style.cssText)
    assert.equal(el.getAttributeNames().filter((n: string) => n.startsWith('mjs-fx')).join(), '', 'marques restées')
    // et il n'écoute plus
    el.dispatchEvent(new window.PointerEvent('pointerenter'))
    assert.equal(el.style.cssText, '')
  })
})
