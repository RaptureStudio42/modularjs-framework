// Écritures réactives, vues depuis un composant monté : chaque écriture (`$x = v`, `$$x++`, `$o.k = v`,
// `$liste.push(v)`, `$[cle()] += 1`…) doit faire exactement ce que la même ligne ferait en JavaScript,
// quelle que soit sa place — instruction seule, valeur lue, après une autre ligne, chaîne optionnelle.
//
// Défauts garantis absents :
// - une variable qui garde un objet de l'état (`ancien := $a`) écrivait dans l'objet ACTUEL de `$a`
//   après `$a = $b` (et `p := $items[0]` dans le nouvel élément après un `unshift`) ;
// - `$$cpt++` posé sur sa ligne après une autre instruction plantait au clic (« … is not a function ») ;
// - `if $res = chercher(k)` prenait toujours la branche « trouvé » ;
// - `$a = $$b = 5` laissait `$a` vide ;
// - `$liste?.push(1)` sur une liste `null` plantait ;
// - `$[cle()] += 1` appelait `cle()` deux fois ;
// - `$x = (noter('a'), 2)` écrivait la première valeur au lieu de la dernière ;
// - `@click={$cb = -> …}` APPELAIT la fonction rangée dès qu'un nom du gabarit recouvrait une variable du script.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string[]> = {
  'ec-alias': [
    '<script>',
    "$a = { nom: 'a', on: true }",
    "$b = { nom: 'b', on: true }",
    "$items = [{ n: 'x', fait: false }]",
    '$go = -> choisir()',
    '$go2 = -> premier()',
    'choisir = ->',
    '  ancien := $a',
    '  $a = $b',
    '  ancien.on = false',
    'premier = ->',
    '  p := $items[0]',
    "  $items.unshift({ n: 'z', fait: false })",
    '  p.fait = true',
    '</script>',
    '<p class="r">{$a.nom}:{$a.on}</p>',
    "<p class=\"l\">{$items.map((i) -> i.n + '=' + i.fait).join(',')}</p>",
    '<button class="b1" @click={$go()}>go</button>',
    '<button class="b2" @click={$go2()}>go2</button>',
  ],
  'ec-asi': [
    '<script>',
    '$$ecCpt = 0',
    '$$ecObj = { n: 0 }',
    'trace = []',
    '$go = -> incr()',
    'incr = ->',
    "  trace.push 'avant'",
    '  $$ecCpt++',
    "  trace.push 'milieu'",
    '  ++$$ecCpt',
    "  trace.push 'encore'",
    '  --$$ecCpt',
    "  trace.push 'objet'",
    '  $$ecObj.n++',
    "  trace.push 'apres'",
    '</script>',
    '<p class="n">{$$ecCpt}|{$$ecObj.n}</p>',
    '<button class="b" @click={$go()}>+</button>',
  ],
  'ec-ifset': [
    '<script>',
    '$res = null',
    "$msg = 'rien'",
    '$go = -> f2()',
    'chercher = (k) -> undefined',
    'f2 = ->',
    "  if $res = chercher('zz')",
    "    $msg = 'oui'",
    '  else',
    "    $msg = 'non'",
    '</script>',
    '<p class="m">{$msg}</p>',
    '<button class="b" @click={$go()}>go</button>',
  ],
  'ec-chaine': [
    '<script>',
    '$a = 0',
    '$$ecSb = 0',
    '$$ecSx = 0',
    '$$ecSy = 0',
    '$go = -> ch()',
    'ch = ->',
    '  $a = $$ecSb = 5',
    '  $$ecSx = $$ecSy = 7',
    '</script>',
    '<p class="v">{$a}|{$$ecSb}|{$$ecSx}|{$$ecSy}</p>',
    '<button class="b" @click={$go()}>go</button>',
  ],
  'ec-optchain': [
    '<script>',
    '$list = null',
    '$cnt = 0',
    '$$ecListe = null',
    '$go = ->',
    '  $list?.push(1)',
    '  $$ecListe?.push(1)',
    '  $cnt++',
    '$remplir = ->',
    '  $list = []',
    '  $$ecListe = []',
    '$pousser = ->',
    '  $list?.push(4)',
    '  $$ecListe?.push(5)',
    '</script>',
    "<p class=\"c\">{$cnt}|{$list ? $list.join(',') : '-'}|{$$ecListe ? $$ecListe.join(',') : '-'}</p>",
    '<button class="b" @click={$go()}>go</button>',
    '<button class="r" @click={$remplir()}>r</button>',
    '<button class="p" @click={$pousser()}>p</button>',
  ],
  'ec-dyn': [
    '<script>',
    '$k1 = 0',
    '$k2 = 10',
    "cles = ['k1', 'k2', 'k1', 'k2']",
    'idx = 0',
    'pick = -> cles[idx++]',
    '$go = ->',
    '  $[pick()] += 1',
    '  globalThis.__ecIdx = idx',
    '$go2 = ->',
    '  $[pick()]++',
    '  globalThis.__ecIdx = idx',
    '</script>',
    '<p class="v">{$k1}|{$k2}</p>',
    '<button class="g" @click={$go()}>go</button>',
    '<button class="g2" @click={$go2()}>go2</button>',
  ],
  'ec-paren': [
    '<script>',
    '$x = 0',
    '$o = { k: 0 }',
    '$$ecK = 0',
    '$liste = []',
    'trace = []',
    '$go = ->',
    "  $x = (trace.push('a'), 2)",
    "  $o.k = (trace.push('b'), 3)",
    "  $$ecK = (trace.push('c'), 4)",
    "  $liste.push((trace.push('d'), 5))",
    '</script>',
    "<p class=\"v\">{$x}|{$o.k}|{$$ecK}|{$liste.join(',')}</p>",
    '<button class="b" @click={$go()}>go</button>',
  ],
  // `item` du script recouvre la variable de boucle du gabarit : les gestionnaires sont compilés par groupes
  'ec-groupe': [
    '<script>',
    "item = 'script'",
    '$items = [1]',
    '$cb = null',
    'globalThis.__ecAppels = 0',
    '</script>',
    '{for item in $items}<i @click={globalThis.__ecVu = item}>{item}</i>{end}',
    '<button class="b" @click={$cb = -> globalThis.__ecAppels += 1}>x</button>',
  ],
}

