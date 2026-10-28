// Prérendu — le HTML rendu porte les feuilles partagées que le composant déclare par `@css`.
//
// Le saut mesuré : sur une connexion lente, une page prérendue changeait de géométrie au démarrage
// du JavaScript (/doc : 1 580 → 1 984 px de haut, /tuto : 1 228 → 900 px). Cause : le fragment ne
// portait que la feuille PROPRE du composant ; les feuilles partagées (`<style @css="a b">`, des
// fichiers du dossier des feuilles) n'existent que dans le registre du cœur (`µ.CSS`) et le
// navigateur les adopte au montage — le HTML prérendu, lui, n'en avait aucune. Sans JavaScript, le
// panneau latéral occupait toute la largeur ; avec, 280 px.
//
// Ce fichier garde le rendu SERVEUR : chaque racine d'ombre du fragment porte, AVANT la feuille
// propre (même cascade que le navigateur : héritées, puis déclarées, puis propre), les feuilles
// qu'elle déclare, dans l'ordre déclaré. Un composant sans `@css` sort inchangé à l'octet. Le
// volet navigateur (géométrie avant/après démarrage, feuille prérendue retirée à l'adoption) est
// dans prerendu-feuilles-partagees-browser.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString, createSSRRenderer } from '../src/server/renderToString.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'
import { Bundler } from '../src/bundler/index.js'
import { ecrireFeuilleRendu, feuillesConsignees } from '../src/server/sorties-rendu.js'

after(() => sweepRegistered())

interface Projet { srcDir: string; stylesDir: string }

// trois feuilles partagées reconnaissables à leur sélecteur ; `b` réécrit une règle de `a`, pour
// que l'ordre des feuilles se lise dans le HTML
function fixture(prefix: string): Projet {
  const root      = mjsTmp(prefix)
  const srcDir    = join(root, 'src')
  const stylesDir = join(root, 'styles')
  mkdirSync(srcDir, { recursive: true })
  mkdirSync(stylesDir, { recursive: true })
  writeFileSync(join(stylesDir, 'feuille-a.css'), '.zone-a { position: fixed; width: 280px }\n')
  writeFileSync(join(stylesDir, 'feuille-b.css'), '.zone-b { margin-left: 280px }\n')
  writeFileSync(join(stylesDir, 'feuille-c.css'), '.zone-c { color: teal }\n')
  return { srcDir, stylesDir }
}

// cœur sans le module du thème : un projet qui n'en a pas l'usage n'adopte (donc ne prérend) aucune feuille de thème
const SANS_THEME = { runtime: 'core' } as any

const ecrire = (p: Projet, nom: string, source: string): void => writeFileSync(join(p.srcDir, nom), source)

