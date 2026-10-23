// *guard d'office : un champ lié à une variable typée (`<input value=!{$age}>`, `$age int 18..120`
// dans le <vars>) se garde de lui-même, comme s'il portait *guard — une frappe hors de la règle ne
// part pas dans la variable, la sortie du champ ramène la valeur, le champ tremble et une bulle dit
// ce qui est permis. Un store typé dans un autre composant aussi. `"effects": { "guard": false }` de
// mjs.config.json : gardé sans spectacle (ni secousse ni bulle — la frappe n'est jamais réécrite, la
// valeur ramenée à la sortie) ; un *guard écrit garde le sien. `"effects": { "guard": { "delay": "2s" } }` :
// la pause après laquelle un champ gardé prévient, pour tous.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { stripEsm } from '../src/server/renderToString.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { mjsTmp } from './helpers/tmp.js'

const compiler = async (html: string, opts: Record<string, unknown> = {}) => (await transpile(html, { moduleName: 'fx-essai', ...opts })).output
const gardes   = (js: string) => [...js.matchAll(/µ\._mjs_fx\(this, _mjs_fxn, "guard", (\{[^;]*?\})\);/g)].map(m => JSON.parse(m[1]))

const AGE = '<vars>\n  $age  int 18..120\n</vars>\n<script>\n$age = 30\n</script>\n'

describe('*guard d\'office — à la compilation', () => {
  it('un champ lié à une variable typée reçoit *guard, avec son effet de refus et sa variable', async () => {
    assert.deepEqual(gardes(await compiler(AGE + '<input aria-label="âge" value=!{$age}>')), [{ fx: { fx: 'shake', s: {} }, _bind: '$age' }])
  })

  it('textarea et select aussi ; une variable sans règle, non', async () => {
    const src = '<vars>\n  $bio  string 0..200\n  $choix  \'a\' | \'b\'\n</vars>\n<script>\n$bio = \'\'\n$choix = \'a\'\n$nom = \'\'\n</script>\n<textarea aria-label="bio" value=!{$bio}></textarea>\n<select aria-label="choix" value=!{$choix}><option>a</option><option>b</option></select>\n<input aria-label="nom" value=!{$nom}>'
    assert.deepEqual(gardes(await compiler(src)).map(g => g._bind), ['$bio', '$choix'])
  })

  it('un *guard écrit garde ses réglages, sans second *guard', async () => {
    assert.deepEqual(gardes(await compiler(AGE + '<input aria-label="âge" value=!{$age} *guard(text: \'De 18 à 120 ans\')>')), [{ text: 'De 18 à 120 ans', fx: { fx: 'shake', s: {} }, _bind: '$age' }])
  })

  it('une liaison vers un composant n\'est pas un champ : rien d\'office', async () => {
    assert.deepEqual(gardes(await compiler(AGE + '<@reglette value=!{$age}></@reglette>')), [])
  })

  it('un store typé dans le composant, ou ailleurs dans le projet (liste passée par le bundler)', async () => {
    assert.deepEqual(gardes(await compiler('<vars>\n  $$volume  int 0..100\n</vars>\n<input aria-label="v" value=!{$$volume}>')).map(g => g._bind), ['$$volume'])
    assert.deepEqual(gardes(await compiler('<input aria-label="v" value=!{$$volume}>', { typedStores: ['volume'] })).map(g => g._bind), ['$$volume'])
    assert.deepEqual(gardes(await compiler('<input aria-label="v" value=!{$$volume}>')), [])
  })

  it('guard: false — gardé sans spectacle (silent, sans effet de refus) ; un *guard écrit garde le sien', async () => {
    assert.deepEqual(gardes(await compiler(AGE + '<input aria-label="âge" value=!{$age}>', { guard: false })), [{ silent: true, fx: 'none', _bind: '$age' }])
    assert.deepEqual(gardes(await compiler(AGE + '<input aria-label="âge" value=!{$age} *guard>', { guard: false })), [{ fx: { fx: 'shake', s: {} }, _bind: '$age' }])
  })

  it('guard: { delay } — gardé comme d\'habitude (la pause se lit au runtime)', async () => {
    assert.deepEqual(gardes(await compiler(AGE + '<input aria-label="âge" value=!{$age}>', { guard: { delay: '2s' } })), [{ fx: { fx: 'shake', s: {} }, _bind: '$age' }])
  })
})

