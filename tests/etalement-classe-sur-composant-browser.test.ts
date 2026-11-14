// La clé `class` d'une donnée étalée (`{...$x}`) sur la balise d'un composant suit la règle de `class={…}` : la classe se pose sur la balise,
// sauf quand le composant déclare lui-même une prop `class`, qui la reçoit alors sans rien sur la balise. Les autres clés sont des props ;
// comme écrits en clair, `title` va en plus sur la balise (sauf quand le composant déclare `$title`) et `data-x` toujours, `titre` jamais.
// Navigateurs réels (Chromium, Firefox, WebKit), en développement, en développement minifié et en production.
// Chaque balise `[data-t]` est lue après chaque changement : objet changé, clé retirée (la classe posée par l'étalement part, celle écrite en
// dur reste), classe écrite mêlée (`class="fixe {$c}"`) ou calculée (`class={$c}`) sur la même balise (chaque part garde la sienne, quel
// que soit l'ordre des changements), classe étalée qui reprend un jeton de la classe en dur, bascule `:class{$on}="vif"` sur la même balise,
// deux étalements qui posent `class` (le dernier gagne, même quand le premier change), lignes d'un `{for}`, branche d'un `{await}`, composant
// défini après le premier rendu du parent (définition retardée, comme un module chargé plus tard), qu'il déclare `$class` ou non ; balise
// tierce définie après plusieurs changements de l'objet (une seule attente de sa définition, qui pose l'état du moment, puis la classe suit).
// `<@module $comp class="fixe" {...$x}>`, à la racine et dans un `{for}` : la classe étalée s'ajoute à la classe écrite en dur, qui reste,
// et le suit quand `$comp` passe à un composant qui déclare `$class` (sur `<@module>`, la classe est un attribut de la balise seulement) ;
// les clés hors classe (`title`, `data-x`) vont elles aussi au composant vivant, dans un `{for}` comme à la racine, et le suivent quand
// `$comp` change : une clé qui quitte l'objet quitte la balise du composant neuf.
// Rendu serveur : la classe étalée est dans le HTML du serveur, avec la classe en dur, la classe mêlée et la bascule, et reste à la reprise ;
// le composant qui déclare `$class` n'en a pas, au serveur comme après ; le `title` étalé est sur la balise du composant qui ne déclare pas
// `$title`, et seulement sur elle ; sur `<@module>`, la classe étalée et la classe en dur sont toutes deux dans le HTML du serveur.

import assert from 'node:assert/strict'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'
import { construire, charger, graves, VARIANTES, type Cible } from './helpers/liaison-navigateur.js'
import { construireMinifie } from './helpers/developpement-minifie.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const BALISE  = 'mjs-et-classe'
const SOURCES: Record<string, string> = {
  'et-classe.mjs': `<script>
$x    = {class: 'a', titre: 'T', title: 't1', 'data-x': 'd1'}
$c    = 'm1'
$w    = {class: 'fixe vive'}
$on   = true
$y    = {class: 'y1'}
$z    = {class: 'z1'}
$rows = [1, 2]
$p    = Promise.resolve(1)
$comp = 'c-enfant'
@changer  = -> $x = {class: 'b', titre: 'U', title: 't2', 'data-x': 'd2'}
@retirer  = -> $x = {titre: 'V'}
@calculer = -> $c = 'm2'
@chev     = -> $w = {class: 'vive'}
@chevVide = -> $w = {}
@haut     = -> $y = {class: 'y2'}
@bas      = -> $z = {}
@autre    = -> $comp = 'c-decl'
</script>
<@c-enfant data-t="simple" {...$x}></@c-enfant>
<@c-decl data-t="decl" {...$x}></@c-decl>
<@c-enfant data-t="fixe" class="fixe" title="tf" {...$x}></@c-enfant>
<@c-enfant data-t="bascule" :class{$on}="vif" {...$x}></@c-enfant>
<@c-enfant data-t="mele" class="fixe {$c}" {...$x}></@c-enfant>
<@c-enfant data-t="calc" class={$c} {...$x}></@c-enfant>
<@c-enfant data-t="chevauche" class="fixe" {...$w}></@c-enfant>
<@c-enfant data-t="deux" {...$y} {...$z}></@c-enfant>
<ul>{for r in $rows by r}<@c-enfant data-t="ligne" {...$x}></@c-enfant>{end}</ul>
{await $p}<i>attente</i>{success v}<@c-enfant data-t="attente" {...$x}></@c-enfant>{end}
<@c-tard data-t="tard" {...$x}></@c-tard>
<@c-tard-decl data-t="tarddecl" {...$x}></@c-tard-decl>
<x-tardif data-t="tardif" class="fixe" {...$x}></x-tardif>
<@module $comp data-t="mod" class="fixe" {...$x}></@module>
<ol>{for r in $rows by r}<@module $comp data-t="modligne" class="fixe" {...$x}></@module>{end}</ol>
<button class="change" @click={@changer()}>c</button>
<button class="retire" @click={@retirer()}>r</button>
<button class="calc" @click={@calculer()}>m</button>
<button class="chev" @click={@chev()}>v</button>
<button class="chevvide" @click={@chevVide()}>w</button>
<button class="on" @click={$on = !$on}>o</button>
<button class="haut" @click={@haut()}>h</button>
<button class="bas" @click={@bas()}>b</button>
<button class="comp" @click={@autre()}>k</button>
`,
  'c-enfant.mjs': `<script>
$titre = ''
</script>
<i class="t">{$titre}</i>
`,
  'c-decl.mjs': `<script>
$class = ''
$titre = ''
$title = ''
</script>
<i class="lu">{$class}</i>
`,
  'c-tard.mjs': `<script>
$titre = ''
</script>
<i class="t">{$titre}</i>
`,
  'c-tard-decl.mjs': `<script>
$class = ''
</script>
<i class="lu">{$class}</i>
`
}

