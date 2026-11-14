// L'attribut écrit sur une balise gagne sur la même clé d'une donnée étalée (`{...$x}`), partout et dans les deux ordres d'écriture :
// balise ordinaire (attribut fixe, `value` d'un champ, attribut booléen `hidden`, attribut calculé `title={$t}`, `style`), `<@element $tag>`
// (même après le changement de balise), ligne d'un `{for}`, branche d'un `{await}`, composant (prop écrite `titre="a"` ou `titre={$t}`).
// Pour `class`, l'union : la classe étalée s'ajoute à la classe écrite (fixe, mêlée ou calculée), n'en retire que ce qu'elle seule apportait,
// et un jeton écrit ne part jamais. Une clé étalée sans valeur écrite reste posée tant que l'objet la porte, puis part ; deux étalements
// sans valeur écrite : le dernier gagne, même quand le premier change. Navigateurs réels (Chromium, Firefox, WebKit), en développement et
// en production ; rendu serveur (repères, positions, différences, remplacement) : le HTML du serveur porte déjà la valeur écrite, la reprise
// la garde et la suite des changements la garde aussi. Un `value` écrit en dur sur `<textarea>` ou `<select>`, que le navigateur ne lit pas
// (le champ ne l'affiche pas), ne garde pas la clé : la `value` étalée s'y pose, dans les deux ordres d'écriture.
// Sur un composant, étaler revient au même qu'écrire la valeur en clair : `id`, `title`, `hidden`, `role` et `tabindex` étalés vont sur la
// balise et en prop, en prop seule quand le composant déclare la prop ; `aria-*` et `data-*` vont toujours sur la balise et en prop ; une clé
// qui quitte l'objet quitte la balise ; une valeur écrite sur la balise gagne là aussi.

