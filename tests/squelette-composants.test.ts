// Squelette d'un composant dont le code arrive : sa balise montre la silhouette de son HTML en
// attendant. Pas par défaut — la clé `"effects": { "skeleton": [..., "components"] }` de
// mjs.config.json l'active pour chaque composant qui attend un contenu (un {await}) ; un composant
// sans attente (mise en page, cadre, en-tête) n'en a pas : il est rendu dès que son code arrive, et
// sa silhouette, dessinée sans son style, n'aurait pas sa place. `*skeleton` écrit sur la balise
// d'un composant la demande pour lui seul, quel qu'il soit. Le build tire la silhouette du gabarit
// et la range au manifeste (`µ._skels`) en forme compacte, quelques centaines d'octets ; la page la
// remet en HTML (celui de skeletonHtml), la pose dans la balise encore inconnue, et `µ._def` la
// retire juste avant d'enregistrer le composant (jamais visible à côté de son vrai rendu).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { skeletonHtml } from '../src/parser/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

async function construire(etiquette: string, fichiers: Record<string, string>, effects?: any) {
  const root   = mjsTmp('squelette-composants-' + etiquette)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(effects ? { effects } : {}) })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  return { root, outDir, manifeste: readFileSync(join(root, 'bundle.js'), 'utf-8') }
}

const CARTE  = '<article class="carte"><h3 class="nom">{$nom}</h3><p class="bio">{$bio}</p><img class="photo" src={$photo} alt=""></article>'
const PAGE   = '<@carte *skeleton></@carte>'
const FIL    = '<section class="fil" role="feed">{await $messages}{success l}<ul class="liste">{for m in l}<li class="message" data-sorte="court"><img class="avatar" src={m.photo} alt=""><b class="auteur">{m.nom}</b><p class="mot">{m.mot}</p><hr class="sep"></li>{end}</ul>{end}</section>'
// une page de téléphone : la mise en page, un en-tête, un tiroir (sans attente), un fil de messages (qui attend)
const TELEPHONE: Record<string, string> = {
  'app.mjs':    '<div class="app"><@entete></@entete><@tiroir></@tiroir><main class="contenu"><@carte *skeleton></@carte><@fil></@fil></main></div>',
  'entete.mjs': '<header class="entete"><h1 class="titre">Atelier</h1><nav class="liens">{for l in $liens}<a class="lien" href={l.href}>{l.nom}</a>{end}</nav></header>',
  'tiroir.mjs': '<aside class="tiroir" role="navigation"><h2 class="tiroir-titre">Menu</h2><ul class="tiroir-liste">{for l in $liens}<li class="tiroir-ligne"><a class="tiroir-lien" href={l.href}><span class="icone"></span>{l.nom}</a></li>{end}</ul></aside>',
  'carte.mjs':  CARTE,
  'fil.mjs':    FIL,
}
// des gabarits retors pour l'aller-retour (forme compacte → HTML) : classes à caractères spéciaux, crochets et
// parenthèses dans une valeur, balises vides avec classe, {for} imbriqués, {if}, tableau, attribut booléen
const RETORS: Record<string, string> = {
  'a1.mjs': '<div class="w-1/2 md:flex [x]" data-v="a[1](2) 3" style="width:calc(100% - 2px)"><span class="a&b">{$x}</span><br><hr class="sep"><input class="champ" value={$v}></div>',
  'a2.mjs': '<table class="t"><tr>{for r in $rs}<td colspan="2" class="c">{for c in r}<em>{c}</em>{end}</td>{end}</tr></table>',
  'a3.mjs': '{if $a}<p class="oui">{$x} et {$y}</p>{else}<p>non</p>{end}<div data-on class="cache"><@autre></@autre><svg class="ico"></svg><img src={$s} alt="" class="ph" width="40" height="40"></div>',
  'a4.mjs': '<ul>{for x in $l}<li>{x}</li><li class="b">{x}</li>{end}</ul><h2 class="h">Titre fixe</h2><p>1 2 3</p><div role="list">{for x in $l}{for y in x}<i class="pt">{y}</i>{end}{end}</div>',
  'page.mjs': '<@a1 *skeleton></@a1><@a2 *skeleton></@a2><@a3 *skeleton></@a3><@a4 *skeleton></@a4>',
}

