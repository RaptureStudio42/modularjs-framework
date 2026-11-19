// µajax écrit dans une chaîne écrite dans une interpolation `#{…}` (CoffeeScript, Civet), un texte que la construction lit comme du
// code, y devient µ._mjs_ajax : la construction le dit, à sa ligne et sa colonne du fichier, en développement comme en production.
// Une regex étendue `///…///` et une chaîne écrites sur plusieurs lignes, une chaîne simple, un commentaire, un gabarit JavaScript
// gardent leur texte, sans avertissement ; un vrai appel écrit dans `#{…}` ou `${…}` reste un appel, sans avertissement ; un module
// importé est averti de même, à sa ligne

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const Q = "'"

// `Cas.mjs` : son gabarit (ligne 1), son <script> (ligne 2), le code écrit en retrait de deux espaces à partir de la ligne 3 ;
// `module` : un <script module> avant le gabarit
function fichier(lang: string, lignes: string[], module: string[] = []): string {
  const ouvre = `<script${lang === 'civet' ? '' : ` lang="${lang}"`}`
  const tete  = module.length > 0 ? [`${ouvre} module>`, ...module.map(l => '  ' + l), '</script>'] : []
  return [...tete, '<p>x</p>', `${ouvre}>`, ...lignes.map(l => '  ' + l), '</script>', ''].join('\n')
}

// la place `Cas.mjs:ligne:colonne` du n-ième `µajax` (à partir de 1) écrit sur la ligne qui contient `repere`
function place(src: string, repere: string, n = 1): string {
  const lignes = src.split('\n')
  const i      = lignes.findIndex(l => l.includes(repere))
  let col = -1
  for (let k = 0; k < n; k++) col = lignes[i].indexOf('µajax', col + 1)
  return `Cas.mjs:${i + 1}:${col + 1}`
}

async function compiler(src: string, dev: boolean): Promise<{ sortie: string, avertis: string[] }> {
  const r = await transpile(src, { moduleName: 'Cas', defaultScriptLang: 'civet', templateLang: 'civet', devWarnings: dev, typesText: dev })
  return { sortie: String(r.output), avertis: (r.data.sectionWarnings as string[]).filter(w => w.includes('µajax')) }
}

const MODES = [['développement', true], ['production', false]] as const

