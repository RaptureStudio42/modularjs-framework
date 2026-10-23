// {for} SANS clé sur une liste qui contient plusieurs fois le même objet.
// Sans `by`, une ligne se reconnaît à son objet (étiquette `_mjsId` posée dessus) : le même objet
// deux fois donnait deux fois la même clé. Résultat vu : `[d, x, d]` bloquait la page (boucle sans
// fin), `[b, b, a]` perdait une ligne, puis `[a]` affichait une liste vide. Ce test garde : chaque
// occurrence a SA ligne, dans l'ordre, et les mises à jour (retrait, insertion, inversion, vidage)
// restent justes ; une liste sans doublon garde les mêmes clés qu'avant ; la clé explicite `by id`
// garde son comportement (1re occurrence, avertissement). Chaque cas tourne dans un processus enfant
// tué après quelques secondes : une boucle synchrone fait ÉCHOUER le test au lieu de suspendre la machine.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const RACINE = join(import.meta.dirname, '..')

// programme de l'enfant : monte le code déjà compilé dans happy-dom, joue les étapes, imprime le relevé
const ENFANT = `
import { Window } from 'happy-dom'
import { readFileSync } from 'node:fs'
const spec = JSON.parse(process.env.MJS_T_SPEC)
const win = new Window({ url: 'http://localhost/' })
win.eval(readFileSync(spec.code, 'utf-8') + '\\nglobalThis.µ = µ;\\nglobalThis.__av = [];\\nµ.warn = function(...a) { globalThis.__av.push(a.map(String).join(" ")); };')
win.document.body.innerHTML = '<' + spec.tag + '></' + spec.tag + '>'
const el = win.document.body.firstElementChild
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
await pause(120)
const o = { d: { v: 1 }, x: { v: 2 }, a: { v: 'a' }, b: { v: 'b' }, y: { v: 'y' } }
console.log('@@PRET')
const releves = []
for (const code of spec.etapes) {
  const liste = new Function('o', 'el', code)(o, el)
  el.set(liste)
  await pause(70)
  releves.push({
    texte: [...el._shadow.querySelectorAll('li')].map((n) => n.textContent.trim()),
    cles: Object.values(el._mjs_list_order || {}).map((c) => c.slice()),
    marques: [...el._shadow.querySelectorAll('mjs-sck-fils')].map((n) => !!n.__m),
    etats: [...el._shadow.querySelectorAll('mjs-sck-fils')].map((n) => n.v)
  })
}
console.log('@@' + JSON.stringify({ releves, avertissements: win.eval('globalThis.__av') }))
process.exit(0)
`

type Releve = { texte: string[]; cles: string[][]; marques: boolean[]; etats: string[] }
type Resultat = { releves: Releve[]; avertissements: string[] }

function source(corps: string, { raw = false, par = '' } = {}): string {
  const enrobe = raw ? 'µ.raw(rows.map((r) => (r && typeof r === \'object\' ? µ.raw(r) : r)))' : 'rows'
  return `<script lang="js">\n$data = [];\n@set = function(rows) { $data = ${enrobe}; };\n</script>\n<ul>\n{for n in $data${par}}\n${corps}\n{end}\n</ul>\n`
}

const LIGNE = '<li>{n.v}</li>'
const LIGNE_SIMPLE = '<li>{n}</li>'

let compteur = 0
const vivants = new Set<any>()

