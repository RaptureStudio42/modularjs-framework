// *matrix — une pluie de caractères en fond : la toile posée sous le contenu, chaque réglage lu (le
// sens, la densité, la vitesse, la traîne, les caractères, les couleurs), la boucle qui ne tourne que
// pour de bon (au survol, à l'écran, sans « réduire les animations »), les refus de compilation,
// le composant, le retrait. La toile 2D est remplacée par un enregistreur : ce qui se dessine est lu.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const COMPOSANTS: Record<string, string> = {
  'fx-pluie':          '<div class="a" *matrix>x</div>',
  'fx-pluie-couleurs': '<div class="a" *matrix(#0f0, head: #fff, background: #001100, opacity: .5)>x</div>',
  'fx-pluie-dense':    '<div class="a" *matrix(density: 10)>x</div>',
  'fx-pluie-rare':     '<div class="a" *matrix(density: 1)>x</div>',
  'fx-pluie-lettres':  "<div class=\"a\" *matrix(chars: 'AB')>x</div>",
  'fx-pluie-traine':   '<div class="a" *matrix(trail: 0.2)>x</div>',
  'fx-pluie-lente':    '<div class="a" *matrix(speed: 1)>x</div>',
  'fx-pluie-vive':     '<div class="a" *matrix(speed: 10)>x</div>',
  'fx-pluie-droite':   '<div class="a" *matrix(direction: right)>x</div>',
  'fx-pluie-gauche':   '<div class="a" *matrix(direction: left)>x</div>',
  'fx-pluie-haut':     '<div class="a" *matrix(direction: up)>x</div>',
  'fx-pluie-gros':     '<div class="a" *matrix(size: 30)>x</div>',
  'fx-pluie-survol':   '<div class="a" *matrix(on: hover)>x</div>',
  'fx-pluie-carte':    '<@fx-pluie-corps class="b" *matrix></@fx-pluie-corps>',
  'fx-pluie-corps':    '<p>dedans</p>',
  'fx-pluie-retrait':  '<script>\n$on = true\n</script>\n{if $on}<div class="a" *matrix>x</div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

// l'enregistreur : une fausse toile 2D qui note ce qu'on y dessine
function enregistreur() {
  const n: any = { texte: [] as any[], efface: [] as any[], styles: new Set<string>(), alphas: new Set<number>(), modes: new Set<string>(), polices: new Set<string>() }
  let fill = ''
  const ctx: any = {
    n,
    setTransform() {},
    clearRect(...a: any[]) { n.efface.push(a) },
    fillRect() {},
    fillText(t: string, x: number, y: number) { n.texte.push({ t, x, y, style: fill }) },
    getImageData(_x: number, _y: number, w: number, h: number) { return { data: new Uint8ClampedArray(w * h * 4) } },
    putImageData() {},
    set fillStyle(v: string) { fill = v; n.styles.add(v) },
    get fillStyle() { return fill },
    set globalAlpha(v: number) { n.alphas.add(v) },
    set globalCompositeOperation(v: string) { n.modes.add(v) },
    set font(v: string) { n.polices.add(v) },
  }
  return ctx
}

