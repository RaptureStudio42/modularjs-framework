// <@@code> montre les noms de son code dans la langue de la page : le groupe `mjs.core.code` du dictionnaire de cette langue (`panier: cart`)
// traduit chaque nom, son symbole gardé (`$panier` → `$cart`, `$$liste` → `$$list`, `@basculer` → `@toggle`, `µ.aide()` → `µ.help()`,
// `{ poids: 3 }` → `{ weight: 3 }`), dans tout le texte projeté, éditeur du tuto compris (un seul élément projeté, une ligne par <div>). Restent
// tels quels : un nom absent du dictionnaire, les textes dynamiques ({µt(…)}, {{…}}) même quand leur texte porte un nom du dictionnaire, les
// commentaires colorés et les chaînes colorées qui portent une espace ; une chaîne sans espace traduit ses noms. Les blancs d'alignement (deux
// espaces au moins) qui suivent un nom traduit s'allongent ou se raccourcissent d'autant, une espace au moins. Le retour au français (langue des
// exemples, sans ce groupe) rend le texte d'origine ; le fichier anglais arrivé après la bascule traduit aussi, comme celui d'une page ouverte en
// anglais encore en route quand le code se monte ; le bouton copie le texte montré. Une page prérendue en anglais sert les noms d'origine (le
// module ne traduit pas au serveur), que le client traduit.
// Une appli dont le dictionnaire n'a pas ce groupe ne parcourt aucun nœud du code à la bascule (compte des parcours, prouvé positif sur l'appli
// qui l'a). Colonnes : dans une ligne, la première suite d'au moins deux espaces qui suit des noms traduits rattrape l'écart, quoi qu'il y ait
// entre eux ; des lignes voisines dont un `=`, un commentaire de fin de ligne ou la valeur d'une clé commencent à la même colonne se réalignent
// ensemble, le groupe primant sur la ligne. Un texte ajouté au code après le montage se traduit aussitôt ; `translate="no"` (sur l'hôte ou sur
// un élément du code) garde son texte ; les textes dynamiques d'un {for} ou d'un {if} du code restent tels quels ; un bloc posé dans la page,
// hors de tout composant, se traduit. Les affectations composées (`||=`, `+=`, `?=`…) s'alignent comme `=` ; une valeur de clé qui commence par
// `#` reste une valeur ; en texte nu, une chaîne entre guillemets qui porte un blanc reste entière ; un blanc qui porte une tabulation reste tel
// quel. Les textes dynamiques d'un composant sans ombre (`:lightDom`) et le contenu montré d'un {await} (sa valeur y est fondue dans le texte
// de la branche) restent tels quels. La copie d'un bloc nu à plusieurs nœuds rend le texte montré, sans saut ajouté. Chromium, Firefox et
// WebKit réels, développement et production.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, type Moteur, type Page } from './helpers/graine-page.js'
import { attendreEtat, attendrePage } from './helpers/attente-page.js'

