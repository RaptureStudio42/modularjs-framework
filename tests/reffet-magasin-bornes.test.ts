// Les bornes du reffet d'un magasin, et le reffet d'avant l'écran sous son nom `µeffect.before`.
//
// Le reffet d'un magasin suit le magasin comme un composant qui le lit : un `µ$$x` en entier (l'écriture d'une clé qu'il ne lit pas
// le relance). Deux reffets qui s'écrivent l'un l'autre se relancent sans fin : la garde des 10 000 passages les arrête, avec
// l'avertissement de développement « Boucle réactive détectée », et la page vit. Un `µeffect` écrit dans le corps d'un reffet de
// magasin n'est plus au premier niveau du fichier : il ne tourne pas, un avertissement dit où l'écrire. Le fichier d'un magasin qui
// lève avant sa fin ne reste pas ouvert : un reffet écrit ensuite, ailleurs, n'y est pas adopté. Une construction de production sans
// reffet de magasin ni reffet d'avant n'en porte pas un octet, `µStore` compris. La doc dit tout cela, et l'exemple du panier ne lit
// le navigateur que hors du rendu serveur.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { annotateEffectDeps } from '../src/generator/effect-deps.js'
import { lintEffectTopLevel, lintEffectOldName } from '../src/transpiler/lint.js'
import { construire, charger } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const RACINE = fileURLToPath(new URL('../', import.meta.url))

const SOURCES: Record<string, string> = {
  // trois magasins légers dans un seul fichier (une page de développement n'en charge qu'un sans heurt) : un reffet qui lit une seule
  // clé ; deux reffets qui s'écrivent l'un l'autre, au repos tant que `go` est faux ; un `µeffect` écrit dans le corps d'un reffet
  'mb-magasins.module.civet.mjs': [
    'export µ$$entier = { a: 0, b: 0 }',
    'export µ$$la = { go: false, n: 0, double: 0, vus: 0 }',
    'export µ$$lb = { m: 0, somme: 0, vus: 0 }',
    'export µ$$imbrique = { n: 0 }',
    'export µ$$tot = { n: 0 }',
    'export caisseTot = new µStore(n: 0)',
    '',
    'µeffect ->',
    '  µ$$entier.a',
    '  window.__entier = (window.__entier or 0) + 1',
    '',
    'µeffect ->',
    '  return unless µ$$la.go',
    '  µ$$la.vus++',
    '  µ$$la.double = µ$$lb.m * 2',
    '',
    'µeffect ->',
    '  return unless µ$$la.go',
    '  µ$$lb.vus++',
    '  µ$$lb.somme = µ$$la.n + µ$$la.double',
    '',
    'µeffect ->',
    '  µ$$imbrique.n',
    '  µeffect -> window.__imbrique = true',
    '',
    'µeffect ->',
    "  throw new Error('casse avant de lire') if window.__totCasse",
    '  window.__tot = (window.__tot or 0) + 1',
    '  µ$$tot.n',
    '',
    'µeffect ->',
    "  throw new Error('casse avant de lire') if window.__totCasse",
    '  window.__caisseTot = (window.__caisseTot or 0) + 1',
    '  caisseTot.data.n',
    '',
    'µeffect ->',
    '  µ$$tot.n + caisseTot.data.n',
    '  window.__deux = (window.__deux or 0) + 1',
    '',
    'window.__totN = -> µ$$tot.n++; caisseTot.data.n++',
    'window.__totInverse = -> caisseTot.data.n++; µ$$tot.n++',
    'window.__entierB = -> µ$$entier.b++',
    'window.__boucleVus = -> µ$$la.vus + µ$$lb.vus',
    'window.__imbriqueN = -> µ$$imbrique.n++',
  ].join('\n'),
  'mb-vitrine.mjs': [
    '@import µ$$entier \'mb-magasins.module.civet.mjs\'',
    '@import µ$$la \'mb-magasins.module.civet.mjs\'',
    '@import µ$$imbrique \'mb-magasins.module.civet.mjs\'',
    '<p class="v">{µ$$entier.a} {µ$$imbrique.n}</p>',
    '<button class="go" @click={µ$$la.go = true}>go</button>',
  ].join('\n'),
}

// une production sans reffet de magasin ni reffet d'avant : un `µStore` lu par un composant qui a son `µeffect`
const SANS: Record<string, string> = {
  'mb-stock.module.civet.mjs': [
    'export stock = new µStore(pieces: 3)',
    '',
    'window.__mbRetirer = -> stock.data.pieces--',
  ].join('\n'),
  'mb-sans.mjs': [
    '@import stock \'mb-stock.module.civet.mjs\'',
    '<script>',
    '  µeffect ->',
    '    window.__mbVu = stock.data.pieces',
    '</script>',
    '<p class="p">{stock.data.pieces}</p>',
  ].join('\n'),
}