import assert from 'node:assert/strict'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'
import { construire, charger, graves, VARIANTES, type Cible } from './helpers/liaison-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const BALISE = 'mjs-et-dur'
const CARTE  = `<script>
$titre = ''
</script>
<i class="t">{$titre}</i>
`
// un composant qui déclare les props des attributs globaux : il les garde pour lui, sans attribut sur sa balise (sauf `aria-*` et `data-*`)
const DECL = `<script>
$id       = ''
$title    = ''
$hidden   = false
$role     = ''
$tabindex = 0
</script>
<i class="lu">{$id}|{$title}|{$hidden}|{$role}|{$tabindex}</i>
`
const SOURCES: Record<string, string> = {
  'et-dur.mjs': `<script>
$x    = {title: 'e1', value: 'e1', hidden: false, style: 'color: blue', class: 'a', titre: 'b1', 'data-k': 'k1'}
$t    = 't1'
$c    = 'm1'
$y    = {'data-d': 'y1'}
$z    = {'data-d': 'z1'}
$tag  = 'section'
$rows = [1, 2]
$p    = Promise.resolve(1)
$g    = {id: 'i1', title: 'g1', hidden: true, role: 'note', tabindex: 3, 'aria-label': 'l1', 'data-x': 'd1'}
@gchanger = -> $g = {id: 'i2', title: 'g2', hidden: true, role: 'note', tabindex: 4, 'aria-label': 'l2', 'data-x': 'd2'}
@gretirer = -> $g = {title: 'g3'}
@changer = -> $x = {title: 'e2', value: 'e2', hidden: false, style: 'color: green', class: 'b', titre: 'b2', 'data-k': 'k2'}
@encore  = -> $x = {title: 'e3', value: 'e3', hidden: false, style: 'color: green', class: 'c fixe', titre: 'b3', 'data-k': 'k3'}
@retirer = -> $x = {}
@haut    = -> $y = {'data-d': 'y2'}
@bas     = -> $z = {}
</script>
<p data-t="fixe" title="f" {...$x}></p>
<p data-t="fixe-apres" {...$x} title="f"></p>
<input data-t="valeur" value="a" {...$x}>
<input data-t="valeur-apres" {...$x} value="a">
<textarea data-t="zone" value="a" {...$x}></textarea>
<textarea data-t="zone-apres" {...$x} value="a"></textarea>
<select data-t="choix" value="a" {...$x}><option>a</option><option>e1</option><option>e2</option><option>e3</option></select>
<p data-t="bool" hidden {...$x}></p>
<p data-t="calc" title={$t} {...$x}></p>
<p data-t="calc-apres" {...$x} title={$t}></p>
<p data-t="cfixe" class="fixe" {...$x}></p>
<p data-t="cfixe-apres" {...$x} class="fixe"></p>
<p data-t="cmele" class="fixe {$c}" {...$x}></p>
<p data-t="ccalc" class={$c} {...$x}></p>
<p data-t="style" style="color: red" {...$x}></p>
<p data-t="libre" {...$x}></p>
<p data-t="deux" {...$y} {...$z}></p>
<@element $tag data-t="elem" title="f" class="fixe" {...$x}></@element>
<ul>{for r in $rows by r}<li data-t="ligne" title="f" class="fixe" {...$x}></li>{end}</ul>
{await $p}<i>attente</i>{success v}<p data-t="attente" title="f" class="fixe" {...$x}></p>{end}
<@c-carte data-t="carte" titre="a" {...$x}></@c-carte>
<@c-carte data-t="carte-apres" {...$x} titre="a"></@c-carte>
<@c-carte data-t="carte-calc" titre={$t} {...$x}></@c-carte>
<@c-carte data-t="carte-calc-apres" {...$x} titre={$t}></@c-carte>
<@c-carte data-t="glob" {...$g}></@c-carte>
<@c-decl data-t="globdecl" {...$g}></@c-decl>
<@c-carte data-t="globecrit" title="w" data-x="dw" {...$g}></@c-carte>
<@c-carte data-t="globecrit-apres" {...$g} title="w" data-x="dw"></@c-carte>
<@c-decl data-t="globdecl-ecrit" title="w" {...$g}></@c-decl>
<button class="changer" @click={@changer()}>c</button>
<button class="gchanger" @click={@gchanger()}>gc</button>
<button class="gretirer" @click={@gretirer()}>gr</button>
<button class="encore" @click={@encore()}>e</button>
<button class="retirer" @click={@retirer()}>r</button>
<button class="t" @click={$t = 't2'}>t</button>
<button class="m" @click={$c = 'm2'}>m</button>
<button class="tag" @click={$tag = 'article'}>g</button>
<button class="haut" @click={@haut()}>h</button>
<button class="bas" @click={@bas()}>b</button>
`,
  'c-carte.mjs': CARTE,
  'c-decl.mjs': DECL
}

const SERVEUR = 'mjs-et-dur-srv'
const SOURCES_SSR: Record<string, string> = {
  'et-dur-srv.mjs': `<script>
$x = {title: 'e1', hidden: false, style: 'color: blue', class: 'a', titre: 'b1', 'data-k': 'k1'}
$g = {id: 'i1', title: 'g1', hidden: true, role: 'note', tabindex: 3, 'aria-label': 'l1', 'data-x': 'd1'}
$t = 't1'
$c = 'm1'
@changer = -> $x = {title: 'e2', hidden: false, style: 'color: green', class: 'b', titre: 'b2', 'data-k': 'k2'}
</script>
<p data-t="fixe" title="f" {...$x}></p>
<p data-t="fixe-apres" {...$x} title="f"></p>
<p data-t="bool" hidden {...$x}></p>
<p data-t="calc" title={$t} {...$x}></p>
<p data-t="cfixe" class="fixe" {...$x}></p>
<p data-t="cmele" class="fixe {$c}" {...$x}></p>
<p data-t="style" style="color: red" {...$x}></p>
<p data-t="libre" {...$x}></p>
<@c-carte data-t="carte" titre="a" {...$x}></@c-carte>
<@c-carte data-t="carte-calc" {...$x} titre={$t}></@c-carte>
<@c-carte data-t="glob" {...$g}></@c-carte>
<@c-decl data-t="globdecl" {...$g}></@c-decl>
<@c-carte data-t="globecrit" title="w" {...$g}></@c-carte>
<button class="changer" @click={@changer()}>c</button>
<button class="gretirer" @click={$g = {title: 'g3'}}>gr</button>
`,
  'c-carte.mjs': CARTE,
  'c-decl.mjs': DECL
}

