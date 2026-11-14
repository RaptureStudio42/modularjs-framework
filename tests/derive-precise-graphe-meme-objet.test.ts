// Valeurs dérivées précises sur le graphe des signaux : une valeur précise qui rend un objet de l'état (`$sel = $l.find(…)`,
// `$alias = $o`, `$inner = $o.a`, `$meme = $l`) le rend de nouveau, LE MÊME, après une écriture faite en place dans cet objet
// (`$l[0].nom = …`, `$o.a.b = …`, `$l.push(…)`) : refaite, elle ne doit pas passer pour « refaite à l'identique », sinon les valeurs
// précises qui lisent son contenu (`$titre = [$sel.nom].join('')`, le total d'une commande) gardent leur ancien calcul. Les
// valeurs lues sont, pas à pas, celles de la règle de l'horloge, en production comme en développement, sans avertissement.
// happy-dom.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const S = (corps: string) => `<script lang="js">\n${corps}\n</script>\n<p>{$z}</p>\n`

const COMPOSANTS: Record<string, string> = {
  'mo-alias': S(`$o = { a: 1 };
$z = 0;
$alias = $o;
$txt = [$alias.a].join('');
@muter = function(v) { $o.a = v; };
@autre = function() { $z += 1; };`),
  'mo-selection': S(`$l = [{ id: 1, nom: 'a', on: true }, { id: 2, nom: 'b', on: false }];
$z = 0;
$sel = $l.find((x) => x.on);
$titre = [$sel.nom].join('');
@renommer = function(v) { $l[0].nom = v; };
@basculer = function() { $l[0].on = false; $l[1].on = true; };
@autre = function() { $z += 1; };`),
  'mo-profond': S(`$o = { a: { b: 0 } };
$z = 0;
$inner = $o.a;
$txt = [$inner.b].join('');
@muter = function(v) { $o.a.b = v; };
@autre = function() { $z += 1; };`),
  'mo-push': S(`$l = [1, 2];
$z = 0;
$meme = $l;
$n = [$meme.length].join('');
@pousser = function(v) { $l.push(v); };
@autre = function() { $z += 1; };`),
  'mo-commande': S(`$commandes = [{ id: 7, lignes: [{ qte: 1, prix: 10 }, { qte: 2, prix: 5 }] }];
$id = 7;
$z = 0;
$commande = $commandes.find((c) => c.id === $id);
$total = $commande.lignes.reduce((s, l) => s + l.qte * l.prix, 0);
@plus = function() { $commandes[0].lignes[0].qte += 1; };
@ajouter = function() { $commandes[0].lignes.push({ qte: 1, prix: 100 }); };
@autre = function() { $z += 1; };`),
}

// joué dans la page : chaque pas écrit, puis relit les valeurs nommées
const SCENARIO = `(() => {
  const el = (n) => document.querySelector('mjs-' + n)
  const R = []
  const pas = (nom, n, ecrire, lire) => {
    const e = el(n)
    ecrire(e)
    R.push([nom, lire.map((k) => JSON.stringify(e._state[k])).join(' / ')])
  }
  pas('alias : départ', 'mo-alias', () => {}, ['txt'])
  pas('alias : $o.a = 2', 'mo-alias', (e) => e.muter(2), ['txt'])
  pas('alias : écriture sans rapport', 'mo-alias', (e) => e.autre(), ['txt'])
  pas('sélection : départ', 'mo-selection', () => {}, ['titre'])
  pas('sélection : $l[0].nom = zz', 'mo-selection', (e) => e.renommer('zz'), ['titre'])
  pas('sélection : bascule', 'mo-selection', (e) => e.basculer(), ['titre'])
  pas('profond : départ', 'mo-profond', () => {}, ['txt'])
  pas('profond : $o.a.b = 1', 'mo-profond', (e) => e.muter(1), ['txt'])
  pas('push : départ', 'mo-push', () => {}, ['n'])
  pas('push : $l.push(3)', 'mo-push', (e) => e.pousser(3), ['n'])
  pas('commande : départ', 'mo-commande', () => {}, ['total'])
  pas('commande : une quantité de plus', 'mo-commande', (e) => e.plus(), ['total'])
  pas('commande : une ligne de plus', 'mo-commande', (e) => e.ajouter(), ['total'])
  pas('commande : écriture sans rapport', 'mo-commande', (e) => e.autre(), ['total'])
  return R
})()`

const ATTENDU = [
  ['alias : départ', '"1"'],
  ['alias : $o.a = 2', '"2"'],
  ['alias : écriture sans rapport', '"2"'],
  ['sélection : départ', '"a"'],
  ['sélection : $l[0].nom = zz', '"zz"'],
  ['sélection : bascule', '"b"'],
  ['profond : départ', '"0"'],
  ['profond : $o.a.b = 1', '"1"'],
  ['push : départ', '"2"'],
  ['push : $l.push(3)', '"3"'],
  ['commande : départ', '20'],
  ['commande : une quantité de plus', '30'],
  ['commande : une ligne de plus', '130'],
  ['commande : écriture sans rapport', '130'],
]

async function jouer(mode: 'precise' | 'clock', env: 'prod' | 'dev'): Promise<{ R: [string, string][]; avertis: string[]; precises: number }> {
  const root   = mjsTmp('derive-meme-objet-' + mode + '-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, texte] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), texte)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: mode, urlPrefix: '/out', env, js: 'bundle', minify: false } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const code = readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  const avertis: string[] = []
  window.console.warn = (...a: any[]) => avertis.push(a.map(String).join(' '))
  try {
    window.eval(code)
    window.document.body.innerHTML = Object.keys(COMPOSANTS).map((n) => `<mjs-${n}></mjs-${n}>`).join('')
    const fin = Date.now() + 5000
    while (Object.keys(COMPOSANTS).some((n) => !window.document.querySelector('mjs-' + n)?._mjs_computedKeys) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    const R = JSON.parse(JSON.stringify(window.eval(SCENARIO)))
    // valeurs précises sur le graphe : celles que le scénario met à l'épreuve
    let precises = 0
    for (const n of Object.keys(COMPOSANTS)) {
      const e = window.document.querySelector('mjs-' + n)
      for (const k of e._mjs_computedKeys) if (e._mjs_computeds[k]._mjs_src && e._mjs_computeds[k]._mjs_n) precises++
    }
    return { R, avertis, precises }
  }
  finally {
    await window.happyDOM.close()
  }
}

describe('valeurs dérivées précises sur le graphe : une valeur qui rend le même objet, changé en place, fait refaire celles qui la lisent', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  it('production : valeurs de la règle de l\'horloge, pas à pas', async () => {
    const graphe  = await jouer('precise', 'prod')
    const horloge = await jouer('clock', 'prod')
    assert.equal(graphe.precises, 10, 'les dix valeurs dérivées sont précises, sur le graphe')
    assert.deepEqual(horloge.R, ATTENDU)
    assert.deepEqual(graphe.R, ATTENDU)
  })

  it('développement : mêmes valeurs, et aucun avertissement « changé hors de MJS » pour une écriture que MJS a vue', async () => {
    const graphe = await jouer('precise', 'dev')
    assert.deepEqual(graphe.R, ATTENDU)
    assert.deepEqual(graphe.avertis.filter((a) => a.includes('a servi son dernier calcul')), [])
  })
})
