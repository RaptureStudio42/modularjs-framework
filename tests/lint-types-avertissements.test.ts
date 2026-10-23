// Un type par avertissement de build (`lint.<type>`, étiquette `[lint.<type>]` en fin de
// ligne), coupable via `"lint": { "<type>": false }` dans mjs.config.json, une seule source de
// vérité pour la liste et la gravité (src/diagnostics.ts). Couvre : la validation générique du
// bloc `lint` (au-delà des trois clés historiques a11y/ujsForm/maxStateVars, déjà testées dans
// tests/a11y-lint.test.ts, tests/ujs-form-lint.test.ts, tests/lint-max-state-vars.test.ts), un
// type bundler (themeShared) sur un VRAI build, la disparition du rappel a11y répété par
// composant, et les couleurs terminal (jamais dans stats.warnings, seulement à l'impression).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { transpile } from '../src/transpiler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { Bundler } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { resolveColorsEnabled, paintDiagnostic, paintError, LINT_SEVERITY } from '../src/diagnostics.js'

describe('mjs.config.json — validation du bloc lint (types génériques, au-delà de a11y/ujsForm/maxStateVars)', () => {
  it('accepte { lint: { themeShared: false } } et resolveBundlerOpts le transmet', () => {
    const root = mjsTmp('lint-types-cfg')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ lint: { themeShared: false } }))
    const found = findConfig(root)
    assert.ok(found)
    assert.equal(found!.config.lint!.themeShared, false)
    const opts = resolveBundlerOpts(found!.config, root)
    assert.equal(opts.lint?.themeShared, false)
  })

  it('refuse { lint: { themeShared: "non" } } avec un message clair, même famille que les autres types', () => {
    const root = mjsTmp('lint-types-cfg')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ lint: { themeShared: 'non' } }))
    assert.throws(() => findConfig(root), /lint\.themeShared doit être un booléen/)
  })

  it('clé inconnue dans lint (themeShard, faute de frappe) : comportement ACTUEL des clés inconnues (throw, liste des valides)', () => {
    const root = mjsTmp('lint-types-cfg')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ lint: { themeShard: false } }))
    assert.throws(() => findConfig(root), /lint\.themeShard : clé inconnue[\s\S]*Clés valides/)
  })
})

// deux composants qui déclarent la MÊME variable de thème dans un sélecteur de leur <style>
// (cf. docs/31-themes.md) — computeVarRegistry (bundler/index.ts) émet alors une information
// « variable-partagee », type themeShared.
function themeSharedProject(root: string): void {
  const srcDir = join(root, 'app/modularjs')
  mkdirSync(srcDir, { recursive: true })
  const compo = '<style>\n  :host\n    $$zone-accent: #fff\n</style>\n<p>x</p>\n'
  writeFileSync(join(srcDir, 'carte-un.mjs'), compo)
  writeFileSync(join(srcDir, 'carte-deux.mjs'), compo)
}

async function buildThemeSharedProject(lintExtra?: Record<string, unknown>): Promise<{ warnings: string[] }> {
  const root = mjsTmp('theme-shared')
  themeSharedProject(root)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
    sourceDir: 'app/modularjs', outputDir: 'out', manifestPath: 'bundle.js',
    ...(lintExtra ? { lint: lintExtra } : {}),
  }))
  const found = findConfig(root)
  assert.ok(found, 'mjs.config.json doit être trouvé')
  const opts = resolveBundlerOpts(found!.config, root)
  const bundler = new Bundler(opts as any)
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))
  return { warnings: stats.warnings }
}

describe('build (vrai Bundler) — type themeShared', function () {
  this.timeout(30000)

  it('deux composants déclarant la même variable de thème → un avertissement qui finit par [lint.themeShared]', async () => {
    const { warnings } = await buildThemeSharedProject()
    assert.ok(warnings.some(w => w.endsWith('[lint.themeShared]')), `attendu [lint.themeShared] en fin de ligne : ${JSON.stringify(warnings)}`)
  })

  it('lint.themeShared: false coupe cet avertissement (absent de stats.warnings)', async () => {
    const { warnings } = await buildThemeSharedProject({ themeShared: false })
    assert.ok(!warnings.some(w => w.includes('zone-accent')), `aucun avertissement sur zone-accent attendu : ${JSON.stringify(warnings)}`)
  })

  it('stats.warnings reste du texte SANS AUCUNE couleur (la couleur ne s\'ajoute qu\'à l\'impression)', async () => {
    const { warnings } = await buildThemeSharedProject()
    assert.ok(warnings.length > 0)
    assert.ok(warnings.every(w => !w.includes('\x1b')), `aucun code ANSI attendu dans stats.warnings : ${JSON.stringify(warnings)}`)
  })
})

