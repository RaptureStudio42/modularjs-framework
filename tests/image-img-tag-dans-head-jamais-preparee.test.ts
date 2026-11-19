// une <@@img> écrite dans un <@head> n'est jamais préparée : la construction la refuse (l'en-tête du document ne s'affiche jamais) et ce
// refus, cité à sa ligne, reste l'erreur. Le relevé des images la préparait avant le refus : son image était copiée pour rien, et un
// fichier absent arrêtait la construction sur « fichier introuvable » au lieu du refus. Bloc simple, et blocs où une section posée en
// milieu de ligne (`<vars>`, `<types>`, `<routes>`), un `</style>` cité dans un commentaire Sass ou une fermante citée dans une chaîne
// pourraient égarer le relevé ; image de l'exemple présente puis absente. Les images écrites hors du <@head> restent préparées. Un
// <@head> se lit comme le reste du gabarit : la fermante d'une section posée en milieu de ligne y est orpheline, avec le refus du reste
// du gabarit, et l'image seulement citée dans son texte n'y est pas refusée comme une image de l'en-tête

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

// nom, langue d'un <script> sans `lang`, ligne citée par le refus, texte du composant ; l'image citée dans le <@head> se nomme `e<n>.png`
const CAS: Array<[string, string, number, string]> = [
  ['simple', 'civet', 3, '<@head>\n  <title>t</title>\n  <@@img src="e0.png" alt="x">\n</@head>\n<@@img src="z1.png" alt="x">\n'],
  ['2026-ts', 'ts', 14, '<p>t</p>\n<p title="<script>">t</p>\n<p title="-->">t</p>\r<textarea>\n<script lang="coffee">\n  fin = \'</script >\'\n  q = \'a <script>\'\n  u = \'\\\'</script>\'\n</script>\n</textarea>\n<@head>\n<p>a</p> <vars>\n  a: 1\n  d: \'<@@img src="e0.png" alt="x">\'\n  a: 1\n</vars>\n</@head><!-- c -->\n<@@img src="z1.png" alt="x">\n'],
  ['31337-coffee', 'coffee', 13, '<div title=\'\r<p>a</p>\r<theme>\r  c: \'{\'\r</theme>\r\'>t</div> <p title="<script>">t</p>\r<!-- <@@img src="c0.png" alt="x"> --><style lang="sass">\r  // fin </style> ici\r  // <@@img src="e1.png" alt="x">\r</style>\r<@head>\r<p>a</p><types>\r  d: \'<@@img src="e2.png" alt="x">\'\r</types>\r</@head>\r<@@img src="z3.png" alt="x">\r'],
  ['31337-ts', 'ts', 4, '<p title="<script>">t</p>\n<@head>\n<p>a</p> <routes target="main">\n  d: \'<@@img src="e0.png" alt="x">\'\n  a: 1\n  f: \'</script>\'\n</routes>\n</@head><@@img src="z1.png" alt="x">\n'],
  ['31337-civet', 'civet', 5, '<p title="<script>">t</p>\n<@head>\n<div><vars>\n  e: \'</textarea>\'\n  d: \'<@@img src="e0.png" alt="x">\'\n</vars>\n</@head>\n<p>"</p>\r\n{ f("\n  <script lang="coffee">\n  d = \'<!--\'\n</script>\n") } <@@img src="z1.png" alt="x">\n'],
  ['31337-js', 'js', 18, '<p>a</p> <style>\n  /* </style> */\n</style>\r\n<p title=\'<@@img src="a0.png" alt="x">\'>t</p>\n<div>\n<!-- a --> <!-- b --><script lang="coffee">\n  fin = \'</script>\'\n  fin = \'</script>\'\n  a = \'{\'\n</script>\n</div>\n<@@img src="t1.png" alt="x">\n<p title="<script>">t</p>\n<@@img src="t2.png" alt="x">\n<@head>\nx <style lang="sass">\n  // fin </style> ici\n  // <@@img src="e3.png" alt="x">\n  a\n    content: \'</style >\'\n</style>\n</@head>\r<@@img src="z4.png" alt="x">\n'],
  ['4242-civet', 'civet', 14, '<div><@@img src="t0.png" alt="x"></div>\n<p>"</p>\r\n<p>a {b} c</p><p title="<!--">t</p>\n<title>\n<!-- <@@img src="c1.png" alt="x"> --><script lang="js">\n  a = \'{\'\n  // voir </script>\n  /* </script> */\n</script>\n</title>\n<@head>\n<!-- c --><vars>\n  b: \'</vars >\'\n  d: \'<@@img src="e2.png" alt="x">\'\n</vars>\n</@head>\r\n<@@img src="z3.png" alt="x">\n']
]

// les cas dont le <@head> porte une fermante orpheline (section ouverte en milieu de ligne, U+2028 et U+2029 compris) : le refus du
// reste du gabarit
const ORPHELINE: Record<string, string> = { '2026-ts': '</vars>', '31337-coffee': '</types>', '31337-ts': '</routes>', '31337-civet': '</vars>' }