// chaque balise `[data-t]` de l'ombre, sous `<nom>.<champ>` : ses classes triées, ses attributs `title`, `style`, `data-k` et `data-d` (« - »
// s'il n'y est pas), `hidden`, la valeur d'un champ (`input`, `textarea`, `select`), la prop `$titre` que montre un composant, le nom de la balise ; les lignes d'un `{for}`
// jointes par « | »
const lire = (balise: string) => `(() => {
  const h  = document.querySelector('${balise}')
  const sh = h && (h._shadow || h.shadowRoot)
  if (!sh) return null
  const lu     = {}
  const mettre = (k, v) => { lu[k] = (k in lu ? lu[k] + '|' : '') + v }
  for (const n of sh.querySelectorAll('[data-t]')) {
    const t = n.dataset.t
    mettre(t + '.class', [...n.classList].sort().join(' '))
    for (const a of ['title', 'style', 'data-k', 'data-d', 'id', 'role', 'tabindex', 'aria-label', 'data-x']) mettre(t + '.' + a, n.getAttribute(a) ?? '-')
    mettre(t + '.hidden', String(n.hidden))
    mettre(t + '.balise', n.localName)
    if (/^(input|textarea|select)$/.test(n.localName)) mettre(t + '.value', n.value)
    if (n.localName.startsWith('mjs-')) { const s = n._shadow || n.shadowRoot, e = s && s.querySelector('.t'), d = s && s.querySelector('.lu'); mettre(t + '.titre', e ? e.textContent : '?'); mettre(t + '.props', d ? d.textContent : '?') }
  }
  return lu
})()`

const lireAttendu = async (page: any, balise: string, attendu: Record<string, string>) => {
  const lu = await page.evaluate(lire(balise))
  return lu && Object.fromEntries(Object.keys(attendu).map((k) => [k, lu[k]]))
}

// attend que la page montre l'état voulu (l'attente cède au bout de cinq secondes, la lecture dit alors ce qui reste)
const attendre = (page: any, balise: string, attendu: Record<string, string>) => page.waitForFunction(`(() => {
  const lu  = ${lire(balise)}
  const att = ${JSON.stringify(attendu)}
  return !!lu && Object.keys(att).every((k) => lu[k] === att[k])
})()`, null, { timeout: 5000 }).catch(() => {})

const cliquer = (page: any, balise: string, sel: string) => page.evaluate(`document.querySelector('${balise}')._shadow.querySelector('${sel}').click()`)

// ce qui ne bouge jamais, quel que soit l'objet étalé : les valeurs écrites
const ECRIT = { 'fixe.title': 'f', 'fixe-apres.title': 'f', 'valeur.value': 'a', 'valeur-apres.value': 'a', 'bool.hidden': 'true', 'style.style': 'color: red', 'elem.title': 'f', 'ligne.title': 'f|f', 'attente.title': 'f', 'carte.titre': 'a', 'carte-apres.titre': 'a' }