// une production avec le reffet d'un magasin `µStore` : rien du magasin global (`$$x`, module `vault`) n'y est lu
const AVEC: Record<string, string> = {
  'mb-caisse.module.civet.mjs': [
    'export caisse = new µStore(total: 0)',
    '',
    'µeffect ->',
    '  window.__total = caisse.data.total',
    '',
    'window.__plus = -> caisse.data.total++',
  ].join('\n'),
  'mb-avec.mjs': [
    '@import caisse \'mb-caisse.module.civet.mjs\'',
    '<p class="t">{caisse.data.total}</p>',
  ].join('\n'),
}

const ombre  = `document.querySelector('mjs-mb-vitrine')._shadow`
const vers   = (page: any, js: string) => page.evaluate(`(() => { ${js}; return null })()`)
const jusqua = (page: any, cond: string) => page.waitForFunction(cond, null, { timeout: 4000 }).catch(() => {})
const boucle = (avis: string[]) => avis.filter((a) => /Boucle réactive|Reactive loop/.test(a))
const refus  = (avis: string[]) => avis.filter((a) => a.includes('fichier d\'un magasin') || a.includes('store file'))

const cibles = new Map<string, Promise<Cible>>()
const cible  = (mode: Mode, sources = SOURCES, balise = 'mjs-mb-vitrine') => {
  const cle = `${mode} ${balise}`
  if (!cibles.has(cle)) cibles.set(cle, construire(mode, sources, [balise]))
  return cibles.get(cle)!
}

// la section d'une page de doc qui commence par ce titre, jusqu'au titre suivant du même niveau
const section = (fichier: string, titre: string) => {
  const doc = readFileSync(join(RACINE, 'docs', fichier), 'utf-8')
  const i   = doc.indexOf(titre)
  assert.ok(i >= 0, `${fichier} : section « ${titre} » introuvable`)
  const j = doc.indexOf('\n### ', i + titre.length)
  return doc.slice(i, j < 0 ? undefined : j)
}

const fichiers = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? fichiers(join(dir, e.name)) : /\.(ts|mjs|md)$/.test(e.name) ? [join(dir, e.name)] : [])

