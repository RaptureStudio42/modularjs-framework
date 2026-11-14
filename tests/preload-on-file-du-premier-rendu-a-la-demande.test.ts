// la file des liens `:preload="on"`, lue à l'image qui suit la construction d'un composant, n'entre au cœur de production que si une
// unité du projet écrit `:preload` ; sans elle, la porte se lit à la construction du composant : aucune liste, aucune opération de plus
// par composant ; la clé `runtime` la demande (`'all'`, ou `ujs` nommé dans la liste) ; le développement la garde toujours, un composant
// recompilé à chaud peut écrire `:preload`

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { extractMarked } from './helpers/extract-marked.js'
import { Bundler, projeterBlocs, terminateSharedWorkerPool } from '../src/bundler/index.js'

const ICI     = dirname(fileURLToPath(import.meta.url))
const UJS_SRC = readFileSync(join(ICI, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')
const PROD    = { urlPrefix: '/out', env: 'prod', js: 'bundle' }
// la porte du préchargement, dans les deux textes du cœur ; la file : sa lecture « tous les 1 024 composants »
const PORTE   = 'a[data-mjs-preload="on"]'
const FILE    = /&\s*1023/
// une balise de bloc restée dans un texte projeté
const BALISE  = /^[ \t]*\/\/ <\/?(?:sans-)?precharge-on>$/m
const page    = (preload: string): string => `<script>\n$on = true\n</script>\n{if $on}<a href="/app/x"${preload}>x</a>{end}\n<form action="/app/y" method="post"><button>y</button></form>\n`

async function construire(nom: string, source: string, reglages: Record<string, unknown> = {}): Promise<string> {
  const root   = mjsTmp('preload-a-la-demande')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, nom + '.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), ...reglages } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [])
  return readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
}

// `_mjs_maybeScanEager` du texte du cœur, avec ou sans le bloc : jouée seule, images et recherches relevées
function porteDuTexte(texte: string): { µ: any, images: Array<() => void>, cherches: unknown[], rendre: () => void } {
  const µ: any               = { _isServer: false }
  const images: Array<() => void> = []
  const cherches: unknown[]  = []
  const monde: any           = globalThis
  const avant                = monde.requestAnimationFrame
  new Function('µ', extractMarked(texte, '_mjs_normPreload') + '\n' + extractMarked(texte, '_mjs_maybeScanEager'))(µ)
  µ._mjs_scanEager = (racine: unknown): void => { cherches.push(racine) }
  monde.requestAnimationFrame = (f: () => void): number => images.push(f)
  const rendre = (): void => {
    if (avant === undefined) delete monde.requestAnimationFrame
    else monde.requestAnimationFrame = avant
  }
  return { µ, images, cherches, rendre }
}

describe('préchargement `:preload="on"` : la file du premier rendu n\'entre au cœur de production que si une unité écrit `:preload`', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('production, aucun `:preload` : le module des liens est au cœur, sans la file', async () => {
    const code = await construire('p-sans', page(''), PROD)
    assert.ok(code.includes(PORTE), 'le module des liens et des formulaires devait être au cœur')
    assert.ok(!FILE.test(code), 'la file ne devait pas être au cœur')
  })

  it('production, un `:preload` écrit : la file est au cœur', async () => {
    const code = await construire('p-avec', page(' :preload="on"'), PROD)
    assert.ok(code.includes(PORTE) && FILE.test(code), 'la file devait être au cœur')
  })

  it('production, aucun `:preload` : la clé `runtime` garde la file — `all`, ou `ujs` nommé', async () => {
    assert.ok(FILE.test(await construire('p-tout', page(''), { ...PROD, runtime: 'all' })), '`runtime: "all"` devait garder la file')
    assert.ok(FILE.test(await construire('p-ujs', page(''), { ...PROD, runtime: ['ujs'] })), '`ujs` nommé devait garder la file')
  })

  it('développement, aucun `:preload` : la file est au cœur', async () => {
    const code = await construire('p-dev', page(''))
    assert.ok(code.includes(PORTE) && FILE.test(code), 'la file devait être au cœur de développement')
  })

  it('texte du cœur sans le bloc : la porte se lit à la construction — rien pour un composant sans lien `on`, une recherche à l\'image suivante sinon, aucune liste', () => {
    const texte = projeterBlocs(UJS_SRC, { 'precharge-on': false })
    assert.ok(!texte.includes('_mjsEagerHosts') && !BALISE.test(texte), 'ni liste ni balise de bloc dans le texte projeté')
    const { µ, images, cherches, rendre } = porteDuTexte(texte)
    try {
      µ._mjs_maybeScanEager({ _shadow: { querySelector: () => null } })
      assert.equal(images.length, 0, 'aucune image demandée pour un composant sans lien `on`')
      const ombre = { querySelector: () => ({}) }
      µ._mjs_maybeScanEager({ _shadow: ombre })
      assert.equal(images.length, 1, 'une image demandée pour un composant à lien `on`')
      images[0]()
      assert.ok(cherches.length === 1 && cherches[0] === ombre, 'son ombre cherchée à l\'image suivante')
    }
    finally {
      rendre()
    }
  })

  it('texte du cœur avec le bloc : les composants construits attendent l\'image suivante, où leur porte se lit', () => {
    const texte = projeterBlocs(UJS_SRC, { 'precharge-on': true })
    assert.ok(texte.includes('_mjsEagerHosts') && !BALISE.test(texte) && !/^\s*\/\/ const cfg = µ\.preload/m.test(texte), 'la file, sans le texte de repli ni balise de bloc')
    const { µ, images, cherches, rendre } = porteDuTexte(texte)
    try {
      const ombre = { querySelector: () => ({}) }
      µ._mjs_maybeScanEager({ _shadow: { querySelector: () => null } })
      µ._mjs_maybeScanEager({ _shadow: ombre })
      assert.equal(images.length, 1, 'une seule image pour tous les composants construits d\'ici là')
      assert.equal(cherches.length, 0, 'rien de cherché avant l\'image')
      images[0]()
      assert.ok(cherches.length === 1 && cherches[0] === ombre, 'seule l\'ombre du composant à lien `on` est cherchée')
    }
    finally {
      rendre()
    }
  })
})
