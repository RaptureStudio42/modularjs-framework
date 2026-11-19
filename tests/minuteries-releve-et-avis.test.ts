// µafter / µevery — ce que la construction relève pour le cœur de production, et ce que le développement dit d'un appel
// qu'elle n'a pas vu. En production, le niveau de la page (minuterie posée hors de tout composant actif) et les noms (`id:`)
// n'entrent au cœur que si un appel lu en a besoin : un module `.js.mjs` importé (`µimport`, `@import`, ses voisins), comme
// une bibliothèque `.js` qui atteint µ sans le lire en nom libre (`window['µ']`, `Reflect.get`, `eval`), est lu comme le reste ; une note CoffeeScript dans les options ne cache pas la clé `id` ; une fonction passée par son nom ou entre
// parenthèses n'est pas prise pour des options ; des options passées par une variable, une condition, un appel, un paramètre,
// à deux arguments comme à trois, font entrer les noms (prudence), comme tout autre accès à µafter / µevery qu'un appel écrit
// (crochets, alias, déstructuration, `.call`, `.apply`, `.bind`, µ passé comme valeur, `window.µ`) et un nom lu hors de la
// portée de sa fonction. En développement, une minuterie que la construction ne voit pas (script de public/, script
// extérieur) part, et un avertissement dit ce qu'il en serait en production, une fois par sorte, sur l'appel concerné —
// avertissement absent du cœur de production. Un `onStop` qui repose une minuterie sous son propre nom pendant que ce nom
// change de minuterie n'en fait jamais tourner deux : seule la neuve vit ; posée sous un nom pendant le premier tir de la
// neuve de ce nom, une minuterie la remplace (la dernière gagne).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanJsTimers, EVERY_ID, EVERY_PAGE } from '../src/bundler/features.js'
import { mjsTmp } from './helpers/tmp.js'

// le code des noms : un registre qui a porté une minuterie nommée prend un `delete` qui libère le nom
const NOMS     = 'Set.prototype.delete'
// l'avertissement d'un appel que la construction ne voit pas, en français ou en anglais
const AVIS     = /la construction ne le voit pas|the build does not see it/
const AVIS_ID  = /« id »|"id"/
// la barre oblique inverse des échappements écrits dans un fichier `.js`
const BS       = String.fromCharCode(92)
const lier     = (l: string) => l.split(',').map(x => x.trim().split(/\s+as\s+/))
const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/\bimport\s*\{([^}]*)\}\s*from\s*(['"])[^'"]+\2\s*;?/g, (_m, l) => 'var ' + lier(l).map(([a, b]) => `${b ?? a}=globalThis.__esm.${a}`).join(',') + ';')
  .replace(/\bexport\s*\{([^}]*)\}\s*;?/g, (_m, l) => 'globalThis.__esm=Object.assign(globalThis.__esm||{},{' + lier(l).map(([a, b]) => `${b ?? a}:${a}`).join(',') + '});')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")
const attendre = (ms: number) => new Promise(r => setTimeout(r, ms))

// une appli : `fichiers` sous ses sources ; rend le cœur et le composant `minuterie` compilés
async function construire(fichiers: Record<string, string>, prod: boolean) {
  const root   = mjsTmp('every-releve')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  for (const [chemin, texte] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(srcDir, chemin)), { recursive: true })
    writeFileSync(join(srcDir, chemin), texte)
  }
  const bundler: any = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(prod ? { env: 'prod' } : {}) } as any)
  const stats        = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const liste = existsSync(outDir) ? readdirSync(outDir) : []
  const lire  = (re: RegExp) => { const f = liste.find(x => re.test(x)); return f ? readFileSync(join(outDir, f), 'utf-8') : '' }
  return { core: lire(/^mjs_core-/), comp: lire(/^minuterie-/) }
}

const comp  = (script: string, module = 'window.m = -> 1', gabarit = '<p>{$n}</p>') => `${gabarit}\n\n<script module>\n  ${module}\n</script>\n\n<script>\n  $n = 0\n  ${script}\n</script>\n`
const coeur = async (fichiers: Record<string, string>) => (await construire(fichiers, true)).core
const A0    = 'µafter 30, -> $n = $n + 1'

