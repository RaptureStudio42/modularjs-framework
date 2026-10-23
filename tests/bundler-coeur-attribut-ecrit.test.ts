// Test neuf — Bundler.coreAttrWritten(module, attr) : « l'attribut est-il écrit sur une référence à ce module cœur
// (`<@@module …>` ou `<mjs-core-module …>`), quelque part dans l'appli ? » — 'yes', 'no', ou 'unknown' quand une
// référence au module porte un étalement `{...p}` (ce qu'il pose ne se sait pas au build : vaut 'yes' pour qui décide).
// La réponse se lit une fois les références résolues, se refait à chaque compile() (mode veille : un attribut ajouté
// puis retiré entre deux tours se voit) et ne change pas quand un fichier revient du cache.
//
// Statique : aucun navigateur. Les modules cœur sont fabriqués (la méthode ne lit que les références, le contenu d'un
// module n'y change rien) ; quelques tests prennent le catalogue réel (`<@@select>` du framework).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool, isSharedWorkerPoolAlive } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

type Files = Record<string, string>
type Answer = 'yes' | 'unknown' | 'no'

const CATALOGUE: Files = {
  'select.mjs':   '<div><@slot/></div>',
  'option.mjs':   '<span><@slot/></span>',
  'field.mjs':    '<div><@slot/></div>',
  'checkbox.mjs': '<label><@slot/></label>',
}

interface App {
  root:    string
  srcDir:  string
  outDir:  string
  coreDir: string | undefined
}

/** Une appli jetable : ses fichiers, et un catalogue cœur fabriqué (`null` : le catalogue réel du framework). */
function makeApp(prefix: string, files: Files, catalogue: Files | null = CATALOGUE): App {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(srcDir, rel), content)
  let coreDir: string | undefined
  if (catalogue) {
    coreDir = join(root, 'core-modules')
    mkdirSync(coreDir, { recursive: true })
    for (const [rel, content] of Object.entries(catalogue)) writeFileSync(join(coreDir, rel), content)
  }
  return { root, srcDir, outDir: join(root, 'out'), coreDir }
}

function bundlerOf(app: App, extra: Record<string, unknown> = {}): Bundler {
  return new Bundler({ sourceDir: app.srcDir, outputDir: app.outDir, manifestPath: join(app.root, 'bundle.js'), ...(app.coreDir ? { coreModulesDir: app.coreDir } : {}), ...extra })
}

async function compileOk(bundler: Bundler): Promise<void> {
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
}

/** La réponse pour `other` sur `select` d'une appli construite une fois. */
async function otherIn(files: Files, catalogue: Files | null = CATALOGUE): Promise<Answer> {
  const bundler = bundlerOf(makeApp('attr-ecrit', files, catalogue))
  await compileOk(bundler)
  return bundler.coreAttrWritten('select', 'other')
}

const ask = (bundler: Bundler): Answer => bundler.coreAttrWritten('select', 'other')