// les composants `c-tard…` sont définis 300 ms après les autres, donc après le premier rendu du parent (script posé avant le framework) ;
// chaque attente d'une définition (`customElements.whenDefined`) est comptée par balise dans `window.__attentes`
const RETARD   = '{ const d = customElements.define.bind(customElements); customElements.define = (n, c, o) => /^mjs-c-tard/.test(n) ? setTimeout(() => customElements.get(n) || d(n, c, o), 300) : d(n, c, o); const w = customElements.whenDefined.bind(customElements); window.__attentes = {}; customElements.whenDefined = (n) => { window.__attentes[n] = (window.__attentes[n] || 0) + 1; return w(n) } }'
const retarder = (c: Cible): Cible => ({ ...c, document: (b, v) => c.document(b, v).replace('<head><meta charset="utf-8">', `<head><meta charset="utf-8"><script>${RETARD}</script>`) })

// rendu serveur : classe en dur, bascule et étalement sur la même balise ; classe mêlée et étalement ; un composant qui déclare `$class` ;
// le témoin écrit en clair
const SOURCES_SSR: Record<string, string> = {
  'et-serveur.mjs': `<script>
$x  = {class: 'a', title: 't1'}
$c  = 'm1'
$on = true
$comp = 'c-enfant'
@changer = -> $x = {class: 'b'}
</script>
<@c-enfant data-t="srv" class="fixe" :class{$on}="vif" {...$x}></@c-enfant>
<@c-enfant data-t="srvmele" class="fixe {$c}" {...$x}></@c-enfant>
<@c-decl data-t="srvdecl" {...$x}></@c-decl>
<@c-enfant data-t="clair" class={$x.class}></@c-enfant>
<@module $comp data-t="srvmod" class="fixe" {...$x}></@module>
<button class="change" @click={@changer()}>c</button>
`,
  'c-enfant.mjs': SOURCES['c-enfant.mjs'],
  'c-decl.mjs': SOURCES['c-decl.mjs']
}
const SERVEUR = 'mjs-et-serveur'

// chaque balise `[data-t]` de l'ombre : ses classes triées (l'ordre des jetons ne compte pas) sous son nom, ses attributs `title` et
// `data-x` sous `<nom>@`, les lignes d'un `{for}` jointes par « | » ; `decl:prop` la prop `$class` que reçoit le composant qui la déclare,
// `simple:titre` la prop `$titre` (contre-cas), `titre sur une balise` dit si la clé `titre`, qui n'est pas un attribut, est arrivée sur une balise
// de composant (sur `<@module>`, la donnée étalée donne des attributs : ses balises `mod…` n'y comptent pas) ; `mod:balise` la balise que monte
// `<@module>`, `tardif:attentes` le nombre d'attentes de la définition de la balise tierce
const lire = (balise: string) => `(() => {
  const h  = document.querySelector('${balise}')
  const sh = h && (h._shadow || h.shadowRoot)
  if (!sh) return null
  const lu    = {}
  const mettre = (k, v) => { lu[k] = (k in lu ? lu[k] + '|' : '') + v }
  const ombre  = (t, sel) => { const n = sh.querySelector('[data-t="' + t + '"]'), s = n && (n._shadow || n.shadowRoot), e = s && s.querySelector(sel); return e ? e.textContent : '?' }
  for (const n of sh.querySelectorAll('[data-t]')) {
    mettre(n.dataset.t, [...n.classList].sort().join(' '))
    mettre(n.dataset.t + '@', 'title=' + (n.getAttribute('title') ?? '-') + ' data-x=' + (n.getAttribute('data-x') ?? '-'))
  }
  lu['decl:prop']            = ombre('decl', '.lu')
  lu['simple:titre']         = ombre('simple', '.t')
  lu['titre sur une balise'] = String([...sh.querySelectorAll('[data-t]')].some((n) => !/^mod/.test(n.dataset.t) && n.hasAttribute('titre')))
  lu['mod:balise']           = sh.querySelector('[data-t="mod"]')?.localName ?? '-'
  lu['tardif:attentes']      = String((window.__attentes || {})['x-tardif'] || 0)
  return lu
})()`

