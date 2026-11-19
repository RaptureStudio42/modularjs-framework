// Un composant redessiné parce qu'un état partagé a changé (`µurl`, `µnav`, `µonline`, un `µ$$x`, un `µStore`, un contexte `§§x`) ne fait
// passer que les reffets qui ont lu cet état à leur dernier passage — dans leur corps, une méthode, une fonction du `<script module>`, la
// méthode d'un autre composant —, à la clé près pour un `µStore` (`panier.data.total` n'est pas `panier.data.remise`), au nom près pour un `µ$$x`, et ceux dont le cœur ne peut pas savoir s'ils le
// lisent : état nommé après coup (minuterie, `await`), `µStore` tenu par une variable ordinaire lu après coup, `location` nommé, clé
// calculée `$[k]`, valeur dérivée à l'horloge faite de l'état (`$page = µurl.path + $suffixe` ; sans variable `$`, `$page = µurl.path` n'est
// pas une valeur dérivée, mais une variable posée une fois). Un reffet qui ne lit qu'une clé du magasin, une variable `$`, ou la branche
// qu'il n'a pas prise ne passe pas ; un reffet qui n'a lu ni variable ni clé du magasin garde sa règle (il passe à chaque mise à jour).
// Deux états changés dans le même tour : un passage. Un composant sorti de la page puis remis fait passer tous ses reffets à son retour.
// Le reffet d'un `<script module>` suit `µurl` quand il le lit. Un état lu pour la première fois pendant un
// passage relancé par une variable (branche prise plus tard), dans un composant qui ne le lit nulle part ailleurs, n'abonne pas ce composant : le reffet ne repart pas quand l'état change ensuite. La navigation est jouée comme le routeur la fait (routes `#/…`) : l'adresse
// change, puis `µ.url` est relu. Production et développement, `"derived": "clock"` ; sous `"proxy": false`, la précision est coupée : tout
// avis d'un état partagé fait passer tous les reffets du composant. happy-dom.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const VU = `vu = (k) -> window.__n[k] = (window.__n[k] or 0) + 1
`
const COMPOSANTS: Record<string, string> = {
  'se-etats.civet.mjs': `export µ$$compte = { a: 0, b: 0 }
export µ$$feed = new µStore(version: 0)
export panier = new µStore(total: 0, remise: 0)
`,
  'se-coquille.mjs': `<script module>
  export lireParModule = -> µurl.path
</script>
<script>
  @import µ$$compte 'se-etats.civet.mjs'
  ${VU}  $x    = 0
  $mode = false
  $suffixe = ''
  $page = µurl.path + $suffixe
  §§theme = { nom: 'clair' }
  @lire = -> µurl.path
  @ecrireX = (v) -> $x = v
  @ecrireMode = (v) -> $mode = v
  @ecrireRel = (v) -> $$rel = v
  @ecrireTheme = (v) -> §§theme.nom = v
  µeffect ->
    vu('theme')
    window.__v.theme = $$rel
  µeffect.before ->
    vu('avant')
    window.__v.avant = $$rel
  µeffect ->
    vu('local')
    window.__v.local = $x
  µeffect ->
    vu('url')
    window.__v.url = [$x, µurl.path].join()
  µeffect ->
    vu('urlSeul')
    window.__v.urlSeul = µurl.path
  µeffect ->
    vu('dom')
    window.__v.dom = document.title
  µeffect ->
    vu('apres')
    v = $x
    µafter 5, -> window.__v.apres = [v, µurl.path].join()
  µeffect ->
    vu('attente')
    v = $x
    await Promise.resolve()
    window.__v.attente = [v, µurl.path].join()
  µeffect ->
    vu('loc')
    window.__v.loc = [$$rel, location.hash].join()
  µeffect ->
    vu('branche')
    window.__v.branche = if $mode then µurl.path else 'non prise'
  µeffect ->
    vu('methode')
    window.__v.methode = [$x, @@lire()].join()
  µeffect ->
    vu('module')
    window.__v.module = [$x, lireParModule()].join()
  µeffect ->
    vu('enfant')
    window.__v.enfant = [$x, document.querySelector('mjs-se-voisin')?.lireUrl()].join()
  µeffect ->
    vu('derive')
    window.__v.derive = [$x, $page].join()
  µeffect ->
    vu('cleA')
    window.__v.cleA = [$x, µ$$compte.a].join()
  µeffect ->
    vu('cleB')
    window.__v.cleB = [$x, µ$$compte.b].join()
  µeffect ->
    vu('deux')
    window.__v.deux = [$x, µurl.path, µ$$compte.a].join()
  µeffect ->
    vu('cleCalculee')
    k = 'page'
    window.__v.cleCalculee = [$x, $[k]].join()
