// types : un module .js importé qui nomme µ reçoit le cœur par un import, en production comme en développement, et les modules du
// cœur qu'il nomme entrent ; le `type: Nom` d'un verbe n'est une donnée que si `Nom` est lié dans le fichier (lu sur le code compilé) ;
// `type: Nom[]` après un rappel arrête la construction avec la forme à écrire ; le refus de deux règles d'un magasin ne montre pas une
// écriture refusée ; un .js qui cite une règle nommée suit le changement de la règle ; un refus dans un <script module> le nomme

import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const T_REWARD = ['<types>', 'Reward', '  id     int 1..', '  title  string 1..80', '  price = 0 int 0..', '</types>'].join('\n')
const BRUT     = "export function chargerBrut () {\n  return new Promise((ok, ko) => µ.ajax.get('/app/rewards', ok, ko))\n}"
const APPEL    = "export async function chargerType () {\n  return await µajax('/app/rewards', { type: Reward[] })\n}"
const ALPHA    = (module: string, nom: string): string => `<script>\n@import { ${nom} } '${module}'\nload = -> $r = await ${nom}()\n</script>\n<p>{$r}</p>`

// une appli construite comme par `mjs build` (ou `mjs dev`), deux fois si `ensuite` change des fichiers entre les deux : ses erreurs,
// et chaque fichier .js écrit, par chemin
async function construire(fichiers: Record<string, string>, o: { dev?: boolean, ensuite?: Record<string, string> } = {}): Promise<{ erreurs: string[], ecrits: Record<string, string> }> {
  const racine  = mkdtempSync(join(tmpdir(), 'types-js-'))
  const journal = [console.log, console.warn, console.error]
  try {
    const src = join(racine, 'src')
    const out = join(racine, 'out')
    mkdirSync(src, { recursive: true })
    for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(src, nom), texte + '\n')
    const b: any = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(racine, 'bundle.js'), minify: false } as any)
    b.envMode = o.dev ? 'dev' : 'prod'
    console.log = console.warn = console.error = () => {}
    let st: any = await b.compile()
    if (o.ensuite) {
      for (const [nom, texte] of Object.entries(o.ensuite)) writeFileSync(join(src, nom), texte + '\n')
      st = await b.compile()
    }
    const ecrits: Record<string, string> = {}
    for (const f of existsSync(out) ? (readdirSync(out, { recursive: true }) as string[]).map(String).filter(f => f.endsWith('.js')) : []) ecrits[f] = readFileSync(join(out, f), 'utf-8')
    return { erreurs: (st.errors ?? []).map((e: any) => String(e?.message ?? e)), ecrits }
  }
  finally {
    [console.log, console.warn, console.error] = journal
    rmSync(racine, { recursive: true, force: true })
  }
}

// une appli de développement suivie comme par `mjs dev` : construite, puis `ensuite` écrit pendant la surveillance ; les erreurs de la
// reconstruction, et chaque fichier .js écrit après elle, par chemin
async function surveiller(fichiers: Record<string, string>, ensuite: Record<string, string>): Promise<{ erreurs: string[], ecrits: Record<string, string> }> {
  const racine  = mkdtempSync(join(tmpdir(), 'types-js-dev-'))
  const journal = [console.log, console.warn, console.error]
  const src     = join(racine, 'src')
  const out     = join(racine, 'out')
  mkdirSync(src, { recursive: true })
  for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(src, nom), texte + '\n')
  const b: any = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(racine, 'bundle.js'), minify: false } as any)
  b.envMode = 'dev'
  const tours: any[] = []
  const attendre = async (n: number): Promise<void> => {
    for (let i = 0; i < 300 && tours.length < n; i++) await new Promise(r => setTimeout(r, 50))
  }
  console.log = console.warn = console.error = () => {}
  try {
    b.watch({ onRecompile: (_: string, st: any) => tours.push(st) }).catch((e: unknown) => tours.push({ errors: [e] }))
    await attendre(1)
    await new Promise(r => setTimeout(r, 500))
    for (const [nom, texte] of Object.entries(ensuite)) writeFileSync(join(src, nom), texte + '\n')
    await attendre(2)
    const ecrits: Record<string, string> = {}
    for (const f of existsSync(out) ? (readdirSync(out, { recursive: true }) as string[]).map(String).filter(f => f.endsWith('.js')) : []) ecrits[f] = readFileSync(join(out, f), 'utf-8')
    return { erreurs: tours.length < 2 ? ['aucune reconstruction après le changement'] : (tours[1]?.errors ?? []).map((e: any) => String(e?.message ?? e)), ecrits }
  }
  finally {
    await b.close()
    ;[console.log, console.warn, console.error] = journal
    rmSync(racine, { recursive: true, force: true })
  }
}

