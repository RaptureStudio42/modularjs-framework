// une bibliothèque `.civet` / `.coffee` est publiée à plat, sous un nom à empreinte : un import qui ne se chargerait pas dans le
// navigateur — chemin relatif sans extension (le navigateur ne la devine pas), chemin d'un fichier du projet écrit depuis la racine
// des sources sans `./` ni `../` (le navigateur le lit comme un nom de paquet) — arrête la construction, en développement comme en
// production : le fichier, la ligne, et le chemin à écrire quand le fichier visé est trouvé. Un import juste, un import de paquet
// ne changent pas ; un module `.civet.mjs` refuse déjà tout import natif

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

interface Construction { erreurs: string[], sorties: Record<string, string> }

// un projet jetable, construit une fois (développement par défaut), console coupée
async function construire(fichiers: Record<string, string>, options: Record<string, unknown> = {}): Promise<Construction> {
  const racine  = mkdtempSync(join(tmpdir(), 'biblio-import-'))
  const src     = join(racine, 'src')
  const out     = join(racine, 'out')
  const journal = [console.log, console.warn, console.error]
  for (const [nom, texte] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(src, nom)), { recursive: true })
    writeFileSync(join(src, nom), texte)
  }
  console.log = console.warn = console.error = () => {}
  try {
    const b: any  = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(racine, 'bundle.js'), minify: false, ...options } as any)
    const st: any = await b.compile()
    const sorties: Record<string, string> = {}
    for (const f of readdirSync(out)) if (f.endsWith('.js')) sorties[f] = readFileSync(join(out, f), 'utf-8')
    return { erreurs: (st.errors ?? []).map((e: any) => String(e?.message ?? e)), sorties }
  }
  finally {
    [console.log, console.warn, console.error] = journal
    rmSync(racine, { recursive: true, force: true })
  }
}

const composant = (chemin: string) => `<script>\n@import { f } '${chemin}'\nload = -> $r = f()\n</script>\n<p>{$r}</p>\n`

// l'erreur qui nomme ce fichier
const erreurDe = (c: Construction, fichier: string): string => c.erreurs.find(e => e.includes(fichier)) ?? `aucune erreur pour ${fichier} : ${c.erreurs.join('\n') || 'aucune erreur'}`

