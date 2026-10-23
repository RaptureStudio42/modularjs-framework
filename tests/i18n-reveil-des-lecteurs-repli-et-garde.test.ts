// µt d'une clé d'une SECTION du dictionnaire lue depuis un module qui ne la déclare pas : à l'arrivée de la section,
// ses lecteurs sont prévenus (ils se rendent à nouveau). Deux gardes de cette alerte qu'aucun test ne tenait :
// - la langue affichée n'a pas la section, c'est la langue par défaut qui la sert (repli) : le lecteur doit alors
//   afficher le texte de la langue par défaut — sans l'alerte, il restait au repère (⟦format.locale⟧ en développement) ;
// - une section que PERSONNE ne lit sans la déclarer (un module qui la déclare la charge) ne réveille rien : les
//   autres composants i18n ne se rendent pas à nouveau pour rien. Le témoin : la même arrivée, quand un lecteur avait
//   demandé la section, les réveille bien.
// Harnais : vrai Bundler, fichiers de langue servis par `µ._i18nImport`, fragments servis par un `fetch` qui lit la
// sortie réelle du build (même patron que tests/i18n-section-lue-sans-declaration-panne.test.ts).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm, fileToId, ssrScopeFile, topoSortFiles } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// `enSansFormat` : l'anglais n'a pas la section `format`, seul le français la porte
function dictionnaires(srcDir: string, enSansFormat: boolean): void {
  const dir = join(srcDir, 'i18n')
  mkdirSync(join(dir, 'fr'), { recursive: true })
  mkdirSync(join(dir, 'en'), { recursive: true })
  writeFileSync(join(dir, 'fr.yml'), 'titre: Bonjour\n')
  writeFileSync(join(dir, 'en.yml'), 'titre: Hello\n')
  writeFileSync(join(dir, 'fr/format.yml'), 'locale: fr-FR\n')
  if (!enSansFormat) writeFileSync(join(dir, 'en/format.yml'), 'locale: en-GB\n')
}

const COMPOSANTS: Record<string, string> = {
  // sans @i18n : la clé n'est pas préfixée, `format` est une section que ce module ne déclare pas
  horloge: '<p class="locale">{µt(\'format.locale\')}</p>\n',
  // déclare `format` : le module qui la charge
  formats: '@i18n \'format\'\n<p class="locale">{µt(\'locale\')}</p>\n',
  // un composant i18n qui ne lit pas la section
  autre:   '<p class="t">{µt(\'titre\')}</p>\n'
}

