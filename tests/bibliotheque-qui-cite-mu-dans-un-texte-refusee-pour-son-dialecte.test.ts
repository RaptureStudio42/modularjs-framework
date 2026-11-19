// une bibliothèque `.civet` dont un commentaire ou une chaîne cite µ (`// voir µt(k)`) est comparée au texte lu par MJS comme une
// autre : `for … in`, un commentaire `#`, `isnt` et `#{…}` y sont refusés, chacun à sa ligne, en développement comme en production,
// là où Civet seul les compilait sans un mot (`for x in [10, 20]` lisait les clés, `# un commentaire` devenait un appel) ; µ écrit
// dans un commentaire, une chaîne, un gabarit ou une expression régulière, un nom lié par la bibliothèque qui contient µ (`µt := …`)
// ou une propriété `µx` ne font refuser aucune bibliothèque juste

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

// les erreurs d'une construction d'un projet jetable (développement par défaut), console coupée
async function erreurs(fichiers: Record<string, string>, options: Record<string, unknown> = {}): Promise<string[]> {
  const racine  = mkdtempSync(join(tmpdir(), 'biblio-mu-cite-'))
  const src     = join(racine, 'src')
  const journal = [console.log, console.warn, console.error]
  for (const [nom, texte] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(src, nom)), { recursive: true })
    writeFileSync(join(src, nom), texte)
  }
  console.log = console.warn = console.error = () => {}
  try {
    const b: any  = new Bundler({ sourceDir: src, outputDir: join(racine, 'out'), manifestPath: join(racine, 'bundle.js'), minify: false, ...options } as any)
    const st: any = await b.compile()
    await b.close()
    return (st.errors ?? []).map((e: any) => String(e?.message ?? e))
  }
  finally {
    [console.log, console.warn, console.error] = journal
    rmSync(racine, { recursive: true, force: true })
  }
}

// un composant qui importe `f` de la bibliothèque `chemin` et l'appelle au chargement
const composant = (chemin: string) => `<script>\n@import { f } '${chemin}'\nload = -> $r = String(f())\n</script>\n<p>{$r}</p>\n`

// la seule erreur qui nomme ce fichier
function refusDe(liste: string[], fichier: string): string {
  const siennes = liste.filter(e => e.includes(fichier))
  assert.equal(siennes.length, 1, liste.join('\n') || 'aucune erreur')
  return siennes[0]
}

// une écriture du dialecte de MJS par bibliothèque, µ cité dans un commentaire ou une chaîne, et le motif attendu à sa ligne
const DIALECTE: [string, string, string][] = [
  ['for … in, µ cité dans un commentaire', '// le traducteur : µt(k)\nexport f := ->\n  s .= 0\n  for x in [10, 20]\n    s += x\n  s\n', 'ligne 4 : la boucle « for … in »'],
  ['commentaire #, µ cité dans une chaîne', "export f := ->\n  # un commentaire\n  'voir µt(k, v)'\n", 'ligne 2 : un commentaire « # »'],
  ['isnt, µ cité dans un commentaire bloc', '/* µt(k) */\nexport f := (a = 1, b = 2) -> a isnt b\n', 'ligne 2 : « isnt »'],
  ['#{…}, µ cité dans une chaîne', "export f := (n = 2) -> \"n = #{n}\"\nexport g := -> 'µt'\n", "ligne 1 : l'interpolation « #{…} »"],
]

// µ écrit ailleurs que dans un nom lu par MJS : des bibliothèques justes
const JUSTES: Record<string, string> = {
  'commentaire.civet': "// `t` = le traducteur de l'écran (`(k, v) -> µt(k, v)`)\nexport f := (d = new Date(2020, 0, 15)) ->\n  r := new Date(d.getTime())\n  r.getFullYear()\n",
  'chaine.civet': "export f := -> 'voir µt(k, v)'\n",
  'bloc.civet': '/* µt(k) */\nexport f := -> 1\n',
  'gabarit.civet': "export f := (k = 'a') -> `µ${k}`\n",
  'regex.civet': "export f := (s = 'µ') -> /µ/.test(s)\n",
  'ecritures.civet': "// µ.toast('x'), µ$compte = 1, µ$$panier, µajax('/api')\nexport f := -> ['µ.go(\"/\")', \"µ$compte\", 'µ$$panier = 2', \"µajax('/api')\"].length\n",
  'lie.civet': "µt := (k) -> k + '!'\nexport f := -> µt('x')\n",
  'propriete.civet': 'export f := (o = { µx: 1 }) -> o.µx\n',
}

describe('bibliothèque .civet qui cite µ dans un commentaire ou une chaîne : son dialecte refusé comme ailleurs', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const mode of ['dev', 'prod']) {
    it(`for … in, commentaire #, isnt, #{…} : chacun à sa ligne (${mode})`, async () => {
      const fichiers = {} as Record<string, string>
      DIALECTE.forEach(([, texte], i) => {
        fichiers[`alpha${i}.mjs`] = composant(`lib${i}.civet`)
        fichiers[`lib${i}.civet`] = texte
      })
      const liste = await erreurs(fichiers, mode === 'prod' ? { env: 'prod' } : {})
      DIALECTE.forEach(([cas, , motif], i) => {
        const e = refusDe(liste, `lib${i}.civet`)
        assert.match(e, new RegExp(`nommez-le lib${i}\\.civet\\.mjs`), `${cas}\n---\n${e}`)
        assert.ok(e.includes(motif), `${cas} : ${motif}\n---\n${e}`)
      })
    })
  }

  it('aucun refus : µ dans un commentaire, une chaîne, un gabarit, une expression régulière, nom lié µt, propriété µx', async () => {
    const fichiers = {} as Record<string, string>
    Object.entries(JUSTES).forEach(([nom, texte], i) => {
      fichiers[`beta${i}.mjs`] = composant(nom)
      fichiers[nom]            = texte
    })
    assert.deepEqual(await erreurs(fichiers), [])
  })
})
