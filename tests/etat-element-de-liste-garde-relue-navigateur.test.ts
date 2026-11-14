// écriture par la variable d'une boucle `{for}` ou par le paramètre d'un rappel de liste : compilée par son chemin (`$l[i].n`)
// seulement si ce chemin mène ENCORE à cet objet au moment d'écrire — liste remplacée ou vidée dans le gestionnaire, remplacée
// pendant un `await`, collection à soi dont le rappel ne reçoit pas l'indice : l'écriture reste celle de JavaScript (l'objet tenu),
// jamais un autre objet écrasé ni une erreur. Avec et sans le réglage `proxy: false`, Chromium, Firefox et WebKit réels
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { charger, graves } from './helpers/liaison-navigateur.js'

const P = '<p class="pret">prêt</p>\n'
const L = '{$l.map((x) => x.n).join(\',\')}'
const boucle = (clic: string) => `{for x in $l}<button class="b" @click={${clic}}>{x.n}</button>{end}\n`
const SOURCES: Record<string, string> = {
  // la liste remplacée par le gestionnaire, puis l'ancien élément écrit
  'gr-remplacee.mjs': `<script lang="js">\n  $l = [{ n: 1 }, { n: 2 }];\n</script>\n<p class="v">${L}</p>\n${boucle('$l = [{ n: 100 }, { n: 200 }]; x.n++')}${P}`,
  // remplacée pendant l'attente du gestionnaire (cf. `remplace`, appelé juste après le clic)
  'gr-attente.mjs': `<script lang="js">\n  $l = [{ n: 1 }, { n: 2 }];\n  @remplace = function() { $l = [{ n: 100 }, { n: 200 }]; };\n</script>\n<p class="v">${L}</p>\n${boucle('await null; x.n++')}${P}`,
  // la valeur écrite attend : la liste change avant l'écriture
  'gr-valeur.mjs': `<script lang="js">\n  $l = [{ n: 1 }, { n: 2 }];\n  @remplace = function() { $l = [{ n: 100 }, { n: 200 }]; };\n</script>\n<p class="v">${L}</p>\n${boucle('x.n = await Promise.resolve(5)')}${P}`,
  // vidée par le rappel qui écrit ensuite son paramètre
  'gr-videe.mjs': `<script lang="js">\n  $l = [{ n: 1 }, { n: 2 }];\n  @f = function() { try { $l.forEach((x) => { $l = []; x.n++; }); globalThis.errVidee = 'aucune'; } catch (e) { globalThis.errVidee = e.constructor.name; } };\n</script>\n<p class="v">${L}|{$l.length}</p>\n${P}`,
  // rappel asynchrone, liste remplacée avant qu'il écrive
  'gr-rappel.mjs': `<script lang="js">\n  $l = [{ n: 1 }, { n: 2 }];\n  @f = function() { $l.forEach(async (x) => { await null; x.n++; }); $l = [{ n: 100 }, { n: 200 }]; };\n</script>\n<p class="v">${L}</p>\n${P}`,
  // collection à soi : son forEach ne passe que l'élément
  'gr-panier.mjs': `<script lang="js">\n  class Panier { constructor() { this.lignes = [{ q: 1 }, { q: 2 }]; } forEach(f) { for (const l of this.lignes) f(l); } }\n  $p = new Panier();\n  @f = function() { try { $p.forEach((l) => l.q++); globalThis.errPanier = 'aucune'; } catch (e) { globalThis.errPanier = e.constructor.name; } };\n</script>\n<p class="v">{$p.lignes.map((l) => l.q).join(',')}</p>\n${P}`,
  // le même objet deux fois, et le cas ordinaire (écriture compilée, l'écran suit sans l'enveloppe)
  'gr-double.mjs': `<script lang="js">\n  const o = { n: 1 };\n  $l = [o, o];\n</script>\n<p class="v">${L}</p>\n${boucle('x.n++')}${P}`,
  // méthode nommée comme celle d'une Date sur un objet à soi : l'appel de JavaScript (ses écritures d'après l'attente vues avec
  // l'enveloppe) ; sur une vraie Date, l'appel compilé
  'gr-date.mjs': `<script lang="js">\n  $m = { s: 0, fini: 'non', async setTime(s) { this.s = s; await null; this.fini = 'oui'; } };\n  $d = new Date(0);\n  @f = function() { $m.setTime(5); $d.setUTCDate(5); };\n</script>\n<p class="v">{$m.s} {$m.fini}</p>\n<p class="d">{$d.getUTCDate()}</p>\n${P}`,
  'gr-simple.mjs': `<script lang="js">\n  $l = [{ n: 1 }, { n: 2 }];\n  @f = function() { $l.forEach((x) => x.n++); };\n</script>\n<p class="v">${L}</p>\n${boucle('x.n += 10')}${P}`,
}
const NOMS = Object.keys(SOURCES).map((f) => f.replace('.mjs', ''))

