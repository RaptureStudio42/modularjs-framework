// µminmax sur une propriété — `µminmax($x.volume, 0, 10)` borne une propriété d'un objet réactif,
// comme `µminmax($volume, 0, 10)` borne une variable. La règle vit sur CE composant : toute
// écriture de `$x` qu'il fait (bouton, fonction qui reçoit l'objet, clé calculée, remplacement
// entier, liaison d'un champ) est rebornée sur place avant que l'écran ne la voie ; un composant
// sans règle ne paie rien. Chemins FIXES seulement, comme µinspect : `$x.a.b`, `$x['cle']`,
// `$x.items[0]` — un appel, un index calculé ou un espace restent refusés à la compilation.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { cleanJs, cleanJsExpr } from '../src/generator/utils.js'
import { applyMjsSugarToScript, transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('µminmax($x.chemin) — compilation', () => {
  it("chemin simple : µminmax($x.volume, 0, 10) → µ.minmax(_mjsThis, ['x', 'volume'], 0, 10)", () => {
    assert.equal(cleanJs('µminmax($x.volume, 0, 10)'), "µ.minmax(_mjsThis, ['x', 'volume'], 0, 10)")
    assert.equal(cleanJsExpr('µminmax($x.volume, 0, 10)'), "µ.minmax(_mjsThis, ['x', 'volume'], 0, 10)")
  })

  it('chemin imbriqué, clé en chaîne, index entier', () => {
    assert.equal(cleanJs('µminmax($x.son.volume, 0, 10)'), "µ.minmax(_mjsThis, ['x', 'son', 'volume'], 0, 10)")
    assert.equal(cleanJs("µminmax($x['a b'], 0, 10)"), "µ.minmax(_mjsThis, ['x', 'a b'], 0, 10)")
    assert.equal(cleanJs('µminmax($x.pistes[0].volume, 0, 10)'), "µ.minmax(_mjsThis, ['x', 'pistes', '0', 'volume'], 0, 10)")
    assert.equal(cleanJs(`µminmax($x["l'a#{b}"], 0, 10)`), "µ.minmax(_mjsThis, ['x', 'l\\'a#{b}'], 0, 10)", 'apostrophe échappée, aucune interpolation possible')
  })

  it('forme sans parenthèses du <script> : µminmax $x.volume, 0, 10', () => {
    assert.equal(applyMjsSugarToScript('µminmax $x.volume, 0, 10', 'civet'), "µ.minmax _mjsThis, ['x', 'volume'], 0, 10")
  })

  it('la variable entière reste inchangée : µminmax($x, 0, 10)', () => {
    assert.equal(cleanJs('µminmax($x, 0, 10)'), "µ.minmax(_mjsThis, 'x', 0, 10)")
  })

  it('un appel, un index calculé ou un espace restent refusés, avec un message qui dit quoi écrire', () => {
    for (const forme of ['µminmax($x.volume(), 0, 10)', 'µminmax($x[cle], 0, 10)', 'µminmax($x . volume, 0, 10)']) {
      assert.throws(() => cleanJs(forme), /µminmax[\s\S]*chemin fixe/, forme)
    }
    assert.throws(() => applyMjsSugarToScript('µminmax $x[cle], 0, 10', 'civet'), /µminmax[\s\S]*chemin fixe/)
  })

  // forme sans parenthèses + clé en chaîne : la chaîne découpait l'appel avant sa réécriture, qui
  // ressortait tel quel (`µ.minmax $.x['cle'], 0, 10`) et plantait à la construction du composant
  it("forme sans parenthèses avec une clé en chaîne : µminmax $x['cle'], 0, 10", async () => {
    assert.equal(applyMjsSugarToScript("µminmax $x['cle'], 0, 10", 'civet'), "µ.minmax _mjsThis, ['x', 'cle'], 0, 10")
    const { output } = await transpile("<script>\n$x = {cle: 50}\nµminmax $x['cle'], 0, 10\n</script>\n<p>{$x.cle}</p>\n", { moduleName: 'minmax-nu-cle-chaine' })
    assert.match(output, /µ\.minmax\(_mjsThis, \['x', 'cle'\], 0, 10\)/)
  })

  // un store ($$x) n'est pas l'état d'un composant : µminmax recevait sa VALEUR au lieu d'une clé
  // et plantait à la construction ; µinspect ne suivait rien, en silence — refus clair à la place
  it('un store ($$x) est refusé avec un message clair, µminmax comme µinspect, avec ou sans parenthèses', async () => {
    assert.throws(() => cleanJs('µminmax($$x, 0, 10)'), /µminmax[\s\S]*store/)
    assert.throws(() => cleanJs('µminmax($$x.volume, 0, 10)'), /µminmax[\s\S]*store/)
    assert.throws(() => cleanJs('µinspect($$x)'), /µinspect[\s\S]*store/)
    assert.throws(() => applyMjsSugarToScript('µminmax $$x, 0, 10', 'civet'), /µminmax[\s\S]*store/)
    assert.throws(() => applyMjsSugarToScript('µinspect $$x', 'civet'), /µinspect[\s\S]*store/)
    await assert.rejects(transpile('<script>\n$$compteur = 5\nµminmax($$compteur, 0, 10)\n</script>\n<p>{$$compteur}</p>\n', { moduleName: 'minmax-store' }), /µminmax[\s\S]*store/)
  })

  // argument sur la ligne suivante (mise en forme banale) : le refus du store ne tolérait que des
  // espaces entre la parenthèse et `$$x`, jamais un saut de ligne — l'ancien plantage revenait
  it('argument sur la ligne suivante : store refusé, chemin réécrit', async () => {
    assert.throws(() => cleanJs('µminmax(\n  $$x, 0, 10)'), /µminmax[\s\S]*store/)
    assert.throws(() => cleanJs('µinspect(\n  $$x\n)'), /µinspect[\s\S]*store/)
    assert.equal(cleanJs('µminmax(\n  $x.volume, 0, 10)'), "µ.minmax(_mjsThis, ['x', 'volume'], 0, 10)")
    await assert.rejects(transpile('<script>\n$$compteur = 5\nµminmax(\n  $$compteur, 0, 10\n)\n</script>\n<p>{$$compteur}</p>\n', { moduleName: 'minmax-store-multiligne' }), /µminmax[\s\S]*store/)
  })

  it('un commentaire qui cite µminmax($$x…) ne casse rien', () => {
    assert.doesNotThrow(() => cleanJs('// µminmax($$x, 0, 10) ne marche pas\ndoStuff()'))
  })

  it('dans le <script> d’un composant : compile', async () => {
    const src = "<script>\n$x = {volume: 50, son: {volume: 50}}\nµminmax($x.volume, 0, 10)\nµminmax $x.son.volume, 0, 10\n</script>\n<p>{$x.volume}</p>\n"
    await assert.doesNotReject(transpile(src, { moduleName: 'minmax-chemin-script' }))
  })
})

// --- exécution : vrai composant compilé, chargé dans happy-dom ---------------------------------

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const VOLUME = [
  '<script>',
  '  $x      = { volume: 50, son: { volume: 50 }, basses: 50 }',
  '  $autre  = { volume: 50 }',
  '  $source = { volume: 70, son: { volume: -5 }, basses: 70 }',
  '  µminmax($x.volume, 0, 10)',
  '  µminmax $x.son.volume, 0, 10',
  '  regler = (r) -> r.volume = 50',
  '  poser  = (cle, v) -> $x[cle] = v',
  '</script>',
  '',
  '<p class="v">{$x.volume}</p>',
  '<p class="s">{$x.son.volume}</p>',
  '<input class="i" type="number" aria-label="volume" value.number=!{$x.volume}>',
  '<button class="plus" @click={$x.volume += 20}>+</button>',
  '<button class="fonction" @click={regler($x)}>f</button>',
  '<button class="fonction-autre" @click={regler($autre)}>fa</button>',
  '<button class="cle-volume" @click={poser(\'volume\', 99)}>cv</button>',
  '<button class="cle-basses" @click={poser(\'basses\', 99)}>cb</button>',
  '<button class="texte" @click={poser(\'volume\', \'fort\')}>t</button>',
  '<button class="remplacer" @click={$x = $source}>r</button>',
].join('\n')

// enfant qui modifie l'objet reçu, et parent qui le lui passe en liaison DEUX SENS : prévenu du
// changement, le parent reborne l'objet aussitôt (avec une liaison simple, il ne l'est pas : doc 03)
const REGLAGE = [
  '<button class="b" @click={$data.volume = 50}>b</button>',
  '<p class="e">{$data.volume}</p>',
].join('\n')

const DEUX_SENS = [
  '<script>',
  '  $x = { volume: 5 }',
  '  µminmax($x.volume, 0, 10)',
  '</script>',
  '',
  '<@reglage data=!{$x}></@reglage>',
  '<p class="p">{$x.volume}</p>',
].join('\n')

const CLE_CHAINE = [
  '<script>',
  "  $x = { 'a b': 50 }",
  "  µminmax $x['a b'], 0, 10",
  '</script>',
  '',
  "<p class=\"c\">{$x['a b']}</p>",
].join('\n')

const SANS_REGLE = [
  '<script>',
  '  $x = { volume: 50 }',
  '</script>',
  '',
  '<p>{$x.volume}</p>',
].join('\n')

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('µminmax($x.chemin) — exécution', function () {
  this.timeout(30000)
  let window: any
  let el: any

  before(async () => {
    const root   = mjsTmp('minmax-propriete')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'volume.mjs'), VOLUME)
    writeFileSync(join(srcDir, 'sansregle.mjs'), SANS_REGLE)
    writeFileSync(join(srcDir, 'reglage.mjs'), REGLAGE)
    writeFileSync(join(srcDir, 'deuxsens.mjs'), DEUX_SENS)
    writeFileSync(join(srcDir, 'clechaine.mjs'), CLE_CHAINE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.filter((f) => f.startsWith('mjs_'))
    const code  = [...coeur, ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-volume></mjs-volume><mjs-sansregle></mjs-sansregle><mjs-deuxsens></mjs-deuxsens><mjs-clechaine></mjs-clechaine>'
    el = window.document.body.querySelector('mjs-volume')
    await attendre(() => !!el._shadow?.querySelector('.v'))
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const texte   = (sel: string) => el._shadow.querySelector(sel).textContent
  const cliquer = async (sel: string) => { el._shadow.querySelector(sel).click(); await new Promise((r) => setTimeout(r, 20)) }

  it('la valeur de départ est rebornée tout de suite, les autres propriétés ne bougent pas', async () => {
    assert.equal(el._state.x.volume, 10)
    assert.equal(el._state.x.son.volume, 10)
    assert.equal(el._state.x.basses, 50)
    await attendre(() => texte('.v') === '10')
    assert.equal(texte('.v'), '10')
  })

  it('bouton : $x.volume += 20 reste à 10', async () => {
    await cliquer('.plus')
    assert.equal(el._state.x.volume, 10)
    assert.equal(texte('.v'), '10')
  })

  it('fonction qui reçoit l’objet : regler($x) est bornée, regler($autre) ne l’est pas', async () => {
    await cliquer('.fonction')
    assert.equal(el._state.x.volume, 10)
    await cliquer('.fonction-autre')
    assert.equal(el._state.autre.volume, 50, 'un autre objet passé à la même fonction n’est jamais touché')
  })

  it('clé calculée : $x[cle] = 99 est bornée pour « volume », pas pour « basses »', async () => {
    await cliquer('.cle-volume')
    assert.equal(el._state.x.volume, 10)
    await cliquer('.cle-basses')
    assert.equal(el._state.x.basses, 99)
  })

  it('une valeur qui n’est pas un nombre est laissée telle quelle', async () => {
    await cliquer('.texte')
    assert.equal(el._state.x.volume, 'fort')
    el._state.x.volume = 3
  })

  it('liaison d’un champ : taper 50 donne 10', async () => {
    const input = el._shadow.querySelector('.i')
    input.value = '50'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(el._state.x.volume, 10)
    await attendre(() => input.value === '10')
    assert.equal(input.value, '10', 'le champ affiche la valeur bornée')
  })

  it('remplacement entier : l’objet reçu est borné sur place', async () => {
    await cliquer('.remplacer')
    assert.equal(el._state.x.volume, 10)
    assert.equal(el._state.x.son.volume, 0)
    assert.equal(el._state.source.volume, 10, 'même objet : borné sur place, partout où il sert')
    assert.equal(el._state.x.basses, 70, 'les propriétés sans règle ne bougent pas')
    await attendre(() => texte('.v') === '10' && texte('.s') === '0')
    assert.equal(texte('.s'), '0')
  })

  it('enfant lié en deux sens (data=!{$x}) : son écriture est rebornée par le parent, des deux côtés', async () => {
    const parent: any = window.document.body.querySelector('mjs-deuxsens')
    await attendre(() => !!parent._shadow?.querySelector('mjs-reglage')?._shadow?.querySelector('.b'))
    const enfant: any = parent._shadow.querySelector('mjs-reglage')
    enfant._shadow.querySelector('.b').click()
    await attendre(() => enfant._shadow.querySelector('.e').textContent === '10')
    assert.equal(parent._state.x.volume, 10)
    assert.equal(parent._shadow.querySelector('.p').textContent, '10')
    assert.equal(enfant._shadow.querySelector('.e').textContent, '10', 'l’enfant affiche la valeur rebornée')
  })

  it("clé en chaîne, forme sans parenthèses : µminmax $x['a b'], 0, 10 borne dès le montage", async () => {
    const c: any = window.document.body.querySelector('mjs-clechaine')
    await attendre(() => c._shadow?.querySelector('.c')?.textContent === '10')
    assert.equal(c._state.x['a b'], 10)
  })

  it('un composant sans µminmax ne paie rien : aucune surveillance posée sur lui', () => {
    const autre = window.document.body.querySelector('mjs-sansregle')
    assert.equal(Object.prototype.hasOwnProperty.call(autre, '_mjs_notifyMutation'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(el, '_mjs_notifyMutation'), true)
  })
})

// build de production : les noms internes `_mjs_*` y sont raccourcis (cache partagé entre le cœur
// et les modules) — la règle posée par le module des runes rares doit viser le même point de passage
describe('µminmax($x.chemin) — build de production', function () {
  this.timeout(30000)

  it('mêmes bornes une fois les noms internes raccourcis', async () => {
    const root   = mjsTmp('minmax-propriete-prod')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'volume.mjs'), VOLUME)
    // fichier unique : cœur, runes rares et composant dans un seul module, un seul `export{… as µ}`
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', js: 'bundle' })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const code = readFileSync(join(root, 'bundle.js'), 'utf-8')
      .replace(/export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+(?:µ|\\u00B5)\s*\};?/, 'globalThis.µ = $1;')
      .replace(/import\.meta\.url/g, "'http://localhost/'")
    assert.ok(!/_mjs_notifyMutation/.test(code), 'build de production : noms internes bien raccourcis')
    const window: any = new Window({ url: 'http://localhost/' })
    try {
      window.eval(code)
      window.document.body.innerHTML = '<mjs-volume></mjs-volume>'
      const el: any = window.document.body.querySelector('mjs-volume')
      const racine  = () => el.shadowRoot ?? el._shadow
      await attendre(() => !!racine()?.querySelector('.v'))
      await attendre(() => racine().querySelector('.v').textContent === '10')
      assert.equal(racine().querySelector('.v').textContent, '10', 'valeur de départ bornée')
      for (const sel of ['.plus', '.fonction', '.cle-volume']) {
        racine().querySelector(sel).click()
        await new Promise((r) => setTimeout(r, 20))
        assert.equal(racine().querySelector('.v').textContent, '10', sel)
      }
      racine().querySelector('.remplacer').click()
      await attendre(() => racine().querySelector('.s').textContent === '0')
      assert.equal(racine().querySelector('.s').textContent, '0', 'remplacement entier borné')
    } finally {
      window.close?.()
      await terminateSharedWorkerPool()
    }
  })
})