// la lecture réduite aux clés attendues
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

const T0 = 'title=- data-x=-'
const TF = 'title=tf data-x=-'
const E1 = 'title=t1 data-x=d1'
const E2 = 'title=t2 data-x=d2'
const D1 = 'title=- data-x=d1'
const D2 = 'title=- data-x=d2'

// la balise tierce `x-tardif` n'est définie qu'à l'étape `definir`, après trois changements de l'objet
const DEFINIR = "customElements.define('x-tardif', class extends HTMLElement {})"

const ETAPES: { clic: string | null, definir?: boolean, attendu: Record<string, string> }[] = [
  { clic: null, attendu: { 'mod@': E1, 'modligne@': E1 + '|' + E1, simple: 'a', 'simple@': E1, decl: '', 'decl@': D1, 'decl:prop': 'a', fixe: 'a fixe', 'fixe@': 'title=tf data-x=d1', bascule: 'a vif', mele: 'a fixe m1', calc: 'a m1', chevauche: 'fixe vive', deux: 'z1', ligne: 'a|a', attente: 'a', 'attente@': E1, tard: 'a', 'tard@': E1, tarddecl: '', 'tarddecl@': E1, 'simple:titre': 'T', 'titre sur une balise': 'false', tardif: 'fixe', 'tardif:attentes': '1', mod: 'a fixe', 'mod:balise': 'mjs-c-enfant', modligne: 'a fixe|a fixe' } },
  { clic: '.change', attendu: { 'mod@': E2, 'modligne@': E2 + '|' + E2, simple: 'b', 'simple@': E2, decl: '', 'decl@': D2, 'decl:prop': 'b', fixe: 'b fixe', 'fixe@': 'title=tf data-x=d2', bascule: 'b vif', mele: 'b fixe m1', calc: 'b m1', ligne: 'b|b', attente: 'b', tard: 'b', 'tard@': E2, tarddecl: '', 'tarddecl@': E2, 'simple:titre': 'U', 'titre sur une balise': 'false', tardif: 'fixe', mod: 'b fixe', modligne: 'b fixe|b fixe' } },
  { clic: '.on', attendu: { simple: 'b', fixe: 'b fixe', bascule: 'b', mele: 'b fixe m1', ligne: 'b|b' } },
  { clic: '.calc', attendu: { simple: 'b', mele: 'b fixe m2', calc: 'b m2' } },
  { clic: '.retire', attendu: { 'mod@': T0, 'modligne@': T0 + '|' + T0, simple: '', 'simple@': T0, decl: '', 'decl@': T0, fixe: 'fixe', 'fixe@': TF, bascule: '', mele: 'fixe m2', calc: 'm2', ligne: '|', attente: '', 'attente@': T0, tard: '', 'tard@': T0, tarddecl: '', 'tarddecl@': T0, 'simple:titre': 'V', 'titre sur une balise': 'false', tardif: 'fixe', mod: 'fixe', modligne: 'fixe|fixe' } },
  { clic: '.on', attendu: { simple: '', fixe: 'fixe', bascule: 'vif' } },
  { clic: '.change', attendu: { 'mod@': E2, 'modligne@': E2 + '|' + E2, simple: 'b', 'simple@': E2, decl: '', fixe: 'b fixe', 'fixe@': 'title=tf data-x=d2', bascule: 'b vif', mele: 'b fixe m2', calc: 'b m2', ligne: 'b|b', attente: 'b', tard: 'b', tarddecl: '', tardif: 'fixe', 'tardif:attentes': '1', mod: 'b fixe', modligne: 'b fixe|b fixe' } },
  { clic: '.haut', attendu: { deux: 'z1' } },
  { clic: '.bas', attendu: { deux: 'y2' } },
  { clic: '.chev', attendu: { chevauche: 'fixe vive' } },
  { clic: '.chevvide', attendu: { chevauche: 'fixe' } },
  { clic: null, definir: true, attendu: { tardif: 'b fixe', 'tardif:attentes': '1' } },
  { clic: '.comp', attendu: { 'mod@': E2, 'modligne@': E2 + '|' + E2, 'mod:balise': 'mjs-c-decl', mod: 'b fixe', modligne: 'b fixe|b fixe' } },
  { clic: '.retire', attendu: { 'mod@': T0, 'modligne@': T0 + '|' + T0, 'mod:balise': 'mjs-c-decl', mod: 'fixe', modligne: 'fixe|fixe', tardif: 'fixe', 'tardif:attentes': '2', simple: '' } },
  { clic: '.change', attendu: { 'mod@': E2, 'modligne@': E2 + '|' + E2, 'mod:balise': 'mjs-c-decl', mod: 'b fixe', modligne: 'b fixe|b fixe', tardif: 'b fixe', 'tardif:attentes': '3', simple: 'b' } }
]

