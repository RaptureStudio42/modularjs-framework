// Un reffet qui, APRÈS son passage, passe un état partagé en valeur (`JSON.stringify(session)` dans une minuterie, `{nom} = session` après un
// `await`), appelle une fonction que le relevé ne voit pas (importée, écrite dans le `<script module>`) ou passe une méthode qui lit l'état
// (`µafter 5, @@afficher`) est dans le doute : il passe à chaque rendu demandé par un état partagé, comme avant. Un composant qui tient par une
// variable `$` un objet d'un `µStore` (`$lignes = panier.data.lignes`) fait passer tous ses reffets quand ce magasin le prévient : il lit
// l'objet par sa propre enveloppe, aucune lecture n'est notée. Un rappel qui lit le document (`requestAnimationFrame(-> … document.title)`)
// sort de la liste blanche du relevé : doute aussi. Un état lu pour la première fois dans une branche prise plus tard n'abonne pas son
// composant. Le gain reste : un reffet qui ne lit qu'une clé du magasin, et dont le code différé ne fait qu'écrire une variable `$`, ne
// passe pas. Production et développement, happy-dom.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const VU = `vu = (k) -> window.__n[k] = (window.__n[k] or 0) + 1
`
const COMPOSANTS: Record<string, string> = {
  'rd-etats.civet.mjs': `export µ$$compte = { a: 0 }
export session = µ.state({ nom: 'x' })
export panier = new µStore(total: 0, lignes: [])
export nomCourant = -> session.nom
`,
  'rd-coquille.mjs': `<script module>
  export adresseParModule = -> µnav.href
</script>
<script>
  @import µ$$compte 'rd-etats.civet.mjs'
  @import { session panier nomCourant } 'rd-etats.civet.mjs'
  ${VU}  $x = 0
  $pret = false
  $lignes = panier.data.lignes
  @afficher = -> window.__v.methode = session.nom
  @ecrireA = (v) -> µ$$compte.a = v
  @ecrireNom = (v) -> session.nom = v
  @pousser = (v) -> panier.data.lignes.push(v)
  @ecrireRel = (v) -> $$rel = v
  µeffect ->
    vu('valeur')
    v = $x
    µafter 5, -> window.__v.valeur = [v, JSON.stringify(session)].join()
  µeffect ->
    vu('magasinValeur')
    v = $x
    µafter 5, -> window.__v.magasinValeur = [v, JSON.stringify(µ$$compte)].join()
  µeffect ->
    vu('decompose')
    v = $x
    await Promise.resolve()
    {nom} = session
    window.__v.decompose = [v, nom].join()
  µeffect ->
    vu('importee')
    v = $x
    await Promise.resolve()
    window.__v.importee = [v, nomCourant()].join()
  µeffect ->
    vu('module')
    v = $x
    await Promise.resolve()
    window.__v.module = [v, adresseParModule()].join()
  µeffect ->
    vu('methode')
    v = $x
    µafter 5, @@afficher
  µeffect ->
    vu('tenu')
    window.__v.tenu = [$x, $lignes.length].join()
  µeffect ->
    vu('theme')
    window.__v.theme = $$rel
    papier = -> document.title
    requestAnimationFrame(-> window.__v.themeImage = papier())
  µeffect ->
    vu('sobre')
    window.__v.sobre = $$rel
    µafter 5, -> $pret = true
  µeffect ->
    vu('local')
    window.__v.local = $x
</script>
<p>{session.nom} {µ$$compte.a} {µnav.href} {panier.data.lignes.length}</p>
`,
  'rd-tard.mjs': `<script>
  @import { session } 'rd-etats.civet.mjs'
  ${VU}  $mode = false
  @ecrireMode = (v) -> $mode = v
  µeffect ->
    vu('tard')
    window.__v.tard = if $mode then session.nom else 'non prise'
