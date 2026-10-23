// µt d'une clé qui vit dans une SECTION du dictionnaire (i18n/<langue>/format.yml), lue depuis un module qui ne
// déclare pas cette section : `µt('format.locale')` sans `@i18n`, ou `µt('/format.locale')` depuis un module qui en
// déclare une autre. Rien ne demandait la section : le texte restait vide en production (⟦clé⟧ en développement)
// tant qu'un autre module ne l'avait pas chargée — et même chargée, son lecteur n'était jamais prévenu. Ce test
// garantit que la lecture demande elle-même la section, que le lecteur se rend à nouveau à son arrivée (qu'elle ait
// été demandée par lui ou déjà en route pour un module qui la déclare), qu'une bascule de langue la sert dans la
// nouvelle langue d'un coup, sans texte en attente, et qu'une clé dont le premier mot n'est pas une section ne
// déclenche aucune requête.
// Harnais : vrai Bundler, fichiers de langue servis par `µ._i18nImport`, fragments servis par un `fetch` qui lit
// la sortie réelle du build (même patron que tests/i18n-e2e.test.ts).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { renderToString, stripEsm, fileToId, ssrScopeFile, topoSortFiles } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

function dictionnaires(srcDir: string): void {
  const dir = join(srcDir, 'i18n')
  mkdirSync(join(dir, 'fr'), { recursive: true })
  mkdirSync(join(dir, 'en'), { recursive: true })
  mkdirSync(join(dir, 'de'), { recursive: true })
  writeFileSync(join(dir, 'fr.yml'), 'titre: Bonjour\n')
  writeFileSync(join(dir, 'en.yml'), 'titre: Hello\n')
  writeFileSync(join(dir, 'de.yml'), 'titre: Hallo\n')
  writeFileSync(join(dir, 'fr/format.yml'), 'locale: fr-FR\n')
  writeFileSync(join(dir, 'en/format.yml'), 'locale: en-GB\n')
  writeFileSync(join(dir, 'de/format.yml'), 'locale: de-DE\n')
  writeFileSync(join(dir, 'fr/agenda.yml'), 'titre: Agenda\n')
  writeFileSync(join(dir, 'en/agenda.yml'), 'titre: Diary\n')
}

const COMPOSANTS: Record<string, string> = {
  // sans @i18n : la clé n'est pas préfixée, `format` est une section
  horloge: '<p class="locale">{µt(\'format.locale\')}</p>\n',
  // déclare une AUTRE section, lit `format` par chemin absolu
  agenda: '@i18n \'agenda\'\n<h2>{µt(\'titre\')}</h2>\n<p class="locale">{µt(\'/format.locale\')}</p>\n',
  // déclare `format` : le lecteur habituel, témoin
  formats: '@i18n \'format\'\n<p class="locale">{µt(\'locale\')}</p>\n',
  // premier mot qui n'est pas une section : clé absente pour de bon
  inconnu: '<p class="x">{µt(\'inconnu.cle\')}</p>\n'
}

async function monterProjet(opts: { forceMinify?: boolean; delai?: number } = {}) {
  const root   = mjsTmp('i18n-section-lue')
  const srcDir = join(root, 'app')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  dictionnaires(srcDir)
  for (const [nom, source] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, `${nom}.mjs`), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), i18n: { default: 'fr' }, forceMinify: opts.forceMinify } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()

  const window: any = new Window({ url: 'http://localhost/' })
  const requetes: string[] = []
  window.fetch = async (url: string) => {
    requetes.push(url)
    if (opts.delai) await pause(opts.delai)
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
    return window.document.body.querySelector(`mjs-${nom}`)
  }
  const texte  = (comp: any, sel: string): string => comp._shadow.querySelector(sel)?.textContent ?? '(absent)'
  const vers   = (section: string) => requetes.filter((u) => new RegExp(`/${section}\\.json$`).test(u)).length
  return { window, monter, texte, requetes, vers }
}