</script>
<p>{µurl.path} {$x} {$page} {µ$$compte.a} {µ$$compte.b}</p>
<@se-enfant>
`,
  'se-enfant.mjs': `<script>
  ${VU}  $y = 0
  µeffect ->
    vu('ctxLu')
    window.__v.ctxLu = [$y, §§theme.nom].join()
  µeffect ->
    vu('ctxRel')
    window.__v.ctxRel = $$rel
</script>
<p>{§§theme.nom}</p>
`,
  'se-voisin.mjs': `<script>
  ${VU}  $y = 0
  @lireUrl = -> µurl.path
  µeffect ->
    vu('voisin')
    window.__v.voisin = $y
</script>
<p>{$y}</p>
`,
  'se-nav.mjs': `<script>
  ${VU}  $y = 0
  µeffect ->
    vu('navRel')
    window.__v.navRel = $$rel
  µeffect ->
    vu('navLu')
    window.__v.navLu = [$y, µnav.active].join()
</script>
<p>{µnav.active}</p>
`,
  'se-reseau.mjs': `<script>
  ${VU}  $y = 0
  µeffect ->
    vu('resRel')
    window.__v.resRel = $$rel
  µeffect ->
    vu('resLu')
    window.__v.resLu = [$y, µonline].join()
</script>
<p>{µonline}</p>
`,
  'se-magasin.mjs': `<script>
  @import µ$$feed 'se-etats.civet.mjs'
  @import { panier } 'se-etats.civet.mjs'
  ${VU}  $z = 0
  @ecrireVersion = (v) -> µ$$feed.data.version = v
  @ecrireTotal = (v) -> panier.data.total = v
  µeffect ->
    vu('magRel')
    window.__v.magRel = $$rel
  µeffect ->
    vu('magLu')
    window.__v.magLu = [$z, µ$$feed.data.version].join()
  µeffect ->
    vu('magTotal')
    window.__v.magTotal = [$z, panier.data.total].join()
  µeffect ->
    vu('magRemise')
    window.__v.magRemise = [$z, panier.data.remise].join()
  µeffect ->
    vu('magApres')
    v = $z
    µafter 5, -> window.__v.magApres = [v, panier.data.total].join()
</script>
<p>{µ$$feed.data.version} {panier.data.total} {panier.data.remise}</p>
`,
  'se-gabarit.mjs': `<script>
  ${VU}  µeffect ->
    vu('gabRel')
    window.__v.gabRel = $$rel
</script>
<p>{µurl.path}</p>
`,
  'se-module.mjs': `<script module>
  µeffect ->
    window.__n.modUrl = (window.__n.modUrl or 0) + 1
    window.__v.modUrl = µurl.path
  µeffect ->
    window.__n.modRel = (window.__n.modRel or 0) + 1
    window.__v.modRel = $$rel
</script>
<script>
  $w = 0
</script>
<p>{$w}</p>
`,
  'se-tard.mjs': `<script>
  ${VU}  $mode = false
  @ecrireMode = (v) -> $mode = v
  µeffect ->
    vu('tard')
    window.__v.tard = if $mode then µnav.active else 'non prise'
</script>
<p>{$mode}</p>
`,
  'se-autre.mjs': `<script>
  @import µ$$compte 'se-etats.civet.mjs'
  @ecrireA = (v) -> µ$$compte.a = v
  @ecrireB = (v) -> µ$$compte.b = v