// attributs globaux étalés sur un composant : `G1` sur la balise du composant qui ne les déclare pas, `D1` (rien que `aria-*` et `data-*`) sur
// celle du composant qui les déclare, puis les mêmes après le changement de l'objet (`G2`, `D2`) et après le retrait de ses clés (`G3`, `D3`) ;
// `title="w"` écrit en clair sur la balise du composant qui déclare `$title` y reste tel qu'écrit, et c'est sa prop
const glob = (t: string, v: Record<string, string>) => Object.fromEntries(Object.entries(v).map(([k, x]) => [t + '.' + k, x]))
const G1 = { id: 'i1', title: 'g1', hidden: 'true', role: 'note', tabindex: '3', 'aria-label': 'l1', 'data-x': 'd1' }
const D1 = { id: '-', title: '-', hidden: 'false', role: '-', tabindex: '-', 'aria-label': 'l1', 'data-x': 'd1' }
const G2 = { ...G1, id: 'i2', title: 'g2', tabindex: '4', 'aria-label': 'l2', 'data-x': 'd2' }
const D2 = { ...D1, 'aria-label': 'l2', 'data-x': 'd2' }
const G3 = { id: '-', title: 'g3', hidden: 'false', role: '-', tabindex: '-', 'aria-label': '-', 'data-x': '-' }
const D3 = { ...D1, 'aria-label': '-', 'data-x': '-' }
const GLOB1 = { ...glob('glob', G1), ...glob('globdecl', D1), 'globdecl.props': 'i1|g1|true|note|3', ...glob('globecrit', { ...G1, title: 'w', 'data-x': 'dw' }), ...glob('globecrit-apres', { ...G1, title: 'w', 'data-x': 'dw' }), ...glob('globdecl-ecrit', { ...D1, title: 'w' }), 'globdecl-ecrit.props': 'i1|w|true|note|3' }
const GLOB2 = { ...glob('glob', G2), ...glob('globdecl', D2), 'globdecl.props': 'i2|g2|true|note|4', ...glob('globecrit', { ...G2, title: 'w', 'data-x': 'dw' }), ...glob('globecrit-apres', { ...G2, title: 'w', 'data-x': 'dw' }), ...glob('globdecl-ecrit', { ...D2, title: 'w' }), 'globdecl-ecrit.props': 'i2|w|true|note|4' }
const GLOB3 = { ...glob('glob', G3), ...glob('globdecl', D3), ...glob('globecrit', { ...G3, title: 'w', 'data-x': 'dw' }), ...glob('globecrit-apres', { ...G3, title: 'w', 'data-x': 'dw' }), ...glob('globdecl-ecrit', { ...D3, title: 'w' }) }

const ETAPES: { clic: string | null, attendu: Record<string, string> }[] = [
  { clic: null, attendu: { ...ECRIT, 'zone.value': 'e1', 'zone-apres.value': 'e1', 'choix.value': 'e1', 'calc.title': 't1', 'calc-apres.title': 't1', 'cfixe.class': 'a fixe', 'cfixe-apres.class': 'a fixe', 'cmele.class': 'a fixe m1', 'ccalc.class': 'a m1', 'libre.title': 'e1', 'libre.data-k': 'k1', 'libre.class': 'a', 'libre.style': 'color: blue', 'deux.data-d': 'z1', 'elem.balise': 'section', 'elem.class': 'a fixe', 'ligne.class': 'a fixe|a fixe', 'attente.class': 'a fixe', 'carte-calc.titre': 't1', 'carte-calc-apres.titre': 't1' } },
  { clic: '.changer', attendu: { ...ECRIT, 'zone.value': 'e2', 'zone-apres.value': 'e2', 'choix.value': 'e2', 'calc.title': 't1', 'calc-apres.title': 't1', 'cfixe.class': 'b fixe', 'cfixe-apres.class': 'b fixe', 'cmele.class': 'b fixe m1', 'ccalc.class': 'b m1', 'libre.title': 'e2', 'libre.data-k': 'k2', 'libre.class': 'b', 'libre.style': 'color: green', 'elem.class': 'b fixe', 'ligne.class': 'b fixe|b fixe', 'attente.class': 'b fixe', 'carte-calc.titre': 't1', 'carte-calc-apres.titre': 't1' } },
  { clic: '.t', attendu: { ...ECRIT, 'calc.title': 't2', 'calc-apres.title': 't2', 'carte-calc.titre': 't2', 'carte-calc-apres.titre': 't2' } },
  { clic: '.m', attendu: { ...ECRIT, 'cmele.class': 'b fixe m2', 'ccalc.class': 'b m2', 'cfixe.class': 'b fixe' } },
  { clic: '.tag', attendu: { ...ECRIT, 'elem.balise': 'article', 'elem.class': 'b fixe' } },
  { clic: '.encore', attendu: { ...ECRIT, 'zone.value': 'e3', 'zone-apres.value': 'e3', 'choix.value': 'e3', 'calc.title': 't2', 'elem.balise': 'article', 'elem.class': 'c fixe', 'cfixe.class': 'c fixe', 'cmele.class': 'c fixe m2', 'ccalc.class': 'c fixe m2', 'libre.title': 'e3', 'libre.class': 'c fixe', 'ligne.class': 'c fixe|c fixe', 'attente.class': 'c fixe', 'carte-calc.titre': 't2' } },
  { clic: '.retirer', attendu: { ...ECRIT, 'calc.title': 't2', 'calc-apres.title': 't2', 'cfixe.class': 'fixe', 'cfixe-apres.class': 'fixe', 'cmele.class': 'fixe m2', 'ccalc.class': 'm2', 'libre.title': '-', 'libre.data-k': '-', 'libre.class': '', 'libre.style': '-', 'elem.balise': 'article', 'elem.class': 'fixe', 'ligne.class': 'fixe|fixe', 'attente.class': 'fixe', 'carte-calc.titre': 't2', 'carte-calc-apres.titre': 't2' } },
  { clic: '.haut', attendu: { 'deux.data-d': 'z1' } },
  { clic: '.bas', attendu: { 'deux.data-d': 'y2', ...GLOB1 } },
  { clic: '.gchanger', attendu: GLOB2 },
  { clic: '.gretirer', attendu: GLOB3 },
  { clic: '.gchanger', attendu: GLOB2 }
]

