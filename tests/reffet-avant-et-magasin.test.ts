// Les reffets en deux temps, et hors des composants.
//
// `µeffect.before` : un reffet qui voit l'écran tel qu'il était AVANT la mise à jour que causent ses dépendances. Une discussion qui
// descend toute seule vers le dernier message, seulement si l'on était déjà en bas, s'écrit en trois lignes : le reffet d'avant
// note la position avant l'ajout du message, le `µeffect` défile après. Il passe juste avant les blocs et les liaisons de son
// composant, dans la même voie qu'eux : sur-le-champ quand l'écriture met l'écran à jour sur-le-champ (une variable lue par des
// liaisons seulement), en microtâche sinon. Le DOM relu juste après une écriture voit toujours la valeur ; une écriture faite par
// le reffet d'avant entre dans le même passage (blocs, liaisons, `µeffect` qui la lisent : rien de perdu, et l'écriture suivante du
// gestionnaire repasse sur-le-champ) et ne le relance pas (pas de boucle) ; ordre d'un passage : reffets d'avant, blocs, liaisons,
// `µeffect`, `µmount`.
//
// `µeffect` au premier niveau du fichier d'un magasin (`export µ$$x = …`, `new µStore(…)`) : il tourne sans aucun composant, une
// fois à la création puis quand ce qu'il lit change, et survit au départ de tous les composants qui lisent le magasin — le panier
// sauvegardé dans le navigateur s'écrit dans le fichier du magasin. Le fichier réexécuté nettoie d'abord les reffets de sa vie
// d'avant. Ailleurs (fonction appelée plus tard), il n'a pas de propriétaire ; au premier niveau d'un module ordinaire, le module en est le propriétaire : refusé, avec un message qui dit
// où l'écrire.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { annotateEffectDeps } from '../src/generator/effect-deps.js'
import { construire, charger } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

// la passe en microtâche : un `µeffect` écrit `$items`, un reffet d'avant qui lit `$items` écrit `$vus` ; témoin : sans reffet d'avant
const perte = (nom: string, pre: string[]) => [
  '<script>',
  '  $items = [1, 2]',
  '  $go = 0',
  '  $vus = 0',
  '  window.__perte ??= {}',
  `  window.__perte.${nom} = []`,
  ...pre,
  '',
  '  µeffect ->',
  `    window.__perte.${nom}.push "x #{$items.length}"`,
  '',
  '  µeffect ->',
  `    window.__perte.${nom}.push "v #{$vus}"`,
  '',
  '  µeffect ->',
  '    if $go is 1',
  '      $go = 2',
  '      $items = [...$items, 5]',
  '',
  '  @go1 = -> $go = 1',
  '</script>',
  '<p class="nb">{$items.length}</p><p class="vus">{$vus}</p>{for i in $items}<i class="it">{i}</i>{end}',
].join('\n')

// trois écritures de suite dans un gestionnaire, le DOM relu après chacune ; témoin : sans reffet d'avant
const relu = (nom: string, pre: string[]) => [
  '<script>',
  '  $n = 0',
  '  $vus = 0',
  '  window.__relu ??= {}',
  `  window.__relu.${nom} = { lus: [], pre: [], apres: [] }`,
  ...pre,
  '',
  '  µeffect ->',
  `    window.__relu.${nom}.apres.push "#{$n} #{$vus}"`,
  '',
  '  @trois = ->',
  '    $n = 1',
  `    window.__relu.${nom}.lus.push "#{p.textContent}/#{v.textContent}"`,
  '    $n = 2',
  `    window.__relu.${nom}.lus.push "#{p.textContent}/#{v.textContent}"`,
  '    $n = 3',
  `    window.__relu.${nom}.lus.push "#{p.textContent}/#{v.textContent}"`,
  '</script>',
  '<p class="n" :this=!{p}>{$n}</p><p class="vus" :this=!{v}>{$vus}</p>',
].join('\n')