describe('µajax écrit dans un texte lu comme du code : la construction le dit, à sa place', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const lang of ['civet', 'coffee']) {
    for (const [mode, dev] of MODES) {
      it(`${lang}, ${mode} : regex étendue sur plusieurs lignes — son µajax reste du texte, sans avertissement ; l'appel voisin reste un appel`, async () => {
        const src = fichier(lang, ['re = ///', '  a', `  µajax ${Q}/u${Q}`, '///', `r = µajax ${Q}/v${Q}`])
        const { sortie, avertis } = await compiler(src, dev)
        assert.deepEqual(avertis, [])
        assert.equal(sortie.split('_mjs_ajax').length - 1, 1, 'seul le vrai appel est réécrit')
        assert.match(sortie, /µ\._mjs_ajax\('\/v'\)/)
      })

      it(`${lang}, ${mode} : chaîne écrite dans une interpolation — averti à sa place`, async () => {
        const src = fichier(lang, ['f = (x) -> x', `s = "a #{ f("µajax ${Q}/u${Q}") } b"`, `r = µajax ${Q}/v${Q}`])
        const { avertis } = await compiler(src, dev)
        assert.deepEqual(avertis.map(w => w.includes(place(src, `µajax ${Q}/u`))), [true], avertis.join('\n'))
      })

      it(`${lang}, ${mode} : chaîne sur deux lignes — son µajax reste du texte, sans avertissement`, async () => {
        const src = fichier(lang, ['s = "a', `  µajax ${Q}/u${Q}"`, `r = µajax ${Q}/v${Q}`])
        const { sortie, avertis } = await compiler(src, dev)
        assert.deepEqual(avertis, [])
        assert.ok(sortie.includes(`µajax ${Q}/u${Q}`), sortie)
      })

      it(`${lang}, ${mode} : deux µajax dans la même regex étendue — du texte, sans avertissement`, async () => {
        const src = fichier(lang, ['re = ///', `  µajax ${Q}/u${Q} | µajax ${Q}/w${Q}`, '///', `r = µajax ${Q}/v${Q}`])
        const { sortie, avertis } = await compiler(src, dev)
        assert.deepEqual(avertis, [])
        assert.equal(sortie.split('_mjs_ajax').length - 1, 1, 'seul le vrai appel est réécrit')
      })

      it(`${lang}, ${mode} : appel dans le <script module>, regex étendue dans le <script> — sans avertissement`, async () => {
        const src = fichier(lang, ['re = ///', `  µajax ${Q}/u${Q}`, '///'], [`charger = -> µajax ${Q}/m${Q}`])
        const { avertis } = await compiler(src, dev)
        assert.deepEqual(avertis, [])
      })

      it(`${lang}, ${mode} : chaîne simple et commentaire gardent leur texte, sans avertissement`, async () => {
        const src = fichier(lang, [`s = "voir µajax ${Q}/u${Q}"`, `# µajax ${Q}/c${Q}`, `r = µajax ${Q}/v${Q}`])
        const { sortie, avertis } = await compiler(src, dev)
        assert.deepEqual(avertis, [])
        assert.ok(sortie.includes(`"voir µajax ${Q}/u${Q}"`), sortie)
        assert.equal(sortie.split('_mjs_ajax').length - 1, 1, 'seul le vrai appel est réécrit')
      })

      it(`${lang}, ${mode} : un vrai appel écrit dans #{…} reste un appel, sans avertissement`, async () => {
        const src = fichier(lang, [`g = -> "a #{ await µajax ${Q}/u${Q} } b"`, `r = µajax ${Q}/v${Q}`])
        const { sortie, avertis } = await compiler(src, dev)
        assert.deepEqual(avertis, [])
        assert.match(sortie, /µ\.(?:_mjs_)?ajax\('\/u'\)/)
      })
    }
  }

  for (const [mode, dev] of MODES) {
    it(`js, ${mode} : gabarit à chaîne imbriquée, chaîne simple, commentaire — aucun µ._mjs_ajax dans un texte, sans avertissement ; l'appel dans \${…} reste un appel`, async () => {
      const src = fichier('js', ['const f = (x) => x', `const s = \`a \${ f("µajax ${Q}/u${Q}") } b\``, `const t = "voir µajax ${Q}/t${Q}"`, `// µajax ${Q}/c${Q}`, `const g = async () => \`a \${ await µajax(${Q}/g${Q}) } b\``, `const r = µajax(${Q}/v${Q})`])
      const { sortie, avertis } = await compiler(src, dev)
      assert.deepEqual(avertis, [])
      assert.ok(sortie.includes(`"voir µajax ${Q}/t${Q}"`), sortie)
      assert.doesNotMatch(sortie, /_mjs_ajax ['/]/)
      assert.match(sortie, /µ\.(?:_mjs_)?ajax\('\/g'\)/)
      assert.match(sortie, /µ\._mjs_ajax\('\/v'\)/)
    })
  }

  // CoffeeScript écrit une propriété de classe après les méthodes : le rang d'un `_mjs_ajax` dans le code produit n'y dit plus sa
  // réécriture, la carte le dément — ils se rangent alors dans l'ordre des lignes qu'elle donne, jamais à la place d'un vrai appel
  for (const [mode, dev] of MODES) {
    it(`coffee, ${mode} : regex étendue d'une propriété de classe, écrite après la méthode qui appelle µajax — du texte, sans avertissement`, async () => {
      for (const lignes of [['class A', '  re: ///', `    µajax ${Q}/u${Q}`, '  ///', `  m: -> µajax ${Q}/v${Q}`], ['class A', `  @s = µajax ${Q}/w${Q}`, '  re: ///', `    µajax ${Q}/u${Q}`, '  ///', `  m: -> µajax ${Q}/v${Q}`]]) {
        const src = fichier('coffee', lignes)
        const { sortie, avertis } = await compiler(src, dev)
        assert.deepEqual(avertis, [])
        assert.match(sortie, /µ\._mjs_ajax\('\/v'\)/)
      }
    })
  }

  // `_mjs_ajax` écrit par l'auteur lui-même dans un texte : son texte, sans avertissement
  for (const lang of ['civet', 'coffee']) {
    for (const [mode, dev] of MODES) {
      it(`${lang}, ${mode} : « µ._mjs_ajax » écrit dans une chaîne par l'auteur, à côté d'un vrai appel — sans avertissement`, async () => {
        const { avertis } = await compiler(fichier(lang, [`s = ${Q}voir µ._mjs_ajax${Q}`, `r = µajax ${Q}/v${Q}`]), dev)
        assert.deepEqual(avertis, [])
      })
    }
  }

  // un module importé : averti à sa ligne et sa colonne, dans les avertissements de la construction
  async function construire(fichiers: Record<string, string>, dev: boolean): Promise<string[]> {
    const racine = mkdtempSync(join(tmpdir(), 'ajax-texte-'))
    try {
      const src = join(racine, 'src')
      mkdirSync(src, { recursive: true })
      for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(src, nom), texte)
      const b: any = new Bundler({ sourceDir: src, outputDir: join(racine, 'out'), manifestPath: join(racine, 'bundle.js'), minify: false } as any)
      b.envMode = dev ? 'dev' : 'prod'
      const journal = [console.log, console.warn, console.error]
      console.log = console.warn = console.error = () => {}
      let st: any
      try {
        st = await b.compile()
      }
      finally {
        [console.log, console.warn, console.error] = journal
      }
      assert.deepEqual((st.errors ?? []).map((e: any) => String(e?.message ?? e)), [])
      return (st.warnings ?? []).map(String).filter((w: string) => w.includes('µajax'))
    }
    finally {
      rmSync(racine, { recursive: true, force: true })
    }
  }

  for (const [mode, dev] of MODES) {
    it(`module .coffee.mjs et .civet.mjs importés, ${mode} : chaîne d'interpolation avertie à sa place, regex étendue sans avertissement`, async () => {
      const coffee  = ['export charger = -> µajax ' + `${Q}/v${Q}`, 'export re = ///', `  µajax ${Q}/u${Q}`, '///'].join('\n')
      const civet   = ['f = (x) -> x', `export s = "a #{ f("µajax ${Q}/w${Q}") } b"`, `export lire = -> µajax ${Q}/x${Q}`].join('\n')
      const avertis = await construire({ 'outils.coffee.mjs': coffee + '\n', 'textes.civet.mjs': civet + '\n', 'alpha.mjs': `<script>\n@import { charger re } 'outils.coffee.mjs'\n@import { s lire } 'textes.civet.mjs'\nload = -> $r = await charger()\n</script>\n<p>{$r} {s} {re} {lire}</p>\n` }, dev)
      assert.equal(avertis.length, 1, avertis.join('\n'))
      assert.ok(avertis.some((w: string) => w.includes(`textes.civet.mjs:2:${civet.split('\n')[1].indexOf('µajax') + 1}`)), avertis.join('\n'))
    })

    it(`module .coffee.mjs importé, ${mode} : propriété de classe ///…/// écrite après la méthode qui appelle µajax — sans avertissement`, async () => {
      const classe  = ['export class A', '  re: ///', `    µajax ${Q}/u${Q}`, '  ///', `  m: -> µajax ${Q}/v${Q}`].join('\n')
      const avertis = await construire({ 'classe.coffee.mjs': classe + '\n', 'gamma.mjs': `<script>\n@import { A } 'classe.coffee.mjs'\nload = -> $r = await new A().m()\n</script>\n<p>{$r}</p>\n` }, dev)
      assert.deepEqual(avertis, [])
    })
  }
})