const HOME = `<script>
  $mots = ['panier']
  $mot  = 'panier'
  $voir = false
  $prom = Promise.resolve('panier')
  µmount ->
    window.__lang = (l)-> µlang = l
    window.__voir = -> $voir = true
</script>
<p class="titre">{µt('titre')}</p>
<@@code class="symboles">
  $panier = []
  $$liste.push(@basculer)
  µ.aide()
  $total = &#123; poids: 3 &#125;
  $prénom = 'x'
</@@code>
<@@code class="colore"><pre><code><span class="variable">$panier</span>   <span class="punctuation">=</span> <span class="number">0</span>   <span class="comment"># le panier</span>
<span class="variable">$qte</span>  <span class="punctuation">=</span> <span class="string">'Mon panier'</span>
<span class="variable">$x</span> <span class="punctuation">=</span> <span class="string">'retirer'</span> + <span class="string">'.panier'</span> + <span class="string">"/produit/:id"</span>
<span class="variable">$y</span> <span class="punctuation">=</span> {µt('mot')} + <span class="raw">{{µt('motHtml')}}</span></code></pre></@@code>
<@@code class="colonnes">
  $panier   = 1   # a
  $poids    = 2
  $qte  = 3
  $liste = 4
</@@code>
<@editeur><code data-file="panier.mjs">
  <div><span class="variable">$panier</span>   <span class="punctuation">=</span> <span class="number">0</span></div>
  <div><span class="function">basculer</span> <span class="punctuation">=</span> <span class="punctuation">-&gt;</span> <span class="variable">$panier</span><span class="punctuation">++</span></div>
</code></@editeur>
<@@code class="ligne">
  f($panier)   # a
  [$liste]  # b
  &#123; poids &#125; fin   # c
</@@code>
<@@code class="aligne">
  $panier = []
  $total  = 0

  $oui          = false
  $formDisabled = true

  x = 1        # a
  $panier = 2  # b

  $panier   = 1
  $qte      = 2

  poids:    3
  taille:   4
  longueur: 5
</@@code>
<@@code class="alignecolore"><pre><code><span class="variable">$panier</span> <span class="punctuation">=</span> []   <span class="comment"># a</span>
<span class="variable">$total</span>  <span class="punctuation">=</span> 0    <span class="comment"># b</span></code></pre></@@code>
<@@code class="non" translate="no">
  panier: cart
  $panier = 1
</@@code>
<@@code class="dico"><pre><code>$panier = 1
<span translate="no">panier: cart</span></code></pre></@@code>
<@@code class="dyn">$panier{for m in $mots} {m}{end}{if $mot} {$mot}{end}</@@code>
<@@code class="si">$panier{if $voir} $liste{end}</@@code>
<@@code class="compose">
  $panier ||= []
  $total  ||= 0

  $qte   += 1
  $total += 2

  $liste ?= []
  $poids -= 1
  $qte   &&= 1
  $oui   ??= 2
  x      *= 3
  y      /= 4
</@@code>
<@@code class="diese">
  $fond:    #000
  $couleur: #fff
</@@code>
<@@code class="guillemets">
  $qte = 'a  b'
  $x = "le  panier" + 'retirer'
</@@code>
<@@code class="tabs">
  $panier  \t# a
  $qte\t\t= 2
</@@code>
<@@code class="att">{await $prom}…{success v}{v} $liste{end}</@@code>
<@@code class="att2">{await $prom}…{success v}<b>{v}</b>{end}</@@code>
<@@code class="att3">{await $prom}…{success v}{v + ''}{end}</@@code>
<@@code class="copie">$panier = {$mot}</@@code>
<@carte :lightDom mot={$mot}></@carte>
`

// une page sans texte traduit (rien ne retient son premier rendu) : ouverte en anglais, son <@@code> se monte avant l'arrivée du fichier anglais
const HOME_NU = `<@@code class="symboles">
  $panier = []
  $$liste.push(@basculer)
  µ.aide()
  $total = &#123; poids: 3 &#125;
  $prénom = 'x'
</@@code>
`

// l'éditeur du tuto : ses onglets passent chacun un enfant à <@@code frameless> par un slot indexé
const EDITEUR = `<script>
  $tabs = [0]
</script>
<div class="editor">{for i, tab in $tabs}<@@code frameless class="ed"><@slot {i}></@slot></@@code>{end}</div>
`

// un composant sans ombre : ses textes dynamiques sont rangés chez lui, pas chez le composant qui porte l'ombre
const CARTE = `<script>
  $mot = ''
</script>
<@@code class="lumiere">$panier {$mot}</@@code>
`

const FR = 'mot: panier\nmotHtml: "<b>panier</b>"\n'
const EN = { mot: 'panier', motHtml: '<b>panier</b>' }
const NOMS = { panier: 'cart', liste: 'list', basculer: 'toggle', aide: 'help', poids: 'weight', retirer: 'remove', produit: 'product', qte: 'quantity', 'prénom': 'firstName', oui: 'yes', taille: 'size', fond: 'background', couleur: 'color' }