describe('prérendu — feuilles partagées (@css) dans le HTML rendu', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('composant avec @css : chaque feuille déclarée est dans la racine d\'ombre, dans l\'ordre déclaré', async function () {
    const p = fixture('prerendu-partagees-ordre')
    ecrire(p, 'panneau.mjs', '<aside class="zone-a">A</aside>\n<main class="zone-b">B</main>\n<style @css="feuille-b feuille-a">\n  .propre\n    color: red\n</style>\n')
    const res = await renderToString({ sourceDir: p.srcDir, stylesheetsDir: p.stylesDir, tag: 'mjs-panneau' })
    const ia = res.html.indexOf('.zone-a')
    const ib = res.html.indexOf('.zone-b')
    const ip = res.html.indexOf('.propre')
    assert.ok(ia > -1, `la feuille feuille-a doit être dans le fragment — HTML : ${res.html}`)
    assert.ok(ib > -1, `la feuille feuille-b doit être dans le fragment — HTML : ${res.html}`)
    assert.ok(ib < ia, 'les feuilles gardent l\'ordre de la déclaration (b avant a)')
    assert.ok(ia < ip, 'la feuille propre vient APRÈS les partagées et garde le dernier mot, comme au navigateur')
    assert.doesNotMatch(res.html, /zone-c/, 'une feuille que le composant ne déclare pas n\'est pas portée')
  })

  it('le texte de la feuille voyage tel que compilé (règles intactes)', async function () {
    const p = fixture('prerendu-partagees-texte')
    ecrire(p, 'panneau.mjs', '<aside class="zone-a">A</aside>\n<style @css="feuille-a"></style>\n')
    const res = await renderToString({ sourceDir: p.srcDir, stylesheetsDir: p.stylesDir, tag: 'mjs-panneau' })
    assert.match(res.html, /<style>[^<]*\.zone-a\s*\{[^}]*position:\s*fixed[^}]*width:\s*280px[^}]*\}[^<]*<\/style>/, `la règle du panneau fixe doit être portée — HTML : ${res.html}`)
  })

  it('sous-composant à ombre propre : sa racine porte SES feuilles déclarées, pas celles du parent', async function () {
    const p = fixture('prerendu-partagees-imbrique')
    ecrire(p, 'enfant.mjs', '<p class="zone-c">E</p>\n<style @css="feuille-c"></style>\n')
    ecrire(p, 'parent.mjs', '<aside class="zone-a">P</aside>\n<@enfant>\n<style @css="feuille-a"></style>\n')
    const res = await renderToString({ sourceDir: p.srcDir, stylesheetsDir: p.stylesDir, tag: 'mjs-parent' })
    const [parent, enfant] = res.html.split('<mjs-enfant')
    assert.match(parent, /\.zone-a/, 'la racine du parent porte feuille-a')
    assert.doesNotMatch(parent, /\.zone-c/, 'la racine du parent ne porte pas feuille-c')
    assert.match(enfant, /\.zone-c/, 'la racine de l\'enfant porte feuille-c')
    assert.doesNotMatch(enfant, /\.zone-a/, 'la racine de l\'enfant ne porte pas feuille-a')
  })

  it('composant léger (sans ombre) : aucune feuille partagée ajoutée, il n\'en adopte pas au navigateur non plus', async function () {
    const p = fixture('prerendu-partagees-leger')
    ecrire(p, 'leger.mjs', '<p class="zone-a">L</p>\n<style @css="feuille-a">\n  .propre\n    color: red\n</style>\n')
    const res = await renderToString({ sourceDir: p.srcDir, stylesheetsDir: p.stylesDir, tag: 'mjs-leger', light: true })
    assert.doesNotMatch(res.html, /position:\s*fixed/, `un léger n'adopte pas de feuille partagée — HTML : ${res.html}`)
    assert.match(res.html, /\.propre/, 'sa feuille propre reste portée')
  })

  it('feuille partagée vide (absente du registre) : rendu sans erreur, aucune balise parasite', async function () {
    const p = fixture('prerendu-partagees-vide')
    writeFileSync(join(p.stylesDir, 'feuille-vide.css'), '\n')
    ecrire(p, 'panneau.mjs', '<p>X</p>\n<style @css="feuille-vide">\n  .propre\n    color: red\n</style>\n')
    const res = await renderToString({ sourceDir: p.srcDir, stylesheetsDir: p.stylesDir, tag: 'mjs-panneau', bundlerOpts: SANS_THEME })
    assert.equal((res.html.match(/<style>/g) ?? []).length, 1, `seule la feuille propre est portée — HTML : ${res.html}`)
  })

  it('composant sans @css : sortie inchangée à l\'octet', async function () {
    const p = fixture('prerendu-partagees-sans')
    ecrire(p, 'simple.mjs', '<p class="propre">S</p>\n<style>\n  .propre\n    color: red\n</style>\n')
    const res = await renderToString({ sourceDir: p.srcDir, stylesheetsDir: p.stylesDir, tag: 'mjs-simple', bundlerOpts: SANS_THEME })
    assert.equal(res.html, '<mjs-simple mjs-ssr><template shadowrootmode="open"><style>:host{display:block}:host([hidden]:not([hidden=until-found i])){display:none}.propre{color:red}</style><p class="propre">S</p></template></mjs-simple>')
  })

  it('mode strict (csp) : chaque feuille partagée sort en <link> vers un fichier, jamais en <style> en ligne', async function () {
    const p = fixture('prerendu-partagees-csp')
    ecrire(p, 'panneau.mjs', '<aside class="zone-a">A</aside>\n<style @css="feuille-a feuille-b">\n  .propre\n    color: red\n</style>\n')
    const res = await renderToString({ sourceDir: p.srcDir, stylesheetsDir: p.stylesDir, tag: 'mjs-panneau', csp: true, css: 'split', bundlerOpts: SANS_THEME })
    assert.doesNotMatch(res.html, /<style/, `aucun <style> en ligne sous csp — HTML : ${res.html}`)
    assert.equal((res.html.match(/<link rel="stylesheet" href="[^"]+\.css">/g) ?? []).length, 3, `deux feuilles partagées + la feuille propre — HTML : ${res.html}`)
  })

  // même contrat pour le rendu par navigateur (`engine: 'browser'`) : mêmes feuilles, même ordre
  it('moteur navigateur : les feuilles partagées sont dans la racine d\'ombre, avant la feuille propre', async function () {
    this.timeout(90000)
    try {
      const playwright = await import('playwright')
      if(!existsSync(playwright.chromium.executablePath())) return this.skip()
    }
    catch { return this.skip() }
    const p    = fixture('prerendu-partagees-navigateur')
    const root = join(p.srcDir, '..')
    ecrire(p, 'panneau.mjs', '<aside class="zone-a">A</aside>\n<style @css="feuille-b feuille-a">\n  .propre\n    color: red\n</style>\n')
    const renderer = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out', stylesheetsDir: 'styles' } as any, { configDir: root })
    try {
      const res = await renderer.renderPage('mjs-panneau')
      const ia = res.html.indexOf('.zone-a')
      const ib = res.html.indexOf('.zone-b')
      const ip = res.html.indexOf('.propre')
      assert.ok(ia > -1 && ib > -1, `les deux feuilles partagées doivent être dans le fragment — HTML : ${res.html}`)
      assert.ok(ib < ia && ia < ip, 'ordre : feuille-b, feuille-a (déclaré), puis la feuille propre')
      assert.match(res.html, /position:\s*fixed/, 'la règle du panneau fixe est portée')
    }
    finally {
      await renderer.close()
    }
  })
})

