// Analyse du script et du gabarit : quatre fautes de lecture des variables réactives.
//   - `$a = $b = 0` au niveau du script faisait de `$a` un dérivé qui ÉCRIVAIT `$b` et valait le retour de
//     l'écriture (`true`) ; `$x = $y = []` remplaçait le composant par une erreur fatale
//   - un nom accentué : `$prénom` déclarait une variable fantôme `pr`, `$âge` compilait puis remplaçait le
//     composant par « $âge is not defined »
//   - un texte qui parle d'une variable (`$constructor` dans un `<p>`) faisait échouer la construction, et
//     `5 $US` déclarait un état fantôme `US`
//   - `$total = $total + $prix` : l'avertissement annonçait une « auto-résolution » qui donnait NaN, et un
//     cycle à deux noms était signalé une fois par nom et par passe

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

function varBits(code: string): Record<string, number> {
  const m = /_mjs_var_bits\s*=\s*(\{[^}]*\})/.exec(code)
  assert.ok(m, 'registre de présence introuvable dans le code émis')
  return JSON.parse(m![1].replace(/([{,]\s*)([^\s"{},:]+)\s*:/g, '$1"$2":'))
}

async function avertissements(src: string, nom: string): Promise<string[]> {
  const lignes: string[] = []
  const ow = console.warn
  console.warn = (...a: any[]) => { lignes.push(a.map(String).join(' ')) }
  try { await transpile(src, { moduleName: nom }) }
  finally { console.warn = ow }
  return lignes
}

const texte = (hote: any, sel = 'p') => hote._shadow.querySelector(sel)?.textContent

describe('script — affectation en chaîne au niveau du script', function () {
  this.timeout(90000)
  after(async () => { await terminateSharedWorkerPool() })

  it('$a = $b = 0 : les deux valent 0, et $a++ ne touche que $a', async () => {
    const { hote } = await monterHote('<script>\n$a = $b = 0\n</script>\n<p>{$a}|{$b}</p><button @click={$a++}>+</button>', 'chaine-zero')
    assert.equal(texte(hote), '0|0')
    hote._shadow.querySelector('button').click()
    await pause(60)
    assert.equal(texte(hote), '1|0')
  })

  it('$x = $y = [] : deux listes vides, aucune erreur fatale', async () => {
    const { hote } = await monterHote('<script>\n$x = $y = []\n</script>\n<p>{$x.length}|{$y.length}</p>', 'chaine-liste')
    assert.equal(texte(hote), '0|0')
  })

  it('$debut = $fin = "midi" : les deux valent midi', async () => {
    const { hote } = await monterHote('<script>\n$debut = $fin = "midi"\n</script>\n<p>{$debut}|{$fin}</p>', 'chaine-texte')
    assert.equal(texte(hote), 'midi|midi')
  })
})

describe('analyseur — noms accentués', function () {
  this.timeout(90000)
  after(async () => { await terminateSharedWorkerPool() })

  it('$prénom s\'affiche et se suit, sans variable fantôme pr', async () => {
    const src = "<script>\n$prénom = 'Léa'\n</script>\n<p>{$prénom}</p><button @click={$prénom = 'Zoé'}>z</button>"
    const bits = varBits((await transpile(src, { moduleName: 'accent-script' })).output)
    assert.ok('prénom' in bits, JSON.stringify(bits))
    assert.ok(!('pr' in bits), JSON.stringify(bits))
    const { hote } = await monterHote(src, 'accent-monte')
    assert.equal(texte(hote), 'Léa')
    hote._shadow.querySelector('button').click()
    await pause(60)
    assert.equal(texte(hote), 'Zoé')
  })

  it('$prénom seulement dans le gabarit : le nom entier est déclaré', async () => {
    const bits = varBits((await transpile('<p>{$prénom}</p>', { moduleName: 'accent-gabarit' })).output)
    assert.ok('prénom' in bits, JSON.stringify(bits))
    assert.ok(!('pr' in bits), JSON.stringify(bits))
  })

  it('$âge dans le gabarit : erreur de construction qui propose $age', async () => {
    await assert.rejects(transpile('<p>{$âge}</p>', { moduleName: 'accent-age' }), (e: any) => /\$âge/.test(e.message) && /\$age/.test(e.message))
  })

  it('$âge dans le script : erreur de construction', async () => {
    await assert.rejects(transpile('<script>\n$âge = 5\n</script>\n<p>x</p>', { moduleName: 'accent-age-script' }), (e: any) => /\$âge/.test(e.message) && /\$age/.test(e.message))
  })

  it('témoin : « $été » écrit dans une chaîne d\'une expression ne lève rien', async () => {
    await assert.doesNotReject(transpile("<p>{'5 $été'}</p>", { moduleName: 'accent-chaine' }))
  })
})

describe('analyseur — un $ dans le texte n\'est pas une variable', () => {
  it('$constructor et $prototype cités dans un <p> ne cassent pas la construction', async () => {
    await assert.doesNotReject(transpile('<p>Ne nommez jamais une variable $constructor ni $prototype.</p>', { moduleName: 'texte-reserve' }))
  })

  it('« 5 $US » dans un <p> ne déclare aucun état', async () => {
    const bits = varBits((await transpile('<p>Tarif : 5 $US par mois</p>', { moduleName: 'texte-dollar' })).output)
    assert.ok(!('US' in bits), JSON.stringify(bits))
  })

  it('témoin : les variables des expressions et des attributs restent déclarées', async () => {
    const bits = varBits((await transpile('<p title="{$t}" data-on={$on}>{$n} $US</p>', { moduleName: 'texte-temoin' })).output)
    for (const v of ['t', 'on', 'n']) assert.ok(v in bits, `${v} absent de ${JSON.stringify(bits)}`)
    assert.ok(!('US' in bits), JSON.stringify(bits))
  })
})

describe('analyseur — cycle réactif : message juste, une fois par nom', function () {
  this.timeout(90000)
  after(async () => { await terminateSharedWorkerPool() })

  it('$total = $total + $prix : un avertissement, sans « auto-résolution », qui propose =:', async () => {
    const lignes = (await avertissements('<script>\n$total = 10\n$prix = 2\n$total = $total + $prix\n</script>\n<p>{$total}</p>', 'cycle-auto')).filter(l => /total/.test(l) && /[Cc]ycle/.test(l))
    assert.equal(lignes.length, 1, lignes.join('\n'))
    assert.ok(!/auto-r[ée]solution/.test(lignes[0]), lignes[0])
    assert.match(lignes[0], /\$total =:/)
  })

  it('cycle à deux noms : une ligne par nom, jamais répétée', async () => {
    const src = '<script>\n$x = 1\n$a = $b + $x\n$b = $a + 1\n$c1 = $x\n$c2 = $c1\n$c3 = $c2\n$c4 = $c3\n$c5 = $c4\n</script>\n<p>{$a}{$c5}</p>'
    const lignes = (await avertissements(src, 'cycle-deux')).filter(l => /[Cc]ycle/.test(l))
    assert.equal(lignes.length, 2, lignes.join('\n'))
    assert.ok(lignes.some(l => /'a'/.test(l)) && lignes.some(l => /'b'/.test(l)), lignes.join('\n'))
  })

  it('la forme proposée (=:) calcule une fois au départ', async () => {
    const { hote } = await monterHote('<script>\n$total = 10\n$prix = 2\n$total =: $total + $prix\n</script>\n<p>{$total}</p>', 'cycle-fige')
    assert.equal(texte(hote), '12')
  })
})

describe('parseur — {for} sur plusieurs lignes, monté', function () {
  this.timeout(90000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le parcours multiligne affiche les éléments retenus', async () => {
    const { hote } = await monterHote("<script>\n$items = [{ n: 'a', ok: true }, { n: 'b', ok: false }, { n: 'c', ok: true }]\n</script>\n<div>\n{for x in $items.filter((i) ->\n    i.ok)}\n<p>{x.n}</p>\n{end}\n</div>", 'for-multiligne')
    assert.deepEqual([...hote._shadow.querySelectorAll('p')].map((p: any) => p.textContent), ['a', 'c'])
  })
})