const ORIGINE = {
  symboles: ['$panier = []', '$$liste.push(@basculer)', 'µ.aide()', '$total = { poids: 3 }', '$prénom = \'x\''].join('\n'),
  colore: ['$panier   = 0   # le panier', '$qte  = \'Mon panier\'', '$x = \'retirer\' + \'.panier\' + "/produit/:id"', '$y = panier + panier'].join('\n'),
  colonnes: ['$panier   = 1   # a', '$poids    = 2', '$qte  = 3', '$liste = 4'].join('\n'),
  tuto: ['$panier   = 0', 'basculer = -> $panier++']
}
const TRADUIT = {
  symboles: ['$cart = []', '$$list.push(@toggle)', 'µ.help()', '$total = { weight: 3 }', '$firstName = \'x\''].join('\n'),
  colore: ['$cart     = 0   # le panier', '$quantity = \'Mon panier\'', '$x = \'remove\' + \'.cart\' + "/product/:id"', '$y = panier + panier'].join('\n'),
  colonnes: ['$cart     = 1   # a', '$weight   = 2', '$quantity = 3', '$list = 4'].join('\n'),
  tuto: ['$cart     = 0', 'toggle = -> $cart++']
}

// le texte de chaque bloc, les lignes de l'éditeur, le titre de la page (dit la langue de ses textes)
const LIRE = `(() => {
  const h   = document.querySelector('mjs-home')._shadow
  const out = {}
  for (const c of ['symboles', 'colore', 'colonnes']) out[c] = h.querySelector('mjs-core-code.' + c).textContent
  out.tuto  = [...h.querySelectorAll('code[data-file] > div')].map((d) => d.textContent)
  out.titre = h.querySelector('p.titre').textContent
  return out
})()`

