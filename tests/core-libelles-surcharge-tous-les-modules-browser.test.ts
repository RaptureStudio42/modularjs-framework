// Libellés des modules cœur surchargés par le projet (`mjs.core.<clé>` dans les textes racine), page sans rendu serveur : à une bascule vers
// l'anglais, le fichier anglais arrive APRÈS le dessin. Chaque module cœur à libellés (code, nombre, jauge, progression, bouton rotatif, liste,
// carrousel, menu, couleur, éditeur et sa barre, horloge, graphique) et le miroir d'un module (`µclone …, mirror: true`) se redessinent à
// l'arrivée du fichier : partout où ils montraient le libellé anglais du framework, en texte comme en attribut (`aria-label`, `placeholder`,
// `title`), ils montrent la surcharge du projet. Avant, seuls le graphique, l'horloge, la barre d'outils et la liste triable le
// faisaient : les autres lisent leurs libellés dans une valeur dérivée
// (`$labelText = $label ?? tr(…, µlang)`), calculée hors du rendu, et rien ne les redessinait. Un projet SANS surcharge `mjs.core.*` :
// l'arrivée du fichier ne redessine aucun module (le libellé du framework lu pendant l'attente est déjà le bon). Le repère du dérivé en
// calcul ne reste jamais posé, même quand un dérivé lève. Chromium, Firefox et WebKit réels, développement et production (ces deux derniers
// points en développement seulement : ils lisent des noms internes que la production raccourcit).

import assert from 'node:assert/strict'
import { RUNTIME_LABELS, CORE_LABEL_MODULES } from '../src/runtime-labels.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, type Moteur, type Page } from './helpers/graine-page.js'

const HOME = `<script>
  basculer = -> µlang = 'en'
  jauge    = null
  boite    = null

  µmount ->
    boite.appendChild(µclone jauge, mirror: true)
</script>
<button class="en" @click={basculer()}>EN</button>
<@@code class="code"><pre>x = 1</pre></@@code>
<@@number class="number" value="3" big></@@number>
<@@gauge class="gauge" value="40" @this=!{jauge}></@@gauge>
<@@progress class="progress" value="40"></@@progress>
<@@knob class="knob" value="40"></@@knob>
<@@select class="select"><@@option value="1">Un</@@option></@@select>
<@@carousel class="carousel"><div>a</div><div>b</div></@@carousel>
<@@menu class="menu"><a href="#a">a</a><a href="#b">b</a></@@menu>
<@@color class="color" value="#ff0000" editable></@@color>
<@@editor class="editor"></@@editor>
<@@clock class="clock"></@@clock>
<@@chart class="chart" rows={[]}></@@chart>
<div class="boite" @this=!{boite}></div>
`

// cinq nombres, projet sans aucune surcharge `mjs.core.*`
const SANS_SURCHARGE = `<script>
  basculer = -> µlang = 'en'

  µmount ->
    window.__basculer = basculer
</script>
` + [0, 1, 2, 3, 4].map((i) => `<@@number class="n${i}" value="${i}"></@@number>`).join('\n') + '\n'

// un dérivé qui lève dès que `$n` passe à 1, lu par une fonction qui rattrape l'erreur
const CALCUL = `<script>
  $n   = 0
  boom = -> throw new Error('boom')
  $bad = if $n > 0 then boom() else 1

  lire = ->
    try
      $bad
    catch
      'levé'

  µmount ->
    window.__mu     = µ
    window.__calcul = { lire: lire, poser: (v)-> $n = v }
</script>
<p>calcul</p>
`

// les modules de la page et les clés qu'ils montrent ; l'éditeur porte aussi celles de sa barre d'outils, le miroir celles de la jauge
const MODULES: Record<string, string[]> = {
  code: CORE_LABEL_MODULES.code, number: CORE_LABEL_MODULES.number, gauge: CORE_LABEL_MODULES.gauge, progress: CORE_LABEL_MODULES.progress,
  knob: CORE_LABEL_MODULES.knob, select: CORE_LABEL_MODULES.select, carousel: CORE_LABEL_MODULES.carousel, menu: CORE_LABEL_MODULES.menu,
  color: CORE_LABEL_MODULES.color, editor: [...CORE_LABEL_MODULES.editor, ...CORE_LABEL_MODULES.toolbar], clock: CORE_LABEL_MODULES.clock,
  chart: CORE_LABEL_MODULES.chart, miroir: CORE_LABEL_MODULES.gauge
}

