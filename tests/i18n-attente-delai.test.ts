// Le délai de secours de l'attente des textes traduits (`wait`) : 3 s par défaut, réglable par `"i18n": { "timeout": … }` de
// mjs.config.json (une durée, comme `effects.guard.delay` : un nombre de millisecondes, ou "800ms", "1.5s"). Le build ne l'écrit
// au manifeste que s'il diffère du défaut. Et `"effects": { "skeleton": [...] }` ne porte plus « i18n » : les barres des textes
// traduits se règlent par `i18n.placeholder` et ce délai, elles ne dépendent plus d'`effects.skeleton`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'
import { projet } from './helpers/i18n-rendu-projet.js'

const attendre = (ms = 40) => new Promise((r) => setTimeout(r, ms))
const BARRE    = '\u2007'.repeat(12)

const page = (directive = '') => ["@i18n 'panier'", directive, '<script>', '  $n = 7', '</script>', '', '<p class="t">{µt(\'resume\')}</p>', '<p class="n">{$n}</p>', ''].join('\n')
const lireBrut = (el: any, c = 'p.t') => el._shadow.querySelector(c)?.textContent ?? null

function config(etiquette: string, corps: Record<string, unknown>): string {
  const root = mjsTmp('i18n-attente-delai-' + etiquette)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', ...corps }))
  return root
}