// compile l'hôte (et les fichiers annexes), le joue dans un enfant tué 3 s après le début des étapes
async function jouer(src: string, etapes: string[], extra: Record<string, string> = {}): Promise<Resultat> {
  const base = `sck${compteur++}`
  const root = mjsTmp(base)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, `${base}.mjs`), src)
  for (const [nom, s] of Object.entries(extra)) writeFileSync(join(srcDir, `${nom}.mjs`), s)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const fichier = join(root, 'code.js')
  writeFileSync(fichier, code)
  const spec = JSON.stringify({ code: fichier, tag: `mjs-${base}`, etapes })
  return new Promise((resolve, reject) => {
    const enfant = spawn(process.execPath, ['--input-type=module', '-e', ENFANT], { cwd: RACINE, env: { ...process.env, MJS_T_SPEC: spec } })
    vivants.add(enfant)
    let sortie = ''
    let erreur = ''
    let minuteur: NodeJS.Timeout | undefined
    enfant.stdout.on('data', (b) => {
      sortie += b
      if (minuteur === undefined && sortie.includes('@@PRET')) {
        minuteur = setTimeout(() => {
          enfant.kill('SIGKILL')
          reject(new Error('le montage ne rend pas la main en 3 s (boucle sans fin dans le {for})'))
        }, 3000)
      }
    })
    enfant.stderr.on('data', (b) => { erreur += b })
    enfant.on('close', () => {
      vivants.delete(enfant)
      if (minuteur) clearTimeout(minuteur)
      const m = sortie.match(/@@(\{.*\})/)
      if (m) resolve(JSON.parse(m[1]))
      else reject(new Error(`enfant sans relevé : ${erreur.slice(0, 600)}`))
    })
  })
}

const textes = (r: Resultat) => r.releves.map((x) => x.texte)