// le seul fichier écrit dont le nom commence par `debut-`
function ecrit(ecrits: Record<string, string>, debut: string): string {
  const noms = Object.keys(ecrits).filter(f => basename(f).startsWith(debut + '-'))
  assert.equal(noms.length, 1, `${debut} : ${Object.keys(ecrits).join(', ')}`)
  return ecrits[noms[0]]
}

describe('types : module .js importé, nom lié, messages sans écriture refusée', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const [module, nom, texte] of [['brut.js.mjs', 'chargerBrut', BRUT], ['appel.js.mjs', 'chargerType', APPEL]] as const) {
    for (const dev of [false, true]) {
      it(`un module .js.mjs qui nomme µ reçoit le cœur par un import, sans repère — ${module}, ${dev ? 'développement' : 'production'}`, async () => {
        const { erreurs, ecrits } = await construire({ 'app.types.mjs': T_REWARD, [module]: texte, 'alpha.mjs': ALPHA(module, nom) }, { dev })
        assert.deepEqual(erreurs, [])
        const js = ecrit(ecrits, module.replace('.mjs', ''))
        const m  = /^import \{ µ \} from '([^']+)';/.exec(js)
        assert.ok(m, js.slice(0, 200))
        assert.ok(basename(m![1]).startsWith('mjs_core-') && !m![1].includes('-ZZZZZ.'), m![1])
        assert.ok(Object.keys(ecrits).some(f => basename(f) === basename(m![1])), `${m![1]} absent de : ${Object.keys(ecrits).join(', ')}`)
      })
    }
  }

  it('un module .js.mjs qui n\'écrit que µ.ajax.get : le module µajax entre au cœur de production', async () => {
    const { erreurs, ecrits } = await construire({ 'brut.js.mjs': BRUT, 'alpha.mjs': ALPHA('brut.js.mjs', 'chargerBrut') })
    assert.deepEqual(erreurs, [])
    assert.match(ecrit(ecrits, 'mjs_core'), /µ\.ajax\.get\s*=\s*function/)
  })

  const MENTIONS: [string, Record<string, string>, string][] = [
    ['console.log Reward', { 'alpha.mjs': "<script>\nµmount ->\n  console.log Reward\n  µajax.post '/app/rewards', type: Reward, (r) -> $x = r\n</script>\n<p>{$x}</p>" }, '<script>, ligne 4'],
    ['(r) -> $x = [r, Reward]', { 'alpha.mjs': "<script>\nµmount ->\n  µajax.post '/app/rewards', type: Reward, (r) -> $x = [r, Reward]\n</script>\n<p>{$x}</p>" }, '<script>, ligne 3'],
    ['module .coffee, console.log Reward', { 'charger.coffee.mjs': "console.log Reward\nexport charger = -> µajax.post '/app/rewards', type: Reward, (r) -> r", 'alpha.mjs': ALPHA('charger.coffee.mjs', 'charger') }, 'charger.coffee.mjs, ligne 2'],
  ]
  for (const [nom, fichiers, ou] of MENTIONS) {
    it(`un nom écrit sans être lié n'est pas une donnée : la construction s'arrête et dit comment garder une donnée — ${nom}`, async () => {
      const { erreurs } = await construire({ 'app.types.mjs': T_REWARD, ...fichiers })
      assert.equal(erreurs.length, 1, erreurs.join('\n'))
      assert.ok(erreurs[0].includes(ou) && erreurs[0].includes('window.Reward pour une variable globale') && erreurs[0].includes("µajax '/url', method: 'POST'"), erreurs[0])
    })
  }

  it('un nom lié par une déstructuration reste une donnée', async () => {
    const { erreurs, ecrits } = await construire({ 'app.types.mjs': T_REWARD, 'alpha.mjs': "<script>\nµmount ->\n  { type: Reward } = { type: 'cadeau' }\n  µajax.post '/app/rewards', type: Reward, (r) -> $x = r\n</script>\n<p>{$x}</p>" })
    assert.deepEqual(erreurs, [])
    assert.doesNotMatch(ecrit(ecrits, 'alpha'), /_mjs_tajax/)
  })

  const APRES: [string, Record<string, string>, string][] = [
    ['composant', { 'alpha.mjs': "<script>\nµmount ->\n  µajax.get '/app/rewards', ((r) -> r), type: Reward[]\n</script>\n<p>a</p>" }, '<script>, ligne 3'],
    ['module .js', { 'charger.js.mjs': "export function charger () {\n  return µajax.post('/x', function (r) { return r }, { type: Reward[] })\n}", 'alpha.mjs': ALPHA('charger.js.mjs', 'charger') }, 'charger.js.mjs, ligne 2'],
  ]
  for (const [nom, fichiers, ou] of APRES) {
    it(`type: Nom[] après un rappel : un message qui montre la forme à écrire, plutôt que l'erreur du langage — ${nom}`, async () => {
      const { erreurs } = await construire({ 'app.types.mjs': T_REWARD, ...fichiers })
      assert.equal(erreurs.length, 1, erreurs.join('\n'))
      assert.ok(erreurs[0].includes(ou) && erreurs[0].includes('« type: Reward[] »') && erreurs[0].includes('type: Reward[]'), erreurs[0])
    })
  }

  it('deux magasins aux valeurs de départ différentes : refusés, la valeur de départ dite en mots, jamais écrite entre accolades', async () => {
    const T2 = (a: string, b: string): string => `<types>\nPanierA\n  total = ${a} int 0..\nPanierB\n  total = ${b} int 0..\n</types>`
    const appli = (a: string, b: string): Record<string, string> => ({ 'app.types.mjs': T2(a, b), 'a.mjs': '<vars>\n$$panier PanierA\n</vars>\n<p>{$$panier.total}</p>', 'b.mjs': '<vars>\n$$panier PanierB\n</vars>\n<p>{$$panier.total}</p>' })
    const { erreurs } = await construire(appli('0', '1'))
    assert.equal(erreurs.length, 1, erreurs.join('\n'))
    assert.ok(erreurs[0].includes('valeur de départ 0') && erreurs[0].includes('valeur de départ 1'), erreurs[0])
    assert.doesNotMatch(erreurs[0], /total\??\s*=\s*\d/)
    assert.deepEqual((await construire(appli('0', '0'))).erreurs, [])
  })

  // le composant importe aussi des modules .coffee et .civet qui citent la règle, comme dans une vraie appli
  it('module .js.mjs qui cite une règle nommée, sous mjs dev : la borne changée entre dans son contrôle, sans relancer', async () => {
    const modules = { 'charger.coffee.mjs': "export charger = -> await µajax '/app/rewards', type: Reward[]", 'chargeur.civet.mjs': "export async function chargeur() { return await µajax('/app/rewards', { type: Reward[] }) }" }
    const alpha   = "<script>\n@import { charger } 'charger.coffee.mjs'\n@import { chargerType } 'appel.js.mjs'\n@import { chargeur } 'chargeur.civet.mjs'\nload = -> $r = [await charger(), await chargerType(), await chargeur()]\n</script>\n<p>{$r}</p>"
    const { erreurs, ecrits } = await surveiller({ 'app.types.mjs': T_REWARD, ...modules, 'appel.js.mjs': APPEL, 'alpha.mjs': alpha }, { 'app.types.mjs': T_REWARD.replace('id     int 1..', 'id     int 5..') })
    assert.deepEqual(erreurs, [])
    const js = ecrit(ecrits, 'appel.js')
    assert.match(js, /int 5\.\./)
    assert.doesNotMatch(js, /int 1\.\./)
    const nom = basename(Object.keys(ecrits).find(f => basename(f).startsWith('appel.js-'))!)
    assert.ok(ecrit(ecrits, 'alpha').includes(nom), `le composant importe ${nom}`)
  })

  it('le refus d\'un verbe dans un <script module> nomme <script module>', async () => {
    const { erreurs } = await construire({ 'app.types.mjs': T_REWARD, 'alpha.mjs': "<script module>\nx = 1\nexport charger = -> µajax.get '/app/rewards', type: Reward[], (r) -> r\n</script>\n<script>\nload = -> $r = await charger()\n</script>\n<p>{$r}</p>" })
    assert.equal(erreurs.length, 1, erreurs.join('\n'))
    assert.ok(erreurs[0].includes('<script module>, ligne 3'), erreurs[0])
  })
})