describe('µafter / µevery — relevé des appels pour le cœur de production', function () {
  this.timeout(180000)

  after(async () => { await terminateSharedWorkerPool() })

  it('un module `.js.mjs` importé par `µimport` est lu : son appel fait entrer le niveau de la page, et le code des noms quand il porte un `id`', async () => {
    const appel = A0 + "\n  go = ->\n    m = await µimport('./aide.js.mjs')\n    m.poser()"
    const sans  = await coeur({ 'minuterie.mjs': comp(appel), 'aide.js.mjs': 'export const poser = () => 1\n' })
    const page  = await coeur({ 'minuterie.mjs': comp(appel), 'aide.js.mjs': 'export const poser = () => µ.after(30, () => 1)\n' })
    const nomme = await coeur({ 'minuterie.mjs': comp(appel), 'aide.js.mjs': "export const poser = () => µ.after(30, { id: 'x' }, () => 1)\n" })
    assert.ok(page.length > sans.length, `appel hors composant dans le .js.mjs : le code de la page entre (${page.length} o contre ${sans.length} o)`)
    assert.equal(page.includes(NOMS), false, 'sans `id` : pas de code des noms')
    assert.ok(nomme.includes(NOMS), 'appel nommé dans le .js.mjs : le code des noms entre')
  })

  it('un module `.js.mjs` importé par `@import`, et son voisin importé par chemin relatif, sont lus aussi', async () => {
    const script = "@import { poser } './aide.js.mjs'\n  go = -> poser()\n  " + A0
    const direct = await coeur({ 'minuterie.mjs': comp(script), 'aide.js.mjs': "export const poser = () => µ.every(1000, { id: 'v' }, () => 1)\n" })
    assert.ok(direct.includes(NOMS), '`@import` d\'un .js.mjs qui pose une minuterie nommée : le code des noms entre')
    const voisin = await coeur({ 'minuterie.mjs': comp(script), 'aide.js.mjs': "@import { tirer } './voisin.js.mjs'\nexport const poser = () => tirer()\n", 'voisin.js.mjs': "export const tirer = () => µ.every(1000, { id: 'v' }, () => 1)\n" })
    assert.ok(voisin.includes(NOMS), 'voisin d\'un .js.mjs importé qui pose une minuterie nommée : le code des noms entre')
  })

  it('une note CoffeeScript dans les options ne cache pas la clé `id`', async () => {
    const cas: [string, string][] = [
      ['ligne de note avant `id`', "µafter 30,\n    # note\n    id: 'x'\n  , -> $n = $n + 1"],
      ['note en fin de ligne', "µafter 30,\n    pause: true # note\n    id: 'x'\n  , -> $n = $n + 1"],
      ['bloc de note', "µafter 30,\n    ### note ###\n    id: 'x'\n  , -> $n = $n + 1"],
    ]
    for (const [nom, script] of cas) assert.ok((await coeur({ 'minuterie.mjs': comp(script) })).includes(NOMS), `${nom} : le code des noms entre`)
  })

  it('une fonction passée par son nom ou entre parenthèses n\'est pas prise pour des options : le cœur est celui d\'options écrites sans `id`, à l\'octet', async () => {
    const cas: [string, string, string][] = [
      ['µafter et une fonction par son nom', 'tirer = -> $n = $n + 1\n  µafter 30, tirer', 'tirer = -> $n = $n + 1\n  µafter 30, pause: true, tirer'],
      ['µevery et une fonction par son nom', 'tirer = -> $n = $n + 1\n  µevery 1000, tirer', 'tirer = -> $n = $n + 1\n  µevery 1000, times: 5, tirer'],
      ['µafter et une fonction entre parenthèses', 'µafter 30, (-> $n = $n + 1)', 'µafter 30, pause: true, (-> $n = $n + 1)'],
    ]
    for (const [nom, script, temoin] of cas) {
      const c    = await coeur({ 'minuterie.mjs': comp(script) })
      const base = await coeur({ 'minuterie.mjs': comp(temoin) })
      assert.equal(c.includes(NOMS), false, `${nom} : pas de code des noms`)
      assert.ok(c.length === base.length, `${nom} : même poids qu'avec des options écrites sans \`id\`, à l'octet (${c.length} o contre ${base.length} o)`)
    }
  })

  it('options que la construction ne connaît pas d\'avance — variable, condition, appel, paramètre — à deux arguments, ou délai qui porte une expression régulière : le code des noms entre', async () => {
    const cas: [string, Record<string, string>][] = [
      ['variable : `await µafter 30, opts`', { 'minuterie.mjs': comp("opts = { id: 'x' }\n  window.att = ->\n    await µafter 30, opts\n    $n = $n + 1") }],
      ['condition', { 'minuterie.mjs': comp("window.att = ->\n    await µafter 30, (if window.k then { id: 'a' } else { id: 'b' })\n    $n = $n + 1") }],
      ['appel', { 'minuterie.mjs': comp("window.att = ->\n    await µafter 30, Object.assign({}, { id: 'x' })\n    $n = $n + 1") }],
      ['paramètre', { 'minuterie.mjs': comp("window.att = (o) ->\n    await µafter 30, o\n    $n = $n + 1") }],
      ['expression régulière à parenthèse dans le délai', { 'minuterie.mjs': comp("µafter parseInt('30'.replace(/[)]/g, '')), id: 'x', -> $n = $n + 1") }],
      ['module `.js.mjs` importé : `await µ.after(30, o)`', { 'minuterie.mjs': comp(A0 + "\n  go = ->\n    m = await µimport('./aide.js.mjs')\n    m.attendre({ id: 'x' })"), 'aide.js.mjs': 'export const attendre = async (o) => { await µ.after(30, o) }\n' }],
    ]
    for (const [nom, f] of cas) assert.ok((await coeur(f)).includes(NOMS), `${nom} : le code des noms entre`)
  })

  it('tout accès à `µafter` / `µevery` autre qu\'un appel écrit — crochets, `.call`, `.apply`, `.bind`, alias, déstructuration — et un nom lu hors de la portée de sa fonction font entrer le code des noms : composant', async () => {
    const cas: [string, string][] = [
      ['crochets `µ[\'after\']`', A0 + "\n  µ['after'] 40, { id: 'x' }, -> 1"],
      ['`µ.after.call`', A0 + "\n  µ.after.call null, 40, { id: 'x' }, -> 1"],
      ['`µ.after.apply`', A0 + "\n  µ.after.apply null, [40, { id: 'x' }, -> 1]"],
      ['`µ.every.bind`', A0 + "\n  poser = µ.every.bind null\n  poser 1000, { id: 'x' }, -> 1"],
      ['alias `a = µ.after`', A0 + "\n  a = µ.after\n  a 40, { id: 'x' }, -> 1"],
      ['alias de la rune `a = µafter`', A0 + "\n  a = µafter\n  a 40, { id: 'x' }, -> 1"],
      ['déstructuration `{ after } = µ`', A0 + "\n  { after } = µ\n  after 40, { id: 'x' }, -> 1"],
      ['portée : `o`, fonction d\'une autre fonction, lu ailleurs', "aide = ->\n    o = -> 1\n    o\n  window.att = ->\n    await µafter 30, o\n    $n = $n + 1"],
    ]
    for (const [nom, script] of cas) assert.ok((await coeur({ 'minuterie.mjs': comp(script) })).includes(NOMS), `${nom} : le code des noms entre`)
  })

  it('tout accès à `µ.after` / `µ.every` autre qu\'un appel écrit, et tout accès à µ autre qu\'un nom après un point (µ passé comme valeur, `window[\'µ\']`, `globalThis.µ`), font entrer le code des noms : module `.js.mjs` importé, même sans appel écrit à côté', async () => {
    const appel = A0 + "\n  go = ->\n    m = await µimport('./aide.js.mjs')\n    m.poser()"
    const cas: [string, string][] = [
      ['crochets', "export const poser = () => µ['after'](30, { id: 'x' }, () => 1)"],
      ['`.call`', "export const poser = () => µ.after.call(null, 30, { id: 'x' }, () => 1)"],
      ['`.apply`', "export const poser = () => µ.after.apply(null, [30, { id: 'x' }, () => 1])"],
      ['`.bind`', "const a = µ.every.bind(µ)\nexport const poser = () => a(1000, { id: 'x' }, () => 1)"],
      ['alias', "const a = µ.after\nexport const poser = () => a(30, { id: 'x' }, () => 1)"],
      ['déstructuration', "const { after } = µ\nexport const poser = () => after(30, { id: 'x' }, () => 1)"],
      ['`(0, µ.after)`', "export const poser = () => (0, µ.after)(30, { id: 'x' }, () => 1)"],
      ["`window['µ']`", "export const poser = () => window['µ'].after(30, { id: 'x' }, () => 1)"],
      ['`globalThis.µ`', "export const poser = () => globalThis.µ.after(30, { id: 'x' }, () => 1)"],
      ['µ passé comme valeur', "const poser2 = (m) => m.after(30, { id: 'x' }, () => 1)\nexport const poser = () => poser2(µ)"],
      ['portée : `o` d\'un bloc, lu dehors', "{\n  const o = () => 1\n}\nexport const poser = () => µ.after(30, o)"],
    ]
    for (const [nom, code] of cas) assert.ok((await coeur({ 'minuterie.mjs': comp(appel), 'aide.js.mjs': code + '\n' })).includes(NOMS), `.js.mjs, ${nom} : le code des noms entre`)
  })

  it('une fonction liée plus haut, dans une portée où l\'appel la lit, n\'est pas prise pour des options : le cœur est celui d\'options écrites sans `id`, à l\'octet', async () => {
    const c    = await coeur({ 'minuterie.mjs': comp('tirer = -> $n = $n + 1\n  window.go = -> µafter 30, tirer') })
    const base = await coeur({ 'minuterie.mjs': comp('tirer = -> $n = $n + 1\n  window.go = -> µafter 30, pause: true, tirer') })
    assert.equal(c.includes(NOMS), false, 'pas de code des noms')
    assert.ok(c.length === base.length, `même poids qu'avec des options écrites sans \`id\`, à l'octet (${c.length} o contre ${base.length} o)`)
  })

  it('l\'avertissement d\'un appel que la construction ne voit pas : dans le cœur de développement, jamais dans celui de production', async () => {
    const f = { 'minuterie.mjs': comp("µafter 30, id: 'x', -> $n = $n + 1", 'window.m = -> µafter 30, -> 1') }
    assert.ok(/everyUnseen|la construction ne le voit pas/.test((await construire(f, false)).core), 'développement : l\'avertissement est là')
    assert.equal(/everyUnseen|la construction ne le voit pas/.test((await construire(f, true)).core), false, 'production : 0 octet')
  })
})

