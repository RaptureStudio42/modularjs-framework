// `mjs ws` / `mjs server` : une bibliothèque `.civet` importée par l'entrée serveur et qui se sert d'écritures de MJS est refusée comme
// le fait la construction, par les mêmes fonctions (bundler/index.ts) : toutes ses directives, chacune à sa ligne, dans l'ordre du
// fichier, les mêmes lignes que la construction du même fichier. Chaque sorte de motif que la construction peut citer a son texte, en
// français et en anglais. Une directive est une ligne que la lecture des directives de MJS lit (`@import`), ou une ligne de code qui
// commence sans retrait par une directive (`@css './s.css'`, cf. library-css-directive-refused-by-the-build-like-mjs-ws.test.ts)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { compileRawCivetFile } from '../src/cli/server-entry.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { getMessagesLang, setMessagesLang, t } from '../src/messages/index.js'

const LIBRARY = "@import a './a.civet'\n\n@import b './b.civet'\nx := 1\nexport default x\n"
const KINDS   = ['directive', 'mu', 'rune', 'hash', 'isnt', 'interpolation', 'for-in', 'assignment', 'dialect']

// les lignes de la liste des motifs d'un refus (`  - ligne 1 : …`)
const patternLines = (message: string): string[] => message.split('\n').filter(l => /^  - /.test(l))

// le refus du serveur pour cette bibliothèque
async function serverRefusal(): Promise<string> {
  const root = mjsTmp('ws-library-refusal')
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'lib', 'tools.civet'), LIBRARY)
  let message = ''
  await assert.rejects(compileRawCivetFile(join(root, 'lib', 'tools.civet'), root, true), (e: Error) => {
    message = e.message
    return true
  })
  return message
}

describe('mjs ws : the refusal of a .civet library that uses MJS writings names every directive with its line, like the build', function () {
  this.timeout(60000)
  const lang = getMessagesLang()

  after(() => {
    setMessagesLang(lang)
    terminateSharedWorkerPool()
  })

  it('two directives, lines 1 and 3: both named, each with its line', async () => {
    setMessagesLang('fr')
    const message = await serverRefusal()
    assert.match(message, /tools\.civet : ce fichier se sert d'écritures de MJS : nommez-le tools\.civet\.mjs/)
    assert.ok(message.includes("ligne 1 : la directive « @import a './a.civet' »"), message)
    assert.ok(message.includes("ligne 3 : la directive « @import b './b.civet' »"), message)
    assert.ok(message.indexOf('ligne 1 :') < message.indexOf('ligne 3 :'), message)
  })

  it('the same file in a build: the same patterns, on the same lines', async () => {
    setMessagesLang('fr')
    const server = patternLines(await serverRefusal())
    const root   = mjsTmp('ws-library-refusal-build')
    mkdirSync(join(root, 'src', 'lib'), { recursive: true })
    writeFileSync(join(root, 'src', 'lib', 'tools.civet'), LIBRARY)
    writeFileSync(join(root, 'src', 'app.mjs'), "<script>\n@import x './lib/tools.civet'\nload = -> $r = x\n</script>\n<p>{$r}</p>\n")
    const keep = [console.log, console.warn, console.error]
    console.log = console.warn = console.error = () => {}
    let errors: string[] = []
    try {
      const b: any  = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), minify: false } as any)
      const st: any = await b.compile()
      errors = (st.errors ?? []).map((e: any) => String(e?.message ?? e)).filter((e: string) => e.includes('tools.civet'))
    }
    finally {
      [console.log, console.warn, console.error] = keep
    }
    assert.equal(errors.length, 1, errors.join('\n') || 'aucune erreur de la construction')
    assert.equal(server.length, 2, server.join('\n'))
    assert.deepEqual(server, patternLines(errors[0]))
  })

  for (const l of ['fr', 'en']) {
    it(`every kind of pattern the build can name has its text (${l})`, () => {
      setMessagesLang(l)
      for (const kind of KINDS) {
        const text = t('bundler.index.library-pattern', { kind, line: 2, detail: 'x' })
        const rest = text.replace(/^(?:ligne 2 : |line 2: )/, '')
        assert.ok(rest.length > 0 && rest !== text && !/undefined/.test(rest), `${kind} : « ${text} »`)
      }
    })
  }
})