async function construire(nom: string, opts: Record<string, unknown>) {
  const root   = mjsTmp('garde-relue-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', js: 'bundle', urlPrefix: '/out', minify: false, ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const page = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${NOMS.map((n) => `<mjs-${n}></mjs-${n}>`).join('')}${corps}</body></html>`
  return { mode: 'bundle', racine: root, document: () => page('<script type="module" src="/out/bundle.js"></script>') } as any
}

const SCENARIO = `(async () => {
  const q = (b) => document.querySelector('mjs-' + b)
  const ecran = (b) => q(b)._shadow.querySelector('p.v').textContent
  const bouton = (b, k) => q(b)._shadow.querySelectorAll('button.b')[k]
  const pause = () => new Promise((fin) => setTimeout(() => requestAnimationFrame(() => setTimeout(fin, 0)), 30))
  const r = {}
  bouton('gr-remplacee', 0).click(); await pause(); r.remplacee = ecran('gr-remplacee')
  bouton('gr-attente', 0).click(); q('gr-attente').remplace(); await pause(); await pause(); r.attente = ecran('gr-attente')
  bouton('gr-valeur', 0).click(); q('gr-valeur').remplace(); await pause(); await pause(); r.valeur = ecran('gr-valeur')
  q('gr-videe').f(); await pause(); r.videe = ecran('gr-videe') + ' ' + globalThis.errVidee
  q('gr-rappel').f(); await pause(); await pause(); r.rappel = ecran('gr-rappel')
  q('gr-panier').f(); await pause(); r.panier = ecran('gr-panier') + ' ' + globalThis.errPanier
  bouton('gr-double', 1).click(); await pause(); r.double = ecran('gr-double')
  q('gr-simple').f(); await pause(); bouton('gr-simple', 1).click(); await pause(); r.simple = ecran('gr-simple')
  q('gr-date').f(); await pause(); await pause(); r.date = ecran('gr-date') + ' ' + q('gr-date')._shadow.querySelector('p.d').textContent
  return r
})()`

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`élément de liste écrit par son chemin seulement s'il y mène encore (${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright[moteur].executablePath())) return this.skip()
    browser = await playwright[moteur].launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })
  for (const [nom, opts] of [['avec l\'enveloppe', {}], ['avec "proxy": false', { proxy: false }]] as const) it(`jamais un autre objet écrit, jamais d'erreur — ${nom}`, async function () {
    const c = await construire(moteur + (nom.includes('false') ? '-sans' : '-avec'), opts)
    const o = await charger(browser, c, 'mjs-gr-simple')
    try {
      await o.page.waitForFunction(`${JSON.stringify(NOMS)}.every((b) => !!document.querySelector('mjs-' + b)?._shadow?.querySelector('.pret'))`, null, { timeout: 10000 })
      const r: any = await o.page.evaluate(SCENARIO)
      assert.deepEqual(graves(o), [], 'aucune erreur')
      assert.equal(r.remplacee, '100,200', 'liste remplacée dans le gestionnaire : le nouvel élément intact')
      assert.equal(r.attente, '100,200', 'liste remplacée pendant l\'attente : le nouvel élément intact')
      assert.equal(r.valeur, '100,200', 'valeur qui attend : le nouvel élément intact')
      assert.equal(r.videe, '|0 aucune', 'liste vidée par le rappel : aucune erreur')
      assert.equal(r.rappel, '100,200', 'rappel asynchrone : le nouvel élément intact')
      assert.equal(r.panier, (nom.includes('false') ? '1,2' : '2,3') + ' aucune', 'collection à soi : écriture de JavaScript, aucune erreur')
      assert.equal(r.double, '2,2', 'le même objet deux fois')
      assert.equal(r.simple, '2,13', 'cas ordinaire : l\'écran suit, avec ou sans l\'enveloppe')
      assert.equal(r.date, nom.includes('false') ? '0 non 5' : '5 oui 5', 'méthode d\'une Date : compilée pour une Date seulement')
    } finally {
      await o.fermer()
    }
  })
})
