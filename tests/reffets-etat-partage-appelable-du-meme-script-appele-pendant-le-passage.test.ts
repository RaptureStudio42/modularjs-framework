// Un reffet (`µeffect`) qui appelle, PENDANT son passage, un appelable de son propre script reste juste devant un état partagé, même quand
// cet appelable remet lui-même la lecture de l'état à plus tard (minuterie, promesse, écouteur).
// Le relevé (`generator/effect-deps.ts`) TROUVE l'appelé et le juge comme du code d'après coup — méthode d'un objet littéral, méthode de
// classe, fonction du script ou méthode du composant affectées une seule fois —, ou bien il ne le trouve pas et pose la marque du doute
// (`µ.effect(f, [...], 1)`) : fonction fabriquée par une autre, fonction rangée dans une variable `$`, méthode posée par une fonction
// d'ordre supérieur, fonction réaffectée, appel calculé, nom local qui tient autre chose qu'une fonction écrite sur place.
// Un appelé trouvé dont le corps ne remet rien de douteux à plus tard, une fonction importée, une fonction du langage ou du navigateur ne
// posent aucune marque : la lecture faite pendant le passage est notée quand elle a lieu.
// 1. les marques du relevé, forme par forme ; 2. la scène jouée, production et développement, happy-dom : aucune valeur périmée.

import { describe, it, before, after } from 'mocha'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// ── 1. le relevé : nom du reffet, lignes de son corps ──
const DOUTE: [string, string[]][] = [
  ['methodeDUnObjetLitteral', ['outils.relire()']],
  ['methodeParMinuterie', ['outils.parMinuterie()']],
  ['methodeParPromesse', ['outils.parPromesse()']],
  ['methodeParEcouteur', ['outils.parEcouteur()']],
  ['fonctionFabriquee', ['tardif()']],
  ['fonctionFabriqueeParUneFonctionImportee', ['tardifImp()']],
  ['fonctionRangeeDansUneVariable', ['$tard()']],
  ['methodeDUnObjetRange', ['$api.charger()']],
  ['methodePoseeParUneFonction', ['@@sauver()']],
  ['methodeDeClasse', ['minuteur.lancer()']],
  ['fonctionReaffectee', ['relire()']],
  ['methodeReaffectee', ['@@changeante()']],
  ['appelCalcule', ['outils[cle]()']],
  ['nomLocal', ['f = outils.relire', 'f()']],
  ['parCall', ['outils.relire.call(null)']],
  ['constructeur', ['new Tardive()']],
  ['fonctionPoseeSurLaFenetre', ['window.tardGlobal()']],
  ['fonctionPoseeSurLaFenetreParSonNom', ['tardGlobal()']],
  ['resultatDUnAppel', ['choisir()()']],
  ['cleEcriteAilleurs', ['autre.relire()']],
]
const PRECIS: [string, string[]][] = [
  ['methodeTrouveeQuiLit', ['$s = outils.lire()']],
  ['methodeDeClasseQuiLit', ['$s = minuteur.lire()']],
  ['methodeTrouveeQuiRange', ['outils.ranger()']],
  ['constructeurSimple', ['$s = new Simple().n']],
  ['fonctionDuScript', ['$s = lireS()']],
  ['fonctionImportee', ['$s = lireImp()']],
  ['methodeDuComposant', ['$s = @@lireM()']],
  ['fonctionsDuLangage', ['$s = [y0, JSON.stringify(session), Math.max(1, 2), String(y0)].join()']],
  ['methodeDUneValeur', ['$s = $liste.slice(0).join()']],
  ['methodeDeLElement', ['$s = @@getAttribute(\'x\')']],
  ['classeDuNavigateur', ['$s = new Map().size']],
]
const RELEVE = `<script>
  @import { session lireImp differe } 'ap-etats.civet.mjs'
  vu = (k) -> k
  $y = 0
  $s = 0
  $liste = [1]
  cle = 'relire'
  fabrique = (f) -> (-> µafter 5, f)
  choisir = -> outils.relire
  lireS = -> session.a
  @lireM = -> session.a
  outils = {
    relire: -> µafter 5, -> window.vu = session.a
    parMinuterie: -> requestAnimationFrame(-> window.vu = session.a)
    parPromesse: -> Promise.resolve(0).then(-> window.vu = session.a)
    parEcouteur: -> window.addEventListener('ap-tic', (-> window.vu = session.a), { once: true })
    lire: -> session.a
    ranger: -> µafter 5, -> $s = 1
  }
  autre = {}
  tardif = fabrique(-> window.vu = session.a)
  tardifImp = differe(-> window.vu = session.a)
  $tard = -> µafter 5, -> window.vu = session.a
  $api = { charger: -> µafter 5, -> window.vu = session.a }
  @sauver = differe(-> window.vu = session.a)
  @changeante = -> 1
  class Minuteur
    lancer() { µafter 5, -> window.vu = session.a }
    lire() { session.a }
  minuteur = new Minuteur()
  class Tardive
    constructor() { µafter 5, -> window.vu = session.a }
  class Simple
    constructor() { this.n = session.a }
  window.tardGlobal = -> µafter 5, -> window.vu = session.a
  relire = -> 'rien'
  µmount ->
    relire = -> µafter 5, -> window.vu = session.a
    @changeante = -> µafter 5, -> window.vu = session.a
${[...PRECIS, ...DOUTE].map(([nom, lignes]) => ['µeffect ->', `  vu('${nom}')`, '  y0 = $y', ...lignes.map((l) => '  ' + l)].map((l) => '  ' + l).join('\n')).join('\n')}
</script>
<p>{session.a}</p>
`

