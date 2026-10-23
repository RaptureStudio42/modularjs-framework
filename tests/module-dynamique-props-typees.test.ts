// POURQUOI CE FICHIER EXISTE
// Le défaut d'origine : `<@module $comp ids={$trouvees}>` avec `$trouvees = ['a', 'b']` donnait au
// composant monté la CHAÎNE `'a,b'`, alors que `<mjs-carte ids={$trouvees}>` écrit en dur recevait le
// tableau. `<@module>` rend d'abord un `<div>` de repère : ses attributs dynamiques étaient posés comme
// de simples attributs HTML (donc des chaînes), puis recopiés tels quels sur le vrai composant au
// moment du remplacement. Un objet devenait `[object Object]`, `false` l'absence de l'attribut, une
// fonction son texte source.
// Rencontré en refaisant une page à onglets qui passait une liste d'identifiants (`ids={$trouvees}`),
// un booléen (`badge={true}`) et un gestionnaire (`@copier={…}`) au composant choisi par une variable.
// Ce que ces tests gardent : les props d'un `<@module>` arrivent EXACTEMENT comme celles du même
// composant écrit en dur (tableau, objet, nombre, `false`, `null`, fonction) — au montage, quand la
// valeur change ensuite, et quand `$comp` change de composant ; les événements remontent ; `data-*`,
// `aria-*` et `class` restent des attributs de la balise.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterModule, pause } from './helpers/module-dynamique.js'
import { assertAbsent } from './helpers/dom-assert.js'

// le composant résume ce qu'il reçoit : le type de chaque prop et de quoi la reconnaître
const PROPS = `<script>
$ids = null
$obj = null
$n = null
$ok = 'defaut'
$nul = 'defaut'
$fn = null
@envoyer = -> µemit 'copier', 'bonjour'
</script>
<p class="ids">{Array.isArray($ids) ? 'tableau:' + $ids.join('+') : typeof $ids + ':' + $ids}</p>
<p class="obj">{typeof $obj}:{$obj ? $obj.x : '-'}</p>
<p class="n">{typeof $n}:{$n}</p>
<p class="ok">{typeof $ok}:{String($ok)}</p>
<p class="nul">{$nul === null ? 'null' : typeof $nul + ':' + $nul}</p>
<p class="fn">{typeof $fn}:{typeof $fn === 'function' ? $fn() : '-'}</p>
<button class="b" @click={@envoyer()}>b</button>
`
const AUTRE = `<script>
$ids = null
</script>
<p class="ids">AUTRE:{Array.isArray($ids) ? 'tableau:' + $ids.join('+') : typeof $ids + ':' + $ids}</p>
`

const ATTRS = 'ids={$trouvees} obj={$o} n={$n} ok={$ok} nul={$nul} fn={$fn}'
const INIT  = `$trouvees = ['a', 'b']
$o = { x: 7 }
$n = 42
$ok = false
$nul = null
$fn = () -> 'appel'
$comp = 'mjs-tuto-props'
$recu = ''
@maj = (c, v) -> c is 'ids' ? $trouvees = v : c is 'comp' ? $comp = v : c is 'ok' ? $ok = v : c is 'o' ? $o = v : c is 'nul' ? $nul = v : c is 'n' ? $n = v : $fn = v
@recevoir = (d) -> $recu = d`

const hote = (corps: string) => `<script>\n${INIT}\n</script>\n${corps}\n<i class="recu">{$recu}</i>\n`

// ce que le composant `c` affiche, prop par prop
const vu = (c: any) => Object.fromEntries(['ids', 'obj', 'n', 'ok', 'nul', 'fn'].map((k) => [k, c._shadow.querySelector('.' + k).textContent.trim()]))

const ATTENDU = { ids: 'tableau:a+b', obj: 'object:7', n: 'number:42', ok: 'boolean:false', nul: 'null', fn: 'function:appel' }

