// Une langue inconnue choisie par la donnée (`µlang = valeurVenueDuDehors`), le prototype pollué (`Object.prototype.nom =
// …`) : la table des langues chargées répondait par la valeur héritée, et la langue recevait l'objet posé sur le prototype
// comme dictionnaire — son texte s'affichait. Elle suit désormais le chemin d'une langue absente : aucun fichier (ni
// adresse héritée importée), une langue vide, ses clés retombent sur la langue par défaut. Développement (sources
// évaluées, chargement de langue simulé, comme i18n-langue-en-echec-pendant-une-bascule.test.ts) et production (cœur
// minifié d'une vraie construction)
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { poserMessages } from './helpers/messages-stub.js'
import { mjsTmp } from './helpers/tmp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const storeSrc = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_store_globals.ts'), 'utf-8')
const i18nSrc = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_i18n.ts'), 'utf-8')

const DONNEES = { dev: false, default: 'fr', placeholder: 'wait', persist: false, detect: false, urlParam: false, prefix: '/i18n', langs: ['en', 'fr'], files: { en: '/en.js', fr: '/fr.js' } }
const FICHIERS: any = { fr: { root: { bonjour: 'Bonjour' }, sections: {} }, en: { root: { bonjour: 'Hello' }, sections: {} } }
const ADRESSE = 'https://tiers.example/langue.js'
const DICTIONNAIRE = { root: { bonjour: 'Texte du tiers' }, sections: {} }

type Monte = { µ: any, charges: string[], polluer: (v: any) => void, nettoyer: () => void }

// développement : les sources du magasin et des traductions évaluées telles quelles
function monterSources(): Monte {
  const µ: any = { log() {}, warn() {}, error() {}, state(o: any) { return o } }
  poserMessages(µ)
  new Function('µ', storeSrc)(µ)
  µ._i18nData = DONNEES
  const charges: string[] = []
  µ._i18nImport = (url: string) => {
    charges.push(url)
    const lang = url === '/en.js' ? 'en' : url === '/fr.js' ? 'fr' : null
    return lang ? Promise.resolve({ default: FICHIERS[lang] }) : Promise.reject(new Error('adresse inconnue ' + url))
  }
  new Function('µ', i18nSrc)(µ)
  return {
    µ, charges,
    polluer: (v: any) => { (Object.prototype as any).piege = v },
    nettoyer: () => { delete (Object.prototype as any).piege },
  }
}

// production : le cœur minifié d'une appli traduite, ses exports posés sur une fenêtre (`export{n as µ}`)
async function coeurDeProduction(): Promise<string> {
  const root = mjsTmp('langue-inconnue-prod'), srcDir = join(root, 'src')
  mkdirSync(join(srcDir, 'i18n'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'bonjour: Bonjour\n')
  writeFileSync(join(srcDir, 'i18n', 'en.yml'), 'bonjour: Hello\n')
  writeFileSync(join(srcDir, 'salut.mjs'), '<p class="t">{µt(\'bonjour\')}</p>\n')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', i18n: { default: 'fr' } }, null, 2))
  const found = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
  const stats = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  const outDir = join(root, 'out')
  const coeur = readdirSync(outDir).find((f) => /^mjs_core-.*\.js$/.test(f))!
  return readFileSync(join(outDir, coeur), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'")
    .replace(/export\s*\{([^}]*)\}\s*;?/g, (_m, l: string) => l.split(',').map((x) => x.trim().split(/\s+as\s+/)).map(([a, b]) => `globalThis[${JSON.stringify(JSON.parse('"' + (b || a) + '"'))}] = ${a};`).join('\n'))
}

function monterProduction(window: any, code: string): Monte {
  window.eval(code)
  const µ = window.µ
  assert.equal(typeof µ._i18nLang, 'function', 'le cœur porte les traductions')
  const charges: string[] = []
  µ.error = () => {}
  µ._i18nImport = (url: string) => {
    charges.push(url)
    const lang = url === '/en.js' ? 'en' : url === '/fr.js' ? 'fr' : null
    return lang ? window.Promise.resolve({ default: FICHIERS[lang] }) : window.Promise.reject(new Error('adresse inconnue ' + url))
  }
  µ._i18nData = DONNEES
  µ._i18nRecheck()
  return {
    µ, charges,
    polluer: (v: any) => window.eval(`Object.prototype.piege = ${JSON.stringify(v)};`),
    nettoyer: () => window.eval('delete Object.prototype.piege;'),
  }
}

const attendre = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

// la bascule vers la langue inconnue a abouti, et vers une langue vide : son dictionnaire, créé à la première lecture d'un
// texte, n'a aucune clé, et la table des langues la porte en propre, vide (le nom des tables reste lisible en production)
function langueVide(µ: any, lang: string): void {
  const d = µ._i18nDict[lang]
  assert.ok(d, 'la bascule aboutit : la langue demandée est celle qu\'on lit')
  assert.deepEqual(Object.keys(d), [], 'aucun dictionnaire hérité')
  assert.equal(Object.prototype.hasOwnProperty.call(µ._i18nLangs, lang), true, 'la langue est enregistrée')
  assert.deepEqual(Object.keys(µ._i18nLangs[lang].root), [], 'vide')
}

async function scenarios(monter: () => Monte): Promise<void> {
  // un dictionnaire posé sur le prototype : jamais lu comme celui de la langue
  let m = monter()
  try {
    await attendre()
    assert.equal(m.µ.t('bonjour'), 'Bonjour', 'langue par défaut chargée')
    m.polluer(DICTIONNAIRE)
    m.µ._storeSet('__mjsLang', 'piege')
    await attendre()
    assert.equal(m.µ.t('bonjour'), 'Bonjour', 'la langue inconnue retombe sur la langue par défaut')
    langueVide(m.µ, 'piege')
  }
  finally { m.nettoyer() }
  // une adresse posée sur le prototype : jamais importée comme fichier de la langue
  m = monter()
  try {
    await attendre()
    m.polluer(ADRESSE)
    m.µ._storeSet('__mjsLang', 'piege')
    await attendre()
    assert.deepEqual(m.charges.filter((u) => u !== '/fr.js'), [], 'aucun fichier demandé pour la langue inconnue')
    assert.equal(m.µ.t('bonjour'), 'Bonjour')
    langueVide(m.µ, 'piege')
  }
  finally { m.nettoyer() }
}

describe('prototype pollué : une langue inconnue suit le chemin d\'une langue absente', function () {
  this.timeout(120000)
  let code = ''
  before(async function () {
    this.timeout(180000)
    code = await coeurDeProduction()
  })
  after(async () => { await terminateSharedWorkerPool() })

  it('développement', async () => {
    await scenarios(monterSources)
  })

  it('production', async () => {
    const fenetres: any[] = []
    try {
      await scenarios(() => {
        const w: any = new Window({ url: 'http://localhost/' })
        fenetres.push(w)
        return monterProduction(w, code)
      })
    }
    finally {
      for (const w of fenetres) await w.happyDOM.close()
    }
  })
})