describe('Bundler.coreAttrWritten — l\'attribut `other` est-il écrit sur une référence à <@@select> ?', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('détection VRAIE', () => {
    const VRAIS: [string, Files][] = [
      ['attribut nu : <@@select other>', { 'liste.mjs': '<@@select other></@@select>' }],
      ['valeur entre guillemets : other="42"', { 'liste.mjs': '<@@select other="42"></@@select>' }],
      ['expression : other={$x}', { 'liste.mjs': '<script>\n$x = 42\n</script>\n<@@select other={$x}></@@select>' }],
      ['liaison : other=!{$x}', { 'liste.mjs': '<script>\n$x = 42\n</script>\n<@@select other=!{$x}></@@select>' }],
      ['balise littérale : <mjs-core-select other>', { 'liste.mjs': '<mjs-core-select other></mjs-core-select>' }],
      ['balise littérale, valeur : <mjs-core-select other="42">', { 'liste.mjs': '<mjs-core-select other="42"></mjs-core-select>' }],
      ['autofermante : <@@select other />', { 'liste.mjs': '<@@select other />' }],
      ['casse : <@@select Other>', { 'liste.mjs': '<@@select Other></@@select>' }],
      ['avec d\'autres attributs autour', { 'liste.mjs': '<@@select name="pays" multiple search other placeholder="Choisir"></@@select>' }],
      ['écrite à faux : other={false} (écrite, donc oui : la valeur ne se lit pas au build)', { 'liste.mjs': '<@@select other={false}></@@select>' }],
      ['dans un {if}', { 'liste.mjs': '<script>\n$on = true\n</script>\n{if $on}<@@select other></@@select>{end}' }],
      ['dans la branche {else} d\'un {if}', { 'liste.mjs': '<script>\n$on = true\n</script>\n{if $on}<p>non</p>{else}<@@select other></@@select>{end}' }],
      ['dans un {for}', { 'liste.mjs': '<script>\n$xs = [1, 2]\n</script>\n{for x in $xs}<@@select other></@@select>{end}' }],
      ['dans un <@@field> qui l\'enveloppe', { 'liste.mjs': '<@@field name="a"><@@select other></@@select></@@field>' }],
      ['dans un composant enfant', { 'parent.mjs': '<section><@enfant/></section>', 'enfant.mjs': '<@@select other></@@select>' }],
      ['dans un second fichier', { 'sans.mjs': '<@@select name="a"></@@select>', 'avec.mjs': '<@@select name="b" other></@@select>' }],
      ['dans un partiel <@include>', { '_liste.mjs': '<@@select other></@@select>', 'page.mjs': '<main><@include liste></main>' }],
      ['sur la seconde de deux listes', { 'liste.mjs': '<@@select name="a"></@@select><@@select name="b" other></@@select>' }],
      ['sur la seconde de deux listes, deux fichiers', { 'a.mjs': '<@@select name="a"></@@select>', 'b.mjs': '<p>rien</p>', 'c.mjs': '<@@select name="c" other></@@select>' }],
    ]
    for (const [nom, files] of VRAIS) {
      it(`${nom} : yes`, async function () {
        assert.equal(await otherIn(files), 'yes')
      })
    }

    it('la demande se fait aussi sans tenir compte de la casse du module et de l\'attribut', async function () {
      const bundler = bundlerOf(makeApp('attr-ecrit-casse', { 'liste.mjs': '<@@select other></@@select>' }))
      await compileOk(bundler)
      assert.equal(bundler.coreAttrWritten('SELECT', 'OTHER'), 'yes')
      assert.equal(bundler.coreAttrWritten('Select', 'Other'), 'yes')
    })
  })

  describe('détection FAUSSE', () => {
    const FAUX: [string, Files][] = [
      ['aucune liste dans l\'appli', { 'accueil.mjs': '<p>bonjour</p>' }],
      ['une appli sans aucun fichier de gabarit réel', { 'rien.mjs': '' }],
      ['des listes sans other', { 'a.mjs': '<@@select name="a" multiple search></@@select>', 'b.mjs': '<@@select name="b"></@@select>' }],
      ['deux listes dans un fichier, aucune avec other', { 'liste.mjs': '<@@select name="a"></@@select><@@select name="b" placeholder="x"></@@select>' }],
      ['other sur <@@field>, avec une liste sans other', { 'liste.mjs': '<@@field other><@@select name="a"></@@select></@@field>' }],
      ['other sur <@@option>', { 'liste.mjs': '<@@select name="a"><@@option other value="x">x</@@option></@@select>' }],
      ['other sur <@@checkbox>', { 'liste.mjs': '<@@select name="a"></@@select><@@checkbox other></@@checkbox>' }],
      ['other sur un <div> et un <input>', { 'liste.mjs': '<@@select name="a"></@@select><div other></div><input other>' }],
      ['other sur une balise personnalisée tierce', { 'liste.mjs': '<@@select name="a"></@@select><my-widget other></my-widget>' }],
      ['other dans un texte', { 'liste.mjs': '<@@select name="a">other</@@select><p>other</p>' }],
      ['other dans un commentaire HTML', { 'liste.mjs': '<@@select name="a"></@@select><!-- other --><!-- <@@select other></@@select> -->' }],
      ['other dans la valeur d\'un attribut', { 'liste.mjs': '<@@select name="other" placeholder="other" title=\'other\'></@@select>' }],
      ['other comme valeur d\'une option', { 'liste.mjs': '<@@select name="a"><@@option value="other">Autre</@@option></@@select>' }],
      ['other dans une chaîne du script', { 'liste.mjs': '<script>\n$mot = \'other\'\n$balise = \'<@@select other>\'\n</script>\n<@@select name="a"></@@select>' }],
      ['other dans un commentaire du script', { 'liste.mjs': '<script>\n# <@@select other>\n$n = 1\n</script>\n<@@select name="a"></@@select>' }],
      ['other-label et other-placeholder seuls (sans other, ils ne posent rien)', { 'liste.mjs': '<@@select name="a" other-label="Autre" other-placeholder="Précisez"></@@select>' }],
      ['un composant du projet nommé select qui écrit other', { 'select.mjs': '<p>ma liste</p>', 'page.mjs': '<@select other></@select>' }],
      ['la balise littérale d\'un composant du projet nommé select', { 'select.mjs': '<p>ma liste</p>', 'page.mjs': '<mjs-select other></mjs-select>' }],
      ['other sur un autre composant du projet', { 'carte.mjs': '<p>carte</p>', 'page.mjs': '<@carte other></@carte><@@select name="a"></@@select>' }],
    ]
    for (const [nom, files] of FAUX) {
      it(`${nom} : no`, async function () {
        assert.equal(await otherIn(files), 'no')
      })
    }

    it('une demande pour un module que personne ne référence : no', async function () {
      const bundler = bundlerOf(makeApp('attr-ecrit-autre-module', { 'liste.mjs': '<@@select other></@@select>' }))
      await compileOk(bundler)
      assert.equal(bundler.coreAttrWritten('field', 'other'), 'no')
      assert.equal(bundler.coreAttrWritten('inconnu', 'other'), 'no')
    })

    it('une demande pour un autre attribut du même module : no', async function () {
      const bundler = bundlerOf(makeApp('attr-ecrit-autre-attribut', { 'liste.mjs': '<@@select other></@@select>' }))
      await compileOk(bundler)
      assert.equal(bundler.coreAttrWritten('select', 'multiple'), 'no')
      assert.equal(bundler.coreAttrWritten('select', 'other-label'), 'no')
    })
  })

  describe('« on ne sait pas » : un étalement', () => {
    it('<@@select {...p}> : unknown', async function () {
      assert.equal(await otherIn({ 'liste.mjs': '<script>\n$p = { multiple: true }\n</script>\n<@@select {...$p}></@@select>' }), 'unknown')
    })

    it('<mjs-core-select {...p}> : unknown', async function () {
      assert.equal(await otherIn({ 'liste.mjs': '<script>\n$p = {}\n</script>\n<mjs-core-select {...$p}></mjs-core-select>' }), 'unknown')
    })

    it('un étalement dans un fichier, des listes sans other dans les autres : unknown', async function () {
      assert.equal(await otherIn({ 'a.mjs': '<@@select name="a"></@@select>', 'b.mjs': '<script>\n$p = {}\n</script>\n<@@select {...$p}></@@select>' }), 'unknown')
    })

    it('un étalement sur une liste, other écrit sur une autre : yes (l\'écrit l\'emporte sur le doute)', async function () {
      assert.equal(await otherIn({ 'a.mjs': '<script>\n$p = {}\n</script>\n<@@select {...$p}></@@select>', 'b.mjs': '<@@select other></@@select>' }), 'yes')
      assert.equal(await otherIn({ 'a.mjs': '<@@select other></@@select>', 'b.mjs': '<script>\n$p = {}\n</script>\n<@@select {...$p}></@@select>' }), 'yes')
    })

    it('un étalement et other sur la MÊME balise : yes', async function () {
      assert.equal(await otherIn({ 'liste.mjs': '<script>\n$p = {}\n</script>\n<@@select {...$p} other></@@select>' }), 'yes')
    })

    it('un étalement sur un AUTRE module cœur ou une autre balise : no', async function () {
      const files = { 'liste.mjs': '<script>\n$p = {}\n</script>\n<@@select name="a"></@@select><@@field {...$p}></@@field><div {...$p}></div>' }
      assert.equal(await otherIn(files), 'no')
    })

    it('un étalement sur un composant du projet nommé select : no', async function () {
      assert.equal(await otherIn({ 'select.mjs': '<p>ma liste</p>', 'page.mjs': '<script>\n$p = {}\n</script>\n<@select {...$p}></@select>' }), 'no')
    })

    it('l\'étalement d\'un module vaut pour CE module : la même demande pour field répond unknown, celle pour select no', async function () {
      const bundler = bundlerOf(makeApp('attr-ecrit-etalement-module', { 'liste.mjs': '<script>\n$p = {}\n</script>\n<@@field {...$p}></@@field>' }))
      await compileOk(bundler)
      assert.equal(bundler.coreAttrWritten('field', 'other'), 'unknown')
      assert.equal(bundler.coreAttrWritten('select', 'other'), 'no')
    })
  })

  describe('une référence dans un module cœur', () => {
    it('un module cœur qui écrit <@@select other> dans son gabarit : yes, une fois les références résolues', async function () {
      const catalogue = { ...CATALOGUE, 'combo.mjs': '<div><@@select other></@@select></div>' }
      assert.equal(await otherIn({ 'page.mjs': '<@@combo/>' }, catalogue), 'yes')
    })

    it('le même module, jamais référencé par l\'appli : no', async function () {
      const catalogue = { ...CATALOGUE, 'combo.mjs': '<div><@@select other></@@select></div>' }
      assert.equal(await otherIn({ 'page.mjs': '<p>rien</p>' }, catalogue), 'no')
    })

    it('un module cœur qui étale sur <@@select> : unknown', async function () {
      const catalogue = { ...CATALOGUE, 'combo.mjs': '<script>\n$p = {}\n</script>\n<div><@@select {...$p}></@@select></div>' }
      assert.equal(await otherIn({ 'page.mjs': '<@@combo/>' }, catalogue), 'unknown')
    })
  })

  describe('sur la même instance : retour du cache, puis fichier modifié', () => {
    it('deux compile() de suite, sans toucher aux fichiers : la même réponse (yes), et le second tour sert bien le cache', async function () {
      const bundler = bundlerOf(makeApp('attr-ecrit-cache-yes', { 'liste.mjs': '<@@select name="a" other></@@select>', 'autre.mjs': '<p>x</p>' }))
      await compileOk(bundler)
      assert.equal(ask(bundler), 'yes')
      await compileOk(bundler)
      assert.ok((bundler as any).cacheHitsThisCompile > 0, 'setup : le second tour doit resservir les fichiers du cache')
      assert.equal(ask(bundler), 'yes')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'yes')
    })

    it('deux compile() de suite : la même réponse (no)', async function () {
      const bundler = bundlerOf(makeApp('attr-ecrit-cache-no', { 'liste.mjs': '<@@select name="a"></@@select>', 'champ.mjs': '<@@field other></@@field>' }))
      await compileOk(bundler)
      assert.equal(ask(bundler), 'no')
      await compileOk(bundler)
      assert.ok((bundler as any).cacheHitsThisCompile > 0, 'setup : le second tour doit resservir les fichiers du cache')
      assert.equal(ask(bundler), 'no')
    })

    it('deux compile() de suite : la même réponse (unknown)', async function () {
      const bundler = bundlerOf(makeApp('attr-ecrit-cache-unknown', { 'liste.mjs': '<script>\n$p = {}\n</script>\n<@@select {...$p}></@@select>' }))
      await compileOk(bundler)
      assert.equal(ask(bundler), 'unknown')
      await compileOk(bundler)
      assert.ok((bundler as any).cacheHitsThisCompile > 0, 'setup : le second tour doit resservir les fichiers du cache')
      assert.equal(ask(bundler), 'unknown')
    })

    it('l\'attribut retiré puis remis : la réponse suit à chaque tour', async function () {
      const app = makeApp('attr-ecrit-retire-remis', { 'liste.mjs': '<@@select name="a" other></@@select>', 'autre.mjs': '<p>x</p>' })
      const bundler = bundlerOf(app)
      await compileOk(bundler)
      assert.equal(ask(bundler), 'yes')
      writeFileSync(join(app.srcDir, 'liste.mjs'), '<@@select name="a"></@@select>')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'no')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'no')
      writeFileSync(join(app.srcDir, 'liste.mjs'), '<@@select name="a" other="30"></@@select>')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'yes')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'yes')
    })

    it('l\'attribut retiré d\'un fichier, resté dans un autre (resservi par le cache) : yes tant qu\'un fichier l\'écrit', async function () {
      const app = makeApp('attr-ecrit-deux-fichiers', { 'a.mjs': '<@@select name="a" other></@@select>', 'b.mjs': '<@@select name="b" other></@@select>' })
      const bundler = bundlerOf(app)
      await compileOk(bundler)
      assert.equal(ask(bundler), 'yes')
      writeFileSync(join(app.srcDir, 'a.mjs'), '<@@select name="a"></@@select>')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'yes')
      writeFileSync(join(app.srcDir, 'b.mjs'), '<@@select name="b"></@@select>')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'no')
    })

    it('un étalement ajouté puis retiré : unknown puis no', async function () {
      const app = makeApp('attr-ecrit-etalement-va-vient', { 'liste.mjs': '<@@select name="a"></@@select>' })
      const bundler = bundlerOf(app)
      await compileOk(bundler)
      assert.equal(ask(bundler), 'no')
      writeFileSync(join(app.srcDir, 'liste.mjs'), '<script>\n$p = {}\n</script>\n<@@select name="a" {...$p}></@@select>')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'unknown')
      writeFileSync(join(app.srcDir, 'liste.mjs'), '<@@select name="a"></@@select>')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'no')
    })

    it('un fichier ajouté qui écrit other, puis retiré : yes puis no', async function () {
      const app = makeApp('attr-ecrit-fichier-va-vient', { 'liste.mjs': '<@@select name="a"></@@select>' })
      const bundler = bundlerOf(app)
      await compileOk(bundler)
      assert.equal(ask(bundler), 'no')
      writeFileSync(join(app.srcDir, 'nouvelle.mjs'), '<@@select name="b" other></@@select>')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'yes')
      rmSync(join(app.srcDir, 'nouvelle.mjs'))
      await compileOk(bundler)
      assert.equal(ask(bundler), 'no')
    })

    it('le composant qui écrit other est un enfant resservi par le cache : la réponse reste yes quand seul le parent change', async function () {
      const app = makeApp('attr-ecrit-enfant-cache', { 'parent.mjs': '<section><@enfant/></section>', 'enfant.mjs': '<@@select other></@@select>' })
      const bundler = bundlerOf(app)
      await compileOk(bundler)
      assert.equal(ask(bundler), 'yes')
      writeFileSync(join(app.srcDir, 'parent.mjs'), '<section><h1>titre</h1><@enfant/></section>')
      await compileOk(bundler)
      assert.ok((bundler as any).cacheHitsThisCompile > 0, 'setup : l\'enfant inchangé doit venir du cache')
      assert.equal(ask(bundler), 'yes')
    })

    it('le partiel change (other retiré) : le fichier qui l\'inclut est recompilé, la réponse suit', async function () {
      const app = makeApp('attr-ecrit-partiel-change', { '_liste.mjs': '<@@select other></@@select>', 'page.mjs': '<main><@include liste></main>' })
      const bundler = bundlerOf(app)
      await compileOk(bundler)
      assert.equal(ask(bundler), 'yes')
      writeFileSync(join(app.srcDir, '_liste.mjs'), '<@@select name="a"></@@select>')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'no')
    })

    it('en fichier unique (js: bundle) : la même réponse au second tour, puis après modification', async function () {
      const app = makeApp('attr-ecrit-bundle', { 'liste.mjs': '<@@select name="a" other></@@select>', 'autre.mjs': '<p>x</p>' })
      const bundler = bundlerOf(app, { js: 'bundle', css: 'bundle' })
      await compileOk(bundler)
      assert.equal(ask(bundler), 'yes')
      await compileOk(bundler)
      assert.ok((bundler as any).cacheHitsThisCompile > 0, 'setup : le second tour doit resservir les fichiers du cache')
      assert.equal(ask(bundler), 'yes')
      writeFileSync(join(app.srcDir, 'liste.mjs'), '<@@select name="a"></@@select>')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'no')
    })
  })

  describe('une appli de plus de 40 fichiers (chemin du pool de workers)', function () {
    this.timeout(120000)

    function bigApp(prefix: string, listeSource: string): App {
      const files: Files = { 'liste.mjs': listeSource }
      for (let i = 1; i <= 44; i++) files[`comp${i}.mjs`] = `<p class="t">comp${i}</p>`
      return makeApp(prefix, files)
    }

    beforeEach(async () => { await terminateSharedWorkerPool() })

    it('45 fichiers : le pool est créé et la réponse est yes', async function () {
      const bundler = bundlerOf(bigApp('attr-ecrit-pool-yes', '<@@select name="a" other></@@select>'))
      await compileOk(bundler)
      assert.equal(isSharedWorkerPoolAlive(), true, 'setup : au-dessus de 40 fichiers, le pool de threads doit être créé')
      assert.equal(ask(bundler), 'yes')
    })

    it('45 fichiers : no, puis unknown pour un étalement', async function () {
      const sans = bundlerOf(bigApp('attr-ecrit-pool-no', '<@@select name="a"></@@select>'))
      await compileOk(sans)
      assert.equal(isSharedWorkerPoolAlive(), true)
      assert.equal(ask(sans), 'no')
      const etale = bundlerOf(bigApp('attr-ecrit-pool-unknown', '<script>\n$p = {}\n</script>\n<@@select name="a" {...$p}></@@select>'))
      await compileOk(etale)
      assert.equal(ask(etale), 'unknown')
    })

    it('45 fichiers, deux compile() de suite (retour du cache), puis le fichier modifié', async function () {
      const app = bigApp('attr-ecrit-pool-cache', '<@@select name="a" other></@@select>')
      const bundler = bundlerOf(app)
      await compileOk(bundler)
      assert.equal(ask(bundler), 'yes')
      await compileOk(bundler)
      assert.ok((bundler as any).cacheHitsThisCompile > 0, 'setup : le second tour doit resservir les fichiers du cache')
      assert.equal(ask(bundler), 'yes')
      writeFileSync(join(app.srcDir, 'liste.mjs'), '<@@select name="a"></@@select>')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'no')
      writeFileSync(join(app.srcDir, 'liste.mjs'), '<@@select name="a" other></@@select>')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'yes')
    })

    it('petite appli, pool forcé (inlineTranspileLimit: 0) : la même réponse que sans pool', async function () {
      for (const [source, reponse] of [['<@@select other></@@select>', 'yes'], ['<@@select name="a"></@@select>', 'no']] as const) {
        const app = makeApp('attr-ecrit-pool-force', { 'liste.mjs': source })
        const bundler = bundlerOf(app, { inlineTranspileLimit: 0 })
        await compileOk(bundler)
        assert.equal(isSharedWorkerPoolAlive(), true, 'setup : le pool doit être créé')
        assert.equal(ask(bundler), reponse)
      }
    })
  })

  describe('le catalogue cœur réel (<@@select> du framework)', function () {
    this.timeout(90000)

    it('<@@select other> : yes, deux tours de suite', async function () {
      const bundler = bundlerOf(makeApp('attr-ecrit-reel-yes', { 'liste.mjs': '<@@select name="pays" other>\n  <@@option value="fr">France</@@option>\n</@@select>' }, null))
      await compileOk(bundler)
      assert.equal(ask(bundler), 'yes')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'yes')
    })

    it('<@@select> sans other : no, deux tours de suite', async function () {
      const bundler = bundlerOf(makeApp('attr-ecrit-reel-no', { 'liste.mjs': '<@@select name="pays" multiple search>\n  <@@option value="fr">France</@@option>\n</@@select>' }, null))
      await compileOk(bundler)
      assert.equal(ask(bundler), 'no')
      await compileOk(bundler)
      assert.equal(ask(bundler), 'no')
    })

    it('<@@select {...p}> : unknown', async function () {
      const bundler = bundlerOf(makeApp('attr-ecrit-reel-unknown', { 'liste.mjs': '<script>\n$p = {}\n</script>\n<@@select {...$p}></@@select>' }, null))
      await compileOk(bundler)
      assert.equal(ask(bundler), 'unknown')
    })

    it('aucune liste, mais d\'autres modules cœur (dont <@@field other>) : no', async function () {
      const bundler = bundlerOf(makeApp('attr-ecrit-reel-sans-liste', { 'page.mjs': '<@@field name="a" other><@@checkbox name="b"></@@checkbox></@@field>' }, null))
      await compileOk(bundler)
      assert.equal(ask(bundler), 'no')
    })
  })

  describe('la méthode sur des références posées à la main', () => {
    function withRefs(refs: unknown[]): Bundler {
      const bundler = new Bundler({ sourceDir: '/nulle/part/src', outputDir: '/nulle/part/out', manifestPath: '/nulle/part/bundle.js' })
      ;(bundler as any).pendingTagRefs = refs
      // les références du projet sont toutes lues : sans cela, la méthode ne se prononce pas (cf. tests/bundler-coeur-tri-autre.test.ts)
      ;(bundler as any).tagRefsComplete = true
      return bundler
    }
    const spread  = { names: [], spread: true }
    const written = { names: ['name', 'other'], spread: false }
    const plain   = { names: ['name'], spread: false }

    it('aucune référence : no', () => {
      assert.equal(ask(withRefs([])), 'no')
    })

    it('une référence au module cœur qui n\'a pas rapporté ses attributs : unknown (le doute vaut oui)', () => {
      assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'select', kind: 'raccourci-coeur' }])), 'unknown')
      assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'select', kind: 'litteral-coeur' }])), 'unknown')
    })

    it('une référence au projet nommée select, même avec other : no', () => {
      assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'select', kind: 'raccourci-dev', attrs: written }])), 'no')
      assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'select', kind: 'litteral-dev', attrs: written }])), 'no')
      assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'select', kind: 'raccourci-mjs-retire', attrs: written }])), 'no')
    })

    it('une référence à un autre module cœur ou au modèle select--compact, même avec other : no', () => {
      assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'field', kind: 'raccourci-coeur', attrs: written }])), 'no')
      assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'select--compact', kind: 'raccourci-coeur', attrs: written }])), 'no')
    })

    it('la casse du nom de la référence et celle des noms d\'attribut ne comptent pas', () => {
      assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'Select', kind: 'litteral-coeur', attrs: { names: ['OTHER'], spread: false } }])), 'yes')
    })

    it('yes l\'emporte sur unknown, quel que soit l\'ordre des références', () => {
      const a = { file: 'a.mjs', name: 'select', kind: 'raccourci-coeur', attrs: spread }
      const b = { file: 'b.mjs', name: 'select', kind: 'raccourci-coeur', attrs: written }
      assert.equal(ask(withRefs([a, b])), 'yes')
      assert.equal(ask(withRefs([b, a])), 'yes')
    })

    it('unknown l\'emporte sur no', () => {
      const a = { file: 'a.mjs', name: 'select', kind: 'raccourci-coeur', attrs: plain }
      const b = { file: 'b.mjs', name: 'select', kind: 'raccourci-coeur', attrs: spread }
      assert.equal(ask(withRefs([a, b])), 'unknown')
      assert.equal(ask(withRefs([b, a])), 'unknown')
    })

    it('les références sont lues à chaque appel : la liste remplacée change la réponse', () => {
      const bundler = withRefs([{ file: 'a.mjs', name: 'select', kind: 'raccourci-coeur', attrs: written }])
      assert.equal(ask(bundler), 'yes')
      ;(bundler as any).pendingTagRefs = [{ file: 'a.mjs', name: 'select', kind: 'raccourci-coeur', attrs: plain }]
      assert.equal(ask(bundler), 'no')
    })
  })
})
