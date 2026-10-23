// Un prototype pollué (`Object.prototype.nom = …`, posé par exemple par `$$prefs[section][champ] = v` avec une
// section venue de données qui vaut `'__proto__'`) ne doit pas devenir, par une table que le cœur lit par un nom, du
// code chargé, du HTML posé dans la page ou une valeur CSS : la table des fichiers (`µ.pathOf`, et le décodeur du
// manifeste quand la table est compacte), le repli d'un fichier de page introuvable, les silhouettes des composants
// (`µ._skels`) et les réglages des effets ne lisent que leurs clés propres. Avant le correctif, `<mjs-piege>` importait
// l'adresse posée sur le prototype, `<mjs-silhouette>` montrait le HTML posé sur le prototype, et `*skeleton` recevait en
// variable CSS une valeur `url(…)` d'un tiers
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const ADRESSE = 'https://tiers.example/piege.js'
const CHARGE = '<img src="x" onerror="window.__xss = 1">'
const VALEUR_CSS = 'url(https://tiers.example/pixel.gif)'
const FICHIERS: Record<string, string> = {
  'carte.mjs': '<article class="carte"><h3 class="nom">{$nom}</h3></article>\n',
  'hote.mjs': '<p class="pret">pret</p>\n<div class="os" *skeleton></div>\n',
  'alerte.mjs': `<script>
  @ouvrir = -> µ.modal.fire({ title: 'Info', text: 'Bonjour', icon: 'piege' })
  @fermer = -> µ.modal.close()
  @notifier = -> µ.modal.notify('Salut', { type: 'piege' })
</script>
<p class="pret">pret</p>
`,
}

async function construire(prefixe: string, prod: boolean, fichiers: Record<string, string>, bundle = true): Promise<{ code: string, manifeste: string }> {
  const root = mjsTmp(prefixe), srcDir = join(root, 'src'), outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), src)
  const effects = { skeleton: ['components'] }
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', ...(bundle ? { js: 'bundle' } : {}), effects } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), effects }
  const bundler = new Bundler(opts)
  const stats = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  // production en fichiers séparés : le cœur minifié seul (le chargeur et la silhouette y vivent), ses exports posés sur la
  // fenêtre (`export{n as \u00B5}` : le nom s'écrit échappé)
  if (prod && !bundle) {
    const coeur = readdirSync(outDir).find((f) => /^mjs_core-.*\.js$/.test(f))!
    const code = readFileSync(join(outDir, coeur), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'")
      .replace(/export\s*\{([^}]*)\}\s*;?/g, (_m, l: string) => l.split(',').map((x) => x.trim().split(/\s+as\s+/)).map(([a, b]) => `globalThis[${JSON.stringify(JSON.parse('"' + (b || a) + '"'))}] = ${a};`).join('\n'))
    return { manifeste: readFileSync(join(outDir, 'bundle.js'), 'utf-8'), code }
  }
  if (prod) {
    const brut = readFileSync(join(outDir, 'bundle.js'), 'utf-8')
    return { manifeste: brut, code: brut.replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '') }
  }
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return { manifeste: readFileSync(join(root, 'bundle.js'), 'utf-8'), code: files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') }
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))
// l'effet `*skeleton` posé sur `.os` (sa marque `mjs-fx`), dans le composant rendu
async function osPose(hote: any): Promise<any> {
  const fin = Date.now() + 5000
  const os = () => hote._shadow?.querySelector('.os')
  while (!(os() && /\bskeleton\b/.test(os().getAttribute('mjs-fx') || '')) && Date.now() < fin) await attendre(10)
  assert.equal(/\bskeleton\b/.test((os() && os().getAttribute('mjs-fx')) || ''), true, 'l\'effet est posé')
  return os()
}
const polluer = (window: any, cles: Record<string, string>) => window.eval(Object.keys(cles).map((k) => `Object.prototype[${JSON.stringify(k)}] = ${JSON.stringify(cles[k])};`).join('\n'))
const nettoyer = (window: any, cles: Record<string, string>) => window.eval(Object.keys(cles).map((k) => `delete Object.prototype[${JSON.stringify(k)}];`).join('\n'))
// le rechargement de la garde « bundle périmé » (un import qui échoue) est compté, jamais fait
const SANS_RECHARGEMENT = 'window.__recharge = 0; try { window.location.reload = function() { window.__recharge++; }; } catch (e) {}'

