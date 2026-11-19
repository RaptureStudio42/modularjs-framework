// Les deux règles qui gardent un reffet (`µeffect`) précis devant un état partagé sans jamais le rendre muet.
// 1. LE RELEVÉ — le code qui peut tourner après le passage (rappel, minuterie, promesse, suite d'un `await`, fonction du script ou méthode
//    passée par son nom) doit tenir dans la liste blanche de `generator/effect-deps.ts` : constantes, variable `$` ou clé du magasin lue
//    telle quelle, variable locale née d'une valeur simple, tests sans conversion, écritures de `$x` et de `$$x`, fonctions écrites sur
//    place ou affectées une seule fois. Toute autre forme pose la marque du doute (`µ.effect(f, [...], 1)`) : état nommé, lecture plus bas
//    (`$objet.nom`), appel d'une valeur `$`, valeur dérivée, calcul, `window`, `document`, fonction importée, paramètre, nom d'un paramètre
//    qui masque une fonction du script, fonction ou méthode réaffectée, rappel passé par son nom à `µafter` ou à une promesse. Pendant le
//    passage, aucune marque : la lecture est notée quand elle a lieu.
// 2. LE CŒUR — l'écriture d'un état partagé dans un objet dont un composant a fait l'enveloppe (objet tenu par une variable `$`, plus
//    bas, dans une liste filtrée, reçu en prop, ou rangé dans l'état après coup) fait passer tous les reffets des composants prévenus :
//    aucune valeur périmée. Une écriture ailleurs dans l'état ne fait passer que les reffets qui l'ont lu.
// Production et développement, happy-dom.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// ── 1. le relevé : nom du reffet, lignes de son corps, doute attendu ──
const PRECIS: [string, string[]][] = [
  ['constante', ['µafter 5, -> $s = 1']],
  ['variable', ['µafter 5, -> $s = $y']],
  ['cleDuMagasin', ['µafter 5, -> $s = $$rel']],
  ['localeSimple', ['v = $y', 'µafter 5, -> $s = v']],
  ['test', ['µafter 5, -> $s = if $y is 1 then 2 else 3']],
  ['apresAwait', ['await Promise.resolve()', '$s = $y']],
  ['fonctionLocale', ['f = -> $s = $y', 'µafter 5, f']],
  ['fonctionDuScript', ['µafter 5, poser']],
  ['fonctionDuScriptAppelee', ['µafter 5, -> poser()']],
  ['methodeParSonNom', ['µafter 5, @@ranger']],
  ['methodeAppelee', ['µafter 5, -> @@ranger()']],
  ['rappelDonneAUneFonctionImportee', ['plusTard -> $s = $y']],
  ['promesse', ['Promise.resolve(0).then -> $s = $y']],
  ['nettoyage', ['-> session.nom']],
  ['pendantLePassage', ['$s = session.nom']],
  ['pendantLePassageParUneFonction', ['$s = lireImp()']],
]
const DOUTE: [string, string[]][] = [
  ['etatNomme', ['µafter 5, -> $s = session.nom']],
  ['etatDuCoeur', ['µafter 5, -> $s = µurl.path']],
  ['apresAwaitEtat', ['await Promise.resolve()', '$s = session.nom']],
  ['lecturePlusBas', ['µafter 5, -> $s = $objet.nom']],
  ['appelDUneValeur', ['µafter 5, -> $s = $lire()']],
  ['valeurDerivee', ['µafter 5, -> $s = $double']],
  ['calcul', ['µafter 5, -> $s = $y + 1']],
  ['fenetre', ['µafter 5, -> $s = window.appSession']],
  ['document', ['µafter 5, -> $s = document.title']],
  ['fonctionImportee', ['µafter 5, -> $s = lireImp()']],
  ['parametre', ['Promise.resolve(session).then((recu) -> $s = recu)']],
  ['parametreDuNomDUneFonction', ['Promise.resolve(lireImp).then((poser) -> $s = poser())']],
  ['fonctionReaffectee', ['µafter 5, -> $s = relire()']],
  ['localeNeeDUnEtat', ['v = session', 'µafter 5, -> $s = v']],
  ['etalement', ['µafter 5, -> $s = [...$liste]']],
  ['rappelValeurParSonNom', ['µafter 5, $lire']],
  ['rappelImporteParSonNom', ['µafter 5, lireImp']],
  ['rappelPromesseParSonNom', ['Promise.resolve(0).then(lireImp)']],
  ['methodeQuiLitUnEtat', ['µafter 5, @@afficher']],
  ['methodeReaffectee', ['µafter 5, @@changeante']],
  ['adresse', ['$s = location.hash']],
  ['cleCalculee', ['k = \'y\'', '$s = $[k]']],
  ['dans', ['$s = \'nom\' in session']],
  ['delaiPrisDansUneValeur', ['µafter 5, -> µafter $y, -> $s = 1']],
]
const RELEVE = `<script>
  @import { session lireImp plusTard } 'lb-etats.civet.mjs'
  vu = (k) -> k
  $y = 0
  $s = 0
  $objet = { nom: 'x' }
  $liste = [1]
  $lire = -> session.nom
  $double = $y * 2
  poser = -> $s = 1
  relire = -> 1
  @ranger = -> $s = 1
  @afficher = -> $s = session.nom
  @changeante = -> $s = 1
  µmount ->
    relire = -> session.nom
    @changeante = -> $s = session.nom
${[...PRECIS, ...DOUTE].map(([nom, lignes]) => ['µeffect ->', `  vu('${nom}')`, '  y0 = $y', ...lignes.map((l) => '  ' + l)].map((l) => '  ' + l).join('\n')).join('\n')}
</script>
<p>{$y}</p>
`

