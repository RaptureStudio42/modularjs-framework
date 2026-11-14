// Valeurs dérivées précises sur le graphe des signaux : chaque calcul note ce qu'il lit vraiment. Une source de la branche
// qui n'est pas prise ne fait plus refaire la valeur (suivi par branche) ; une valeur refaite à l'identique ne fait pas
// refaire celles qui la lisent (coupe-circuit). Les valeurs lues restent celles de la règle de l'horloge, pas à pas, sur
// quatre scènes : branche, losange, chaîne de 40 valeurs, boutique de 400 valeurs. Les recalculs sont comptés (appels de la
// fonction de chaque valeur), en production non minifiée : le contrôle de développement refait une valeur à part, il
// fausserait le compte ; la minification renomme les champs internes que le compte lit.
// happy-dom.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const BRANCHE = `<script lang="js">
$mode = true;
$a = [1, 2, 3];
$b = [4, 5, 6];
$z = 0;
$vue = $mode ? $a.map((x) => x * 2).join(',') : $b.map((x) => x * 3).join(',');
@mettreMode = function(v) { $mode = v; };
@mettreA = function(v) { $a = v; };
@mettreB = function(v) { $b = v; };
@autre = function() { $z += 1; };
</script>
<p>{$z}</p>
`

const LOSANGE = `<script lang="js">
$src = 1;
$z = 0;
$g = [$src > 0].join('');
$d = [$src > 0, 'x'].join('');
$bas = [$g, $d].join('|');
@mettreSrc = function(v) { $src = v; };
@autre = function() { $z += 1; };
</script>
<p>{$z}</p>
`

const CHAINE = `<script lang="js">
$base = 1;
$z = 0;
$c0 = [$base > 0].join('');
${Array.from({ length: 39 }, (_, i) => `$c${i + 1} = [$c${i}, ${i + 1}].join(':');`).join('\n')}
@mettreBase = function(v) { $base = v; };
@autre = function() { $z += 1; };
</script>
<p>{$z}</p>
`

const BOUTIQUE = `<script lang="js">
$items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => ({ id: i, nom: 'article ' + i }));
$search = '';
$cart = 0;
$trouves = $items.filter((a) => a.nom.includes($search));
$nb = [$trouves.length > 0].join('');
${Array.from({ length: 400 }, (_, i) => `$l${i} = [$nb, ${i}].join(':');`).join('\n')}
@chercher = function(q) { $search = q; };
@ajouter = function() { $cart += 1; };
</script>
<p>{$cart}</p>
`

const COMPOSANTS: Record<string, string> = { 'sg-branche': BRANCHE, 'sg-losange': LOSANGE, 'sg-chaine': CHAINE, 'sg-boutique': BOUTIQUE }
const CORPS = Object.keys(COMPOSANTS).map((n) => `<mjs-${n}></mjs-${n}>`).join('')

// joué dans la page : chaque pas écrit, puis relit les valeurs nommées ; rend, par pas, les valeurs lues et le nombre de
// recalculs de chaque valeur depuis le pas précédent
const SCENARIO = `(() => {
  const el = (n) => document.querySelector('mjs-' + n)
  const compte = {}
  for (const n of ${JSON.stringify(Object.keys(COMPOSANTS))}) {
    const e = el(n), cs = e._mjs_computeds
    compte[n] = {}
    for (const k of e._mjs_computedKeys) {
      const v = cs[k], f = v.f
      compte[n][k] = 0
      v.f = function() { compte[n][k]++; return f.apply(this, arguments) }
    }
  }
  const R = []
  const pas = (nom, n, ecrire, lire) => {
    const e = el(n)
    ecrire(e)
    for (const k in compte[n]) compte[n][k] = 0
    const valeurs = lire.map((k) => e._state[k])
    let recalculs = 0
    for (const k in compte[n]) recalculs += compte[n][k]
    R.push([nom, valeurs.join(' / '), recalculs])
  }
  const tout40 = Array.from({ length: 40 }, (_, i) => 'c' + i)
  const tout400 = ['nb', ...Array.from({ length: 400 }, (_, i) => 'l' + i)]
  pas('branche : départ', 'sg-branche', () => {}, ['vue'])
  pas('branche : source de la branche quittée', 'sg-branche', (e) => e.mettreB([7, 8]), ['vue'])
  pas('branche : écriture sans rapport', 'sg-branche', (e) => e.autre(), ['vue'])
  pas('branche : source de la branche prise', 'sg-branche', (e) => e.mettreA([1, 1]), ['vue'])
  pas('branche : bascule', 'sg-branche', (e) => e.mettreMode(false), ['vue'])
  pas('branche : ancienne branche', 'sg-branche', (e) => e.mettreA([5]), ['vue'])
  pas('branche : nouvelle branche', 'sg-branche', (e) => e.mettreB([2]), ['vue'])
  pas('losange : départ', 'sg-losange', () => {}, ['bas'])
  pas('losange : source changée, côtés identiques', 'sg-losange', (e) => e.mettreSrc(2), ['bas'])
  pas('losange : écriture sans rapport', 'sg-losange', (e) => e.autre(), ['bas'])
  pas('losange : source changée, côtés changés', 'sg-losange', (e) => e.mettreSrc(-1), ['bas'])
  pas('chaîne : départ', 'sg-chaine', () => {}, ['c39'])
  pas('chaîne : tête refaite à l\\'identique', 'sg-chaine', (e) => e.mettreBase(2), ['c39'])
  pas('chaîne : écriture sans rapport', 'sg-chaine', (e) => e.autre(), ['c39'])
  pas('chaîne : tête changée', 'sg-chaine', (e) => e.mettreBase(-1), ['c39'])
  pas('chaîne : toutes relues', 'sg-chaine', () => {}, tout40)
  pas('boutique : départ', 'sg-boutique', () => {}, tout400)
  pas('boutique : panier', 'sg-boutique', (e) => e.ajouter(), tout400)
  pas('boutique : recherche, trouvés changés, nb identique', 'sg-boutique', (e) => e.chercher('article 1'), tout400)
  pas('boutique : autre recherche, nb identique', 'sg-boutique', (e) => e.chercher('article 2'), tout400)
  pas('boutique : rien trouvé', 'sg-boutique', (e) => e.chercher('zzz'), tout400)
  return R
})()`

async function construire(mode: 'precise' | 'clock'): Promise<string> {
  const root   = mjsTmp('derive-graphe-' + mode)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, texte] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), texte)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: mode, urlPrefix: '/out', env: 'prod', js: 'bundle', minify: false } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
}

async function jouer(code: string): Promise<[string, string, number][]> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  try {
    window.eval(code)
    window.document.body.innerHTML = CORPS
    const fin = Date.now() + 5000
    while (Object.keys(COMPOSANTS).some((n) => !window.document.querySelector('mjs-' + n)?._mjs_computedKeys) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    return JSON.parse(JSON.stringify(window.eval(SCENARIO)))
  }
  finally {
    await window.happyDOM.close()
  }
}

// recalculs attendus sur le graphe, pas à pas (dans l'ordre du scénario)
const RECALCULS = [
  ['branche : départ', 1],
  ['branche : source de la branche quittée', 0],
  ['branche : écriture sans rapport', 0],
  ['branche : source de la branche prise', 1],
  ['branche : bascule', 1],
  ['branche : ancienne branche', 0],
  ['branche : nouvelle branche', 1],
  ['losange : départ', 3],
  ['losange : source changée, côtés identiques', 2],
  ['losange : écriture sans rapport', 0],
  ['losange : source changée, côtés changés', 3],
  ['chaîne : départ', 40],
  ['chaîne : tête refaite à l\'identique', 1],
  ['chaîne : écriture sans rapport', 0],
  ['chaîne : tête changée', 40],
  ['chaîne : toutes relues', 0],
  ['boutique : départ', 402],
  ['boutique : panier', 0],
  ['boutique : recherche, trouvés changés, nb identique', 2],
  ['boutique : autre recherche, nb identique', 2],
  ['boutique : rien trouvé', 402],
]

describe('valeurs dérivées précises sur le graphe : suivi par branche, coupe-circuit, valeurs de l\'horloge', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })
  let graphe: [string, string, number][]
  let horloge: [string, string, number][]
  before(async () => {
    graphe  = await jouer(await construire('precise'))
    horloge = await jouer(await construire('clock'))
  })

  it('les valeurs lues sont, pas à pas, celles de la règle de l\'horloge', () => {
    assert.deepEqual(graphe.map(([nom, v]) => [nom, v]), horloge.map(([nom, v]) => [nom, v]))
    assert.equal(graphe[1][1], '2,4,6')
    assert.equal(graphe[6][1], '6')
    assert.equal(graphe[10][1], 'false|falsex')
    assert.ok(graphe[14][1].startsWith('false:1:2:3'), graphe[14][1])
  })

  it('recalculs comptés : la branche quittée, le coupe-circuit sur un losange, une chaîne de 40 et une boutique de 400 valeurs', () => {
    assert.deepEqual(graphe.map(([nom, , n]) => [nom, n]), RECALCULS)
  })

  it('la règle de l\'horloge refait tout après chaque écriture du composant (repère des comptes)', () => {
    const n = Object.fromEntries(horloge.map(([nom, , c]) => [nom, c]))
    assert.equal(n['branche : source de la branche quittée'], 1)
    assert.equal(n['chaîne : tête refaite à l\'identique'], 40)
    assert.equal(n['boutique : panier'], 402)
  })
})
