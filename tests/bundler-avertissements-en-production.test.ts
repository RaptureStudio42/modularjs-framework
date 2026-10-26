// les avertissements du framework ne partent plus en production quand le niveau de console les tait
//
// build RÉEL d'une appli (cœur complet, une animation, un composant qui écrit ses propres messages) en production :
//   - au défaut ('error') : aucun appel µ.warn du framework dans le code envoyé, ses appels µ.error restent ;
//   - à 'silent', sans le journal des erreurs : ni µ.warn ni µ.error du framework ;
//   - à 'silent', avec le journal (il lit chaque µ.error pour l'envoyer au serveur) : les µ.error restent ;
//   - à { prod: 'warn' } : avertissements et erreurs sont là, comme avant.
// les appels µ.warn et µ.error écrits dans le code de l'appli restent à tous les niveaux, rendus muets à l'exécution.
// les fichiers de messages perdent, aux niveaux 'error' et 'silent', les textes que seuls des avertissements retirés lisaient
//
// en fichier unique (`js: 'bundle'`), le cœur, l'animation et le composant partagent le même nom court de µ : chaque appel
// `<µ>.warn(` se compte d'un coup ; en fichiers séparés, le cœur seul se compte (le code du framework, sans celui de l'appli)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const AVERTISSEMENT = 'appli : avertissement du programmeur'
const ERREUR        = 'appli : erreur du programmeur'

const SOURCES: Record<string, string> = {
  'app.page.mjs': ['<script>', '  avertir = ->', `    µ.warn '${AVERTISSEMENT}'`, `    µ.error '${ERREUR}'`, '</script>', '', '<button @click=avertir>Avertir</button>', '<div @in=*bars>barres</div>'].join('\n'),
}

// textes que seuls des avertissements du runtime lisent (dont celui de l'avis de développement sur $$mjs-fx-every)
const LUS_PAR_AVERTISSEMENTS = ['fxEveryRefused', 'storeGKey', 'everyInit', 'vtUnknownPreset']
// textes qu'une erreur du runtime, ou un module cœur, lit aussi : ils restent
const LUS_AILLEURS = ['fxLoad', 'i18nLoadSection', 'coreRangeInverted']

interface Built { code: string, coeur: string, messagesFr: string }

async function build(opts: Record<string, unknown>): Promise<Built> {
  const root   = mjsTmp('avertissements-prod')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'dist', 'assets')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), contenu + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', ...opts } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).sort()
  const lire  = (f: string) => readFileSync(join(outDir, f), 'utf-8')
  const fr    = files.find(f => /^mjs_err-fr-.*\.json$/.test(f))
  const coeur = files.find(f => /^mjs_core-.*\.js$/.test(f))
  return { code: files.filter(f => f.endsWith('.js')).map(lire).join('\n'), coeur: coeur ? lire(coeur) : '', messagesFr: fr ? lire(fr) : '' }
}

