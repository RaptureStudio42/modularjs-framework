// i18n — sous `@i18n 'page'`, chaque clé relative reçoit le préfixe de la section, même quand le code compilé porte, avant elle, un
// gabarit littéral qui contient `//` (une adresse `https://…` dans un attribut calculé ou dans une chaîne à interpolation), ou une
// expression régulière qui contient un guillemet ; vraies constructions (Bundler), puis le rendu (happy-dom) : le texte traduit à l'écran
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { write } from './helpers/construction-cache.js'
import { attendreEgal } from './helpers/attendre.js'
import { projet } from './helpers/i18n-rendu-projet.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

async function cles(nom: string, texte: string): Promise<string[]> {
  const root = mjsTmp('i18n-adresse-' + nom)
  write(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app', outputDir: 'public/m', manifestPath: 'public/m/bundle.js', urlPrefix: '/m' }, null, 2) + '\n')
  write(join(root, `app/${nom}.mjs`), texte)
  const found   = findConfig(root)!
  const bundler = new Bundler(resolveBundlerOpts(found.config, found.configDir) as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const out  = join(root, 'public/m')
  const code = readdirSync(out).filter(f => f.startsWith(nom) && f.endsWith('.js')).map(f => readFileSync(join(out, f), 'utf-8')).join('\n')
  return [...code.matchAll(/µ\??\.t\(\s*(['"`])([^'"`]*)\1/g)].map(m => m[2]).sort()
}

// textes des balises lues dans l'ombre du composant, dans l'ordre des sélecteurs
const textes = (el: any, selecteurs: string[]): string[] => selecteurs.map(s => el._shadow?.querySelector(s)?.textContent.trim())

describe('i18n — préfixe de la section après une adresse ou une expression régulière', function () {
  this.timeout(120_000)
  after(async () => { await terminateSharedWorkerPool() })

  it('attribut calculé qui porte une adresse (href="https://…/{$id}") : les clés du gabarit gardent leur section', async () => {
    assert.deepEqual(await cles('ia', "@i18n 'page'\n<script>\n$id = 7\n</script>\n<a href=\"https://exemple.fr/{$id}\">{µt('lien')}</a>\n<p>{µt('suite')}</p>\n"), ['page.lien', 'page.suite'])
  })

  it('chaîne à interpolation du script qui porte une adresse : la clé de la ligne suivante garde sa section', async () => {
    assert.deepEqual(await cles('ib', "@i18n 'page'\n<script>\n$id = 7\nlien := \"https://exemple.fr/#{$id}\"\napres := µt('apres')\n</script>\n<p>{lien} {apres}</p>\n<p>{µt('fin')}</p>\n"), ['page.apres', 'page.fin'])
  })

  it('adresse sans protocole dans un src calculé (//cdn…) : même chose', async () => {
    assert.deepEqual(await cles('ic', "@i18n 'page'\n<script>\n$f = 'a.png'\n</script>\n<img src=\"//cdn.exemple.fr/{$f}\" alt=\"{µt('alt')}\">\n<p>{µt('suite')}</p>\n"), ['page.alt', 'page.suite'])
  })

  it('expression régulière qui porte un guillemet, sur la ligne d\'une clé', async () => {
    assert.deepEqual(await cles('id', "@i18n 'page'\n<script>\n$s = \"l'ami\"\n</script>\n<p>{$s.replace(/'/g, '') + µt('regex')}</p>\n<p>{µt('suite')}</p>\n"), ['page.regex', 'page.suite'])
  })

  it('gardes : une clé citée dans une chaîne ou dans le texte figé d\'un gabarit littéral n\'est pas réécrite', async () => {
    const lues = await cles('ie', "@i18n 'page'\n<script lang=\"js\">\nconst aide = \"ecrivez µ.t('citee') ici\"\nconst autre = `texte µ.t('figee') ${µt('vive')}`\n</script>\n<p>{aide} {autre}</p>\n")
    assert.deepEqual(lues, ['citee', 'figee', 'page.vive'])
  })

  it('rendu : un lien à adresse calculée puis un paragraphe, les deux textes traduits à l\'écran', async () => {
    const p  = await projet({ graine: true, sources: { vue: "@i18n 'panier'\n<script>\n$id = 7\n</script>\n<a href=\"https://exemple.fr/{$id}\">{µt('resume')}</a>\n<p>{µt('seul_fr')}</p>\n" } })
    const el = p.monte('vue')
    await attendreEgal(() => textes(el, ['a', 'p']), ['Résumé du panier', 'Seulement en français'], 'les deux textes de la section panier', 5000)
  })

  it('rendu : une chaîne du script qui porte une adresse, le texte de la clé suivante traduit à l\'écran', async () => {
    const p  = await projet({ graine: true, sources: { vue: "@i18n 'panier'\n<script>\n$id = 7\nlien := \"https://exemple.fr/#{$id}\"\napres := µt('resume')\n</script>\n<p class=\"l\">{lien}</p>\n<p class=\"a\">{apres}</p>\n" } })
    const el = p.monte('vue')
    await attendreEgal(() => textes(el, ['p.l', 'p.a']), ['https://exemple.fr/7', 'Résumé du panier'], 'l\'adresse puis le texte de la section panier', 5000)
  })
})
