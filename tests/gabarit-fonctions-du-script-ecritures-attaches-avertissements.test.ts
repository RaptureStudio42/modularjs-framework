// Une fonction du <script> lue par le gabarit compte ses lectures comme une méthode, avec trois bornes :
// - ce qu'elle ÉCRIT n'est pas une lecture : toute la chaîne d'objet d'une cible d'affectation simple (`$o.a.b = …`, `$$ui.locked = …`,
//   `[$p.a] = …`) ; une clé calculée (`$q[$k] = …`) garde la lecture de `$k`, `+=` reste une lecture ;
// - une attache `:attach={f(_node)}` suit sa fonction du <script> comme `:attach={@f(_node)}` suit sa méthode : son corps, sans
//   les fonctions du <script> qu'il appelle ; une méthode n'y apporte pas non plus la fonction du <script> qu'elle appelle ;
// - l'avertissement d'un nom que la construction ne sait pas lire ne vise que deux affectations au premier niveau du <script>, ou une
//   valeur rendue par un appel : une variable du même nom déclarée dans une autre fonction, une fonction du langage ou du navigateur
//   (`Math.round`, `new Intl.NumberFormat(…).format`) n'en font pas ; son conseil vaut en Civet, en CoffeeScript et en JavaScript

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

function carte(output: string): string {
  const m = output.match(/_mjs_effectsByVar\s*=\s*(\{[^;]*\})/)
  assert.ok(m, `_mjs_effectsByVar introuvable dans le JS émis :\n${output}`)
  return m![1]
}

async function construire(src: string, nom: string): Promise<{ output: string; avertissements: string[] }> {
  const avertissements: string[] = []
  const warn = console.warn
  console.warn = (...a: any[]) => { avertissements.push(String(a[0])) }
  try {
    const { output } = await transpile(src, { moduleName: nom })
    return { output, avertissements }
  }
  finally {
    console.warn = warn
  }
}

const illisibles = (avertissements: string[]): string[] => avertissements.filter((a) => a.includes('ne sait pas lire'))

describe('gabarit : fonctions du <script> — écritures, attaches, avertissements', () => {

  it('une cible d\'affectation simple n\'est pas une lecture, chaîne d\'objet comprise ; une clé calculée et `+=` lisent', async () => {
    const src = '<script>\n$o = { a: { b: 0 } }\n$p = { a: 0 }\n$q = {}\n$k = \'c\'\n$r = 0\n$$ui = { locked: false }\nf = ->\n  $o.a.b = 1\n  $$ui.locked = true\n  [$p.a] = [2]\n  $q[$k] = 3\n  $r += 1\n  null\n</script>\n<p>{f()}</p>'
    const c = carte((await construire(src, 'ecritures-pas-lues')).output)
    for (const ecrite of ['"o"', '"p"', '"q"', '"$$ui"']) assert.ok(!c.includes(ecrite), `${ecrite} est écrite, pas lue : ${c}`)
    assert.match(c, /"k"/)
    assert.match(c, /"r"/)
  })

  it(':attach={f(_node)} suit sa fonction du <script> comme :attach={@f(_node)} sa méthode, sans la fonction qu\'appelle la méthode', async () => {
    const locale  = await construire('<script>\n$shown = false\nhook = (node) ->\n  node.dataset.vu = String($shown)\n  null\n</script>\n<div :attach={hook(_node)}>x</div>', 'attache-fonction')
    const methode = await construire('<script>\n$shown = false\n@hook = (node) ->\n  node.dataset.vu = String($shown)\n  null\n</script>\n<div :attach={@hook(_node)}>x</div>', 'attache-methode')
    // une méthode qui appelle une fonction du <script> : l'attache ne suit que les lectures de la méthode elle-même
    const relais  = await construire('<script>\n$shown = false\n$autre = 0\nlire = -> $autre\n@hook = (node) ->\n  node.dataset.vu = String($shown) + lire()\n  null\n</script>\n<div :attach={@hook(_node)}>x</div>', 'attache-methode-relais')
    assert.match(carte(locale.output), /"shown"/)
    assert.match(carte(methode.output), /"shown"/)
    assert.match(carte(relais.output), /"shown"/)
    assert.doesNotMatch(carte(relais.output), /"autre"/)
    assert.deepEqual(illisibles(locale.avertissements), [])
  })

  it('une variable du même nom déclarée dans une autre fonction n\'est pas une seconde affectation : suivie, sans avertissement', async () => {
    const { output, avertissements } = await construire('<script>\n$n = 1\ntotal = -> $n * 2\nresume = (liste) ->\n  total := liste.length\n  total\n</script>\n<p>{total()}</p><p>{total() + 1}</p><p title={total()}>x</p>', 'homonyme-autre-fonction')
    assert.deepEqual(illisibles(avertissements), [])
    assert.match(carte(output), /"n"/)
  })

  it('une fonction du langage ou du navigateur rangée sous un nom (Math.round, Intl…format) : aucun avertissement', async () => {
    const { output, avertissements } = await construire("<script>\n$n = 1.5\narrondi = Math.round\neuros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format\n</script>\n<p>{arrondi($n)} {euros($n)}</p>", 'fonctions-du-langage')
    assert.deepEqual(illisibles(avertissements), [])
    assert.match(carte(output), /"n"/)
  })

  it('avertissement gardé : deux affectations au premier niveau, valeur rendue par un appel ; réaffectée dans une fonction : ni suivie ni dite', async () => {
    const deux   = await construire('<script>\n$n = 1\n$m = 2\nf = -> $n\nf = -> $m\n</script>\n<p>{f()}</p>', 'deux-au-premier-niveau')
    const appel  = await construire('<script>\n$n = 1\ndiffere = (g) -> g\nsauver = differe(-> $n)\n</script>\n<p>{sauver()}</p>', 'resultat-d-un-appel')
    const monte  = await construire('<script>\n$n = 1\n$m = 2\nf = -> $n\nµmount ->\n  f = -> $m\n</script>\n<p>{f()}</p>', 'reaffectee-dans-une-fonction')
    assert.equal(illisibles(deux.avertissements).length, 1, deux.avertissements.join('\n'))
    assert.equal(illisibles(appel.avertissements).length, 1, appel.avertissements.join('\n'))
    assert.deepEqual(illisibles(monte.avertissements), [])
    assert.doesNotMatch(carte(monte.output), /"[nm]"/)
  })

  it('le conseil de l\'avertissement vaut en JavaScript : aucune syntaxe de Civet ou de CoffeeScript', async () => {
    const { avertissements } = await construire('<script lang="js">\n$n = 1\nlet differe = (g) => g\nlet sauver = differe(() => $n)\n</script>\n<p>{sauver()}</p>', 'conseil-javascript')
    const dits = illisibles(avertissements)
    assert.equal(dits.length, 1, avertissements.join('\n'))
    assert.doesNotMatch(dits[0], /-> …|:=/)
    assert.match(dits[0], /une seule fois, au premier niveau du <script>/)
  })
})