const SOURCES: Record<string, string> = {
  'rv-perte-ecrit.mjs': perte('ecrit', ['', '  µeffect.before ->', '    $items.length', '    $vus++']),
  'rv-perte-sans.mjs': perte('sans', []),
  'rv-relu-ecrit.mjs': relu('ecrit', ['', '  µeffect.before ->', '    window.__relu.ecrit.pre.push "#{$n} #{if p then p.textContent else \'-\'}"', '    $vus++']),
  'rv-relu-sans.mjs': relu('sans', []),
  // un reffet d'avant qui écrit une clé du magasin lue par un `µeffect`, et le reffet d'avant d'un magasin
  'rv-magasin.mjs': [
    '@import compteur \'ab-compteur.module.civet.mjs\'',
    '<script>',
    '  $items = [1]',
    '  $go = 0',
    '  window.__mag = []',
    '',
    '  µeffect.before ->',
    '    $$rvTours = $items.length * 10',
    '',
    '  µeffect ->',
    '    window.__mag.push "x #{$items.length}"',
    '',
    '  µeffect ->',
    '    window.__mag.push "t #{$$rvTours}"',
    '',
    '  µeffect ->',
    '    if $go is 1',
    '      $go = 2',
    '      $items = [...$items, 5]',
    '',
    '  @go1 = -> $go = 1',
    '</script>',
    '<p class="t">{$$rvTours} {compteur.data.n}</p>',
  ].join('\n'),
  'ab-compteur.module.civet.mjs': [
    'export compteur = new µStore(n: 0, vus: 0)',
    '',
    'µeffect.before ->',
    '  compteur.data.vus = compteur.data.n * 2',
    '',
    'µeffect ->',
    '  window.__rvc = "#{compteur.data.n} #{compteur.data.vus}"',
    '',
    'window.__rvcPlus = -> compteur.data.n++',
  ].join('\n'),
  // la discussion : trente messages de 20 px dans une fenêtre de 100 px
  'rv-fil.mjs': [
    '<script>',
    '  $messages = [1..30].map (i) -> { id: i, t: "m#{i}" }',
    '  bas .= true',
    '',
    '  µeffect.before ->',
    '    $messages.length',
    '    bas = not fil or fil.scrollTop + fil.clientHeight >= fil.scrollHeight - 4',
    '',
    '  µeffect ->',
    '    $messages.length',
    '    fil.scrollTop = fil.scrollHeight if fil and bas',
    '',
    '  @ajouter = -> $messages.push { id: $messages.length + 1, t: "m#{$messages.length + 1}" }',
    '</script>',
    '<div class="fil" :this=!{fil}>{for m in $messages by id}<p class="m">{m.t}</p>{end}</div>',
    '<button class="plus" @click={@ajouter()}>+</button>',
    '<style>',
    '  .fil',
    '    height: 100px',
    '    overflow: auto',
    '  .m',
    '    height: 20px',
    '    margin: 0',
    '</style>',
  ].join('\n'),
  // l'ordre d'un passage, l'écran vu par chaque temps, et un reffet d'avant qui écrit ce qu'il lit
  'rv-ordre.mjs': [
    '<script>',
    '  $n = 0',
    '  $vus = 0',
    '  window.__ordre = []',
    '',
    '  µeffect.before ->',
    '    window.__ordre.push "pre #{$n} #{if p then p.textContent else \'-\'}"',
    '    $vus = $vus + 1',
    '',
    '  µeffect ->',
    '    window.__ordre.push "apres #{$n} #{p.textContent}"',
    '',
    '  µmount ->',
    '    window.__ordre.push \'mount\'',
    '',
    '  @plus = ->',
    '    $n++',
    '    window.__read = p.textContent',
    '</script>',
    '<p class="n" :this=!{p}>{$n}</p>',
    '<p class="vus">{$vus}</p>',
    '<button class="b" @click={@plus()}>+</button>',
  ].join('\n'),
  // le panier : un magasin léger et sa sauvegarde, au même endroit
  'ab-panier.module.civet.mjs': [
    'export µ$$panier = { articles: [] }',
    '',
    'µeffect ->',
    '  localStorage.setItem \'rv-panier\', JSON.stringify µ$$panier.articles',
    '  -> window.__nettoyages = (window.__nettoyages or 0) + 1',
    '',
    'window.__rvAjouter = (a) -> µ$$panier.articles.push a',
    'window.__rvPlusTard = -> µeffect -> window.__plusTard = true',
  ].join('\n'),
  // un magasin `µStore`
  'ab-stock.module.civet.mjs': [
    'export stock = new µStore(pieces: 3)',
    '',
    'µeffect ->',
    '  localStorage.setItem \'rv-stock\', String stock.data.pieces',
    '',
    'window.__rvRetirer = -> stock.data.pieces--',
  ].join('\n'),
  // un module ordinaire : aucun magasin, le module est le propriétaire de son reffet
  'ab-outils.module.civet.mjs': [
    'µeffect -> window.__outils = true',
    '',
    'export double = (x) -> x * 2',
  ].join('\n'),
  'rv-boutique.mjs': [
    '@import µ$$panier \'ab-panier.module.civet.mjs\'',
    '@import stock \'ab-stock.module.civet.mjs\'',
    '@import double \'ab-outils.module.civet.mjs\'',
    '<p class="nb">{µ$$panier.articles.length} {stock.data.pieces} {double(2)}</p>',
    '<button class="a" @click={µ$$panier.articles.push \'x\'}>+</button>',
  ].join('\n'),
}