// Poids du HTML prérendu. Chaque racine d'ombre porte ses feuilles partagées (une racine d'ombre ne
// voit pas les feuilles d'une autre) : une page de 300 composants identiques qui déclarent une
// feuille de 37 Ko passait de 48 Ko à 11,4 Mo de HTML (1,37 Mo compressé), la feuille écrite 300 fois.
// La règle (renderToString.ts, `choisirFormeFeuille`) : une feuille partagée reste en `<style>` en
// ligne tant que la répéter ne coûte presque rien — surcoût (occurrences - 1) x taille sous 8 Ko, et
// c'est le cas d'une page ordinaire (une racine, quelques feuilles de quelques Ko) — et sort en
// `<link rel="stylesheet">` vers UN fichier à empreinte de contenu au-delà : même URL pour toutes les
// racines, donc UNE requête et un cache partagé entre les pages. Le rendu à la requête et le
// prérendu passent par le même code ; sans dossier de sortie à eux (rendu ponctuel), il n'y a aucun
// fichier à servir : tout reste en ligne.
const grosseFeuille = (octets: number): string => {
  let css = ''
  for(let i = 0; css.length < octets; i++) css += `.regle-${i} { color: #${(100000 + i).toString(16).slice(0, 6)}; margin: ${i % 40}px }\n`
  return css
}

