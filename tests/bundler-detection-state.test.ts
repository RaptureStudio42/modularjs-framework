// mjs_state.ts (µ.state, objet réactif), détachée de mjs_runes.ts : le cœur n'en a pas besoin, seuls
// le code d'un projet qui écrit `µ.state(` ou `µ$x = …` et les modules optionnels qui s'en servent
// (contexte §§, routeur, store global, socket…) l'appellent. Absente d'un build qui n'en a pas l'usage,
// présente et fonctionnelle sinon ; faits inconnus (API directe) : gardée.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const MARK_STATE = 'µ.state = function'

async function construire(nom: string, conf: any, source: string): Promise<{ outDir: string, coeur: string, dossier: string }> {
  const root = mjsTmp('detect-state-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...conf } as any)
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const coeurFichier = readdirSync(outDir).find((f) => /^mjs_core-/.test(f))
  assert.ok(coeurFichier, 'mjs_core-*.js doit exister')
  return { outDir, dossier: outDir, coeur: readFileSync(join(outDir, coeurFichier!), 'utf-8') }
}

describe('mjs_state.ts — détaché du cœur, build RÉEL', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('composant qui ne parle jamais de state : ABSENT', async () => {
    const { coeur } = await construire('nu', { runtime: 'core' }, '<p>x</p>')
    assert.equal(coeur.includes(MARK_STATE), false)
  })

  it('composant qui écrit µ.state(…) : PRÉSENT, et l\'objet réagit', async () => {
    const { outDir, coeur } = await construire('actif', { runtime: 'core' }, ['<script>', '@todos = µ.state({list: []})', '</script>', '<p class="n">{@todos.list.length}</p>'].join('\n'))
    assert.ok(coeur.includes(MARK_STATE))
    const fichiers = readdirSync(outDir)
    const composant = fichiers.find((f) => /^hote-/.test(f))!
    const retire = (s: string) => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '').replace(/\bexport\s+default\s+/g, '').replace(/\bexport\s+/g, '').replace(/import\.meta\.url/g, "'http://localhost/'")
    const fenetre: any = new Window({ url: 'http://localhost/' })
    const coeurFichier = fichiers.find((f) => /^mjs_core-/.test(f))!
    fenetre.eval(`${retire(readFileSync(join(outDir, coeurFichier), 'utf-8'))}\nglobalThis.µ = µ;\n${retire(readFileSync(join(outDir, composant), 'utf-8'))}`)
    fenetre.document.body.innerHTML = '<mjs-hote></mjs-hote>'
    const el: any = fenetre.document.body.firstElementChild
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(el._shadow.querySelector('.n').textContent.trim(), '0')
    el.todos.list.push('a')
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(el._shadow.querySelector('.n').textContent.trim(), '1')
  })

  it('runtime: [\'state\'] : PRÉSENT sans composant qui l\'écrive', async () => {
    const { coeur } = await construire('force', { runtime: ['state'] }, '<p>x</p>')
    assert.ok(coeur.includes(MARK_STATE))
  })

  it('contexte réactif §§ : PRÉSENT (µ._mjs_setRCtx appelle µ.state sans garde)', async () => {
    const { coeur } = await construire('ctx', { runtime: 'core' }, ['<script>', '§§theme = \'clair\'', '</script>', '<p>{§§theme}</p>'].join('\n'))
    assert.ok(coeur.includes(MARK_STATE))
  })

  describe('API directe (resolveRuntimeFiles)', () => {
    it('faits inconnus : gardé', () => {
      assert.ok(new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles().files.includes('mjs_state.ts'))
    })

    it('faits connus sans signal : absent en core, présent en all (le routeur et les autres modules optionnels l\'appellent)', () => {
      assert.equal(new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles(new Set()).files.includes('mjs_state.ts'), false)
      assert.equal(new Bundler({ runtime: 'all' } as any).resolveRuntimeFiles(new Set()).files.includes('mjs_state.ts'), true)
    })

    it('le signal state le rend ; il suit mjs_runes.ts', () => {
      const { files } = new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles(new Set(['state']))
      assert.ok(files.includes('mjs_state.ts'))
      assert.ok(files.indexOf('mjs_state.ts') > files.indexOf('mjs_runes.ts'))
    })

    for (const fichier of ['router', 'smooth', 'socket', 'game', 'chat', 'lobby', 'accounts', 'interp', 'predict', 'lockstep', 'vault']) {
      it(`${fichier} sélectionné : mjs_state.ts le suit (il appelle µ.state)`, () => {
        const { files } = new Bundler({ runtime: [fichier] } as any).resolveRuntimeFiles(new Set())
        assert.ok(files.includes('mjs_state.ts'))
      })
    }

    it('le signal context le rend', () => {
      assert.ok(new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles(new Set(['context'])).files.includes('mjs_state.ts'))
    })

    it('le signal lang (module cœur à libellé → store global) le rend', () => {
      assert.ok(new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles(new Set(['lang'])).files.includes('mjs_state.ts'))
    })
  })
})
