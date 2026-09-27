// buildSsrHead (ssr-head.ts) : le cache de readAppThemeCss ignorait le thème demandé (2 appels sur
// le même manifeste, l'un en 'light' l'autre en 'dark', rendaient tous les deux le CSS du premier
// appel) et le marqueur cherché (« µ._themeCssByName = ») contenait des espaces figés autour du
// « = » — absents dès qu'un manifeste passe par une vraie transformation esbuild minifiée — rendant
// le CSS de thème introuvable en silence.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildSsrHead } from '../src/server/ssr-head.js'

describe('buildSsrHead — cache par thème et lecture robuste à la minification', function () {
  let root: string
  afterEach(function () { if (root) { try { rmSync(root, { recursive: true, force: true }) } finally { root = undefined as any } } })

  it('2 appels (light puis dark) sur le MÊME manifeste rendent chacun leur propre CSS', function () {
    root = mkdtempSync(join(tmpdir(), 'mjs-ssrhead-cache-'))
    const manifestPath = join(root, 'bundle.js')
    const src = `µ._themeCssByName = ${JSON.stringify({ light: 'BODY{color:white}', dark: 'BODY{color:black}' })};\n`
    writeFileSync(manifestPath, src, 'utf-8')
    const headLight = buildSsrHead({ defaultTheme: 'light', stylesheetsDir: 'nope' } as any, root, manifestPath)
    assert.match(headLight, /color:white/, `1er appel (light) : ${headLight}`)
    const headDark = buildSsrHead({ defaultTheme: 'dark', stylesheetsDir: 'nope' } as any, root, manifestPath)
    assert.match(headDark, /color:black/, `2e appel (dark, même manifeste) doit rendre SON PROPRE thème : ${headDark}`)
    assert.doesNotMatch(headDark, /color:white/, `le CSS "light" du 1er appel ne doit plus fuiter dans le 2e : ${headDark}`)
  })

  it('manifeste sans espace autour du "=" (minifié) : le CSS de thème est quand même trouvé', function () {
    root = mkdtempSync(join(tmpdir(), 'mjs-ssrhead-min-'))
    const manifestPath = join(root, 'bundle.js')
    // espaces retirés autour du "=", comme le ferait esbuild --minify.
    writeFileSync(manifestPath, `µ._themeCssByName=${JSON.stringify({ light: 'BODY{color:pink}' })};console.log(1);\n`, 'utf-8')
    const head = buildSsrHead({ defaultTheme: 'light', stylesheetsDir: 'nope' } as any, root, manifestPath)
    assert.match(head, /color:pink/, `le CSS de thème doit survivre à l'absence d'espaces autour du "=" : ${head}`)
  })

  it('clé JSON non quotée (forme JS minifiée valide, pas du JSON strict) : le CSS de thème est quand même trouvé', function () {
    root = mkdtempSync(join(tmpdir(), 'mjs-ssrhead-unquoted-'))
    const manifestPath = join(root, 'bundle.js')
    // esbuild --minify déquote les clés d'objet valides comme identifiants JS : {"light":...} → {light:...}.
    writeFileSync(manifestPath, `n._themeCssByName={light:"BODY{color:teal}"};console.log(1);\n`, 'utf-8')
    const head = buildSsrHead({ defaultTheme: 'light', stylesheetsDir: 'nope' } as any, root, manifestPath)
    assert.match(head, /color:teal/, `le CSS doit survivre à une clé NON quotée et à un récepteur qui n'est plus "µ" : ${head}`)
  })

  it('µ._themeCss (repli, préfixe de µ._themeCssByName) n\'est jamais confondu avec lui', function () {
    root = mkdtempSync(join(tmpdir(), 'mjs-ssrhead-prefixe-'))
    const manifestPath = join(root, 'bundle.js')
    // AUCUN thème nommé "absent" ne doit matcher : seul µ._themeCss (repli global) est présent ici.
    writeFileSync(manifestPath, `µ._themeCss = ${JSON.stringify('BODY{color:orange}')};\n`, 'utf-8')
    const head = buildSsrHead({ defaultTheme: 'absent', stylesheetsDir: 'nope' } as any, root, manifestPath)
    assert.match(head, /color:orange/, `le repli µ._themeCss doit être trouvé sans être confondu avec µ._themeCssByName : ${head}`)
  })
})
