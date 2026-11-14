// `$$[k]` — une clé du magasin calculée — n'est pas une syntaxe : `$$` se suit d'un nom écrit dans le code. Laissé passer, `$$` seul
// arrivait tel quel dans le code construit, et le composant tombait à l'exécution (`$$ is not defined`). La construction le refuse, à
// sa ligne et à sa colonne, avec ce qu'il faut écrire (une clé nommée, `µ.store[k]`, un µStore), dans le script, le gabarit, un
// gestionnaire d'événement et un reffet. Une clé nommée suivie d'une clé calculée (`$$valeurs[k]`), un texte (chaîne, texte du gabarit)
// et la propriété `$$` d'un objet (`o.$$[0]`) se construisent comme avant
import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const opts = { moduleName: 'c', fileName: 'c.mjs' } as any

// le source, puis la ligne et la colonne du `$$[` fautif
const REFUSES: Record<string, [string, number, number]> = {
  'lecture dans le script':   ["<script>\n  k = 'a'\n  $$a = 1\n  lire = -> $$[k]\n</script>\n<p>{lire()}</p>\n", 4, 13],
  'écriture dans le script':  ["<script>\n  k = 'a'\n  ecrire = -> $$[k] = 2\n</script>\n<p>x</p>\n", 3, 15],
  'reffet':                   ["<script>\n  $k = 'a'\n  µeffect =>\n    console.log $$[$k]\n</script>\n<p>x</p>\n", 4, 17],
  'expression du gabarit':    ["<script>\n  $k = 'a'\n  $$a = 1\n</script>\n<p>x</p>\n<p>{$$[$k]}</p>\n", 6, 5],
  'gestionnaire d\'événement': ["<script>\n  $k = 'a'\n</script>\n<p>x</p>\n<button @click={$$[$k] = 1}>x</button>\n", 5, 17],
  'gabarit, après une chaîne qui le cite': ["<script>\n  $k = 'a'\n  $$a = 1\n</script>\n<p>{'$$[k]'}</p>\n<p>{$$[$k]}</p>\n", 6, 5],
  'étalement dans le gabarit':    ["<script>\n  $k = 'a'\n</script>\n<p>x</p>\n<p {...$$[$k]}>y</p>\n", 5, 8],
}

const PERMIS: Record<string, [string, RegExp]> = {
  'clé nommée suivie d\'une clé calculée': ["<script>\n  $k = 'a'\n  $$valeurs = { a: 1 }\n  lire = -> $$valeurs[$k]\n</script>\n<p>{$$valeurs[$k]}</p>\n<button @click={$$valeurs[$k] = 2}>x</button>\n", /µ\.store\.valeurs\[/],
  'texte : chaîne et texte du gabarit':   ["<script>\n  s = '$$[k]'\n</script>\n<p>{s} $$[k]</p>\n", /'\$\$\[k\]'/],
  'propriété $$ d\'un objet':              ["<script>\n  o = { $$: [1] }\n  v = o.$$[0]\n</script>\n<p>{v}</p>\n", /o\.\$\$\[0\]/],
}

describe('$$[k] : une clé du magasin calculée est refusée à la construction, à sa ligne', function () {
  this.timeout(60000)

  for (const [quoi, [source, ligne, colonne]] of Object.entries(REFUSES)) it(`${quoi} : refusé, à sa ligne, avec ce qu'il faut écrire`, async () => {
    let message = ''
    try {
      await transpile(source, opts)
    }
    catch (e: any) {
      message = String(e.message)
    }
    assert.ok(message !== '', 'la construction devait refuser $$[…]')
    assert.ok(message.includes(`c.mjs:${ligne}:${colonne} `), `la ligne et la colonne du $$[ fautif (${ligne}:${colonne}) : ${message}`)
    assert.match(message, /« \$\$\[\$?k\] »/, 'le texte fautif cité')
    assert.match(message, /\$\$valeurs\[/, 'une clé nommée proposée')
    assert.match(message, /µ\.store\[/, 'µ.store[…] proposé')
    assert.match(message, /µStore/, 'µStore proposé')
    assert.match(message, /écrivez|Rangez/, 'au vouvoiement')
  })

  for (const [quoi, [source, attendu]] of Object.entries(PERMIS)) it(`${quoi} : se construit comme avant`, async () => {
    const r: any = await transpile(source, opts)
    assert.match(String(r.output), attendu)
    assert.doesNotMatch(String(r.output).replace(/'[^'\n]*'|"[^"\n]*"/g, ''), /(?<![\w.])\$\$\[/, 'aucun $$[ nu dans le code construit')
  })
})
