// µ échappé dans le code compilé (`\u00B5` pour `µ`, qu'un `<script lang="ts">` écrit en clair) : le repère de l'appel direct, le choix des
// modules du cœur et les clés du magasin global lisent aussi cette forme et les autres échappements valides (`\u00b5`, `\u{B5}`, `\u{b5}`).
// Les fonctions que le compilateur écrit pour un `switch`, un `try` ou un `do` dans une expression sont transparentes pour la règle de
// l'appel direct ; une boucle, une flèche écrite à la main restent des frontières

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures, optionalSignal, I18N_USED, OPAQUE_MU } from '../src/bundler/features.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const civet = (corps: string) => `<script>\n  $q = 'a'\n  $m = 'a'\n  $ids = [1]\n  ${corps}\n</script>\n<b>{$q}</b>\n`
// les repères posés, dans l'ordre : `=` l'appel garde la donnée d'avant, `*` jamais
const reperes = (sortie: string): string[] => [...sortie.matchAll(/(?:µ|\\u00B5)\??\.load\([^;\n]*?'(\*?)[0-9a-f]{4}\.(\d+)'\)/g)].map((m) => (m[1] ? '*' : '=') + m[2])
const repereDe = async (source: string, nom: string): Promise<string[]> => reperes((await transpile(source, { moduleName: nom })).output)