// une surcharge par clé du cœur, un repère qui ne contient aucun libellé du framework
const CLES      = Object.keys((RUNTIME_LABELS as any).en.core)
const SURCHARGE = Object.fromEntries(CLES.map((k, i) => [k, 'PROJET-' + String(i).padStart(3, '0')]))
const RACINE    = { en: { mjs: { core: SURCHARGE } } }

// le libellé anglais du framework tel qu'il s'affiche : la partie avant `{n}` ; trop court pour se reconnaître (« : »), il n'est pas cherché
const montre = (k: string) => {
  const brut = String((RUNTIME_LABELS as any).en.core[k] ?? '').split('{')[0].trim()
  return brut.length >= 3 ? brut : ''
}

// les textes de chaque module, ombres imbriquées comprises : ses nœuds texte (hors `<style>` et `<script>`) et les valeurs de ses attributs ;
// le miroir, posé dans `.boite`, sous son propre nom
const LIRE = `(() => {
  const textes = (racine) => {
    const vus = []
    const visiter = (n) => {
      if (n.nodeType === 3) { if (!['STYLE', 'SCRIPT'].includes(n.parentNode && n.parentNode.nodeName)) vus.push(n.nodeValue); return }
      if (n.nodeType === 1) {
        for (const a of n.attributes) vus.push(a.value)
        if (n._shadow) visiter(n._shadow)
      }
      for (const c of n.childNodes) visiter(c)
    }
    visiter(racine)
    return vus
  }
  const h   = document.querySelector('mjs-home')._shadow
  const out = {}
  for (const el of h.querySelectorAll('[class]')) if (el._shadow && !el.closest('.boite')) out[el.getAttribute('class').split(' ')[0]] = textes(el._shadow)
  const miroir = h.querySelector('.boite > *')
  if (miroir && miroir._shadow) out.miroir = textes(miroir._shadow)
  return out
})()`

