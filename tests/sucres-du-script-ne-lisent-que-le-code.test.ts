// les sucres du script ne lisent que le code : une boucle `for … in` reste une boucle sur les valeurs dans une interpolation
// et avec un motif, le texte d'une chaîne (triple guillemet, chaîne d'une interpolation) ne change pas — vraie construction, rendu
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { monterHote } from './helpers/coeur-monter.js'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

// un module autonome construit seul : son code produit
async function moduleConstruit(nom: string, source: string): Promise<string> {
  const root   = mjsTmp('sucres-module')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const sortie = readdirSync(outDir).find((f) => f.startsWith(nom.split('.')[0] + '-') && f.endsWith('.js'))
  assert.ok(sortie, 'module construit')
  return readFileSync(join(outDir, sortie!), 'utf-8')
}

const texte = (hote: any): string => String(hote._shadow?.querySelector('p')?.textContent ?? '(rien)')

describe('sucres du script : chaînes et for … in', function () {
  this.timeout(120_000)
  after(async () => { await terminateSharedWorkerPool() })

  it('for … in dans une interpolation "#{…}" parcourt les valeurs', async () => {
    const { hote } = await monterHote("<script>\ngens = [{nom: 'Ana'}, {nom: 'Bob'}]\n$t = \"noms : #{(p.nom for p in gens).join(', ')}\"\n</script>\n<p>{$t}</p>\n", 'sucres-interp')
    assert.equal(texte(hote), 'noms : Ana, Bob')
  })

  it('for {motif} in, for [motif] in et for {motif}, i in parcourent les valeurs', async () => {
    const { hote } = await monterHote("<script>\ngens = [{nom: 'Ana', age: 3}, {nom: 'Bob', age: 5}]\nnoms = []\nfor {nom} in gens\n  noms.push nom\npaires = []\nfor [k, v] in Object.entries({x: 1, y: 2})\n  paires.push k + v\ntotal = 0\nfor {age}, i in gens\n  total += age + i\n$res = noms.join(',') + '|' + paires.join(',') + '|' + total\n</script>\n<p>{$res}</p>\n", 'sucres-motif')
    assert.equal(texte(hote), 'Ana,Bob|x1,y2|9')
  })

  it("une apostrophe dans une chaîne ''' ne retourne pas la lecture du reste du script", async () => {
    const { hote } = await monterHote("<script>\ngens = ['a', 'b']\n$aide = '''\n  L'heure\n'''\nvus = []\nfor it in gens\n  vus.push it\n$res = vus.join(',')\n</script>\n<p>{$res}|{$aide.trim()}</p>\n", 'sucres-triple')
    assert.equal(texte(hote), "a,b|L'heure")
  })

  it('un guillemet seul dans une chaîne """ ne retourne pas la lecture du reste du script', async () => {
    const { hote } = await monterHote("<script>\n$t = \"\"\"5\" de large\"\"\"\ngens = ['a', 'b']\nvus = []\nfor it in gens\n  vus.push it\n$res = vus.join(',')\n</script>\n<p>{$res}|{$t}</p>\n", 'sucres-pouce')
    assert.equal(texte(hote), 'a,b|5" de large')
  })

  it('le texte entre guillemets d\'une chaîne """ reste tel qu\'écrit', async () => {
    const { hote } = await monterHote("<script>\n$t = \"\"\"Il dit \"for x in liste\" et \"a isnt b\" ici\"\"\"\n</script>\n<p>{$t}</p>\n", 'sucres-texte')
    assert.equal(texte(hote), 'Il dit "for x in liste" et "a isnt b" ici')
  })

  it("une chaîne écrite dans une interpolation reste telle qu'écrite (Civet, JavaScript)", async () => {
    const civet = await monterHote("<script>\nok = true\n$u = `duree ${ if ok then 'for a in b, 12 µs' else '' }`\n$v = \"duree #{ if ok then '12 µs' else '' }\"\n</script>\n<p>{$u}|{$v}</p>\n", 'sucres-dedans')
    assert.equal(texte(civet.hote), 'duree for a in b, 12 µs|duree 12 µs')
    const js = await monterHote("<script lang=\"js\">\nconst ok = true\n$u = `duree ${ ok ? '12 µs' : '' }`\n</script>\n<p>{$u}</p>\n", 'sucres-dedans-js')
    assert.equal(texte(js.hote), 'duree 12 µs')
  })

  it("module CoffeeScript : une apostrophe dans un commentaire ### ne retourne pas la lecture de la suite", async () => {
    const code = await moduleConstruit('zsucresc.coffee.mjs', "###\n  L'etat du panier\n###\nµ$zsucresm = { n: 2 }\nexport lire = -> µ$zsucresm.n\n")
    assert.ok(code.includes('µ_state.zsucresm.n'), code)
    assert.ok(!code.includes('µ$zsucresm'), code)
  })

  it("module Civet : une apostrophe dans une chaîne ''' ne retourne pas la lecture de la suite", async () => {
    const code = await moduleConstruit('zsucresv.civet.mjs', "export liste = ->\n  aide = '''\n    L'heure\n  '''\n  vus = []\n  for it in ['a', 'b']\n    vus.push it\n  vus\n")
    assert.match(code, /for \(const it of \['a', 'b'\]\)/)
  })

  it('CoffeeScript : une rune µ$ lue dans une interpolation "#{…}" est réécrite', async () => {
    const { hote } = await monterHote("<script lang=\"coffee\">\nµ$zsucres = { n: 3 }\n$t = \"total #{µ$zsucres.n}\"\n</script>\n<p>{$t}</p>\n", 'sucres-coffee')
    assert.equal(texte(hote), 'total 3')
  })
})
