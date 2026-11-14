// la vraie portée des noms. Un .js ordinaire est une bibliothèque, copiée à l'octet : s'il lit µ sans qu'aucune portée qui englobe
// cette lecture ne le lie, la construction s'arrête et dit de le nommer `nom.js.mjs`, en développement comme en production. Un
// `nom.js.mjs` est un module MJS écrit en JavaScript, compilé comme un module .civet : µ fourni, `@import`, la forme appelable et
// `type:`, recompilé quand un *.types.mjs change ; jamais un composant. Le `type: Reward` d'un appel par verbe n'est une donnée que si
// une liaison de Reward englobe l'appel (composant, module .js.mjs, module .coffee), y compris dans une expression (`[Reward]`, `Reward.id`)

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const T_REWARD = '<types>\nReward\n  id     int 1..\n  title  string 1..80\n  price = 0 int 0..\n</types>'
const OU_LIER  = 'au premier niveau du fichier ou dans la fonction qui fait l\'appel'

interface Construction { erreurs: string[], ecrits: Record<string, string> }

// les erreurs d'un tour de construction, et les fichiers .js écrits, par chemin
async function tour(b: any, out: string): Promise<Construction> {
  const journal = [console.log, console.warn, console.error]
  console.log = console.warn = console.error = () => {}
  let erreurs: string[] = []
  try {
    const st: any = await b.compile()
    erreurs = (st.errors ?? []).map((e: any) => String(e?.message ?? e))
  }
  catch (e: any) {
    erreurs = [String(e?.message ?? e)]
  }
  finally {
    [console.log, console.warn, console.error] = journal
  }
  const ecrits: Record<string, string> = {}
  for (const f of existsSync(out) ? (readdirSync(out, { recursive: true }) as string[]).map(String).filter(f => f.endsWith('.js')) : []) ecrits[f] = readFileSync(join(out, f), 'utf-8')
  return { erreurs, ecrits }
}

// une appli construite comme par `mjs build` (de production, sauf `dev`, non minifiée) ; `ensuite` rejoue des tours sur le même projet
async function construire(fichiers: Record<string, string>, o: { dev?: boolean, ensuite?: (src: string, refaire: () => Promise<Construction>) => Promise<void> } = {}): Promise<Construction> {
  const racine = mkdtempSync(join(tmpdir(), 'types-portee-'))
  try {
    const src = join(racine, 'src')
    const out = join(racine, 'out')
    mkdirSync(src, { recursive: true })
    for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(src, nom), texte + '\n')
    const b: any = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(racine, 'bundle.js'), minify: false } as any)
    b.envMode = o.dev ? 'dev' : 'prod'
    const r = await tour(b, out)
    if (o.ensuite) await o.ensuite(src, () => tour(b, out))
    return r
  }
  finally {
    rmSync(racine, { recursive: true, force: true })
  }
}

// le texte du seul fichier écrit dont le nom publié commence par `debut-`
function fichier(ecrits: Record<string, string>, debut: string): string {
  const vus = Object.keys(ecrits).filter(f => f.split('/').pop()!.startsWith(debut + '-'))
  assert.equal(vus.length, 1, `${debut} : ${Object.keys(ecrits).join(', ')}`)
  return ecrits[vus[0]]
}

const IMPORT_DU_COEUR = /^import \{ µ \} from '\/out\/mjs_core-[^'/]+\.js';?$/m
const charger         = (module: string): string => `<script>\n@import { charger } '${module}'\nload = -> $r = await charger()\n</script>\n<p>{$r}</p>`
const verbe           = (avant: string, rappel = '(r) -> $x = r'): string => `<script>\n${avant}\nµmount ->\n  µajax.post '/app/kind', type: Reward, ${rappel}\n</script>\n<p>{$x}</p>`
const options         = (avant: string, opts: string): string => `<script>\n${avant}\nµmount ->\n  µajax.post '/app/kind', ${opts}, (r) -> $x = r\n</script>\n<p>{$x}</p>`

// la construction s'est arrêtée sur ce `type:` : le fichier, la ligne, le texte écrit, et où lier le nom
function arretee(r: Construction, bloc: string, ligne: number, ecrit: string): void {
  const tout = r.erreurs.join('\n')
  assert.ok(tout.includes(`${bloc}, ligne ${ligne} : « type: ${ecrit} »`), tout || 'aucune erreur')
  assert.ok(tout.includes('rien ne lie Reward dans une portée qui englobe cet appel'), tout)
  assert.ok(tout.includes(OU_LIER), tout)
}