describe('*guard d\'office — dans un projet', function () {
  this.timeout(60000)

  const COMPOSANTS: Record<string, string> = {
    'fx-reglages': '<vars>\n  $$volume  int 0..100\n</vars>\n<script>\n$$volume = 50\n</script>\n<b class="vol">{$$volume}</b>',
    'fx-age':      AGE + '<input class="a" aria-label="âge" value=!{$age}>\n<b class="va">{$age}</b>',
    'fx-volume':   '<input class="v" aria-label="volume" type="number" value=!{$$volume}>\n<@fx-reglages></@fx-reglages>',
  }

  async function construire(etiquette: string, opts: Record<string, unknown> = {}) {
    const root   = mjsTmp('guard-office-' + etiquette)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire  = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    return { root, files, lire, code: [...files].sort((a, b) => rang(a) - rang(b)).map(lire).join('\n') }
  }

  after(async () => { await terminateSharedWorkerPool() })

  it('le store typé dans un autre composant : son champ est gardé', async () => {
    const { files, lire } = await construire('store')
    const volume = files.find((f) => f.startsWith('fx-volume'))!
    assert.match(lire(volume), /µ\._mjs_fx\(this, _mjs_fxn, "guard", \{"fx":\{"fx":"shake","s":\{\}\},"_bind":"\$\$volume"\}\)/)
  })

  it('le champ gardé d\'office se comporte comme *guard : la frappe retenue, la sortie ramenée, la bulle', async () => {
    const { root, code } = await construire('vivant')
    const libelles = /µ\._runtimeLabels = (\{[\s\S]*?\});\n/.exec(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;${libelles ? ` µ._runtimeLabels = ${libelles[1]};` : ''}`)
    window.document.documentElement.lang = 'fr'
    const attendre = async (cond: () => boolean) => { const fin = Date.now() + 3000; while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10)) }
    const taper    = async (i: any, v: string, fin = false) => {
      i.value = v
      i.dispatchEvent(new window.Event('input', { bubbles: true }))
      if (fin) i.dispatchEvent(new window.Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 30))
    }
    window.document.body.innerHTML = '<mjs-fx-age></mjs-fx-age><mjs-fx-volume></mjs-fx-volume>'
    const age = window.document.querySelector('mjs-fx-age')
    const vol = window.document.querySelector('mjs-fx-volume')
    await attendre(() => !!age._shadow?.querySelector('.a') && !!vol._shadow?.querySelector('mjs-fx-reglages')?._shadow?.querySelector('.vol'))
    await new Promise((r) => setTimeout(r, 30))
    const a = age._shadow.querySelector('.a')
    await taper(a, '1')
    assert.equal(a.value, '1', 'le champ n\'est pas réécrit « 18 » en pleine frappe')
    assert.equal(age._shadow.querySelector('.va').textContent, '30')
    assertAbsent(age._shadow.querySelector('[mjs-fx-guard-tip]'), 'pas de bulle pendant la frappe')
    await taper(a, '300', true)
    assert.equal(a.value, '120', 'ramenée à la borne à la sortie du champ')
    assert.equal(age._shadow.querySelector('.va').textContent, '120')
    assert.equal(age._shadow.querySelector('[mjs-fx-guard-tip]')?.textContent, 'de 18 à 120')
    const v = vol._shadow.querySelector('.v')
    await taper(v, '250', true)
    assert.equal(v.value, '100', 'le store ramené à sa borne, règle posée par un autre composant')
    assert.equal(vol._shadow.querySelector('mjs-fx-reglages')._shadow.querySelector('.vol').textContent, '100')
    window.close()
  })

  const monterVivant = async (root: string, code: string, tags: string[]) => {
    const libelles = /µ\._runtimeLabels = (\{[\s\S]*?\});\n/.exec(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    const conf     = /µ\._fxConf = (\{[^;]*\});/.exec(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;${libelles ? ` µ._runtimeLabels = ${libelles[1]};` : ''}${conf ? ` µ._fxConf = ${conf[1]};` : ''}`)
    window.document.documentElement.lang = 'fr'
    window.document.body.innerHTML = tags.map((t) => `<${t}></${t}>`).join('')
    const comp = window.document.querySelector(tags[0])
    const fin  = Date.now() + 3000
    while (!comp._shadow?.querySelector('.a') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 30))
    const taper = async (i: any, v: string, sortie = false) => {
      i.value = v
      i.dispatchEvent(new window.Event('input', { bubbles: true }))
      if (sortie) i.dispatchEvent(new window.Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 30))
    }
    return { window, root: comp._shadow, taper }
  }

  it('"effects": { "guard": false } — gardé sans spectacle : la frappe jamais réécrite, ramenée à la sortie, ni bulle ni secousse (et *shake ne part pas au cœur)', async () => {
    const { root, files, lire, code } = await construire('sans', { effects: { guard: false } })
    const age = files.find((f) => f.startsWith('fx-age'))!
    assert.match(lire(age), /µ\._mjs_fx\(this, _mjs_fxn, "guard", \{"silent":true,"fx":"none","_bind":"\$age"\}\)/)
    assert.doesNotMatch(code, /_mjs_fxDefs\.shake/)
    const v = await monterVivant(root, code, ['mjs-fx-age'])
    const a = v.root.querySelector('.a')
    await v.taper(a, '1')
    assert.equal(a.value, '1', 'le champ n\'est pas réécrit « 18 » en pleine frappe')
    assert.equal(v.root.querySelector('.va').textContent, '30')
    await v.taper(a, '300', true)
    assert.equal(a.value, '120', 'ramenée à la sortie')
    assert.equal(v.root.querySelector('.va').textContent, '120')
    assertAbsent(v.root.querySelector('[mjs-fx-guard-tip]'), 'aucune bulle')
    assert.ok(!(a.getAttribute('mjs-fx') || '').includes('shake'), 'aucune secousse')
    v.window.close()
  })

  it('"effects": { "guard": { "delay": "150ms" } } — la pause par défaut de tous les champs gardés', async () => {
    const { root, code } = await construire('delai', { effects: { guard: { delay: '150ms' } } })
    assert.match(readFileSync(join(root, 'bundle.js'), 'utf-8'), /µ\._fxConf = \{"guard":\{"delay":"150ms"\}\};/)
    const v = await monterVivant(root, code, ['mjs-fx-age'])
    const a = v.root.querySelector('.a')
    await v.taper(a, '2')
    assertAbsent(v.root.querySelector('[mjs-fx-guard-tip]'), 'rien avant la pause')
    await new Promise((r) => setTimeout(r, 250))
    assert.equal(v.root.querySelector('[mjs-fx-guard-tip]')?.textContent, 'de 18 à 120', 'la bulle après 150 ms sans frappe')
    assert.equal(a.value, '2', 'sans toucher au champ')
    v.window.close()
  })

  it('la clé guard de mjs.config.json : un booléen, ou { delay } (une durée : 800, "800ms", "1.5s")', () => {
    const projet = (etiquette: string, effects: unknown) => {
      const root = mjsTmp('guard-office-config-' + etiquette)
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', effects }))
      return root
    }
    const trouve = findConfig(projet('non', { guard: false }))!
    assert.deepEqual(resolveBundlerOpts(trouve.config, trouve.configDir).effects, { guard: false })
    for (const d of ['1.5s', '800ms', 800, 0]) {
      const cfg = findConfig(projet('delai-' + String(d).replace('.', '-'), { guard: { delay: d } }))!
      assert.deepEqual(resolveBundlerOpts(cfg.config, cfg.configDir).effects, { guard: { delay: d } })
    }
    assert.throws(() => findConfig(projet('faux', { guard: 'non' })), /"effects\.guard" vaut true, false ou \{ "delay": "1s" \} — reçu "non"/)
    assert.throws(() => findConfig(projet('negatif', { guard: { delay: -1 } })), /"effects\.guard\.delay"/)
    assert.throws(() => findConfig(projet('mot', { guard: { delay: 'vite' } })), /"effects\.guard\.delay"/)
    assert.throws(() => findConfig(projet('cle', { guard: { attente: 1 } })), /"effects\.guard" vaut true, false ou \{ "delay": "1s" \}/)
  })

  // 24 h pour la pause de *guard ; le plafond d'une minuterie (2147483647 ms) reste celui de "i18n.timeout"
  describe('plafond de la pause : 24 h (86 400 000 ms)', () => {
    const projet = (etiquette: string, effects: unknown, lang?: string) => {
      const root = mjsTmp('guard-office-plafond-' + etiquette)
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', ...(lang ? { lang } : {}), effects }))
      return root
    }

    it('mjs.config.json : refusé au-delà, avec la clé nommée et un exemple (fr)', () => {
      for (const d of [86400001, 2147483647, 3000000000, 1e12, '3000000000ms', '86401s']) {
        assert.throws(() => findConfig(projet('trop-long', { guard: { delay: d } })), /"effects\.guard\.delay" ne peut pas dépasser 24 h \(86 400 000 ms\).* par exemple 1000, "1s" ou "800ms" — reçu/, JSON.stringify(d))
      }
    })

    it('mjs.config.json : refusé au-delà (en)', () => {
      assert.throws(() => findConfig(projet('trop-long-en', { guard: { delay: 3000000000 } }, 'en')), /"effects\.guard\.delay" cannot exceed 24 hours \(86,400,000 ms\).* for example 1000, "1s" or "800ms" — got 3000000000/)
    })

    it('mjs.config.json : accepté au plafond lui-même', () => {
      for (const d of [86400000, '86400000ms', '86400s']) {
        const cfg = findConfig(projet('plafond', { guard: { delay: d } }))!
        assert.deepEqual(resolveBundlerOpts(cfg.config, cfg.configDir).effects, { guard: { delay: d } }, String(d))
      }
    })

    it('le plafond se juge arrondi à la milliseconde : 86400000.4 passe, 86400000.5 est refusé (mjs.config.json et API)', () => {
      for (const d of [86400000.4, '86400000.4ms']) {
        const cfg = findConfig(projet('plafond-arrondi', { guard: { delay: d } }))!
        assert.deepEqual(resolveBundlerOpts(cfg.config, cfg.configDir).effects, { guard: { delay: d } }, String(d))
      }
      for (const d of [86400000.5, '86400000.5ms']) {
        assert.throws(() => findConfig(projet('plafond-arrondi-refuse', { guard: { delay: d } })), /"effects\.guard\.delay" ne peut pas dépasser 24 h \(86 400 000 ms\)/, JSON.stringify(d))
      }
      const racine = mjsTmp('guard-office-plafond-arrondi-api')
      const opts   = (delay: unknown) => ({ sourceDir: join(racine, 'src'), outputDir: join(racine, 'out'), manifestPath: join(racine, 'out', 'bundle.js'), effects: { guard: { delay } } }) as any
      for (const d of [86400000.4, '86400000.4ms']) new Bundler(opts(d))
      for (const d of [86400000.5, '86400000.5ms']) assert.throws(() => new Bundler(opts(d)), /"effects\.guard\.delay" ne peut pas dépasser 24 h \(86 400 000 ms\)/, JSON.stringify(d))
    })

    it('API : new Bundler({ effects }) applique le même plafond, au plafond lui-même rien ne se passe', () => {
      const racine = mjsTmp('guard-office-plafond-api')
      const opts   = (delay: unknown) => ({ sourceDir: join(racine, 'src'), outputDir: join(racine, 'out'), manifestPath: join(racine, 'out', 'bundle.js'), effects: { guard: { delay } } }) as any
      for (const d of [86400001, 2147483647, 3000000000, '3000000000ms', '86401s']) {
        assert.throws(() => new Bundler(opts(d)), /"effects\.guard\.delay" ne peut pas dépasser 24 h \(86 400 000 ms\)/, JSON.stringify(d))
      }
      for (const d of [86400000, '86400000ms', '86400s', '1.5s', 0]) new Bundler(opts(d))
      new Bundler({ sourceDir: join(racine, 'src'), outputDir: join(racine, 'out'), manifestPath: join(racine, 'out', 'bundle.js'), effects: { guard: true } } as any)
    })

    it('24 h est le plafond de la pause seule : "i18n.timeout" garde celui d\'une minuterie (2147483647 ms)', () => {
      const config = (timeout: unknown) => {
        const root = mjsTmp('guard-office-plafond-i18n')
        writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', i18n: { default: 'fr', timeout } }))
        return root
      }
      for (const d of [86400001, 100000000, 2147483647, '2147483647ms']) {
        const cfg = findConfig(config(d))!
        assert.equal(resolveBundlerOpts(cfg.config, cfg.configDir).i18n?.timeout, d, String(d))
      }
      assert.throws(() => findConfig(config(2147483648)), /"i18n\.timeout" ne peut pas dépasser 2147483647 ms \(environ 24,8 jours\)/)
      const racine = mjsTmp('guard-office-plafond-i18n-api')
      const opts   = (timeout: unknown) => ({ sourceDir: join(racine, 'src'), outputDir: join(racine, 'out'), manifestPath: join(racine, 'out', 'bundle.js'), i18n: { default: 'fr', timeout } }) as any
      for (const d of [86400001, 100000000, 2147483647]) new Bundler(opts(d))
      assert.throws(() => new Bundler(opts(2147483648)), /"i18n\.timeout" ne peut pas dépasser 2147483647 ms/)
    })
  })
})