// le nom court de µ dans le code réduit : celui dont la propriété `log` est définie (`n.log=function(…`)
function nomDeMu(code: string): string {
  const m = code.match(/([\w$]+)\.log=function\(/)
  assert.ok(m, 'la définition de µ.log est introuvable dans le code envoyé')
  return m![1]
}

// les appels `<µ>.warn(` ou `<µ>.error(` du code réduit
function appels(code: string, methode: 'warn' | 'error'): number {
  return (code.match(new RegExp('(?<![\\w$.])' + nomDeMu(code).replace('$', '\\$') + '\\.' + methode + '\\(', 'g')) || []).length
}

describe('avertissements du framework en production — le niveau de console les retire du code envoyé', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  const built: Record<string, Built> = {}
  before(async () => {
    built['défaut']             = await build({ js: 'bundle' })
    built['error']              = await build({ js: 'bundle', logLevel: 'error' })
    built['prod-warn']          = await build({ js: 'bundle', logLevel: { prod: 'warn' } })
    built['warn']               = await build({ js: 'bundle', logLevel: 'warn' })
    built['silent-coeur']       = await build({ js: 'bundle', logLevel: 'silent', runtime: 'core' })
    built['warn-coeur']         = await build({ js: 'bundle', logLevel: 'warn', runtime: 'core' })
    built['silent-journal']     = await build({ js: 'bundle', logLevel: 'silent' })
    built['défaut-fichiers']    = await build({})
    built['prod-warn-fichiers'] = await build({ logLevel: { prod: 'warn' } })
  })

  it('{ prod: \'warn\' } : les avertissements et les erreurs du framework sont dans le code envoyé, comme avant', () => {
    const { code } = built['prod-warn']
    assert.ok(appels(code, 'warn') > 10, `avertissements trouvés : ${appels(code, 'warn')}`)
    assert.ok(appels(code, 'error') > 2, `erreurs trouvées : ${appels(code, 'error')}`)
    assert.equal(code, built['warn'].code, 'la sous-clé prod et la chaîne donnent le même code')
  })

  it('défaut : aucun appel µ.warn du framework, ses µ.error restent ; ceux de l\'appli restent tous', () => {
    const { code } = built['défaut']
    assert.equal(appels(code, 'warn'), 1, 'seul reste l\'avertissement écrit par le programmeur')
    assert.ok(code.includes(AVERTISSEMENT))
    assert.equal(appels(code, 'error'), appels(built['prod-warn'].code, 'error'), 'chaque erreur du framework et celle de l\'appli restent')
    assert.ok(code.includes(ERREUR))
    assert.ok(!code.includes('MJS_TRACE'))
  })

  it('défaut et \'error\' écrit à la main donnent le même code', () => {
    assert.equal(built['défaut'].code, built['error'].code)
  })

  it('\'silent\' sans le journal : ni avertissement ni erreur du framework, ceux de l\'appli restent', () => {
    const { code } = built['silent-coeur']
    assert.ok(appels(built['warn-coeur'].code, 'warn') > 5 && appels(built['warn-coeur'].code, 'error') > 1, 'le cœur nu en porte au niveau \'warn\'')
    assert.equal(appels(code, 'warn'), 1)
    assert.equal(appels(code, 'error'), 1)
    assert.ok(code.includes(AVERTISSEMENT) && code.includes(ERREUR))
  })

  it('\'silent\' avec le journal des erreurs : les µ.error du framework restent (le journal les envoie au serveur), aucun µ.warn', () => {
    const { code } = built['silent-journal']
    assert.equal(appels(code, 'warn'), 1)
    assert.equal(appels(code, 'error'), appels(built['prod-warn'].code, 'error'))
  })

  it('fichiers séparés, défaut : le cœur n\'a plus aucun appel µ.warn, ses µ.error restent', () => {
    const { coeur } = built['défaut-fichiers']
    assert.ok(appels(built['prod-warn-fichiers'].coeur, 'warn') > 10)
    assert.equal(appels(coeur, 'warn'), 0)
    assert.equal(appels(coeur, 'error'), appels(built['prod-warn-fichiers'].coeur, 'error'))
    assert.ok(built['défaut-fichiers'].code.includes(AVERTISSEMENT) && built['défaut-fichiers'].code.includes(ERREUR))
  })

  it('fichiers de messages : au défaut, les textes que seuls des avertissements lisaient sont partis ; à { prod: \'warn\' }, ils sont là', () => {
    const defaut = JSON.parse(built['défaut-fichiers'].messagesFr)
    const avant  = JSON.parse(built['prod-warn-fichiers'].messagesFr)
    assert.deepEqual(LUS_PAR_AVERTISSEMENTS.filter(k => k in defaut), [])
    assert.deepEqual(LUS_PAR_AVERTISSEMENTS.filter(k => !(k in avant)), [])
    assert.deepEqual(LUS_AILLEURS.filter(k => !(k in defaut)), [], 'une clé lue aussi par une erreur ou par un module cœur reste')
  })
})

describe('terminal du build en production — ses avertissements ne suivent pas le nouveau défaut', () => {
  // ce que buildWarn écrit (printDiagnostic passe par console.warn), pour une construction de production réglée par `logLevel`
  function ecrit(logLevel?: unknown): string[] {
    const root    = mjsTmp('avertissements-terminal')
    const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'dist'), manifestPath: join(root, 'dist', 'bundle.js'), env: 'prod', ...(logLevel === undefined ? {} : { logLevel }) } as any)
    const lignes: string[] = []
    const avant  = console.warn
    console.warn = (...args: unknown[]) => { lignes.push(args.map(String).join(' ')) }
    try { bundler.buildWarn('repère du terminal') }
    finally { console.warn = avant }
    return lignes.filter(l => l.includes('repère du terminal'))
  }

  it('sans clé, ou sans sous-clé prod : l\'avertissement de construction s\'écrit', () => {
    assert.equal(ecrit().length, 1)
    assert.equal(ecrit({ dev: 'error' }).length, 1)
  })

  it('un niveau de production écrit à la main le gouverne : \'error\' et \'silent\' le taisent, \'warn\' l\'écrit', () => {
    assert.equal(ecrit('error').length, 0)
    assert.equal(ecrit({ prod: 'silent' }).length, 0)
    assert.equal(ecrit({ prod: 'warn' }).length, 1)
  })
})
