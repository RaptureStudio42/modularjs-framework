// écriture profonde compilée (`$o.a.b.c = i`, `µ._mjs_deepSet`, mjs_deep.ts) dans une boucle chaude : V8 fond l'aide
// dans la boucle qui l'appelle seulement si son bytecode reste sous sa limite (`--max-inlined-bytecode-size`, 460
// octets) ; au-dessus, chaque écriture paie un appel et un tableau du chemin neuf — 1 000 000 d'écritures coûtaient
// 25 % de plus qu'en 2.5.0. Et `µ._mjs_toRaw` lit le symbole de la cible brute une seule fois par niveau : sur une
// enveloppe, chaque lecture passe par son piège `get`, payé à chaque écriture profonde. Seul le comportement se mesure
// ici, jamais la forme du code : la décision de V8 lue dans sa trace, les lectures du symbole comptées par un piège sur
// le runtime de développement tel que le construit le Bundler

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { transformSync } from 'esbuild'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const DEEP   = readFileSync(new URL('../src/runtime/mjs_deep.ts', import.meta.url), 'utf8')
const MOTEUR = `Node ${process.version}, V8 ${process.versions.v8}`

// un composant qui écrit en profondeur : de quoi construire le runtime de développement entier
const CIVET = `<script>
  $o = { a: { b: 0 } }
  @ecrire = -> $o.a.b = 1
</script>
<p>{$o.a.b}</p>
`

// runtime de développement construit par le Bundler, évalué dans une fenêtre happy-dom, `µ` exposé par son nom
async function runtimeDeDeveloppement(): Promise<any> {
  const root   = mjsTmp('deballage-une-lecture')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'ecriture-sonde.mjs'), CIVET)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler   = new Bundler(opts)
  const stats     = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')}\nglobalThis.µ = µ;`)
  return window.µ
}

// boucle chaude dans un Node à part (drapeaux de V8) : optimisée à la demande, sa trace dit si l'aide y est fondue
function traceInlining(code: string): string {
  const banc = `
    const µ = globalThis.µ = { _mjs_rawSet: new WeakSet(), warn() {}, _mjs_msg: (k, p, f) => f };
    µ._mjs_toRaw = function(o) { return o; };
    µ._mjs_rawIn = function(v) { return v; };
    µ._mjs_bumpEpoch = function() { return 1; };
    ${code}
    const el = { _state: { o: { a: { b: { c: 0 } } } }, _set() {}, _mjs_notifyMutationAliased() {} };
    function boucle(n) { for (let i = 0; i < n; i++) µ._mjs_deepSet(el, ['o', 'a', 'b', 'c'], i); }
    %PrepareFunctionForOptimization(boucle);
    boucle(500);
    boucle(500);
    %OptimizeFunctionOnNextCall(boucle);
    boucle(1);
    if (el._state.o.a.b.c !== 0) throw new Error('dernière valeur écrite : ' + el._state.o.a.b.c);
  `
  const r = spawnSync(process.execPath, ['--allow-natives-syntax', '--trace-turbo-inlining', '-e', banc], { encoding: 'utf8' })
  assert.equal(r.status, 0, `le banc de V8 n'a pas tourné (${MOTEUR}) : drapeau ou fonction native de V8 disparus, ou erreur ci-dessous — le test est alors à mettre à jour, l'aide n'est pas en cause\n${r.stderr}`)
  return r.stdout
}

describe('écriture profonde : aide fondue dans la boucle qui l\'appelle, enveloppe déballée en une lecture', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const minify of [false, true]) {
    it(`µ._mjs_deepSet est fondue (inlinée) par V8 dans une boucle chaude (${minify ? 'source minifiée' : 'source'})`, () => {
      const sortie = traceInlining(transformSync(DEEP, { loader: 'ts', format: 'cjs', minify }).code)
      // décisions de V8 qui nomment l'aide : « Inlining … into … », « Cannot consider … for inlining (reason: N) »
      const aide = sortie.split('\n').filter((l) => l.includes('<SharedFunctionInfo µ._mjs_deepSet>'))
      assert.ok(aide.length > 0, `la trace de V8 ne nomme pas µ._mjs_deepSet (${MOTEUR}) : le format de --trace-turbo-inlining a changé, le test est à mettre à jour — l'aide n'est pas en cause. Début de la trace :\n${sortie.split('\n').slice(0, 15).join('\n')}`)
      const refus = aide.find((l) => /reason: 5\b/.test(l))
      assert.equal(refus, undefined, `µ._mjs_deepSet dépasse la taille au-dessus de laquelle V8 n'inline plus (--max-inlined-bytecode-size) : sortez de l'aide le code des cas rares (cf. _mjsDeepChemin)\n${refus}`)
      assert.ok(aide.some((l) => /^Inlining .* into .*<SharedFunctionInfo boucle>/.test(l)), `V8 ne fond pas µ._mjs_deepSet dans la boucle (${MOTEUR}) :\n${aide.join('\n')}`)
    })
  }

  it('µ._mjs_toRaw lit le symbole une fois par niveau d\'enveloppe, et rend la cible brute (runtime de développement)', async () => {
    const µ = await runtimeDeDeveloppement()
    assert.equal(typeof µ._mjs_toRaw, 'function')
    assert.equal(typeof µ._mjs_RAW, 'symbol')
    let lectures = 0
    const brut = { a: 1 }
    const enveloppe = (cible: object) => new Proxy(cible, { get(o, k) { if (k === µ._mjs_RAW) { lectures++; return o; } return Reflect.get(o, k); } })
    assert.equal(µ._mjs_toRaw(enveloppe(brut)), brut)
    assert.equal(lectures, 1, 'lectures du symbole pour une enveloppe')
    lectures = 0
    assert.equal(µ._mjs_toRaw(enveloppe(enveloppe(brut))), brut)
    assert.equal(lectures, 2, 'lectures du symbole pour une enveloppe d\'enveloppe')
    lectures = 0
    assert.equal(µ._mjs_toRaw(brut), brut)
    for (const v of [null, undefined, 0, 'x', true]) assert.equal(µ._mjs_toRaw(v), v)
    assert.equal(lectures, 0)
  })
})