describe('µload : µ échappé du code compilé (script TypeScript) et enveloppes du compilateur', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('repère de l\'appel direct', () => {
    it('script TypeScript : l\'appel écrit dans la dérivée, compilé en `µ.load(`, reçoit son repère sans `*`', async () => {
      const sortie = (await transpile(`<script lang="ts">\n  $q = 'a'\n  $r = µload(\`/api/s?q=\${$q}\`)\n</script>\n<b>{$q}</b>\n`, { moduleName: 'essai-ts' })).output
      assert.match(sortie, /µ\.load\(`\/api\/s\?q=\$\{\$\.q\}`,null,'[0-9a-f]{4}\.0'\)/, sortie.split('\n').filter((l: string) => /load\(/.test(l)).join('\n'))
    })

    it('script TypeScript : un appel fait dans une aide garde son `*`', async () => {
      assert.deepEqual(await repereDe(`<script lang="ts">\n  $q = 'a'\n  const aide = (q: string) => µload(\`/api/s?q=\${q}\`)\n  $r = aide($q)\n</script>\n<b>{$q}</b>\n`, 'essai-ts-aide'), ['*0'])
    })

    it('`(switch …)?.data`, `(try … catch then null)?.data`, `(do …)?.data` dans l\'expression : appel direct', async () => {
      assert.deepEqual(await repereDe(civet(`$r = (switch $m\n    when 'a' then µload("/api/a?q=#{$q}")\n    else µload("/api/b?q=#{$q}"))?.data?.n`), 'essai-switch'), ['=0', '=1'])
      assert.deepEqual(await repereDe(civet(`$r = (try µload("/api/s?q=#{$q}") catch then null)?.data?.n`), 'essai-try'), ['=0'])
      assert.deepEqual(await repereDe(civet(`$r = (do\n    u = "/api/s?q=#{$q}"\n    µload(u))?.data?.n`), 'essai-do'), ['=0'])
    })

    it('`switch` et `try` sans parenthèses : appel direct ; `$r = do …`, entre parenthèses ou non, n\'est pas une dérivée', async () => {
      assert.deepEqual(await repereDe(civet(`$r = switch $m\n    when 'a' then µload("/api/a?q=#{$q}")\n    else null`), 'essai-switch-nu'), ['=0'])
      assert.deepEqual(await repereDe(civet(`$r = try µload("/api/s?q=#{$q}") catch then null`), 'essai-try-nu'), ['=0'])
      for (const forme of [`$r = do\n    u = "/api/s?q=#{$q}"\n    µload(u)`, `$r = (do\n    u = "/api/s?q=#{$q}"\n    µload(u))`]) {
        const sortie = (await transpile(civet(forme), { moduleName: 'essai-do-nu' })).output
        assert.deepEqual(reperes(sortie), ['*0'], forme)
        assert.doesNotMatch(sortie, /_mjs_setComputed\(_mjsThis, 'r'/, forme)
      }
    })

    it('`try` avec `await` dans l\'expression (enveloppe asynchrone du compilateur) : appel direct', async () => {
      assert.deepEqual(await repereDe(civet(`$r = (try await µload("/api/s?q=#{$q}") catch then null)?.data`), 'essai-try-await'), ['=0'])
    })

    it('une boucle dans l\'enveloppe (compréhension) et une flèche écrite à la main appelée aussitôt gardent leur `*`', async () => {
      assert.deepEqual(await repereDe(civet(`$r = (µload("/api/f/#{i}") for i of $ids)`), 'essai-compr'), ['*0'])
      assert.deepEqual(await repereDe(`<script lang="js">\n  $q = 'a'\n  $r = (() => { return µload(\`/api/s?q=\${$q}\`) })()\n</script>\n<b>{$q}</b>\n`, 'essai-fleche-js'), ['*0'])
    })
  })

  describe('choix des modules du cœur', () => {
    for (const forme of ['\\u00B5', '\\u00b5', '\\u{B5}', '\\u{b5}', '\\u{00B5}']) {
      it(`\`${forme}.load(\` réclame le magasin chargé`, () => {
        assert.ok(scanCompiledFeatures(`const r = ${forme}.load('/api/s');`).has('load'), forme)
      })
    }

    const cas: [string, string][] = [
      ['\\u00B5.effect(() => 1);', 'effect'],
      ['\\u00B5.every(1e3, () => 1);', 'every'],
      ['const s = new \\u00B5.Store({});', 'store'],
      ['\\u00B5.inspect("q");', 'inspect'],
      ['const t = \\u00B5.t("accueil.titre");', I18N_USED],
      ['\\u00B5.ajax.get("/x");', optionalSignal('ajax')],
      ['\\u00B5.modal.open("m");', optionalSignal('modal')],
      ['const p = \\u00B5.store.panier;', optionalSignal('vault')],
      ['const k = \\u00B5.anim.fadeIn;', optionalSignal('easing')],
      ['const w = \\u00B5.socket("/w");', optionalSignal('socket')],
      ['const f = \\u00B5[nom];', OPAQUE_MU],
    ]
    for (const [code, signal] of cas) {
      it(`\`${code}\` → ${signal}, comme en clair`, () => {
        const echappe = scanCompiledFeatures(code)
        assert.ok(echappe.has(signal), [...echappe].join(','))
        assert.deepEqual([...echappe].sort(), [...scanCompiledFeatures(code.replace('\\u00B5', 'µ'))].sort())
      })
    }
  })

  it('magasin global lu dans un script TypeScript : la clé est déclarée comme en Civet', async () => {
    const ts = (await transpile(`<script lang="ts">\n  $v = $$panier + 1\n</script>\n<b>{$v}</b>\n`, { moduleName: 'essai-magasin' })).output
    assert.match(ts, /µ\._storeDeclare\(\["panier"\]\)/)
  })

  for (const env of ['dev', 'prod'] as const) {
    it(`appli dont le seul µload est dans un script TypeScript (${env}) : le module du magasin chargé est joint`, async () => {
      const racine = mjsTmp('load-script-ts-seul-' + env)
      const src    = join(racine, 'src')
      const out    = join(racine, 'out')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'tts.mjs'), `<script lang="ts">\n  $q = 'a'\n  $r = µload(\`/api/h/ts?q=\${$q}\`)\n</script>\n<b>{$r.data?.n || 'att'}</b>\n`)
      const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(env === 'prod' ? out : racine, 'bundle.js'), env, js: 'split', urlPrefix: '/out' } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [])
      const lire = (d: string): string => readdirSync(d, { withFileTypes: true }).map((f) => f.isDirectory() ? lire(join(d, f.name)) : (f.name.endsWith('.js') ? readFileSync(join(d, f.name), 'utf-8') : '')).join('\n')
      const js   = lire(out) + (env === 'dev' ? lire(racine) : '')
      assert.match(js, /_mjsLdEntries|MjsLoad|_mjs_ldG|\.load=function/, 'module du magasin chargé absent')
    })
  }
})
