// Les reffets sur le graphe des signaux : un reffet repart quand une source qu'il a VRAIMENT lue à son dernier passage a
// changé. Il ne repart plus pour une variable de la branche qu'il n'a pas prise, ni pour une valeur dérivée refaite à
// l'identique (losange) ; il repart pour une variable qu'il lit par une fonction que le relevé de la construction ne voit
// pas (fonction rangée dans un objet). Inchangé : `µrefresh($x)` ne relance aucun reffet, pas même par une
// valeur dérivée ; des écritures groupées dans une boucle font un seul passage ; une clé du magasin lue par deux
// composants relance le reffet de chacun, une fois ; un reffet au premier niveau d'un module, ou du `<script module>` d'un composant,
// appartient au module. Une variable lue après coup (après un
// `await`, dans une promesse, dans une méthode async) relance le reffet comme avant ; le gestionnaire du parent qui reçoit un
// `µemit` lit pour le parent : il ne relance pas le reffet de l'enfant (sinon, un gestionnaire qui cumule le relançait sans fin) ; un
// gestionnaire du composant lui-même, déclenché pendant le passage (clic), lit pour lui seul ; une valeur dérivée d'un autre composant lue
// pendant le passage ne relance pas le reffet. Clés du magasin sur le graphe : une clé de la branche quittée ne relance plus, une clé lue
// par une fonction rangée dans un objet relance ; une clé que le reffet borne (`$$x!`) ne repart que sur une écriture faite hors de tout
// reffet ; une clé qu'il cumule n'est pas une dépendance. Comme avant le graphe : une clé lue par le reffet et écrite pendant son passage
// par un code que le compilateur ne voit pas (aide d'un module, méthode d'un enfant) le relance ; une clé supprimée puis reposée le
// relance ; un écouteur `µon` du composant, déclenché pendant le passage, lit pour lui seul ; une variable ou une clé lue dans une branche non prise puis après un `await` le relance ; un composant qui importe un module
// et porte un reffet dans son `<script module>` se construit, se rend côté serveur, et son reffet passe une fois.
// Les passages sont comptés pas à pas, en production non minifiée, avec les valeurs dérivées précises puis à l'horloge.
// happy-dom.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { renderToString } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'sg3-branche': `<script lang="js">
$mode = true;
$a = 1;
$b = 1;
$z = 0;
µeffect(() => { window.__n.branche++; window.__v.branche = $mode ? $a : $b; });
µeffect.before(() => { window.__n.avant++; window.__v.avant = $mode ? $a : $b; });
@mettreA = function(v) { $a = v; };
@mettreB = function(v) { $b = v; };
@mettreMode = function(v) { $mode = v; };
@autre = function() { $z += 1; };
</script>
<p>{$z}</p>
`,
  'sg3-losange': `<script lang="js">
$src = 1;
$z = 0;
$g = [$src > 0].join('');
$d = [$src > 0, 'x'].join('');
$bas = [$g, $d].join('|');
µeffect(() => { window.__n.losange++; window.__v.losange = $bas; });
@mettreSrc = function(v) { $src = v; };
@autre = function() { $z += 1; };
</script>
<p>{$z}</p>
`,
  'sg3-fonction': `<script lang="js">
$x = 1;
$y = 1;
$z = 0;
const outils = { lire: () => $x };
µeffect(() => { window.__n.fonction++; window.__v.fonction = $y + outils.lire(); });
@mettreX = function(v) { $x = v; };
@autre = function() { $z += 1; };
</script>
<p>{$z}</p>
`,
  'sg3-boucle': `<script lang="js">
$n = 0;
µeffect(() => { window.__n.boucle++; window.__v.boucle = $n; });
@remplir = function() { for (let i = 1; i <= 100; i++) $n = i; };
</script>
<p>{$n}</p>
`,
  'sg3-rafraichir': `<script lang="js">