// la marque du doute de chaque reffet nommé par `vu('nom')` dans le code compilé
function marques(code: string): Record<string, boolean> {
  const r: Record<string, boolean> = {}
  const noms = /vu\((['"])([A-Za-z0-9_]+)\1\)/g
  let m: RegExpExecArray | null
  while ((m = noms.exec(code)) !== null) {
    const fin = /\},\s*(\[[^\]]*\])(\s*,\s*1)?\s*\)/g
    fin.lastIndex = m.index
    const f = fin.exec(code)
    if (f) r[m[2]] = !!f[2]
  }
  return r
}

// l'état entier pris comme une valeur : un accesseur a pu y être posé, la lecture d'une variable après coup n'est plus de la liste
const ETAT_EN_VALEUR = `<script>
  vu = (k) -> k
  $y = 0
  $s = 0
  Object.defineProperty($, 'v', { get: -> 1 })
  µeffect ->
    vu('variable')
    y0 = $y
    µafter 5, -> $s = $y
  µeffect ->
    vu('constante')
    y0 = $y
    µafter 5, -> $s = 1
</script>
<p>{$y}</p>
`

describe('reffets devant un état partagé : la liste blanche du code d\'après coup', () => {
  let vues: Record<string, boolean>
  before(async () => {
    vues = marques((await transpile(RELEVE, { moduleName: 'lb-releve' } as any)).output)
  })

  it('chaque forme est relevée', () => {
    assert.deepEqual(Object.keys(vues).sort(), [...PRECIS, ...DOUTE].map(([nom]) => nom).sort())
  })

  it('le code d\'après coup qui tient dans la liste blanche, et le code du passage, ne posent aucune marque', () => {
    assert.deepEqual(PRECIS.filter(([nom]) => vues[nom]).map(([nom]) => nom), [])
  })

  it('toute autre forme pose la marque du doute', () => {
    assert.deepEqual(DOUTE.filter(([nom]) => !vues[nom]).map(([nom]) => nom), [])
  })

  it('l\'état entier pris comme une valeur (`Object.defineProperty($, …)`) : une variable lue après coup pose la marque, une constante non', async () => {
    assert.deepEqual(marques((await transpile(ETAT_EN_VALEUR, { moduleName: 'lb-valeur' } as any)).output), { variable: true, constante: false })
  })

  it('"reffetsAll" : le relevé ne pose aucune marque', async () => {
    const sans = marques((await transpile(RELEVE, { moduleName: 'lb-releve', reffetsAll: true } as any)).output)
    assert.deepEqual(Object.keys(sans).filter((nom) => sans[nom]), [])
  })
})