// colonnes (`ligne` : dans une ligne ; `aligne`, `alignecolore` : par groupe de lignes, en texte nu puis coloré), `translate="no"` (sur l'hôte :
// `non` ; sur un élément du code : `dico`), textes dynamiques d'un {for} et d'un {if} (`dyn`), contenu d'un {if} ouvert après le montage (`si`),
// bloc posé dans la page hors de tout composant (`page`). Dans `aligne`, `$panier   = 1` / `$qte      = 2` : la ligne seule garderait la colonne
// de chacune (`$cart     = 1` / `$quantity  = 2`, décalées) ; le groupe prime et les aligne sur le plus long texte traduit
const ORIGINE2 = {
  ligne: ['f($panier)   # a', '[$liste]  # b', '{ poids } fin   # c'].join('\n'),
  aligne: ['$panier = []', '$total  = 0', '', '$oui          = false', '$formDisabled = true', '', 'x = 1        # a', '$panier = 2  # b', '', '$panier   = 1', '$qte      = 2', '', 'poids:    3', 'taille:   4', 'longueur: 5'].join('\n'),
  alignecolore: ['$panier = []   # a', '$total  = 0    # b'].join('\n'),
  non: ['panier: cart', '$panier = 1'].join('\n'),
  dico: ['$panier = 1', 'panier: cart'].join('\n'),
  dyn: '$panier panier panier',
  si: '$panier',
  page: '$panier = 1'
}
const TRADUIT2 = {
  ligne: ['f($cart)     # a', '[$list]   # b', '{ weight } fin  # c'].join('\n'),
  aligne: ['$cart  = []', '$total = 0', '', '$yes          = false', '$formDisabled = true', '', 'x = 1      # a', '$cart = 2  # b', '', '$cart       = 1', '$quantity   = 2', '', 'weight:   3', 'size:     4', 'longueur: 5'].join('\n'),
  alignecolore: ['$cart  = []   # a', '$total = 0    # b'].join('\n'),
  non: ORIGINE2.non,
  dico: ['$cart = 1', 'panier: cart'].join('\n'),
  dyn: '$cart panier panier',
  si: '$cart',
  page: '$cart = 1'
}
const LIRE2 = `(() => {
  const h   = document.querySelector('mjs-home')._shadow
  const out = {}
  for (const c of ['ligne', 'aligne', 'alignecolore', 'non', 'dico', 'dyn', 'si']) out[c] = h.querySelector('mjs-core-code.' + c).textContent
  out.symboles = h.querySelector('mjs-core-code.symboles').textContent
  out.page     = document.querySelector('mjs-core-code.page').textContent
  return out
})()`
// affectations composées, valeur de clé en `#`, chaînes entre guillemets en texte nu, tabulations ; composant sans ombre, contenu d'un {await}
const ORIGINE3 = {
  compose: ['$panier ||= []', '$total  ||= 0', '', '$qte   += 1', '$total += 2', '', '$liste ?= []', '$poids -= 1', '$qte   &&= 1', '$oui   ??= 2', 'x      *= 3', 'y      /= 4'].join('\n'),
  diese: ['$fond:    #000', '$couleur: #fff'].join('\n'),
  guillemets: ['$qte = \'a  b\'', '$x = "le  panier" + \'retirer\''].join('\n'),
  tabs: ['$panier  \t# a', '$qte\t\t= 2'].join('\n'),
  lumiere: '$panier panier',
  att: 'panier $liste',
  att2: 'panier',
  att3: 'panier'
}
const TRADUIT3 = {
  compose: ['$cart  ||= []', '$total ||= 0', '', '$quantity += 1', '$total    += 2', '', '$list     ?= []', '$weight   -= 1', '$quantity &&= 1', '$yes      ??= 2', 'x         *= 3', 'y         /= 4'].join('\n'),
  diese: ['$background: #000', '$color:      #fff'].join('\n'),
  guillemets: ['$quantity = \'a  b\'', '$x = "le  panier" + \'remove\''].join('\n'),
  tabs: ['$cart  \t# a', '$quantity\t\t= 2'].join('\n'),
  lumiere: '$cart panier',
  att: ORIGINE3.att,
  att2: ORIGINE3.att2,
  att3: ORIGINE3.att3
}
// chaque bloc de la page, composant sans ombre compris (son contenu est dans l'ombre de la page), par sa première classe
const LIRE3 = `(() => {
  const out = {}
  for (const c of document.querySelector('mjs-home')._shadow.querySelectorAll('mjs-core-code')) out[c.classList[0]] = c.textContent
  return out
})()`
const garder = (o: Record<string, any>, cles: string[]) => Object.fromEntries(cles.map((c) => [c, o[c]]))
// un bloc <@@code> posé dans la page même, hors de tout composant
const DANS_LA_PAGE = (page: string) => page.replace('<mjs-home></mjs-home>', '<mjs-home></mjs-home><mjs-core-code class="page">$panier = 1</mjs-core-code>')

// chaque parcours du code projeté commence par la liste des nœuds du slot de <@@code> : comptés ; le presse-papier rend ce qu'on lui donne
const SONDES = `
  window.__parcours = 0
  const lister = HTMLSlotElement.prototype.assignedNodes
  HTMLSlotElement.prototype.assignedNodes = function (...a) {
    const h = this.getRootNode().host
    if (h && h.localName === 'mjs-core-code') window.__parcours++
    return lister.apply(this, a)
  }
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copie = t; return Promise.resolve() } } })
`