// le cœur et le composant `minuterie` évalués dans une fenêtre happy-dom ; `script` : du code que la construction ne lit pas
async function monter(source: string, prod: boolean, script = '') {
  const r              = await construire({ 'minuterie.mjs': source }, prod)
  const win: any       = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  win.console.warn     = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
  win.console.error    = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
  win.eval(`${stripEsm(r.core)}\nglobalThis.µ = typeof µ !== 'undefined' ? µ : globalThis.__esm.µ;\n${script}\n${stripEsm(r.comp)}`)
  return { win, avis, doc: win.document }
}

const CHAINE = [
  '<p>{$n}</p>',
  '<button class="simple" @click={-> simple()}>s</button>',
  '<button class="chaine" @click={-> chaine()}>c</button>',
  '<script>',
  '$n = 0',
  'relance = ->',
  '  window.__re = false',
  "  µafter 30, id: 'r', -> window.__rRelance = (window.__rRelance ?? 0) + 1",
  "simple = -> µafter 30, id: 'r', onStop: (-> relance() if window.__re), -> window.__rTir = (window.__rTir ?? 0) + 1",
  "chaine = -> µafter 30, id: 'c', onStop: (-> chaine() if window.__ch), -> window.__cTir = (window.__cTir ?? 0) + 1",
  '</script>'
].join('\n')

