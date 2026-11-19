// un `bundle.js` (le manifeste) qui est un lien vers un dossier : la construction le refuse par le message de l'aide commune des
// écritures, qui nomme le fichier et dit pourquoi, jamais par l'erreur brute du système (« EISDIR: illegal operation on a directory ») ;
// le lien et le dossier restent tels quels, en développement comme en production (manifeste d'un seul fichier)
import assert from 'node:assert/strict'
import { lstatSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('manifeste lien vers un dossier : message clair', function () {
  this.timeout(60000)

  after(async () => {
    setMessagesLang('fr')
    await terminateSharedWorkerPool()
  })

  const LANGUES = [['fr', /« [^»]*bundle\.js » n'est pas réécrit : c'est un lien vers le dossier/], ['en', /"[^"]*bundle\.js" is not rewritten: it is a link to the folder/]] as const
  for (const [lang, attendu] of LANGUES) for (const prod of [false, true]) {
    it(`${prod ? 'production (un seul fichier)' : 'développement'} : refusé par le message de l'aide commune (${lang}), lien et dossier intacts`, async () => {
      const root = mjsTmp('manifeste-lien-dossier')
      const src  = join(root, 'src')
      const out  = join(root, 'out')
      mkdirSync(src, { recursive: true })
      mkdirSync(out)
      mkdirSync(join(root, 'ailleurs'))
      symlinkSync(join(root, 'ailleurs'), join(out, 'bundle.js'))
      writeFileSync(join(src, 'page.mjs'), '<p>page</p>\n')
      setMessagesLang(lang)
      const garde = { warn: console.warn, log: console.log, error: console.error }
      console.warn = console.log = console.error = () => {}
      const messages: string[] = []
      try {
        const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), ...(prod ? { env: 'prod', js: 'bundle' } : { env: 'dev' }) } as any)
        try {
          const stats = await b.compile()
          messages.push(...stats.errors.map(e => e.message))
        }
        catch (e: any) {
          messages.push(String(e?.message ?? e))
        }
        finally {
          await b.close()
        }
      }
      finally {
        Object.assign(console, garde)
      }
      assert.ok(messages.some(m => attendu.test(m)), messages.join('\n'))
      assert.ok(!messages.some(m => /illegal operation on a directory/.test(m)), messages.join('\n'))
      assert.equal(lstatSync(join(out, 'bundle.js')).isSymbolicLink(), true)
      assert.deepEqual(readdirSync(join(root, 'ailleurs')), [])
    })
  }
})
