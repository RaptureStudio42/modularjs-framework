// les sucres du script ne lisent que le code, dans un vrai navigateur (Chromium, modules en mode strict) : une boucle `for … in`
// d'une interpolation ou à motif parcourt les valeurs, le texte d'une chaîne (triple guillemet, chaîne écrite dans une
// interpolation) reste tel qu'écrit, une rune `µ$` lue dans une interpolation CoffeeScript est réécrite

import assert from 'node:assert/strict'
import { monterComposants, type Composants } from './helpers/composants-navigateur.js'

// nom du composant → [son code, le texte attendu de son <p>]
const CAS: Record<string, [string, string]> = {
  'sucres-interp':    ["<script>\ngens = [{nom: 'Ana'}, {nom: 'Bob'}]\n$t = \"noms : #{(p.nom for p in gens).join(', ')}\"\n</script>\n<p>{$t}</p>\n", 'noms : Ana, Bob'],
  'sucres-motif':     ["<script>\ngens = [{nom: 'Ana', age: 3}, {nom: 'Bob', age: 5}]\nnoms = []\nfor {nom} in gens\n  noms.push nom\npaires = []\nfor [k, v] in Object.entries({x: 1, y: 2})\n  paires.push k + v\ntotal = 0\nfor {age}, i in gens\n  total += age + i\n$res = noms.join(',') + '|' + paires.join(',') + '|' + total\n</script>\n<p>{$res}</p>\n", 'Ana,Bob|x1,y2|9'],
  'sucres-triple':    ["<script>\ngens = ['a', 'b']\n$aide = '''\n  L'heure\n'''\nvus = []\nfor it in gens\n  vus.push it\n$res = vus.join(',')\n</script>\n<p>{$res}|{$aide.trim()}</p>\n", "a,b|L'heure"],
  'sucres-pouce':     ["<script>\n$t = \"\"\"5\" de large\"\"\"\ngens = ['a', 'b']\nvus = []\nfor it in gens\n  vus.push it\n$res = vus.join(',')\n</script>\n<p>{$res}|{$t}</p>\n", 'a,b|5" de large'],
  'sucres-texte':     ["<script>\n$t = \"\"\"Il dit \"for x in liste\" et \"a isnt b\" ici\"\"\"\n</script>\n<p>{$t}</p>\n", 'Il dit "for x in liste" et "a isnt b" ici'],
  'sucres-dedans':    ["<script>\nok = true\n$u = `duree ${ if ok then 'for a in b, 12 µs' else '' }`\n$v = \"duree #{ if ok then '12 µs' else '' }\"\n</script>\n<p>{$u}|{$v}</p>\n", 'duree for a in b, 12 µs|duree 12 µs'],
  'sucres-dedans-js': ["<script lang=\"js\">\nconst ok = true\n$u = `duree ${ ok ? '12 µs' : '' }`\n</script>\n<p>{$u}</p>\n", 'duree 12 µs'],
  'sucres-coffee':    ["<script lang=\"coffee\">\nµ$zsucres = { n: 3 }\n$t = \"total #{µ$zsucres.n}\"\n</script>\n<p>{$t}</p>\n", 'total 3']
}

describe('sucres du script : chaînes et for … in (Chromium réel, mode strict)', function () {
  this.timeout(280000)
  let composants: Composants | null = null

  before(async function () {
    composants = await monterComposants(Object.fromEntries(Object.entries(CAS).map(([nom, [code]]) => [nom, code])))
    if (!composants) this.skip()
  })

  after(async () => {
    if (composants) await composants.fermer()
  })

  for (const [nom, [, attendu]] of Object.entries(CAS)) {
    it(`${nom} : le client affiche « ${attendu} »`, async function () {
      const page = await composants!.client(nom, 'p')
      try {
        assert.equal(await page.evaluate(`document.querySelector('mjs-${nom}')._shadow.querySelector('p').textContent`), attendu)
      }
      finally { await page.close() }
    })
  }
})