describe('squelette d\'un composant dont le code arrive', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('skeletonHtml : la silhouette d\'un gabarit — les balises et leurs classes, une barre par texte, l\'image gardée en boîte', () => {
    assert.equal(skeletonHtml(CARTE), '<article class="carte"><h3 class="nom"><i mjs-skel="title"></i></h3><p class="bio"><i mjs-skel="lines"><i mjs-skel="line"></i><i mjs-skel="line"></i><i mjs-skel="line"></i></i></p><img class="photo" mjs-skel="media"></article>')
  })

  it('le manifeste : rien par défaut ; `components` dans la config, chaque composant qui attend un contenu ; `*skeleton` sur une balise, ce composant seul', async () => {
    const rien = await construire('rien', { 'carte.mjs': CARTE, 'page.mjs': '<@carte></@carte>' })
    assert.doesNotMatch(rien.manifeste, /_skels/)
    const tous = await construire('tous', { 'carte.mjs': CARTE, 'fil.mjs': FIL, 'page.mjs': '<@carte></@carte><@fil></@fil>' }, { skeleton: ['await', 'components'] })
    const t = /µ\._skels = (\{[\s\S]*?\});/.exec(tous.manifeste)
    assert.ok(t, 'µ._skels au manifeste')
    assert.deepEqual(Object.keys(JSON.parse(t![1])).sort(), ['fil'])
    const un = await construire('un', { 'carte.mjs': CARTE, 'page.mjs': PAGE, 'autre.mjs': '<p>{$x}</p>' })
    const u = /µ\._skels = (\{[\s\S]*?\});/.exec(un.manifeste)
    assert.ok(u, 'µ._skels au manifeste')
    assert.deepEqual(Object.keys(JSON.parse(u![1])), ['carte'])
  })

  it('le manifeste, avec `components` : rien pour un composant sans attente (mise en page, en-tête, tiroir), la forme compacte pour les autres — quelques centaines d\'octets chacun', async () => {
    const { manifeste } = await construire('telephone', TELEPHONE, { skeleton: ['await', 'components'] })
    const ligne = /µ\._skels = (\{.*?\});\n/.exec(manifeste)
    assert.ok(ligne, 'µ._skels au manifeste')
    const skels = JSON.parse(ligne![1])
    assert.deepEqual(Object.keys(skels).sort(), ['carte', 'fil'], 'le fil (il attend ses messages) et la carte (`*skeleton` écrit) ; ni la mise en page, ni l\'en-tête, ni le tiroir')
    assert.doesNotMatch(ligne![1], /<|\\u003c/, 'pas une balise HTML entière : la forme compacte')
    for (const [nom, forme] of Object.entries(skels) as [string, string][]) assert.ok(JSON.stringify(forme).length <= 200, `${nom} : ${JSON.stringify(forme).length} o (${forme})`)
    assert.ok(ligne![1].length <= 400, `µ._skels : ${ligne![1].length} o`)
  })

  it('à la page : la forme compacte remise en HTML donne la silhouette de skeletonHtml, à l\'octet près (rendu des silhouettes inchangé)', async () => {
    const { outDir, manifeste } = await construire('retors', { ...RETORS, 'autre.mjs': '<p>{$x}</p>', 'fil.mjs': FIL, 'app.mjs': '<@fil></@fil>' }, { skeleton: ['await', 'components'] })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = stripEsm(readFileSync(join(outDir, files.find((f) => /^mjs_core-/.test(f))!), 'utf-8'))
    const skels = /µ\._skels = (\{[\s\S]*?\});/.exec(manifeste)![1]
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${coeur}\nglobalThis.µ = µ; µ._skels = ${skels};`)
    const doc = window.document
    const gabarits: Record<string, string> = { ...RETORS, 'fil.mjs': FIL }
    delete gabarits['page.mjs']
    for (const [fichier, gabarit] of Object.entries(gabarits)) {
      const tag = 'mjs-' + fichier.replace(/\.mjs$/, '')
      doc.body.innerHTML = `<${tag}></${tag}>`
      const zone = window.µ._mjs_skelShow(doc.querySelector(tag))
      assert.ok(zone, `${tag} : une silhouette`)
      const attendu = doc.createElement('template')
      attendu.innerHTML = skeletonHtml(gabarit)
      assert.equal(zone.innerHTML, attendu.innerHTML, `${tag} : le HTML de skeletonHtml`)
    }
    window.close()
  })

  it('à la page : une silhouette attend que les composants attendus placés avant elle, sans silhouette, soient en place (ils la pousseraient en arrivant)', async () => {
    const { outDir, manifeste } = await construire('retenue', { 'fil.mjs': FIL, 'bandeau.mjs': '<div class="bandeau">Bonjour</div>', 'app.mjs': '<@bandeau></@bandeau><@fil></@fil>' }, { skeleton: ['await', 'components'] })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = stripEsm(readFileSync(join(outDir, files.find((f) => /^mjs_core-/.test(f))!), 'utf-8'))
    const skels = /µ\._skels = (\{[\s\S]*?\});/.exec(manifeste)![1]
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${coeur}\nglobalThis.µ = µ; µ._skels = ${skels};`)
    const doc = window.document
    doc.body.innerHTML = '<mjs-bandeau></mjs-bandeau><mjs-fil></mjs-fil>'
    window.µ.Autoloader._mjs_pending = new Set(['mjs-bandeau', 'mjs-fil'])
    const fil = doc.querySelector('mjs-fil')
    assertAbsent(window.µ._mjs_skelShow(fil), 'retenue : le bandeau, avant elle, est encore en route')
    assert.equal(fil.children.length, 0, 'rien dans la balise du fil')
    window.µ._def('mjs-bandeau', class extends window.HTMLElement {})
    window.µ.Autoloader._mjs_pending.delete('mjs-bandeau')
    await new Promise((r) => setTimeout(r, 0))
    assert.ok(fil.querySelector('[mjs-skel-zone] section.fil > ul.liste > li.message'), 'le bandeau en place : la silhouette du fil paraît')
    window.close()
  })

  it('à la page : un composant de structure encore attendu (sans silhouette) ne cache rien — ni ce qui le suit dans sa racine, ni ce qui suit l\'hôte de sa racine dans celle qui la contient', async () => {
    const { outDir, manifeste } = await construire('suite', { 'fil.mjs': FIL, 'entete.mjs': '<header class="entete">Atelier</header>', 'app.mjs': '<@entete></@entete><main class="contenu"><@fil></@fil></main>' }, { skeleton: ['await', 'components'] })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = stripEsm(readFileSync(join(outDir, files.find((f) => /^mjs_core-/.test(f))!), 'utf-8'))
    const skels = /µ\._skels = (\{[\s\S]*?\});/.exec(manifeste)![1]
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${coeur}\nglobalThis.µ = µ; µ._skels = ${skels}; µ._fxConf = {"skeleton":["await","components"]};`)
    const doc = window.document
    doc.body.innerHTML = '<mjs-app></mjs-app><footer class="pied">pied</footer>'
    const app    = doc.querySelector('mjs-app')
    const ombre  = app.attachShadow({ mode: 'open' })
    ombre.innerHTML = '<p class="avant">avant</p><mjs-entete></mjs-entete><main class="contenu"><p class="texte">texte</p></main>'
    const entete = ombre.querySelector('mjs-entete')
    const etat   = () => [doc.body.innerHTML, ombre.innerHTML, (doc.adoptedStyleSheets || []).length, (ombre.adoptedStyleSheets || []).length]
    window.µ.Autoloader._mjs_pending = new Set(['mjs-entete', 'mjs-fil'])
    const avant = etat()
    assertAbsent(window.µ._mjs_skelShow(entete), 'pas de silhouette pour un composant sans attente')
    assert.deepEqual(etat(), avant, 'rien de posé : ni marque sur sa balise ou sur l\'hôte de sa racine, ni feuille qui cacherait ce qui le suit')
    window.µ._def('mjs-entete', class extends window.HTMLElement {})
    window.µ.Autoloader._mjs_pending.delete('mjs-entete')
    await new Promise((r) => setTimeout(r, 50))
    assert.deepEqual(etat(), avant, 'le composant enregistré : la page telle qu\'elle était')
    window.close()
  })

  it('le manifeste, avec `components` : rien pour un composant sans attente, qu\'il soit dans le flux ou que sa feuille le pose fixe, absolu ou retiré — seul le fil, qui attend ses messages, y a sa silhouette', async () => {
    const fichiers: Record<string, string> = {
      'entete.mjs':  '<header class="entete"><h1>Atelier</h1></header>\n\n<style>\n  .entete\n    position: fixed\n    top: 0\n</style>\n',
      'dock.mjs':    '<nav class="dock barre"><a href="#a">A</a></nav>\n\n<style>\n  :host\n    display: block\n  .barre\n    position: absolute\n    bottom: 0\n</style>\n',
      'tiroir.mjs':  '<aside class="tiroir">Menu</aside>\n\n<style lang="css">\n:host { position: fixed; inset: 0 auto 0 0 }\n</style>\n',
      'voile.mjs':   '<div class="voile"></div>\n\n<style lang="scss">\n.voile {\n  &:hover { display: block; }\n  display: none;\n}\n</style>\n',
      'bandeau.mjs': '<div class="bandeau">Bonjour</div>\n\n<style>\n  .bandeau\n    padding: 14px\n</style>\n',
      'fil.mjs':     FIL,
      'app.mjs':     '<@entete></@entete><@dock></@dock><@tiroir></@tiroir><@voile></@voile><@bandeau></@bandeau><@fil></@fil>',
    }
    const { manifeste } = await construire('hors-flux', fichiers, { skeleton: ['await', 'components'] })
    const ligne = /µ\._skels = (\{.*?\});\n/.exec(manifeste)
    assert.ok(ligne, 'µ._skels au manifeste')
    const skels = JSON.parse(ligne![1])
    assert.deepEqual(Object.keys(skels), ['fil'], `ni l'en-tête, ni le dock, ni le tiroir, ni le voile, ni le bandeau : ${ligne![1]}`)
    assert.equal(typeof skels.fil, 'string', 'le fil garde sa silhouette')
  })

  it('à la page : une silhouette rangée au manifeste en HTML entier (forme d\'avant la forme compacte) est lue telle quelle', async () => {
    const { outDir } = await construire('ancienne-forme', { 'carte.mjs': CARTE, 'page.mjs': PAGE })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = stripEsm(readFileSync(join(outDir, files.find((f) => /^mjs_core-/.test(f))!), 'utf-8'))
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${coeur}\nglobalThis.µ = µ; µ._skels = ${JSON.stringify({ carte: skeletonHtml(CARTE), fil: skeletonHtml(FIL) }).replace(/</g, '\\u003c')};`)
    const doc = window.document
    for (const [tag, gabarit] of [['mjs-carte', CARTE], ['mjs-fil', FIL]]) {
      doc.body.innerHTML = `<${tag}></${tag}>`
      const zone = window.µ._mjs_skelShow(doc.querySelector(tag))
      const attendu = doc.createElement('template')
      attendu.innerHTML = skeletonHtml(gabarit)
      assert.ok(zone, `${tag} : une silhouette`)
      assert.equal(zone.innerHTML, attendu.innerHTML, `${tag} : le HTML du manifeste, tel quel`)
    }
    window.close()
  })

  it('le manifeste ne pose aucun nom en _mjs_ : le cœur minifié les raccourcit, pas le manifeste (la silhouette resterait muette en production)', async () => {
    const tous = await construire('noms', { 'carte.mjs': CARTE, 'page.mjs': '<@carte></@carte>' }, { skeleton: ['await', 'components'] })
    // la table des messages cite des noms internes dans ses TEXTES (« µ._mjs_storeWatch : callback en erreur. ») : ce n'est pas du code
    const code = tous.manifeste.replace(/µ\._runtimeLabels = \{.*\};/, '')
    assert.notEqual(code, tous.manifeste, 'la ligne de la table des libellés est bien reconnue')
    assert.deepEqual(code.match(/µ\._mjs_\w+/g) ?? [], [])
  })

  it('à la page : la balise encore inconnue montre sa silhouette ; elle part AVANT que le composant ne s\'enregistre', async () => {
    const { outDir, manifeste } = await construire('page', { 'carte.mjs': CARTE, 'page.mjs': PAGE })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = stripEsm(readFileSync(join(outDir, files.find((f) => /^mjs_core-/.test(f))!), 'utf-8'))
    const skels = /µ\._skels = (\{[\s\S]*?\});/.exec(manifeste)![1]
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${coeur}\nglobalThis.µ = µ; µ._skels = ${skels};`)
    const doc = window.document
    doc.body.innerHTML = '<mjs-carte></mjs-carte>'
    const el = doc.querySelector('mjs-carte')
    const zone = window.µ._mjs_skelShow(el)
    assert.ok(zone && el.querySelector('[mjs-skel-zone] h3.nom > i[mjs-skel="title"]'), 'la silhouette dans la balise')
    const bouclier = [...window.µ._mjs_shield.cssRules][0].selectorText
    assert.equal(doc.createElement('mjs-inconnu').matches(bouclier), true, 'une balise encore inconnue est cachée par le bouclier du cœur')
    assert.equal(el.matches(bouclier), false, 'celle qui montre sa silhouette, non')
    let vuAuMontage: any = 'non vu'
    class Carte extends window.HTMLElement { connectedCallback() { vuAuMontage = this.querySelector('[mjs-skel-zone]') } }
    window.µ._def('mjs-carte', Carte)
    assertAbsent(vuAuMontage, 'plus de silhouette quand le composant se monte')
    assert.equal(el.hasAttribute('mjs-skel-host'), false, 'ni sa marque')
    window.close()
  })
})