describe('bibliothèque .civet / .coffee : un import qui ne se chargera pas dans le navigateur arrête la construction', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const mode of ['dev', 'prod']) {
    it(`chemin relatif sans extension : le fichier, la ligne et le chemin à écrire (${mode})`, async () => {
      const c = await construire({
        'alpha.mjs':   composant('lib/a.civet'),
        'lib/a.civet': "// moteur du tirage\nimport { b } from './b'\nexport f := -> b()\n",
        'lib/b.civet': 'export b := -> 41\n',
      }, mode === 'prod' ? { env: 'prod' } : {})
      const e = erreurDe(c, 'lib/a.civet')
      assert.match(e, /lib\/a\.civet, ligne 2 : l'import « \.\/b » ne se chargera pas dans le navigateur/, e)
      assert.match(e, /écrivez « \.\/b\.civet »/, e)
    })

    it(`chemin d'un fichier du projet écrit depuis la racine des sources, sans ./ (${mode})`, async () => {
      const c = await construire({
        'alpha.mjs':                   composant('app/games/poker.civet'),
        'app/games/poker.civet':       "import { draw } from 'app/games/engines/rng.civet'\nexport f := -> draw()\n",
        'app/games/engines/rng.civet': 'export draw := -> 7\n',
      }, mode === 'prod' ? { env: 'prod' } : {})
      const e = erreurDe(c, 'app/games/poker.civet')
      assert.match(e, /app\/games\/poker\.civet, ligne 1 : l'import « app\/games\/engines\/rng\.civet » ne se chargera pas dans le navigateur/, e)
      assert.match(e, /écrivez « \.\/engines\/rng\.civet »/, e)
    })
  }

  it('chemin depuis la racine des sources et sans extension, d\'un autre dossier : le chemin à écrire remonte par ../', async () => {
    const c = await construire({
      'alpha.mjs':                   composant('shared/aura.civet'),
      'shared/aura.civet':           "import { draw } from 'app/games/engines/rng'\nexport f := -> draw()\n",
      'app/games/engines/rng.civet': 'export draw := -> 7\n',
    })
    assert.match(erreurDe(c, 'shared/aura.civet'), /ligne 1 : l'import « app\/games\/engines\/rng » .*écrivez « \.\.\/app\/games\/engines\/rng\.civet »/)
  })

  it('chemin relatif sans extension vers un fichier absent : refusé, sans chemin inventé', async () => {
    const c = await construire({ 'alpha.mjs': composant('lib/a.civet'), 'lib/a.civet': "import { z } from '../absent'\nexport f := -> z()\n" })
    const e = erreurDe(c, 'lib/a.civet')
    assert.match(e, /ligne 1 : l'import « \.\.\/absent » ne se chargera pas dans le navigateur/, e)
    assert.match(e, /avec son extension/, e)
    assert.doesNotMatch(e, /écrivez « /, e)
  })

  it('une bibliothèque .coffee : même refus', async () => {
    const c = await construire({ 'alpha.mjs': composant('lib/c.coffee'), 'lib/c.coffee': "import { b } from './b'\nexport f = -> b()\n", 'lib/b.civet': 'export b := -> 41\n' })
    assert.match(erreurDe(c, 'lib/c.coffee'), /ligne 1 : l'import « \.\/b » .*écrivez « \.\/b\.civet »/)
  })

  it('deux imports fautifs du même fichier : nommés tous les deux, dans une seule erreur', async () => {
    const c = await construire({
      'alpha.mjs':   composant('lib/a.civet'),
      'lib/a.civet': "import { b } from './b'\nimport { d } from 'lib/d.civet'\nexport f := -> b() + d()\n",
      'lib/b.civet': 'export b := -> 40\n',
      'lib/d.civet': 'export d := -> 2\n',
    })
    const e = erreurDe(c, 'lib/a.civet')
    assert.match(e, /ligne 1 : l'import « \.\/b »/, e)
    assert.match(e, /ligne 2 : l'import « lib\/d\.civet » .*écrivez « \.\/d\.civet »/, e)
    assert.equal(c.erreurs.filter(x => x.includes('lib/a.civet')).length, 1, c.erreurs.join('\n'))
  })

  it('un import juste et un import de paquet ne changent pas', async () => {
    const c = await construire({
      'alpha.mjs':   composant('lib/a.civet'),
      'lib/a.civet': "import { b } from './b.civet'\nimport pick from 'lodash/pick.js'\nimport { readFileSync } from 'node:fs'\nimport _ from 'lodash'\nexport f := -> b()\n",
      'lib/b.civet': 'export b := -> 41\n',
    })
    assert.deepEqual(c.erreurs, [])
    const a = Object.entries(c.sorties).find(([f]) => /^a-[0-9a-z]{4,12}\.js$/.test(f))?.[1] ?? ''
    assert.match(a, /b-[0-9a-z]{4,12}\.js/)
    assert.match(a, /from ['"]lodash\/pick\.js['"]/)
    assert.match(a, /from ['"]node:fs['"]/)
    assert.match(a, /from ['"]lodash['"]/)
  })

  it('un module .civet.mjs refuse déjà tout import natif, même sans extension', async () => {
    const c = await construire({ 'alpha.mjs': composant('lib/a.civet.mjs'), 'lib/a.civet.mjs': "import { b } from './b'\nexport f := -> b()\n", 'lib/b.civet': 'export b := -> 41\n' })
    assert.ok(c.erreurs.some(e => e.includes('a.civet.mjs') && e.includes('./b')), c.erreurs.join('\n') || 'aucune erreur')
  })

  it('en anglais : mêmes faits', async () => {
    setMessagesLang('en')
    try {
      const c = await construire({ 'alpha.mjs': composant('lib/a.civet'), 'lib/a.civet': "import { b } from './b'\nexport f := -> b()\n", 'lib/b.civet': 'export b := -> 41\n' })
      assert.match(erreurDe(c, 'lib/a.civet'), /lib\/a\.civet, line 1: the import "\.\/b" will not load in the browser.*write "\.\/b\.civet"/)
    }
    finally {
      setMessagesLang('fr')
    }
  })
})