// ── 2. le cœur : l'objet d'un état partagé tenu par un composant ──
const DEPART = `a: 0, lignes: [{ q: 1, prix: { ht: 1 } }]`
const VU = `  vu = (k) -> window.__n[k] = (window.__n[k] or 0) + 1\n`
const COMPOSANTS: Record<string, string> = {
  'lb-etats.civet.mjs': `export session = µ.state({ ${DEPART} })
export µ$$compte = { ${DEPART} }
export panier = new µStore({ ${DEPART} })
`,
  'lb-ecrit.mjs': `<script>
  @import µ$$compte 'lb-etats.civet.mjs'
  @import { session panier } 'lb-etats.civet.mjs'
  window.__els.ecrit = this
  @sessionA = (v) -> session.a = v
  @sessionPrix = (v) -> session.lignes[0].prix.ht = v
  @compteA = (v) -> µ$$compte.a = v
  @comptePrix = (v) -> µ$$compte.lignes[0].prix.ht = v
  @compteQ = (v) -> µ$$compte.lignes[0].q = v
  @panierPrix = (v) -> panier.data.lignes[0].prix.ht = v
  @adopter = (o) -> session.adopte = o
  @adopteN = (v) -> session.adopte.n = v
</script>
<p>ecrit</p>
`,
  // le composant tient quatre objets des états : une liste, une ligne, une liste filtrée, une liste rangée plus bas
  'lb-tient.mjs': `<script>
  @import µ$$compte 'lb-etats.civet.mjs'
  @import { session panier } 'lb-etats.civet.mjs'
${VU}  window.__els.tient = this
  $x = 0
  $pret = false
  $lignes = µ$$compte.lignes
  $ligne = session.lignes[0]
  $filtrees = panier.data.lignes.filter(-> true)
  $boite = { l: µ$$compte.lignes }
  µeffect ->
    vu('parListe')
    window.__v.parListe = [$x, $lignes[0].prix.ht].join()
  µeffect ->
    vu('parLigne')
    window.__v.parLigne = [$x, $ligne.prix.ht].join()
  µeffect ->
    vu('parFiltre')
    window.__v.parFiltre = [$x, $filtrees[0].prix.ht].join()
  µeffect ->
    vu('parBoite')
    window.__v.parBoite = [$x, $boite.l[0].q].join()
  µeffect ->
    vu('direct')
    window.__v.direct = [$x, session.a].join()
  µeffect ->
    vu('sobre')
    window.__v.sobre = $x
    µafter 5, -> $pret = true
</script>
<p>{session.a} {session.lignes[0].prix.ht} {µ$$compte.a} {µ$$compte.lignes[0].prix.ht} {µ$$compte.lignes[0].q} {panier.data.lignes[0].prix.ht}</p>
`,
  // l'objet reçu en prop par un enfant, et l'objet du composant rangé dans l'état après coup
  'lb-parent.mjs': `<script>
  @import { session } 'lb-etats.civet.mjs'
</script>
<@lb-enfant ligne={session.lignes[0]}>
`,
  'lb-enfant.mjs': `<script>
${VU}  $x = 0
  µeffect ->
    vu('parProp')
    window.__v.parProp = [$x, $ligne?.prix?.ht].join()
</script>
<p>{$x}</p>
`,
  'lb-adopte.mjs': `<script>
  @import { session } 'lb-etats.civet.mjs'
${VU}  window.__els.adopte = this
  $x = 0
  $objet = { n: 0 }
  @donner = -> $objet
  µeffect ->
    vu('parObjet')
    window.__v.parObjet = [$x, $objet.n].join()
  µeffect ->
    vu('lecteur')
    window.__v.lecteur = [$x, session.a].join()
</script>
<p>{session.a} {session.adopte?.n}</p>
`,
}
const PAGE = ['lb-ecrit', 'lb-tient', 'lb-parent', 'lb-adopte'].map((n) => `<mjs-${n}></mjs-${n}>`).join('')
const TIENT = ['direct', 'parBoite', 'parFiltre', 'parLigne', 'parListe', 'sobre']