// ce que le script fait tourner sans appel écrit : un accesseur, une conversion (`toString`), une clé calculée qui reçoit une fonction
const IMPLICITES: [string, string, boolean][] = [
  ['accesseur qui remet à plus tard', `boite = { get v() { µafter 5, -> window.vu = session.a } }`, true],
  ['accesseur posé par Object.defineProperty', `boite = Object.defineProperty({}, 'v', { get: -> µafter 5, -> window.vu = session.a })`, true],
  ['conversion qui remet à plus tard', `boite = { v: 1, toString: -> µafter 5, -> window.vu = session.a }`, true],
  ['accesseur qui lit pendant le passage', `boite = { get v() { session.a } }`, false],
]
const implicite = (pose: string): string => `<script>
  @import { session } 'ap-etats.civet.mjs'
  vu = (k) -> k
  $y = 0
  ${pose}
  µeffect ->
    vu('lecteur')
    window.lu = [$y, boite.v, String(boite)].join()
</script>
<p>{session.a}</p>
`

// une clé calculée qui reçoit une fonction : la méthode appelée par son nom n'est plus trouvée à coup sûr
const CLE_CALCULEE = `<script>
  @import { session } 'ap-etats.civet.mjs'
  vu = (k) -> k
  $y = 0
  outils = { lire: -> session.a }
  nom = 'li' + 're'
  outils[nom] = -> µafter 5, -> window.vu = session.a
  µeffect ->
    vu('lecteur')
    window.lu = [$y, outils.lire()].join()
</script>
<p>{session.a}</p>
`