$obj = { v: 1 };
$double = $obj.v * 2;
µeffect(() => { window.__n.objet++; window.__v.objet = $obj.v; });
µeffect(() => { window.__n.double++; window.__v.double = $double; });
@changerSurPlace = function() { $obj.v = 5; };
@rafraichir = function() { µrefresh($obj); };
@memeValeur = function() { µrefresh($obj); };
</script>
<p>{$double}</p>
`,
  'sg3-magasin-a': `<script module lang="js">
µeffect(() => { window.__n.scriptModule++; window.__v.scriptModule = $$compte; });
</script>
<script lang="js">
µeffect(() => { window.__n.magA++; window.__v.magA = $$compte; });
@ecrire = function() { $$compte = ($$compte || 0) + 1; };
@autre = function() { $$autre = ($$autre || 0) + 1; };
</script>
<p>a</p>
`,
  'sg3-attente': `<script lang="js">
$id = 1;
$filtre = 1;
$res = 0;
async function charger() { await null; $res = $id * 100 + $filtre; }
µeffect(async () => { window.__n.attente++; const id = await Promise.resolve($id); window.__v.attente = id * 10 + $filtre; });
µeffect(() => { window.__n.promesse++; const id = $id; Promise.resolve().then(() => { window.__v.promesse = id * 10 + $filtre; }); });
µeffect(() => { window.__n.aide++; window.__v.aide = $id; charger(); });
@mettreFiltre = function(v) { $filtre = v; };
@lireRes = function() { return $res; };
</script>
<p>{$res}</p>
`,
  'sg3-methode': `<script lang="js">
$id = 1;
$x = 1;
@planifier = function() { µafter(0, () => { window.__v.methode = $id * 10 + $x; }); };
µeffect(() => { window.__n.methode++; window.__v.methodeId = $id; this.planifier(); });
@mettreX = function(v) { $x = v; };
</script>
<p>{$id}</p>
`,
  'sg3-deux': `<script lang="js">
$o = { v: 1 };
µeffect(() => { window.__n.deuxA++; window.__v.deuxA = $o.v; });
µeffect(() => { window.__n.deuxB++; window.__v.deuxB = $o.v * 2; });
@rafraichir = function() { $o.v = 7; µrefresh($o); };
@memeValeur = function() { µrefresh($o); };
</script>
<p>{$o.v}</p>
`,
  'sg3-emetteur': `<script lang="js">
$n = 0;
µeffect(() => { window.__n.emet++; µemit('signal', $n); });
@pousser = function() { $n += 1; };
</script>
<p>{$n}</p>
`,
  'sg3-recepteur': `<script lang="js">
$total = 0;
$mode = 1;
const cumuler = (e) => { window.__v.mode = $mode; $total = $total + 1; };
µeffect(() => { window.__n.recep++; window.__v.total = $total; });
@changerMode = function(v) { $mode = v; };
</script>
<p>{$total}</p>
<@sg3-emetteur @signal={cumuler}>
`,
  'sg3-magasin-b': `<script lang="js">
@import journal 'sg3-journal.module.civet.mjs'
µeffect(() => { window.__n.magB++; window.__v.magB = $$compte; });
</script>
<p>{journal.nom}</p>
`,
  'sg3-soi': `<script lang="js">
$total = 0;
$n = 0;
const cumuler = () => { $total = $total + 1; };
µeffect(() => { window.__n.soi++; window.__v.soiN = $n; this._shadow.querySelector('button').click(); });
@pousser = function() { $n += 1; };
@lireTotal = function() { return $total; };
</script>
<button @click={cumuler}>{$total}</button>
`,
  'sg3-derive-source': `<script lang="js">
$src = 1;
$double = [$src * 2].join('') * 1;
@lireDouble = function() { return $double; };
@mettreSrc = function(v) { $src = v; };
</script>
<p>{$double}</p>
`,
  'sg3-derive-lecteur': `<script lang="js">
