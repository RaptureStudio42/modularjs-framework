// Une appli qui se sert de la traduction (`µt`, `@i18n`) dont le `runtime` n'embarque pas 'i18n' (liste qui l'omet, ou 'core') ne se
// construit pas : µ.t resterait indéfini et le rendu planterait au premier texte traduit. Le message dit quoi écrire. Une appli qui
// ne traduit rien, même avec un bloc `i18n` ou un dossier `i18n/`, n'est pas refusée.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const UTILISE = new Set(['i18n_used'])
const AUCUN   = new Set<string>()

function dossierI18n(nom: string): string {
  const root = mjsTmp(nom)
  mkdirSync(join(root, 'src', 'i18n'), { recursive: true })
  writeFileSync(join(root, 'src', 'i18n', 'fr.yml'), 'titre: Titre\n')
  return join(root, 'src')
}

async function construire(runtime: unknown, source: string, avecI18n = true, autres: Record<string, string> = {}): Promise<{ errors: string[] }> {
  const root   = mjsTmp('runtime-sans-i18n-build')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  if (avecI18n) {
    mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
    writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
    writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'titre: Bonjour\n')
  }
  writeFileSync(join(srcDir, 'vue.mjs'), source)
  for (const [nom, contenu] of Object.entries(autres)) writeFileSync(join(srcDir, nom), contenu)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), runtime, ...avecI18n ? { i18n: { default: 'fr' } } : {} } as any)
  const stats = await bundler.compile()
  await bundler.close()
  return { errors: stats.errors.map((e: any) => e.message) }
}