describe('{for} sans clé — le même objet plusieurs fois', function () {
  // chaque cas compile un projet et démarre un processus node : plus de 8 s sous charge. La boucle sans fin, elle, reste
  // prise par l'enfant, tué 3 s après le début des étapes
  this.timeout(60000)
  afterEach(() => { for (const e of vivants) e.kill('SIGKILL') })
  after(async () => { await terminateSharedWorkerPool() })

  for (const raw of [false, true]) {
    const nom = raw ? 'µraw' : 'liste ordinaire'

    it(`${nom} : [d, x, d] s'affiche en 3 lignes, sans blocage`, async function () {
      const r = await jouer(source(LIGNE, { raw }), ['return [o.d, o.x, o.d]'])
      assert.deepEqual(textes(r), [['1', '2', '1']])
    })

    it(`${nom} : [b, b, a] puis [a] : aucune ligne perdue, aucune liste vide`, async function () {
      const r = await jouer(source(LIGNE, { raw }), ['return [o.b, o.b, o.a]', 'return [o.a]'])
      assert.deepEqual(textes(r), [['b', 'b', 'a'], ['a']])
    })

    it(`${nom} : trois occurrences, puis retrait, puis ajout`, async function () {
      const r = await jouer(source(LIGNE, { raw }), ['return [o.d, o.d, o.d]', 'return [o.d, o.d]', 'return [o.d, o.d, o.d, o.d]'])
      assert.deepEqual(textes(r), [['1', '1', '1'], ['1', '1'], ['1', '1', '1', '1']])
    })

    it(`${nom} : retrait de la 1re occurrence, puis de la dernière`, async function () {
      const r = await jouer(source(LIGNE, { raw }), ['return [o.d, o.x, o.d]', 'return [o.x, o.d]', 'return [o.d, o.x, o.d]', 'return [o.d, o.x]'])
      assert.deepEqual(textes(r), [['1', '2', '1'], ['2', '1'], ['1', '2', '1'], ['1', '2']])
    })

    it(`${nom} : insertion entre deux occurrences, puis inversion`, async function () {
      const r = await jouer(source(LIGNE, { raw }), ['return [o.d, o.d]', 'return [o.d, o.x, o.d]', 'return [o.d, o.a, o.x, o.d]', 'return [o.d, o.x, o.a, o.d]', 'return [o.a, o.d, o.d, o.x]'])
      assert.deepEqual(textes(r), [['1', '1'], ['1', '2', '1'], ['1', 'a', '2', '1'], ['1', '2', 'a', '1'], ['a', '1', '1', '2']])
    })

    it(`${nom} : vidage puis recréation (réserve de lignes)`, async function () {
      const r = await jouer(source(LIGNE, { raw }), ['return [o.d, o.x, o.d]', 'return []', 'return [o.d, o.x, o.d]', 'return [o.b, o.b]'])
      assert.deepEqual(textes(r), [['1', '2', '1'], [], ['1', '2', '1'], ['b', 'b']])
    })
  }

  it('nombres et chaînes répétés', async function () {
    const r = await jouer(source(LIGNE_SIMPLE), ['return [1, 1, 2]', 'return [2, 1, 1]', 'return ["a", "a", "b"]', 'return ["b", "a"]'])
    assert.deepEqual(textes(r), [['1', '1', '2'], ['2', '1', '1'], ['a', 'a', 'b'], ['b', 'a']])
  })

  it('liste sans doublon : mêmes clés qu\'avant', async function () {
    const etapes = [
      'return [o.d, o.x, o.a]',
      'return [o.d, o.x, o.a, o.b]',
      'return [o.a, o.x, o.d]',
      'return [o.x, o.b]',
      'return []'
    ]
    const r = await jouer(source(LIGNE), etapes)
    assert.deepEqual(r.releves.map((x) => x.cles[0]), [
      ['mjs-1', 'mjs-2', 'mjs-3'],
      ['mjs-1', 'mjs-2', 'mjs-3', 'mjs-4'],
      ['mjs-3', 'mjs-2', 'mjs-1'],
      ['mjs-2', 'mjs-4'],
      []
    ])
    assert.deepEqual(textes(r), [['1', '2', 'a'], ['1', '2', 'a', 'b'], ['a', '2', '1'], ['2', 'b'], []])
  })

  it('liste avec doublon : la 1re occurrence garde la clé de l\'objet, les suivantes portent leur rang', async function () {
    const r = await jouer(source(LIGNE), ['return [o.d, o.x, o.d, o.d]', 'return [o.x, o.d]'])
    assert.deepEqual(r.releves.map((x) => x.cles[0]), [['mjs-1', 'mjs-2', 'mjs-1#1', 'mjs-1#2'], ['mjs-2', 'mjs-1']])
  })

  it('liste de valeurs simples sans doublon : clés par index, comme avant', async function () {
    const r = await jouer(source(LIGNE_SIMPLE), ['return [5, 6, 7]', 'return [7, 5]'])
    assert.deepEqual(r.releves.map((x) => x.cles[0]), [['idx-0', 'idx-1', 'idx-2'], ['idx-0', 'idx-1']])
  })

  it('composant enfant dans la ligne : la 1re occurrence garde son état interne', async function () {
    const enfant = `<span>{@v}</span>\n<script lang="js">\n@v = 'neuf';\n</script>\n`
    const marque = 'const f = el._shadow.querySelectorAll("mjs-sck-fils"); f[0].v = "ETAT"; f[0].__m = 1; '
    const r = await jouer(source('<li><@sck-fils/></li>'), [
      'return [o.d, o.x, o.d]',
      marque + 'return [o.d, o.x, o.d, o.a]',
      'return [o.d, o.x, o.d]',
      'return [o.d, o.x]'
    ], { 'sck-fils': enfant })
    assert.deepEqual(r.releves.map((x) => x.marques), [[false, false, false], [true, false, false, false], [true, false, false], [true, false]])
    assert.equal(r.releves[3].etats[0], 'ETAT')
  })

  it('avec `by id` et des ids en double : 1re occurrence gardée, avertissement une fois', async function () {
    const src = `<script lang="js">\n$data = [];\n@set = function(rows) { $data = rows; };\n</script>\n<ul>\n{for n in $data by id}\n<li>{n.v}</li>\n{end}\n</ul>\n`
    const r = await jouer(src, ['return [{ id: 1, v: "a" }, { id: 1, v: "b" }, { id: 2, v: "c" }]', 'return [{ id: 2, v: "c" }, { id: 2, v: "d" }]'])
    assert.deepEqual(textes(r), [['a', 'c'], ['c']])
    assert.equal(r.avertissements.filter((m) => /clés dupliquées/.test(m)).length, 1)
  })
})
