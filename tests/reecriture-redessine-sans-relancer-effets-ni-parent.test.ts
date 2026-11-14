// `µrefresh($x)` écrit par le code du composant (gestionnaire, `µeffect`, `µeffect.before`, suite d'un `await`) redessine ce qui affiche
// `$x` et les variables qui tiennent le même objet, et refait les valeurs calculées qui le lisent ; il ne relance aucun `µeffect`
// ni `µeffect.before` et ne prévient pas le parent lié, comme en 3.1.0 où cette réécriture ne fait rien : ni boucle, ni écriture
// réelle perdue, les passages des effets égaux à ceux de la 3.1.0. Développement et production ; happy-dom, Chromium, Firefox, WebKit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  // l'effet lit `$x.length` puis écrit `µrefresh($x)` ; l'autre écrit `µrefresh($m)` sur un nombre
  'reec-lit-ecrit.mjs': `<script>
$x = [1, 2]
$m = 0
µeffect ->
  window.__eff = (window.__eff or 0) + 1
  window.__effLen = $x.length
  µrefresh($x)
µeffect ->
  window.__effm = (window.__effm or 0) + 1
  window.__effmv = $m
  µrefresh($m)
@brut = -> µread($x).push(3)
@pousse = -> $x.push(4)
@incm = -> $m += 1
@reaff = -> µrefresh($x)
</script>
<p class="f">{$x.length + '|' + $m}</p>
`,
  // deux effets dont la seule lecture de `$y` suit `µrefresh($y)` : la valeur que rendait `$y = $y`, dernière ligne de l'effet
  'reec-ecrit-seul.mjs': `<script>
$y = [1, 2]
$k = 0
µeffect ->
  window.__e2 = (window.__e2 or 0) + 1
  µrefresh($y)
  $y
µeffect ->
  window.__e3 = (window.__e3 or 0) + 1
  window.__e3k = $k
  µrefresh($y)
  $y
@inck = -> $k += 1
@reaffy = -> µrefresh($y)
</script>
<p class="f">{$y.length + '|' + $k}</p>
`,
  // un effet écrit `µrefresh($z)`, un autre le lit seulement
  'reec-autre.mjs': `<script>
$z = [1, 2]
$t = 0
µeffect ->
  window.__ecr = (window.__ecr or 0) + 1
  window.__ecrT = $t
  µrefresh($z)
µeffect ->
  window.__lec = (window.__lec or 0) + 1
  window.__lecLen = $z.length
@inct = -> $t += 1
@brutz = -> µread($z).push(9)
@reaffz = -> µrefresh($z)
</script>
<p class="f">{$z.length + '|' + $t}</p>
<p class="g">{$z.length}</p>
`,
  // le reffet d'avant l'écran écrit `µrefresh($w)`
  'reec-avant.mjs': `<script>
$w = [1]
$n = 0
µeffect.before ->
  window.__av = (window.__av or 0) + 1
  window.__avLen = $w.length
  µrefresh($w)
µeffect ->
  window.__ap = (window.__ap or 0) + 1
  window.__apLen = $w.length
@incn = -> $n += 1
@brutw = -> µread($w).push(7)
@reaffw = -> µrefresh($w)
</script>
<p class="f">{$w.length + '|' + $n}</p>
`,
  // l'effet de l'enfant lié écrit `µrefresh($x)`, puis lit `$x` (la valeur que rendait `$x = $x`)
  'reec-parent.mjs': `<script>
$x = [1, 2]
</script>
<p class="p">{$x.length}</p>
<mjs-reec-enfant x=!{$x}></mjs-reec-enfant>
`,
  'reec-enfant.mjs': `<script>
$x = []
$k = 0
µeffect ->
  window.__ce = (window.__ce or 0) + 1
  window.__ceK = $k
  µrefresh($x)
  $x
@brut = -> µread($x).push(5)
@inck = -> $k += 1
</script>
<p class="c">{$x.length}</p>
`,
  // cas d'origine : un objet changé hors de MJS, puis `µrefresh($w)` dans un gestionnaire ; `$v` tient le même objet, `$d` le lit
  'reec-origine.mjs': `<script>
$w = {n: 1}
$v = {n: 0}
$n = 0
$d = $w.n * 10
µeffect.before ->
  window.__ov = (window.__ov or 0) + 1
  window.__ovN = $w.n
  µrefresh($w)
µeffect ->
  window.__oe = (window.__oe or 0) + 1
  window.__oeN = $w.n
@choisir = (o) ->
  $w = o
  $v = o
@incn = -> $n += 1
@reaffw = -> µrefresh($w)
</script>
<p class="f">{$w.n + '|' + $n + '|' + $d}</p>
<p class="v">{$v.n}</p>
`,
  // un reffet d'avant réécrit `$x` avant la passe d'un effet qui l'écrit lui-même : les vraies écritures restent vues, et lit `$x` après `µrefresh($x)` (la valeur que rendait `$x = $x`)
  'reec-perdu.mjs': `<script>
$x = [1, 2]
$k = 0
µeffect.before ->
  window.__hq = (window.__hq or 0) + 1
  window.__hqk = $k
  µrefresh($x)
  $x
µeffect ->
  window.__hb = (window.__hb or 0) + 1
  window.__hbL = $x.length
  µrefresh($x)
µeffect ->
  window.__hr = (window.__hr or 0) + 1
  window.__hrL = $x.length
@remplacer = -> $x = [1, 2, 3, 4, 5]
@pousse = -> $x.push(6)
</script>
<p class="f">{$x.length + '|' + $k}</p>
`,
  // liaison à deux sens : le parent et l'enfant lisent `$x` et l'écrivent `µrefresh($x)` dans un effet
  'reec-auteur-par.mjs': `<script>
$x = [1, 2]
µeffect ->
  window.__ip = (window.__ip or 0) + 1
  window.__ipL = $x.length
  µrefresh($x)
@remplacer = -> $x = [1, 2, 3, 4, 5]
@pousse = -> $x.push(6)
</script>
<p class="p">{$x.length}</p>
<mjs-reec-auteur-enf x=!{$x}></mjs-reec-auteur-enf>
`,
  'reec-auteur-enf.mjs': `<script>
$x = []
µeffect ->
  window.__ie = (window.__ie or 0) + 1
  window.__ieL = $x.length
  µrefresh($x)
</script>
<p class="c">{$x.length}</p>
`,
  // liaison à deux sens : chacun écrit `µrefresh($x)` après un changement fait hors de MJS
  'reec-deux-par.mjs': `<script>
$x = [1, 2]
$k = 0
µeffect ->
  window.__bp = (window.__bp or 0) + 1
  window.__bpL = $x.length + '/' + $k
  µrefresh($x)
@inck = -> $k += 1
@choisir = (o) -> $x = o
@reaff = -> µrefresh($x)
</script>
<p class="p">{$x.length + '|' + $k}</p>
<mjs-reec-deux-enf x=!{$x}></mjs-reec-deux-enf>
`,
  'reec-deux-enf.mjs': `<script>
$x = []
$j = 0
µeffect ->
  window.__be = (window.__be or 0) + 1
  window.__beL = $x.length + '/' + $j
  µrefresh($x)
@incj = -> $j += 1
@reaff = -> µrefresh($x)
</script>
<p class="c">{$x.length + '|' + $j}</p>
`,
  // un effet écrit deux variables `µrefresh($x)` et `µrefresh($y)`, un autre lit `$y`
  'reec-deux-var.mjs': `<script>
$x = [1, 2]
$y = {n: 1}
$k = 0
µeffect ->
  window.__c2 = (window.__c2 or 0) + 1
  window.__c2v = $x.length + '/' + $y.n + '/' + $k
  µrefresh($x)
  µrefresh($y)
µeffect ->
  window.__c2r = (window.__c2r or 0) + 1
  window.__c2rv = $y.n
@inck = -> $k += 1
@pousse = -> $x.push(3)
</script>
<p class="f">{$x.length + '|' + $y.n + '|' + $k}</p>
`,
  // deux effets croisés : l'un lit `$x` et écrit `µrefresh($y)`, l'autre lit `$y` et écrit `µrefresh($x)`
  'reec-croise.mjs': `<script>
$x = {n: 1}
$y = {n: 1}
$k = 0
µeffect ->
  window.__d1 = (window.__d1 or 0) + 1
  window.__d1v = $x.n + '/' + $k
  µrefresh($y)
µeffect ->
  window.__d2 = (window.__d2 or 0) + 1
  window.__d2v = $y.n
  µrefresh($x)
@inck = -> $k += 1
</script>
<p class="f">{$x.n + '|' + $y.n + '|' + $k}</p>
`,
  // liste affichée par un bloc `{for}` (son module enveloppe l'écriture de l'état : tous les composants du test y passent)
  'reec-liste.mjs': `<script>
$l = [1, 2]
µeffect ->
  window.__le = (window.__le or 0) + 1
  window.__leL = $l.length
@prendre = (o) -> $l = o
@reaffl = -> µrefresh($l)
</script>
<p class="f">{$l.length}</p>
<ul class="u">{for it in $l}<li>{it}</li>{end}</ul>
`,
  // `µrefresh($x)` écrit après un `await` : l'effet n'est plus en cours
  'reec-await.mjs': `<script module>
attendre = (ms) -> new Promise((r) -> setTimeout(r, ms))
</script>
<script>
$x = [1, 2]
µeffect ->
  window.__aw = (window.__aw or 0) + 1
  window.__awL = $x.length
  await attendre(20)
  µrefresh($x)
</script>
<p class="f">{$x.length}</p>
`,
}