</script>
<p>autre</p>
`,
}

const PAGE  = ['se-coquille', 'se-voisin', 'se-nav', 'se-reseau', 'se-magasin', 'se-gabarit', 'se-module', 'se-tard', 'se-autre']
const CORPS = PAGE.map((n) => `<mjs-${n}></mjs-${n}>`).join('')

const SCENARIO = `(async () => {
  const R = []
  const el = (n) => document.querySelector('mjs-' + n)
  async function pas(nom, f) {
    const avant = { ...window.__n }
    f()
    await new Promise((r) => setTimeout(r, 40))
    const d = {}
    for (const k in window.__n) if (window.__n[k] !== avant[k]) d[k] = window.__n[k] - (avant[k] || 0)
    R.push([nom, d])
  }
  function naviguer(p) {
    history.pushState(null, '', p)
    µ.Router._mjs_updateUrlStore()
  }
  const nav = el('se-nav')
  await pas('navigation', () => naviguer('#/page-b'))
  await pas('navigation suivante', () => naviguer('#/page-c'))
  await pas('µnav écrit en JavaScript nu', () => { µ.nav.active = true })
  await pas('réseau perdu', () => { window.dispatchEvent(new Event('offline')) })
  await pas('$mode passe à vrai', () => el('se-coquille').ecrireMode(true))
  await pas('navigation, branche prise', () => naviguer('#/page-d'))
  await pas('clé b écrite par un autre composant', () => el('se-autre').ecrireB(1))
  await pas('clé a écrite par un autre composant', () => el('se-autre').ecrireA(1))
  await pas('deux états dans le même tour', () => { naviguer('#/page-e'); el('se-autre').ecrireA(2) })
  await pas('contexte écrit par le parent', () => el('se-coquille').ecrireTheme('sombre'))
  await pas('µStore : version écrite', () => el('se-magasin').ecrireVersion(1))
  await pas('µStore tenu par une variable : total écrit', () => el('se-magasin').ecrireTotal(5))
  await pas('clé du magasin écrite', () => el('se-coquille').ecrireRel('rouge'))
  await pas('variable $x écrite', () => el('se-coquille').ecrireX(1))
  await pas('composant sorti, état changé pendant son absence', () => { nav.remove(); µ.nav.active = false })
  await pas('composant remis dans la page', () => { document.body.appendChild(nav) })
  await pas('branche prise plus tard, seule lecture de l\\'état dans son composant', () => el('se-tard').ecrireMode(true))
  await pas('cet état écrit ensuite', () => { µ.nav.active = true })
  return { pas: R, valeurs: window.__v }
})()`

type Mode = { nom: string, opts: Record<string, unknown> }
const MODES: Mode[] = [
  { nom: 'production', opts: { env: 'prod' } },
  { nom: 'développement', opts: { env: 'dev' } },
  { nom: 'production, "proxy": false', opts: { env: 'prod', proxy: false } },
  { nom: 'production, "derived": "clock"', opts: { env: 'prod', derivedMode: 'clock' } },
]

async function construire(mode: Mode): Promise<string> {
  const root   = mjsTmp('reffets-etat-lu-' + MODES.indexOf(mode))
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, texte] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom.includes('.') ? nom : nom + '.mjs'), texte)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js: 'bundle', minify: false, ...mode.opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
}

type Jeu = { montage: Record<string, number>, pas: [string, Record<string, number>][], valeurs: Record<string, unknown>, avertissements: string[] }

async function jouer(code: string): Promise<Jeu> {
  const window: any = new Window({ url: 'http://localhost/#/page-a', settings: { disableCSSFileLoading: true } } as any)
  const avertissements: string[] = []
  window.console.warn  = (...a: unknown[]) => { avertissements.push(a.map(String).join(' ')) }
  window.console.error = (...a: unknown[]) => { avertissements.push(a.map(String).join(' ')) }
  try {
    window.__n = {}
    window.__v = {}
    window.eval(code)
    window.document.body.innerHTML = CORPS
    const fin = Date.now() + 5000
    while (PAGE.some((n) => !window.document.querySelector('mjs-' + n)?._mjs_is_mounted) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 60))
    const montage = { ...window.__n }
    const r = await window.eval(SCENARIO)
    return JSON.parse(JSON.stringify({ montage, pas: r.pas, valeurs: r.valeurs, avertissements }))
  }
  finally {
    await window.happyDOM.close()
  }
}

// au montage, chaque reffet passe une fois
const MONTAGE = { theme: 1, avant: 1, local: 1, url: 1, urlSeul: 1, dom: 1, apres: 1, attente: 1, loc: 1, branche: 1, methode: 1, module: 1, enfant: 1, derive: 1, cleA: 1, cleB: 1, deux: 1, cleCalculee: 1, ctxLu: 1, ctxRel: 1, voisin: 1, navRel: 1, navLu: 1, resRel: 1, resLu: 1, magRel: 1, magLu: 1, magTotal: 1, magRemise: 1, magApres: 1, gabRel: 1, modUrl: 1, modRel: 1, tard: 1 }

// à une navigation, dans la coquille : ceux qui ont lu `µurl` (corps, méthode, fonction du module, méthode d'un autre composant), ceux du
// doute (état nommé après coup, `location`, clé calculée, valeur à l'horloge faite de l'état), et ceux qui n'ont lu ni variable ni clé du
// magasin (`urlSeul`, `dom` : à chaque mise à jour) ; ni `theme`, ni `avant`, ni `local`, ni les lecteurs de `µ$$compte`
const NAVIGATION = { url: 1, urlSeul: 1, dom: 1, apres: 1, attente: 1, loc: 1, methode: 1, module: 1, enfant: 1, derive: 1, deux: 1, cleCalculee: 1, modUrl: 1 }
// à chaque mise à jour de la coquille sans rapport : les reffets du doute et ceux qui n'ont lu ni variable ni clé du magasin
const DOUTE      = { urlSeul: 1, dom: 1, apres: 1, attente: 1, loc: 1, derive: 1, cleCalculee: 1 }

const PASSAGES: [string, Record<string, number>][] = [
  ['navigation', NAVIGATION],
  ['navigation suivante', NAVIGATION],
  ['µnav écrit en JavaScript nu', { navLu: 1 }],
  ['réseau perdu', { resLu: 1 }],
  ['$mode passe à vrai', { urlSeul: 1, dom: 1, branche: 1 }],
  ['navigation, branche prise', { ...NAVIGATION, branche: 1 }],
  // un `µ$$x` se suit au nom près : un champ écrit fait passer ceux qui lisent un champ de ce même état
  ['clé b écrite par un autre composant', { ...DOUTE, cleA: 1, cleB: 1, deux: 1 }],
  ['clé a écrite par un autre composant', { ...DOUTE, cleA: 1, cleB: 1, deux: 1 }],
  ['deux états dans le même tour', { ...NAVIGATION, branche: 1, cleA: 1, cleB: 1 }],
  ['contexte écrit par le parent', { ctxLu: 1 }],
  ['µStore : version écrite', { magLu: 1, magApres: 1 }],
  // un `µStore` se suit à la clé près : `magRemise`, qui lit `remise`, ne passe pas
  ['µStore tenu par une variable : total écrit', { magTotal: 1, magApres: 1 }],
  ['clé du magasin écrite', { theme: 1, avant: 1, urlSeul: 1, dom: 1, loc: 1, ctxRel: 1, navRel: 1, resRel: 1, magRel: 1, gabRel: 1, modRel: 1 }],
  ['variable $x écrite', { local: 1, url: 1, urlSeul: 1, dom: 1, apres: 1, attente: 1, methode: 1, module: 1, enfant: 1, derive: 1, cleA: 1, cleB: 1, deux: 1, cleCalculee: 1 }],
  ['composant sorti, état changé pendant son absence', {}],
  ['composant remis dans la page', { navRel: 1, navLu: 1 }],
  ['branche prise plus tard, seule lecture de l\'état dans son composant', { tard: 1 }],
  // une lecture faite pendant un passage relancé par une variable n'abonne pas le composant : `tard` ne repart pas quand l'état change
  // ensuite ; le composant remis dans la page après en être sorti pour de bon suit son relevé seul, ses reffets passent tous
  ['cet état écrit ensuite', { navRel: 1, navLu: 1 }],
]

// `"proxy": false` : sans l'enveloppe, rien ne dit ce qu'un composant tient d'un état partagé ; la précision est coupée, tout avis d'un
// état partagé fait passer tous les reffets du composant prévenu
const tous = (noms: string): Record<string, number> => Object.fromEntries(noms.split(' ').map((k) => [k, 1]))
const COQUILLE_ADRESSE = 'apres attente avant branche cleA cleB cleCalculee derive deux dom enfant gabRel loc local methode modUrl module theme url urlSeul'
const COQUILLE_COMPTE  = 'apres attente avant branche cleA cleB cleCalculee derive deux dom enfant loc local methode module theme url urlSeul'
const MAGASIN          = 'magApres magLu magRel magRemise magTotal'
const PASSAGES_SANS_ENVELOPPE: [string, Record<string, number>][] = [
  ['navigation', tous(COQUILLE_ADRESSE)],
  ['navigation suivante', tous(COQUILLE_ADRESSE)],
  ['µnav écrit en JavaScript nu', tous('navLu navRel')],
  ['réseau perdu', tous('resLu resRel')],
  ['$mode passe à vrai', tous('branche dom urlSeul')],
  ['navigation, branche prise', tous(COQUILLE_ADRESSE)],
  ['clé b écrite par un autre composant', tous(COQUILLE_COMPTE)],
  ['clé a écrite par un autre composant', tous(COQUILLE_COMPTE)],
  ['deux états dans le même tour', tous(COQUILLE_ADRESSE)],
  ['contexte écrit par le parent', tous('ctxLu ctxRel')],
  ['µStore : version écrite', tous(MAGASIN)],
  ['µStore tenu par une variable : total écrit', tous(MAGASIN)],
  ['clé du magasin écrite', tous('avant ctxRel dom gabRel loc magRel modRel navRel resRel theme urlSeul')],
  ['variable $x écrite', tous('apres attente cleA cleB cleCalculee derive deux dom enfant local methode module url urlSeul')],
  ['composant sorti, état changé pendant son absence', {}],
  ['composant remis dans la page', tous('navLu navRel')],
  ['branche prise plus tard, seule lecture de l\'état dans son composant', tous('tard')],
  ['cet état écrit ensuite', tous('navLu navRel')],
]

describe('composant redessiné par un état partagé : seuls passent les reffets qui l\'ont lu, et ceux du doute', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const mode of MODES) describe(mode.nom, () => {
    let jeu: Jeu
    before(async () => {
      jeu = await jouer(await construire(mode))
    })

    it('au montage, chaque reffet passe une fois', () => {
      assert.deepEqual(jeu.montage, MONTAGE)
    })

    it(mode.opts.proxy === false ? 'passages comptés pas à pas : tous les reffets du composant prévenu' : 'passages comptés pas à pas', () => {
      assert.deepEqual(jeu.pas, mode.opts.proxy === false ? PASSAGES_SANS_ENVELOPPE : PASSAGES)
    })

    it('valeurs lues à la fin du scénario', () => {
      assert.equal(jeu.valeurs.url, '1,/page-e')
      assert.equal(jeu.valeurs.methode, '1,/page-e')
      assert.equal(jeu.valeurs.module, '1,/page-e')
      assert.equal(jeu.valeurs.enfant, '1,/page-e')
      assert.equal(jeu.valeurs.derive, '1,/page-e')
      assert.equal(jeu.valeurs.cleCalculee, '1,/page-e')
      assert.equal(jeu.valeurs.apres, '1,/page-e')
      assert.equal(jeu.valeurs.attente, '1,/page-e')
      assert.equal(jeu.valeurs.branche, '/page-e')
      assert.equal(jeu.valeurs.deux, '1,/page-e,2')
      assert.equal(jeu.valeurs.cleA, '1,2')
      assert.equal(jeu.valeurs.cleB, '1,1')
      assert.equal(jeu.valeurs.loc, 'rouge,#/page-e')
      assert.equal(jeu.valeurs.theme, 'rouge')
      assert.equal(jeu.valeurs.ctxLu, '0,sombre')
      assert.equal(jeu.valeurs.magLu, '0,1')
      assert.equal(jeu.valeurs.magTotal, '0,5')
      assert.equal(jeu.valeurs.magApres, '0,5')
      assert.equal(jeu.valeurs.magRemise, '0,0')
      assert.equal(jeu.valeurs.navLu, '0,true')
      assert.equal(jeu.valeurs.tard, false)
      assert.equal(jeu.valeurs.resLu, '0,false')
      assert.equal(jeu.valeurs.modUrl, '/page-e')
    })

    it('aucun avertissement', () => {
      assert.deepEqual(jeu.avertissements, [])
    })
  })
})