describe('prérendu — poids des feuilles partagées sur une page à nombreuses racines', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  async function rendre(p: Projet, tag: string, extra: any = {}): Promise<{ html: string; sortie: string }> {
    const sortie   = join(p.srcDir, '..', 'sortie')
    const renderer = await createSSRRenderer({ sourceDir: p.srcDir, outputDir: sortie, manifestPath: join(sortie, 'bundle.js'), stylesheetsDir: p.stylesDir, bundlerOpts: { urlPrefix: '/sortie', ...SANS_THEME }, ...extra })
    try {
      return { html: (await renderer.renderToString(tag)).html, sortie }
    }
    finally {
      await renderer.close()
    }
  }
  const liens = (html: string): string[] => [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1])
  const cssEcrits = (sortie: string): string[] => readdirSync(sortie).filter(f => /^mjs_ssr_style_partagee-.*\.css$/.test(f))

  it('300 composants identiques, une feuille partagée de 30 Ko : HTML sous 80 Ko (au lieu de 9 Mo), UNE feuille liée, écrite une seule fois', async function () {
    const p = fixture('prerendu-poids-300')
    writeFileSync(join(p.stylesDir, 'feuille-grosse.css'), grosseFeuille(30000))
    ecrire(p, 'carte.mjs', '<p class="zone-a">C</p>\n<style @css="feuille-grosse">\n  .propre\n    color: red\n</style>\n')
    ecrire(p, 'liste.mjs', '<section>\n' + '<@carte></@carte>\n'.repeat(300) + '</section>\n')
    const { html, sortie } = await rendre(p, 'mjs-liste')
    assert.ok(html.length < 90000, `HTML de ${html.length} octets (57 Ko de feuilles propres, la règle de \`hidden\` comprise, + un lien d'environ 80 octets par racine) : la feuille de 30 Ko ne doit pas être répétée par racine`)
    assert.equal((html.match(/<style>/g) ?? []).length, 301, 'chaque racine garde sa feuille PROPRE en ligne (petite)')
    assert.equal(liens(html).length, 300, 'chaque carte désigne la feuille partagée par un <link>')
    assert.equal(new Set(liens(html)).size, 1, 'une seule URL : le navigateur ne la demande qu\'une fois')
    assert.equal(cssEcrits(sortie).length, 1, `un seul fichier écrit — vu : ${cssEcrits(sortie)}`)
    assert.equal(readFileSync(join(sortie, cssEcrits(sortie)[0]), 'utf-8').includes('.regle-0 '), true, 'le fichier porte la feuille')
  })

  it('une racine (ou peu de racines) : la feuille reste en ligne, aucune requête de plus', async function () {
    const p = fixture('prerendu-poids-petit')
    ecrire(p, 'carte.mjs', '<p class="zone-a">C</p>\n<style @css="feuille-a"></style>\n')
    ecrire(p, 'liste.mjs', '<section>\n' + '<@carte></@carte>\n'.repeat(3) + '</section>\n')
    const { html, sortie } = await rendre(p, 'mjs-liste')
    assert.deepEqual(liens(html), [], `trois racines d'une feuille de 40 octets : surcoût négligeable, tout en ligne — HTML : ${html.slice(0, 400)}`)
    assert.equal((html.match(/position:\s*fixed/g) ?? []).length, 3)
    assert.deepEqual(cssEcrits(sortie), [], 'aucun fichier écrit')
  })

  it('une seule racine avec une feuille de 30 Ko : en ligne (le lien ne ferait que coûter une requête)', async function () {
    const p = fixture('prerendu-poids-une')
    writeFileSync(join(p.stylesDir, 'feuille-grosse.css'), grosseFeuille(30000))
    ecrire(p, 'carte.mjs', '<p class="zone-a">C</p>\n<style @css="feuille-grosse"></style>\n')
    const { html } = await rendre(p, 'mjs-carte')
    assert.deepEqual(liens(html), [])
    assert.ok(html.includes('.regle-0 '), 'la feuille est dans le HTML')
  })

  it('trois racines et une feuille de 30 Ko : surcoût 60 Ko, donc liée ; la même feuille de 3 Ko reste en ligne', async function () {
    const p = fixture('prerendu-poids-trois')
    writeFileSync(join(p.stylesDir, 'feuille-grosse.css'), grosseFeuille(30000))
    writeFileSync(join(p.stylesDir, 'feuille-moyenne.css'), grosseFeuille(3000))
    ecrire(p, 'grosse.mjs', '<p>G</p>\n<style @css="feuille-grosse"></style>\n')
    ecrire(p, 'moyenne.mjs', '<p>M</p>\n<style @css="feuille-moyenne"></style>\n')
    ecrire(p, 'page-g.mjs', '<@grosse></@grosse><@grosse></@grosse><@grosse></@grosse>\n')
    ecrire(p, 'page-m.mjs', '<@moyenne></@moyenne><@moyenne></@moyenne><@moyenne></@moyenne>\n')
    const g = await rendre(p, 'mjs-page-g')
    assert.equal(liens(g.html).length, 3)
    assert.ok(g.html.length < 3000, `HTML de ${g.html.length} octets`)
    const m = await rendre(p, 'mjs-page-m')
    assert.deepEqual(liens(m.html), [], 'trois racines de 3 Ko : 6 Ko de surcoût, sous le seuil')
  })

  it('rendu ponctuel sans dossier de sortie : aucun fichier à servir, tout reste en ligne', async function () {
    const p = fixture('prerendu-poids-ponctuel')
    writeFileSync(join(p.stylesDir, 'feuille-grosse.css'), grosseFeuille(30000))
    ecrire(p, 'carte.mjs', '<p class="zone-a">C</p>\n<style @css="feuille-grosse"></style>\n')
    ecrire(p, 'liste.mjs', '<section>\n' + '<@carte></@carte>\n'.repeat(3) + '</section>\n')
    const res = await renderToString({ sourceDir: p.srcDir, stylesheetsDir: p.stylesDir, tag: 'mjs-liste', bundlerOpts: SANS_THEME })
    assert.deepEqual(liens(res.html), [])
    assert.equal((res.html.match(/\.regle-0 /g) ?? []).length, 3, 'la feuille est en ligne dans chaque racine')
  })
})