describe('<@module> — props typées comme celles d\'un composant écrit en dur', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('référence — le composant écrit en dur reçoit tableau, objet, nombre, false, null et fonction', async () => {
    const { hote: h } = await monterModule({ hote: hote(`<mjs-tuto-props ${ATTRS}></mjs-tuto-props>`), 'tuto-props': PROPS })
    assert.deepEqual(vu(h._shadow.querySelector('mjs-tuto-props')), ATTENDU)
  })

  it('au montage — <@module> donne les mêmes types que le composant écrit en dur', async () => {
    const { hote: h, erreurs } = await monterModule({ hote: hote(`<@module $comp ${ATTRS}></@module>`), 'tuto-props': PROPS })
    assert.deepEqual(vu(h._shadow.querySelector('mjs-tuto-props')), ATTENDU)
    assert.deepEqual(erreurs(), [])
  })

  it('nom COURT + props typées ensemble', async () => {
    const { hote: h } = await monterModule({ hote: hote(`<@module 'tuto-props' ${ATTRS}></@module>`), 'tuto-props': PROPS })
    assert.deepEqual(vu(h._shadow.querySelector('mjs-tuto-props')), ATTENDU)
  })

  it('la liste change APRÈS le montage : le composant reçoit le nouveau tableau, sans être remonté', async () => {
    const { hote: h } = await monterModule({ hote: hote(`<@module $comp ${ATTRS}></@module>`), 'tuto-props': PROPS })
    const avant = h._shadow.querySelector('mjs-tuto-props')
    h.maj('ids', ['x', 'y', 'z'])
    await pause(80)
    assert.equal(avant.isConnected && h._shadow.querySelector('mjs-tuto-props') === avant, true)
    assert.equal(vu(avant).ids, 'tableau:x+y+z')
  })

  it('les autres valeurs changent après le montage : objet, nombre, false → true, null → valeur, fonction', async () => {
    const { hote: h } = await monterModule({ hote: hote(`<@module $comp ${ATTRS}></@module>`), 'tuto-props': PROPS })
    h.maj('o', { x: 9 })
    h.maj('n', 5)
    h.maj('ok', true)
    h.maj('nul', 'plein')
    h.maj('fn', () => 'autre')
    await pause(100)
    assert.deepEqual(vu(h._shadow.querySelector('mjs-tuto-props')), { ids: 'tableau:a+b', obj: 'object:9', n: 'number:5', ok: 'boolean:true', nul: 'string:plein', fn: 'function:autre' })
  })

  it('$comp change : le NOUVEAU composant reçoit les props courantes (déjà posées avant lui), typées', async () => {
    const { hote: h } = await monterModule({ hote: hote(`<@module $comp ${ATTRS}></@module>`), 'tuto-props': PROPS, 'tuto-autre': AUTRE })
    h.maj('ids', ['m', 'n'])
    await pause(60)
    h.maj('comp', 'mjs-tuto-autre')
    await pause(100)
    assertAbsent(h._shadow.querySelector('mjs-tuto-props'), 'l\'ancien est démonté')
    assert.equal(h._shadow.querySelector('mjs-tuto-autre .ids, mjs-tuto-autre').localName, 'mjs-tuto-autre')
    assert.equal(h._shadow.querySelector('mjs-tuto-autre')._shadow.querySelector('.ids').textContent.trim(), 'AUTRE:tableau:m+n')
  })

  it('$comp change puis revient : le composant remonté reçoit toujours le tableau', async () => {
    const { hote: h } = await monterModule({ hote: hote(`<@module $comp ${ATTRS}></@module>`), 'tuto-props': PROPS, 'tuto-autre': AUTRE })
    h.maj('comp', 'mjs-tuto-autre')
    await pause(80)
    h.maj('comp', 'mjs-tuto-props')
    await pause(120)
    assert.deepEqual(vu(h._shadow.querySelector('mjs-tuto-props')), ATTENDU)
  })

  it('événement — `@copier={…}` posé sur <@module> reçoit ce que le composant émet', async () => {
    const { hote: h } = await monterModule({ hote: hote('<@module $comp @copier={@recevoir(e.data)}></@module>'), 'tuto-props': PROPS })
    h._shadow.querySelector('mjs-tuto-props')._shadow.querySelector('.b').click()
    await pause(60)
    assert.equal(h._shadow.querySelector('.recu').textContent.trim(), 'bonjour')
  })

  it('événement — toujours reçu après un changement de composant puis retour', async () => {
    const { hote: h } = await monterModule({ hote: hote('<@module $comp @copier={@recevoir(e.data)}></@module>'), 'tuto-props': PROPS, 'tuto-autre': AUTRE })
    h.maj('comp', 'mjs-tuto-autre')
    await pause(80)
    h.maj('comp', 'mjs-tuto-props')
    await pause(100)
    h._shadow.querySelector('mjs-tuto-props')._shadow.querySelector('.b').click()
    await pause(60)
    assert.equal(h._shadow.querySelector('.recu').textContent.trim(), 'bonjour')
  })

  it('`data-*`, `aria-*` et `class` restent des attributs de la balise du composant', async () => {
    const { hote: h } = await monterModule({ hote: hote(`<@module $comp class="carte" data-zone={$comp} aria-label="Fiche" ids={$trouvees}></@module>`), 'tuto-props': PROPS })
    const c = h._shadow.querySelector('mjs-tuto-props')
    assert.equal(c.getAttribute('class'), 'carte')
    assert.equal(c.getAttribute('data-zone'), 'mjs-tuto-props')
    assert.equal(c.getAttribute('aria-label'), 'Fiche')
    assert.equal(vu(c).ids, 'tableau:a+b')
  })

  it('une prop littérale (`n="3"`) reste ce qu\'elle est pour un composant écrit en dur : une chaîne', async () => {
    const { hote: h } = await monterModule({ hote: hote('<mjs-tuto-props n="3"></mjs-tuto-props><@module $comp n="3"></@module>'), 'tuto-props': PROPS })
    const [a, b] = [...h._shadow.querySelectorAll('mjs-tuto-props')]
    assert.equal(vu(b).n, vu(a).n)
  })

  it('valeur vide (`$comp = null`) : rien de monté même avec des props, sans erreur', async () => {
    const { hote: h, erreurs } = await monterModule({ hote: hote(`<@module $nul ${ATTRS}></@module>`), 'tuto-props': PROPS })
    assertAbsent(h._shadow.querySelector('mjs-tuto-props'))
    assert.deepEqual(erreurs(), [])
  })
})
