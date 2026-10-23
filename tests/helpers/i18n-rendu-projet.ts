// Projet i18n de test partagé : compile des composants avec un dossier `i18n/` (racine fr/en, sections
// `panier` et `ailleurs`), évalue le cœur + le manifeste + les composants dans une fenêtre happy-dom
// neuve (fichiers de langue servis depuis le dossier de sortie, `fetch` des fragments journalisé) ;
// ne monte RIEN, chaque test contrôle son timing. `graine` : sème les sections comme le fait le rendu
// serveur (`#__mjs_i18n`) avant le démarrage — `true` = `panier` en fr, ou `{ lang, sections: { langue: [noms] } }`
// pour une graine à la carte (langue du rendu, sections par langue, repli sous la langue par défaut) ; une chaîne
// est posée telle quelle comme contenu de la balise (graine abîmée).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler } from '../../src/bundler/index.js'
import { stripEsm, fileToId, ssrScopeFile, topoSortFiles } from '../../src/server/renderToString.js'
import { mjsTmp } from './tmp.js'

function seedDicts(srcDir: string, sansEn: string[] = []): void {
  const d = join(srcDir, 'i18n')
  mkdirSync(join(d, 'fr'), { recursive: true })
  mkdirSync(join(d, 'en'), { recursive: true })
  writeFileSync(join(d, 'fr.yml'), 'titre: Bienvenue\nnav:\n  fermer: Fermer\n')
  writeFileSync(join(d, 'en.json'), JSON.stringify({ titre: 'Welcome', nav: { fermer: 'Close' } }))
  writeFileSync(join(d, 'fr/panier.yml'), 'resume: Résumé du panier\nseul_fr: Seulement en français\n')
  if (!sansEn.includes('panier')) writeFileSync(join(d, 'en/panier.json'), JSON.stringify({ resume: 'Cart summary' }))
  writeFileSync(join(d, 'fr/ailleurs.yml'), 'resume: Autre résumé\n')
  if (!sansEn.includes('ailleurs')) writeFileSync(join(d, 'en/ailleurs.json'), JSON.stringify({ resume: 'Other summary' }))
}

const langFile = (outDir: string, url: string): any => {
  const src = readFileSync(join(outDir, url.split('/').pop()!), 'utf-8')
  return JSON.parse(src.replace(/^export default /, '').replace(/;\s*$/, ''))
}

export interface Options {
  graine?: boolean | string | { lang: string; sections: Record<string, string[]> }  // sections semées par le rendu serveur (`#__mjs_i18n`)
  prod?: boolean         // build de production (pas de ⟦clé⟧)
  i18n?: Record<string, unknown>  // options i18n du build en plus de `default: 'fr'` (`urlParam`, `persist`, `detect`)
  url?: string           // adresse de la page du visiteur (`?lang=en`)
  sansEn?: string[]      // sections SANS fragment anglais : le rendu en anglais les sert en repli sous le fr
  porteLangue?: Promise<void>  // les fichiers de langue n'arrivent qu'une fois cette promesse résolue
  fragmentsEnEchec?: string[]  // sections dont le fragment répond 404 (après `retardFragments`)
  horsLigne?: boolean          // tout téléchargement de fragment échoue par une erreur réseau
  retardFragments?: number     // les fragments mettent ce temps (ms) à répondre : ils sont « en vol » au démarrage
  sources: Record<string, string>
}

