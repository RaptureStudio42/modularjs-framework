// mjs_easing.ts (le module optionnel `easing`) ne porte pas que les courbes : le moteur qui joue les transitions y vit
// aussi (`_mjs_whenLayouted`, `_mjs_playTransition`, `_mjs_runTransition`, `µ.anim`). Le code émis pour `@in`, `@out` et
// `@transition` les appelle, comme le fichier des transitions (mjs_fx_transition.ts). Un `runtime` qui ne nomme pas
// `easing` (`'core'`, `[]`, `['router']`) ne doit donc pas laisser une transition écrite sans son moteur : une transition
// hors de tout `{if}` arrêtait la construction sur « Cœur incomplet » (symbole `_mjs_whenLayouted`), et une transition dans
// un `{if}`, un `{for}` ou sur un composant finissait la construction sans jamais jouer ni son entrée ni sa sortie.
// Le moteur suit la transition écrite, rien d'autre : une appli sans transition ne le prend pas (ni un `@attach`, ni un
// effet qui n'est pas une transition).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// la définition du moteur, telle que mjs_easing.ts l'écrit (cœur non minifié) ; les courbes ouvrent le même fichier
const MOTEUR  = 'µ._mjs_whenLayouted = function'
const COURBES = 'µ.easing = {}'

// les formes d'une transition écrite, avec l'unique composant qui la porte
const TRANSITIONS: Record<string, string> = {
  '@in=*fade hors de tout bloc':                   '<div class="a" @in=*fade>bonjour</div>',
  '@out=*fade hors de tout bloc':                  '<div class="a" @out=*fade>bonjour</div>',
  '@transition=*slide hors de tout bloc':          '<div class="a" @transition=*slide>bonjour</div>',
  '@in=*fly(up) hors de tout bloc':                '<div class="a" @in=*fly(up)>bonjour</div>',
  '@in.global=*fade hors de tout bloc':            '<div class="a" @in.global=*fade>bonjour</div>',
  '@in=*scramble (un effet qui se joue une fois)': '<p @in=*scramble>bonjour</p>',
  '@in=*fade dans un {if}':                        '<script>$show = true</script>\n{if $show}<p @in=*fade>x</p>{end}',
  '@in=*fade dans un {for}':                       '<script>$items = [1]</script>\n{for x in $items}<li @in=*fade>{x}</li>{end}',
  '@in=*fade sur un composant':                    '<@enfant @in=*fade></@enfant>',
}

// des applis où rien ne joue de transition
const SANS_TRANSITION: Record<string, string> = {
  'une balise nue':                                           '<p>x</p>',
  'un {if} et un {for}':                                      '<script>$show = true\n$items = [1]</script>\n{if $show}<p>x</p>{end}\n{for x in $items}<li>{x}</li>{end}',
  '@attach (le chemin lent de destruction, sans transition)': '<p @attach={(node) => { }}>x</p>',
  '*neon (un effet qui n\'est pas une transition)':           '<p *neon>x</p>',
}

async function usedOf(source: string): Promise<Set<string>> {
  const { output, data } = await transpile(source, { moduleName: 'hop' })
  return scanCompiledFeatures(output, data)
}

type Construction = { runtime: 'all' | 'core' | string[], js: 'split' | 'bundle', env: 'dev' | 'prod' }

async function construire(c: Construction, files: Record<string, string>): Promise<{ errors: string[], outDir: string }> {
  const root   = mjsTmp('easing-transitions')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, contenu] of Object.entries(files)) writeFileSync(join(srcDir, nom), contenu + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), runtime: c.runtime, js: c.js, env: c.env } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  return { errors: stats.errors.map((e: any) => String(e.message)), outDir }
}

function coeur(outDir: string): string {
  const f = readdirSync(outDir).find((n) => /^mjs_core-/.test(n))
  assert.ok(f, 'mjs_core-*.js doit exister')
  return readFileSync(join(outDir, f!), 'utf-8')
}

