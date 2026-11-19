// Le script se lit d'un seul lecteur : une chaîne simple, double, à trois guillemets, un gabarit, une interpolation, une expression
// régulière (`/…/`, `///…///`) et un commentaire (`#`, `###…###`, `####`, `//`, `/* */`) gardent leur texte, sur une ligne comme sur
// plusieurs — `# deux`, `$total`, `&id`, `µajax(u)`, `µ$x`, `@x`, `//` et `###` n'y sont ni un commentaire ni réécrits, en Civet et en
// CoffeeScript, dans un composant comme dans un module `.civet.mjs` ou `.coffee.mjs` ; une interpolation `#{…}` d'une chaîne `"…"` de
// plusieurs lignes est interpolée ; le même texte écrit dans le code est réécrit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const Q = '\''

// ce que le texte garde, et ce qu'une réécriture y aurait mis
const GARDES   = ['# deux', '$total', '&id', 'µajax(u)', 'µ$x', '@x', '// x', '### trois']
const REECRITS = [/\$\.total/, /params\.id/, /_mjs_ajax/, /µ_state\.x/, /µ\$\.x/, /this\.x/, /\/\/ deux/]
const UNE      = '# deux $total &id µajax(u) µ$x @x // x ### trois'
const DEUX     = 'a\n  # deux $total &id µajax(u) µ$x @x // x\n  ### trois\n  b'

// chaque forme de chaîne : [nom, texte écrit, langues]
const CHAINES: Array<[string, string, string[]]> = [
  ['"…" sur une ligne', `"${UNE}"`, ['civet', 'coffee']],
  ['"…" sur plusieurs lignes', `"${DEUX}"`, ['civet', 'coffee']],
  [`${Q}…${Q} sur une ligne`, `${Q}${UNE}${Q}`, ['civet', 'coffee']],
  [`${Q}…${Q} sur plusieurs lignes`, `${Q}${DEUX}${Q}`, ['civet', 'coffee']],
  ['"""…""" sur plusieurs lignes', `"""\n  ${DEUX}\n"""`, ['civet', 'coffee']],
  [`${Q}${Q}${Q}…${Q}${Q}${Q} sur plusieurs lignes`, `${Q}${Q}${Q}\n  ${DEUX}\n${Q}${Q}${Q}`, ['civet', 'coffee']],
  ['gabarit sur une ligne', `\`${UNE}\``, ['civet']],
  ['gabarit sur plusieurs lignes', `\`${DEUX}\``, ['civet']],
  ['"…#{…}…" sur plusieurs lignes', `"#{1}\n  ${DEUX}"`, ['civet', 'coffee']]
]

// chaque forme lue comme une expression régulière : son texte garde ses `$`, `&`, `µ` et `@`
const REGEX: Array<[string, string, string[]]> = [
  ['/…/', '/a $total &id µajax(u) µ$x @x # deux ###/', ['civet', 'coffee']],
  ['///…/// sur plusieurs lignes', '///\n  a\n  $total &id µajax(u) µ$x @x\n///', ['civet', 'coffee']]
]

// chaque forme de commentaire : rien n'y est réécrit, le code de la ligne qui suit l'est
const COMMENTAIRES: Array<[string, string, string[]]> = [
  ['#', `# $total &id µajax(u) µ$x @x "${Q}`, ['civet', 'coffee']],
  ['###…### sur plusieurs lignes', `###\n  $total &id µajax(u) µ$x @x "${Q}\n###`, ['civet', 'coffee']],
  ['####', `#### $total &id µajax(u) µ$x @x "${Q}`, ['civet', 'coffee']],
  ['//', `// $total &id µajax(u) µ$x @x "${Q}`, ['civet']],
  ['/* */ sur plusieurs lignes', `/*\n  $total &id µajax(u) µ$x @x "${Q}\n*/`, ['civet']]
]

const ouvre = (lang: string): string => `<script${lang === 'civet' ? '' : ` lang="${lang}"`}>`

async function construire(lang: string, corps: string): Promise<string> {
  const e = console.error, w = console.warn
  console.error = console.warn = () => {}
  try {
    const r: any = await transpile(`<p>x</p>\n${ouvre(lang)}\n${corps}\n</script>\n`, { moduleName: 'Cas', defaultScriptLang: 'civet', templateLang: 'civet' })
    const avertis = (r.data.sectionWarnings as string[]).filter(l => /multilineString|µajax/.test(l))
    assert.deepEqual(avertis, [], 'aucun avertissement')
    return String(r.output)
  }
  finally {
    console.error = e
    console.warn = w
  }
}