describe('portée réelle : .js bibliothèque, module .js.mjs, nom lié autour d\'un appel par verbe', function () {
  this.timeout(180000)
  after(() => terminateSharedWorkerPool())

  it('un .js ordinaire qui lit µ arrête la construction, en développement comme en production : le message dit de le nommer .js.mjs', async () => {
    const effets = "µ.ajax.get('/app/rewards', function (r) { window.__effet = r })"
    const mod    = "export function local (µ) { return µ }\nexport function charger () { return new Promise((ok, ko) => µ.ajax.get('/app/rewards', ok, ko)) }"
    for (const dev of [false, true]) {
      const r = await construire({ 'effets.js': effets, 'mod.js': mod, 'alpha.mjs': "<script>\n@import 'effets.js'\n</script>\n<p>a</p>", 'beta.mjs': charger('mod.js') }, { dev })
      const tout = r.erreurs.join('\n')
      assert.ok(tout.includes('effets.js : ce fichier se sert de µ : nommez-le effets.js.mjs'), tout || 'aucune erreur')
      assert.ok(tout.includes('mod.js : ce fichier se sert de µ : nommez-le mod.js.mjs'), tout)
    }
  })

  it('un .js ordinaire est une bibliothèque copiée à l\'octet : sans µ, derrière une ligne #!, ou avec un µ qu\'il lie lui-même (ni import, ni réécriture de µ.ajax(…) ni de type:)', async () => {
    const sources = {
      'brut.js': 'export function double (x) { return x * 2 }',
      'bang.js': '#!/usr/bin/env node\nexport function triple (x) { return x * 3 }',
      'lie.js':  "const µ = globalThis.monOutil\nexport function lire () { return µ.ajax('/app/rewards', { type: Reward }) }",
    }
    const r = await construire({ 'app.types.mjs': T_REWARD, ...sources, 'alpha.mjs': "<script>\n@import { double } 'brut.js'\n@import { triple } 'bang.js'\n@import { lire } 'lie.js'\nload = -> $r = double(triple(1)) + lire()\n</script>\n<p>{$r}</p>" })
    assert.deepEqual(r.erreurs, [])
    for (const [nom, texte] of Object.entries(sources)) assert.equal(fichier(r.ecrits, nom.replace('.js', '')), texte + '\n', nom)
  })

  it('un module .js.mjs importé pour son seul effet reçoit µ par l\'import du cœur, en production ; il n\'est pas un composant', async () => {
    const r = await construire({ 'effets.js.mjs': "µ.ajax.get('/app/rewards', function (r) { window.__effet = r })", 'alpha.mjs': "<script>\n@import 'effets.js.mjs'\n</script>\n<p>a</p>" })
    assert.deepEqual(r.erreurs, [])
    const ecrit = fichier(r.ecrits, 'effets.js')
    assert.match(ecrit, IMPORT_DU_COEUR)
    assert.match(ecrit, /µ\.ajax\.get\('\/app\/rewards'/)
    assert.ok(!/customElements|mjs-effets/.test(ecrit), ecrit)
    assert.ok(!Object.values(r.ecrits).some(t => t.includes('ZZZZZ')), 'aucun repère interne dans les fichiers écrits')
    assert.match(fichier(r.ecrits, 'alpha'), /import ['"]\/out\/effets\.js-[^'"]+\.js['"]/)
  })

  it('un module .js.mjs : @import d\'un autre module, la forme appelable de µajax et type: s\'y écrivent comme dans un module .civet', async () => {
    const r = await construire({ 'app.types.mjs': T_REWARD, 'calc.js.mjs': 'export function double (x) { return x * 2 }', 'outils.js.mjs': "@import { double } 'calc.js.mjs'\nexport async function charger () {\n  const liste = await µajax('/app/rewards', { type: Reward[] })\n  return liste.map(r => double(r.id))\n}", 'alpha.mjs': charger('outils.js.mjs') })
    assert.deepEqual(r.erreurs, [])
    const outils = fichier(r.ecrits, 'outils.js')
    assert.match(outils, IMPORT_DU_COEUR)
    assert.match(outils, /µ\._mjs_ajax\('\/app\/rewards', \{ type: µ\._mjs_tajax\(/)
    assert.match(outils, /from ['"]\/out\/calc\.js-[^'"]+\.js['"]/)
  })

  it('un module .js.mjs qui cite une règle est recompilé en développement quand le fichier *.types.mjs change', async () => {
    const r = await construire({ 'app.types.mjs': T_REWARD, 'outils.js.mjs': "export async function charger () { return await µajax('/app/rewards', { type: Reward[] }) }", 'alpha.mjs': charger('outils.js.mjs') }, {
      dev:     true,
      ensuite: async (src, refaire) => {
        writeFileSync(join(src, 'app.types.mjs'), T_REWARD.replace('id     int 1..', 'id     int 5..') + '\n')
        const apres = await refaire()
        assert.deepEqual(apres.erreurs, [])
        assert.ok(fichier(apres.ecrits, 'outils.js').includes('int 5..'), fichier(apres.ecrits, 'outils.js'))
      },
    })
    assert.deepEqual(r.erreurs, [])
    assert.ok(fichier(r.ecrits, 'outils.js').includes('int 1..'), fichier(r.ecrits, 'outils.js'))
  })

  it('composant : une liaison de Reward faite dans une autre fonction, dans le rappel ou dans la boucle d\'une autre fonction arrête la construction, qui dit où lier le nom ; une liaison qui englobe l\'appel en fait une donnée', async () => {
    arretee(await construire({ 'app.types.mjs': T_REWARD, 'alpha.mjs': verbe('garder = (Reward) -> Reward') }), '<script>', 4, 'Reward')
    arretee(await construire({ 'app.types.mjs': T_REWARD, 'alpha.mjs': verbe('x0 = 1', '(r) -> Reward = r') }), '<script>', 4, 'Reward')
    arretee(await construire({ 'app.types.mjs': T_REWARD, 'alpha.mjs': verbe('compter = (l) -> (n for Reward in l)') }), '<script>', 4, 'Reward')
    assert.deepEqual((await construire({ 'app.types.mjs': T_REWARD, 'alpha.mjs': verbe("Reward = 'cadeau'") })).erreurs, [])
    assert.deepEqual((await construire({ 'app.types.mjs': T_REWARD, 'alpha.mjs': "<script>\nenvoyer = (Reward) ->\n  µajax.post '/app/kind', type: Reward, (r) -> $x = r\n</script>\n<p>{$x}</p>" })).erreurs, [])
  })

  it('module .js.mjs : le paramètre Reward d\'une autre fonction ne lie pas le type: Reward de l\'appel', async () => {
    const r = await construire({ 'app.types.mjs': T_REWARD, 'charger.js.mjs': "function garder (Reward) { return Reward }\nexport function charger () { return new Promise((ok, ko) => µ.ajax.post('/app/kind', { type: Reward }, ok, ko)) }", 'alpha.mjs': charger('charger.js.mjs') })
    arretee(r, 'charger.js.mjs', 2, 'Reward')
  })

  it('module .coffee : le paramètre Reward d\'une autre fonction ne lie pas le type: Reward de l\'appel', async () => {
    const r = await construire({ 'app.types.mjs': T_REWARD, 'charger.coffee.mjs': "garder = (Reward) -> Reward\nexport charger = -> µajax.post '/app/kind', type: Reward, (r) -> r", 'alpha.mjs': charger('charger.coffee.mjs') })
    arretee(r, 'charger.coffee.mjs', 2, 'Reward')
  })

  it('type: [Reward] que rien ne lie autour de l\'appel arrête la construction ; lié au premier niveau, une donnée', async () => {
    arretee(await construire({ 'app.types.mjs': T_REWARD, 'alpha.mjs': options('x0 = 1', '{ type: [Reward] }') }), '<script>', 4, '[Reward]')
    assert.deepEqual((await construire({ 'app.types.mjs': T_REWARD, 'alpha.mjs': options("Reward = 'cadeau'", '{ type: [Reward] }') })).erreurs, [])
  })

  it('type: Reward.id que rien ne lie autour de l\'appel arrête la construction ; lié au premier niveau, une donnée', async () => {
    arretee(await construire({ 'app.types.mjs': T_REWARD, 'alpha.mjs': options('x0 = 1', 'type: Reward.id') }), '<script>', 4, 'Reward.id')
    assert.deepEqual((await construire({ 'app.types.mjs': T_REWARD, 'alpha.mjs': options('Reward = { id: 3 }', 'type: Reward.id') })).erreurs, [])
  })
})