function projetTemporaire(): string {
  const root   = mjsTmp('ecritures-reactives')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, lignes] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), lignes.join('\n'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('écritures réactives — chaque forme fait ce que la ligne écrite dit, dans un composant monté', function () {
  this.timeout(90000)

  let app: any
  const erreurs: string[] = []

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
    app.window.console.error = (...a: any[]) => { erreurs.push(a.map(String).join(' ').slice(0, 300)) }
    app.window.addEventListener('error', (ev: any) => erreurs.push('window.error ' + String(ev?.error?.message ?? ev?.message)))
  })

  after(async () => {
    if (app) await app.destroy()
  })

  async function avec(nom: string, f: (c: any) => Promise<void>) {
    erreurs.length = 0
    const c = await app.mount(nom)
    try { await f(c) }
    finally { c.destroy() }
  }

  it('une variable qui garde un objet de l\'état écrit dans CET objet, même après `$a = $b` ou un `unshift`', async () => {
    await avec('ec-alias', async (c) => {
      await c.click('.b1')
      assert.equal(c.text('.r'), 'b:true', '`ancien.on = false` ne doit pas éteindre le nouvel objet de `$a`')
      assert.equal(c.state.b.on, true)
      await c.click('.b2')
      assert.equal(c.text('.l'), 'z=false,x=true', '`p.fait = true` coche l\'élément tenu, pas celui qui l\'a remplacé au rang 0')
      assert.deepEqual(erreurs, [])
    })
  })

  it('`$$x++`, `++$$x`, `--$$x`, `$$o.n++` posés seuls sur leur ligne après une autre instruction', async () => {
    await avec('ec-asi', async (c) => {
      await c.click('.b')
      assert.deepEqual(erreurs, [], 'aucune erreur au clic')
      assert.equal(c.text('.n'), '1|1')
    })
  })

  it('une affectation d\'état utilisée comme condition vaut la valeur affectée', async () => {
    await avec('ec-ifset', async (c) => {
      await c.click('.b')
      assert.equal(c.text('.m'), 'non', '`if $res = chercher(k)` avec un résultat vide prend la branche « non »')
      assert.equal(c.state.res, undefined)
    })
  })

  it('une écriture du magasin utilisée comme valeur vaut la valeur écrite (`$a = $$b = 5`)', async () => {
    await avec('ec-chaine', async (c) => {
      await c.click('.b')
      assert.equal(c.text('.v'), '5|5|7|7')
    })
  })

  it('`$liste?.push(v)` et `$$liste?.push(v)` ne font rien sur une liste vide (`null`), et poussent sinon', async () => {
    await avec('ec-optchain', async (c) => {
      await c.click('.b')
      assert.deepEqual(erreurs, [], 'aucune erreur sur une liste `null`')
      assert.equal(c.text('.c'), '1|-|-', 'la suite du gestionnaire a tourné')
      await c.click('.r')
      await c.click('.p')
      assert.equal(c.text('.c'), '1|4|5', 'liste présente : la valeur est poussée et l\'écran suit')
    })
  })

  it('`$[cle()] += 1` et `$[cle()]++` évaluent la clé une seule fois', async () => {
    await avec('ec-dyn', async (c) => {
      await c.click('.g')
      assert.equal(c.text('.v'), '1|10', '`$[pick()] += 1` lit et écrit la même clé')
      assert.equal(app.window.__ecIdx, 1, '`pick()` appelé une seule fois')
      await c.click('.g2')
      assert.equal(c.text('.v'), '1|11')
      assert.equal(app.window.__ecIdx, 2)
    })
  })

  it('une valeur écrite entre parenthèses avec une virgule (`$x = (noter(), 2)`) écrit la dernière valeur', async () => {
    await avec('ec-paren', async (c) => {
      await c.click('.b')
      assert.equal(c.text('.v'), '2|3|4|5')
    })
  })

  it('`@click={$cb = -> …}` range la fonction sans l\'appeler, même compilé par groupes (nom du gabarit homonyme du script)', async () => {
    await avec('ec-groupe', async (c) => {
      await c.click('.b')
      assert.equal(typeof c.state.cb, 'function', 'la fonction est rangée')
      assert.equal(app.window.__ecAppels, 0, 'la fonction rangée n\'est pas appelée par le clic')
      c.find('i').click()
      await c.tick()
      assert.equal(app.window.__ecVu, 1, 'le gestionnaire de la boucle lit bien la variable du gabarit')
    })
  })
})