// une minuterie posée sous un nom pendant le premier tir de la neuve de ce nom : tir immédiat (`times: 1`, puis sans fin),
// tir différé (`immediate: false`)
const IMMEDIAT = [
  '<p>{$n}</p>',
  '<script>',
  '$n = 0',
  "window.fois = -> µevery 1000, id: 'f', times: 1, ->",
  "  µafter 20, id: 'f', -> window.__f = (window.__f ?? 0) + 1",
  "window.sansFin = -> µevery 1000, id: 's', ->",
  "  µafter 20, id: 's', -> window.__s = (window.__s ?? 0) + 1",
  "window.differe = -> µevery 10, id: 'd', times: 1, immediate: false, ->",
  "  µafter 20, id: 'd', -> window.__d = (window.__d ?? 0) + 1",
  '</script>'
].join('\n')

// minuteries posées par un script que la construction ne lit pas (évalué tel quel dans la page) ; `poserNomComposant` passe
// le composant en tête, comme le code compilé d'un composant
const SCRIPT = "window.poserPage = function() { µ.after(30, function() { window.__p = (window.__p || 0) + 1 }) };" +
  " window.poserNom = function() { µ.after(30, { id: 'js' }, function() { window.__q = (window.__q || 0) + 1 }) };" +
  " window.poserNomPage = function() { µ.after(30, { id: 'jp' }, function() { window.__r = (window.__r || 0) + 1 }) };" +
  " window.poserNomComposant = function(c) { µ.after(c, 30, { id: 'jc' }, function() { window.__r = (window.__r || 0) + 1 }) };"