// les attributs que le HTML du serveur pose sur la balise `[data-t="t"]` (classes triées) ; « (balise absente) » s'il ne l'a pas rendue
const attrsServeur = (html: string, t: string): Record<string, string> | string => {
  for (const m of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)) {
    if (!new RegExp(`data-t=(["'])${t}\\1`).test(m[2])) continue
    const lu: Record<string, string> = {}
    for (const a of m[2].matchAll(/([^\s=]+)(?:=(["'])(.*?)\2)?/g)) lu[a[1]] = a[1] === 'class' ? (a[3] ?? '').split(/\s+/).filter(Boolean).sort().join(' ') : (a[3] ?? '')
    return lu
  }
  return '(balise absente)'
}

describe('attribut écrit contre la même clé d\'un étalement : la valeur écrite gagne, la classe fait l\'union, navigateurs réels, développement et production', function () {
  this.timeout(240000)
  const cibles: Record<string, Cible> = {}
  let serveur: Cible | null = null

  before(async function () {
    this.timeout(300000)
    cibles['développement'] = await construire('dev-parents-avant', SOURCES, [BALISE])
    cibles['production']    = await construire('bundle', SOURCES, [BALISE])
    serveur                 = await construire('ssr', SOURCES_SSR, [SERVEUR])
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('rendu serveur : le HTML du serveur porte la valeur écrite, la classe écrite avec la classe étalée, et la clé étalée sans valeur écrite', () => {
    for (const variante of VARIANTES.ssr) {
      const html = serveur!.document(SERVEUR, variante)
      const lu   = (t: string, a: string) => { const x = attrsServeur(html, t); return typeof x === 'string' ? x : x[a] ?? '-' }
      const vu   = { 'fixe.title': lu('fixe', 'title'), 'fixe-apres.title': lu('fixe-apres', 'title'), 'bool.hidden': lu('bool', 'hidden'), 'calc.title': lu('calc', 'title'), 'cfixe.class': lu('cfixe', 'class'), 'cmele.class': lu('cmele', 'class'), 'style.style': lu('style', 'style'), 'libre.title': lu('libre', 'title'), 'libre.data-k': lu('libre', 'data-k'), 'libre.class': lu('libre', 'class') }
      assert.deepEqual(vu, { 'fixe.title': 'f', 'fixe-apres.title': 'f', 'bool.hidden': '', 'calc.title': 't1', 'cfixe.class': 'a fixe', 'cmele.class': 'a fixe m1', 'style.style': 'color: red', 'libre.title': 'e1', 'libre.data-k': 'k1', 'libre.class': 'a' }, `${variante} : HTML du serveur`)
      const noms = ['id', 'title', 'hidden', 'role', 'tabindex', 'aria-label', 'data-x']
      const glo  = (t: string) => Object.fromEntries(noms.map((a) => [a, lu(t, a)]))
      assert.deepEqual({ glob: glo('glob'), globdecl: glo('globdecl'), globecrit: glo('globecrit') }, {
        glob: { id: 'i1', title: 'g1', hidden: '', role: 'note', tabindex: '3', 'aria-label': 'l1', 'data-x': 'd1' },
        globdecl: { id: '-', title: '-', hidden: '-', role: '-', tabindex: '-', 'aria-label': 'l1', 'data-x': 'd1' },
        globecrit: { id: 'i1', title: 'w', hidden: '', role: 'note', tabindex: '3', 'aria-label': 'l1', 'data-x': 'd1' }
      }, `${variante} : attributs globaux étalés sur un composant, dans le HTML du serveur`)
    }
  })

  for (const moteur of MOTEURS) {
    describe(moteur, function () {
      let browser: any = null

      before(async function () {
        if (!(await moteurPresent(moteur))) {
          console.log(`  ℹ️  ${moteur} non installé, tests sautés. Activer : \`npx playwright install ${moteur}\``)
          this.skip()
        }
        const playwright: any = await import('playwright')
        browser = await playwright[moteur].launch()
      })

      after(async () => { if (browser) await browser.close() })

      for (const mode of ['développement', 'production']) {
        it(`${mode} : la valeur écrite gagne sur l'étalement, dans les deux ordres d'écriture ; la classe étalée s'ajoute à la classe écrite`, async function () {
          const o = await charger(browser, cibles[mode], BALISE)
          try {
            for (const etape of ETAPES) {
              if (etape.clic) await cliquer(o.page, BALISE, etape.clic)
              await attendre(o.page, BALISE, etape.attendu)
              assert.deepEqual(await lireAttendu(o.page, BALISE, etape.attendu), etape.attendu, `${mode}, ${etape.clic ? 'après le clic ' + etape.clic : 'premier rendu'} ; la page dit : ${[...o.erreurs, ...o.avis].join(' / ')}`)
            }
            assert.deepEqual(graves(o), [])
          }
          finally {
            await o.fermer()
          }
        })
      }

      it('rendu serveur : la reprise garde la valeur écrite, puis chaque changement de l\'objet aussi', async function () {
        const etapes = [
          [null, { 'fixe.title': 'f', 'fixe-apres.title': 'f', 'bool.hidden': 'true', 'calc.title': 't1', 'cfixe.class': 'a fixe', 'cmele.class': 'a fixe m1', 'style.style': 'color: red', 'libre.title': 'e1', 'libre.class': 'a', 'carte.titre': 'a', 'carte-calc.titre': 't1' }],
          ['.changer', { 'fixe.title': 'f', 'fixe-apres.title': 'f', 'bool.hidden': 'true', 'calc.title': 't1', 'cfixe.class': 'b fixe', 'cmele.class': 'b fixe m1', 'style.style': 'color: red', 'libre.title': 'e2', 'libre.data-k': 'k2', 'libre.class': 'b', 'carte.titre': 'a', 'carte-calc.titre': 't1', ...glob('glob', G1), ...glob('globdecl', D1), 'globdecl.props': 'i1|g1|true|note|3', ...glob('globecrit', { ...G1, title: 'w' }) }],
          ['.gretirer', { ...glob('glob', G3), ...glob('globdecl', D3), ...glob('globecrit', { ...G3, title: 'w' }) }]
        ] as const
        for (const variante of VARIANTES.ssr) {
          const o = await charger(browser, serveur!, SERVEUR, variante)
          try {
            for (const [clic, attendu] of etapes) {
              if (clic) await cliquer(o.page, SERVEUR, clic)
              await attendre(o.page, SERVEUR, attendu)
              assert.deepEqual(await lireAttendu(o.page, SERVEUR, attendu), attendu, `${variante}, ${clic ? 'après le clic ' + clic : 'reprise'} ; la page dit : ${[...o.erreurs, ...o.avis].join(' / ')}`)
            }
            assert.deepEqual(graves(o), [], variante)
          }
          finally {
            await o.fermer()
          }
        }
      })
    })
  }
})
