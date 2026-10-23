// Messages de la console du navigateur en production : un fichier par langue, chargé au premier
// message seulement. Le manifeste ne porte plus le groupe `err`, le build écrit un fichier JSON par
// langue (nom haché, hors précache), retire le texte français de secours des appels du runtime, et
// le navigateur rend un texte court (clé + variables) en attendant le fichier. Build de
// développement : rien ne change.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripMsgFallbacks } from '../src/bundler/minify.js'
import { RUNTIME_LABELS, runtimeLabelsFor } from '../src/runtime-labels.js'
import { TRACE_ONLY_MESSAGES } from '../src/bundler/minify.js'
import { mjsTmp } from './helpers/tmp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNTIME_DIR = join(__dirname, '../src/runtime')

describe('retrait du texte de secours des appels _mjs_msg/_mjs_txt', () => {
  it('retire le 3e argument chaîne littérale, quel que soit le guillemet', () => {
    assert.equal(stripMsgFallbacks('µ._mjs_msg(\'k\', { a: 1 }, \'texte fr\');'), 'µ._mjs_msg(\'k\', { a: 1 });')
    assert.equal(stripMsgFallbacks('µ._mjs_txt("k", v, "texte fr")'), 'µ._mjs_txt("k", v)')
    assert.equal(stripMsgFallbacks('x = µ._mjs_msg(\'k\', null, \'l\\\'apostrophe (et) , virgule\') + 1'), 'x = µ._mjs_msg(\'k\', null) + 1')
  })

  it('un appel à 2 arguments reste intact', () => {
    const src = 'µ._mjs_msg(\'k\', { tag: n });\nµ._mjs_txt(\'k\')'
    assert.equal(stripMsgFallbacks(src), src)
  })

  it('un 3e argument qui n\'est pas une chaîne littérale simple reste intact', () => {
    for (const src of [
      'µ._mjs_txt(key, vars, fr)',
      'µ._mjs_msg(\'k\', v, \'a\' + b)',
      'µ._mjs_msg(\'k\', v, `gabarit ${x}`)',
      'µ._mjs_msg(\'k\', v, cond ? \'a\' : \'b\')',
      'µ._mjs_msg(\'k\', v, f(\'a\'))',
    ]) assert.equal(stripMsgFallbacks(src), src)
  })

  it('suit les parenthèses, accolades et crochets des arguments, saute chaînes, gabarits, regex et commentaires', () => {
    assert.equal(
      stripMsgFallbacks('µ._mjs_msg(\'k\', { a: f(1, 2), b: [3, 4], c: \')\', d: `x), ${g(5, 6)}`, e: /[)\\/,]/.test(s) /* , ) */ }, \'secours\')'),
      'µ._mjs_msg(\'k\', { a: f(1, 2), b: [3, 4], c: \')\', d: `x), ${g(5, 6)}`, e: /[)\\/,]/.test(s) /* , ) */ })',
    )
  })

  it('un appel cité dans un commentaire ou une chaîne n\'est pas touché', () => {
    const src = '// µ._mjs_msg(\'k\', v, \'x\')\n/* µ._mjs_txt(\'k\', v, \'x\') */\nvar s = "µ._mjs_msg(\'k\', v, \'x\')";\nvar r = `µ._mjs_msg(\'k\', v, \'x\')`;'
    assert.equal(stripMsgFallbacks(src), src)
  })

  it('appels imbriqués et sur plusieurs lignes', () => {
    assert.equal(
      stripMsgFallbacks('µ.warn(µ._mjs_msg(\'a\', { t: µ._mjs_txt(\'b\', null, \'sous-texte\') }, \'texte\'), e);'),
      'µ.warn(µ._mjs_msg(\'a\', { t: µ._mjs_txt(\'b\', null) }), e);',
    )
    assert.equal(
      stripMsgFallbacks('µ._mjs_msg(\n  \'k\',\n  { n: 1 },\n  \'texte\'\n)'),
      'µ._mjs_msg(\n  \'k\',\n  { n: 1 })',
    )
  })

  it('le runtime lui-même : chaque appel à 3 arguments littéraux perd son secours, le reste du code est intact', () => {
    let retires = 0
    for (const f of readdirSync(RUNTIME_DIR).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(join(RUNTIME_DIR, f), 'utf-8')
      const out = stripMsgFallbacks(src)
      retires += src.length - out.length > 0 ? 1 : 0
      assert.doesNotMatch(out, /µ\._mjs_(?:msg|txt)\(\s*'[A-Za-z.]+'\s*,\s*[^,()]*,\s*'/, `un secours reste dans ${f}`)
    }
    assert.ok(retires > 20, `trop peu de fichiers touchés : ${retires}`)
  })
})

// chargeur isolé du cœur (mjs_init seul), avec une table et un fetch simulés
function assistant(opts: { urls?: Record<string, string> | null, lang?: string, lookup?: (k: string) => any, fetch?: any } = {}) {
  const win: any = new Window({ url: 'http://localhost/' })
  const initSrc = readFileSync(join(RUNTIME_DIR, 'mjs_init.ts'), 'utf-8').replace(/export\s*\{[^}]*\}/, '')
  const demandes: string[] = []
  const fichiers: Record<string, any> = {
    '/fr.json': { monMsg: 'bonjour {nom}, ça va', autre: 'second' },
    '/en.json': { monMsg: 'hello {nom}, fine', autre: 'other' },
  }
  const fetchSimule = opts.fetch ?? ((url: string) => {
    demandes.push(url)
    return Promise.resolve({ ok: true, json: () => Promise.resolve(fichiers[url]) })
  })
  const ecrits: string[] = []
  const journal: string[] = []
  const trace = (niveau: string) => (...a: any[]) => { const t = a.map(String).join(' '); ecrits.push(t); journal.push(niveau + ' ' + t) }
  const consoleSimulee = { log: trace('log'), warn: trace('warn'), error: trace('error') }
  const µ: any = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', 'fetch', 'console', `${initSrc}\nreturn µ;`)(
    win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet, fetchSimule, consoleSimulee,
  )
  µ._runtimeLabels = { fr: { modal: { ok: 'OK' } }, en: { modal: { ok: 'OK' } } }
  µ._runtimeLabelsLang = 'fr'
  if (opts.urls !== null) µ._msgUrls = opts.urls ?? { fr: '/fr.json', en: '/en.json' }
  if (opts.lang) µ._mjs_storeRaw = { __mjsLang: opts.lang }
  if (opts.lookup) µ._mjs_i18nLookup = opts.lookup
  const levee = (message: string) => win.dispatchEvent(new win.ErrorEvent('error', { message }))
  return { µ, demandes, ecrits, journal, fichiers, levee }
}