describe('<@@code> : les noms du code dans la langue de la page, par le groupe mjs.core.code du dictionnaire (Chromium, Firefox, WebKit)', function () {
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

  // une page de la construction, dans un contexte neuf, sondes posées ; ses erreurs relevées ; montée
  const ouvrir = async (m: Moteur, page: Page) => {
    const ctx     = await navigateurs[m].newContext()
    const p       = await ctx.newPage()
    const erreurs: string[] = []
    p.on('pageerror', (e: any) => erreurs.push(String(e)))
    await p.addInitScript(SONDES)
    await p.goto(page.base + '/', { waitUntil: 'load' })
    await attendrePage(p, () => typeof (window as any).__lang === 'function' && !!(document.querySelector('mjs-home') as any)?._shadow?.querySelector('code[data-file] > div'), null, 'la page est montée', 3000)
    return { ctx, p, erreurs }
  }

  const lire     = async (p: any) => await p.evaluate(LIRE) as Record<string, any>
  const traduite = (o: Record<string, any>) => o.symboles === TRADUIT.symboles && o.colore === TRADUIT.colore && o.colonnes === TRADUIT.colonnes && o.tuto.join('\n') === TRADUIT.tuto.join('\n')
  const montre   = (o: Record<string, any>) => ({ symboles: o.symboles, colore: o.colore, colonnes: o.colonnes, tuto: o.tuto })

  for (const env of ['dev', 'prod'] as const) {
    describe(`sans rendu serveur (${env})`, function () {
      const pages: Record<string, Page> = {}

      before(async function () {
        pages.home = await construire({ nom: 'code-noms-' + env, composants: { home: HOME, editeur: EDITEUR, carte: CARTE }, env, sansRendu: true, html: DANS_LA_PAGE, racine: { fr: FR, en: { ...EN, mjs: { core: { code: NOMS } } } } })
        pages.sans = await construire({ nom: 'code-noms-sans-' + env, composants: { home: HOME, editeur: EDITEUR, carte: CARTE }, env, sansRendu: true, racine: { fr: FR, en: EN } })
        pages.nu   = await construire({ nom: 'code-noms-nu-' + env, composants: { home: HOME_NU }, env, sansRendu: true, racine: { fr: FR, en: { ...EN, mjs: { core: { code: NOMS } } } } })
        pages.pre  = await construire({ nom: 'code-noms-pre-' + env, composants: { home: HOME_NU }, env, locales: ['fr', 'en'], langue: 'en', racine: { fr: FR, en: { ...EN, mjs: { core: { code: NOMS } } } } })
      })

      after(async function () {
        for (const page of Object.values(pages)) await page.fermer()
      })

      for (const m of MOTEURS) {
        it(`${m} : français intact, anglais traduit (symboles, colonnes, chaînes, éditeur ; commentaire, chaîne à espaces et textes dynamiques intacts), copie du texte montré, retour au français à l'identique`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.home.poser({})
          const { ctx, p, erreurs } = await ouvrir(m, pages.home)
          try {
            const avant = await lire(p)
            assert.deepEqual(montre(avant), ORIGINE)
            await p.evaluate(() => { (window as any).__parcours = 0; (window as any).__lang('en') })
            const en = await attendreEtat(async () => { const o = await lire(p); return o.titre === 'Title' && traduite(o) ? o : null }, 'le code est traduit', 3000).catch(async () => lire(p))
            assert.deepEqual(montre(en), TRADUIT)
            assert.ok(await p.evaluate(() => (window as any).__parcours) > 0, 'le compte voit le parcours de la traduction')
            await p.evaluate(() => { ((document.querySelector('mjs-home') as any)._shadow.querySelector('mjs-core-code.symboles')._shadow.querySelector('button.copy') as HTMLElement).click() })
            const copie = await attendreEtat(() => p.evaluate(() => (window as any).__copie), 'le texte est copié', 2000)
            assert.equal(copie, TRADUIT.symboles)
            await p.evaluate(() => (window as any).__lang('fr'))
            const fr = await attendreEtat(async () => { const o = await lire(p); return o.titre === 'Titre' && o.symboles === ORIGINE.symboles ? o : null }, 'le texte d\'origine est rendu', 3000).catch(async () => lire(p))
            assert.deepEqual(montre(fr), ORIGINE)
            await p.evaluate(() => (window as any).__lang('en'))
            const encore = await attendreEtat(async () => { const o = await lire(p); return traduite(o) ? o : null }, 'le code est traduit une seconde fois', 3000).catch(async () => lire(p))
            assert.deepEqual(montre(encore), TRADUIT)
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          } finally {
            await ctx.close()
          }
        })

        it(`${m} : fichier anglais arrivé après la bascule — le code reste en français pendant l'attente, puis se traduit à l'arrivée`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.home.poser({ racineEn: 1500 })
          const { ctx, p, erreurs } = await ouvrir(m, pages.home)
          try {
            await p.evaluate(() => (window as any).__lang('en'))
            // pause gardée : la lecture pendant que le fichier anglais est en route (il arrive 1,5 s après sa demande), le cas même du test
            await p.waitForTimeout(500)
            assert.deepEqual(montre(await lire(p)), ORIGINE)
            const en = await attendreEtat(async () => { const o = await lire(p); return traduite(o) ? o : null }, 'le code est traduit à l\'arrivée du fichier', 3000).catch(async () => lire(p))
            assert.deepEqual(montre(en), TRADUIT)
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          } finally {
            await ctx.close()
          }
        })

        it(`${m} : page ouverte en anglais, fichier anglais encore en route quand le code se monte — traduit à son arrivée`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.nu.poser({ racineEn: 1500 })
          const ctx     = await navigateurs[m].newContext()
          const p       = await ctx.newPage()
          const erreurs: string[] = []
          p.on('pageerror', (e: any) => erreurs.push(String(e)))
          const code = () => p.evaluate(() => { const c = (document.querySelector('mjs-home') as any)?._shadow?.querySelector('mjs-core-code.symboles'); return { monte: !!c?._shadow?.querySelector('pre.box.block'), texte: c?.textContent } })
          try {
            // sans attendre l'événement `load` : Firefox et WebKit le retardent jusqu'à l'arrivée du fichier anglais (1,5 s après sa demande)
            await p.goto(pages.nu.base + '/?lang=en', { waitUntil: 'domcontentloaded' })
            const monte = await attendreEtat(async () => { const c = await code(); return c.monte ? c : null }, 'le code est monté', 1200)
            assert.deepEqual(monte, { monte: true, texte: ORIGINE.symboles })
            const en = await attendreEtat(async () => { const c = await code(); return c.texte === TRADUIT.symboles ? c : null }, 'le code est traduit à l\'arrivée du fichier', 3000).catch(code)
            assert.deepEqual(en, { monte: true, texte: TRADUIT.symboles })
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          } finally {
            await ctx.close()
          }
        })

        it(`${m} : page prérendue en anglais — la coquille servie montre les noms d'origine (le module ne traduit pas au serveur), le client les traduit`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.pre.poser({})
          const coquille = await (await fetch(pages.pre.base + '/')).text()
          assert.ok(coquille.includes('$panier = []') && !coquille.includes('$cart'), 'la coquille garde les noms d\'origine')
          const ctx     = await navigateurs[m].newContext()
          const p       = await ctx.newPage()
          const erreurs: string[] = []
          p.on('pageerror', (e: any) => erreurs.push(String(e)))
          try {
            await p.goto(pages.pre.base + '/', { waitUntil: 'load' })
            const texte = () => p.evaluate(() => (document.querySelector('mjs-home') as any)?._shadow?.querySelector('mjs-core-code.symboles')?.textContent)
            const en    = await attendreEtat(async () => { const t = await texte(); return t === TRADUIT.symboles ? t : null }, 'le client traduit le code prérendu', 3000).catch(texte)
            assert.equal(en, TRADUIT.symboles)
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          } finally {
            await ctx.close()
          }
        })

        it(`${m} : dictionnaire sans groupe mjs.core.code — la bascule ne parcourt aucun nœud du code, rien ne change`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.sans.poser({})
          const { ctx, p, erreurs } = await ouvrir(m, pages.sans)
          try {
            await p.evaluate(() => { (window as any).__parcours = 0; (window as any).__lang('en') })
            await attendreEtat(async () => (await lire(p)).titre === 'Title', 'la page est en anglais', 3000)
            // pause gardée : un parcours qui viendrait après l'arrivée du fichier anglais (réveil des lecteurs de libellés) serait compté
            await p.waitForTimeout(300)
            assert.equal(await p.evaluate(() => (window as any).__parcours), 0)
            assert.deepEqual(montre(await lire(p)), ORIGINE)
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          } finally {
            await ctx.close()
          }
        })

        // la page en anglais, code traduit, puis les blocs `cles` relus
        const enAnglais = async (p: any, cles: string[], lecteur = LIRE2) => {
          await p.evaluate(() => (window as any).__lang('en'))
          await attendreEtat(async () => traduite(await lire(p)) || null, 'le code est traduit', 3000).catch(() => null)
          return garder(await p.evaluate(lecteur), cles)
        }
        const enFrancais = async (p: any, cles: string[], lecteur = LIRE2) => {
          await p.evaluate(() => (window as any).__lang('fr'))
          await attendreEtat(async () => (await lire(p)).symboles === ORIGINE.symboles || null, 'le texte d\'origine est rendu', 3000).catch(() => null)
          return garder(await p.evaluate(lecteur), cles)
        }

        it(`${m} : colonnes — dans une ligne, la première suite d'au moins deux espaces après des noms traduits rattrape l'écart (derrière ), ], }, un mot) ; des lignes voisines au même =, au même commentaire, à la même valeur de clé se réalignent ensemble (le groupe prime sur la ligne), en texte nu comme coloré ; retour au français à l'identique`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.home.poser({})
          const { ctx, p, erreurs } = await ouvrir(m, pages.home)
          const cles = ['ligne', 'aligne', 'alignecolore']
          try {
            assert.deepEqual(garder(await p.evaluate(LIRE2), cles), garder(ORIGINE2, cles))
            assert.deepEqual(await enAnglais(p, cles), garder(TRADUIT2, cles))
            assert.deepEqual(await enFrancais(p, cles), garder(ORIGINE2, cles))
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          } finally {
            await ctx.close()
          }
        })

        it(`${m} : texte ajouté au code après le montage (nœud projeté neuf, contenu d'un {if} ouvert) — traduit aussitôt, sans attendre une bascule ; rendu au retour au français`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.home.poser({})
          const { ctx, p, erreurs } = await ouvrir(m, pages.home)
          const cles = ['symboles', 'si']
          try {
            assert.deepEqual(await enAnglais(p, cles), { symboles: TRADUIT.symboles, si: TRADUIT2.si })
            await p.evaluate(() => {
              (document.querySelector('mjs-home') as any)._shadow.querySelector('mjs-core-code.symboles').append('\nµ.aide($panier)');
              (window as any).__voir()
            })
            const voulu = { symboles: TRADUIT.symboles + '\nµ.help($cart)', si: '$cart $list' }
            const lu    = async () => garder(await p.evaluate(LIRE2), cles)
            const en    = await attendreEtat(async () => { const o = await lu(); return o.symboles === voulu.symboles && o.si === voulu.si ? o : null }, 'le texte ajouté est traduit', 2000).catch(lu)
            assert.deepEqual(en, voulu)
            assert.deepEqual(await enFrancais(p, cles), { symboles: ORIGINE.symboles + '\nµ.aide($panier)', si: '$panier $liste' })
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          } finally {
            await ctx.close()
          }
        })

        it(`${m} : translate="no" — sur l'hôte, le bloc entier reste tel quel ; sur un élément du code, son contenu reste tel quel, le reste se traduit`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.home.poser({})
          const { ctx, p, erreurs } = await ouvrir(m, pages.home)
          const cles = ['non', 'dico']
          try {
            assert.deepEqual(await enAnglais(p, cles), garder(TRADUIT2, cles))
            assert.deepEqual(await enFrancais(p, cles), garder(ORIGINE2, cles))
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          } finally {
            await ctx.close()
          }
        })

        it(`${m} : textes dynamiques d'un {for} et d'un {if} du code jamais traduits ; bloc posé dans la page, hors de tout composant, traduit`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.home.poser({})
          const { ctx, p, erreurs } = await ouvrir(m, pages.home)
          const cles = ['dyn', 'page']
          try {
            assert.deepEqual(garder(await p.evaluate(LIRE2), cles), garder(ORIGINE2, cles))
            assert.deepEqual(await enAnglais(p, cles), garder(TRADUIT2, cles))
            // un nœud vide ajouté au bloc relance la traduction (slotchange), la liste posée : le texte de la ligne du {for} reste le sien
            await p.evaluate(() => { (document.querySelector('mjs-home') as any)._shadow.querySelector('mjs-core-code.dyn').append('') })
            // pause gardée : la traduction relancée par l'ajout a lieu, ou n'a pas lieu, dans ce délai
            await p.waitForTimeout(300)
            assert.deepEqual(garder(await p.evaluate(LIRE2), cles), garder(TRADUIT2, cles))
            assert.deepEqual(await enFrancais(p, cles), garder(ORIGINE2, cles))
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          } finally {
            await ctx.close()
          }
        })

        it(`${m} : colonnes des affectations composées (||=, +=, ?=, -=, &&=, ??=, *=, /=) comme celles de = ; valeur de clé qui commence par # ; en texte nu, chaîne entre guillemets qui porte un blanc gardée entière ; blanc qui porte une tabulation tel quel ; retour au français à l'identique`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.home.poser({})
          const { ctx, p, erreurs } = await ouvrir(m, pages.home)
          const cles = ['compose', 'diese', 'guillemets', 'tabs']
          try {
            assert.deepEqual(garder(await p.evaluate(LIRE3), cles), garder(ORIGINE3, cles))
            assert.deepEqual(await enAnglais(p, cles, LIRE3), garder(TRADUIT3, cles))
            assert.deepEqual(await enFrancais(p, cles, LIRE3), garder(ORIGINE3, cles))
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          } finally {
            await ctx.close()
          }
        })

        it(`${m} : textes dynamiques d'un composant sans ombre et contenu montré d'un {await} ({v}, <b>{v}</b>, {v + ''}) jamais traduits ; copie d'un bloc nu à plusieurs nœuds = texte montré, sans saut ajouté`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.home.poser({})
          const { ctx, p, erreurs } = await ouvrir(m, pages.home)
          const cles  = ['lumiere', 'att', 'att2', 'att3']
          const copie = async () => {
            await p.evaluate(() => { (window as any).__copie = null; ((document.querySelector('mjs-home') as any)._shadow.querySelector('mjs-core-code.copie')._shadow.querySelector('button.copy') as HTMLElement).click() })
            return await attendreEtat(() => p.evaluate(() => (window as any).__copie), 'le texte est copié', 2000)
          }
          try {
            const fr = await attendreEtat(async () => { const o = garder(await p.evaluate(LIRE3), cles); return o.att === ORIGINE3.att ? o : null }, 'la branche {success} est montrée', 2000).catch(async () => garder(await p.evaluate(LIRE3), cles))
            assert.deepEqual(fr, garder(ORIGINE3, cles))
            assert.deepEqual(await enAnglais(p, cles, LIRE3), garder(TRADUIT3, cles))
            assert.equal(await copie(), '$cart = panier')
            assert.deepEqual(await enFrancais(p, cles, LIRE3), garder(ORIGINE3, cles))
            assert.equal(await copie(), '$panier = panier')
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          } finally {
            await ctx.close()
          }
        })
      }
    })
  }
})