// Compile, évalue le cœur + le manifeste + les composants dans une fenêtre neuve ; ne monte RIEN.
export async function projet(opts: Options) {
  const root = mjsTmp('i18n-rendu')
  const srcDir = join(root, 'app')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  seedDicts(srcDir, opts.sansEn)
  for (const [nom, src] of Object.entries(opts.sources)) { writeFileSync(join(srcDir, `${nom}.mjs`), src) }
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), i18n: { default: 'fr', ...opts.i18n }, forceMinify: opts.prod })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const window: any = new Window({ url: opts.url ?? 'http://localhost/' })
  const document: any = window.document
  const requetes: string[] = []
  window.fetch = async (url: string) => {
    requetes.push(url)
    const m = url.match(/\/i18n\/([^/]+)\/([^/]+\.json)$/)
    if (opts.retardFragments) { await new Promise((r) => setTimeout(r, opts.retardFragments)) }
    if (opts.horsLigne) { throw new TypeError('Failed to fetch') }
    if (m && opts.fragmentsEnEchec) {
      const fichierLangue = readdirSync(outDir).find((f: string) => f.startsWith(`mjs_i18n-${m[1]}`))
      const table = fichierLangue ? langFile(outDir, fichierLangue).sections : {}
      if (opts.fragmentsEnEchec.some((nom) => `${table[nom]}.json` === m[2])) { return { ok: false, status: 404 } }
    }
    const f = m && join(outDir, 'i18n', m[1], m[2])
    if (!f || !existsSync(f)) { return { ok: false, status: 404 } }
    const json = JSON.parse(readFileSync(f, 'utf-8'))
    return { ok: true, status: 200, json: async () => json }
  }
  const files = readdirSync(outDir).filter((f: string) => f.endsWith('.js'))
  const coreFile = files.find((f: string) => /^mjs_core-/.test(f))!
  const raw = readFileSync(join(root, 'bundle.js'), 'utf-8')
  const bodyStart = raw.indexOf('const µReady = ')
  const m = raw.match(/const µReady = import\(µCore\)\.then\(async \(\{ µ \}\) => \{\n([\s\S]*)\n\}\);\nif \(typeof window/)
  assert.ok(m, 'corps du manifeste introuvable')
  const manifestSrc = [stripEsm(raw.slice(0, bodyStart)), m![1]].join('\n').replace(/window\.µ\s*=\s*µ;?/, '')
  const coreCode = stripEsm(readFileSync(join(outDir, coreFile), 'utf-8'))
  const autres = files.filter((f: string) => f !== coreFile)
  const idByFile = new Map(autres.map((f: string) => [f, fileToId(f)]))
  const resolve = (url: string): string | null => idByFile.get(url.split('/').pop() || '') ?? null
  const scoped = autres.map((f: string) => {
    const id = idByFile.get(f)!
    const { code, deps } = ssrScopeFile(readFileSync(join(outDir, f), 'utf-8'), id, resolve)
    return { f, id, code, deps }
  })
  const sorted = topoSortFiles(scoped.map((s: any) => s.id), new Map(scoped.map((s: any) => [s.id, s.deps])), new Map(scoped.map((s: any) => [s.id, s.f])))
  const codeById = new Map(scoped.map((s: any) => [s.id, s.code]))
  const composants = sorted.map((id: string) => codeById.get(id)!).join('\n')

  // les fichiers de langue : servis depuis le dossier de sortie, comme le ferait le réseau
  window.__mjsI18nImport = async (url: string) => { if (opts.porteLangue) await opts.porteLangue; return { default: langFile(outDir, url) } }

  if (typeof opts.graine === 'string') {
    document.body.innerHTML = `<script type="application/json" id="__mjs_i18n">${opts.graine}</script>`
  }
  else if (opts.graine) {
    const g = opts.graine === true ? { lang: 'fr', sections: { fr: ['panier'] } } : opts.graine
    const sections: Record<string, Record<string, unknown>> = {}
    for (const [lang, noms] of Object.entries(g.sections)) {
      const table = langFile(outDir, readdirSync(outDir).filter((f: string) => f.startsWith(`mjs_i18n-${lang}`))[0]).sections
      sections[lang] = {}
      for (const nom of noms) { sections[lang][nom] = JSON.parse(readFileSync(join(outDir, 'i18n', lang, `${table[nom]}.json`), 'utf-8')) }
    }
    document.body.innerHTML = `<script type="application/json" id="__mjs_i18n">${JSON.stringify({ lang: g.lang, sections })}</script>`
  }
  window.eval(`${coreCode}\nµ._i18nImport = globalThis.__mjsI18nImport;\n${manifestSrc}\nglobalThis.µ = µ;\n${composants}`)

  const monte = (nom: string): any => {
    document.body.insertAdjacentHTML('beforeend', `<mjs-${nom}></mjs-${nom}>`)
    return document.body.querySelector(`mjs-${nom}`)
  }
  return { window, document, monte, requetes, outDir }
}