describe('µafter / µevery — vie des minuteries (happy-dom)', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    const mode = prod ? 'production' : 'développement'
    it(`${mode} : un onStop qui repose une minuterie sous son propre nom pendant que ce nom change de minuterie n'en laisse tourner qu'une, la neuve`, async () => {
      const { win, doc } = await monter(CHAINE, prod)
      const el: any      = doc.createElement('mjs-minuterie')
      doc.body.appendChild(el)
      await attendre(20)
      const bouton = (c: string) => (el._shadow ?? el.shadowRoot ?? el).querySelector('button.' + c)
      bouton('simple').click()
      win.__re = true
      bouton('simple').click()
      bouton('chaine').click()
      win.__ch = true
      bouton('chaine').click()
      win.__ch = false
      await attendre(150)
      assert.equal(win.__rTir, 1, 'un niveau : un seul tir, celui de la neuve')
      assert.equal(win.__rRelance, undefined, 'un niveau : la minuterie posée par l\'onStop pendant le remplacement ne tire pas')
      assert.equal(win.__cTir, 1, `deux niveaux : ${win.__cTir} tirs sous le nom 'c'`)
    })

    it(`${mode} : posée sous un nom pendant le premier tir de la neuve de ce nom, une minuterie la remplace — la dernière gagne`, async () => {
      const { win, doc } = await monter(IMMEDIAT, prod)
      const el: any      = doc.createElement('mjs-minuterie')
      doc.body.appendChild(el)
      await attendre(20)
      win.fois()
      win.sansFin()
      win.differe()
      await attendre(150)
      assert.equal(win.__f, 1, `tir immédiat, \`times: 1\` : la minuterie posée pendant ce tir tire (${win.__f} tir)`)
      assert.equal(win.__s, 1, `tir immédiat, sans fin : la minuterie posée pendant ce tir tire, la neuve est remplacée (${win.__s} tir)`)
      assert.equal(win.__d, 1, `tir différé : la minuterie posée pendant ce tir tire (${win.__d} tir)`)
    })

    it(`${mode} : \`await µafter 30, opts\` (opts = { id: 'x' }) deux fois de suite — seule la dernière attente reprend`, async () => {
      const { win, doc } = await monter(comp("opts = { id: 'x' }\n  window.att = ->\n    await µafter 30, opts\n    window.__att = (window.__att ?? 0) + 1"), prod)
      const el: any      = doc.createElement('mjs-minuterie')
      doc.body.appendChild(el)
      await attendre(20)
      win.att()
      win.att()
      await attendre(150)
      assert.equal(win.__att, 1, `une seule reprise (${win.__att})`)
    })
  }

  it('développement : une minuterie hors composant que la construction n\'a pas vue part, et un avertissement dit qu\'en production elle ne ferait rien — une fois', async () => {
    const { win, avis } = await monter(comp(A0), false, SCRIPT)
    win.poserPage()
    win.poserPage()
    await attendre(80)
    assert.equal(win.__p, 2, 'la minuterie part en développement')
    assert.equal(avis.filter(a => AVIS.test(a)).length, 1, `un avertissement, une fois : ${JSON.stringify(avis)}`)
  })

  it('développement : la construction a vu un appel hors composant mais aucun nommé — l\'`id` d\'un script qu\'elle ne lit pas est signalé, l\'appel hors composant ne l\'est pas', async () => {
    const { win, avis } = await monter(comp(A0, 'window.m = -> µafter 30, -> 1'), false, SCRIPT)
    win.poserPage()
    assert.equal(avis.filter(a => AVIS.test(a)).length, 0, `appel hors composant déjà vu : aucun avertissement — ${JSON.stringify(avis)}`)
    win.poserNom()
    await attendre(80)
    assert.equal(win.__q, 1, 'la minuterie nommée part en développement')
    assert.equal(avis.filter(a => AVIS.test(a) && AVIS_ID.test(a)).length, 1, `\`id\` jamais vu : un avertissement — ${JSON.stringify(avis)}`)
  })

  it('développement : des appels de ce genre que la construction a vus ne disent rien', async () => {
    const { win, avis } = await monter(comp(A0, "window.m = -> µafter 30, id: 'k', -> 1"), false, SCRIPT)
    win.poserPage()
    win.poserNom()
    await attendre(80)
    assert.equal(win.__p, 1, 'appel hors composant : un tir')
    assert.equal(avis.filter(a => AVIS.test(a)).length, 0, JSON.stringify(avis))
  })

  it('développement : un appel hors composant et nommé, puis un appel nommé d\'un composant, jamais vus — un avertissement par sorte', async () => {
    const { win, doc, avis } = await monter(comp(A0), false, SCRIPT)
    const el: any            = doc.createElement('mjs-minuterie')
    doc.body.appendChild(el)
    await attendre(20)
    win.poserNomPage()
    assert.equal(avis.filter(a => AVIS.test(a)).length, 1, `hors composant : un avertissement — ${JSON.stringify(avis)}`)
    assert.equal(avis.filter(a => AVIS.test(a) && AVIS_ID.test(a)).length, 0, `hors composant, l'appel ne ferait rien : rien sur son \`id\` — ${JSON.stringify(avis)}`)
    win.poserNomComposant(el)
    await attendre(80)
    assert.equal(win.__r, 2, 'les deux minuteries partent en développement')
    assert.equal(avis.filter(a => AVIS.test(a) && AVIS_ID.test(a)).length, 1, `\`id\` d'un appel de composant jamais vu : un avertissement — ${JSON.stringify(avis)}`)
    assert.equal(avis.filter(a => AVIS.test(a)).length, 2, `deux sortes, deux avertissements — ${JSON.stringify(avis)}`)
  })

  it('production : un `id` passé par un accès indirect — crochets, `.call`, alias de la rune, déstructuration — ou par une variable lue hors de la portée d\'une fonction du même nom : une seule minuterie de ce nom tire', async () => {
    const X    = '-> window.__x = (window.__x ?? 0) + 1'
    const deux = (appel: string, avant = '') => A0 + (avant ? '\n  ' + avant : '') + `\n  ${appel} 40, { id: 'x' }, ${X}\n  ${appel} 40, { id: 'x' }, ${X}`
    const cas: [string, string, (w: any) => void][] = [
      ['crochets', comp(deux("µ['after']")), () => {}],
      ['`.call`', comp(deux('µ.after.call null,')), () => {}],
      ['alias de la rune', comp(deux('a', 'a = µafter')), () => {}],
      ['déstructuration', comp(deux('after', '{ after } = µ')), () => {}],
      ['portée', comp("aide = ->\n    o = -> 1\n    o\n  window.att = ->\n    await µafter 30, o\n    window.__x = (window.__x ?? 0) + 1"), (w) => {
        w.o = { id: 'x' }
        w.att()
        w.att()
      }],
    ]
    for (const [nom, source, action] of cas) {
      const { win, doc } = await monter(source, true)
      const el: any      = doc.createElement('mjs-minuterie')
      doc.body.appendChild(el)
      await attendre(20)
      action(win)
      await attendre(150)
      assert.equal(win.__x, 1, `${nom} : ${win.__x} tirs sous le nom 'x'`)
    }
  })

  it('développement : deux appels hors composant et nommés, puis un appel nommé d\'un composant, jamais vus — l\'avertissement de l\'`id` part sur l\'appel du composant', async () => {
    const { win, doc, avis } = await monter(comp(A0), false, SCRIPT)
    const el: any            = doc.createElement('mjs-minuterie')
    doc.body.appendChild(el)
    await attendre(20)
    win.poserNomPage()
    win.poserNomPage()
    assert.equal(avis.filter(a => AVIS.test(a) && AVIS_ID.test(a)).length, 0, `hors composant, l'appel ne ferait rien : rien sur son \`id\` — ${JSON.stringify(avis)}`)
    win.poserNomComposant(el)
    await attendre(80)
    assert.equal(avis.filter(a => AVIS.test(a) && AVIS_ID.test(a)).length, 1, `\`id\` d'un appel de composant jamais vu : un avertissement, sur cet appel — ${JSON.stringify(avis)}`)
    assert.equal(avis.filter(a => AVIS.test(a)).length, 2, `deux sortes, deux avertissements — ${JSON.stringify(avis)}`)
  })

  it('développement : trois appels hors composant et nommés, jamais vus — un seul avertissement : en production, l\'appel ne ferait rien', async () => {
    const { win, avis } = await monter(comp(A0), false, SCRIPT)
    win.poserNomPage()
    win.poserNomPage()
    win.poserNomPage()
    await attendre(80)
    assert.equal(avis.filter(a => AVIS.test(a)).length, 1, `un avertissement — ${JSON.stringify(avis)}`)
    assert.equal(avis.filter(a => AVIS.test(a) && AVIS_ID.test(a)).length, 0, `rien sur l'\`id\` d'un appel qui ne ferait rien — ${JSON.stringify(avis)}`)
  })

  it('production : sans aucun appel écrit dans l\'appli, un accès qui nomme la minuterie — alias de la rune, crochets, déstructuration, `.call`, `.bind` — fait entrer son module : la minuterie part', async () => {
    const X                       = '-> window.__x = (window.__x ?? 0) + 1'
    const cas: [string, string][] = [
      ['alias de la rune `a = µafter`', `a = µafter\n  a 40, ${X}`],
      ['crochets `µ[\'after\']`', `µ['after'] 40, ${X}`],
      ['déstructuration `{ after } = µ`', `{ after } = µ\n  after 40, ${X}`],
      ['`µ.after.call`', `µ.after.call null, 40, ${X}`],
      ['`µ.every.bind`', `e = µ.every.bind null\n  e 1000, times: 1, ${X}`],
    ]
    for (const [nom, script] of cas) {
      const { win, doc, avis } = await monter(comp(script), true)
      const el: any            = doc.createElement('mjs-minuterie')
      doc.body.appendChild(el)
      await attendre(120)
      assert.equal(win.__x, 1, `${nom} : ${win.__x} tir — ${JSON.stringify(avis)}`)
    }
  })

  it('production : `typeof µ.after` lu dans l\'appli, sans appel écrit : le module entre', async () => {
    const { win, doc } = await monter(comp('window.__t = typeof µ.after'), true)
    const el: any      = doc.createElement('mjs-minuterie')
    doc.body.appendChild(el)
    await attendre(20)
    assert.equal(win.__t, 'function')
  })

  it('production : un module `.js.mjs` importé dont le seul accès est un alias (`const a = µ.after`) fait entrer le module, sans appel écrit ailleurs', async () => {
    const appel = "go = ->\n    m = await µimport('./aide.js.mjs')\n    m.poser()"
    const sans  = (await construire({ 'minuterie.mjs': comp(appel), 'aide.js.mjs': 'export const poser = () => 1\n' }, true)).core
    const ecrit = (await construire({ 'minuterie.mjs': comp(appel), 'aide.js.mjs': 'export const poser = () => µ.after(30, () => 1)\n' }, true)).core
    const alias = (await construire({ 'minuterie.mjs': comp(appel), 'aide.js.mjs': 'const a = µ.after\nexport const poser = () => a(30, () => 1)\n' }, true)).core
    assert.ok(ecrit.length > sans.length, `un appel écrit fait entrer le module (${ecrit.length} o contre ${sans.length} o)`)
    assert.ok(alias.length >= ecrit.length, `l'alias fait entrer le module : ${alias.length} o, ${ecrit.length} o avec un appel écrit, ${sans.length} o sans minuterie`)
  })

  it('production : un accès à µ qui ne nomme pas la minuterie — µ passé comme valeur, `window.µ`, indice calculé — ne fait pas entrer son module', async () => {
    for (const script of ['garder = (m) -> m\n  garder µ', 'window.__k = window.µ', 'window.__k = µ[window.cle]']) {
      const { win, doc } = await monter(comp(script), true)
      const el: any      = doc.createElement('mjs-minuterie')
      doc.body.appendChild(el)
      await attendre(20)
      assert.equal(typeof win.µ.after, 'undefined', `${script} : pas de module des minuteries`)
    }
  })
})

