// µt d'une clé dont le premier mot est un nom du prototype d'Object (`toString.x`, `constructor.y`, `__proto__.z`) :
// ce n'est pas une section du dictionnaire. Le premier mot était pourtant cherché dans la table des sections par
// `sections[nom]`, qui rend la méthode héritée d'Object : la lecture « demandait » la section `toString`, et la
// requête partait vers `/i18n/fr/function toString() { [native code] }.json` (404). Pire : la section restait retenue
// parmi celles à assurer à chaque bascule, la requête de la langue cible échouait à son tour et la bascule était
// annulée à chaque fois — le changement de langue de toute la page ne marchait plus. Cas réaliste :
// `µt(donnéeVenueDuDehors)`. Ce test garantit qu'aucune requête ne part, que la clé reste absente et que la
// bascule de langue marche ensuite, dans la langue par défaut comme dans une autre (le repli de section lit aussi
// la table de la langue par défaut). `_ensure` porte la même garde : une section qui n'est pas dans la table n'est
// jamais demandée.
// Harnais : vrai Bundler, fichiers de langue servis par `µ._i18nImport`, fragments servis par un `fetch` qui lit la
// sortie réelle du build (même patron que tests/i18n-section-lue-sans-declaration.test.ts).

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
  mkdirSync(join(dir, 'de'), { recursive: true })
  writeFileSync(join(dir, 'fr.yml'), 'titre: Bonjour\n')
  writeFileSync(join(dir, 'en.yml'), 'titre: Hello\n')
  writeFileSync(join(dir, 'de.yml'), 'titre: Hallo\n')
  writeFileSync(join(dir, 'fr/format.yml'), 'locale: fr-FR\n')
  writeFileSync(join(dir, 'en/format.yml'), 'locale: en-GB\n')
  writeFileSync(join(dir, 'de/format.yml'), 'locale: de-DE\n')
}

const COMPOSANTS: Record<string, string> = {
  // trois noms du prototype en premier mot, plus une vraie section lue sans déclaration : le témoin de la bascule
  proto: '<p class="a">{µt(\'toString.x\')}</p><p class="b">{µt(\'constructor.y\')}</p><p class="c">{µt(\'__proto__.z\')}</p><p class="locale">{µt(\'format.locale\')}</p>\n'
}

async function monterProjet() {
  const root   = mjsTmp('i18n-nom-du-prototype')
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

  // les sections que la lecture ou la bascule demandent à `_ensure`, « langue/section » : seule `format` en est une
  const demandees: string[] = []
  const ensure = window.µ.i18n._ensure
  window.µ.i18n._ensure = function (lang: string, section: string) {
    demandees.push(lang + '/' + section)
    return ensure.call(this, lang, section)
  }

  const monter = (nom: string) => {
    window.document.body.insertAdjacentHTML('beforeend', `<mjs-${nom}></mjs-${nom}>`)
    return [...window.document.body.querySelectorAll(`mjs-${nom}`)].pop()
  }
  const texte = (comp: any, sel: string): string => comp._shadow.querySelector(sel)?.textContent ?? '(absent)'
  // les requêtes qui ne sont pas celle d'une vraie section
  const etranges = () => requetes.filter((u) => !/\/format\.json$/.test(u))
  // les sections demandées qui ne sont pas une vraie section
  const horsSection = () => demandees.filter((d) => !/\/format$/.test(d))
  return { window, monter, texte, requetes, etranges, horsSection }
}

describe('µt — un nom du prototype d\'Object en premier mot n\'est pas une section', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('µt(\'toString.x\'), µt(\'constructor.y\'), µt(\'__proto__.z\') : aucune requête, les clés restent absentes', async () => {
    const { monter, texte, etranges, horsSection } = await monterProjet()
    const proto = monter('proto')
    await pause(200)
    assert.deepEqual(etranges(), [], 'aucune requête vers autre chose qu\'une vraie section')
    assert.deepEqual(horsSection(), [], 'aucune de ces clés n\'est demandée comme une section')
    assert.equal(texte(proto, '.a'), '⟦toString.x⟧')
    assert.equal(texte(proto, '.b'), '⟦constructor.y⟧')
    assert.equal(texte(proto, '.c'), '⟦__proto__.z⟧')
    assert.equal(texte(proto, '.locale'), 'fr-FR', 'la vraie section est servie')
  })

  it('le changement de langue de la page marche ensuite : fr → de → en → fr', async () => {
    const { window, monter, texte, etranges, horsSection } = await monterProjet()
    const proto = monter('proto')
    await pause(200)
    for (const [langue, attendu] of [['de', 'de-DE'], ['en', 'en-GB'], ['fr', 'fr-FR']]) {
      window.µ.store.__mjsLang = langue
      await pause(250)
      assert.equal(window.µ.store.__mjsLang, langue, `la bascule vers « ${langue} » n'est pas annulée`)
      assert.equal(texte(proto, '.locale'), attendu, `la section est servie en « ${langue} »`)
    }
    assert.deepEqual(etranges(), [])
    assert.deepEqual(horsSection(), [], 'aucune bascule n\'a demandé un de ces noms comme une section')
  })

  it('dans une autre langue que la langue par défaut : une lecture directe de µ.t ne demande rien non plus', async () => {
    const { window, monter, texte, etranges, horsSection } = await monterProjet()
    monter('proto')
    await pause(200)
    window.µ.store.__mjsLang = 'de'
    await pause(250)
    for (const cle of ['toString.x', 'constructor.y', '__proto__.z', 'hasOwnProperty.a', 'valueOf.b']) {
      assert.equal(window.µ.t(cle), '⟦' + cle + '⟧')
    }
    await pause(100)
    assert.deepEqual(etranges(), [])
    assert.deepEqual(horsSection(), [])
    const apres = monter('proto')
    await pause(200)
    assert.equal(texte(apres, '.locale'), 'de-DE')
    assert.deepEqual(etranges(), [])
    assert.deepEqual(horsSection(), [])
  })

  it('_ensure d\'une section qui n\'est pas dans la table des sections, nom du prototype compris : aucune requête, rien en cache', async () => {
    const { window, monter, requetes } = await monterProjet()
    monter('proto')
    await pause(200)
    const avant = requetes.length
    for (const section of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      assert.equal(await window.µ.i18n._ensure('fr', section), null, `« ${section} » n'est pas une section`)
      assert.equal(window.µ._i18nCache.has('fr/' + section), false, `rien n'est retenu en cache pour « ${section} »`)
    }
    window.µ.store.__mjsLang = 'de'
    await pause(250)
    const apresBascule = requetes.length
    for (const section of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      assert.equal(await window.µ.i18n._ensure('de', section), null, `« ${section} » n'est pas une section, langue de repli comprise`)
      assert.equal(window.µ._i18nCache.has('de/' + section), false, `rien n'est retenu en cache pour « ${section} », langue de repli comprise (une entrée sans données resterait « en route » à vie)`)
    }
    assert.equal(requetes.length, apresBascule, 'aucune requête de plus')
    assert.equal(requetes.length > avant, true, 'la bascule, elle, a bien demandé la vraie section')
  })
})