describe('mjs_easing.ts — le moteur des transitions suit la transition écrite', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('sélection des fichiers du cœur, sur les faits lus dans le code compilé', () => {
    for (const [titre, source] of Object.entries(TRANSITIONS)) {
      it(`runtime 'core' + ${titre} : le moteur est du cœur`, async () => {
        const files = new Bundler({ runtime: 'core' }).resolveRuntimeFiles(await usedOf(source)).files
        assert.ok(files.includes('mjs_fx_transition.ts'), 'le fichier des transitions est du cœur')
        assert.ok(files.includes('mjs_easing.ts'), `mjs_easing.ts manque au cœur : ${files.join(' ')}`)
      })
    }

    for (const [titre, source] of Object.entries(SANS_TRANSITION)) {
      it(`runtime 'core' + ${titre} : le moteur n'est pas du cœur`, async () => {
        const files = new Bundler({ runtime: 'core' }).resolveRuntimeFiles(await usedOf(source)).files
        assert.equal(files.includes('mjs_easing.ts'), false, `mjs_easing.ts ne doit pas entrer : ${files.join(' ')}`)
      })
    }

    it('un tableau qui ne nomme pas easing (`[]`, `[\'router\']`) embarque le moteur pour une transition', async () => {
      const used = await usedOf(TRANSITIONS['@in=*fade hors de tout bloc'])
      assert.ok(new Bundler({ runtime: [] }).resolveRuntimeFiles(used).files.includes('mjs_easing.ts'), 'runtime: []')
      assert.ok(new Bundler({ runtime: ['router'] }).resolveRuntimeFiles(used).files.includes('mjs_easing.ts'), "runtime: ['router']")
    })

    it('le fichier des transitions demandé à la main (`[\'router\', \'fx_transition\']`) entraîne le moteur, sans transition vue', async () => {
      const used  = await usedOf(SANS_TRANSITION['une balise nue'])
      const files = new Bundler({ runtime: ['router', 'fx_transition'] }).resolveRuntimeFiles(used).files
      assert.ok(files.includes('mjs_fx_transition.ts'), 'le fichier des transitions est du cœur')
      assert.ok(files.includes('mjs_easing.ts'), `mjs_easing.ts manque au cœur : ${files.join(' ')}`)
    })

    it('un tableau qui nomme easing le garde, transition ou non', async () => {
      const used = await usedOf(SANS_TRANSITION['une balise nue'])
      assert.ok(new Bundler({ runtime: ['easing'] }).resolveRuntimeFiles(used).files.includes('mjs_easing.ts'))
    })

    it("'all' embarque le moteur, transition ou non", async () => {
      for (const source of [TRANSITIONS['@in=*fade hors de tout bloc'], SANS_TRANSITION['une balise nue']]) {
        assert.ok(new Bundler({ runtime: 'all' }).resolveRuntimeFiles(await usedOf(source)).files.includes('mjs_easing.ts'))
      }
    })
  })

  describe('construction réelle', () => {
    const CORE_BUNDLE_PROD: Construction = { runtime: 'core', js: 'bundle', env: 'prod' }
    const CORE_SPLIT_DEV: Construction   = { runtime: 'core', js: 'split', env: 'dev' }

    for (const [titre, source] of Object.entries(TRANSITIONS)) {
      it(`runtime 'core', js 'bundle', production : ${titre} se construit`, async () => {
        const { errors } = await construire(CORE_BUNDLE_PROD, { 'hop.mjs': source, 'enfant.mjs': '<p>enfant</p>' })
        assert.deepEqual(errors, [], errors.join('\n'))
      })
    }

    it("runtime 'core', js 'split' : une transition hors de tout bloc se construit, le cœur porte le moteur et ses courbes", async () => {
      const { errors, outDir } = await construire(CORE_SPLIT_DEV, { 'hop.mjs': TRANSITIONS['@in=*fade hors de tout bloc'] })
      assert.deepEqual(errors, [], errors.join('\n'))
      const core = coeur(outDir)
      assert.ok(core.includes(MOTEUR), 'le cœur doit définir _mjs_whenLayouted')
      assert.ok(core.includes(COURBES), 'le cœur doit porter les courbes du même fichier')
    })

    it("runtime 'core', js 'split' : une transition dans un {if} trouve son moteur dans le cœur (la construction passait sans lui)", async () => {
      const { errors, outDir } = await construire(CORE_SPLIT_DEV, { 'hop.mjs': TRANSITIONS['@in=*fade dans un {if}'] })
      assert.deepEqual(errors, [], errors.join('\n'))
      assert.ok(coeur(outDir).includes(MOTEUR), 'le cœur doit définir _mjs_whenLayouted')
    })

    it("runtime ['router'], js 'split' : une transition hors de tout bloc se construit", async () => {
      const { errors } = await construire({ runtime: ['router'], js: 'split', env: 'dev' }, { 'hop.mjs': TRANSITIONS['@in=*fade hors de tout bloc'] })
      assert.deepEqual(errors, [], errors.join('\n'))
    })

    for (const [titre, source] of Object.entries(SANS_TRANSITION)) {
      it(`runtime 'core', js 'split' : ${titre} — le cœur ne porte ni le moteur ni les courbes`, async () => {
        const { errors, outDir } = await construire(CORE_SPLIT_DEV, { 'hop.mjs': source })
        assert.deepEqual(errors, [], errors.join('\n'))
        const core = coeur(outDir)
        assert.equal(core.includes(MOTEUR), false, 'le moteur des transitions ne doit pas entrer')
        assert.equal(core.includes(COURBES), false, 'les courbes ne doivent pas entrer')
      })
    }
  })
})
