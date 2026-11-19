// Construction de production dont les fichiers JS sont écrits en échappements : Chromium, Firefox et WebKit affichent exactement les mêmes
// textes (un « … », un « ’ », un émoji sur deux unités, un nom grec), en fichier unique, en fichiers séparés et en mode csp ; un gabarit
// étiqueté et une expression régulière, laissés tels quels, rendent le même texte brut et la même propriété `source`

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'

const TITRE    = 'Bientôt… l’œuvre à 5 € 😀'
const STATIQUE = 'Prix… l’œuf à 3 € 😀'
const LIBELLE  = 'Suite… l’œil à 2 € 😀'
const CARTE    = `<script lang="js">\n@import { libelle grec } 'textes.js'\n$titre = '${TITRE}'\n$grec  = grec.αβγ\n$lib   = libelle()\n</script>\n<p class="a">{$titre}</p>\n<p class="b">${STATIQUE}</p>\n<p class="c">{$grec}</p>\n<p class="d">{$lib}</p>\n`
// le même composant sans bibliothèque, pour le fichier unique
const CARTE_SEULE = `<script lang="js">\nconst grec = { αβγ: 'grec' }\n$titre = '${TITRE}'\n$grec  = grec.αβγ\n$lib   = '${LIBELLE}'\n</script>\n<p class="a">{$titre}</p>\n<p class="b">${STATIQUE}</p>\n<p class="c">{$grec}</p>\n<p class="d">{$lib}</p>\n`
const BRUT     = '<script lang="js">\n$brut   = String.raw`brut… \\n`\n$source = /…’/u.source\n$plain  = \'simple…\'\n</script>\n<p class="brut">{$brut}</p>\n<p class="source">{$source}</p>\n<p class="plain">{$plain}</p>\n'
const TEXTES   = `export const grec = { αβγ: 'grec' }\nexport function libelle() { return '${LIBELLE}' }\nexport const remplissage = '${'a'.repeat(2400)}'\n`
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }

// ce que chaque balise doit afficher, par classe de paragraphe
const ATTENDU: Record<string, Record<string, string>> = {
  'mjs-carte': { a: TITRE, b: STATIQUE, c: 'grec', d: LIBELLE },
  'mjs-brut':  { brut: 'brut… \\n', source: '…’', plain: 'simple…' }
}
// [nom, sources, réglages, balises montrées]
const CAS: Array<[string, Record<string, string>, Record<string, unknown>, string[]]> = [
  ['fichier unique',            { 'carte.mjs': CARTE_SEULE },                                  { js: 'bundle' },                         ['mjs-carte']],
  ['fichiers séparés',          { 'carte.mjs': CARTE, 'brut.mjs': BRUT, 'textes.js': TEXTES }, { js: 'split' },                          ['mjs-carte', 'mjs-brut']],
  ['fichier unique tel quel',   { 'brut.mjs': BRUT },                                          { js: 'bundle' },                         ['mjs-brut']],
  ['mode csp',                  { 'carte.mjs': CARTE + '<style>\np\n  color: red\n</style>\n', 'textes.js': TEXTES }, { js: 'split', csp: true, css: 'split' }, ['mjs-carte']]
]

const wide = (text: string): number => [...text].filter(c => c.codePointAt(0)! > 0xFF).length

describe('production écrite en échappements : mêmes textes affichés dans les trois moteurs', function () {
  this.timeout(280000)
  const dists: Record<string, string> = {}

  before(async () => {
    for (const [nom, sources, opts, balises] of CAS) {
      const root = mjsTmp('un-octet-nav')
      const src  = join(root, 'src')
      const dist = join(root, 'dist')
      mkdirSync(src, { recursive: true })
      for (const [file, code] of Object.entries(sources)) writeFileSync(join(src, file), code)
      const bundler = new Bundler({ sourceDir: src, outputDir: join(dist, 'out'), manifestPath: join(dist, 'out', 'bundle.js'), urlPrefix: '/out', env: 'prod', ...opts } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [], nom)
      writeFileSync(join(dist, 'index.html'), `<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body>${balises.map(b => `<${b}></${b}>`).join('')}</body></html>`)
      dists[nom] = dist
    }
    await terminateSharedWorkerPool()
    // ce que les navigateurs vont lire : le fichier unique est écrit en échappements (la bibliothèque, copiée telle quelle, à part), celui qui porte un gabarit étiqueté reste tel quel
    const files = (nom: string): string => readdirSync(join(dists[nom], 'out')).filter(n => n.endsWith('.js') && !/^textes-/.test(n)).map(n => readFileSync(join(dists[nom], 'out', n), 'utf-8')).join('\n')
    assert.equal(wide(files('fichier unique')), 0, 'fichier unique : aucun caractère au-delà de U+00FF')
    assert.ok(wide(files('fichier unique tel quel')) > 0, 'fichier unique tel quel : ses caractères restent')
  })

  for (const moteur of MOTEURS) it(`${moteur} : chaque texte tel qu'il est écrit dans la source`, async function () {
    if (!(await moteurPresent(moteur))) this.skip()
    const playwright: any = await import('playwright')
    const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    try {
      for (const [nom, , , balises] of CAS) {
        const dist    = dists[nom]
        const page    = await browser.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e).slice(0, 200)))
        await page.route('http://mjs.test/**', (route: any) => {
          const chemin  = new URL(route.request().url()).pathname
          const fichier = join(dist, chemin === '/' ? 'index.html' : chemin)
          if (!fichier.startsWith(dist) || !existsSync(fichier)) return route.fulfill({ status: 404, body: 'introuvable' })
          return route.fulfill({ status: 200, contentType: TYPES[extname(fichier)] ?? 'application/octet-stream', body: readFileSync(fichier) })
        })
        await page.goto('http://mjs.test/')
        for (const balise of balises) {
          const lire = (classe: string): string => `(() => { const el = document.querySelector('${balise}'); const r = el && (el._shadow || el.shadowRoot || el); return r?.querySelector('p.${classe}')?.textContent ?? '' })()`
          const vus: Record<string, string> = {}
          try { await page.waitForFunction(lire(Object.keys(ATTENDU[balise])[0]) + " !== ''", undefined, { timeout: 20000 }) }
          catch { throw new Error(`${moteur}, ${nom} : <${balise}> ne s'affiche pas — erreurs : ${erreurs.join(' | ')}`) }
          for (const classe of Object.keys(ATTENDU[balise])) vus[classe] = await page.evaluate(lire(classe))
          assert.deepEqual(vus, ATTENDU[balise], `${moteur}, ${nom}, <${balise}>`)
        }
        await page.close()
        assert.deepEqual(erreurs, [], `${moteur}, ${nom} : erreurs de la page`)
      }
    }
    finally {
      await browser.close()
    }
  })
})