</script>
<p>{$mode}</p>
`,
}

const PAGE     = ['rd-coquille', 'rd-tard']
const CORPS    = PAGE.map((n) => `<mjs-${n}></mjs-${n}>`).join('')
const SCENARIO = `(async () => {
  const R = []
  const el = (n) => document.querySelector('mjs-' + n)
  async function pas(nom, f) {
    const avant = { ...window.__n }
    f()
    await new Promise((r) => setTimeout(r, 60))
    R.push([nom, Object.keys(window.__n).filter((k) => window.__n[k] !== avant[k]).sort()])
  }
  await pas('état de module écrit', () => el('rd-coquille').ecrireNom('y'))
  await pas('µ$$x écrit', () => el('rd-coquille').ecrireA(1))
  await pas('µnav écrit en JavaScript nu', () => { µ.nav.href = '/a' })
  await pas('liste du µStore tenue par une variable : ligne ajoutée', () => el('rd-coquille').pousser('l1'))
  await pas('branche prise plus tard', () => el('rd-tard').ecrireMode(true))
  await pas('état de module écrit ensuite', () => el('rd-coquille').ecrireNom('z'))
  await pas('clé du magasin écrite', () => el('rd-coquille').ecrireRel('r'))
  return { pas: R, valeurs: window.__v }
})()`

// les reffets du doute : ils passent à chaque rendu demandé par un état partagé que leur composant lit
const DOUTE = ['decompose', 'importee', 'magasinValeur', 'methode', 'module', 'theme', 'valeur']
const PASSAGES: [string, string[]][] = [
  ['état de module écrit', DOUTE],
  ['µ$$x écrit', DOUTE],
  ['µnav écrit en JavaScript nu', DOUTE],
  // le magasin écrit dans la liste que le composant tient par `$lignes` : tous ses reffets passent, comme avant
  ['liste du µStore tenue par une variable : ligne ajoutée', [...DOUTE, 'local', 'sobre', 'tenu'].sort()],
  ['branche prise plus tard', ['tard']],
  // la branche prise plus tard n'abonne pas son composant : `tard` ne repart pas
  ['état de module écrit ensuite', DOUTE],
  ['clé du magasin écrite', ['sobre', 'theme']],
]

type Jeu = { montage: Record<string, number>, pas: [string, string[]][], valeurs: Record<string, unknown>, avertissements: string[] }

async function jouer(env: string): Promise<Jeu> {
  const root   = mjsTmp('reffets-doute-apres-coup-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, texte] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom), texte)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js: 'bundle', minify: false, env } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const code = readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
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
    await new Promise((r) => setTimeout(r, 80))
    const montage = { ...window.__n }
    const r = await window.eval(SCENARIO)
    return JSON.parse(JSON.stringify({ montage, pas: r.pas, valeurs: r.valeurs, avertissements }))
  }
  finally {
    await window.happyDOM.close()
  }
}

describe('reffets devant un état partagé : le doute après coup, l\'objet d\'un magasin tenu par une variable, la branche prise plus tard', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const env of ['prod', 'dev']) describe(env === 'prod' ? 'production' : 'développement', () => {
    let jeu: Jeu
    before(async () => {
      jeu = await jouer(env)
    })

    it('au montage, chaque reffet passe une fois', () => {
      assert.deepEqual(jeu.montage, { valeur: 1, magasinValeur: 1, decompose: 1, importee: 1, module: 1, methode: 1, tenu: 1, theme: 1, sobre: 1, local: 1, tard: 1 })
    })

    it('reffets passés, pas à pas', () => {
      assert.deepEqual(jeu.pas, PASSAGES)
    })

    it('valeurs lues à la fin : aucune n\'est périmée', () => {
      const { valeur, magasinValeur, decompose, importee, module, methode, tenu, tard, theme } = jeu.valeurs
      assert.deepEqual({ valeur, magasinValeur, decompose, importee, module, methode, tenu, tard, theme }, { valeur: '0,{"nom":"z"}', magasinValeur: '0,{"a":1}', decompose: '0,z', importee: '0,z', module: '0,/a', methode: 'z', tenu: '0,1', tard: 'y', theme: 'r' })
    })

    it('aucun avertissement', () => {
      assert.deepEqual(jeu.avertissements, [])
    })
  })
})