describe('bundler — runtime sans i18n dans une appli qui traduit', function () {
  this.timeout(60000)
  afterEach(() => setMessagesLang('fr'))
  after(async () => { await terminateSharedWorkerPool() })

  describe('sélection (resolveRuntimeFiles)', () => {
    it("refuse une liste sans 'i18n' quand l'appli traduit, et dit quoi écrire", () => {
      const b = new Bundler({ i18n: { default: 'fr' }, runtime: ['hydrate'] })
      assert.throws(() => b.resolveRuntimeFiles(UTILISE), (e: Error) => /Ajoutez 'i18n'/.test(e.message) && /"runtime": \["hydrate", "i18n"\]/.test(e.message))
    })

    it("refuse 'core' quand l'appli traduit, et dit quoi écrire", () => {
      const b = new Bundler({ i18n: { default: 'fr' }, runtime: 'core' })
      assert.throws(() => b.resolveRuntimeFiles(UTILISE), (e: Error) => /"runtime": "core"/.test(e.message) && /"runtime": \["i18n"\]/.test(e.message))
    })

    it("refuse aussi quand seul le dossier i18n/ existe (sans bloc i18n dans la configuration)", () => {
      const b = new Bundler({ sourceDir: dossierI18n('runtime-liste-dossier'), runtime: ['router'] })
      assert.throws(() => b.resolveRuntimeFiles(UTILISE), /Ajoutez 'i18n'/)
    })

    it("sans relevé de l'usage (appel direct), refuse par prudence", () => {
      const b = new Bundler({ i18n: { default: 'fr' }, runtime: 'core' })
      assert.throws(() => b.resolveRuntimeFiles(), /runtime/)
    })

    it("message en anglais", () => {
      setMessagesLang('en')
      const liste = new Bundler({ i18n: { default: 'fr' }, runtime: ['hydrate'] })
      assert.throws(() => liste.resolveRuntimeFiles(UTILISE), (e: Error) => /Add 'i18n'/.test(e.message) && /"runtime": \["hydrate", "i18n"\]/.test(e.message))
      const coeur = new Bundler({ i18n: { default: 'fr' }, runtime: 'core' })
      assert.throws(() => coeur.resolveRuntimeFiles(UTILISE), (e: Error) => /"runtime": "core"/.test(e.message) && /"runtime": \["i18n"\]/.test(e.message))
    })

    it("message en français : vouvoiement, exemple de configuration juste", () => {
      const liste = new Bundler({ i18n: { default: 'fr' }, runtime: ['hydrate', 'router'] })
      assert.throws(() => liste.resolveRuntimeFiles(UTILISE), (e: Error) => /^\[bundler\] runtime : votre application traduit/.test(e.message) && /"runtime": \["hydrate", "router", "i18n"\]/.test(e.message))
    })

    it("accepte la liste qui porte 'i18n'", () => {
      const b = new Bundler({ i18n: { default: 'fr' }, runtime: ['hydrate', 'i18n'] })
      const { files, warnings } = b.resolveRuntimeFiles(UTILISE)
      assert.ok(files.includes('mjs_i18n.ts'))
      assert.equal(warnings.length, 0)
    })

    it("la liste qui porte 'i18n' embarque aussi le magasin global : la langue voulue (?lang=, mémoire, navigateur) et la bascule du démarrage en dépendent", () => {
      for (const runtime of [['i18n'], ['hydrate', 'i18n'], ['router', 'i18n']]) {
        const { files } = new Bundler({ i18n: { default: 'fr' }, runtime } as any).resolveRuntimeFiles(UTILISE)
        assert.ok(files.includes('mjs_store_globals.ts'), JSON.stringify(runtime))
        assert.ok(files.includes('mjs_state.ts'), 'le magasin bâtit des états : ' + JSON.stringify(runtime))
      }
    })

    it("une liste sans 'i18n' n'embarque pas le magasin global pour autant (appli qui ne traduit pas)", () => {
      const b = new Bundler({ sourceDir: join(mjsTmp('runtime-sans-traduction-magasin'), 'src'), runtime: ['hydrate'] })
      assert.ok(!b.resolveRuntimeFiles(AUCUN).files.includes('mjs_store_globals.ts'))
    })

    it("n'avertit plus : une appli qui ne traduit pas ses pages n'est pas refusée, avec liste ou 'core'", () => {
      for (const runtime of [['hydrate'], 'core'] as const) {
        const b = new Bundler({ i18n: { default: 'fr' }, runtime })
        const { warnings } = b.resolveRuntimeFiles(AUCUN)
        assert.equal(warnings.length, 0)
      }
    })

    it("aucune erreur sans traduction (ni bloc i18n ni dossier i18n/), avec liste ou 'core'", () => {
      for (const runtime of [['hydrate'], 'core'] as const) {
        const b = new Bundler({ sourceDir: join(mjsTmp('runtime-sans-traduction'), 'src'), runtime })
        assert.doesNotThrow(() => b.resolveRuntimeFiles(UTILISE))
        assert.doesNotThrow(() => b.resolveRuntimeFiles())
      }
    })
  })

  describe('construction réelle', () => {
    const traduite = ["@i18n 'accueil'", '<h1>{µt(\'titre\')}</h1>', ''].join('\n')
    const muette   = '<p>rien à traduire</p>\n'

    it("liste sans 'i18n' + page qui emploie µt : la construction échoue", async () => {
      const { errors } = await construire(['hydrate'], traduite)
      assert.ok(errors.some(m => /Ajoutez 'i18n'/.test(m)), errors.join('\n'))
    })

    it("'core' + page qui emploie µt : la construction échoue", async () => {
      const { errors } = await construire('core', traduite)
      assert.ok(errors.some(m => /"runtime": "core"/.test(m)), errors.join('\n'))
    })

    it("µt employé sans @i18n : la construction échoue aussi", async () => {
      const { errors } = await construire(['hydrate'], '<h1>{µt(\'/titre\')}</h1>\n')
      assert.ok(errors.some(m => /Ajoutez 'i18n'/.test(m)), errors.join('\n'))
    })

    it("@i18n sans µt : la construction échoue aussi (le module attend ses textes d'un runtime absent)", async () => {
      const { errors } = await construire(['hydrate'], ["@i18n 'accueil'", '<h1>Bonjour</h1>', ''].join('\n'))
      assert.ok(errors.some(m => /Ajoutez 'i18n'/.test(m)), errors.join('\n'))
    })

    it("µt employé dans un module de script seulement : la construction échoue aussi", async () => {
      const { errors } = await construire(['hydrate'], muette, true, { 'outil.module.civet': "export dire = -> µt('titre')\n" })
      assert.ok(errors.some(m => /Ajoutez 'i18n'/.test(m)), errors.join('\n'))
    })

    it("appli traduite mais aucune page n'emploie µt : aucune erreur", async () => {
      assert.deepEqual((await construire(['hydrate'], muette)).errors, [])
      assert.deepEqual((await construire('core', muette)).errors, [])
    })

    it("liste avec 'i18n' + page qui emploie µt : aucune erreur", async () => {
      assert.deepEqual((await construire(['hydrate', 'i18n'], traduite)).errors, [])
    })

    it("appli non traduite avec 'core' ou une liste : aucune erreur", async () => {
      assert.deepEqual((await construire('core', muette, false)).errors, [])
      assert.deepEqual((await construire(['hydrate'], muette, false)).errors, [])
    })
  })
})