// la valeur de l'attribut `nom` que le HTML du serveur pose sur la balise de composant `[data-t="t"]` (classes triées) ; « - » s'il n'y est
// pas, « (balise absente) » si le serveur ne l'a pas rendue
const attrServeur = (html: string, t: string, nom: string): string => {
  for (const m of html.matchAll(/<mjs-c-[a-z-]+\b([^>]*)>/g)) {
    if (!new RegExp(`data-t=(["'])${t}\\1`).test(m[1])) continue
    const c = new RegExp(`(?:^|\\s)${nom}=(["'])(.*?)\\1`).exec(m[1])
    if (!c) return '-'
    return nom === 'class' ? c[2].split(/\s+/).filter(Boolean).sort().join(' ') : c[2]
  }
  return '(balise absente)'
}

describe('clé `class` étalée sur la balise d\'un composant : la règle de `class={…}`, navigateurs réels, développement et production', function () {
  this.timeout(240000)
  const cibles: Record<string, Cible> = {}
  let serveur: Cible | null = null

  before(async function () {
    this.timeout(300000)
    cibles['développement']         = retarder(await construire('dev-parents-avant', SOURCES, [BALISE]))
    cibles['développement minifié'] = retarder(await construireMinifie('etalement-classe-minifie', SOURCES))
    cibles['production']            = retarder(await construire('bundle', SOURCES, [BALISE]))
    serveur                         = await construire('ssr', SOURCES_SSR, [SERVEUR])
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('le retard de définition est bien posé dans chaque page', () => {
    for (const [mode, cible] of Object.entries(cibles)) assert.ok(cible.document(BALISE, '').includes(RETARD), `${mode} : script de retard absent de la page`)
  })

  it('rendu serveur : la classe étalée est dans le HTML du serveur, avec la classe en dur, la classe mêlée et la bascule ; rien sur le composant qui déclare `$class`, le `title` étalé sur la balise qui ne le déclare pas', () => {
    for (const variante of VARIANTES.ssr) {
      const html = serveur!.document(SERVEUR, variante)
      const lu   = { clair: attrServeur(html, 'clair', 'class'), srv: attrServeur(html, 'srv', 'class'), 'srv@': attrServeur(html, 'srv', 'title'), srvmele: attrServeur(html, 'srvmele', 'class'), srvdecl: attrServeur(html, 'srvdecl', 'class'), 'srvdecl@': attrServeur(html, 'srvdecl', 'title'), srvmod: attrServeur(html, 'srvmod', 'class') }
      assert.deepEqual(lu, { clair: 'a', srv: 'a fixe vif', 'srv@': 't1', srvmele: 'a fixe m1', srvdecl: '-', 'srvdecl@': '-', srvmod: 'a fixe' }, `${variante} : HTML du serveur`)
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

      for (const mode of ['développement', 'développement minifié', 'production']) {
        it(`${mode} : la classe étalée est sur la balise (en prop seulement si le composant déclare \`$class\`), chaque part de la classe garde la sienne`, async function () {
          const o = await charger(browser, cibles[mode], BALISE)
          try {
            for (const etape of ETAPES) {
              if (etape.clic) await cliquer(o.page, BALISE, etape.clic)
              if (etape.definir) await o.page.evaluate(DEFINIR)
              await attendre(o.page, BALISE, etape.attendu)
              assert.deepEqual(await lireAttendu(o.page, BALISE, etape.attendu), etape.attendu, `${mode}, ${etape.clic ? 'après le clic ' + etape.clic : etape.definir ? 'après la définition de x-tardif' : 'premier rendu'} ; la page dit : ${[...o.erreurs, ...o.avis].join(' / ')}`)
            }
            assert.deepEqual(graves(o), [])
          }
          finally {
            await o.fermer()
          }
        })
      }

      it('rendu serveur : la classe étalée reste à la reprise et suit l\'objet ensuite', async function () {
        const etapes = [
          [null, { srv: 'a fixe vif', 'srv@': 'title=t1 data-x=-', srvmele: 'a fixe m1', srvdecl: '', 'srvdecl@': T0, clair: 'a', srvmod: 'a fixe' }],
          ['.change', { srv: 'b fixe vif', 'srv@': T0, srvmele: 'b fixe m1', srvdecl: '', clair: 'b', srvmod: 'b fixe' }]
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