// Le thème et le `@import`. Le navigateur adopte dans chaque racine d'ombre, juste après la remise à
// zéro, la feuille du thème (clair/sombre embarqué, puis thèmes de l'application) : sans elle, un
// élément `theme="…"` écrit dans la racine n'a pas ses variables avant le démarrage du JavaScript et
// la page saute (mesuré : 1 000 -> 77 px). Et `replaceSync`, par lequel le navigateur adopte une
// feuille partagée, IGNORE les `@import` : le texte prérendu doit les ignorer aussi, sinon son
// `<style>` demande un fichier relatif (404) que la page démarrée n'a jamais demandé.
describe('prérendu — thème, modèle et @import des feuilles partagées', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('feuille du thème : portée dans la racine, après la remise à zéro et avant les feuilles déclarées', async function () {
    const p = fixture('prerendu-theme')
    writeFileSync(join(p.stylesDir, 'mjs_reset.css'), '.reset-marque { margin: 0 }\n')
    ecrire(p, 'sombre.theme.mjs', '<theme>\n  $$gapv: 77px\n</theme>\n')
    ecrire(p, 'fiche.mjs', '<div class="zone-a propre" theme="sombre">F</div>\n<style @css="feuille-a">\n  .propre\n    width: $$gapv\n</style>\n')
    const res = await renderToString({ sourceDir: p.srcDir, stylesheetsDir: p.stylesDir, tag: 'mjs-fiche' })
    const ir = res.html.indexOf('.reset-marque')
    const it = res.html.indexOf('--mjs-surface')
    const ia = res.html.indexOf('.zone-a')
    assert.ok(ir > -1 && it > -1 && ia > -1, `remise à zéro, thème et feuille déclarée sont portés — HTML : ${res.html.slice(0, 600)}`)
    assert.ok(ir < it && it < ia, 'même ordre que le navigateur : remise à zéro, thème, feuilles déclarées')
    assert.match(res.html, /gapv[^}]*77px/, `le thème de l'application est porté aussi — HTML : ${res.html.slice(0, 1500)}`)
  })

  it('composant sans thème dans le projet : aucune feuille de thème ajoutée', async function () {
    const p = fixture('prerendu-sans-theme')
    ecrire(p, 'fiche.mjs', '<div class="zone-a">F</div>\n<style @css="feuille-a"></style>\n')
    const res = await renderToString({ sourceDir: p.srcDir, stylesheetsDir: p.stylesDir, tag: 'mjs-fiche', bundlerOpts: SANS_THEME })
    assert.doesNotMatch(res.html, /--mjs-surface/)
  })

  // la feuille d'un modèle (`layout="alt"` + `<style name="alt">`) est appliquée pendant le rendu : elle est portée après les
  // feuilles partagées et la feuille propre, comme le montage l'adopte, et sa balise porte l'adresse de son fichier (`mjs-layout`)
  it('modèle (layout="alt") : sa feuille est portée après les feuilles partagées et la feuille propre', async function () {
    const p = fixture('prerendu-modele')
    ecrire(p, 'carte.mjs', '<div class="zone-a">C</div>\n<style @css="feuille-a">\n  .propre\n    color: red\n</style>\n<style name="alt">\n  .variante-alt\n    width: 555px\n</style>\n')
    ecrire(p, 'page.mjs', '<@carte layout="alt"></@carte>\n')
    const res = await renderToString({ sourceDir: p.srcDir, stylesheetsDir: p.stylesDir, tag: 'mjs-page' })
    const im = res.html.indexOf('variante-alt')
    assert.ok(im > -1, `la feuille du modèle est dans le HTML prérendu — HTML : ${res.html.slice(0, 1500)}`)
    assert.ok(res.html.indexOf('.zone-a') > -1 && res.html.indexOf('.zone-a') < im, 'la feuille partagée de la carte est portée, avant celle du modèle')
    assert.ok(res.html.indexOf('.propre') > -1 && res.html.indexOf('.propre') < im, 'la feuille propre de la carte est portée, avant celle du modèle')
    assert.match(res.html, /<style mjs-layout="[^"]*carte\.alt\.css[^"]*">[^<]*variante-alt/, 'sa balise porte l\'adresse du fichier du modèle')
  })

  it('@import dans une feuille partagée : retiré du texte prérendu, le reste de la feuille est porté', async function () {
    const p = fixture('prerendu-import')
    writeFileSync(join(p.stylesDir, 'feuille-imp.css'), '@import url("feuille-a.css");\n@import "feuille-b.css" screen;\n.zone-i { width: 777px }\n')
    ecrire(p, 'fiche.mjs', '<div class="zone-i">F</div>\n<style @css="feuille-imp"></style>\n')
    const res = await renderToString({ sourceDir: p.srcDir, stylesheetsDir: p.stylesDir, tag: 'mjs-fiche' })
    assert.doesNotMatch(res.html, /@import/, `le navigateur ignore @import dans une feuille construite — HTML : ${res.html}`)
    assert.match(res.html, /\.zone-i\s*\{\s*width:\s*777px/, 'la règle de la feuille est portée')
    assert.doesNotMatch(res.html, /position:\s*fixed/, 'la feuille importée n\'est pas inlinée (le navigateur non plus)')
  })
})