describe('µt — une section lue sans être déclarée se charge et prévient son lecteur', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('module sans @i18n : µt(\'format.locale\') charge la section et affiche sa valeur', async () => {
    const { monter, texte, vers } = await monterProjet()
    const horloge = monter('horloge')
    await pause(150)
    assert.equal(texte(horloge, '.locale'), 'fr-FR')
    assert.equal(vers('format'), 1, 'une seule requête pour la section')
  })

  it('module qui déclare une autre section : µt(\'/format.locale\') est servi aussi', async () => {
    const { monter, texte, vers } = await monterProjet()
    const agenda = monter('agenda')
    await pause(150)
    assert.equal(texte(agenda, 'h2'), 'Agenda')
    assert.equal(texte(agenda, '.locale'), 'fr-FR')
    assert.equal(vers('format'), 1)
  })

  it('section déjà en route pour un module qui la déclare : le lecteur qui ne la déclare pas est prévenu aussi, une seule requête', async () => {
    const { monter, texte, vers } = await monterProjet()
    const formats = monter('formats')
    const horloge = monter('horloge')
    await pause(150)
    assert.equal(texte(formats, '.locale'), 'fr-FR')
    assert.equal(texte(horloge, '.locale'), 'fr-FR')
    assert.equal(vers('format'), 1)
  })

  it('bascules de langue : la section lue sans déclaration passe dans la langue cible d\'un coup, sans texte d\'une autre langue entre les deux', async () => {
    // fragments servis avec un peu de retard : un texte intermédiaire aurait le temps d'être vu. En route, une
    // section manquante se replie sur la langue par défaut (fr) : la bascule en → de le montrerait
    const { window, monter, texte } = await monterProjet({ delai: 40 })
    const horloge = monter('horloge')
    await pause(250)
    assert.equal(texte(horloge, '.locale'), 'fr-FR')
    const suivre = async (langue: string) => {
      const vus = [texte(horloge, '.locale')]
      window.µ.store.__mjsLang = langue
      for (let i = 0; i < 60; i++) {
        const t = texte(horloge, '.locale')
        if (t !== vus[vus.length - 1]) vus.push(t)
        await pause(5)
      }
      return vus
    }
    assert.deepEqual(await suivre('en'), ['fr-FR', 'en-GB'])
    assert.deepEqual(await suivre('de'), ['en-GB', 'de-DE'], 'aucun texte d\'une autre langue (repli fr-FR, ou attente) entre en-GB et de-DE')
  })

  it('premier mot qui n\'est pas une section : aucune requête, la clé reste absente', async () => {
    const { monter, texte, requetes } = await monterProjet()
    const inconnu = monter('inconnu')
    await pause(150)
    assert.equal(requetes.length, 0)
    assert.equal(texte(inconnu, '.x'), '⟦inconnu.cle⟧', 'en développement, la clé absente reste visible')
  })

  it('build de production : la valeur arrive (plus de chaîne vide à vie)', async () => {
    const { monter, texte, requetes } = await monterProjet({ forceMinify: true })
    const horloge = monter('horloge')
    await pause(200)
    assert.equal(texte(horloge, '.locale'), 'fr-FR')
    assert.equal(requetes.length, 1)
  })

  it('rendu serveur : la section lue sans déclaration est résolue dès le premier rendu et semée dans la page', async () => {
    const root   = mjsTmp('i18n-section-lue-ssr')
    const srcDir = join(root, 'app')
    mkdirSync(srcDir, { recursive: true })
    dictionnaires(srcDir)
    writeFileSync(join(srcDir, 'horloge.mjs'), COMPOSANTS.horloge)
    const res = await renderToString({ sourceDir: srcDir, tag: 'mjs-horloge', i18n: { default: 'fr' } } as any)
    assert.match(res.html, /fr-FR/, 'la valeur est dans le HTML rendu')
    assert.match(res.sharedScript ?? '', /id="__mjs_i18n"[\s\S]*fr-FR/, 'la section consultée est semée : le navigateur ne la redemande pas')
  })
})