// joué dans la page : passages des effets (compteurs) après chaque geste, l'écran, les événements de liaison vers le parent
const SCENARIO = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const R = {}
  const W = []
  const ow = console.warn
  console.warn = (...a) => { W.push(a.map(String).join(' ').slice(0, 100)); return ow.apply(console, a) }
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const neuf = async (tag, cls) => { const el = document.createElement(tag); document.body.appendChild(el); await attendre(() => el._shadow?.querySelector('.' + cls)); await pause(200); return el }
  const enfant = async (p, tag, cls) => { let e; await attendre(() => (e = p._shadow?.querySelector(tag)) && e._shadow?.querySelector('.' + cls)); await pause(200); return e }
  const txt = (el, cls) => el?._shadow?.querySelector('.' + cls)?.textContent ?? 'perdu'
  const n = (...k) => k.map((x) => window[x] || 0).join('/')
  const pas = async (f) => { f(); await pause(200) }
  const bloc = async (nom, f) => { try { R[nom] = await f() } catch (err) { R[nom] = 'lève : ' + String(err && err.message).slice(0, 80) } }
  await bloc('effetLitEtEcrit', async () => {
    const a = await neuf('mjs-reec-lit-ecrit', 'f')
    const s = [n('__eff', '__effm')]
    await pas(() => a.pousse()); s.push(n('__eff', '__effm'))
    await pas(() => { a.brut(); a.incm() }); s.push(n('__eff', '__effm'))
    await pas(() => a.reaff()); s.push(n('__eff', '__effm'))
    return s.join(' → ') + ' | écran ' + txt(a, 'f') + ' | lu ' + window.__effLen
  })
  await bloc('effetsEcriventSeulement', async () => {
    const b = await neuf('mjs-reec-ecrit-seul', 'f')
    const s = [n('__e2', '__e3')]
    await pas(() => b.inck()); s.push(n('__e2', '__e3'))
    await pas(() => b.reaffy()); s.push(n('__e2', '__e3'))
    return s.join(' → ') + ' | écran ' + txt(b, 'f')
  })
  await bloc('unAutreEffetLit', async () => {
    const c = await neuf('mjs-reec-autre', 'f')
    const s = [n('__ecr', '__lec')]
    await pas(() => c.inct()); s.push(n('__ecr', '__lec'))
    await pas(() => { c.brutz(); c.inct() }); s.push(n('__ecr', '__lec'))
    await pas(() => c.reaffz()); s.push(n('__ecr', '__lec'))
    return s.join(' → ') + ' | écran ' + txt(c, 'f') + ' ' + txt(c, 'g') + ' | lu ' + window.__lecLen
  })
  await bloc('reffetAvant', async () => {
    const d = await neuf('mjs-reec-avant', 'f')
    const s = [n('__av', '__ap')]
    await pas(() => d.incn()); s.push(n('__av', '__ap'))
    await pas(() => { d.brutw(); d.reaffw() }); s.push(n('__av', '__ap'))
    return s.join(' → ') + ' | écran ' + txt(d, 'f') + ' | lu ' + window.__avLen + '/' + window.__apLen
  })
  await bloc('enfantLie', async () => {
    const p = await neuf('mjs-reec-parent', 'p')
    const e = await enfant(p, 'mjs-reec-enfant', 'c')
    let liens = 0
    e.addEventListener('mjs-bind:x', () => liens++)
    const s = [n('__ce')]
    await pas(() => e.brut()); s.push(n('__ce'))
    liens = 0
    await pas(() => e.inck()); s.push(n('__ce') + ' liens ' + liens)
    return s.join(' → ') + ' | parent ' + txt(p, 'p') + ' | enfant ' + txt(e, 'c')
  })
  await bloc('origine', async () => {
    const el = await neuf('mjs-reec-origine', 'f')
    const s = [n('__ov', '__oe')]
    window.__o = {n: 2}
    await pas(() => el.choisir(window.__o)); s.push(n('__ov', '__oe') + ' ' + txt(el, 'f') + ' ' + txt(el, 'v'))
    await pas(() => { window.__o.n = 5; el.reaffw() }); s.push(n('__ov', '__oe') + ' ' + txt(el, 'f') + ' ' + txt(el, 'v') + ' lu ' + window.__ovN + ',' + window.__oeN)
    await pas(() => el.incn()); s.push(n('__ov', '__oe') + ' ' + txt(el, 'f'))
    return s.join(' → ')
  })
  await bloc('reffetAvantPuisAuteur', async () => {
    const el = await neuf('mjs-reec-perdu', 'f')
    const s = [n('__hq', '__hb', '__hr') + ' lus ' + window.__hbL + ',' + window.__hrL]
    await pas(() => el.remplacer()); s.push(n('__hq', '__hb', '__hr') + ' lus ' + window.__hbL + ',' + window.__hrL + ' écran ' + txt(el, 'f'))
    await pas(() => el.pousse()); s.push(n('__hq', '__hb', '__hr') + ' lus ' + window.__hbL + ',' + window.__hrL + ' écran ' + txt(el, 'f'))
    return s.join(' → ')
  })
  await bloc('lieesAuteursDesDeuxCotes', async () => {
    const p = await neuf('mjs-reec-auteur-par', 'p')
    const e = await enfant(p, 'mjs-reec-auteur-enf', 'c')
    const s = [n('__ip', '__ie') + ' lus ' + window.__ipL + ',' + window.__ieL]
    await pas(() => p.remplacer()); s.push(n('__ip', '__ie') + ' lus ' + window.__ipL + ',' + window.__ieL + ' écrans ' + txt(p, 'p') + ',' + txt(e, 'c'))
    await pas(() => p.pousse()); s.push(n('__ip', '__ie') + ' lus ' + window.__ipL + ',' + window.__ieL + ' écrans ' + txt(p, 'p') + ',' + txt(e, 'c'))
    return s.join(' → ')
  })
  await bloc('lieesReecriventApresChangementDehors', async () => {
    const p = await neuf('mjs-reec-deux-par', 'p')
    const e = await enfant(p, 'mjs-reec-deux-enf', 'c')
    let liens = 0
    e.addEventListener('mjs-bind:x', () => liens++)
    const s = [n('__bp', '__be')]
    await pas(() => p.inck()); s.push(n('__bp', '__be'))
    await pas(() => e.incj()); s.push(n('__bp', '__be'))
    window.__bo = [1, 2]
    await pas(() => p.choisir(window.__bo)); s.push(n('__bp', '__be') + ' ' + txt(p, 'p') + ' ' + txt(e, 'c'))
    await pas(() => { window.__bo.push(8); p.reaff() }); s.push(n('__bp', '__be') + ' ' + txt(p, 'p') + ' ' + txt(e, 'c'))
    liens = 0
    await pas(() => { window.__bo.push(9); e.reaff() }); s.push(n('__bp', '__be') + ' ' + txt(p, 'p') + ' ' + txt(e, 'c') + ' liens ' + liens)
    return s.join(' → ') + ' | lus ' + window.__bpL + ' ' + window.__beL
  })
  await bloc('unEffetEcritDeuxVariables', async () => {
    const el = await neuf('mjs-reec-deux-var', 'f')
    const s = [n('__c2', '__c2r')]
    await pas(() => el.inck()); s.push(n('__c2', '__c2r'))
    await pas(() => el.pousse()); s.push(n('__c2', '__c2r'))
    return s.join(' → ') + ' | écran ' + txt(el, 'f') + ' | lu ' + window.__c2v
  })
  await bloc('effetsCroises', async () => {
    const el = await neuf('mjs-reec-croise', 'f')
    const s = [n('__d1', '__d2')]
    await pas(() => el.inck()); s.push(n('__d1', '__d2'))
    await pause(200); s.push(n('__d1', '__d2'))
    return s.join(' → ') + ' | écran ' + txt(el, 'f')
  })
  await bloc('listeDuBlocFor', async () => {
    const el = await neuf('mjs-reec-liste', 'f')
    const s = [n('__le')]
    window.__lo = [1, 2]
    await pas(() => el.prendre(window.__lo)); s.push(n('__le'))
    await pas(() => { window.__lo.push(3); el.reaffl() }); s.push(n('__le'))
    return s.join(' → ') + ' | écran ' + txt(el, 'f') + ' ' + el._shadow.querySelectorAll('.u li').length + ' | lu ' + window.__leL
  })
  await bloc('apresAwait', async () => {
    const el = await neuf('mjs-reec-await', 'f')
    const s = [n('__aw')]
    await pause(500); s.push(n('__aw'))
    el.remove(); await pause(200); s.push(n('__aw'))
    return s.join(' → ') + ' | écran ' + txt(el, 'f')
  })
  console.warn = ow
  R.avertissements = W.length + (W.length ? ' ' + W[0] : '')
  return R
})()`

const ATTENDU = {
  // montage, `$x.push` d'un gestionnaire, écriture sans rapport (`$m`), `µrefresh($x)` d'un gestionnaire : comptes de la 3.1.0, la
  // réécriture ne relance pas l'effet
  effetLitEtEcrit: '1/1 → 2/1 → 3/2 → 3/2 | écran 4|1 | lu 4',
  // aucun ne relance l'autre, ni le `µrefresh($y)` d'un gestionnaire (3.1.0 : 1/1 → 1/2)
  effetsEcriventSeulement: '1/1 → 1/2 → 1/2 | écran 2|1',
  // le lecteur ne repart que sur une vraie écriture de `$z` (`µread($z).push`), pas sur un `µrefresh($z)` ; l'écran suit
  unAutreEffetLit: '1/1 → 2/1 → 3/2 → 3/2 | écran 3|2 3 | lu 3',
  // `µread($w).push(7)` est une écriture que MJS voit : le reffet d'avant passe une fois, le `µeffect` une fois ; ni le `µrefresh($w)`
  // du reffet d'avant ni celui du gestionnaire ne relancent quoi que ce soit
  reffetAvant: '1/1 → 1/1 → 2/2 | écran 2|1 | lu 2/2',
  // l'enfant repart sur ses vraies écritures ; le `µrefresh($x)` de son effet n'envoie aucun événement de liaison au parent
  enfantLie: '1 → 2 → 3 liens 0 | parent 3 | enfant 3',
  // changé hors de MJS puis `µrefresh($w)` : l'écran, la variable qui tient le même objet (`$v`) et la valeur calculée (`$d`) suivent,
  // aucun effet ne repart
  origine: '1/1 → 2/2 2|0|20 2 → 2/2 5|0|50 5 lu 2,2 → 2/2 5|1|50',
  // les vraies écritures (`$x = [...]`, `$x.push`) restent vues de tous, l'auteur compris
  reffetAvantPuisAuteur: '1/1/1 lus 2,2 → 2/2/2 lus 5,5 écran 5|0 → 3/3/3 lus 6,6 écran 6|0',
  // comme la 3.1.0
  lieesAuteursDesDeuxCotes: '1/1 lus 2,2 → 2/2 lus 5,5 écrans 5,5 → 3/3 lus 6,6 écrans 6,6',
  // comptes de la 3.1.0 ; le `µrefresh($x)` du parent redessine aussi l'enfant lié, qui tient le même objet (redessin seul : aucun reffet,
  // aucun événement de liaison) ; celui de l'enfant redessine son écran sans prévenir le parent
  lieesReecriventApresChangementDehors: '1/1 → 2/1 → 2/2 → 3/3 2|1 2|1 → 3/3 3|1 3|1 → 3/3 3|1 4|1 liens 0 | lus 2/1 2/1',
  // comme la 3.1.0
  unEffetEcritDeuxVariables: '1/1 → 2/1 → 3/1 | écran 3|1|1 | lu 3/1/1',
  // comme la 3.1.0 : aucune boucle
  effetsCroises: '1/1 → 2/1 → 2/1 | écran 1|1|1',
  // le bloc `{for}` se redessine (trois lignes), l'effet ne repart pas
  listeDuBlocFor: '1 → 2 → 2 | écran 3 3 | lu 2',
  // comme la 3.1.0 : un passage, aucune boucle
  apresAwait: '1 → 1 → 1 | écran 2',
  avertissements: '0',
}

async function construire(prod: boolean): Promise<string> {
  const root   = mjsTmp('reec')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), src)
  // la précision des valeurs calculées est une option d'appli (`derived: "precise"`, mjs.config.json)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: 'precise' }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

describe('`µrefresh($x)` redessine sans relancer les effets ni prévenir le parent lié', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    describe(prod ? 'production' : 'développement', function () {
      let code: string
      before(async () => { code = await construire(prod) })

      it('happy-dom : écran et valeurs justes, passages des effets de la 3.1.0, aucun événement de liaison', async () => {
        const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
        window.eval(code)
        const r = await window.eval(SCENARIO)
        assert.deepEqual(JSON.parse(JSON.stringify(r)), ATTENDU)
        await window.happyDOM.close()
      })

      for (const moteur of ['chromium', 'firefox', 'webkit']) {
        it(`${moteur} : écran et valeurs justes, passages des effets de la 3.1.0, aucun événement de liaison`, async function () {
          const playwright: any = await import('playwright')
          if (!existsSync(playwright[moteur].executablePath())) return this.skip()
          const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
          try {
            const page = await browser.newPage()
            const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
            await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
            await page.goto('http://mjs.test/')
            assert.deepEqual(await page.evaluate(SCENARIO), ATTENDU)
          }
          finally {
            await browser.close()
          }
        })
      }
    })
  }
})
