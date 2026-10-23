// Ce que ce test garantit : un cycle entre deux modules (`a` importe `b`, `b` importe `a`) arrête `mjs build` — message de cycle
// qui nomme la boucle (`lib/a.module.civet → lib/b.module.civet → lib/a.module.civet`), code de sortie non nul, aucun fichier
// publié — qu'il passe par `@import` ou par `µimport`, en fichiers séparés comme en fichier unique, en français comme en
// anglais (clé `lang`). La boucle se dit dès qu'elle se ferme : le délai du filet de sécurité (12 s) n'est pas attendu.
// Processus fils réel : le test de l'API ne voit ni la sortie ni le code de sortie du processus.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..')

const HOTE_IMPORT = ["@import a 'lib/a.module.civet'", '<script>', '  go = -> a()', '</script>', '<p>x</p>', ''].join('\n')
const HOTE_MU     = ['<script>', '  go = ->', "    m = await µimport('lib/a.module.civet')", '    m', '</script>', '<p>x</p>', ''].join('\n')

const CAS: { nom: string, js: 'split' | 'bundle', lang?: 'en', fichiers: Record<string, string> }[] = [
  { nom: '@import mutuel, fichiers séparés', js: 'split', fichiers: { 'hote.mjs': HOTE_IMPORT, 'lib/a.module.civet': "@import b 'lib/b.module.civet'\nexport a := -> b\n", 'lib/b.module.civet': "@import a 'lib/a.module.civet'\nexport b := -> a\n" } },
  { nom: '@import mutuel, fichier unique', js: 'bundle', fichiers: { 'hote.mjs': HOTE_IMPORT, 'lib/a.module.civet': "@import b 'lib/b.module.civet'\nexport a := -> b\n", 'lib/b.module.civet': "@import a 'lib/a.module.civet'\nexport b := -> a\n" } },
  { nom: 'µimport mutuel, fichiers séparés', js: 'split', fichiers: { 'hote.mjs': HOTE_MU, 'lib/a.module.civet': "export a := -> µimport('lib/b.module.civet')\n", 'lib/b.module.civet': "export b := -> µimport('lib/a.module.civet')\n" } },
  { nom: 'µimport mutuel, fichier unique', js: 'bundle', fichiers: { 'hote.mjs': HOTE_MU, 'lib/a.module.civet': "export a := -> µimport('lib/b.module.civet')\n", 'lib/b.module.civet': "export b := -> µimport('lib/a.module.civet')\n" } },
  { nom: '@import mutuel, fichier unique, en anglais', js: 'bundle', lang: 'en', fichiers: { 'hote.mjs': HOTE_IMPORT, 'lib/a.module.civet': "@import b 'lib/b.module.civet'\nexport a := -> b\n", 'lib/b.module.civet': "@import a 'lib/a.module.civet'\nexport b := -> a\n" } },
  { nom: 'µimport mutuel, fichiers séparés, en anglais', js: 'split', lang: 'en', fichiers: { 'hote.mjs': HOTE_MU, 'lib/a.module.civet': "export a := -> µimport('lib/b.module.civet')\n", 'lib/b.module.civet': "export b := -> µimport('lib/a.module.civet')\n" } },
]

const BOUCLE = 'lib/a.module.civet → lib/b.module.civet → lib/a.module.civet'

describe('mjs build — un cycle entre deux modules arrête la construction', function () {
  this.timeout(240000)

  for (const cas of CAS) it(`${cas.nom} : la boucle est nommée tout de suite, code de sortie non nul, rien de publié`, function () {
    const root = mjsTmp('cycle-cli')
    for (const [chemin, contenu] of Object.entries(cas.fichiers)) {
      mkdirSync(dirname(join(root, 'src', chemin)), { recursive: true })
      writeFileSync(join(root, 'src', chemin), contenu)
    }
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'dist', manifestPath: 'dist/bundle.js', urlPrefix: '/dist', js: cas.js, runtime: 'core', ...(cas.lang ? { lang: cas.lang } : {}) }))
    const debut  = Date.now()
    const r      = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', root], { cwd: racine, encoding: 'utf-8', timeout: 150000 })
    const duree  = Date.now() - debut
    const sortie = `${r.stdout}\n${r.stderr}`
    assert.equal(r.signal, null, `le processus a fini de lui-même :\n${sortie}`)
    assert.notEqual(r.status, 0, `un cycle fait échouer le build (code ${r.status}) :\n${sortie}`)
    const intro = cas.lang === 'en' ? '@import/µasset cycle detected: ' : 'Cycle @import/µasset détecté : '
    assert.ok(sortie.includes(intro + BOUCLE), `la boucle est nommée :\n${sortie}`)
    assert.doesNotMatch(sortie, /probable dépendance circulaire|likely circular dependency/, `ce n'est pas le filet de sécurité qui parle :\n${sortie}`)
    assert.ok(duree < 11000, `la construction s'arrête dès que la boucle se ferme (${duree} ms, démarrage de la CLI compris ; le filet de sécurité attend 12 s)`)
    const publies = existsSync(join(root, 'dist')) ? readdirSync(join(root, 'dist')).filter(f => f.endsWith('.js')) : []
    assert.equal(publies.some(f => /^(?:a|b)(?:\.module)?-/.test(f)), false, `aucun module du cycle n'est publié : ${publies.join(', ')}`)
  })
})