// la règle des formes sûres : le code des noms et de la page reste hors du cœur de production seulement quand chaque mention
// de µ est `µ.<nom>` écrit (hors `after` / `every`) ou un appel écrit aux options connues, sans `eval`, `new Function` ni texte
// de code donné à `setTimeout` / `setInterval` ; un objet global passé comme valeur ou rangé n'y change rien, et un accès
// entièrement calculé (`window[k]`) n'est pas vu : l'avertissement de développement le signale. Tout nom `after` / `every`
// écrit sous µ, quelle que soit l'écriture de la clé, fait entrer le module des minuteries
describe('µafter / µevery — seules les formes sûres laissent la page et les noms hors du cœur', function () {
  this.timeout(180000)

  after(async () => { await terminateSharedWorkerPool() })

  const TIR    = '-> window.__x = (window.__x or 0) + 1'
  const AVERTI = /serait ignorée|would be ignored|ne ferait rien|would do nothing/
  // le composant `minuterie` posé dans la page d'une fenêtre happy-dom
  const monte = async (source: string, prod: boolean, script = '') => {
    const m       = await monter(source, prod, script)
    const el: any = m.doc.createElement('mjs-minuterie')
    m.doc.body.appendChild(el)
    await attendre(20)
    return m
  }

  for (const prod of [false, true]) {
    const mode = prod ? 'production' : 'développement'
    it(`${mode} : composant, \`{ µ: m } = window\` puis deux \`m.after\` sous un même nom — une seule tire, sans avertissement`, async () => {
      const { win, avis } = await monte(comp(`{ µ: m } = window\n  m.after 40, { id: 'x' }, ${TIR}\n  m.after 40, { id: 'x' }, ${TIR}\n  ${A0}`), prod)
      await attendre(150)
      assert.equal(win.__x, 1, `${win.__x} tirs sous le nom x — ${JSON.stringify(avis)}`)
      assert.equal(avis.filter(a => AVERTI.test(a)).length, 0, `aucun avertissement : ${JSON.stringify(avis)}`)
    })

    it(`${mode} : \`<script module>\`, \`{ µ: m } = window\` puis un appel nommé hors composant, deux fois — une seule tire`, async () => {
      const { win, avis } = await monte(comp(A0, `{ µ: m } = window\n  window.pm = -> m.after 40, { id: 'x' }, ${TIR}`), prod)
      win.pm()
      win.pm()
      await attendre(150)
      assert.equal(win.__x, 1, `${win.__x} tirs sous le nom x — ${JSON.stringify(avis)}`)
      assert.equal(avis.filter(a => AVERTI.test(a)).length, 0, `aucun avertissement : ${JSON.stringify(avis)}`)
    })

    it(`${mode} : un nom \`after\` écrit sous µ fait entrer le module des minuteries — gabarit sans substitution, motif \`{ µ: { after } } = window\``, async () => {
      for (const script of ['µ[`after`] 40, ' + TIR, '{ µ: { after } } = window\n  after 40, ' + TIR]) {
        const { win, avis } = await monte(comp(script), prod)
        await attendre(150)
        assert.equal(win.__x, 1, `${script} : ${win.__x} tir — ${JSON.stringify(avis)}`)
      }
    })
  }

  it('production : composant, µ nommé sur un objet global, même rangé dans une variable (`w = window ; w.µ`, `globalThis` lu par crochets) — la page et les noms entrent', async () => {
    const sans = await coeur({ 'minuterie.mjs': comp(A0) })
    assert.ok(!sans.includes(NOMS), 'témoin : sans appel nommé, pas de code des noms')
    const formes = [
      `w = window\n  w.µ.after 40, { id: 'x' }, ${TIR}`,
      `globalThis['µ'].after 40, { id: 'x' }, ${TIR}`
    ]
    for (const script of formes) {
      const core = await coeur({ 'minuterie.mjs': comp(script + '\n  ' + A0) })
      assert.ok(core.includes(NOMS) && core.length > sans.length + 400, `${script} : noms ${core.includes(NOMS)}, ${core.length} o contre ${sans.length} o`)
    }
  })

  it('production : un objet global passé comme valeur ou rangé, sans µ nommé (`pinOpened(globalThis)`, `host = if x then window else globalThis`), laisse le cœur tel quel', async () => {
    const sans = await coeur({ 'minuterie.mjs': comp(A0) })
    for (const script of ['pinOpened = (g) -> !!g\n  window.__o = pinOpened(globalThis)', 'x = 1\n  host = (if x then window else globalThis)\n  window.__h = host']) {
      const core = await coeur({ 'minuterie.mjs': comp(script + '\n  ' + A0) })
      // même poids, sans le code des noms : ni la page (+517 o) ni les noms n'entrent ; le texte du cœur porte l'empreinte du composant
      assert.ok(core.length === sans.length && !core.includes(NOMS), `${script} : ${core.length} o contre ${sans.length} o, noms ${core.includes(NOMS)}`)
    }
  })

  it('développement : un accès entièrement calculé (`window[k]`, `Reflect.get(window, nom)`) n\'est pas vu — l\'avertissement le signale, une fois', async () => {
    for (const script of [`k = String.fromCharCode(181)\n  window[k].after 40, { id: 'x' }, ${TIR}`, `nom = String.fromCharCode(181)\n  Reflect.get(window, nom).after 40, { id: 'x' }, ${TIR}`]) {
      const { avis } = await monte(comp(script + '\n  ' + A0), false)
      await attendre(100)
      assert.equal(avis.filter(a => /serait ignorée|would be ignored/.test(a)).length, 1, `${script} : ${JSON.stringify(avis)}`)
    }
  })

  it('production : fichier `.js` importé, µ décomposé de window, nommé par Reflect.get, ou lu par `eval`, `new Function`, un texte donné à `setTimeout` — la page et les noms entrent', async () => {
    const appel = A0 + "\n  go = ->\n    m = await µimport('./aide.js')\n    m.poser()"
    const sans  = await coeur({ 'minuterie.mjs': comp(appel), 'aide.js': 'export const poser = () => 1\n' })
    assert.ok(!sans.includes(NOMS), 'témoin : sans appel nommé, pas de code des noms')
    const aides = [
      "const { µ: m } = window\nexport const poser = () => m.after(30, { id: 'x' }, () => 1)\n",
      "export const poser = () => Reflect.get(globalThis, 'µ').after(30, { id: 'x' }, () => 1)\n",
      "export const poser = () => eval(\"µ.after(30, { id: 'x' }, function() {})\")\n",
      "export const poser = () => new Function(String.fromCharCode(181) + \".after(30, { id: 'x' }, function() {})\")()\n",
      "export const poser = () => setTimeout(String.fromCharCode(181) + \".after(30, { id: 'x' }, function() {})\", 0)\n"
    ]
    for (const aide of aides) {
      const core = await coeur({ 'minuterie.mjs': comp(appel), 'aide.js': aide })
      assert.ok(core.includes(NOMS) && core.length > sans.length + 400, `${aide} : noms ${core.includes(NOMS)}, ${core.length} o contre ${sans.length} o`)
    }
  })

  it('production : un nom `after` écrit sous µ dans un module `.js.mjs` importé fait entrer le module — gabarit sans substitution, motif niché', async () => {
    const appel = "go = ->\n    m = await µimport('./aide.js.mjs')\n    m.poser()"
    const sans  = await coeur({ 'minuterie.mjs': comp(appel), 'aide.js.mjs': 'export const poser = () => 1\n' })
    const ecrit = await coeur({ 'minuterie.mjs': comp(appel), 'aide.js.mjs': 'export const poser = () => µ.after(30, () => 1)\n' })
    assert.ok(ecrit.length > sans.length + 1000, `témoin : un appel écrit fait entrer le module (${ecrit.length} o contre ${sans.length} o)`)
    for (const aide of ['export const poser = () => µ[`after`](30, () => 1)\n', 'const { µ: { after } } = window\nexport const poser = () => after(30, () => 1)\n']) {
      const core = await coeur({ 'minuterie.mjs': comp(appel), 'aide.js.mjs': aide })
      assert.ok(core.length >= ecrit.length, `${aide} : ${core.length} o, module absent (appel écrit : ${ecrit.length} o, sans minuterie : ${sans.length} o)`)
    }
  })

  it('production : fichier `.js` importé, µ écrit par un échappement hexadécimal, ou un texte de code passé par `setTimeout.call`, `.apply`, `.bind` ou par un membre `constructor` appelé — la page et les noms entrent', async () => {
    const appel = A0 + "\n  go = ->\n    m = await µimport('./aide.js')\n    m.poser()"
    const sans  = await coeur({ 'minuterie.mjs': comp(appel), 'aide.js': 'export const poser = () => 1\n' })
    assert.ok(!sans.includes(NOMS), 'témoin : sans appel nommé, pas de code des noms')
    const aides = [
      `export const poser = () => window['${BS}xb5'].after(30, { id: 'x' }, () => 1)\n`,
      `const { '${BS}xb5': m } = window\nexport const poser = () => m.after(30, { id: 'x' }, () => 1)\n`,
      "export const poser = () => Function.prototype.constructor('return 1')()\n",
      "export const poser = () => (() => 1).constructor('return 1')()\n",
      "export const poser = () => setTimeout.call(window, 'window.k = 1', 10)\n",
      "export const poser = () => setTimeout.apply(null, ['window.k = 1', 10])\n",
      "export const poser = () => window.setInterval.bind(window)('window.k = 1', 10)\n"
    ]
    for (const aide of aides) {
      const core = await coeur({ 'minuterie.mjs': comp(appel), 'aide.js': aide })
      assert.ok(core.includes(NOMS) && core.length > sans.length + 400, `${aide} : noms ${core.includes(NOMS)}, ${core.length} o contre ${sans.length} o`)
    }
  })

  it('fichier `.js` lu en script : µ écrit dans un texte en octal (hors mode strict), en hexadécimal ou par un échappement Unicode, sans autre µ ni appel de code — la page, les noms et le module entrent', () => {
    for (const forme of ['265', 'xb5', 'xB5', 'u{b5}', 'u{000B5}', 'u00B5']) {
      const releve = scanJsTimers(`window['${BS}${forme}'].after(30, { id: 'x' }, function () {})\n`)
      assert.ok(releve.includes('every') && releve.includes(EVERY_PAGE) && releve.includes(EVERY_ID), `${forme} : ${JSON.stringify(releve)}`)
    }
  })

  it('production : un nom `after` écrit sous µ derrière `||`, `??`, `? :`, une virgule ou un `await`, dans un module `.js.mjs` importé, fait entrer le module', async () => {
    const appel = "go = ->\n    m = await µimport('./aide.js.mjs')\n    m.poser()"
    const sans  = await coeur({ 'minuterie.mjs': comp(appel), 'aide.js.mjs': 'export const poser = () => 1\n' })
    const ecrit = await coeur({ 'minuterie.mjs': comp(appel), 'aide.js.mjs': 'export const poser = () => µ.after(30, () => 1)\n' })
    assert.ok(ecrit.length > sans.length + 1000, `témoin : un appel écrit fait entrer le module (${ecrit.length} o contre ${sans.length} o)`)
    for (const valeur of ['window.µ || {}', 'µ ?? {}', 'window.ok ? µ : {}', '(0, µ)', 'await µ']) {
      const core = await coeur({ 'minuterie.mjs': comp(appel), 'aide.js.mjs': `export const poser = async () => {\n  const { after } = ${valeur}\n  return after(30, () => 1)\n}\n` })
      assert.ok(core.length >= ecrit.length, `${valeur} : ${core.length} o, module absent (appel écrit : ${ecrit.length} o, sans minuterie : ${sans.length} o)`)
    }
  })

  it('développement : un `id` que le runtime refuse (42) ne prend pas l\'avertissement des noms ; le premier `id` valide le prend', async () => {
    const { win, avis } = await monter(comp(A0, 'window.m = -> µafter 30, -> 1'), false, "window.p42 = function() { µ.after(30, { id: 42 }, function() {}) }; window.py = function() { µ.after(30, { id: 'y' }, function() {}) };")
    const ignore = () => avis.filter(a => /serait ignorée|would be ignored/.test(a)).length
    win.p42()
    assert.equal(ignore(), 0, `id: 42 refusé, sans l'avertissement des noms : ${JSON.stringify(avis)}`)
    win.py()
    win.py()
    assert.equal(ignore(), 1, `un avertissement, sur le premier id valide : ${JSON.stringify(avis)}`)
  })
})