// espionne console.warn le temps d'un transpile (motif tests/a11y-lint.test.ts)
async function warningsFor(src: string, moduleName: string, opts: Record<string, unknown> = {}): Promise<string[]> {
  const orig = console.warn
  const caught: string[] = []
  console.warn = (...a: unknown[]) => { caught.push(String(a[0])) }
  try { await transpile(src, { moduleName, ...opts }) } finally { console.warn = orig }
  return caught
}

describe('a11y — étiquette [lint.a11y] au point d\'impression (transpiler/index.ts), plus de rappel par composant', function () {
  this.timeout(30000)

  it('<div @click={x}> non interactif : la ligne émise finit par [lint.a11y]', async () => {
    const w = await warningsFor('<div @click={x}>y</div>', 'carte-click')
    assert.ok(w.some(m => m.endsWith('[lint.a11y]')), `attendu [lint.a11y] en fin de ligne : ${JSON.stringify(w)}`)
    assert.ok(w.every(m => !m.includes('pour couper ce contrôle')), `le rappel répété par composant a disparu : ${JSON.stringify(w)}`)
  })

  it('lint.a11y: false coupe tout — capture de console.warn pendant la compilation : rien', async () => {
    const w = await warningsFor('<div @click={x}>y</div>', 'carte-click-off', { a11y: false })
    assert.equal(w.length, 0, `aucun avertissement attendu : ${JSON.stringify(w)}`)
  })
})

