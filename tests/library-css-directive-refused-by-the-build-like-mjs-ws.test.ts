// Une bibliothèque `.civet` qui écrit `@css './s.css'` sans aucun `@import` : la lecture des directives ne blanchit que les `@import`,
// Civet lit cette ligne `this.css('./s.css')`, qui casse au chargement de la page. La construction la refuse, comme `mjs ws`, avec le
// même message : chaque directive, à sa ligne. Une ligne en retrait (`@display 'block'` dans une fonction) est du code : la
// construction la laisse passer

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { compileRawCivetFile } from '../src/cli/server-entry.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { getMessagesLang, setMessagesLang } from '../src/messages/index.js'

const LIBRARY = "x := 1\n@css './s.css'\nexport default x\n"
const METHOD  = "show := ->\n  @display 'block'\nexport default show\n"

// les lignes de la liste des motifs d'un refus (`  - ligne 2 : …`)
const patternLines = (message: string): string[] => message.split('\n').filter(l => /^  - /.test(l))

// le refus du serveur pour cette bibliothèque
async function serverRefusal(source: string): Promise<string> {
  const root = mjsTmp('library-css-refusal-ws')
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'lib', 'tools.civet'), source)
  let message = ''
  await assert.rejects(compileRawCivetFile(join(root, 'lib', 'tools.civet'), root, true), (e: Error) => {
    message = e.message
    return true
  })
  return message
}

// les erreurs de la construction qui nomment la bibliothèque
async function buildErrors(source: string): Promise<string[]> {
  const root = mjsTmp('library-css-refusal-build')
  mkdirSync(join(root, 'src', 'lib'), { recursive: true })
  writeFileSync(join(root, 'src', 'lib', 'tools.civet'), source)
  writeFileSync(join(root, 'src', 'app.mjs'), "<script>\n@import x './lib/tools.civet'\nload = -> $r = x\n</script>\n<p>{$r}</p>\n")
  const keep = [console.log, console.warn, console.error]
  console.log = console.warn = console.error = () => {}
  try {
    const b: any  = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), minify: false } as any)
    const st: any = await b.compile()
    return (st.errors ?? []).map((e: any) => String(e?.message ?? e)).filter((e: string) => e.includes('tools.civet'))
  }
  finally {
    [console.log, console.warn, console.error] = keep
  }
}

describe('a .civet library that writes @css without any @import: the build refuses it like mjs ws, each directive with its line', function () {
  this.timeout(60000)
  const lang = getMessagesLang()

  after(() => {
    setMessagesLang(lang)
    terminateSharedWorkerPool()
  })

  it('mjs ws names the directive with its line', async () => {
    setMessagesLang('fr')
    const message = await serverRefusal(LIBRARY)
    assert.match(message, /tools\.civet : ce fichier se sert d'écritures de MJS : nommez-le tools\.civet\.mjs/)
    assert.deepEqual(patternLines(message), ["  - ligne 2 : la directive « @css './s.css' »"])
  })

  it('the build refuses the same file, with the same patterns on the same lines', async () => {
    setMessagesLang('fr')
    const server = patternLines(await serverRefusal(LIBRARY))
    const errors = await buildErrors(LIBRARY)
    assert.equal(errors.length, 1, errors.join('\n') || 'aucune erreur de la construction')
    assert.deepEqual(patternLines(errors[0]), server)
  })

  it('an indented @display in a function is code: the build lets it through', async () => {
    setMessagesLang('fr')
    assert.deepEqual(await buildErrors(METHOD), [])
  })
})