$k = 1;
µeffect(() => { window.__n.lecteur++; const q = document.querySelector('mjs-sg3-derive-source'); window.__v.lecteur = $k + (q && q.lireDouble ? q.lireDouble() : 100); });
</script>
<p>{$k}</p>
`,
  'sg3-mag-branche': `<script lang="js">
$mode = true;
µeffect(() => { window.__n.magBranche++; window.__v.magBranche = $mode ? $$ma : $$mb; });
@ecrireMa = function(v) { $$ma = v; };
@ecrireMb = function(v) { $$mb = v; };
</script>
<p>b</p>
`,
  'sg3-mag-objet': `<script lang="js">
$y = 1;
const outils = { lire: () => $$mc };
µeffect(() => { window.__n.magObjet++; window.__v.magObjet = $y + (outils.lire() || 0); });
@ecrireMc = function(v) { $$mc = v; };
</script>
<p>o</p>
`,
  'sg3-mag-borne': `<script lang="js">
$max = 10;
µeffect(() => { window.__n.magBorne++; if (($$mv || 0) > $max) $$mv = $max; window.__v.magBorne = $$mv; });
@ecrireMv = function(v) { $$mv = v; };
</script>
<p>v</p>
`,
  'sg3-mag-cumul': `<script lang="js">
µeffect(() => { window.__n.magCumul++; if ($$go) $$cpt = ($$cpt || 0) + 1; window.__v.magCumul = $$cpt; });
@ecrireGo = function(v) { $$go = v; };
@ecrireCpt = function(v) { $$cpt = v; };
</script>
<p>c</p>
`,
  'sg3-soi-on': `<script lang="js">
$total = 0;
$n = 0;
µon('click', '.b', () => { $total = $total + 1; });
µeffect(() => { window.__n.soiOn++; window.__v.soiOnN = $n; this._shadow.querySelector('.b').click(); });
@pousser = function() { $n += 1; };
@lireTotal = function() { return $total; };
</script>
<button class="b">{$total}</button>
`,
  'sg3-module-import': `<script module lang="js">
µeffect(() => { window.__n.moduleImport++; window.__v.moduleImport = $$compte; });
</script>
<script lang="js">
@import journal 'sg3-journal.module.civet.mjs'
</script>
<p>{journal.nom}</p>
`,
  'sg3-mag-aide': `<script lang="js">
@import ajuster 'sg3-aide.module.civet.mjs'
$a = 0;
µeffect(() => { window.__n.magAide++; window.__v.magAide = $a + ':' + $$q; ajuster(); });
@poserQ = function(v) { $$q = v; };
</script>
<p>a</p>
`,
  'sg3-mag-enfant': `<script lang="js">
@borner = function() { if (($$cq || 0) > 10) $$cq = 10; };
</script>
<p>e</p>
`,
  'sg3-mag-parent': `<script lang="js">
$a = 0;
µeffect(() => { window.__n.magParent++; window.__v.magParent = $a + ':' + $$cq; const e = this._shadow.querySelector('mjs-sg3-mag-enfant'); if (e && e.borner) e.borner(); });
@poserCq = function(v) { $$cq = v; };
</script>
<@sg3-mag-enfant></@sg3-mag-enfant>
`,
  'sg3-mag-mixte': `<script lang="js">
$mode = false;
µeffect(async () => { window.__n.magMixte++; if ($mode) window.__v.m1 = $$mk; await null; window.__v.magMixte = $$mk; });
@ecrireMk = function(v) { $$mk = v; };
</script>
<p>m</p>
`,
  'sg3-mixte': `<script lang="js">
$mode = false;
$kk = 0;
µeffect(async () => { window.__n.mixte++; if ($mode) window.__v.k1 = $kk; await null; window.__v.mixte = $kk; });
@ecrireKk = function(v) { $kk = v; };
</script>
<p>l</p>
`,
  'sg3-mag-supprime': `<script lang="js">