describe('libellés du cœur : la surcharge du projet arrivée après le dessin se voit sur TOUS les modules à libellés (Chromium, Firefox, WebKit)', function () {
  this.timeout(600000)
  const navigateurs: Partial<Record<Moteur, any>> = {}

  before(async function () {
    for (const m of MOTEURS) navigateurs[m] = await lancer(m)
    if (!navigateurs.chromium) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
  })

  after(async function () {
    for (const m of MOTEURS) if (navigateurs[m]) await navigateurs[m].close()
    await terminateSharedWorkerPool()
  })

  // une page de la construction, dans un contexte neuf ; ses erreurs relevées
  const ouvrir = async (m: Moteur, page: Page) => {
    const ctx     = await navigateurs[m].newContext()
    const p       = await ctx.newPage()
    const erreurs: string[] = []
    p.on('pageerror', (e: any) => erreurs.push(String(e)))
    await p.goto(page.base + '/', { waitUntil: 'load' })
    return { ctx, p, erreurs }
  }

  for (const env of ['dev', 'prod'] as const) {
    describe(`sans rendu serveur (${env})`, function () {
      const pages: Record<string, Page> = {}

      before(async function () {
        pages.home = await construire({ nom: 'surcharge-tous-modules-' + env, composants: { home: HOME }, env, sansRendu: true, racine: RACINE })
        if (env === 'dev') {
          pages.sans   = await construire({ nom: 'surcharge-sans-' + env, composants: { home: SANS_SURCHARGE }, env, sansRendu: true })
          pages.calcul = await construire({ nom: 'surcharge-calcul-' + env, composants: { home: CALCUL }, env, sansRendu: true })
        }
      })

      after(async function () {
        for (const page of Object.values(pages)) await page.fermer()
      })

      for (const m of MOTEURS) {
        it(`${m} : bascule vers l'anglais, fichier anglais retardé — chaque libellé montré en anglais devient la surcharge, miroir compris`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.home.poser({ racineEn: 1500 })
          const { ctx, p, erreurs } = await ouvrir(m, pages.home)
          try {
            await p.waitForTimeout(900)
            await p.evaluate(() => { (document.querySelector('mjs-home') as any)._shadow.querySelector('button.en').click() })
            await p.waitForTimeout(500)
            const avant = await p.evaluate(LIRE) as Record<string, string[]>
            await p.waitForTimeout(2200)
            const apres = await p.evaluate(LIRE) as Record<string, string[]>
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
            const fautes: string[] = []
            for (const [mod, cles] of Object.entries(MODULES)) {
              const a = avant[mod], b = apres[mod]
              if (!a || !b) { fautes.push(`${mod} : module absent`); continue }
              const contient = (vus: string[], t: string) => !!t && vus.some((v) => v.includes(t))
              const anglais  = cles.filter((k) => contient(a, montre(k)))
              if (!anglais.length) { fautes.push(`${mod} : aucun libellé anglais du framework avant l'arrivée du fichier`); continue }
              for (const k of anglais) {
                if (!contient(b, SURCHARGE[k])) fautes.push(`${mod} · ${k} : la surcharge ne paraît pas`)
                if (contient(b, montre(k))) fautes.push(`${mod} · ${k} : « ${montre(k)} » reste`)
              }
            }
            assert.deepEqual(fautes, [])
          } finally {
            await ctx.close()
          }
        })

        if (env === 'dev') {
          it(`${m} : projet sans surcharge — l'arrivée du fichier anglais ne redessine aucun module du cœur`, async function () {
            if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
            pages.sans.poser({ racineEn: 1500 })
            const { ctx, p, erreurs } = await ouvrir(m, pages.sans)
            // compte les redessins complets demandés aux modules du cœur, à partir d'ici
            const compte = () => p.evaluate(() => (window as any).__complets)
            try {
              await p.waitForTimeout(900)
              await p.evaluate(() => {
                const w = window as any
                let proto = Object.getPrototypeOf(document.querySelector('mjs-home'))
                while (proto && !Object.prototype.hasOwnProperty.call(proto, '_mjs_invalidate')) proto = Object.getPrototypeOf(proto)
                const orig = proto._mjs_invalidate
                w.__complets = 0
                proto._mjs_invalidate = function (k: string) {
                  if (k === '_awaits_' && this.localName.startsWith('mjs-core-')) w.__complets++
                  return orig.call(this, k)
                }
                w.__basculer()
              })
              await p.waitForTimeout(600)
              const avant = await compte()
              await p.waitForTimeout(2400)
              const apres = await compte()
              assert.equal(apres - avant, 0, `redessins complets à l'arrivée du fichier : ${apres - avant}`)
              // témoin : un redessin complet demandé à la main est bien compté
              await p.evaluate(() => { (document.querySelector('mjs-home') as any)._shadow.querySelector('.n0')._mjs_invalidate('_awaits_') })
              assert.equal(await compte(), apres + 1, 'le compteur voit les redessins complets')
              assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
            } finally {
              await ctx.close()
            }
          })

          it(`${m} : le repère du dérivé en calcul ne reste pas posé, ni au repos ni après un dérivé qui lève`, async function () {
            if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
            pages.calcul.poser({})
            const { ctx, p, erreurs } = await ouvrir(m, pages.calcul)
            const repere = () => p.evaluate(() => String((window as any).__mu._mjs_computing))
            try {
              await p.waitForTimeout(600)
              assert.equal(await p.evaluate(() => (window as any).__calcul.lire()), 1)
              assert.equal(await repere(), 'undefined', 'au repos, après un dérivé lu')
              await p.evaluate(() => (window as any).__calcul.poser(1))
              assert.equal(await p.evaluate(() => (window as any).__calcul.lire()), 'levé')
              assert.equal(await repere(), 'undefined', 'après un dérivé qui lève')
              assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
            } finally {
              await ctx.close()
            }
          })
        }
      }
    })
  }
})