describe('diagnostics — couleurs terminal (src/diagnostics.ts)', () => {
  describe('resolveColorsEnabled — FORCE_COLOR / NO_COLOR / isTTY', () => {
    it('FORCE_COLOR="1" : actives, même hors TTY', () => {
      assert.equal(resolveColorsEnabled({ FORCE_COLOR: '1' }, false), true)
    })
    // mêmes règles que la console de Node : FORCE_COLOR tranche d'abord, dans les deux sens
    it('FORCE_COLOR="0" ou "false" : éteintes, même dans un terminal', () => {
      assert.equal(resolveColorsEnabled({ FORCE_COLOR: '0' }, true), false)
      assert.equal(resolveColorsEnabled({ FORCE_COLOR: 'false' }, true), false)
    })
    it('FORCE_COLOR vide, "true", "2" ou "3" : actives, même hors terminal', () => {
      for (const v of ['', 'true', '2', '3']) assert.equal(resolveColorsEnabled({ FORCE_COLOR: v }, false), true, `FORCE_COLOR=${JSON.stringify(v)}`)
    })
    it('TERM=dumb : éteintes, même dans un terminal', () => {
      assert.equal(resolveColorsEnabled({ TERM: 'dumb' }, true), false)
    })
    it('NO_COLOR posé et NON VIDE, sans FORCE_COLOR : inactives même en TTY', () => {
      assert.equal(resolveColorsEnabled({ NO_COLOR: '1' }, true), false)
    })
    it('NO_COLOR VIDE : ne désactive rien, retombe sur isTTY', () => {
      assert.equal(resolveColorsEnabled({ NO_COLOR: '' }, true), true)
    })
    it('FORCE_COLOR prime sur NO_COLOR (ordre de la spec)', () => {
      assert.equal(resolveColorsEnabled({ FORCE_COLOR: '1', NO_COLOR: '1' }, false), true)
    })
    it('ni l\'un ni l\'autre : suit isTTY tel quel', () => {
      assert.equal(resolveColorsEnabled({}, true), true)
      assert.equal(resolveColorsEnabled({}, false), false)
    })
  })

  describe('paintDiagnostic — codes ANSI par gravité, étiquette grisée', () => {
    it('type avertissement (a11y) : corps jaune (33), étiquette grisée (2), remise à zéro (0)', () => {
      const out = paintDiagnostic('un message [lint.a11y]', true)
      assert.match(out, /\x1b\[33m/)
      assert.match(out, /\x1b\[2m/)
      assert.match(out, /\x1b\[0m/)
    })
    it('type info (maxStateVars) : corps cyan (36)', () => {
      const out = paintDiagnostic('un message [lint.maxStateVars]', true)
      assert.match(out, /\x1b\[36m/)
    })
    it('colorsEnabled=false : ligne rendue TELLE QUELLE, aucun code ANSI', () => {
      const line = 'un message [lint.a11y]'
      assert.equal(paintDiagnostic(line, false), line)
    })
    it('ligne sans étiquette [lint.x] reconnue (message interne/fatal) : telle quelle, même colorsEnabled=true', () => {
      const line = 'un message interne sans type'
      assert.equal(paintDiagnostic(line, true), line)
    })
  })

  describe('paintError — erreurs de build (jamais typées), rouge à l\'impression seulement', () => {
    it('colorsEnabled=true : rouge (31)', () => {
      assert.match(paintError('boum', true), /\x1b\[31m/)
    })
    it('colorsEnabled=false : message inchangé', () => {
      assert.equal(paintError('boum', false), 'boum')
    })
  })

  it('LINT_SEVERITY ne connaît que warning/info — jamais error (une erreur de build n\'est jamais un type lint)', () => {
    assert.ok(Object.values(LINT_SEVERITY).every(s => s === 'warning' || s === 'info'))
  })
})

// types émis au cœur du compilateur (analyse, parseur, générateur, adaptateur Coffee) : le réglage
// doit y parvenir — `transpile()` est le même dans le thread principal et dans un thread de travail
describe('types émis au cœur du compilateur — étiquette et coupure', function () {
  this.timeout(30000)

  const CAS: Array<{ type: string, nom: string, source: string, motif: RegExp }> = [
    { type: 'legacy',     nom: 'coffee',       source: '<script lang="coffee">\nx = 1\n</script>\n<p>y</p>',                  motif: /CoffeeScript dépréciée/ },
    { type: 'legacy',     nom: 'url-change',   source: '<script>\n@onUrlChange = -> 1\n</script>\n<p>y</p>',                  motif: /onUrlChange/ },
    { type: 'reactivity', nom: 'effet-boucle', source: '<script>\n$n = 1\nµeffect ->\n  $n = $n + 1\n</script>\n<p>{$n}</p>', motif: /LIT et ÉCRIT/ },
    { type: 'reactivity', nom: 'this-ref',     source: '<div @this=!{$ref}>x</div>',                                          motif: /@this=/ },
    { type: 'naming',     nom: 'prefixe',      source: '<script>\n$._mjs_x = 1\n</script>\n<p>y</p>',                         motif: /préfixe '_mjs_'/ },
    { type: 'syntax',     nom: 'fermeture',    source: '<div><span>x</div>',                                                  motif: /n'est pas refermée/ },
    { type: 'syntax',     nom: 'jeton',        source: '<p>x</p>\n{end}',                                                     motif: /aucun bloc ouvrant/ },
    { type: 'syntax',     nom: 'diese',        source: '<p class="a #{b}">x</p>',                                             motif: /n'est pas l'interpolation d'attribut/ },
    { type: 'events',     nom: 'emit',         source: "<button @click={µemit 'choisi', e}>x</button>",                       motif: /relaie l'ÉVÉNEMENT/ },
  ]

  for (const c of CAS) {
    it(`${c.type} (${c.nom}) : étiqueté [lint.${c.type}], coupé par lint.${c.type}: false`, async () => {
      const avec  = await warningsFor(c.source, `lt-${c.nom}-on`)
      const ligne = avec.find(m => c.motif.test(m))
      assert.ok(ligne, `avertissement attendu : ${JSON.stringify(avec)}`)
      assert.ok(ligne!.endsWith(`[lint.${c.type}]`), `étiquette attendue en fin de ligne : ${ligne}`)
      const sans = await warningsFor(c.source, `lt-${c.nom}-off`, { lint: { [c.type]: false } })
      assert.ok(!sans.some(m => c.motif.test(m)), `lint.${c.type}: false doit le couper : ${JSON.stringify(sans)}`)
    })
  }
})

// bout en bout, vraie CLI lancée depuis les sources (motif de cli-build-purge.test.ts : importer
// cli.ts lancerait une CLI) — `bin/mjs` chargerait dist/, pas le code testé ici
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function cli(commande: string, root: string): { code: number | null, sortie: string } {
  const r = spawnSync('npx', ['tsx', 'src/cli.ts', commande, '--root', root], {
    cwd: repoRoot, encoding: 'utf-8', timeout: 120000, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: undefined },
  })
  return { code: r.status, sortie: (r.stdout ?? '') + (r.stderr ?? '') }
}

function projet(prefixe: string, composants: Record<string, string>, config: Record<string, unknown> = {}): string {
  const root = mjsTmp(prefixe)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...config }))
  for (const [nom, source] of Object.entries(composants)) writeFileSync(join(root, 'src', nom), source)
  return root
}

const AIDE = /Pour couper un type : "lint"/g

describe('CLI — ligne d’aide, mjs check, i18n.default', function () {
  this.timeout(180000)

  it('mjs build : un seul avertissement a11y suffit à faire sortir la ligne d’aide, une fois', () => {
    const r = cli('build', projet('lt-aide', { 'a.mjs': '<div @click={x}>y</div>\n' }))
    assert.equal(r.code, 0, r.sortie)
    assert.match(r.sortie, /\[lint\.a11y\]/)
    assert.equal((r.sortie.match(AIDE) ?? []).length, 1, r.sortie)
  })

  it('mjs build sans aucun avertissement : pas de ligne d’aide', () => {
    const r = cli('build', projet('lt-muet', { 'a.mjs': '<p>ok</p>\n' }))
    assert.equal(r.code, 0, r.sortie)
    assert.equal((r.sortie.match(AIDE) ?? []).length, 0, r.sortie)
  })

  it('mjs check affiche le même bilan que mjs build', () => {
    const compo = '<style>\n  :host\n    $$zone-accent: #fff\n</style>\n<p>x</p>\n'
    const r = cli('check', projet('lt-check', { 'carte-un.mjs': compo, 'carte-deux.mjs': compo }))
    assert.equal(r.code, 0, r.sortie)
    assert.match(r.sortie, /\[lint\.themeShared\]/)
    assert.equal((r.sortie.match(AIDE) ?? []).length, 1, r.sortie)
  })

  it('i18n.default sans dictionnaire : étiqueté [lint.i18n], coupé par lint.i18n: false', () => {
    const avec = projet('lt-i18n', { 'a.mjs': '<p>x</p>\n' }, { i18n: { default: 'de' } })
    mkdirSync(join(avec, 'src', 'i18n'), { recursive: true })
    writeFileSync(join(avec, 'src', 'i18n', 'fr.json'), '{}')
    const r = cli('build', avec)
    const ligne = r.sortie.split('\n').find(l => /i18n\.default/.test(l))
    assert.ok(ligne, r.sortie)
    assert.ok(ligne!.trimEnd().endsWith('[lint.i18n]'), ligne)

    const sans = projet('lt-i18n-off', { 'a.mjs': '<p>x</p>\n' }, { i18n: { default: 'de' }, lint: { i18n: false } })
    mkdirSync(join(sans, 'src', 'i18n'), { recursive: true })
    writeFileSync(join(sans, 'src', 'i18n', 'fr.json'), '{}')
    assert.doesNotMatch(cli('build', sans).sortie, /i18n\.default/)
  })
})

// `mjs dev` ne lit jamais `stats.warnings` à chaque recompilation : le bilan de fin (thème partagé,
// collisions…) sort UNE fois, au démarrage, puis plus rien — un rappel à chaque sauvegarde serait du bruit
describe('CLI — mjs dev : bilan de fin au démarrage, une seule fois', function () {
  this.timeout(120000)

  it('le bilan sort au premier build, pas aux recompilations suivantes', async () => {
    const compo = '<style>\n  :host\n    $$zone-accent: #fff\n</style>\n<p>x</p>\n'
    const root  = projet('lt-dev', { 'carte-un.mjs': compo, 'carte-deux.mjs': compo })
    const port  = 20000 + Math.floor(Math.random() * 10000)
    const proc  = spawn(join(repoRoot, 'node_modules', '.bin', 'tsx'), [join(repoRoot, 'src', 'cli.ts'), 'dev', '--root', root, '--port', String(port)], {
      cwd: repoRoot, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: undefined },
    })
    let sortie = ''
    proc.stdout!.on('data', (d) => { sortie += String(d) })
    proc.stderr!.on('data', (d) => { sortie += String(d) })
    const attendreSortie = async (cond: () => boolean, ms: number) => {
      const fin = Date.now() + ms
      while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 100))
    }
    try {
      await attendreSortie(() => /✅ \d+ fichiers en \d+ms/.test(sortie), 60000)
      await new Promise((r) => setTimeout(r, 300))
      assert.match(sortie, /\[lint\.themeShared\]/, sortie)
      assert.equal((sortie.match(AIDE) ?? []).length, 1, sortie)

      writeFileSync(join(root, 'src', 'carte-un.mjs'), compo + '<p>y</p>\n')
      await attendreSortie(() => (sortie.match(/✅ \d+ fichiers en \d+ms/g) ?? []).length >= 2, 30000)
      await new Promise((r) => setTimeout(r, 300))
      assert.equal((sortie.match(/\[lint\.themeShared\]/g) ?? []).length, 1, `une seule fois, au démarrage :\n${sortie}`)
    } finally {
      try { process.kill(-proc.pid!, 'SIGKILL') } catch { /* déjà sorti */ }
    }
  })
})