const BALISES = ['mjs-rv-fil', 'mjs-rv-ordre', 'mjs-rv-boutique', 'mjs-rv-perte-ecrit', 'mjs-rv-perte-sans', 'mjs-rv-relu-ecrit', 'mjs-rv-relu-sans', 'mjs-rv-magasin']
const ombre   = (b: string) => `document.querySelector('${b}')._shadow`
const vers    = (page: any, js: string) => page.evaluate(`(() => { ${js}; return null })()`)
const jusqua  = (page: any, cond: string) => page.waitForFunction(cond, null, { timeout: 4000 }).catch(() => {})
// deux composants sur la page (la balise donnée à `charger` est posée telle quelle, ouverte et fermée)
const deux    = (a: string, b: string) => `${a}></${a}><${b}></${b}><i hidden data-x="`

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

describe('µeffect.before et les reffets d\'un magasin — compilation', function () {
  this.timeout(120000)

  it('µeffect.before reçoit ses dépendances comme µeffect', function () {
    const js = annotateEffectDeps('µ.effect.before(function() { $.messages.length; return x() })')
    assert.match(js, /µ\.effect\.before\(function\(\) \{ \$\.messages\.length; return x\(\) \}, \["messages"\]\)/)
  })

  it('le fichier d\'un magasin est encadré, un module ordinaire aussi ; la production sans ces formes n\'en porte rien', async function () {
    const prod = await cible('bundle')
    const bundle = readFileSync(join(prod.racine, 'out', 'bundle.js'), 'utf-8')
    assert.ok(/effect\.before\(/.test(bundle), 'µeffect.before compilé')
    const dev = await cible('dev-parents-avant')
    const out = join(dev.racine, 'out')
    const fichier = (debut: string) => readFileSync(join(out, readdirSync(out).find((f) => f.startsWith(debut) && f.endsWith('.js'))!), 'utf-8')
    assert.match(fichier('ab-panier'), /^µ\._mjs_magOpen\("ab-panier\.module\.civet\.mjs"\);/m)
    assert.match(fichier('ab-panier'), /µ\._mjs_magClose\(\);\s*$/)
    assert.match(fichier('ab-stock'), /^µ\._mjs_magOpen\(/m)
    assert.match(fichier('ab-outils'), /^µ\._mjs_magOpen\("ab-outils\.module\.civet\.mjs"\);/m)
  })
})

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`µeffect.before et les reffets d'un magasin (${moteur} réel)`, function () {
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

    it(`la discussion descend seule, seulement si l'on était en bas (${nom})`, async function () {
      if (!browser) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-rv-fil')
      try {
        const fil = `${ombre('mjs-rv-fil')}.querySelector('.fil')`
        const bas = `(() => { const f = ${fil}; return f && f.scrollHeight - f.clientHeight })()`
        await jusqua(o.page, `${fil} && ${fil}.scrollTop > 0`)
        assert.equal(await o.page.evaluate(`${fil}.scrollTop`), await o.page.evaluate(bas), 'au montage : en bas')
        await vers(o.page, `${ombre('mjs-rv-fil')}.querySelector('.plus').click()`)
        await jusqua(o.page, `${ombre('mjs-rv-fil')}.querySelectorAll('.m').length === 31 && ${fil}.scrollTop === ${bas}`)
        assert.equal(await o.page.evaluate(`${ombre('mjs-rv-fil')}.querySelectorAll('.m').length`), 31)
        assert.equal(await o.page.evaluate(`${fil}.scrollTop`), await o.page.evaluate(bas), 'en bas avant le message : suit le nouveau')
        await vers(o.page, `${fil}.scrollTop = 0`)
        await o.page.waitForTimeout(150)
        await vers(o.page, `${ombre('mjs-rv-fil')}.querySelector('.plus').click()`)
        await jusqua(o.page, `${ombre('mjs-rv-fil')}.querySelectorAll('.m').length === 32`)
        await o.page.waitForTimeout(150)
        assert.equal(await o.page.evaluate(`${fil}.scrollTop`), 0, 'remonté avant le message : la position ne bouge pas')
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.fermer()
      }
    })

    it(`ordre d'un passage, écran d'avant, DOM relu à jour, pas de boucle (${nom})`, async function () {
      if (!browser) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-rv-ordre')
      try {
        await jusqua(o.page, `window.__ordre && window.__ordre.includes('mount')`)
        const montage = await o.page.evaluate('window.__ordre.slice()')
        assert.deepEqual(montage.map((x: string) => x.split(' ').slice(0, 2).join(' ')), ['pre 0', 'apres 0', 'mount'], JSON.stringify(montage))
        assert.equal(montage[1], 'apres 0 0')
        await vers(o.page, `window.__ordre = []; ${ombre('mjs-rv-ordre')}.querySelector('.b').click()`)
        await jusqua(o.page, `window.__ordre.length >= 2 && ${ombre('mjs-rv-ordre')}.querySelector('.vus').textContent === '2'`)
        await o.page.waitForTimeout(100)
        assert.deepEqual(await o.page.evaluate('window.__ordre.slice()'), ['pre 1 0', 'apres 1 1'], 'le reffet d\'avant voit 0, celui d\'après 1')
        assert.equal(await o.page.evaluate('window.__read'), '1', 'le DOM relu juste après l\'écriture voit la valeur')
        assert.equal(await o.page.evaluate(`${ombre('mjs-rv-ordre')}.querySelector('.vus').textContent`), '2', 'un passage au montage, un au clic : son écriture ne le relance pas')
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.fermer()
      }
    })

    it(`un reffet d'avant qui écrit pendant la passe en microtâche : aucun µeffect perdu, comme le témoin (${nom})`, async function () {
      if (!browser) { this.skip(); return }
      const o = await charger(browser, await cible(mode), deux('mjs-rv-perte-ecrit', 'mjs-rv-perte-sans'))
      try {
        await jusqua(o.page, `window.__perte && window.__perte.ecrit.length >= 2 && window.__perte.sans.length >= 2`)
        await o.page.waitForTimeout(100)
        assert.deepEqual(await o.page.evaluate('JSON.parse(JSON.stringify(window.__perte))'), { ecrit: ['x 2', 'v 1'], sans: ['x 2', 'v 0'] }, 'montage')
        await vers(o.page, `window.__perte.ecrit = []; window.__perte.sans = []; document.querySelector('mjs-rv-perte-ecrit').go1(); document.querySelector('mjs-rv-perte-sans').go1()`)
        await jusqua(o.page, `window.__perte.ecrit.length >= 2 && window.__perte.sans.length >= 1`)
        await o.page.waitForTimeout(150)
        const log = await o.page.evaluate('JSON.parse(JSON.stringify(window.__perte))')
        assert.deepEqual(log.sans, ['x 3'], 'témoin sans reffet d\'avant')
        assert.deepEqual(log.ecrit, ['x 3', 'v 2'], 'le µeffect de la passe tourne, celui qui lit l\'écriture du reffet d\'avant aussi, une fois chacun')
        const ecran = (b: string) => o.page.evaluate(`[${ombre(b)}.querySelector('.nb').textContent, ${ombre(b)}.querySelectorAll('.it').length, ${ombre(b)}.querySelector('.vus').textContent].join(' ')`)
        assert.equal(await ecran('mjs-rv-perte-ecrit'), '3 3 2', 'écran : la liste et l\'écriture du reffet d\'avant')
        assert.equal(await ecran('mjs-rv-perte-sans'), '3 3 0')
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.fermer()
      }
    })

    it(`trois écritures dans un gestionnaire, un reffet d'avant qui écrit : trois passages, le DOM relu voit chaque valeur (${nom})`, async function () {
      if (!browser) { this.skip(); return }
      const o = await charger(browser, await cible(mode), deux('mjs-rv-relu-ecrit', 'mjs-rv-relu-sans'))
      try {
        await jusqua(o.page, `window.__relu && window.__relu.ecrit.apres.length >= 1 && window.__relu.sans.apres.length >= 1`)
        await o.page.waitForTimeout(100)
        await vers(o.page, `for (const n of ['ecrit', 'sans']) { window.__relu[n] = { lus: [], pre: [], apres: [] }; document.querySelector('mjs-rv-relu-' + n).trois() }`)
        await jusqua(o.page, `window.__relu.ecrit.apres.length >= 1 && window.__relu.sans.apres.length >= 1`)
        await o.page.waitForTimeout(150)
        const log = await o.page.evaluate('JSON.parse(JSON.stringify(window.__relu))')
        assert.deepEqual(log.sans, { lus: ['1/0', '2/0', '3/0'], pre: [], apres: ['3 0'] }, 'témoin sans reffet d\'avant')
        assert.deepEqual(log.ecrit.lus.map((x: string) => x.split('/')[0]), ['1', '2', '3'], 'le DOM relu juste après chaque écriture voit la valeur, comme le témoin')
        assert.deepEqual(log.ecrit.pre, ['1 0', '2 1', '3 2'], 'trois écritures, trois passages, chacun avant l\'écriture du DOM')
        assert.deepEqual(log.ecrit.lus, ['1/2', '2/3', '3/4'], 'l\'écriture du reffet d\'avant est à l\'écran dans le même passage')
        assert.deepEqual(log.ecrit.apres, ['3 4'], 'un passage des µeffect, sur l\'état final')
        assert.equal(await o.page.evaluate(`${ombre('mjs-rv-relu-ecrit')}.textContent`), '34')
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.fermer()
      }
    })

    it(`un reffet d'avant qui écrit une clé du magasin lue par un µeffect ; le reffet d'avant d'un magasin (${nom})`, async function () {
      if (!browser) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-rv-magasin')
      try {
        await jusqua(o.page, `window.__mag && window.__mag.length >= 2 && window.__rvc === '0 0'`)
        await o.page.waitForTimeout(100)
        assert.deepEqual(await o.page.evaluate('window.__mag.slice()'), ['x 1', 't 10'], 'montage')
        await vers(o.page, `window.__mag = []; document.querySelector('mjs-rv-magasin').go1()`)
        await jusqua(o.page, `window.__mag.length >= 2`)
        await o.page.waitForTimeout(150)
        assert.deepEqual(await o.page.evaluate('window.__mag.slice()'), ['x 2', 't 20'], 'aucun µeffect perdu ; la clé écrite par le reffet d\'avant relue')
        assert.equal(await o.page.evaluate(`${ombre('mjs-rv-magasin')}.querySelector('.t').textContent`), '20 0')
        await vers(o.page, `window.__rvcPlus()`)
        await jusqua(o.page, `window.__rvc === '1 2'`)
        assert.equal(await o.page.evaluate('window.__rvc'), '1 2', 'magasin : l\'écriture de son reffet d\'avant lue par son µeffect')
        await jusqua(o.page, `${ombre('mjs-rv-magasin')}.querySelector('.t').textContent === '20 1'`)
        assert.equal(await o.page.evaluate(`${ombre('mjs-rv-magasin')}.querySelector('.t').textContent`), '20 1')
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.fermer()
      }
    })

    it(`le panier se sauvegarde depuis le fichier du magasin, sans composant (${nom})`, async function () {
      if (!browser) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-rv-boutique')
      try {
        const lire = (k: string) => o.page.evaluate(`localStorage.getItem('${k}')`)
        await jusqua(o.page, `localStorage.getItem('rv-panier') !== null && localStorage.getItem('rv-stock') !== null`)
        assert.equal(await lire('rv-panier'), '[]', 'une fois à la création')
        assert.equal(await lire('rv-stock'), '3', 'µStore : une fois à la création')
        await vers(o.page, `${ombre('mjs-rv-boutique')}.querySelector('.a').click()`)
        await jusqua(o.page, `localStorage.getItem('rv-panier') === '["x"]'`)
        assert.equal(await lire('rv-panier'), '["x"]', 'écriture d\'un composant')
        await vers(o.page, `document.querySelector('mjs-rv-boutique').remove()`)
        await o.page.waitForTimeout(50)
        await vers(o.page, `window.__rvAjouter('y'); window.__rvRetirer()`)
        await jusqua(o.page, `localStorage.getItem('rv-panier') === '["x","y"]' && localStorage.getItem('rv-stock') === '2'`)
        assert.equal(await lire('rv-panier'), '["x","y"]', 'plus aucun composant ne lit le magasin : la sauvegarde continue')
        assert.equal(await lire('rv-stock'), '2', 'µStore : idem')
        assert.equal(await o.page.evaluate('window.__nettoyages'), 2, 'nettoyage avant chaque nouveau passage')
        await vers(o.page, `window.__rvPlusTard()`)
        await o.page.waitForTimeout(100)
        assert.equal(await o.page.evaluate('window.__plusTard'), undefined, 'fonction appelée plus tard : refusé')
        assert.equal(await o.page.evaluate('window.__outils'), true, 'module ordinaire : son reffet lui appartient et tourne')
        if (mode !== 'bundle') {
          assert.ok(o.avis.some((a) => a.includes('fichier d\'un magasin')), 'le refus dit où l\'écrire : ' + JSON.stringify(o.avis))
          // le fichier réexécuté : les reffets de sa vie d'avant nettoyés, ils ne sauvegardent plus
          await vers(o.page, `const id = [...µ._mjs_storeOwners.keys()].find((k) => k.endsWith('ab-panier.module.civet.mjs')); µ._mjs_magOpen(id); µ._mjs_magClose()`)
          assert.equal(await o.page.evaluate('window.__nettoyages'), 3, 'nettoyé quand son fichier repart')
          await vers(o.page, `window.__rvAjouter('z')`)
          await o.page.waitForTimeout(100)
          assert.equal(await lire('rv-panier'), '["x","y"]', 'le reffet nettoyé ne repart plus')
        }
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.fermer()
      }
    })
  }
})