describe('script : chaînes, expressions régulières et commentaires lus par un seul lecteur', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, texte, langues] of CHAINES) {
    for (const lang of langues) {
      it(`${lang}, chaîne ${nom} : son texte reste tel quel`, async () => {
        const out = await construire(lang, `s = ${texte}\nr = s`)
        for (const g of GARDES) assert.ok(out.includes(g), `« ${g} » gardé :\n${out.split('\n').filter(l => /deux|trois|total/.test(l)).join('\n')}`)
        for (const re of REECRITS) assert.doesNotMatch(out, re)
      })
    }
  }

  for (const [nom, texte, langues] of REGEX) {
    for (const lang of langues) {
      it(`${lang}, expression régulière ${nom} : son texte reste tel quel`, async () => {
        const out = await construire(lang, `re = ${texte}\nr = re`)
        for (const g of ['$total', '&id', 'µajax(u)', 'µ$x', '@x']) assert.ok(out.includes(g), `« ${g} » gardé :\n${out.split('\n').filter(l => /re =|total/.test(l)).join('\n')}`)
        for (const re of REECRITS) assert.doesNotMatch(out, re)
      })
    }
  }

  for (const [nom, texte, langues] of COMMENTAIRES) {
    for (const lang of langues) {
      it(`${lang}, commentaire ${nom} : rien n'y est réécrit, la ligne de code qui suit l'est`, async () => {
        const out = await construire(lang, `$total = 1\n${texte}\nt = [$total, &id, µajax(u), @x]`)
        assert.match(out, /params\.id/)
        assert.match(out, /_mjs_ajax\(u\)/)
        assert.match(out, /this\.x/)
        assert.doesNotMatch(out, /\[\$total/)
        assert.equal(out.split('params.id').length - 1, 1, 'seul &id du code est réécrit')
        assert.equal(out.split('_mjs_ajax(u)').length - 1, 1, 'seul µajax du code est réécrit')
      })
    }
  }

  for (const lang of ['civet', 'coffee']) {
    it(`${lang} : une interpolation #{…} d'une chaîne "…" sur plusieurs lignes est interpolée, son code réécrit`, async () => {
      const out = await construire(lang, '$n = 2\n$s = "un\n#{$n + 1} deux\ntrois"')
      assert.ok(out.includes('${$.n + 1} deux'), out.split('\n').filter(l => l.includes('trois')).join('\n'))
      assert.ok(!out.includes('#{'), 'aucun #{ laissé en texte')
    })

    it(`${lang} : le même texte écrit dans le code est réécrit`, async () => {
      const out = await construire(lang, `$total = 1\nµ$x = 2\nt = [$total, &id, µajax(u), µ$x, @x]`)
      assert.doesNotMatch(out, /\[\$total/)
      for (const re of [/params\.id/, /_mjs_ajax\(u\)/, /µ_state\.x/, /this\.x/]) assert.match(out, re)
    })
  }

  it('modules .civet.mjs et .coffee.mjs : une chaîne sur plusieurs lignes garde # deux, // et ###, µajax n\'y est pas réécrit, sans avertissement', async () => {
    const racine = mjsTmp('un-seul-lecteur')
    const src    = join(racine, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'textes.civet.mjs'), `export texte := "${DEUX}"\nexport simple := ${Q}${DEUX}${Q}\nexport lire := -> µajax(${Q}/v${Q})\n`)
    writeFileSync(join(src, 'outils.coffee.mjs'), `export texte2 = "${DEUX}"\nexport re2 = ///\n  a\n  µajax(u)\n///\n`)
    writeFileSync(join(src, 'fiche.mjs'), `<script>\n@import { texte simple lire } ${Q}textes.civet.mjs${Q}\n@import { texte2 re2 } ${Q}outils.coffee.mjs${Q}\n</script>\n<p>{texte} {simple} {texte2} {re2} {lire}</p>\n`)
    const b: any = new Bundler({ sourceDir: src, outputDir: join(racine, 'out'), manifestPath: join(racine, 'bundle.js'), minify: false } as any)
    const journal = [console.log, console.warn, console.error]
    console.log = console.warn = console.error = () => {}
    let st: any
    try {
      st = await b.compile()
    }
    finally {
      [console.log, console.warn, console.error] = journal
    }
    await b.close()
    assert.deepEqual((st.errors ?? []).map((e: any) => String(e?.message ?? e)), [])
    assert.deepEqual((st.warnings ?? []).map(String).filter((w: string) => /multilineString|µajax/.test(w)), [])
    for (const [nom, gardes] of [['textes-', ['# deux', '// x', '### trois', 'µajax(u)']], ['outils-', ['# deux', '// x', '### trois', 'µajax(u)']]] as const) {
      const fichier = readdirSync(join(racine, 'out')).find(f => f.startsWith(nom) && f.endsWith('.js'))!
      const out     = readFileSync(join(racine, 'out', fichier), 'utf8')
      for (const g of gardes) assert.ok(out.includes(g), `${nom} : « ${g} » gardé :\n${out}`)
      assert.doesNotMatch(out, /\/\/ deux|_mjs_ajax\(u\)/)
      assert.match(out, /_mjs_ajax\('\/v'\)|texte2/)
    }
  })
})