describe('délai de secours de l\'attente des textes — la clé i18n.timeout', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('mjs.config.json', function () {
    it('acceptée : un nombre de millisecondes (0 compris), "800ms", "1.5s" ; recopiée jusqu\'au bundler', () => {
      for (const valeur of [800, 0, 2500.5, '800ms', '1.5s', '3s', '0s']) {
        const trouve = findConfig(config('ok', { i18n: { default: 'fr', timeout: valeur } }))!
        assert.equal(resolveBundlerOpts(trouve.config, trouve.configDir).i18n?.timeout, valeur, String(valeur))
      }
    })

    it('refusée sinon, avec la clé nommée et un exemple (fr)', () => {
      for (const valeur of [false, true, -1, '', 'vite', '3', '1s5', '-2s', null, {}, [], 'NaN', Infinity]) {
        assert.throws(() => findConfig(config('faux', { i18n: { default: 'fr', timeout: valeur } })), /"i18n\.timeout" est une durée : un nombre de millisecondes \(800\), ou "800ms", "1\.5s" \(3 s par défaut\) — reçu/, JSON.stringify(valeur))
      }
    })

    it('refusée sinon (en)', () => {
      assert.throws(() => findConfig(config('faux-en', { lang: 'en', i18n: { default: 'fr', timeout: false } })), /"i18n\.timeout" is a duration: a number of milliseconds \(800\), or "800ms", "1\.5s" \(3 s by default\) — got false/)
    })

    it('refusée au-delà du plafond d\'une minuterie (2147483647 ms, environ 24,8 jours), avec un exemple (fr)', () => {
      for (const valeur of [2147483648, 3000000000, 1e12, '3000000000ms', '2147484s']) {
        assert.throws(() => findConfig(config('trop-long', { i18n: { default: 'fr', timeout: valeur } })), /"i18n\.timeout" ne peut pas dépasser 2147483647 ms \(environ 24,8 jours\).* par exemple 5000, "5s" ou "800ms" — reçu/, JSON.stringify(valeur))
      }
    })

    it('refusée au-delà du plafond d\'une minuterie (en)', () => {
      assert.throws(() => findConfig(config('trop-long-en', { lang: 'en', i18n: { default: 'fr', timeout: 3000000000 } })), /"i18n\.timeout" cannot exceed 2147483647 ms \(about 24\.8 days\).* for example 5000, "5s" or "800ms" — got 3000000000/)
    })

    it('acceptée au plafond lui-même', () => {
      for (const valeur of [2147483647, '2147483647ms']) {
        const trouve = findConfig(config('plafond', { i18n: { default: 'fr', timeout: valeur } }))!
        assert.equal(resolveBundlerOpts(trouve.config, trouve.configDir).i18n?.timeout, valeur, String(valeur))
      }
    })

    it('le plafond se juge arrondi à la milliseconde, comme la valeur que le manifeste porte : 2147483647.4 passe, 2147483647.5 est refusé', () => {
      for (const valeur of [2147483647.4, '2147483647.4ms']) {
        const trouve = findConfig(config('plafond-arrondi', { i18n: { default: 'fr', timeout: valeur } }))!
        assert.equal(resolveBundlerOpts(trouve.config, trouve.configDir).i18n?.timeout, valeur, String(valeur))
      }
      for (const valeur of [2147483647.5, '2147483647.5ms']) {
        assert.throws(() => findConfig(config('plafond-arrondi-refuse', { i18n: { default: 'fr', timeout: valeur } })), /"i18n\.timeout" ne peut pas dépasser 2147483647 ms/, JSON.stringify(valeur))
      }
      const racine = mjsTmp('i18n-attente-delai-arrondi-api')
      const opts   = (timeout: unknown) => ({ sourceDir: join(racine, 'src'), outputDir: join(racine, 'out'), manifestPath: join(racine, 'out', 'bundle.js'), i18n: { default: 'fr', timeout } }) as any
      for (const valeur of [2147483647.4, '2147483647.4ms']) new Bundler(opts(valeur))
      for (const valeur of [2147483647.5, '2147483647.5ms']) assert.throws(() => new Bundler(opts(valeur)), /"i18n\.timeout" ne peut pas dépasser 2147483647 ms/, JSON.stringify(valeur))
    })

    it('API : new Bundler({ i18n }) applique le même plafond (message identique), au plafond lui-même rien ne se passe', () => {
      const racine = mjsTmp('i18n-attente-delai-api')
      const opts   = (timeout: unknown) => ({ sourceDir: join(racine, 'src'), outputDir: join(racine, 'out'), manifestPath: join(racine, 'out', 'bundle.js'), i18n: { default: 'fr', timeout } }) as any
      for (const valeur of [2147483648, 3000000000, 1e12, '3000000000ms', '2147484s']) {
        assert.throws(() => new Bundler(opts(valeur)), /"i18n\.timeout" ne peut pas dépasser 2147483647 ms \(environ 24,8 jours\).* par exemple 5000, "5s" ou "800ms" — reçu/, JSON.stringify(valeur))
      }
      for (const valeur of [2147483647, '2147483647ms', 3000, '800ms']) new Bundler(opts(valeur))
      new Bundler({ sourceDir: join(racine, 'src'), outputDir: join(racine, 'out'), manifestPath: join(racine, 'out', 'bundle.js'), i18n: { default: 'fr' } } as any)
    })

    it('la liste des clés connues de i18n la cite', () => {
      assert.throws(() => findConfig(config('inconnue', { i18n: { default: 'fr', timeoute: 800 } })), /timeout/)
    })

    it('"i18n" dans effects.skeleton : une erreur dédiée qui renvoie à i18n.placeholder et au délai (fr)', () => {
      for (const liste of [['await', 'i18n'], ['i18n'], ['await', 'i18n', 'components']]) {
        assert.throws(() => findConfig(config('skel-i18n', { effects: { skeleton: liste } })), (e: Error) => {
          assert.match(e.message, /"effects\.skeleton" ne porte plus « i18n »/)
          assert.match(e.message, /i18n\.placeholder/)
          assert.match(e.message, /\*skeleton/)
          assert.match(e.message, /i18n\.timeout/)
          assert.match(e.message, /retirez "i18n" de la liste/)
          return true
        }, JSON.stringify(liste))
      }
    })

    it('"i18n" dans effects.skeleton (en)', () => {
      assert.throws(() => findConfig(config('skel-i18n-en', { lang: 'en', effects: { skeleton: ['await', 'i18n'] } })), /"effects\.skeleton" no longer takes "i18n".*i18n\.placeholder.*i18n\.timeout.*remove "i18n" from the list/)
    })

    it('effects.skeleton : seuls « await » et « components » sont permis', () => {
      const trouve = findConfig(config('skel-ok', { effects: { skeleton: ['await', 'components'] } }))!
      assert.deepEqual(resolveBundlerOpts(trouve.config, trouve.configDir).effects, { skeleton: ['await', 'components'] })
      assert.throws(() => findConfig(config('skel-faux', { effects: { skeleton: ['images'] } })), /permis : "await", "components"\./)
    })
  })

  describe('manifeste', function () {
    async function manifeste(i18n: Record<string, unknown>): Promise<string> {
      const root   = mjsTmp('i18n-attente-delai-bundle')
      const srcDir = join(root, 'src')
      mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
      writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
      writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'titre: Bonjour\n')
      writeFileSync(join(srcDir, 'vue.mjs'), "@i18n 'accueil'\n<h1>{µt('titre')}</h1>\n")
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), i18n: { default: 'fr', ...i18n } } as any)
      const stats = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      await bundler.close()
      return readFileSync(join(root, 'bundle.js'), 'utf-8')
    }

    it('réglé : la valeur en millisecondes est émise', async () => {
      assert.match(await manifeste({ timeout: 800 }), /"timeout":800[,}]/)
      assert.match(await manifeste({ timeout: '800ms' }), /"timeout":800[,}]/)
      assert.match(await manifeste({ timeout: '1.5s' }), /"timeout":1500[,}]/)
      assert.match(await manifeste({ timeout: 0 }), /"timeout":0[,}]/)
    })

    it('non réglé, ou réglé au défaut : pas un octet de plus', async () => {
      const base = await manifeste({})
      assert.equal(base.includes('"timeout"'), false)
      assert.equal(await manifeste({ timeout: 3000 }), base)
      assert.equal(await manifeste({ timeout: '3s' }), base)
      assert.equal(await manifeste({ timeout: '3000ms' }), base)
    })
  })

  describe('exécution (happy-dom, build de production)', function () {
    // une horloge simulée : les minuteries de `ms` sont relevées, jamais armées pour de bon
    function horloge(p: any, ms: number) {
      const secours: Array<{ fn: () => void, defaite: boolean }> = []
      const arme   = p.window.setTimeout.bind(p.window)
      const defait = p.window.clearTimeout.bind(p.window)
      p.window.setTimeout = (fn: any, delai?: number, ...args: any[]) => {
        if (delai !== ms) return arme(fn, delai, ...args)
        secours.push({ fn, defaite: false })
        return -secours.length
      }
      p.window.clearTimeout = (id: any) => {
        if (typeof id === 'number' && id < 0) secours[-id - 1].defaite = true
        else defait(id)
      }
      return secours
    }
    function silence(p: any): () => void {
      const origine = p.window.fetch
      let repondre: () => void = () => {}
      const retenue = new Promise<void>((r) => { repondre = r })
      p.window.fetch = (url: string) => retenue.then(() => origine(url))
      return repondre
    }

    it('timeout réglé : la minuterie de secours dure ce temps, pas 3 s ; le module paraît avec des barres', async () => {
      const p = await projet({ prod: true, i18n: { timeout: '400ms' }, sources: { vue: page() } })
      const quatre = horloge(p, 400)
      const trois  = horloge(p, 3000)
      const repondre = silence(p)
      const el = p.monte('vue')
      await attendre()
      assert.equal(trois.length, 0, 'aucune minuterie de 3 s')
      assert.equal(quatre.length, 1, 'une minuterie de 400 ms')
      assert.equal(el.hasAttribute('mjs-loading'), true)
      quatre[0].fn()
      await attendre(60)
      assert.equal(el.hasAttribute('mjs-loading'), false)
      assert.equal(lireBrut(el), BARRE)
      repondre()
      await attendre(150)
      assert.equal(lireBrut(el), 'Résumé du panier')
    })

    it('sans réglage : 3 s, comme avant', async () => {
      const p = await projet({ prod: true, sources: { vue: page() } })
      const trois = horloge(p, 3000)
      silence(p)
      p.monte('vue')
      await attendre()
      assert.equal(trois.length, 1)
    })

    it('développement : l\'avertissement montre la vraie durée', async () => {
      const p = await projet({ prod: false, i18n: { timeout: 1200 }, sources: { vue: page() } })
      const secours = horloge(p, 1200)
      silence(p)
      const avertis: string[] = []
      p.window.µ.warn = (...a: unknown[]) => { avertis.push(a.join(' ')) }
      p.monte('vue')
      await attendre()
      secours[0].fn()
      await attendre(60)
      assert.equal(avertis.filter(a => /1200 ms/.test(a)).length, 1, JSON.stringify(avertis))
    })

    it('les barres du secours paraissent même avec "effects": { "skeleton": [] }', async () => {
      const p = await projet({ prod: true, sources: { vue: page() } })
      p.window.µ._fxConf = { skeleton: [] }
      const secours = horloge(p, 3000)
      silence(p)
      const el = p.monte('vue')
      await attendre()
      secours[0].fn()
      await attendre(60)
      assert.equal(lireBrut(el), BARRE)
    })

    it('*skeleton : les barres d\'un texte en route paraissent même avec "effects": { "skeleton": [] }', async () => {
      const p = await projet({ prod: true, i18n: { placeholder: '*skeleton' }, sources: { vue: page() } })
      p.window.µ._fxConf = { skeleton: [] }
      silence(p)
      const el = p.monte('vue')
      await attendre(80)
      assert.equal(lireBrut(el), BARRE)
    })
  })
})