describe('<@@img> dans un <@head> : jamais préparée, le refus reste l\'erreur', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, langue, ligne, texte] of CAS) {
    for (const present of [true, false]) {
      it(`${nom}, image ${present ? 'présente' : 'absente'}`, async () => {
        const root = mjsTmp('img-tete')
        const src  = join(root, 'src')
        const out  = join(root, 'out')
        mkdirSync(src, { recursive: true })
        for (const f of new Set(texte.match(/[a-z]\d\.png/g) ?? [])) if (present || !f.startsWith('e')) writeFileSync(join(src, f), validPng(10, 10))
        writeFileSync(join(src, 'page.mjs'), texte)
        const garde = { warn: console.warn, log: console.log, error: console.error }
        console.warn = console.log = console.error = () => {}
        let erreurs: string[]
        try {
          const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: 'dev', defaultScriptLang: langue as 'civet' })
          const stats = await b.compile()
          await b.close()
          erreurs = stats.errors.map(e => e.message.split('\n')[0])
        }
        finally {
          Object.assign(console, garde)
        }
        assert.equal(erreurs.length, 1, erreurs.join('\n'))
        assert.match(erreurs[0], ORPHELINE[nom] ? new RegExp(`un ${ORPHELINE[nom]} orphelin traîne`) : new RegExp(`<@head> ligne ${ligne} : une image <@@img> n'a pas sa place dans <@head>`))
        const copiees = existsSync(out) ? readdirSync(out).filter(f => /^e\d-.*\.png$/.test(f)) : []
        assert.deepEqual(copiees, [], 'aucune image du <@head> copiée')
      })
    }
  }

  // le <@head> écrit dans un partiel inclus : sa ligne dans le partiel
  for (const present of [true, false]) {
    it(`dans un partiel, image ${present ? 'présente' : 'absente'}`, async () => {
      const root = mjsTmp('img-tete-partiel')
      const src  = join(root, 'src')
      const out  = join(root, 'out')
      mkdirSync(src, { recursive: true })
      if (present) writeFileSync(join(src, 'e0.png'), validPng(10, 10))
      writeFileSync(join(src, 'z1.png'), validPng(10, 10))
      writeFileSync(join(src, '_tete.mjs'), '<@head>\n  <@@img src="e0.png" alt="x">\n</@head>\n')
      writeFileSync(join(src, 'page.mjs'), '<div>a</div>\n<@include tete>\n<@@img src="z1.png" alt="x">\n')
      const garde = { warn: console.warn, log: console.log, error: console.error }
      console.warn = console.log = console.error = () => {}
      let erreurs: string[]
      try {
        const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: 'dev' })
        const stats = await b.compile()
        await b.close()
        erreurs = stats.errors.map(e => e.message.split('\n')[0])
      }
      finally {
        Object.assign(console, garde)
      }
      assert.equal(erreurs.length, 1, erreurs.join('\n'))
      assert.match(erreurs[0], /<@head> ligne 2 de _tete\.mjs : une image <@@img> n'a pas sa place dans <@head>/)
      assert.deepEqual(existsSync(out) ? readdirSync(out).filter(f => /^e\d-.*\.png$/.test(f)) : [], [], 'aucune image du <@head> copiée')
    })
  }

  // un partiel versé dans un <@head> (et celui qu'il inclut à son tour), un <@head> écrit dans le repli d'un <@failed> (refusé par le
  // transpileur) : leurs <@@img> ne sont pas plus préparées ; un partiel inclus hors du <@head> garde les siennes
  const VERSES: Array<[string, Record<string, string>, RegExp]> = [
    ['un partiel versé dans <@head>', { 'page.mjs': '<div>a</div>\n<@head>\n  <@include tete>\n</@head>\n<@include corps>\n', '_tete.mjs': '<@@img src="e0.png" alt="x">\n', '_corps.mjs': '<@@img src="z1.png" alt="x">\n' }, /<@head> ligne (3|1 de _tete\.mjs) : une image <@@img> n'a pas sa place dans <@head>/],
    ['le partiel inclus par un partiel versé dans <@head>', { 'page.mjs': '<div>a</div>\n<@head>\n  <@include tete>\n</@head>\n<@include corps>\n', '_tete.mjs': '<meta name="x" content="y">\n<@include tete2>\n', '_tete2.mjs': '<@@img src="e0.png" alt="x">\n', '_corps.mjs': '<@@img src="z1.png" alt="x">\n' }, /<@head> ligne 1 de _tete2\.mjs : une image <@@img> n'a pas sa place dans <@head>/],
    ['un <@head> dans le repli d\'un <@failed>', { 'page.mjs': '<@failed err>\n  <p>r</p>\n  <@head><@@img src="e0.png" alt="x"></@head>\n</@failed>\n<@@img src="z1.png" alt="x">\n' }, /<@failed> ligne 3 : la balise <@head> ne peut pas vivre dans le repli d'un <@failed>/]
  ]
  for (const [nom, fichiers, refus] of VERSES) {
    for (const present of [true, false]) {
      it(`${nom}, image ${present ? 'présente' : 'absente'}`, async () => {
        const root = mjsTmp('img-tete-verse')
        const src  = join(root, 'src')
        const out  = join(root, 'out')
        mkdirSync(src, { recursive: true })
        for (const [f, texte] of Object.entries(fichiers)) writeFileSync(join(src, f), texte)
        if (present) writeFileSync(join(src, 'e0.png'), validPng(10, 10))
        writeFileSync(join(src, 'z1.png'), validPng(10, 10))
        const garde = { warn: console.warn, log: console.log, error: console.error }
        console.warn = console.log = console.error = () => {}
        let erreurs: string[]
        try {
          const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: 'dev' })
          const stats = await b.compile()
          await b.close()
          erreurs = stats.errors.map(e => e.message.split('\n')[0])
        }
        finally {
          Object.assign(console, garde)
        }
        assert.equal(erreurs.length, 1, erreurs.join('\n'))
        assert.match(erreurs[0], refus)
        const sortie = existsSync(out) ? readdirSync(out) : []
        assert.deepEqual(sortie.filter(f => /^e\d-.*\.png$/.test(f)), [], 'aucune image du <@head> copiée')
        assert.equal(sortie.filter(f => /^z1-.*\.png$/.test(f)).length, 1, `l'image écrite hors du <@head> est préparée : ${sortie.join(' ')}`)
      })
    }
  }
})
