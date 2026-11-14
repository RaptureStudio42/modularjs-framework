// Ce que ce test garantit : un composant monté par `<@module $comp …>` reçoit ses attributs globaux calculés comme un composant écrit
// en dur — `title`, `hidden`, `lang`, `slot` (et `role`, `tabindex`, `dir`) se posent sur SA balise en plus de la prop : `hidden={…}`
// le cache, `title={…}` lui donne sa bulle.
// - au montage, puis quand la variable change : la valeur suit, `null`, `undefined` et `false` retirent l'attribut, `hidden` est un
//   booléen (une valeur fausse ou vide le retire), une chaîne vide reste un attribut vide — chaque étape comparée au composant écrit en dur ;
// - construction de développement, composants montés dans happy-dom (la production et le chargement à la demande, dans les vrais
//   navigateurs : module-dynamique-attributs-globaux-browser.test.ts) ;
// - un composant qui déclare lui-même une prop de ce nom (`$title`, `$hidden`) la garde pour lui, sans attribut sur sa balise, et le
//   remplacement d'un composant par un autre suit la règle du composant neuf ;
// - dans une ligne de `{for}` et dans un `{if}`.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterModule, pause } from './helpers/module-dynamique.js'

const CE    = '<script>\n  $titre = \'\'\n</script>\n<p class="v">E:{$titre}</p>\n'
const FICHE = '<script>\n  $title  = \'\'\n  $hidden = []\n</script>\n<p class="f">{$title}|{JSON.stringify($hidden)}</p>\n'

const GLOBALES = 'title={$t} hidden={$cache} lang={$t} slot={$t} role={$t} dir={$t} tabindex={$t}'

const hote = (balise: string) => `<script>
  $comp   = 'mjs-ce'
  $t      = 'T'
  $cache  = false
  $series = ['x']
  @poser = (t, c) ->
    $t     = t
    $cache = c
  @choisir = (c) ->
    $comp = c
</script>
${balise}
`

// les attributs de la balise, triés, en chaînes (jamais un nœud)
const attributs = (el: any): string[] => [...el.attributes].map((a: any) => a.name + '=' + a.value).sort()

describe('<@module> — les attributs globaux calculés se posent sur la balise du composant, comme écrits en dur', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('au montage, au changement et au retrait, la balise porte les mêmes attributs que le composant écrit en dur', async () => {
    const dur = await monterModule({ hote: hote(`<mjs-ce ${GLOBALES}></mjs-ce>`), ce: CE })
    const mod = await monterModule({ hote: hote(`<@module $comp ${GLOBALES}></@module>`), ce: CE })
    const vu  = (m: any) => attributs(m.hote._shadow.querySelector('mjs-ce'))
    const ETAPES: [any, any, string[] | null][] = [
      ['U', true, ['dir=U', 'hidden=', 'lang=U', 'role=U', 'slot=U', 'tabindex=U', 'title=U']],
      [null, false, []],
      ['V', 'H', ['dir=V', 'hidden=', 'lang=V', 'role=V', 'slot=V', 'tabindex=V', 'title=V']],
      ['', '', null],
      [undefined, 0, []],
      ['W', null, ['dir=W', 'lang=W', 'role=W', 'slot=W', 'tabindex=W', 'title=W']]
    ]
    assert.deepEqual(vu(mod), ['dir=T', 'lang=T', 'role=T', 'slot=T', 'tabindex=T', 'title=T'], 'au montage')
    assert.deepEqual(vu(mod), vu(dur), 'au montage, comme écrit en dur')
    for (const [t, c, attendu] of ETAPES) {
      dur.hote.poser(t, c)
      mod.hote.poser(t, c)
      await pause(60)
      const etape = `t=${JSON.stringify(t)} cache=${JSON.stringify(c)}`
      if (attendu) assert.deepEqual(vu(mod), attendu, etape)
      assert.deepEqual(vu(mod), vu(dur), `${etape}, comme écrit en dur`)
    }
    assert.equal(mod.hote._shadow.querySelector('mjs-ce')._state.titre, '', 'le composant garde son état')
    assert.deepEqual(mod.erreurs(), [])
  })

  it('un composant qui déclare la prop la garde pour lui : sans attribut sur sa balise, valeur reçue en prop, comme écrit en dur', async () => {
    const vu = (m: any) => {
      const el = m.hote._shadow.querySelector('mjs-fiche')
      return { attributs: attributs(el), title: el._state.title, hidden: JSON.stringify(el._state.hidden) }
    }
    const dur = await monterModule({ hote: hote('<mjs-fiche title={$t} hidden={$series}></mjs-fiche>'), fiche: FICHE })
    const mod = await monterModule({ hote: hote('<@module \'mjs-fiche\' title={$t} hidden={$series}></@module>'), fiche: FICHE })
    assert.deepEqual(vu(mod), { attributs: [], title: 'T', hidden: '["x"]' })
    assert.deepEqual(vu(mod), vu(dur))
    dur.hote.poser('U', false)
    mod.hote.poser('U', false)
    await pause(60)
    assert.deepEqual(vu(mod), { attributs: [], title: 'U', hidden: '["x"]' })
    assert.deepEqual(vu(mod), vu(dur))
    assert.deepEqual(mod.erreurs(), [])
  })

  it('changer de composant : la balise neuve suit sa propre règle, l\'attribut de l\'ancienne ne la suit pas', async () => {
    const mod  = await monterModule({ hote: hote('<@module $comp title={$t} hidden={$cache}></@module>'), ce: CE, fiche: FICHE })
    const tags = () => [...mod.hote._shadow.children].map((n: any) => n.localName + ':' + attributs(n).join(','))
    mod.hote.poser('T', true)
    await pause(60)
    assert.deepEqual(tags(), ['mjs-ce:hidden=,title=T'])
    mod.hote.choisir('mjs-fiche')
    await pause(60)
    assert.deepEqual(tags(), ['mjs-fiche:'], 'la fiche déclare `$title` et `$hidden` : ni bulle ni balise cachée')
    assert.equal(mod.hote._shadow.querySelector('mjs-fiche')._state.title, 'T')
    mod.hote.choisir('mjs-ce')
    await pause(60)
    assert.deepEqual(tags(), ['mjs-ce:hidden=,title=T'])
    assert.deepEqual(mod.erreurs(), [])
  })

  it('dans une ligne de {for} et dans un {if} : posés au montage, ils suivent la variable', async () => {
    const source = hote('{for r in [1, 2]}<@module $comp data-r={r} title={$t + r} hidden={$cache}></@module>{end}\n{if $t}<@module $comp data-r="si" title={$t} lang={$t}></@module>{end}')
    const mod    = await monterModule({ hote: source, ce: CE })
    const vu     = () => [...mod.hote._shadow.querySelectorAll('mjs-ce')].map((n: any) => attributs(n).join(','))
    assert.deepEqual(vu(), ['data-r=1,title=T1', 'data-r=2,title=T2', 'data-r=si,lang=T,title=T'])
    mod.hote.poser('U', true)
    await pause(60)
    assert.deepEqual(vu(), ['data-r=1,hidden=,title=U1', 'data-r=2,hidden=,title=U2', 'data-r=si,lang=U,title=U'])
    assert.deepEqual(mod.erreurs(), [])
  })
})