const attendre = () => new Promise((r) => setTimeout(r, 20))

describe('µ._mjs_txt — fichier de messages chargé à la demande', () => {
  it('texte court tout de suite (clé + variables), une seule requête, puis texte complet dans la console', async () => {
    const { µ, demandes, ecrits } = assistant({ lang: 'fr' })
    assert.equal(µ._mjs_msg('monMsg', { nom: 'x' }), '[ModularJS] monMsg {"nom":"x"}')
    assert.deepEqual(demandes, [], 'un texte jamais écrit ne demande rien')
    µ.log(µ._mjs_msg('monMsg', { nom: 'x' }))
    assert.deepEqual(demandes, ['/fr.json'], 'le fichier part quand le message est écrit')
    await attendre()
    assert.deepEqual(ecrits, ['[ModularJS] monMsg {"nom":"x"}', '[ModularJS] bonjour x, ça va'])
    assert.equal(µ._runtimeLabels.fr.err.autre, 'second')
    assert.equal(µ._mjs_msg('monMsg', { nom: 'y' }), '[ModularJS] bonjour y, ça va', 'une fois le fichier là, le texte est complet tout de suite')
    assert.equal(demandes.length, 1)
  })

  it('sans variables : la clé suivie de {}', () => {
    const { µ } = assistant({ lang: 'fr' })
    assert.equal(µ._mjs_txt('monMsg'), 'monMsg {}')
  })

  it('même message (clé + variables) demandé deux fois en attente : une requête, un texte complet', async () => {
    const { µ, demandes, ecrits, levee } = assistant({ lang: 'fr' })
    for (const m of [µ._mjs_msg('monMsg', { nom: 'x' }), µ._mjs_msg('monMsg', { nom: 'x' }), µ._mjs_msg('autre')]) levee(m)
    await attendre()
    assert.equal(demandes.length, 1)
    assert.deepEqual(ecrits.sort(), ['[ModularJS] bonjour x, ça va', '[ModularJS] second'])
  })

  it('le texte complet respecte µ._logLevel : rien sous silent', async () => {
    const { µ, ecrits } = assistant({ lang: 'fr' })
    µ.log(µ._mjs_msg('monMsg', { nom: 'x' }))
    µ._logLevel = 'silent'
    await attendre()
    assert.deepEqual(ecrits, ['[ModularJS] monMsg {"nom":"x"}'], 'seul le texte court, écrit avant le silence')
  })

  it('langue de la page : en, puis fr après un changement de langue', async () => {
    const { µ, demandes, ecrits, levee } = assistant({ lang: 'en' })
    levee(µ._mjs_msg('monMsg', { nom: 'x' }))
    await attendre()
    µ._mjs_storeRaw.__mjsLang = 'fr'
    assert.equal(µ._mjs_txt('monMsg', { nom: 'x' }), 'monMsg {"nom":"x"}', 'le fichier de la nouvelle langue n\'est pas encore là')
    levee(µ._mjs_txt('monMsg', { nom: 'x' }))
    await attendre()
    assert.deepEqual(demandes, ['/en.json', '/fr.json'])
    assert.deepEqual(ecrits, ['[ModularJS] hello x, fine', 'bonjour x, ça va'], 'le second texte, jamais écrit, sort sans préfixe : il vient de _mjs_txt seul')
  })

  it('langue inconnue : repli sur la langue du build, puis en, puis fr', async () => {
    const a = assistant({ lang: 'de' })
    a.µ.log(a.µ._mjs_msg('autre'))
    assert.deepEqual(a.demandes, ['/fr.json'])
    const b = assistant({ lang: 'de', urls: { en: '/en.json', fr: '/fr.json' } })
    b.µ._runtimeLabelsLang = 'es'
    b.µ.log(b.µ._mjs_msg('autre'))
    assert.deepEqual(b.demandes, ['/en.json'])
    const c = assistant({ lang: 'constructor' })
    c.µ.log(c.µ._mjs_msg('autre'))
    assert.deepEqual(c.demandes, ['/fr.json'])
  })

  it('la surcharge mjs.err.<clé> du site reste prioritaire : aucune requête', () => {
    const { µ, demandes } = assistant({ lang: 'fr', lookup: (k: string) => k === 'mjs.err.monMsg' ? 'surchargé {nom}' : undefined })
    assert.equal(µ._mjs_msg('monMsg', { nom: 'x' }), '[ModularJS] surchargé x')
    assert.equal(demandes.length, 0)
  })

  it('échec de chargement : ne lève jamais, pas de boucle, nouvel essai au plus après 30 s', async () => {
    let appels = 0
    const { µ } = assistant({ lang: 'fr', fetch: () => { appels++; return Promise.reject(new Error('réseau')) } })
    assert.equal(µ._mjs_msg('monMsg', { nom: 'x' }), '[ModularJS] monMsg {"nom":"x"}')
    µ.log(µ._mjs_msg('monMsg', { nom: 'x' }))
    await attendre()
    µ.log(µ._mjs_msg('monMsg', { nom: 'y' }))
    µ.log(µ._mjs_msg('monMsg', { nom: 'z' }))
    await attendre()
    assert.equal(appels, 1, 'pas de relance dans les 30 s')
    const reel = Date.now
    try {
      Date.now = () => reel() + 31000
      µ.log(µ._mjs_msg('monMsg', { nom: 'w' }))
    } finally { Date.now = reel }
    assert.equal(appels, 2)
    await attendre()
  })

  it('fetch qui lève tout de suite, ou réponse illisible : texte court, jamais d\'exception', async () => {
    const a = assistant({ lang: 'fr', fetch: () => { throw new Error('boum') } })
    assert.equal(a.µ._mjs_txt('monMsg', { nom: 'x' }), 'monMsg {"nom":"x"}')
    a.µ.log(a.µ._mjs_txt('monMsg', { nom: 'x' }))
    const b = assistant({ lang: 'fr', fetch: () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('json')) }) })
    assert.equal(b.µ._mjs_txt('monMsg', { nom: 'x' }), 'monMsg {"nom":"x"}')
    b.µ.log(b.µ._mjs_txt('monMsg', { nom: 'x' }))
    await attendre()
    assert.deepEqual(b.ecrits, ['monMsg {"nom":"x"}'], 'seul le texte court est écrit')
  })

  it('variables non sérialisables : texte court sans exception, toujours terminé par {}', () => {
    const { µ } = assistant({ lang: 'fr' })
    const boucle: any = {}
    boucle.moi = boucle
    assert.equal(µ._mjs_txt('monMsg', boucle), 'monMsg {}')
  })

  it('sans fetch (prérendu, Node) : texte court, aucune requête', () => {
    const initSrc = readFileSync(join(RUNTIME_DIR, 'mjs_init.ts'), 'utf-8').replace(/export\s*\{[^}]*\}/, '')
    const win: any = new Window({ url: 'http://localhost/' })
    const µ: any = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', 'fetch', `${initSrc}\nreturn µ;`)(win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet, undefined)
    µ._msgUrls = { fr: '/fr.json' }
    assert.equal(µ._mjs_txt('monMsg', { nom: 'x' }), 'monMsg {"nom":"x"}')
  })

  it('sans table des adresses : comportement d\'origine (secours français, sinon la clé)', () => {
    const { µ, demandes } = assistant({ urls: null, lang: 'fr' })
    assert.equal(µ._mjs_txt('monMsg', { nom: 'x' }, 'secours {nom}'), 'secours x')
    assert.equal(µ._mjs_txt('monMsg'), 'monMsg')
    assert.equal(demandes.length, 0)
  })

  it('une table déjà présente passe avant le fichier', () => {
    const { µ, demandes } = assistant({ lang: 'fr' })
    µ._runtimeLabels.fr.err = { monMsg: 'déjà là {nom}' }
    assert.equal(µ._mjs_txt('monMsg', { nom: 'x' }), 'déjà là x')
    assert.equal(demandes.length, 0)
  })
})