// Fichiers de feuilles partagées écrits par le rendu : ils entrent au registre des sorties du build
// (`.mjs-outputs.json`, clé `ssrStyles`) pour que la purge de fin de build retire ceux qu'aucun
// prérendu n'a réécrits — et seulement ceux-là. Avant, tout `mjs_ssr_style…` était exempté de purge
// et s'accumulait à chaque changement de feuille.
describe('prérendu — fichiers de feuilles partagées et purge du build', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('une feuille écrite est consignée au registre ; la purge retire les anciennes consignées, jamais celle du rendu, jamais un fichier inconnu', async function () {
    const root = mjsTmp('prerendu-purge-feuilles')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'a.mjs'), '<p>a</p>\n')
    const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0)
    const registre = (): any => JSON.parse(readFileSync(join(out, '.mjs-outputs.json'), 'utf-8'))
    // un ancien prérendu avait écrit celle-ci (consignée à la main : ce processus ne l'a pas réécrite)
    const ancienne = 'mjs_ssr_style_partagee-feuille-a-deadbeef.css'
    writeFileSync(join(out, ancienne), '.ancienne{}')
    const brut = registre(); brut.ssrStyles = [ancienne]
    writeFileSync(join(out, '.mjs-outputs.json'), JSON.stringify(brut))
    const inconnue = 'mjs_ssr_style_partagee-autre-cafebabe.css'
    writeFileSync(join(out, inconnue), '.inconnue{}')
    const url = ecrireFeuilleRendu(out, '/o', 'partagee-feuille-b', '.courante { color: red }')
    const courante = url.split('/').pop()!
    assert.ok(feuillesConsignees(out).includes(courante), 'la feuille écrite est consignée')
    const bilan = bundler.pruneOrphans()
    assert.deepEqual(bilan.removed.filter(n => n.startsWith('mjs_ssr_style')), [ancienne], `seule l'ancienne consignée est retirée — retirés : ${bilan.removed}`)
    assert.ok(existsSync(join(out, courante)), 'la feuille que ce rendu a écrite reste')
    assert.ok(existsSync(join(out, inconnue)), 'un fichier absent du registre n\'est pas du build : intact')
    assert.deepEqual(registre().ssrStyles, [courante], 'le registre ne garde que ce qui existe encore')
    await bundler.close()
  })
})

