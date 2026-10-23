// µt d'une clé d'une SECTION du dictionnaire lue depuis un module qui ne déclare pas cette section, quand le
// chargement de la section échoue (panne réseau, erreur du serveur). Le lecteur reste au repère (⟦format.locale⟧ en
// développement) — jusque-là normal. Mais la demande restait retenue « faite » pour toute la page : un module qui
// déclare la section la rechargeait ensuite avec succès, et le lecteur, que personne ne prévenait, restait au
// repère ; un nouveau lecteur monté après la panne ne la redemandait pas non plus. Ce test garantit que la section
// arrivée par n'importe quelle voie (le module qui la déclare, ou une reprise) prévient aussi les lecteurs qui ne la
// déclarent pas, qu'une lecture après la panne la redemande, et que la reprise reste bornée : une section qui échoue
// toujours n'est pas redemandée à chaque rendu (pas de rafale de requêtes pour un composant qui se rend souvent).
// Harnais : vrai Bundler, fichiers de langue servis par `µ._i18nImport`, fragments servis par un `fetch` qui lit la
// sortie réelle du build, avec des pannes sur commande (même patron que tests/i18n-section-lue-sans-declaration.test.ts).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm, fileToId, ssrScopeFile, topoSortFiles } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

function dictionnaires(srcDir: string): void {
  const dir = join(srcDir, 'i18n')
  mkdirSync(join(dir, 'fr'), { recursive: true })
  mkdirSync(join(dir, 'en'), { recursive: true })
  writeFileSync(join(dir, 'fr.yml'), 'titre: Bonjour\n')
  writeFileSync(join(dir, 'en.yml'), 'titre: Hello\n')
  writeFileSync(join(dir, 'fr/format.yml'), 'locale: fr-FR\n')
  writeFileSync(join(dir, 'en/format.yml'), 'locale: en-GB\n')
}

const COMPOSANTS: Record<string, string> = {
  // sans @i18n : la clé n'est pas préfixée, `format` est une section que ce module ne déclare pas
  horloge: '<p class="locale">{µt(\'format.locale\')}</p>\n',
  // déclare `format` : le module qui la recharge avec succès
  formats: '@i18n \'format\'\n<p class="locale">{µt(\'locale\')}</p>\n'
}

// `echecs` : le nombre de requêtes de section qui échouent (erreur 500) avant que le serveur ne réponde
async function monterProjet(opts: { echecs?: number } = {}) {
  const root   = mjsTmp('i18n-section-lue-panne')
  const srcDir = join(root, 'app')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  dictionnaires(srcDir)
  for (const [nom, source] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, `${nom}.mjs`), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), i18n: { default: 'fr' } } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()

  const window: any = new Window({ url: 'http://localhost/' })
  const requetes: string[] = []
  let echecsRestants = opts.echecs ?? 0
  window.fetch = async (url: string) => {
    requetes.push(url)
    if (echecsRestants > 0) { echecsRestants--; return { ok: false, status: 500 } }
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
  // les échecs sont criés à chaque panne (µ.error) : rangés ici plutôt que dans la sortie du test
  const criees: string[] = []
  window.µ.error = (...args: any[]) => { criees.push(args.join(' ')) }

  const monter = (nom: string) => {
    window.document.body.insertAdjacentHTML('beforeend', `<mjs-${nom}></mjs-${nom}>`)
    return [...window.document.body.querySelectorAll(`mjs-${nom}`)].pop()
  }
  const texte = (comp: any, sel: string): string => comp._shadow.querySelector(sel)?.textContent ?? '(absent)'
  const vers  = (section: string) => requetes.filter((u) => new RegExp(`/${section}\\.json$`).test(u)).length
  return { window, monter, texte, vers, criees }
}

describe('µt — une section lue sans déclaration dont le chargement a échoué', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le lecteur reste au repère pendant la panne', async () => {
    const { monter, texte, vers, criees } = await monterProjet({ echecs: 1 })
    const horloge = monter('horloge')
    await pause(200)
    assert.equal(texte(horloge, '.locale'), '⟦format.locale⟧')
    assert.equal(vers('format'), 1)
    assert.equal(criees.length, 1, 'l\'échec est crié une fois')
  })

  it('un module qui déclare la section la recharge avec succès : le lecteur qui ne la déclare pas affiche enfin sa valeur', async () => {
    const { monter, texte, vers } = await monterProjet({ echecs: 1 })
    const horloge = monter('horloge')
    await pause(200)
    assert.equal(texte(horloge, '.locale'), '⟦format.locale⟧', 'la panne : le repère')
    const formats = monter('formats')
    await pause(200)
    assert.equal(texte(formats, '.locale'), 'fr-FR', 'le module qui la déclare est servi')
    assert.equal(texte(horloge, '.locale'), 'fr-FR', 'le lecteur est prévenu, bien qu\'il ne la déclare pas')
    assert.equal(vers('format'), 2, 'une requête pour la panne, une pour la reprise')
  })

  it('un lecteur monté après la panne redemande la section : tous les lecteurs sont servis, une seule reprise', async () => {
    const { monter, texte, vers } = await monterProjet({ echecs: 1 })
    const premier = monter('horloge')
    await pause(200)
    assert.equal(texte(premier, '.locale'), '⟦format.locale⟧', 'la panne : le repère')
    const second = monter('horloge')
    await pause(200)
    assert.equal(vers('format'), 2, 'la section est redemandée à la lecture qui suit la panne')
    assert.equal(texte(second, '.locale'), 'fr-FR')
    assert.equal(texte(premier, '.locale'), 'fr-FR', 'le premier lecteur est prévenu de l\'arrivée')
  })

  it('un lecteur qui se rend à nouveau après la panne redemande la section', async () => {
    const { monter, texte, vers } = await monterProjet({ echecs: 1 })
    const horloge = monter('horloge')
    await pause(200)
    assert.equal(texte(horloge, '.locale'), '⟦format.locale⟧', 'la panne : le repère')
    horloge._mjs_invalidate('_awaits_')
    await pause(200)
    assert.equal(vers('format'), 2)
    assert.equal(texte(horloge, '.locale'), 'fr-FR')
  })

  it('une section qui échoue toujours : une seule reprise, pas de requête à chaque rendu du lecteur', async () => {
    const { monter, texte, vers, criees } = await monterProjet({ echecs: 99 })
    const horloge = monter('horloge')
    await pause(150)
    for (let i = 0; i < 8; i++) {
      horloge._mjs_invalidate('_awaits_')
      await pause(30)
    }
    await pause(100)
    assert.equal(vers('format'), 2, 'la demande, puis une reprise — et c\'est tout')
    assert.equal(criees.length, 2, 'chaque échec est crié une fois')
    assert.equal(texte(horloge, '.locale'), '⟦format.locale⟧')
  })

  it('la bascule de langue la redemande après une panne qui dure', async () => {
    const { window, monter, texte, vers } = await monterProjet({ echecs: 2 })
    const horloge = monter('horloge')
    await pause(150)
    horloge._mjs_invalidate('_awaits_')
    await pause(150)
    assert.equal(vers('format'), 2, 'la demande et sa reprise ont échoué')
    assert.equal(texte(horloge, '.locale'), '⟦format.locale⟧')
    window.µ.store.__mjsLang = 'en'
    await pause(250)
    assert.equal(texte(horloge, '.locale'), 'en-GB')
  })
})