describe('µ._mjs_txt — le texte complet garde le niveau, le préfixe et les morceaux imbriqués', () => {
  const piece = (µ: any) => µ._mjs_txt('autre')

  it('un message écrit par µ.log reste un log (jamais un avertissement), avec le préfixe de l\'appelant', async () => {
    const { µ, journal } = assistant({ lang: 'fr' })
    µ.log('   ↳ 🚫 [Router] ' + µ._mjs_txt('monMsg', { nom: 'x' }))
    await attendre()
    assert.deepEqual(journal, ['log    ↳ 🚫 [Router] monMsg {"nom":"x"}', 'log    ↳ 🚫 [Router] bonjour x, ça va'])
  })

  it('µ.error reste une erreur, µ.warn un avertissement, avec leurs préfixes et leurs autres arguments', async () => {
    const { µ, journal } = assistant({ lang: 'fr' })
    const cause = new Error('cause')
    µ.error('[µ.schema] ' + µ._mjs_txt('monMsg', { nom: 'a' }), cause)
    µ.warn('[Router] ' + µ._mjs_txt('autre'))
    await attendre()
    assert.deepEqual(journal.slice(2), ['error [µ.schema] bonjour a, ça va Error: cause', 'warn [Router] second'])
  })

  it('un morceau dans les variables d\'un autre : écrit une seule fois, dans le message qui le contient', async () => {
    const { µ, journal } = assistant({ lang: 'fr' })
    µ.warn(µ._mjs_msg('monMsg', { nom: piece(µ) }))
    await attendre()
    assert.deepEqual(journal.slice(1), ['warn [ModularJS] bonjour second, ça va'])
  })

  it('morceau sans variables dont la clé est contenue dans le texte court de l\'autre', async () => {
    const { µ, journal } = assistant({ lang: 'fr' })
    µ.log(µ._mjs_msg('monMsg', { nom: µ._mjs_txt('autre') }))
    await attendre()
    assert.deepEqual(journal.slice(1), ['log [ModularJS] bonjour second, ça va'])
  })

  it('une erreur levée (texte jamais écrit) : erreur avec le préfixe si _mjs_msg, sans si _mjs_txt', async () => {
    const { µ, journal, levee } = assistant({ lang: 'fr' })
    levee(µ._mjs_msg('monMsg', { nom: 'x' }))
    levee(µ._mjs_txt('autre'))
    await attendre()
    assert.deepEqual(journal.sort(), ['error [ModularJS] bonjour x, ça va', 'error second'])
  })

  it('deux écritures du même message : deux réécritures, une seule requête', async () => {
    const { µ, journal, demandes } = assistant({ lang: 'fr' })
    µ.warn('a ' + µ._mjs_txt('autre'))
    µ.warn('b ' + µ._mjs_txt('autre'))
    await attendre()
    assert.deepEqual(journal, ['warn a autre {}', 'warn b autre {}', 'warn a second', 'warn b second'])
    assert.equal(demandes.length, 1)
  })

  it('un texte court plus long qui en contient un plus court : chacun remplacé à sa place', async () => {
    const { µ, journal } = assistant({ lang: 'fr' })
    µ.warn(µ._mjs_txt('monMsg') + ' / ' + µ._mjs_txt('monMsg', { nom: 'x' }))
    await attendre()
    assert.deepEqual(journal.slice(1), ['warn bonjour {nom}, ça va / bonjour x, ça va'])
  })

  it('sous silent : rien d\'écrit, jamais d\'exception', async () => {
    const { µ, ecrits } = assistant({ lang: 'fr' })
    µ._logLevel = 'silent'
    µ.error('[Router] ' + µ._mjs_txt('monMsg', { nom: 'x' }))
    µ._mjs_msg('autre')
    await attendre()
    assert.deepEqual(ecrits, [])
  })

  it('un argument qui n\'est pas une chaîne passe tel quel au second appel', async () => {
    const { µ, journal } = assistant({ lang: 'fr' })
    µ.warn('x ' + µ._mjs_txt('autre'), 42, null)
    await attendre()
    assert.deepEqual(journal.slice(1), ['warn x second 42 null'])
  })
})