// Même contrat pour le rendu par navigateur (`engine: 'browser'`) : les deux moteurs rendent la même
// forme (feuille liée au-delà du seuil, thème porté, `@import` absent), sinon la page changerait
// d'allure selon le moteur choisi.
describe('prérendu — moteur navigateur : feuilles liées, thème et @import alignés sur happy-dom', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  async function avecNavigateur(this: Mocha.Context, p: Projet, tag: string): Promise<{ html: string; sortie: string } | null> {
    try {
      const playwright = await import('playwright')
      if(!existsSync(playwright.chromium.executablePath())) return null
    }
    catch { return null }
    const root     = join(p.srcDir, '..')
    const renderer = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out', stylesheetsDir: 'styles' } as any, { configDir: root })
    try {
      return { html: (await renderer.renderPage(tag)).html, sortie: join(root, 'out') }
    }
    finally {
      await renderer.close()
    }
  }
  const liens = (html: string): string[] => [...html.matchAll(/<link [^>]*href="([^"]+)"[^>]*>/g)].map(m => m[1])

  it('300 composants et une feuille de 30 Ko : un seul fichier lié, HTML sous 110 Ko', async function () {
    const p = fixture('prerendu-navigateur-300')
    writeFileSync(join(p.stylesDir, 'feuille-grosse.css'), grosseFeuille(30000))
    ecrire(p, 'carte.mjs', '<p class="zone-a">C</p>\n<style @css="feuille-grosse"></style>\n')
    ecrire(p, 'liste.mjs', '<section>\n' + '<@carte></@carte>\n'.repeat(300) + '</section>\n')
    const r = await avecNavigateur.call(this, p, 'mjs-liste')
    if(!r) return this.skip()
    assert.ok(r.html.length < 110000, `HTML de ${r.html.length} octets`)
    const l = liens(r.html).filter(h => h.includes('partagee-feuille-grosse'))
    assert.equal(l.length, 300, 'une balise par carte')
    assert.equal(new Set(l).size, 1, 'une seule URL')
    assert.equal((r.html.match(/\.regle-0 /g) ?? []).length, 0, 'la feuille n\'est écrite nulle part en ligne')
  })

  it('une feuille partagée sous le seuil reste en ligne ; le @import n\'est pas écrit ; le thème est porté', async function () {
    const p = fixture('prerendu-navigateur-petit')
    writeFileSync(join(p.stylesDir, 'feuille-imp.css'), '@import url("feuille-a.css");\n.zone-i { width: 777px }\n')
    ecrire(p, 'sombre.theme.mjs', '<theme>\n  $$gapv: 77px\n</theme>\n')
    ecrire(p, 'fiche.mjs', '<div class="zone-i" theme="sombre">F</div>\n<style @css="feuille-imp"></style>\n')
    const r = await avecNavigateur.call(this, p, 'mjs-fiche')
    if(!r) return this.skip()
    assert.deepEqual(liens(r.html), [], `tout en ligne — HTML : ${r.html.slice(0, 300)}`)
    assert.doesNotMatch(r.html, /@import/)
    assert.match(r.html, /\.zone-i\s*\{\s*width:\s*777px/)
    assert.ok(r.html.indexOf('--mjs-surface') > -1 && r.html.indexOf('--mjs-surface') < r.html.indexOf('.zone-i'), 'thème porté, avant la feuille déclarée')
    assert.match(r.html, /gapv[^}]*77px/, 'thème de l\'application porté')
  })
})