$a = 0;
µeffect(() => { window.__n.magSupprime++; window.__v.magSupprime = $a + ':' + ($$dx === undefined ? 'vide' : $$dx); });
@supprimer = function() { delete $$dx; };
@poser = function(v) { $$dx = v; };
</script>
<p>s</p>
`,
}

// un reffet au premier niveau d'un module (sans magasin déclaré) : son propriétaire est le module
const MODULES: Record<string, string> = {
  'sg3-journal.module.civet.mjs': [
    'export journal = { nom: \'journal\' }',
    '',
    'µeffect ->',
    '  window.__n.module++',
    '  window.__v.module = $$compte',
    '',
  ].join('\n'),
  // une aide qui borne une clé du magasin : appelée par un reffet, elle écrit pendant son passage une clé qu'il lit
  'sg3-aide.module.civet.mjs': 'export ajuster = ->\n  $$q = 0 if $$q < 0\n',
}

// posés dans la page ; l'émetteur vit dans le récepteur
const PAGE  = Object.keys(COMPOSANTS).filter((n) => n !== 'sg3-emetteur' && n !== 'sg3-mag-enfant')
const CORPS = PAGE.map((n) => `<mjs-${n}></mjs-${n}>`).join('')

// joué dans la page, pas à pas : une écriture, puis les passages de chaque reffet depuis le pas précédent
const SCENARIO = `(async () => {
  const el = (n) => document.querySelector('mjs-' + n)
  const attendre = () => new Promise((r) => setTimeout(r, 0))
  const R = []
  const pas = async (nom, ecrire) => {
    for (const k in window.__n) window.__n[k] = 0
    ecrire()
    await attendre()
    await attendre()
    const vus = {}
    for (const k in window.__n) if (window.__n[k] !== 0) vus[k] = window.__n[k]
    R.push([nom, vus])
  }
  await pas('branche : source de la branche quittée', () => el('sg3-branche').mettreB(2))
  await pas('branche : source de la branche prise', () => el('sg3-branche').mettreA(3))
  await pas('branche : bascule', () => el('sg3-branche').mettreMode(false))
  await pas('branche : ancienne branche', () => el('sg3-branche').mettreA(4))
  await pas('branche : nouvelle branche', () => el('sg3-branche').mettreB(5))
  await pas('branche : écriture sans rapport', () => el('sg3-branche').autre())
  await pas('losange : source changée, côtés identiques', () => el('sg3-losange').mettreSrc(2))
  await pas('losange : source changée, côtés changés', () => el('sg3-losange').mettreSrc(-1))
  await pas('losange : écriture sans rapport', () => el('sg3-losange').autre())
  await pas('fonction rangée dans un objet : sa variable', () => el('sg3-fonction').mettreX(2))
  await pas('fonction rangée dans un objet : écriture sans rapport', () => el('sg3-fonction').autre())
  await pas('boucle de 100 écritures', () => el('sg3-boucle').remplir())
  await pas('µrefresh', () => el('sg3-rafraichir').rafraichir())
  await pas('µrefresh($x)', () => el('sg3-rafraichir').memeValeur())
  await pas('écriture sur place', () => el('sg3-rafraichir').changerSurPlace())
  await pas('magasin : clé lue par deux composants et un module', () => el('sg3-magasin-a').ecrire())
  await pas('magasin : clé sans lecteur', () => el('sg3-magasin-a').autre())
  await pas('après coup : variable lue après un await, dans une promesse, dans une méthode async', () => el('sg3-attente').mettreFiltre(2))
  await pas('après coup : variable lue dans la minuterie d’une méthode', () => el('sg3-methode').mettreX(2))
  await pas('deux reffets lisent la variable : µrefresh', () => el('sg3-deux').rafraichir())
  await pas('deux reffets lisent la variable : µrefresh($x)', () => el('sg3-deux').memeValeur())
  await pas('émission : écriture de l’enfant, gestionnaire du parent qui cumule', () => el('sg3-recepteur')._shadow.querySelector('mjs-sg3-emetteur').pousser())
  await pas('émission : variable du parent lue par son gestionnaire seulement', () => el('sg3-recepteur').changerMode(2))
  await pas('gestionnaire du composant déclenché par son reffet, qui cumule', () => el('sg3-soi').pousser())
  await pas('écouteur µon du composant déclenché par son reffet, qui cumule', () => el('sg3-soi-on').pousser())
  await pas('valeur dérivée d’un autre composant lue par un reffet', () => el('sg3-derive-source').mettreSrc(2))
  await pas('magasin : clé de la branche quittée', () => el('sg3-mag-branche').ecrireMb(2))
  await pas('magasin : clé de la branche prise', () => el('sg3-mag-branche').ecrireMa(3))
  await pas('magasin : clé lue par une fonction rangée dans un objet', () => el('sg3-mag-objet').ecrireMc(5))
  await pas('magasin : clé bornée par le reffet, écrite hors reffet', () => el('sg3-mag-borne').ecrireMv(50))
  await pas('magasin : clé cumulée, sa condition', () => el('sg3-mag-cumul').ecrireGo(true))
  await pas('magasin : clé cumulée, écrite hors reffet', () => el('sg3-mag-cumul').ecrireCpt(10))
  await pas('magasin : clé lue, écrite pendant le passage par l’aide d’un module', () => el('sg3-mag-aide').poserQ(-5))
  await pas('magasin : clé lue, écrite hors reffet après l’écriture de l’aide', () => el('sg3-mag-aide').poserQ(7))
  await pas('magasin : clé lue, écrite pendant le passage par la méthode d’un enfant', () => el('sg3-mag-parent').poserCq(50))
  await pas('magasin : clé lue, écrite hors reffet après l’écriture de l’enfant', () => el('sg3-mag-parent').poserCq(5))
  await pas('magasin : clé lue dans une branche non prise puis après un await', () => el('sg3-mag-mixte').ecrireMk(1))
  await pas('après coup : variable lue dans une branche non prise puis après un await', () => el('sg3-mixte').ecrireKk(1))
  await pas('magasin : clé posée', () => el('sg3-mag-supprime').poser(3))
  await pas('magasin : clé supprimée', () => el('sg3-mag-supprime').supprimer())
  await pas('magasin : clé reposée après sa suppression', () => el('sg3-mag-supprime').poser(4))
  window.__v.soiTotal = el('sg3-soi').lireTotal()
  window.__v.soiOnTotal = el('sg3-soi-on').lireTotal()
  window.__v.res = el('sg3-attente').lireRes()
  return { pas: R, valeurs: window.__v }
})()`

async function construire(mode: 'precise' | 'clock'): Promise<string> {
  const root   = mjsTmp('reffets-graphe-' + mode)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, texte] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), texte)
  for (const [nom, texte] of Object.entries(MODULES)) writeFileSync(join(srcDir, nom), texte)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: mode, urlPrefix: '/out', env: 'prod', js: 'bundle', minify: false } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
}

type Jeu = { montage: Record<string, number>, pas: [string, Record<string, number>][], valeurs: Record<string, unknown>, avertissements: string[] }

async function jouer(code: string): Promise<Jeu> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  const avertissements: string[] = []
  window.console.warn = (...a: unknown[]) => { avertissements.push(a.map(String).join(' ')) }
  try {
    window.__n = { branche: 0, avant: 0, losange: 0, fonction: 0, boucle: 0, objet: 0, double: 0, magA: 0, magB: 0, module: 0, attente: 0, promesse: 0, aide: 0, methode: 0, deuxA: 0, deuxB: 0, emet: 0, recep: 0, scriptModule: 0, soi: 0, lecteur: 0, magBranche: 0, magObjet: 0, magBorne: 0, magCumul: 0, soiOn: 0, moduleImport: 0, magAide: 0, magParent: 0, magMixte: 0, mixte: 0, magSupprime: 0 }
    window.__v = {}
    window.eval(code)
    window.document.body.innerHTML = CORPS
    const fin = Date.now() + 5000
    while (PAGE.some((n) => !window.document.querySelector('mjs-' + n)?._mjs_is_mounted) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 20))
    const montage = { ...window.__n }
    const r = await window.eval(SCENARIO)
    return JSON.parse(JSON.stringify({ montage, pas: r.pas, valeurs: r.valeurs, avertissements }))
  }
  finally {
    await window.happyDOM.close()
  }
}

// passages attendus, pas à pas, valeurs dérivées précises
const PASSAGES: [string, Record<string, number>][] = [
  ['branche : source de la branche quittée', {}],
  ['branche : source de la branche prise', { branche: 1, avant: 1 }],
  ['branche : bascule', { branche: 1, avant: 1 }],
  ['branche : ancienne branche', {}],
  ['branche : nouvelle branche', { branche: 1, avant: 1 }],
  ['branche : écriture sans rapport', {}],
  ['losange : source changée, côtés identiques', {}],
  ['losange : source changée, côtés changés', { losange: 1 }],
  ['losange : écriture sans rapport', {}],
  ['fonction rangée dans un objet : sa variable', { fonction: 1 }],
  ['fonction rangée dans un objet : écriture sans rapport', {}],
  ['boucle de 100 écritures', { boucle: 1 }],
  ['µrefresh', {}],
  ['µrefresh($x)', {}],
  ['écriture sur place', { objet: 1, double: 1 }],
  ['magasin : clé lue par deux composants et un module', { magA: 1, magB: 1, module: 1, scriptModule: 1, moduleImport: 1 }],
  ['magasin : clé sans lecteur', {}],
  ['après coup : variable lue après un await, dans une promesse, dans une méthode async', { attente: 1, promesse: 1, aide: 1 }],
  ['après coup : variable lue dans la minuterie d’une méthode', { methode: 1 }],
  ['deux reffets lisent la variable : µrefresh', { deuxA: 1, deuxB: 1 }],
  ['deux reffets lisent la variable : µrefresh($x)', {}],
  ['émission : écriture de l’enfant, gestionnaire du parent qui cumule', { emet: 1, recep: 1 }],
  ['émission : variable du parent lue par son gestionnaire seulement', {}],
  ['gestionnaire du composant déclenché par son reffet, qui cumule', { soi: 1 }],
  ['écouteur µon du composant déclenché par son reffet, qui cumule', { soiOn: 1 }],
  ['valeur dérivée d’un autre composant lue par un reffet', {}],
  ['magasin : clé de la branche quittée', {}],
  ['magasin : clé de la branche prise', { magBranche: 1 }],
  ['magasin : clé lue par une fonction rangée dans un objet', { magObjet: 1 }],
  ['magasin : clé bornée par le reffet, écrite hors reffet', { magBorne: 1 }],
  ['magasin : clé cumulée, sa condition', { magCumul: 1 }],
  ['magasin : clé cumulée, écrite hors reffet', {}],
  ['magasin : clé lue, écrite pendant le passage par l’aide d’un module', { magAide: 2 }],
  ['magasin : clé lue, écrite hors reffet après l’écriture de l’aide', { magAide: 1 }],
  ['magasin : clé lue, écrite pendant le passage par la méthode d’un enfant', { magParent: 2 }],
  ['magasin : clé lue, écrite hors reffet après l’écriture de l’enfant', { magParent: 1 }],
  ['magasin : clé lue dans une branche non prise puis après un await', { magMixte: 1 }],
  ['après coup : variable lue dans une branche non prise puis après un await', { mixte: 1 }],
  ['magasin : clé posée', { magSupprime: 1 }],
  ['magasin : clé supprimée', { magSupprime: 1 }],
  ['magasin : clé reposée après sa suppression', { magSupprime: 1 }],
]

describe('reffets sur le graphe des signaux : ils suivent ce qu\'ils lisent vraiment', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })
  let precis: Jeu
  let horloge: Jeu
  before(async () => {
    precis  = await jouer(await construire('precise'))
    horloge = await jouer(await construire('clock'))
  })

  it('au montage, chaque reffet passe une fois, celui du module compris', () => {
    assert.deepEqual(precis.montage, { branche: 1, avant: 1, losange: 1, fonction: 1, boucle: 1, objet: 1, double: 1, magA: 1, magB: 1, module: 1, attente: 1, promesse: 1, aide: 1, methode: 1, deuxA: 1, deuxB: 1, emet: 1, recep: 1, scriptModule: 1, soi: 1, lecteur: 1, magBranche: 1, magObjet: 1, magBorne: 1, magCumul: 1, soiOn: 1, moduleImport: 1, magAide: 1, magParent: 1, magMixte: 1, mixte: 1, magSupprime: 1 })
    assert.deepEqual(horloge.montage, precis.montage)
  })

  it('passages comptés pas à pas : branche quittée, losange, fonction cachée, boucle, µrefresh, magasin, gestionnaires, dérivée d\'un autre composant', () => {
    assert.deepEqual(precis.pas, PASSAGES)
  })

  it('valeurs lues par les reffets à la fin du scénario', () => {
    assert.deepEqual(precis.valeurs, { branche: 5, avant: 5, losange: 'false|falsex', fonction: 3, boucle: 100, objet: 5, double: 10, magA: 1, magB: 1, module: 1, attente: 12, promesse: 12, aide: 1, res: 102, methodeId: 1, methode: 12, deuxA: 7, deuxB: 14, mode: 1, total: 2, soiN: 1, soiTotal: 2, lecteur: 3, magBranche: 3, magObjet: 6, magBorne: 10, magCumul: 1, scriptModule: 1, soiOnN: 1, soiOnTotal: 2, moduleImport: 1, magAide: '0:7', magParent: '0:5', magMixte: 1, mixte: 1, magSupprime: '0:4' })
    assert.deepEqual(horloge.valeurs, precis.valeurs)
  })

  it('à l\'horloge, un reffet qui lit une valeur dérivée repart avec ses racines (pas de coupe-circuit), le reste à l\'identique', () => {
    const attendu = PASSAGES.map(([nom, vus]): [string, Record<string, number>] => [nom, nom === 'losange : source changée, côtés identiques' ? { losange: 1 } : vus])
    assert.deepEqual(horloge.pas, attendu)
  })

  it('aucun avertissement : le reffet du module et celui du <script module> ont un propriétaire', () => {
    assert.deepEqual(precis.avertissements.filter((a) => /µeffect/.test(a)), [])
  })
})

// rendu serveur : un composant qui importe un module et porte un reffet au premier niveau de son `<script module>` se rend sans erreur ; le
// reffet du module tourne côté serveur, comme celui d'un module .civet (il écrit une clé que le rendu affiche)
describe('<script module> à reffet, composant qui importe un module : rendu serveur', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })
  it('aucune erreur, le reffet du module a tourné', async () => {
    const src = mjsTmp('reffets-graphe-ssr-module')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'j.module.civet.mjs'), "export journal = { nom: 'j' }\n")
    writeFileSync(join(src, 'carte.mjs'), `<script module lang="js">
µeffect(() => { $$vu = 'module'; });
</script>
<script lang="js">
@import journal 'j.module.civet.mjs'
$n = 7;
</script>
<p class="r">{journal.nom} {$n} {$$vu}</p>
`)
    writeFileSync(join(src, 'page.mjs'), '<@carte></@carte>\n')
    const res = await renderToString({ sourceDir: src, tag: 'mjs-page' })
    assert.match(res.html, /<p class="r">j 7 module<\/p>/)
  })
})