// une clé dont le relevé ne lit pas la valeur : posée par un accesseur (ce qu'il rend n'est pas lu), par un descripteur, par un motif qui
// écrit dans un membre ; `this.m()` dans la méthode d'un objet, où `this` n'est pas le composant. Dernier champ : la marque attendue
const CLES_NON_LUES: [string, string[], string, boolean][] = [
  ['un accesseur d\'objet rend une fonction fabriquée, appelée par ce nom', ['boite = { get relire() { return tardif } }'], 'boite.relire()', true],
  ['un accesseur de classe rend une fonction fabriquée, appelée par ce nom', ['class Boite', '  get relire() { return tardif }', 'boite = new Boite()'], 'boite.relire()', true],
  ['un accesseur posé par Object.defineProperty rend une fonction fabriquée, appelée par ce nom', ['boite = Object.defineProperty({}, \'relire\', { get: -> tardif })'], 'boite.relire()', true],
  ['un accesseur donné par le nom d\'une fonction du script qui remet à plus tard', ['lireTard = -> µafter 5, -> window.vu = session.a', 'boite = Object.defineProperty({}, \'v\', { get: lireTard })'], 'window.lu = boite.v', true],
  ['un accesseur donné par une fonction fabriquée', ['boite = Object.defineProperty({}, \'v\', { get: tardif })'], 'window.lu = boite.v', true],
  ['une clé posée par les descripteurs de Object.create', ['boite = Object.create(null, { relire: { value: tardif } })'], 'boite.relire()', true],
  ['une clé posée par un motif qui écrit dans un membre', ['opts = { rappel: tardif }', 'outils = {}', '{ rappel: outils.relire } = opts'], 'outils.relire()', true],
  ['this.m() dans la méthode d\'un objet qui range autre chose sous le nom d\'une méthode du composant', ['@relire = -> 1', 'outils = { go: (-> this.relire()), relire: tardif }'], 'outils.go()', true],
  ['une fonction fabriquée rangée sous une clé calculée, la méthode appelée par son nom', ['outils = { lire: -> session.a }', 'nomc = \'re\' + \'lire\'', 'outils[nomc] = tardif'], 'outils.relire()', true],
  ['un accesseur posé sous une clé calculée rend une fonction fabriquée, la méthode appelée par son nom', ['nomc = \'re\' + \'lire\'', 'boite = { get [nomc]() { return tardif } }'], 'boite.relire()', true],
  ['un accesseur posé par Object.defineProperty sous un nom calculé rend une fonction fabriquée, appelée par son nom', ['nomc = \'re\' + \'lire\'', 'boite = Object.defineProperty({}, nomc, { get: -> tardif })'], 'boite.relire()', true],
  ['une clé posée par la cible d\'une boucle for … of', ['outils = {}', 'for (outils.relire of [tardif]) { vu(0) }'], 'outils.relire()', true],
  ['une clé posée par le motif de la cible d\'une boucle for … of', ['outils = {}', 'for ({ a: outils.relire } of [{ a: tardif }]) { vu(0) }'], 'outils.relire()', true],
  ['un accesseur qui lit pendant le passage, lu sans appel', ['boite = { get v() { session.a } }'], 'window.lu = boite.v', false],
  ['un accesseur dans le script, une méthode du dehors appelée par un autre nom', ['boite = { get v() { session.a } }'], 'window.lu = [boite.v, [1].map(String)].join()', false],
]
const cleNonLue = (pose: string[], appel: string): string => `<script>
  @import { session } 'ap-etats.civet.mjs'
  vu = (k) -> k
  $y = 0
  fabrique = (f) -> (-> µafter 5, f)
  tardif = fabrique(-> window.vu = session.a)
${pose.map((l) => '  ' + l).join('\n')}
  µeffect ->
    vu('lecteur')
    y0 = $y
    ${appel}
</script>
<p>{session.a}</p>
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

describe('reffets devant un état partagé : l\'appelable du même script appelé pendant le passage', () => {
  let vues: Record<string, boolean>
  before(async () => {
    vues = marques((await transpile(RELEVE, { moduleName: 'ap-releve' } as any)).output)
  })

  it('chaque forme est relevée', () => {
    assert.deepEqual(Object.keys(vues).sort(), [...PRECIS, ...DOUTE].map(([nom]) => nom).sort())
  })

  it('l\'appelé que le relevé ne trouve pas, ou qui remet à plus tard du code hors de la liste blanche, pose la marque du doute', () => {
    assert.deepEqual(DOUTE.filter(([nom]) => !vues[nom]).map(([nom]) => nom), [])
  })

  it('l\'appelé trouvé et sans reproche, la fonction importée, le langage et le navigateur ne posent aucune marque', () => {
    assert.deepEqual(PRECIS.filter(([nom]) => vues[nom]).map(([nom]) => nom), [])
  })

  for (const [nom, pose, doute] of IMPLICITES) it(`${nom} : ${doute ? 'la marque du doute' : 'aucune marque'}`, async () => {
    assert.deepEqual(marques((await transpile(implicite(pose), { moduleName: 'ap-implicite' } as any)).output), { lecteur: doute })
  })

  for (const [nom, pose, appel, doute] of CLES_NON_LUES) it(`${nom} : ${doute ? 'la marque du doute' : 'aucune marque'}`, async () => {
    assert.deepEqual(marques((await transpile(cleNonLue(pose, appel), { moduleName: 'ap-cle' } as any)).output), { lecteur: doute })
  })

  it('une fonction rangée sous une clé calculée : la méthode appelée par son nom pose la marque du doute', async () => {
    assert.deepEqual(marques((await transpile(CLE_CALCULEE, { moduleName: 'ap-calculee' } as any)).output), { lecteur: true })
  })

  it('un reffet donné par le nom d\'une fonction du script : affectée une fois, aucune marque ; affectée deux fois, la marque du doute', async () => {
    const parNom = (suite: string): string => `<script>\n  @import { session } 'ap-etats.civet.mjs'\n  $y = 0\n  suivre = -> window.lu = [$y, session.a].join()\n${suite}  µeffect suivre\n</script>\n<p>{session.a}</p>\n`
    assert.match((await transpile(parNom(''), { moduleName: 'ap-nom' } as any)).output, /µ\.effect\(suivre, \["y"\]\)/)
    assert.match((await transpile(parNom('  µmount -> suivre = -> 1\n'), { moduleName: 'ap-nom' } as any)).output, /µ\.effect\(suivre, \["y"\], 1\)/)
  })

  it('"reffetsAll" : le relevé ne pose aucune marque', async () => {
    const sans = marques((await transpile(RELEVE, { moduleName: 'ap-releve', reffetsAll: true } as any)).output)
    assert.deepEqual(Object.keys(sans).filter((nom) => sans[nom]), [])
  })
})

// ── 2. la scène : chaque appelable range dans `window.__v` l'état lu plus tard ; l'état change, la valeur suit ──
const ETATS = `export session = µ.state({ a: 0, b: 0 })
export differe = (f) -> (-> setTimeout(f, 5))
export lireImp = -> session.a
`
const FORMES: [string, string][] = [
  ['objet', 'outils.relire()'],
  ['fabriquee', 'tardif()'],
  ['importee', 'tardifImp()'],
  ['variable', '$tard()'],
  ['objetRange', '$api.charger()'],
  ['methode', '@@sauver()'],
  ['classe', 'minuteur.lancer()'],
  ['reaffectee', 'relire()'],
  ['accesseur', 'boite.rejouer()'],
]
const lit = (k: string): string => `window.__v.${k} = session.a`
const LECTEUR = `<script>
  @import { session differe } 'ap-etats.civet.mjs'
  vu = (k) -> window.__n[k] = (window.__n[k] or 0) + 1
  window.__el = this
  $y = 0
  $pret = false
  @ecrire = (v) -> session.a = v
  @ecrireB = (v) -> session.b = v
  fabrique = (f) -> (-> µafter 5, f)
  outils = { relire: (-> µafter 5, -> ${lit('objet')}), lire: (-> session.a), ranger: (-> µafter 5, -> $pret = true) }
  tardif = fabrique(-> ${lit('fabriquee')})
  tardifImp = differe(-> ${lit('importee')})
  tardifAcc = fabrique(-> ${lit('accesseur')})
  boite = { get rejouer() { return tardifAcc } }
  $tard = -> µafter 5, -> ${lit('variable')}
  $api = { charger: -> µafter 5, -> ${lit('objetRange')} }
  @sauver = differe(-> ${lit('methode')})
  class Minuteur
    lancer() { µafter 5, -> ${lit('classe')} }
  minuteur = new Minuteur()
  relire = -> 'rien'
  µmount ->
    relire = -> µafter 5, -> ${lit('reaffectee')}