describe('µeffect.before et les bornes du reffet d\'un magasin — compilation et doc', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('µeffect.before reçoit ses dépendances comme µeffect', function () {
    const js = annotateEffectDeps('µ.effect.before(function() { $.messages.length; return x() })')
    assert.match(js, /µ\.effect\.before\(function\(\) \{ \$\.messages\.length; return x\(\) \}, \["messages"\]\)/)
  })

  it('aucun reste de l\'ancien nom du reffet d\'avant dans le compilateur, le cœur et la doc', function () {
    const anciens = /µeffect\.pre\b|effect\.pre\b|\\s\*pre\\s\*|\\\.pre\)|property\?\.name === 'pre'|effect_pre|EFFECT_PRE|_mjs_pre(?:W|In|Vars)?\b|_mjsPre\b|_mjs_runPre\b/
    // seul le refus de l'ancien nom le cite
    const restes  = [...fichiers(join(RACINE, 'src')), ...fichiers(join(RACINE, 'docs'))].filter((f) => readFileSync(f, 'utf-8').split('\n').some((l) => !l.includes('rune-effect-pre-renamed') && anciens.test(l)))
    assert.deepEqual(restes.map((f) => f.slice(RACINE.length)), [])
  })

  // la production raccourcit les noms `_mjs_*` : le cœur sans ces blocs se lit dans les sources, la construction retire les blocs
  it('µeffect.pre, l\'ancien nom, est refusé à la construction avec le nouveau nom', async function () {
    assert.throws(() => lintEffectTopLevel('$n = 0\nµeffect.pre ->\n  $n'), /« µeffect\.pre » \(ligne 2\)[\s\S]*« µeffect\.before »/)
    assert.throws(() => lintEffectTopLevel('µ.effect.pre ->\n  $n'), /µeffect\.before/)
    lintEffectTopLevel('µeffect.before ->\n  $n\n# µeffect.pre dans un commentaire\nx = "µeffect.pre"')
    const magasin = { 'mb-ancien.module.civet.mjs': 'export µ$$ancien = { n: 0 }\n\nµeffect.pre ->\n  µ$$ancien.n', 'mb-ancien.mjs': '@import µ$$ancien \'mb-ancien.module.civet.mjs\'\n<p>{µ$$ancien.n}</p>' }
    await assert.rejects(construire('bundle', magasin, ['mjs-mb-ancien']), /« µeffect\.pre » \(ligne 3\)[\s\S]*« µeffect\.before »/)
  })

  it('le refus de l\'ancien nom ne voit ni chaîne, ni expression régulière, ni commentaire, et garde les vrais refus', function () {
    const q3      = '"'.repeat(3)
    const a3      = "'".repeat(3)
    const inertes = ['x = "a\n  µeffect.pre b"', 'x = "a #{"µeffect.pre"} b"', 'x = /µeffect.pre/', `x = ${a3}\n  µeffect.pre\n${a3}`, `x = ${q3}\n  #{y} µeffect.pre\n${q3}`, 'x = ///\n  µeffect.pre\n///', '### µeffect.pre ###', '# µeffect.pre', 'x = `a $' + '{"µeffect.pre"} b`', "x = 'a\n  µeffect.pre'"]
    for (const s of inertes) {
      assert.doesNotThrow(() => lintEffectTopLevel(s), `composant : ${s}`)
      assert.doesNotThrow(() => lintEffectOldName(s, 1, 'coffee'), `magasin : ${s}`)
    }
    for (const s of ['µeffect.pre ->\n  $n', 'µ.effect.pre ->\n  $n', 'mjs.effect.pre ->\n  $n', 'x = "a #{µeffect.pre -> 1} b"', 'y = 1 / 2\nµeffect.pre ->\n  $n']) {
      assert.throws(() => lintEffectTopLevel(s), /« µeffect\.before »/, `composant : ${s}`)
      assert.throws(() => lintEffectOldName(s, 1, 'coffee'), /« µeffect\.before »/, `magasin : ${s}`)
    }
    assert.throws(() => lintEffectTopLevel('µeffect.pre ->\n  $n', true), /« µeffect\.before »/, '<script module>')
  })

  it('une production sans reffet de magasin ni reffet d\'avant n\'en porte pas un octet, µStore compris', async function () {
    for (const f of ['mjs_store.ts', 'mjs_effect.ts']) {
      let dedans = false
      for (const l of readFileSync(join(RACINE, 'src', 'runtime', f), 'utf-8').split('\n')) {
        if (/^\s*\/\/ <reffet-store>$/.test(l)) dedans = true
        else if (/^\s*\/\/ <\/reffet-store>$/.test(l)) dedans = false
        else if (!dedans && /_mjs_magW|_mjs_authors|_mjsStore\b|_mjsReffetStore\b|_mjs_magOpen|_mjs_storeOwners/.test(l)) assert.fail(`${f} : code du reffet d'un magasin hors de son bloc balisé : ${l.trim()}`)
      }
    }
    const prod   = await cible('bundle', SANS, 'mjs-mb-sans')
    const bundle = readFileSync(join(prod.racine, 'out', 'bundle.js'), 'utf-8')
    assert.match(bundle, /\.Store\s*=/, 'µStore construit')
    assert.ok(!bundle.includes('effect.before'), 'aucun reffet d\'avant dans la production')
  })

  it('le reffet d\'un magasin ne fait garder aucun module du cœur en plus (le magasin global `vault` reste dehors)', async function () {
    const lignes = [] as string[]
    const avant  = [console.log, console.warn, console.error]
    console.log = console.warn = console.error = (...a: any[]) => { lignes.push(a.join(' ')) }
    try {
      await construire('bundle', AVEC, ['mjs-mb-avec'])
    } finally {
      [console.log, console.warn, console.error] = avant
    }
    const garde = lignes.find((l) => l.includes('gardés :'))
    assert.ok(garde, 'relevé des modules du cœur introuvable : ' + lignes.join(' | ').slice(0, 300))
    assert.match(garde!, /gardés : aucun ;/)
  })

  it('la doc dit ce que suit le reffet d\'un magasin, la garde des 10 000 passages, et garde le panier du rendu serveur', function () {
    for (const [fichier, titre] of [['03-reactivite.md', '### Le reffet d\'un magasin'], ['14-stores.md', '### Un reffet dans le fichier du magasin']]) {
      const s    = section(fichier, titre)
      const bloc = /```(\w+)\n# panier\.module\.civet\.mjs\n([\s\S]*?)```/.exec(s)
      assert.ok(bloc, `${fichier} : exemple du panier introuvable`)
      assert.equal(bloc[1], 'civet', `${fichier} : bloc du panier balisé civet`)
      for (const l of bloc[2].split('\n').filter((x) => x.includes('localStorage'))) assert.match(l, /µserver/, `${fichier} : navigateur lu hors du rendu serveur : ${l}`)
      assert.match(s, /en entier/, `${fichier} : un µ$$x suivi en entier`)
      assert.match(s, /10 000/, `${fichier} : la garde des 10 000 passages`)
      assert.match(s, /Boucle réactive détectée/, `${fichier} : l'avertissement de la garde`)
      assert.doesNotMatch(s, /passent chacun une fois par changement/, `${fichier} : deux reffets qui s'écrivent l'un l'autre ne passent pas une fois chacun`)
    }
    const s03 = section('03-reactivite.md', '### Le reffet d\'un magasin')
    assert.match(s03, /corps d'un reffet/, 'un µeffect dans le corps d\'un reffet de magasin')
    assert.match(s03, /sa propre garde/, 'le composant qui lit deux magasins en boucle atteint sa propre garde')
    assert.match(s03, /deux fois/, 'un gestionnaire qui écrit un µ$$x puis un µStore lus par le même reffet : deux passages')
    assert.doesNotMatch(s03, /une fois par rafale de changements de ce qu'il suit/, 'la règle exacte des passages')
    assert.match(s03, /dernier passage réussi/, 'après une erreur, il repart au changement suivant de ce qu\'il lisait')
  })
})

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`les bornes du reffet d'un magasin (${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null

  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright[moteur].executablePath())) { console.log(`  ℹ️  ${moteur} non installé, test sauté`); return }
    browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev-parents-avant', 'bundle'] as const) {
    const nom = mode === 'bundle' ? 'production' : 'développement'

    it(`un µ$$x suivi en entier : l'écriture d'une clé qu'il ne lit pas le relance (${nom})`, async function () {
      if (!browser) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-mb-vitrine')
      try {
        await jusqua(o.page, `window.__entier >= 1`)
        await o.page.waitForTimeout(100)
        assert.equal(await o.page.evaluate('window.__entier'), 1, 'une fois à la création')
        await vers(o.page, `window.__entierB()`)
        await jusqua(o.page, `window.__entier >= 2`)
        await o.page.waitForTimeout(100)
        assert.equal(await o.page.evaluate('window.__entier'), 2, 'une clé qu\'il ne lit pas : un passage')
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.fermer()
      }
    })

    it(`deux reffets qui s'écrivent l'un l'autre : arrêtés par la garde des 10 000 passages, la page vit (${nom})`, async function () {
      if (!browser) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-mb-vitrine')
      try {
        await jusqua(o.page, `window.__boucleVus !== undefined && window.__entier >= 1`)
        assert.equal(await o.page.evaluate('window.__boucleVus()'), 0, 'au repos tant que rien ne les lance')
        await vers(o.page, `${ombre}.querySelector('.go').click()`)
        await jusqua(o.page, `window.__boucleVus() >= 10000`)
        await o.page.waitForTimeout(300)
        const vus = await o.page.evaluate('window.__boucleVus()')
        assert.ok(vus >= 10000 && vus <= 20004, `relancés l'un par l'autre jusqu'à la garde : ${vus}`)
        await o.page.waitForTimeout(200)
        assert.equal(await o.page.evaluate('window.__boucleVus()'), vus, 'arrêtés')
        if (mode !== 'bundle') assert.ok(boucle(o.avis).length >= 1, 'avertissement de la garde : ' + JSON.stringify(o.avis))
        await vers(o.page, `window.__entierB()`)
        await jusqua(o.page, `window.__entier >= 2`)
        assert.equal(await o.page.evaluate('window.__entier'), 2, 'la page vit : un autre reffet passe encore')
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.fermer()
      }
    })

    it(`un µeffect écrit dans le corps d'un reffet de magasin ne tourne pas, un avertissement dit où l'écrire (${nom})`, async function () {
      if (!browser) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-mb-vitrine')
      try {
        await jusqua(o.page, `window.__imbriqueN !== undefined && window.__entier >= 1`)
        await vers(o.page, `window.__imbriqueN()`)
        await o.page.waitForTimeout(150)
        assert.equal(await o.page.evaluate('window.__imbrique'), undefined, 'le reffet du corps ne tourne pas')
        if (mode !== 'bundle') assert.ok(refus(o.avis).length >= 2, 'un avertissement à chaque passage : ' + JSON.stringify(o.avis))
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.fermer()
      }
    })

    it(`un gestionnaire qui écrit un µ$$x puis un µStore lus par le même reffet le fait passer deux fois, dans l'ordre inverse une fois (${nom})`, async function () {
      if (!browser) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-mb-vitrine')
      const n = () => o.page.evaluate('window.__deux')
      try {
        await jusqua(o.page, `window.__deux >= 1`)
        await o.page.waitForTimeout(100)
        assert.equal(await n(), 1, 'une fois à la création')
        await vers(o.page, `window.__totN()`)
        await jusqua(o.page, `window.__deux >= 3`)
        await o.page.waitForTimeout(100)
        assert.equal(await n(), 3, 'µ$$x puis µStore : un passage pour chacun')
        await vers(o.page, `window.__totInverse()`)
        await jusqua(o.page, `window.__deux >= 4`)
        await o.page.waitForTimeout(100)
        assert.equal(await n(), 4, 'µStore puis µ$$x : un passage')
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.fermer()
      }
    })

    it(`un reffet de magasin qui lève avant sa première lecture repart au changement suivant (${nom})`, async function () {
      if (!browser) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-mb-vitrine')
      const lu = () => o.page.evaluate('[window.__tot, window.__caisseTot].join(" ")')
      try {
        await jusqua(o.page, `window.__tot >= 1 && window.__caisseTot >= 1`)
        await vers(o.page, `window.__totN()`)
        await jusqua(o.page, `window.__tot >= 2 && window.__caisseTot >= 2`)
        assert.equal(await lu(), '2 2', 'un changement : un passage')
        const crashs = () => o.avis.filter((a) => a.includes('Crash intercepted in mb-magasins')).length
        await vers(o.page, `window.__totCasse = true; window.__totN()`)
        for (let i = 0; i < 80 && crashs() < 2; i++) await o.page.waitForTimeout(25)
        if (mode !== 'bundle') assert.equal(crashs(), 2, 'l\'erreur, avant toute lecture, s\'affiche : ' + JSON.stringify(o.avis))
        assert.equal(await lu(), '2 2', 'le passage qui lève n\'a rien compté')
        await vers(o.page, `window.__totCasse = false; window.__totN()`)
        await jusqua(o.page, `window.__tot >= 3 && window.__caisseTot >= 3`)
        assert.equal(await lu(), '3 3', 'il repart au changement suivant de ce qu\'il lisait, µ$$x comme µStore')
        await vers(o.page, `window.__totN()`)
        await jusqua(o.page, `window.__tot >= 4 && window.__caisseTot >= 4`)
        assert.equal(await lu(), '4 4', 'et suit de nouveau ce qu\'il lit')
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.fermer()
      }
    })

    it(`le fichier d'un magasin qui lève avant sa fin ne reste pas ouvert : un reffet écrit ensuite n'y est pas adopté (${nom})`, async function () {
      if (!browser) { this.skip(); return }
      const c = await cible(mode)
      // l'appel d'ouverture que le compilateur écrit en tête du fichier d'un magasin : son nom tel quel en développement, raccourci en
      // production (relu dans la construction)
      const ouvre = mode === 'bundle' ? /\.([\w$]+)\("mb-magasins\.module\.civet\.mjs"\)/.exec(readFileSync(join(c.racine, 'out', 'bundle.js'), 'utf-8'))?.[1] : '_mjs_magOpen'
      const o     = await charger(browser, c, 'mjs-mb-vitrine')
      try {
        await jusqua(o.page, `window.__entier >= 1`)
        const coeur = await o.page.evaluate(`typeof µ !== 'undefined' ? 'µ' : typeof mjs !== 'undefined' ? 'mjs' : ''`)
        if (!coeur || !ouvre) {
          console.log(`  ℹ️  cœur injoignable depuis la page (${nom}) : cas sauté`)
          this.skip()
          return
        }
        const avant = refus(o.avis).length
        // le fichier ouvert lève avant sa fin ; une tâche plus tard, un `µeffect` écrit ailleurs : refusé (aucune fonction de retrait rendue)
        const rendu = await o.page.evaluate(`new Promise((fin) => { try { ${coeur}.${ouvre}('mb-casse.module.civet.mjs'); throw new Error('casse') } catch (e) {} setTimeout(() => fin(typeof ${coeur}.effect(() => { window.__casse = (window.__casse || 0) + 1 })), 0) })`)
        assert.equal(rendu, 'undefined', 'reffet écrit ensuite : refusé, pas adopté par le magasin')
        await jusqua(o.page, `window.__entier >= 1`)
        assert.equal(await o.page.evaluate('window.__casse'), undefined, 'il ne tourne pas')
        if (mode !== 'bundle') assert.ok(refus(o.avis).length > avant, 'le refus dit où l\'écrire : ' + JSON.stringify(o.avis))
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.fermer()
      }
    })
  }
})
