// lignes propres : une liste `{for}` dont tout changement de contenu est passé par la mise à jour fine reste propre ; un changement de
// structure compilé (`$data[i] = x`, `$data.splice(…)`, `$data.push(…)`) n'y relit que les lignes qui ne gardent pas leur objet. Toute
// autre écriture de la variable (entière, par l'enveloppe, `µrefresh`, repli du chemin fin, objet à accesseurs, miroir) la salit : sa
// passe suivante relit toutes ses lignes, comme une liste ordinaire. Un objet de la liste changé hors de MJS ne réapparaît plus au
// passage suivant : `µrefresh($data)` le montre, et en développement un avertissement le dit, sans rien changer à l'écran

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const tic = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)) }

// gestes communs des listes : `poser(n)` écrit la variable entière, les autres changent sa structure ou le contenu d'une ligne
const GESTES = (v: string) => [
  `  @poser = function(n) { const a = []; for (let i = 0; i < n; i++) a.push({ id: i + 1, label: 'r' + (i + 1) }); ${v} = a; };`,
  `  @echanger = function() { const t = ${v}[1]; ${v}[1] = ${v}[8]; ${v}[8] = t; };`,
  `  @retirer = function() { ${v}.splice(4, 1); };`,
  `  @ajouter = function() { for (let i = 0; i < 5; i++) ${v}.push({ id: 100 + i, label: 'n' + i }); };`,
  `  @remplacer = function() { ${v} = ${v}.map((r) => ({ id: r.id, label: r.label + '*' })); };`,
  `  @dehors = function() { tenu = { id: 7000, label: 'h' }; ${v}.push(tenu); };`,
  '  @muter = function() { tenu.label = \'h2\'; };',
  `  @rafraichir = function() { µrefresh(${v}); };`,
  `  @filet = function() { const r = pick(${v}); r.label += ' D'; };`,
  `  @fine = function() { ${v}[2].label += ' F'; };`,
]

const LISTE = [
  '<script lang="js">',
  '  let tenu = null;',
  '  function pick(a) { return a[5]; }',
  '  $data = [];',
  ...GESTES('$data'),
  '</script>',
  '<ul>{for row in $data by id}<li>{row.label}</li>{end}</ul>',
].join('\n')

const SANSCLE = [
  '<script lang="js">',
  '  let tenu = null;',
  '  function pick(a) { return a[5]; }',
  '  $data = [];',
  ...GESTES('$data'),
  '  @doubler = function() { $data.push($data[0]); };',
  '  @premier = function() { $data[0].label += \'!\'; };',
  '</script>',
  '<ul>{for row in $data}<li>{row.label}</li>{end}</ul>',
].join('\n')

// liste dans un `{if}`
const SI = [
  '<script lang="js">',
  '  let tenu = null;',
  '  function pick(a) { return a[5]; }',
  '  $data = [];',
  '  $voir = true;',
  ...GESTES('$data'),
  '  @cacher = function() { $voir = false; };',
  '  @montrer = function() { $voir = true; };',
  '</script>',
  '{if $voir}<ol>{for row in $data by id}<li>{row.label}</li>{end}</ol>{end}',
].join('\n')

// ligne qui porte un `{if}`, `{for}` imbriqués : lignes impures, la variable n'a pas de table
const IMPURS = [
  '<script lang="js">',
  '  let tenu = null;',
  '  function pick(a) { return a[5]; }',
  '  $data = [];',
  ...GESTES('$data'),
  '</script>',
  '<p>{for row in $data by id}<b>{if row.id > 3}+{end}{row.label}</b>{end}</p>',
  '<div>{for row in $data by id}<i>{for c in row.label}{c}{end}</i>{end}</div>',
].join('\n')

// liste µraw : ses lignes pures sont sautées comme avant, quel que soit le geste
const BRUT = [
  '<script lang="js">',
  '  $data = µraw([]);',
  '  @poser = function(n) { const a = []; for (let i = 0; i < n; i++) a.push(µraw({ id: i + 1, label: \'r\' + (i + 1) })); $data = µraw(a); };',
  '  @echanger = function() { const a = $data.slice(); const t = a[1]; a[1] = a[8]; a[8] = t; $data = µraw(a); };',
  '</script>',
  '<ul>{for row in $data by id}<li>{row.label}</li>{end}</ul>',
].join('\n')

// objets à accesseurs : instances d'une classe dont la ligne lit un accesseur
const ACCES = [
  '<script lang="js">',
  '  class Personne { constructor(id, nom) { this.id = id; this.nom = nom; } get grand() { return this.nom.toUpperCase(); } }',
  '  $gens = [];',
  '  @poser = function(n) { const a = []; for (let i = 0; i < n; i++) a.push(new Personne(i + 1, \'p\' + (i + 1))); $gens = a; };',
  '  @renommer = function() { $gens[2].nom = \'zed\'; };',
  '  @echanger = function() { const t = $gens[1]; $gens[1] = $gens[8]; $gens[8] = t; };',
  '</script>',
  '<ul>{for p in $gens by id}<li>{p.grand}</li>{end}</ul>',
].join('\n')