${FORMES.map(([nom, appel]) => `  µeffect ->\n    vu('${nom}')\n    y = $y\n    ${appel}`).join('\n')}
  µeffect ->
    vu('trouveeQuiLit')
    window.__v.trouveeQuiLit = [$y, outils.lire()].join()
  µeffect ->
    vu('trouveeQuiRange')
    y = $y
    outils.ranger()
  µeffect ->
    vu('temoin')
    window.__v.temoin = $y
</script>
<p>{session.a} {session.b}</p>
`

type Jeu = { depart: Record<string, unknown>, pas: Record<string, { passages: Record<string, number>, valeurs: Record<string, unknown> }> }
async function jouer(nom: string, opts: Record<string, unknown>): Promise<Jeu> {
  const root   = mjsTmp('reffets-appelable-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'ap-etats.civet.mjs'), ETATS)
  writeFileSync(join(srcDir, 'ap-lecteur.mjs'), LECTEUR)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js: 'bundle', minify: false, ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const code   = readFileSync(join(outDir, 'bundle.js'), 'utf-8')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  try {
    window.__n = {}
    window.__v = {}
    window.eval(code.replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, ''))
    window.document.body.innerHTML = '<mjs-ap-lecteur></mjs-ap-lecteur>'
    const fin = Date.now() + 5000
    while (Object.keys(window.__n).length < FORMES.length + 3 && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 80))
    const depart = { ...window.__v }
    const pas: Jeu['pas'] = {}
    for (const [geste, code] of [['a = 1', 'window.__el.ecrire(1)'], ['b = 1', 'window.__el.ecrireB(1)'], ['a = 2', 'window.__el.ecrire(2)']]) {
      const avant = { ...window.__n }
      window.eval(code)
      await new Promise((r) => setTimeout(r, 80))
      const passages: Record<string, number> = {}
      for (const k of Object.keys(window.__n)) if (window.__n[k] !== avant[k]) passages[k] = window.__n[k] - avant[k]
      pas[geste] = { passages, valeurs: { ...window.__v } }
    }
    return JSON.parse(JSON.stringify({ depart, pas }))
  }
  finally {
    await window.happyDOM.close()
  }
}

describe('reffets devant un état partagé : l\'appelable du même script qui remet la lecture à plus tard, la scène', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [mode, opts] of [['production', { env: 'prod' }], ['développement', { env: 'dev' }]] as [string, Record<string, unknown>][]) {
    describe(mode, () => {
      let jeu: Jeu
      before(async () => { jeu = await jouer(mode === 'production' ? 'prod' : 'dev', opts) })

      it('au départ, chaque appelable a rangé la valeur de l\'état (la fonction réaffectée au montage ne l\'est pas encore)', () => {
        for (const [nom] of FORMES) assert.equal(jeu.depart[nom], nom === 'reaffectee' ? undefined : 0, nom)
      })

      for (const [nom] of FORMES) it(`${nom} : l'état change, la valeur rangée plus tard suit`, () => {
        assert.equal(jeu.pas['a = 1'].valeurs[nom], 1, `${nom} après a = 1`)
        assert.equal(jeu.pas['a = 2'].valeurs[nom], 2, `${nom} après a = 2`)
      })

      it('la méthode trouvée qui lit pendant le passage : sa lecture est notée, le reffet suit l\'état qu\'il a lu, pas l\'autre', () => {
        assert.equal(jeu.pas['a = 1'].valeurs.trouveeQuiLit, '0,1')
        assert.equal(jeu.pas['a = 2'].valeurs.trouveeQuiLit, '0,2')
        assert.equal(jeu.pas['b = 1'].passages.trouveeQuiLit, undefined)
      })

      it('la méthode trouvée qui ne range qu\'une variable, et le reffet témoin, ne passent pas quand l\'état change', () => {
        for (const geste of ['a = 1', 'b = 1', 'a = 2']) {
          assert.equal(jeu.pas[geste].passages.trouveeQuiRange, undefined, `trouveeQuiRange, ${geste}`)
          assert.equal(jeu.pas[geste].passages.temoin, undefined, `temoin, ${geste}`)
        }
      })
    })
  }
})