async function monterProjet(opts: { enSansFormat?: boolean } = {}) {
  const root   = mjsTmp('i18n-reveil-des-lecteurs')
  const srcDir = join(root, 'app')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  dictionnaires(srcDir, !!opts.enSansFormat)
  for (const [nom, source] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, `${nom}.mjs`), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), i18n: { default: 'fr' } } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()

  const window: any = new Window({ url: 'http://localhost/' })
  const requetes: string[] = []
  window.fetch = async (url: string) => {
    requetes.push(url)
    const m = url.match(/\/i18n\/([^/]+)\/([^/]+\.json)$/)
    const chemin = m ? join(outDir, 'i18n', m[1], m[2]) : ''
    if (!m || !existsSync(chemin)) return { ok: false, status: 404 }
    const json = JSON.parse(readFileSync(chemin, 'utf-8'))
    return { ok: true, status: 200, json: async () => json }
  }
  ;(window as any).__importLangue = async (url: string) => {
    const src = readFileSync(join(outDir, String(url).split('/').pop()!), 'utf-8')
    return { default: JSON.parse(src.replace(/^export default /, '').replace(/;\s*$/, '')) }
  }

  const files     = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const coreFile  = files.find((f) => /^mjs_core-/.test(f))!
  const brut      = readFileSync(join(root, 'bundle.js'), 'utf-8')
  const debut     = brut.indexOf('const µReady = ')
  const corps     = brut.match(/const µReady = import\(µCore\)\.then\(async \(\{ µ \}\) => \{\n([\s\S]*)\n\}\);\nif \(typeof window/)
  assert.ok(corps, 'corps du manifeste introuvable')
  const manifeste = [stripEsm(brut.slice(0, debut)), corps![1]].join('\n').replace(/window\.µ\s*=\s*µ;?/, '')
  const autres    = files.filter((f) => f !== coreFile)
  const ids       = new Map(autres.map((f) => [f, fileToId(f)]))
  const resoudre  = (url: string): string | null => ids.get(url.split('/').pop() || '') ?? null
  const portees   = autres.map((f) => ({ f, id: ids.get(f)!, ...ssrScopeFile(readFileSync(join(outDir, f), 'utf-8'), ids.get(f)!, resoudre) }))
  const ordre     = topoSortFiles(portees.map((p) => p.id), new Map(portees.map((p) => [p.id, p.deps])), new Map(portees.map((p) => [p.id, p.f])))
  const code      = ordre.map((id) => portees.find((p) => p.id === id)!.code).join('\n')
  window.eval(`${stripEsm(readFileSync(join(outDir, coreFile), 'utf-8'))}\nµ._i18nImport = globalThis.__importLangue;\n${manifeste}\nglobalThis.µ = µ;\n${code}`)

  const monter = (nom: string) => {
    window.document.body.insertAdjacentHTML('beforeend', `<mjs-${nom}></mjs-${nom}>`)
    return [...window.document.body.querySelectorAll(`mjs-${nom}`)].pop()
  }
  const texte = (comp: any, sel: string): string => comp._shadow.querySelector(sel)?.textContent ?? '(absent)'
  // les rendus à venir d'un composant : chaque invalidation en programme un
  const espionner = (comp: any) => {
    const vues: string[] = []
    const origine = comp._mjs_invalidate
    comp._mjs_invalidate = function (...args: any[]) { vues.push(String(args[0])); return origine.apply(this, args) }
    return vues
  }
  const vers = (section: string, lang: string) => requetes.filter((u) => new RegExp(`/i18n/${lang}/[^/]*${section}[^/]*\\.json$`).test(u)).length
  return { window, monter, texte, espionner, vers, requetes }
}

describe('µt — l\'arrivée d\'une section lue sans déclaration réveille ses lecteurs, et eux seuls', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la langue affichée n\'a pas la section : le lecteur affiche le texte de la langue par défaut, servie en repli', async () => {
    const { window, monter, texte, vers } = await monterProjet({ enSansFormat: true })
    monter('autre')
    await pause(200)
    window.µ.store.__mjsLang = 'en'
    await pause(250)
    assert.equal(window.µ.store.__mjsLang, 'en', 'la bascule vers l\'anglais a abouti')
    const horloge = monter('horloge')
    await pause(300)
    assert.equal(texte(horloge, '.locale'), 'fr-FR', 'le texte de la langue par défaut, à défaut de celui de l\'anglais')
    assert.equal(vers('format', 'fr'), 1, 'une seule requête, vers la section française')
    assert.equal(vers('format', 'en'), 0, 'l\'anglais n\'a pas cette section : aucune requête')
  })

  it('une section qu\'aucun lecteur n\'a demandée (un module la déclare) ne réveille pas les autres composants i18n', async () => {
    const { monter, texte, espionner, vers } = await monterProjet()
    const autre = monter('autre')
    await pause(200)
    const rendus = espionner(autre)
    const formats = monter('formats')
    await pause(300)
    assert.equal(texte(formats, '.locale'), 'fr-FR', 'le module qui déclare la section est servi')
    assert.equal(vers('format', 'fr'), 1, 'la section est arrivée')
    assert.deepEqual(rendus, [], 'l\'autre composant n\'est pas rendu à nouveau : il ne lit pas cette section')
  })

  it('témoin : quand un lecteur sans déclaration a demandé la section, son arrivée réveille les composants qui ne la déclarent pas', async () => {
    const { monter, texte, espionner, vers } = await monterProjet()
    const autre = monter('autre')
    await pause(200)
    const rendus = espionner(autre)
    const horloge = monter('horloge')
    await pause(300)
    assert.equal(texte(horloge, '.locale'), 'fr-FR', 'le lecteur est servi')
    assert.equal(vers('format', 'fr'), 1, 'une seule requête')
    assert.ok(rendus.length >= 1, 'l\'autre composant i18n est prévenu : il pourrait lire la section')
  })
})
