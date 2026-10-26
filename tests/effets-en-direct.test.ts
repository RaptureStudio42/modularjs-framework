// Effets « en direct » — ce qui change sous les yeux : *delta (un nombre qui monte clignote dans une
// couleur avec ▲, qui baisse dans une autre avec ▼, et compte de l'ancienne valeur à la nouvelle ;
// rien au premier affichage), *autosize (la boîte glisse de son ancienne taille à la nouvelle
// quand son contenu change) et *lang (à la bascule de langue, les textes de sa zone se brouillent
// puis se recomposent — la bascule est simulée : ses crochets appelés, le texte changé à la main). happy-dom ne calcule aucune mise en page : les tailles de *autosize
// sont posées à la main sur la balise, le glissement est lu dans l'appel à `animate`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { parseEffect, checkPlacement } from '../src/effects/catalog.js'
import { parse } from '../src/parser/index.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { mjsTmp } from './helpers/tmp.js'
import { mesurer } from './helpers/mesure-balise.js'

const COMPOSANTS: Record<string, string> = {
  'fx-delta':    '<script>\n$v = 100\n</script>\n<span class="d" *delta(100ms)>{$v}</span>\n<span class="s" *delta(fx: none, arrow: false)>{$v}</span>\n<button class="plus" @click={$v = 1250}>+</button>\n<button class="moins" @click={$v = 90}>-</button>',
  'fx-delta-fx': '<script>\n$v = 100\n</script>\n<span class="e" *delta(fx: *scramble(10))>{$v}</span>\n<button class="plus" @click={$v = 1250}>+</button>\n<button class="encore" @click={$v = 1300}>+</button>\n<button class="trois" @click={$v = 1400}>+</button>',
  'fx-delta-var': '<script>\n$v = 100\n$fx = \'*count\'\n</script>\n<span class="e" *delta(fx: $fx)>{$v}</span>\n<button class="plus" @click={$v = 1250}>+</button>\n<button class="brouille" @click={$fx = \'*scramble\'}>b</button>',
  'fx-autosize': '<script>\n$items = [1]\n</script>\n<div class="a" *autosize(200ms, easing: ease-out)>{for i in $items}<p>{i}</p>{end}</div>\n<button class="plus" @click={$items = [...$items, $items.length + 1]}>+</button>',
  'fx-langue':   '<section class="z" *lang(duration: 200ms)><p class="t">Bonjour tous</p></section>\n<p class="dehors">Merci</p>\n<div class="y" *lang(type, duration: 200ms)><p class="u">Oui</p></div>',
  'fx-attente':  '<script>\n$profil = new Promise((ok) -> @fin = ok)\n</script>\n<article class="carte">\n{await $profil *skeleton(color: #333)}\n{success p}\n  <img class="photo" src={p.photo} alt="">\n  <h3 class="nom">{p.nom}</h3>\n  <p class="bio">{p.bio}</p>\n  <div class="role">{p.role}</div>\n  <p>Rôle : <b>{p.role}</b></p>\n  <ul>{for t in p.tags}<li>{t}</li>{end}</ul>\n  <@fx-badge></@fx-badge>\n{end}\n</article>\n<button class="fin" @click={@fin({ photo: "x.png", nom: "Zora", bio: "…", role: "Admin", tags: ["a"] })}>fin</button>',
  'fx-badge':    '<span>badge</span>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('effets en direct', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-en-direct')
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

  async function monter(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await new Promise((r) => setTimeout(r, 20))
    return comp._shadow.querySelector(sel)
  }

  it('*delta : rien au premier affichage ; le nombre monte → couleur up et ▲, il compte jusqu\'à la nouvelle valeur ; il baisse → down et ▼', async () => {
    const d = await monter('mjs-fx-delta', '.d')
    const root   = d.getRootNode()
    const nombre = () => d.querySelector('[mjs-fx-delta-val]')?.firstChild?.nodeValue
    const fleche = () => d.querySelector('[mjs-fx-delta-arrow]')?.textContent
    assert.equal(nombre(), '100')
    assert.equal(d.getAttribute('mjs-fx-delta-go'), null, 'aucun clignotement au premier affichage')
    root.querySelector('.plus').click()
    await attendre(() => d.getAttribute('mjs-fx-delta-go') === 'up')
    assert.equal(d.getAttribute('mjs-fx-delta-go'), 'up')
    assert.equal(fleche(), '▲')
    await attendre(() => nombre() === '1 250', 2000)
    assert.equal(nombre(), '1 250', 'le nombre compte jusqu\'à la nouvelle valeur, écrit comme *count')
    root.querySelector('.moins').click()
    await attendre(() => d.getAttribute('mjs-fx-delta-go') === 'down')
    assert.equal(fleche(), '▼')
    await attendre(() => nombre() === '90', 2000)
    assert.equal(nombre(), '90')
  })

  it('*delta(fx: none, arrow: false) : le nouveau nombre tout de suite, sans flèche', async () => {
    const d = await monter('mjs-fx-delta', '.s')
    d.getRootNode().querySelector('.plus').click()
    await attendre(() => d.getAttribute('mjs-fx-delta-go') === 'up')
    assert.equal(d.querySelector('[mjs-fx-delta-val]').firstChild.nodeValue, '1 250')
    assertAbsent(d.querySelector('[mjs-fx-delta-arrow]'), 'arrow: false — pas de flèche')
  })

  it('*delta(fx: *scramble(10)) : le nouveau nombre s\'écrit par l\'effet donné, rejoué à chaque changement ; la flèche reste hors de ses lettres', async () => {
    const d   = await monter('mjs-fx-delta-fx', '.e')
    const val = () => d.querySelector('[mjs-fx-delta-val]')
    assert.equal(val().firstChild.nodeValue, '100')
    assert.equal((val().getAttribute('mjs-fx') || '').includes('scramble'), false, 'rien au premier affichage')
    d.getRootNode().querySelector('.plus').click()
    await attendre(() => (val()?.getAttribute('mjs-fx') || '').includes('scramble'))
    assert.ok((val().getAttribute('mjs-fx') || '').includes('scramble'), 'le nouveau nombre porte *scramble')
    assert.equal(val().firstChild.nodeValue, '1 250', 'le nombre écrit tout de suite, l\'effet brouille ses lettres')
    assert.ok(d.querySelector('[mjs-fx-delta-arrow]').parentNode === d.querySelector('[mjs-fx-delta-num]'), 'la flèche, sœur du nombre : hors des lettres de l\'effet')
    assert.equal(d.getAttribute('mjs-fx-delta-go'), 'up', 'le clignotement reste')
    assert.equal(typeof window.µ._mjs_fxDefs.scramble, 'object', 'l\'effet donné à fx part dans le cœur, même écrit nulle part ailleurs')
    // rejoué à CHAQUE changement
    for (const [bouton, attendu] of [['.encore', '1\u202f300'], ['.trois', '1\u202f400']]) {
      d.getRootNode().querySelector(bouton).click()
      await attendre(() => val()?.firstChild?.nodeValue === attendu)
      await new Promise((r) => setTimeout(r, 30))
      assert.ok((val().getAttribute('mjs-fx') || '').includes('scramble'), `${attendu} : le nombre porte encore *scramble — ${d.innerHTML.slice(0, 300)}`)
    }
  })

  it('*delta(fx: $fx) : la variable change d\'effet en cours de route — le changement suivant s\'écrit par le nouvel effet', async () => {
    const d    = await monter('mjs-fx-delta-var', '.e')
    const root = d.getRootNode()
    root.querySelector('.brouille').click()
    await new Promise((r) => setTimeout(r, 30))
    root.querySelector('.plus').click()
    const val = () => d.querySelector('[mjs-fx-delta-val]')
    await attendre(() => (val()?.getAttribute('mjs-fx') || '').includes('scramble'))
    assert.ok((val()?.getAttribute('mjs-fx') || '').includes('scramble'), `le nouveau nombre porte *scramble : ${d.innerHTML}`)
  })

  it('*delta : fx reçoit un effet qui se joue une fois (réglages vérifiés), none, ou *count ; sinon une erreur qui dit quoi', () => {
    assert.deepEqual(parseEffect('delta', 'fx: *scramble(20, order: left)').fixed, { fx: { fx: 'scramble', s: { speed: 20, order: 'left' } } })
    assert.deepEqual(parseEffect('delta', 'fx: *fly(up)').fixed, { fx: { fx: 'fly', s: { direction: 'up' } } })
    assert.deepEqual(parseEffect('delta', 'fx: none').fixed, { fx: 'none' })
    assert.deepEqual(parseEffect('delta', 'fx: *count').fixed, { fx: { fx: 'count', s: {} } })
    assert.throws(() => parseEffect('delta', 'fx: *neon'), /\*neon[\s\S]*une fois/)
    assert.throws(() => parseEffect('delta', 'fx: *scramble(vite)'), /\*scramble/)
    assert.throws(() => parseEffect('delta', 'fx: *nimporte'), /\*nimporte/)
    assert.throws(() => parseEffect('delta', 'fx: scramble'), /\*scramble/)
    assert.throws(() => parseEffect('delta', 'fx: *scramble($vite)'), /fx/)
    assert.deepEqual(parseEffect('delta', 'fx: $effet').dynamic, { fx: '$effet' })
    // une variable nomme un effet du cœur : '*scramble', 'none' ; un autre nom est écarté (le compte, par défaut)
    const e = window.µ._mjs_fxNorm
    const regle = parseEffect('delta', 'fx: $effet').spec.fx
    const vu = (v: string) => JSON.stringify(e(v, regle))
    assert.equal(vu('*scramble'), JSON.stringify([{ fx: 'scramble', s: {} }, 0]))
    assert.equal(vu('none'), JSON.stringify(['none', 0]))
    assert.equal(vu('*inconnu'), JSON.stringify([null, -1]))
    assert.throws(() => parseEffect('delta', 'count: false'), /count/)
  })

  it('*delta : un effet de texte — refusé sur une image, réglages vérifiés', () => {
    assert.deepEqual(parseEffect('delta', '2s, up: #0f0, arrow: false').fixed, { duration: '2s', up: '#0f0', arrow: false })
    assert.throws(() => checkPlacement('delta', parseEffect('delta', ''), 'img', false), /\*delta/)
  })

  it('*lang : à la bascule de langue, un texte de la zone se brouille puis se recompose ; hors de la zone, rien', async () => {
    const z    = await monter('mjs-fx-langue', '.z')
    const root = z.getRootNode()
    const comp = root.host
    const t    = root.querySelector('.t').firstChild
    const hors = root.querySelector('.dehors').firstChild
    // le composant est traduit : le runtime i18n prévient les crochets juste avant sa vague
    window.µ._mjs_i18nComps = new Set([comp])
    window.µ._mjs_i18nSwapHooks.forEach((h: any) => h('en', 'fr'))
    t.data    = 'Hello all'
    hors.data = 'Thanks'
    await new Promise((r) => setTimeout(r, 0))
    const image = t.data
    assert.notEqual(image, 'Hello all', 'la première image est brouillée')
    assert.equal(image.length, 'Hello all'.length)
    assert.equal(image[5], ' ', 'les espaces restent en place')
    assert.equal(hors.data, 'Thanks', 'hors de la zone : le texte change sans effet')
    await attendre(() => t.data === 'Hello all', 1500)
    assert.equal(t.data, 'Hello all')
  })

  it('*lang(type) : l\'ancien texte s\'efface, le nouveau se tape', async () => {
    const y    = await monter('mjs-fx-langue', '.y')
    const root = y.getRootNode()
    const u    = root.querySelector('.u').firstChild
    window.µ._mjs_i18nComps = new Set([root.host])
    window.µ._mjs_i18nSwapHooks.forEach((h: any) => h('en', 'fr'))
    u.data = 'Yes'
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(u.data, 'Oui', 'au départ, l\'ancien texte entier')
    await attendre(() => u.data === 'Yes', 1500)
    assert.equal(u.data, 'Yes')
  })

  it('{await $x *skeleton} : pendant l\'attente, la forme de la branche {success} — des barres à la place des textes, les balises et leurs classes gardées', async () => {
    const carte = await monter('mjs-fx-attente', '.carte')
    const zone  = carte.querySelector('[mjs-skel-zone]')
    assert.ok(zone, 'la zone du squelette pendant l\'attente')
    assert.equal(zone.getAttribute('aria-hidden'), 'true')
    assert.equal(zone.getAttribute('mjs-fx'), 'skeleton', 'l\'effet est posé sur la zone')
    assert.equal(zone.style.getPropertyValue('--mjs-skeleton-color'), '#333')
    const img = zone.querySelector('img.photo')
    assert.equal(img.getAttribute('mjs-skel'), 'media', 'l\'image garde sa classe (sa boîte)')
    assert.equal(img.hasAttribute('src'), false, 'sans ce qu\'elle montre')
    assert.equal(zone.querySelector('h3.nom > [mjs-skel]').getAttribute('mjs-skel'), 'title')
    assert.equal(zone.querySelector('p.bio > [mjs-skel]').getAttribute('mjs-skel'), 'lines', 'une valeur seule dans un paragraphe : trois lignes')
    assert.equal(zone.querySelectorAll('p.bio [mjs-skel="line"]').length, 3)
    assert.equal(zone.querySelector('div.role > [mjs-skel]').getAttribute('mjs-skel'), 'l', 'une valeur seule dans un bloc : une barre longue')
    assert.deepEqual([...zone.querySelectorAll('p:not(.bio) > [mjs-skel], p:not(.bio) b > [mjs-skel]')].map((b: any) => b.getAttribute('mjs-skel')), ['s', 'm'], 'un texte fixe (court) et une valeur : des barres')
    assert.equal(zone.querySelectorAll('ul > li').length, 3, 'une boucle : trois lignes')
    assert.equal(zone.querySelectorAll('[mjs-skel="block"]').length, 1, 'un composant : un bloc')
    assert.equal(zone.textContent.trim(), '', 'aucun texte du contenu à venir')
    carte.getRootNode().querySelector('.fin').click()
    await attendre(() => !!carte.querySelector('h3.nom') && !carte.querySelector('[mjs-skel-zone]'))
    assert.equal(carte.querySelector('h3.nom').textContent, 'Zora', 'le contenu arrivé remplace le squelette')
  })

  it('la feuille d\'un effet reste quand le composant repose les siennes (reconnexion, changement de mise en page)', async () => {
    const carte = await monter('mjs-fx-attente', '.carte')
    const comp  = window.document.querySelector('mjs-fx-attente')
    const fx    = () => comp._shadow.adoptedStyleSheets.filter((s: any) => [...s.cssRules].some((r: any) => /mjs-skel-zone/.test(r.cssText))).length
    assert.equal(fx(), 1, 'la feuille du squelette posée dans le composant')
    comp.remove()
    window.document.body.appendChild(comp)
    await new Promise((r) => setTimeout(r, 20))
    assert.ok(carte.querySelector('[mjs-skel-zone]'), 'la silhouette toujours là')
    assert.equal(fx(), 1, 'sa feuille aussi, après la reconnexion')
    await comp._mjs_applyLayout('default')
    assert.equal(fx(), 1, 'et après une mise en page reposée')
  })

  it('{await … *skeleton} : refusé si la branche d\'attente est écrite, ou sans branche {success}', async () => {
    const analyse = (src: string) => parse(src)
    assert.throws(() => analyse('{await $x *skeleton}<p>…</p>{success v}<p>{v}</p>{end}'), /branche d'attente est déjà écrite/)
    assert.throws(() => analyse('{await $x *skeleton}{error err}<p>{err}</p>{end}'), /branche \{success nom\}/)
  })

  it('{await} sans branche d\'attente : le squelette de {success} d\'office ; une attente écrite, ou la config sans « await », rien', () => {
    const attente = (src: string, diag: any = {}) => {
      const racine: any = parse(src, [], diag)
      return racine.children.find((n: any) => n.type === 'await').branches.find((b: any) => b.type === 'pending').children
    }
    const auto = attente('{await $x}{success v}<h3>{v.nom}</h3>{end}')
    assert.equal(auto.length, 1)
    assert.ok(auto[0].attrs.some((a: any) => a.name === 'mjs-skel-zone'), 'la zone du squelette')
    assert.deepEqual(attente('{await $x}<p>…</p>{success v}<p>{v}</p>{end}').map((n: any) => n.name), ['p'], 'une attente écrite reste')
    assert.equal(attente('{await $x}{error err}<p>{err}</p>{end}').length, 0, 'sans {success}, rien à tirer')
    const zone = attente('{await $x}{success d}<div class="a {d.c}" data-k="1">x</div>{end}')[0]
    assert.deepEqual(zone.children[0].attrs.map((a: any) => a.name), ['data-k'], 'une valeur mêlée d\'interpolation ne passe pas dans le squelette (la valeur à venir n\'existe pas encore)')
    assert.equal(attente('{await $x}{success v}<p>{v}</p>{end}', { autoSkeleton: false }).length, 0, '"effects": { "skeleton": [] } — rien')
  })

  it('*autosize : le contenu change, la boîte glisse de son ancienne taille à la nouvelle', async () => {
    const a = await monter('mjs-fx-autosize', '.a')
    const plus = a.getRootNode().querySelector('.plus')
    const appels: any[] = []
    let taille = 40
    mesurer(window, a, () => ({ width: 200, height: taille, top: 0, left: 0, right: 200, bottom: taille, x: 0, y: 0 }))
    // le cœur appelle animate par le prototype (un composant peut masquer celui de sa balise) quand il existe — happy-dom 20.14 l'a, 20.11 non : l'espion s'y pose le temps du test, filtré sur la balise
    const proto = window.Element.prototype
    const avant = Object.getOwnPropertyDescriptor(proto, 'animate')
    const natif = proto.animate
    proto.animate = function (this: any, images: any, opts: any) {
      if (this !== a) return natif?.call(this, images, opts)
      appels.push({ images, opts })
      return { cancel() {}, onfinish: null }
    }
    try {
      // un premier changement : la taille de départ est retenue (la balise n'avait pas encore de taille)
      plus.click()
      await attendre(() => a.querySelectorAll('p').length === 2)
      await new Promise((r) => setTimeout(r, 20))
      taille = 80
      plus.click()
      await attendre(() => appels.length > 0)
      assert.equal(appels.length, 1)
      const [de, vers] = appels[0].images
      assert.equal(de.height, '40px')
      assert.equal(vers.height, '80px')
      assert.equal(de.boxSizing, 'border-box')
      assert.equal(de.overflow, 'hidden', 'ce qui dépasse est masqué le temps du glissement')
      assert.equal(de.width, undefined, 'axis: height — la largeur ne bouge pas')
      assert.equal(appels[0].opts.duration, 200)
      assert.equal(appels[0].opts.easing, 'ease-out')
    }
    finally {
      if (avant) Object.defineProperty(proto, 'animate', avant)
      else delete proto.animate
    }
  })
})