const TYPES = '<types>\nLigne\n  id     int\n  label  string\n  n      int 0..10 strict\n</types>\n'

const TYPEE = [
  '<vars>',
  '  $lignes Ligne[]',
  '</vars>',
  '<script lang="js">',
  '  $lignes = [];',
  '  @poser = function(n) { const a = []; for (let i = 0; i < n; i++) a.push({ id: i + 1, label: \'r\' + (i + 1), n: 1 }); $lignes = a; };',
  '  @refus = function() { $lignes[0].n = 50; };',
  '  @echanger = function() { const t = $lignes[1]; $lignes[1] = $lignes[8]; $lignes[8] = t; };',
  '  @pousser = function() { $lignes.push({ id: 50, label: \'x\', n: 2 }); };',
  '</script>',
  '<ul>{for l in $lignes by id}<li>{l.label}{l.n}</li>{end}</ul>',
].join('\n')

describe('mise à jour fine — lignes propres (runtime)', function () {
  this.timeout(60000)
  let win: any, µ: any
  const avis: string[] = []

  before(async () => {
    const root   = mjsTmp('fine-lignes-propres')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    const sources: Record<string, string> = { 'liste.mjs': LISTE, 'sanscle.mjs': SANSCLE, 'si.mjs': SI, 'impurs.mjs': IMPURS, 'brut.mjs': BRUT, 'acces.mjs': ACCES, 'typee.mjs': TYPEE, 'ligne.types.mjs': TYPES }
    for (const [f, s] of Object.entries(sources)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.eval(`${code}\nglobalThis.µ = µ;`)
    µ = win.µ
    µ.warn = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
    win.document.body.innerHTML = '<mjs-liste></mjs-liste><mjs-sanscle></mjs-sanscle><mjs-si></mjs-si><mjs-impurs></mjs-impurs><mjs-brut></mjs-brut><mjs-acces></mjs-acces><mjs-typee></mjs-typee>'
    await tic()
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const hote = (nom: string): any => win.document.querySelector('mjs-' + nom)
  const ombre = (el: any) => el._shadow || el.shadowRoot
  const textes = (el: any, sel: string) => Array.from(ombre(el).querySelectorAll(sel)).map((x: any) => x.textContent)

  // lignes relues par la passe de leur liste (fermeture appelée sans masque), pour toutes les listes du composant, et le libellé de
  // l'élément que chacune reçoit (relevé posé sur les lignes présentes : une ligne neuve, faite par le gabarit, n'y entre pas)
  function espion(el: any): { n: number, vus: string[] } {
    const c = { n: 0, vus: [] as string[] }
    for (const cache of Object.values(el._mjs_list_cache) as any[]) {
      for (const en of cache.values()) {
        const f = en._mjs_updFn
        if (!f) continue
        en._mjs_updFn = function(it: any, ix: any, m?: number) { if (m === undefined) { c.n++; c.vus.push(it?.label) } return f(it, ix, m) }
      }
    }
    return c
  }

  // vingt lignes posées, puis une passe de structure : la liste est propre, et ses lignes ont quitté leur pose initiale
  async function propre(el: any, n = 20) {
    el.poser(n)
    await tic()
    el.echanger()
    await tic()
    el.echanger()
    await tic()
  }

  it('échanger deux lignes : la passe ne relit aucune ligne, l\'écran suit', async () => {
    const el = hote('liste')
    await propre(el)
    const c = espion(el)
    el.echanger()
    await tic()
    assert.equal(c.n, 0)
    assert.deepEqual(textes(el, 'li').slice(0, 10), ['r1', 'r9', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r2', 'r10'])
  })

  it('retirer une ligne, en ajouter cinq : aucune ligne gardée n\'est relue', async () => {
    const el = hote('liste')
    await propre(el)
    const c = espion(el)
    el.retirer()
    await tic()
    el.ajouter()
    await tic()
    assert.deepEqual(c.vus.filter((l) => !/^n\d$/.test(l)), [])
    assert.deepEqual(textes(el, 'li'), ['r1', 'r2', 'r3', 'r4', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15', 'r16', 'r17', 'r18', 'r19', 'r20', 'n0', 'n1', 'n2', 'n3', 'n4'])
  })

  it('remplacer toute la liste par des objets neufs : toutes les lignes sont relues, comme avant', async () => {
    const el = hote('liste')
    await propre(el)
    const c = espion(el)
    el.remplacer()
    await tic()
    assert.equal(c.n, 20)
    assert.equal(textes(el, 'li')[0], 'r1*')
  })

  it('écriture par l\'enveloppe, puis échange : la liste est sale, toutes ses lignes sont relues, l\'écran suit', async () => {
    const el = hote('liste')
    await propre(el)
    const c = espion(el)
    el.filet()
    el.echanger()
    await tic()
    assert.equal(c.n, 20)
    assert.equal(textes(el, 'li')[5], 'r6 D')
    const c2 = espion(el)
    el.echanger()
    await tic()
    assert.equal(c2.n, 0)
  })

  it('écriture servie champ par champ, puis échange : la liste reste propre, la ligne écrite garde sa valeur', async () => {
    const el = hote('liste')
    await propre(el)
    el.fine()
    await tic()
    const c = espion(el)
    el.echanger()
    await tic()
    assert.equal(c.n, 0)
    assert.equal(textes(el, 'li')[2], 'r3 F')
  })

  it('objet changé hors de MJS : l\'échange le laisse à l\'écran, l\'avertissement le dit, µrefresh($data) le montre', async () => {
    const el = hote('liste')
    await propre(el)
    el.dehors()
    await tic()
    avis.length = 0
    el.muter()
    el.echanger()
    await tic()
    assert.equal(textes(el, 'li').at(-1), 'h')
    const dits = avis.filter((a) => a.includes('7000'))
    assert.equal(dits.length, 1, avis.join('\n'))
    assert.match(dits[0], /^\[ModularJS\] <@liste> : la ligne de clé 7000 de \$data a changé sans passer par MJS : écrivez µrefresh\(\$data\) après ce changement\./)
    const c = espion(el)
    el.rafraichir()
    await tic()
    assert.equal(c.n, 21)
    assert.equal(textes(el, 'li').at(-1), 'h2')
    // une fois par liste et par composant
    el.muter()
    el.echanger()
    await tic()
    assert.equal(avis.filter((a) => a.includes('7000')).length, 1)
  })

  it('liste sans clé, doublon compris : l\'échange ne relit aucune ligne ; l\'écriture d\'un doublon salit la liste, l\'écran suit', async () => {
    const el = hote('sanscle')
    await propre(el)
    el.doubler()
    await tic()
    const c = espion(el)
    el.echanger()
    await tic()
    assert.equal(c.n, 0)
    assert.deepEqual(textes(el, 'li').slice(0, 3), ['r1', 'r9', 'r3'])
    assert.equal(textes(el, 'li').at(-1), 'r1')
    el.fine()
    await tic()
    assert.equal(textes(el, 'li')[2], 'r3 F')
    const c2 = espion(el)
    el.premier()
    el.echanger()
    await tic()
    assert.equal(c2.n, 21)
    assert.equal(textes(el, 'li')[0], 'r1!')
    assert.equal(textes(el, 'li').at(-1), 'r1!')
  })

  it('liste dans un {if} fermée puis rouverte : la liste refaite est propre, l\'échange ne relit aucune ligne', async () => {
    const el = hote('si')
    await propre(el)
    el.cacher()
    await tic()
    el.retirer()
    el.fine()
    await tic()
    el.montrer()
    await tic()
    const c = espion(el)
    el.echanger()
    await tic()
    assert.equal(c.n, 0)
    assert.deepEqual(textes(el, 'li').slice(0, 4), ['r1', 'r10', 'r3 F', 'r4'])
  })

  it('ligne qui porte un {if}, {for} imbriqués : lignes impures, même écran à chaque geste', async () => {
    const el = hote('impurs')
    await propre(el)
    el.echanger()
    await tic()
    el.retirer()
    el.fine()
    await tic()
    el.dehors()
    await tic()
    el.muter()
    el.echanger()
    await tic()
    assert.deepEqual(textes(el, 'p b').slice(0, 4), ['r1', '+r10', 'r3 F', '+r4'])
    assert.equal(textes(el, 'p b').at(-1), '+h2')
    assert.deepEqual(textes(el, 'div i').slice(0, 3), ['r1', 'r10', 'r3 F'])
  })

  it('liste µraw : ses lignes pures restent sautées comme avant', async () => {
    const el = hote('brut')
    await propre(el)
    const c = espion(el)
    el.echanger()
    await tic()
    assert.equal(c.n, 0)
    assert.deepEqual(textes(el, 'li').slice(0, 3), ['r1', 'r9', 'r3'])
  })

  it('objet à accesseurs : son écriture salit la liste, l\'accesseur relu ; l\'échange suivant ne relit rien', async () => {
    const el = hote('acces')
    await propre(el)
    el.renommer()
    await tic()
    assert.equal(textes(el, 'li')[2], 'ZED')
    const c = espion(el)
    el.echanger()
    await tic()
    assert.equal(c.n, 0)
  })

  it('<vars> : une valeur refusée ne réveille rien, une ligne acceptée s\'ajoute sans relire les autres', async () => {
    const el = hote('typee')
    await propre(el)
    const c = espion(el)
    el.refus()
    await tic()
    el.pousser()
    await tic()
    assert.equal(c.n, 0)
    assert.equal(textes(el, 'li')[0], 'r11')
    assert.equal(textes(el, 'li').at(-1), 'x2')
  })
})