// un pas : le geste, les reffets qui passent, les valeurs qui doivent être à jour après lui
const PAS: [string, string, string[], Record<string, string>][] = [
  ['champ de premier niveau, objet que personne ne tient : seuls ses lecteurs', 'E.sessionA(1)', ['direct', 'lecteur'], { direct: '0,1', lecteur: '0,1' }],
  ['plus bas que la ligne tenue (état de module) : tous les reffets des composants prévenus', 'E.sessionPrix(4)', [...TIENT, 'parProp'], { parLigne: '0,4', parProp: '0,4' }],
  ['plus bas que la liste tenue (µ$$x)', 'E.comptePrix(5)', TIENT, { parListe: '0,5' }],
  ['ligne de la liste rangée plus bas (µ$$x)', 'E.compteQ(6)', TIENT, { parBoite: '0,6' }],
  ['ligne d\'une liste filtrée (µStore)', 'E.panierPrix(7)', TIENT, { parFiltre: '0,7' }],
  ['champ de premier niveau d\'un µ$$x, lu par le gabarit seul : aucun reffet', 'E.compteA(8)', [], {}],
  ['objet du composant rangé dans l\'état après coup', 'E.adopter(window.__els.adopte.donner())', [], {}],
  ['cet objet écrit par l\'état', 'E.adopteN(9)', ['lecteur', 'parObjet'], { parObjet: '0,9' }],
]
const SCENARIO = `(async () => {
  const R = [], E = window.__els.ecrit
  for (const [nom, geste] of ${JSON.stringify(PAS.map(([nom, geste]) => [nom, geste]))}) {
    const avant = { ...window.__n }
    new Function('E', geste)(E)
    await new Promise((r) => setTimeout(r, 60))
    R.push([nom, Object.keys(window.__n).filter((k) => window.__n[k] !== avant[k]).sort(), { ...window.__v }])
  }
  return R
})()`

type Jeu = { montage: Record<string, number>, pas: [string, string[], Record<string, string>][], avertissements: string[] }

async function jouer(nom: string, opts: Record<string, unknown>): Promise<Jeu> {
  const root   = mjsTmp('reffets-deux-regles-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, texte] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, f), texte)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js: 'bundle', minify: false, ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const code   = readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  const avertissements: string[] = []
  window.console.warn  = (...a: unknown[]) => { avertissements.push(a.map(String).join(' ')) }
  window.console.error = (...a: unknown[]) => { avertissements.push(a.map(String).join(' ')) }
  try {
    window.__n   = {}
    window.__v   = {}
    window.__els = {}
    window.eval(code)
    window.document.body.innerHTML = PAGE
    const fin = Date.now() + 5000
    while (!(window.__els.ecrit && window.__els.tient && window.__els.adopte && window.__n.parProp) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 80))
    const montage = { ...window.__n }
    const pas     = await window.eval(SCENARIO)
    return JSON.parse(JSON.stringify({ montage, pas, avertissements }))
  }
  finally {
    await window.happyDOM.close()
  }
}

describe('reffets devant un état partagé : l\'objet de l\'état tenu par un composant', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, opts] of [['production', { env: 'prod' }], ['développement', { env: 'dev' }]] as [string, Record<string, unknown>][]) describe(nom, () => {
    let jeu: Jeu
    before(async () => {
      jeu = await jouer(nom, opts)
    })

    it('au montage, chaque reffet passe une fois', () => {
      assert.deepEqual(jeu.montage, { parListe: 1, parLigne: 1, parFiltre: 1, parBoite: 1, direct: 1, sobre: 1, parProp: 1, parObjet: 1, lecteur: 1 })
    })

    it('reffets passés à chaque écriture : tous quand l\'objet écrit est tenu, sinon les seuls lecteurs', () => {
      assert.deepEqual(jeu.pas.map(([n, passes]) => [n, passes]), PAS.map(([n, , passes]) => [n, [...passes].sort()]))
    })

    it('aucune valeur périmée après l\'écriture d\'un objet tenu', () => {
      const lues = jeu.pas.map(([n, , v], i) => [n, Object.fromEntries(Object.keys(PAS[i][3]).map((k) => [k, v[k]]))])
      assert.deepEqual(lues, PAS.map(([n, , , v]) => [n, v]))
    })

    it('aucun avertissement', () => {
      assert.deepEqual(jeu.avertissements, [])
    })
  })

  describe('production, "proxy": false', () => {
    let jeu: Jeu
    before(async () => {
      jeu = await jouer('proxy', { env: 'prod', proxy: false })
    })

    it('aucune valeur périmée : sans l\'enveloppe, tout avis d\'un état partagé fait passer tous les reffets du composant', () => {
      const lues = jeu.pas.map(([n, , v], i) => [n, Object.fromEntries(Object.keys(PAS[i][3]).map((k) => [k, v[k]]))])
      assert.deepEqual(lues, PAS.map(([n, , , v]) => [n, v]))
      assert.deepEqual(jeu.pas[0][1], ['direct', 'lecteur', 'parBoite', 'parFiltre', 'parLigne', 'parListe', 'parObjet', 'sobre'])
    })
  })
})