describe('effets — *matrix', function () {
  this.timeout(60000)
  let window: any
  let file: Map<number, any>
  let appels: number
  let annules: number
  // les prototypes de happy-dom sont ceux de TOUTES les fenêtres : un bouchon posé dessus survit à `window.close()` et fausse les fichiers suivants du même processus — ce qu'ils portaient est gardé, puis rendu dans `after`
  const anciens: Array<[any, string, PropertyDescriptor | undefined]> = []
  const garder = (cible: any, noms: string[]) => { for (const nom of noms) anciens.push([cible, nom, Object.getOwnPropertyDescriptor(cible, nom)]) }

  before(async () => {
    const root   = mjsTmp('effets-pluie-de-caracteres')
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
    garder(window.HTMLCanvasElement.prototype, ['getContext', 'getBoundingClientRect'])
    garder(window.HTMLElement.prototype, ['clientWidth', 'clientHeight'])
    const proto = window.HTMLCanvasElement.prototype
    proto.getContext = function () { return this._ctx || (this._ctx = enregistreur()) }
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 300, configurable: true })
    Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 150, configurable: true })
    window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 150, right: 300, bottom: 150 })
  })

  after(async () => {
    for (const [cible, nom, d] of anciens) {
      if (d) Object.defineProperty(cible, nom, d)
      else delete cible[nom]
    }
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  beforeEach(() => {
    file    = new Map()
    appels  = 0
    annules = 0
    window.requestAnimationFrame = (f: any) => {
      appels++
      const id = appels
      file.set(id, f)
      return id
    }
    window.cancelAnimationFrame = (id: number) => { annules++; file.delete(id) }
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  })

  // fait passer des images, 16 ms l'une, avec ce qui est en attente
  function avancer(ms: number) {
    let t = 1000
    for (let k = 0; k < ms / 16; k++) {
      const attente = Array.from(file.entries())
      file.clear()
      t += 16
      for (const [, f] of attente) f(t)
    }
  }

  async function monter(tag: string, sel = '.a') {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await pause()
    return comp._shadow.querySelector(sel)
  }

  const toile = (el: any) => (el._shadow || el).querySelector('[mjs-fx-layer="matrix"]')
  const v = (n: any, nom: string) => n.style.getPropertyValue(nom)
  const dessin = (el: any) => toile(el)._ctx.n
  const colonnes = (el: any) => new Set(dessin(el).texte.map((c: any) => c.x)).size
  const lignes = (el: any) => new Set(dessin(el).texte.map((c: any) => c.y)).size

  it('*matrix : une toile au fond de la balise, déjà peinte (une pluie bien installée)', async () => {
    const el = await monter('mjs-fx-pluie')
    const c  = toile(el)
    assert.ok(c, 'la toile')
    assert.equal(c.localName, 'canvas')
    assert.equal(c.getAttribute('aria-hidden'), 'true')
    assert.ok(el.firstChild === c, 'premier enfant de la balise')
    assert.ok(dessin(el).texte.length > 100, 'des caractères déjà tombés avant la première image')
  })

  it('les caractères par défaut : katakana demi-chasse et chiffres', async () => {
    const el = await monter('mjs-fx-pluie')
    const defaut = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789'
    for (const c of dessin(el).texte) assert.ok(defaut.includes(c.t), 'caractère hors liste : ' + c.t)
    assert.ok(new Set(dessin(el).texte.map((c: any) => c.t)).size > 20, 'tirés au sort dans toute la liste')
  })

  it('*matrix(chars: \'AB\') : seuls ces caractères tombent', async () => {
    const el = await monter('mjs-fx-pluie-lettres')
    assert.deepEqual([...new Set(dessin(el).texte.map((c: any) => c.t))].sort(), ['A', 'B'])
  })

  it('size: 30 : des colonnes de 30 px (10 pour 300 px de large), la police de la même taille', async () => {
    const el = await monter('mjs-fx-pluie-gros')
    assert.ok(colonnes(el) <= 10)
    assert.ok([...dessin(el).polices].some((p: string) => /^30px /.test(p)), [...dessin(el).polices].join('|'))
    const el2 = await monter('mjs-fx-pluie')
    assert.ok([...dessin(el2).polices].some((p: string) => /^15px /.test(p)), 'taille par défaut : 15px')
  })

  it('density: 10 : toutes les colonnes sont actives ; density: 1 : une sur dix environ', async () => {
    const dense = colonnes(await monter('mjs-fx-pluie-dense'))
    const rare  = colonnes(await monter('mjs-fx-pluie-rare'))
    assert.equal(dense, 20, '300 px / 15 px')
    assert.ok(rare >= 1 && rare <= 4, 'colonnes actives : ' + rare)
  })

  it('direction: right : la pluie court en lignes (10 lignes de 15 px dans 150 px) ; par défaut elle tombe en colonnes', async () => {
    const bas = await monter('mjs-fx-pluie')
    assert.ok(colonnes(bas) >= 8 && colonnes(bas) <= 20)
    const droite = await monter('mjs-fx-pluie-droite')
    assert.ok(lignes(droite) <= 10, 'lignes : ' + lignes(droite))
    assert.ok(colonnes(droite) > 10, 'étalée sur toute la largeur : ' + colonnes(droite))
  })

  it('le sens : la tête avance d\'une case vers le bas (down), le haut (up), la droite (right), la gauche (left)', async () => {
    const attendu: Record<string, number[]> = { 'mjs-fx-pluie': [0, 15], 'mjs-fx-pluie-haut': [0, -15], 'mjs-fx-pluie-droite': [15, 0], 'mjs-fx-pluie-gauche': [-15, 0] }
    for (const [tag, [dx, dy]] of Object.entries(attendu)) {
      const el = await monter(tag)
      const t0 = dessin(el).texte.length
      avancer(200)
      const neufs = dessin(el).texte.slice(t0)
      assert.ok(neufs.length >= 4, tag + ' : des caractères neufs')
      // chaque pas écrit, par colonne active, la case de la queue puis celle de la tête
      const paires = neufs.map((c: any, k: number) => [neufs[k - 1], c]).filter((p: any[]) => p[0] && Math.abs(p[1].x - p[0].x) + Math.abs(p[1].y - p[0].y) === 15)
      assert.ok(paires.length > 0, tag + ' : une tête qui suit sa queue')
      const bon = paires.filter((p: any[]) => Math.round(p[1].x - p[0].x) === dx && Math.round(p[1].y - p[0].y) === dy)
      assert.ok(bon.length > 0, `${tag} : pas (${dx}, ${dy}) attendu`)
    }
  })

  it('trail: 0.2 : le voile posé à chaque pas efface la toile par transparence', async () => {
    const el = await monter('mjs-fx-pluie-traine')
    assert.ok(dessin(el).alphas.has(0.2), [...dessin(el).alphas].join(','))
    assert.ok(dessin(el).modes.has('destination-out'))
    const def = await monter('mjs-fx-pluie')
    assert.ok(dessin(def).alphas.has(0.06), 'voile par défaut : 0.06')
  })

  it('*matrix(#0f0, head: #fff, background: #001100, opacity: .5) : les couleurs et l\'opacité en variables', async () => {
    const el = await monter('mjs-fx-pluie-couleurs')
    assert.equal(v(el, '--mjs-matrix-color'), '#0f0')
    assert.equal(v(el, '--mjs-matrix-head'), '#fff')
    assert.equal(v(el, '--mjs-matrix-background'), '#001100')
    assert.equal(v(el, '--mjs-matrix-opacity'), '0.5')
    const styles = [...dessin(el).styles].join(' ').toLowerCase()
    assert.match(styles, /#0f0|rgb\(0, ?255, ?0\)/, 'la couleur de la pluie')
    assert.match(styles, /#fff\b|rgb\(255, ?255, ?255\)/, 'la couleur de la tête')
  })

  it('les couleurs par défaut : pluie #00ff66, tête #e9fff1', async () => {
    const el = await monter('mjs-fx-pluie')
    const styles = [...dessin(el).styles].join(' ').toLowerCase()
    assert.match(styles, /#00ff66|rgb\(0, ?255, ?102\)/)
    assert.match(styles, /#e9fff1|rgb\(233, ?255, ?241\)/)
  })

  it('speed : 9 pas par seconde à 1, 36 à 10 (6 + 3 × speed)', async () => {
    const compte = async (tag: string) => {
      const el = await monter(tag)
      const avant = dessin(el).texte.length
      avancer(1000)
      return dessin(el).texte.length - avant
    }
    const lent = await compte('mjs-fx-pluie-lente')
    const vif  = await compte('mjs-fx-pluie-vive')
    assert.ok(vif > lent * 3, `vif ${vif} contre lent ${lent}`)
  })

  it('la boucle tourne tant que rien ne l\'arrête : une image après l\'autre', async () => {
    await monter('mjs-fx-pluie')
    assert.equal(file.size, 1, 'une image en attente')
    avancer(160)
    assert.equal(file.size, 1, 'et toujours une seule')
  })

  it('*matrix(on: hover) : au repos une image fixe et aucune boucle, au survol la pluie tombe', async () => {
    const el = await monter('mjs-fx-pluie-survol')
    assert.ok(dessin(el).texte.length > 100, 'image fixe peinte')
    assert.equal(file.size, 0, 'aucune image demandée au repos')
    el.dispatchEvent(new window.PointerEvent('pointerenter'))
    assert.equal(file.size, 1, 'la pluie tombe')
    el.dispatchEvent(new window.PointerEvent('pointerleave'))
    avancer(48)
    assert.equal(file.size, 0, 'elle s\'arrête quand la souris part')
  })

  it('« réduire les animations » : une image fixe, aucune boucle', async () => {
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
    const el = await monter('mjs-fx-pluie')
    assert.ok(dessin(el).texte.length > 100)
    assert.equal(file.size, 0)
  })

  it('le CSS : la toile sous le contenu, son fond et son opacité en variables', () => {
    const css = window.µ._mjs_fxDefs.matrix.css
    assert.match(css, /\[mjs-fx~="matrix"\]\{isolation:isolate\}/)
    assert.match(css, /\[mjs-fx-layer="matrix"\]\{[^}]*position:absolute;inset:0;width:100%;height:100%/)
    assert.match(css, /z-index:-1/)
    assert.match(css, /background:var\(--mjs-matrix-background,#000\)/)
    assert.match(css, /opacity:var\(--mjs-matrix-opacity,1\)/)
  })

  it('posé sur un composant : la toile est dans le shadow de l\'hôte', async () => {
    const hote = await monter('mjs-fx-pluie-carte', '.b')
    const c    = hote._shadow.querySelector('[mjs-fx-layer="matrix"]')
    assert.ok(c)
    assert.ok(hote._shadow.firstChild === c, 'le calque est le premier enfant du shadow')
  })

  it('speed: 11, density: 0, size: 5, trail: 0.6, direction: diag, opacity: 2, on: click, chars: \'\' sont refusés à la compilation', async () => {
    await assert.rejects(compiler('<div *matrix(speed: 11)>x</div>'), /\*matrix : speed = 11 — permis : int 1\.\.10/)
    await assert.rejects(compiler('<div *matrix(density: 0)>x</div>'), /\*matrix : density = 0 — permis : int 1\.\.10/)
    await assert.rejects(compiler('<div *matrix(size: 5)>x</div>'), /\*matrix : size = 5 — permis : int 8\.\.40/)
    await assert.rejects(compiler('<div *matrix(trail: 0.6)>x</div>'), /\*matrix : trail = 0\.6 — permis : float 0\.01\.\.0\.5/)
    await assert.rejects(compiler('<div *matrix(direction: diag)>x</div>'), /\*matrix : direction/)
    await assert.rejects(compiler('<div *matrix(opacity: 2)>x</div>'), /\*matrix : opacity = 2 — permis : float 0\.\.1/)
    await assert.rejects(compiler('<div *matrix(on: click)>x</div>'), /\*matrix : on/)
    await assert.rejects(compiler('<div *matrix(vitesse: 3)>x</div>'), /\*matrix/)
    await compiler('<div *matrix(speed: 10, density: 10, size: 40, trail: 0.01, direction: left, on: view)>x</div>')
  })

  it('*matrix sur une image est refusé : l\'effet dessine dans la balise', async () => {
    await assert.rejects(compiler('<img *matrix src="a.png" alt="a">'), /\*matrix[\s\S]*dessine à l'intérieur/)
  })

  it('le retrait de l\'effet enlève la toile, annule l\'image en attente et les écouteurs', async () => {
    const comp = window.document.body.appendChild(window.document.createElement('mjs-fx-pluie-retrait'))
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    await pause()
    const el = comp._shadow.querySelector('.a')
    assert.ok(toile(el), 'toile posée')
    assert.equal(file.size, 1)
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'toile restée')
    assert.equal(file.size, 0, 'plus aucune image en attente')
    assert.ok(annules >= 1, 'l\'image en attente est annulée')
    assert.equal(el.getAttribute('mjs-fx'), null)
    assert.equal(el.getAttribute('style') || '', '')
  })
})
