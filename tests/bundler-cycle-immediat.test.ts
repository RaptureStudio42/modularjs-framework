// Ce que ce test garantit : une boucle d'imports entre modules (`a.civet` importe `b.civet`, `b.civet` importe `a.civet`),
// par `@import` comme par `µimport`, est dite DÈS qu'elle se ferme, et la construction s'arrête aussitôt — sans attendre le
// délai du filet de sécurité de `compileWithDedup`. Les deux modules sont chacun atteints seuls par le scan du projet : chacun
// a sa propre chaîne de résolution, et chacun attend l'autre. Le délai du filet est ici volontairement long (20 s) : une
// boucle qui ne se dirait qu'à son échéance dépasserait la limite de temps du test. Le message nomme la boucle seule, chemins
// relatifs au dossier des sources, en français comme en anglais. Les graphes sans boucle (losange, chaîne) se construisent
// sans erreur : la détection ne doit refuser aucun import légitime.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const DELAI_FILET = 20000
const LIMITE      = 9000

async function construire(fichiers: Record<string, string>): Promise<{ messages: string, erreurs: number, duree: number }> {
  const root   = mjsTmp('cycle-immediat')
  const srcDir = join(root, 'src')
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(srcDir, chemin)), { recursive: true })
    writeFileSync(join(srcDir, chemin), contenu)
  }
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), runtime: 'core', dedupWaitTimeoutMs: DELAI_FILET } as any)
  const debut   = Date.now()
  const stats   = await bundler.compile()
  const duree   = Date.now() - debut
  await bundler.close()
  return { messages: stats.errors.map((e: any) => e.message).join('\n'), erreurs: stats.errors.length, duree }
}

const IMPORTE = (nom: string, cible: string) => `@import suite '${cible}'\nexport ${nom} := -> suite\n`
const MU      = (nom: string, cible: string) => `export ${nom} := -> µimport('${cible}')\n`

describe('bundler — une boucle d\'imports se dit tout de suite', function () {
  this.timeout(90000)

  after(async () => {
    setMessagesLang('fr')
    await terminateSharedWorkerPool()
  })

  for (const [forme, ecrire] of [['@import', IMPORTE], ['µimport', MU]] as const) {
    it(`${forme} mutuel entre deux modules : la boucle est nommée, sans attendre le filet de sécurité`, async () => {
      const r = await construire({ 'a.civet': ecrire('a', 'b.civet'), 'b.civet': ecrire('b', 'a.civet') })
      assert.ok(r.erreurs > 0, 'la boucle fait échouer la construction')
      assert.match(r.messages, /Cycle @import\/µasset détecté : a\.civet → b\.civet → a\.civet\./, `la chaîne est nommée :\n${r.messages}`)
      assert.doesNotMatch(r.messages, /bloquée depuis/, 'ce n\'est pas le filet de sécurité qui parle')
      assert.ok(r.duree < LIMITE, `la boucle est dite tout de suite (${r.duree} ms, filet à ${DELAI_FILET} ms)`)
    })

    it(`${forme} mutuel dans un sous-dossier : les chemins sont relatifs au dossier des sources`, async () => {
      const r = await construire({ 'lib/a.module.civet': ecrire('a', 'lib/b.module.civet'), 'lib/b.module.civet': ecrire('b', 'lib/a.module.civet') })
      assert.match(r.messages, /Cycle @import\/µasset détecté : lib\/a\.module\.civet → lib\/b\.module\.civet → lib\/a\.module\.civet\./, r.messages)
      assert.ok(r.duree < LIMITE, `dit tout de suite (${r.duree} ms)`)
    })

    it(`${forme} : une boucle de trois modules est nommée en entier`, async () => {
      const r = await construire({ 'a.civet': ecrire('a', 'b.civet'), 'b.civet': ecrire('b', 'c.civet'), 'c.civet': ecrire('c', 'a.civet') })
      assert.match(r.messages, /Cycle @import\/µasset détecté : a\.civet → b\.civet → c\.civet → a\.civet\./, r.messages)
      assert.ok(r.duree < LIMITE, `dit tout de suite (${r.duree} ms)`)
    })
  }

  it('un composant qui entre dans la boucle n\'en fait pas partie : seule la boucle est nommée', async () => {
    const r = await construire({ 'hote.mjs': '@import a \'a.civet\'\n<script>\n  go = -> a()\n</script>\n<p>x</p>\n', 'a.civet': IMPORTE('a', 'b.civet'), 'b.civet': IMPORTE('b', 'a.civet') })
    assert.match(r.messages, /Cycle @import\/µasset détecté : a\.civet → b\.civet → a\.civet\./, r.messages)
    assert.doesNotMatch(r.messages, /détecté : [^.]*hote\.mjs →/, 'le composant d\'entrée n\'est pas dans la chaîne')
    assert.ok(r.duree < LIMITE, `dit tout de suite (${r.duree} ms)`)
  })

  it('le message est aussi dit en anglais', async () => {
    setMessagesLang('en')
    try {
      const r = await construire({ 'a.civet': IMPORTE('a', 'b.civet'), 'b.civet': IMPORTE('b', 'a.civet') })
      assert.match(r.messages, /@import\/µasset cycle detected: a\.civet → b\.civet → a\.civet\./, r.messages)
      assert.doesNotMatch(r.messages, /stuck for/, 'ce n\'est pas le filet de sécurité qui parle')
      assert.ok(r.duree < LIMITE, `dit tout de suite (${r.duree} ms)`)
    }
    finally {
      setMessagesLang('fr')
    }
  })

  it('un losange d\'imports (deux modules qui importent le même troisième) se construit sans erreur', async () => {
    const r = await construire({
      'racine.civet': '@import gauche \'gauche.civet\'\n@import droite \'droite.civet\'\nexport racine := -> [gauche, droite]\n',
      'gauche.civet': '@import fond \'fond.civet\'\nexport gauche := -> fond\n',
      'droite.civet': '@import fond \'fond.civet\'\nexport droite := -> fond\n',
      'fond.civet':   'export fond := 1\n',
      'seul.civet':   'export seul := 2\n',
    })
    assert.equal(r.erreurs, 0, r.messages)
    assert.ok(r.duree < LIMITE, `construit sans attente (${r.duree} ms)`)
  })

  it('une chaîne d\'imports sans retour (a importe b, b importe c) se construit sans erreur', async () => {
    const r = await construire({ 'a.civet': IMPORTE('a', 'b.civet'), 'b.civet': IMPORTE('b', 'c.civet'), 'c.civet': 'export c := 3\n' })
    assert.equal(r.erreurs, 0, r.messages)
  })
})