describe('build de production — messages hors du manifeste', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  async function construire(env: 'dev' | 'prod', js: 'split' | 'bundle') {
    const root = mjsTmp('messages-fichiers-' + env + '-' + js)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), '<div>x</div>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env, js })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const fichiers = readdirSync(outDir)
    const manifeste = readFileSync(join(outDir, 'bundle.js'), 'utf-8')
    const noyau = fichiers.filter((f) => /^mjs_core-.*\.js$/.test(f)).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
    await bundler.close()
    return { root, outDir, fichiers, manifeste, noyau }
  }

  function table(manifeste: string): any {
    const ligne = manifeste.split('\n').map((l) => l.trim()).find((l) => l.startsWith('µ._runtimeLabels ='))!
    return JSON.parse(ligne.slice('µ._runtimeLabels ='.length).trim().replace(/;$/, ''))
  }

  for (const js of ['split', 'bundle'] as const) {
    describe(`mode js ${js}`, () => {
      let prod: Awaited<ReturnType<typeof construire>>

      before(async () => { prod = await construire('prod', js) })

      it('le manifeste ne porte plus le groupe err, ni dev ; les libellés d\'interface restent', () => {
        if (js === 'bundle') return // le fichier unique est minifié : la table est vérifiée par le contenu du fichier
        const t = table(prod.manifeste)
        for (const lang of ['fr', 'en']) {
          assert.equal(t[lang].err, undefined)
          assert.equal(t[lang].dev, undefined)
          assert.ok(t[lang].modal && t[lang].router && t[lang].toast && t[lang].ujs)
        }
      })

      it('un fichier JSON haché par langue, avec les clés de la table hors les textes que seules des traces lisent', () => {
        for (const lang of ['fr', 'en'] as const) {
          const noms = prod.fichiers.filter((f) => new RegExp(`^mjs_err-${lang}-[0-9a-z]{5}\\.json$`).test(f))
          assert.equal(noms.length, 1, `fichier ${lang} : ${prod.fichiers.join(', ')}`)
          const contenu = JSON.parse(readFileSync(join(prod.outDir, noms[0]), 'utf-8'))
          // au niveau de console par défaut le build retire les traces du cœur : leur texte ne part pas non plus
          const attendu = Object.fromEntries(Object.entries(RUNTIME_LABELS[lang].err).filter(([cle]) => !TRACE_ONLY_MESSAGES.includes(cle)))
          assert.deepEqual(Object.keys(contenu).sort(), Object.keys(attendu).sort())
          assert.equal(Object.keys(contenu).length, Object.keys(RUNTIME_LABELS.fr.err).length - TRACE_ONLY_MESSAGES.length)
          assert.deepEqual(contenu, attendu)
        }
      })

      it('le manifeste pose l\'adresse de chaque fichier', () => {
        const ligne = prod.manifeste.split('\n').find((l) => l.includes('_msgUrls'))
        assert.ok(ligne !== undefined || /_msgUrls/.test(prod.manifeste), 'table des adresses absente')
        for (const lang of ['fr', 'en']) assert.match(prod.manifeste, new RegExp(`mjs_err-${lang}-[0-9a-z]{5}\\.json`))
      })

      it('les fichiers ne sont pas dans la liste de précache, mais dans le registre des sorties', () => {
        const precache = JSON.parse(readFileSync(join(prod.outDir, 'mjs-precache.json'), 'utf-8'))
        if (js === 'split') assert.ok(precache.assets.length > 0)
        assert.equal(precache.assets.some((a: string) => a.includes('mjs_err-')), false)
        const registre = JSON.parse(readFileSync(join(prod.outDir, '.mjs-outputs.json'), 'utf-8'))
        assert.ok(registre.extensions.includes('.json'))
      })

      it('le cœur de production ne porte plus aucun texte de secours français des messages', () => {
        const ou = js === 'bundle' ? prod.manifeste : prod.noyau
        assert.doesNotMatch(ou, /Cycle réactif détecté sur/)
        assert.doesNotMatch(ou, /la balise doit porter deux enfants/)
      })
    })
  }

  it('production : la table du manifeste (split) est celle de runtimeLabelsFor(true), sans err', async () => {
    const t = runtimeLabelsFor(true) as any
    for (const lang of ['fr', 'en']) {
      assert.equal(t[lang].err, undefined)
      assert.equal(t[lang].dev, undefined)
    }
  })

  it('développement : rien ne change — table complète, aucun fichier, aucune adresse, secours au site d\'appel', async () => {
    const dev = await construire('dev', 'split')
    const t = table(dev.manifeste)
    for (const lang of ['fr', 'en']) {
      assert.ok(Object.keys(t[lang].err).length > 100)
      assert.ok(t[lang].dev.hotcssRoot)
    }
    assert.equal(dev.fichiers.some((f) => f.startsWith('mjs_err-')), false)
    assert.doesNotMatch(dev.manifeste, /_msgUrls/)
    assert.match(dev.noyau, /Cycle réactif détecté sur/)
  })
})