describe('prototype pollué : les tables du cœur lues par un nom ne rendent que leurs clés propres', function () {
  this.timeout(180000)
  const builds: Record<string, { code: string, manifeste: string }> = {}
  before(async function () {
    this.timeout(240000)
    builds.dev = await construire('tables-propres-dev', false, FICHIERS)
    builds.prod = await construire('tables-propres-prod', true, FICHIERS)
    builds.prodSepare = await construire('tables-propres-prod-separe', true, FICHIERS, false)
  })
  after(async () => { await terminateSharedWorkerPool() })

  describe('développement', function () {
    let window: any
    const cles = { piege: CHARGE, silhouette: CHARGE, shine: VALEUR_CSS }
    beforeEach(async () => {
      window = new Window({ url: 'http://localhost/' })
      window.eval(SANS_RECHARGEMENT)
      window.eval(`${builds.dev.code}\nglobalThis.µ = µ;\nglobalThis.__erreurs = [];\nµ.error = function(...a) { globalThis.__erreurs.push(a.map(String).join(' ')); };\nµ.config.staleReload = false;`)
    })
    afterEach(async () => {
      nettoyer(window, cles)
      nettoyer(window, { fiche: '', s: '' })
      await window.happyDOM.close()
    })

    it('µ.pathOf et le chargeur : un nom hérité est inconnu, rien n\'est importé', async () => {
      window.eval(`µ.paths = { carte: 'carte-123.js', hote: 'hote-123.js' };`)
      polluer(window, cles)
      assert.equal(window.eval(`µ.pathOf('piege')`), '', 'aucun chemin hérité')
      window.eval(`µ.Autoloader.load('mjs-piege')`)
      await attendre(100)
      const erreurs: string[] = window.eval('globalThis.__erreurs')
      assert.equal(erreurs.filter((e) => /Failed to import/.test(e)).length, 0, erreurs.join('\n'))
      assert.equal(erreurs.filter((e) => /absent du manifeste/.test(e)).length, 1, erreurs.join('\n'))
    })

    it('repli d\'un fichier de page introuvable : seul le chemin propre gardé par la navigation est repris', async () => {
      window.eval(`µ.paths = { fiche: 'fiche-absente.js' }; µ._mjs_pagePrev = {};`)
      polluer(window, { fiche: ADRESSE })
      window.eval(`µ.Autoloader.load('mjs-fiche')`)
      await attendre(150)
      assert.equal(window.eval(`Object.prototype.hasOwnProperty.call(µ.paths, 'fiche') ? µ.paths.fiche : null`), 'fiche-absente.js', 'la table garde son chemin, aucun chemin hérité recopié')
      const erreurs: string[] = window.eval('globalThis.__erreurs')
      assert.equal(erreurs.filter((e) => /Failed to import/.test(e)).length, 1, 'un seul import tenté, le fichier propre\n' + erreurs.join('\n'))
    })

    it('silhouette d\'une balise inconnue : aucun HTML hérité', () => {
      window.eval(`µ._skels = { carte: '<i mjs-skel="title"></i>' };`)
      polluer(window, cles)
      window.document.body.innerHTML = '<mjs-silhouette></mjs-silhouette>'
      const el = window.document.querySelector('mjs-silhouette')
      const zone = window.µ._mjs_skelShow(el)
      assert.equal(zone === null, true, 'aucune silhouette posée')
      assert.equal(el.innerHTML, '', 'la balise reste vide')
    })

    it('*skeleton sans réglage : aucune variable CSS héritée', async () => {
      polluer(window, cles)
      window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
      const os = await osPose(window.document.querySelector('mjs-hote'))
      assert.equal(os.style.getPropertyValue('--mjs-skeleton-shine'), '', 'aucune valeur CSS venue du prototype')
    })

    it('toast : un type nommé par la donnée ne prend aucune icône héritée (la modale non plus)', async () => {
      polluer(window, cles)
      window.document.body.innerHTML = '<mjs-alerte></mjs-alerte>'
      const a = window.document.querySelector('mjs-alerte')
      const fin = Date.now() + 5000
      while (!a._shadow?.querySelector('.pret') && Date.now() < fin) await attendre(10)
      a.ouvrir()
      await attendre(20)
      assert.equal(!!window.document.querySelector('.mjs-modal-content'), true, 'la modale est ouverte')
      assert.equal(!!window.document.querySelector('img[onerror]'), false, 'aucune icône héritée dans la modale')
      a.fermer()
      a.notifier()
      await attendre(20)
      assert.equal(!!window.document.querySelector('.mjs-toast'), true, 'le toast est affiché')
      assert.equal(!!window.document.querySelector('img[onerror]'), false, 'aucune icône héritée dans le toast')
    })

    it('réglages : seules les clés propres passent, un effet nommé par une variable ne prend pas de réglages hérités', () => {
      polluer(window, cles)
      const r: any = window.eval(`(function() {
        var el = document.createElement('div');
        var propre = µ._mjs_fxSettings(el, 'skeleton', { lines: 2 });
        var vu = { cles: Object.keys(propre).join(','), shine: propre.shine };
        Object.prototype.s = { shine: ${JSON.stringify(VALEUR_CSS)} };
        try {
          var nomme = µ._mjs_fxSettings(el, 'delta', {}, { fx: { fx: 'skeleton' } }, { fx: ['e', 'effet'] });
          vu.sNomme = nomme.fx && Object.prototype.hasOwnProperty.call(nomme.fx, 's') ? nomme.fx.s : 'absent';
          document.body.appendChild(el);
          µ._mjs_fxOnce(null, el, { fx: 'skeleton' });
          vu.uneFois = el.style.getPropertyValue('--mjs-skeleton-shine');
        } finally { delete Object.prototype.s; }
        return vu;
      })()`)
      assert.equal(r.cles, 'lines', 'les réglages écrits, rien d\'autre')
      assert.equal(r.shine, undefined, 'un réglage absent reste absent')
      assert.equal(r.sNomme === undefined || r.sNomme === 'absent', true, 'aucun réglage hérité pour l\'effet nommé : ' + JSON.stringify(r.sNomme))
      assert.equal(r.uneFois, '', 'l\'effet joué une fois ne reçoit aucune valeur CSS héritée')
    })
  })

  describe('production', function () {
    it('un seul bundle, prototype pollué avant le démarrage : *skeleton ne reçoit aucune variable CSS héritée', async () => {
      const window: any = new Window({ url: 'http://localhost/' })
      const cles = { piege: ADRESSE, silhouette: CHARGE, shine: VALEUR_CSS }
      try {
        window.eval(SANS_RECHARGEMENT)
        window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
        polluer(window, cles)
        window.eval(builds.prod.code)
        const hote = window.document.querySelector('mjs-hote')
        const os = await osPose(hote)
        assert.equal(os.style.getPropertyValue('--mjs-skeleton-shine'), '', 'aucune valeur CSS venue du prototype')
      }
      finally {
        nettoyer(window, cles)
        await window.happyDOM.close()
      }
    })

    it('fichiers séparés, cœur minifié : µ.pathOf, le chargeur et la silhouette ne lisent que leurs clés propres', async () => {
      const window: any = new Window({ url: 'http://localhost/' })
      const cles = { piege: ADRESSE, silhouette: CHARGE }
      try {
        window.eval(SANS_RECHARGEMENT)
        window.eval(builds.prodSepare.code)
        window.eval(`globalThis.__erreurs = []; µ.error = function() { globalThis.__erreurs.push(Array.prototype.map.call(arguments, String).join(' ')); }; µ.config.staleReload = false; µ.paths = { carte: 'carte-12345.js' }; µ._skels = { carte: '<i mjs-skel="title"></i>' }; µ._fxConf = { skeleton: ['components'] };`)
        polluer(window, cles)
        assert.equal(window.eval(`µ.pathOf('piege')`), '', 'aucun chemin hérité')
        window.document.body.innerHTML = '<mjs-silhouette></mjs-silhouette>'
        window.eval(`µ.Autoloader.observe(document.body); µ.Autoloader.load('mjs-piege');`)
        assert.equal(window.document.querySelector('mjs-silhouette').innerHTML, '', 'aucune silhouette héritée')
        await attendre(150)
        const erreurs: string[] = window.eval('globalThis.__erreurs')
        assert.equal(erreurs.filter((e) => /Failed to import/.test(e)).length, 0, erreurs.join('\n'))
        assert.equal(window.__xss, undefined, 'aucun script de la donnée ne tourne')
      }
      finally {
        nettoyer(window, cles)
        await window.happyDOM.close()
      }
    })

    it('table compacte (40 composants et plus) : le décodeur du manifeste rend « inconnu » pour un nom hérité', async () => {
      const fichiers: Record<string, string> = {}
      for (let i = 1; i <= 40; i++) fichiers[`fiche-${String(i).padStart(2, '0')}.mjs`] = `<p>fiche ${i}</p>\n`
      const { manifeste } = await construire('tables-propres-compacte', true, fichiers, false)
      const lignes = ['µPathsPrefix', 'µPaths', 'µPath'].map((n) => new RegExp(`^const ${n} = .*$`, 'm').exec(manifeste))
      assert.ok(lignes.every(Boolean), 'le manifeste porte le décodeur')
      const window: any = new Window({ url: 'http://localhost/' })
      try {
        window.eval(`${lignes.map((m) => m![0]).join('\n')}\nglobalThis.__µPath = µPath;`)
        polluer(window, { piege: ADRESSE })
        assert.equal(window.eval(`__µPath('piege')`), '', 'aucun chemin hérité')
        assert.match(window.eval(`__µPath('fiche-01')`), /^\/out\/fiche-01-[0-9a-z]{5}\.js$/, 'une clé propre se décode toujours')
      }
      finally {
        nettoyer(window, { piege: '' })
        await window.happyDOM.close()
      }
    })
  })
})
