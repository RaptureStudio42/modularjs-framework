// Fichiers séparés : la page n'attend pas les composants que nomme son gabarit — elle se définit dès que son propre fichier est là, et
// l'enfant, servi plus tard, paraît à son arrivée. `:size="320x48"` sur la balise d'un enfant lui garde sa place le temps que son code
// arrive : sa balise mesure alors exactement la taille annoncée, et la balise placée après elle ne bouge pas, du premier dessin de la page
// jusqu'à quelques images après la définition de l'enfant ; avec `*skeleton`, la silhouette grise se dessine dans cette place. En
// développement, un enfant arrivé à une autre taille que celle annoncée est dit en console, avec les deux tailles ; jamais en production.
// Trois moteurs ; fichiers séparés en production et en développement, fichier unique (tout arrive ensemble : `:size` ne gêne rien).
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// l'enfant mesure 320 × 48 une fois arrivé ; `large`, 200 × 90 ; `cadre` a 400 px de large
const FICHIERS: Record<string, string> = {
  'enfant.mjs': '<style lang="css">\n:host { width: 320px; height: 48px }\n</style>\n\n<b class="enfant">un</b>\n',
  'large.mjs':  '<style lang="css">\n:host { width: 200px; height: 90px }\n</style>\n\n<b class="large">deux</b>\n',
  'taille.mjs': '<h1 class="titre">titre</h1>\n<mjs-enfant :size="320x48"></mjs-enfant>\n<p class="apres">après</p>\n',
  'libre.mjs':  '<h1 class="titre">titre</h1>\n<mjs-enfant></mjs-enfant>\n<p class="apres">après</p>\n',
  'ombre.mjs':  '<h1 class="titre">titre</h1>\n<mjs-enfant :size="320x48" *skeleton></mjs-enfant>\n<p class="apres">après</p>\n',
  'ecart.mjs':  '<h1 class="titre">titre</h1>\n<mjs-large :size="320x48"></mjs-large>\n<p class="apres">après</p>\n',
  'cadre.mjs':  '<style lang="css">\n:host { width: 400px }\n</style>\n\n<h1 class="titre">titre</h1>\n<mjs-enfant :size="x48"></mjs-enfant>\n<mjs-enfant :size="100%x48"></mjs-enfant>\n<p class="apres">après</p>\n',
}

// les fichiers des enfants arrivent après ceux des pages (ms)
const RETARD = 300

// les pages de la démo : leurs balises, la page relevée et l'enfant qu'elle attend (la page sans `:size` sous celle qui le porte : son
// enfant qui paraît ne pousse rien au-dessus d'elle)
const PAGES: Record<string, { corps: string, hote: string, enfant: string }> = {
  '/':      { corps: '<mjs-taille></mjs-taille><mjs-libre></mjs-libre>', hote: 'mjs-taille', enfant: 'mjs-enfant' },
  '/ombre': { corps: '<mjs-ombre></mjs-ombre>', hote: 'mjs-ombre', enfant: 'mjs-enfant' },
  '/ecart': { corps: '<mjs-ecart></mjs-ecart>', hote: 'mjs-ecart', enfant: 'mjs-large' },
  '/cadre': { corps: '<mjs-cadre></mjs-cadre>', hote: 'mjs-cadre', enfant: 'mjs-enfant' },
}

// relevé posé avant tout module, à chaque image où la page relevée a sa balise `.apres` : la position de celle-ci ; tant que l'enfant n'est
// pas défini, la boîte de sa balise et, s'il y en a une, si la silhouette (sa première barre : la zone qui la porte n'a pas de boîte) se dessine dans cette boîte. L'heure de définition de chaque
// composant ; le relevé s'arrête cinq images après la définition de l'enfant
const releve = (hote: string, enfant: string): string => `<script>
window.__pos = []; window.__boite = []; window.__zone = []; window.__t = {};
['mjs-enfant', 'mjs-large', 'mjs-taille', 'mjs-libre', 'mjs-ombre', 'mjs-ecart'].forEach(function(t) { customElements.whenDefined(t).then(function() { window.__t[t] = performance.now(); }); });
(function image() {
  var p = document.querySelector('${hote}'), r = p && (p._shadow || p.shadowRoot), a = r && r.querySelector('.apres'), e = r && r.querySelector('${enfant}');
  if (a) {
    window.__pos.push(Math.round(a.getBoundingClientRect().top));
    if (!customElements.get('${enfant}')) {
      var b = e.getBoundingClientRect(), z = e.querySelector('[mjs-skel-zone] [mjs-skel]');
      window.__boite.push(Math.round(b.width) + 'x' + Math.round(b.height));
      if (z) { var c = z.getBoundingClientRect(); window.__zone.push(c.width > 0 && c.height > 0 && c.top >= b.top - 1 && c.left >= b.left - 1 && c.top < b.bottom && c.left < b.right); }
    }
  }
  if (window.__fin === undefined && window.__t['${enfant}'] !== undefined) window.__fin = window.__pos.length + 5;
  if (window.__fin === undefined || window.__pos.length < window.__fin) requestAnimationFrame(image);
})();
</script>`

interface Site { root: string; serveur: Server; url: string }

async function construireEtServir(options: Record<string, string>): Promise<Site> {
  const root   = mjsTmp('taille-reservee')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(FICHIERS)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', ...options } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const serveur = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    const demo   = Object.prototype.hasOwnProperty.call(PAGES, chemin) ? PAGES[chemin] : null
    if (demo) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><html><head><meta charset="utf-8">${releve(demo.hote, demo.enfant)}<script type="module" src="/out/bundle.js"></script></head><body>${demo.corps}</body></html>`)
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    const envoyer = (): void => {
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream' })
      res.end(readFileSync(fichier))
    }
    if (/^\/out\/(enfant|large)[-.]/.test(chemin)) setTimeout(envoyer, RETARD)
    else envoyer()
  })
  await new Promise<void>(resolve => serveur.listen(0, '127.0.0.1', () => resolve()))
  return { root, serveur, url: `http://127.0.0.1:${(serveur.address() as any).port}` }
}

interface Releve { pos: number[]; boite: string[]; zone: boolean[]; t: Record<string, number>; erreurs: string[]; avertis: string[] }

async function relever(browser: any, url: string): Promise<Releve> {
  const page    = await browser.newPage()
  const erreurs: string[] = []
  const avertis: string[] = []
  page.on('pageerror', (e: any) => erreurs.push(String(e)))
  page.on('console', (m: any) => { if (m.type() === 'warning') avertis.push(m.text()) })
  try {
    await page.goto(url)
    await page.waitForFunction(() => (window as any).__fin !== undefined && (window as any).__pos.length >= (window as any).__fin, null, { timeout: 20000 })
    const r = await page.evaluate(() => ({ pos: (window as any).__pos, boite: (window as any).__boite, zone: (window as any).__zone, t: (window as any).__t }))
    return { ...r, erreurs, avertis }
  }
  finally {
    await page.close()
  }
}

const immobile = (r: Releve, quoi: string): void => {
  assert.ok(r.pos.length > 0, `${quoi} : la balise qui suit l'enfant n'a jamais été dessinée`)
  assert.deepEqual([...new Set(r.pos)], [r.pos[0]], `${quoi} : la balise qui suit l'enfant s'est déplacée, positions par image : ${r.pos.join(', ')}`)
}

const MODES = [
  { nom: 'fichiers séparés, production', separes: true, dev: false, options: { env: 'prod' } },
  { nom: 'fichiers séparés, développement', separes: true, dev: true, options: { env: 'dev' } },
  { nom: 'fichier unique', separes: false, dev: false, options: { env: 'prod', js: 'bundle' } },
]
const MOTEURS = ['chromium', 'firefox', 'webkit']

describe('composant nommé dans un gabarit — la page n\'attend pas son code, `:size` lui garde sa place', function () {
  this.timeout(180000)
  let playwright: any = null
  const sites: Site[] = []

  before(async function () {
    try {
      playwright = await import('playwright')
    }
    catch {
      playwright = null
    }
  })
  after(async function () {
    for (const site of sites) {
      site.serveur.close()
      rmSync(site.root, { recursive: true, force: true })
    }
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES) {
    describe(mode.nom, function () {
      let site: Site

      before(async function () {
        site = await construireEtServir(mode.options)
        sites.push(site)
      })

      for (const moteur of MOTEURS) {
        describe(moteur, function () {
          let browser: any = null

          before(async function () {
            const type = playwright && playwright[moteur]
            if (!type || !existsSync(type.executablePath())) return this.skip()
            browser = await type.launch()
          })
          after(async function () {
            if (browser) await browser.close()
          })

          it(':size="320x48" : la balise mesure la taille annoncée avant l\'arrivée du code, ce qui la suit ne bouge pas ; sans :size, la page n\'attend pas l\'enfant', async function () {
            const r = await relever(browser, site.url + '/')
            assert.deepEqual(r.erreurs, [])
            immobile(r, 'avec :size')
            if (mode.separes) {
              assert.ok(r.boite.length > 0, 'la balise de l\'enfant n\'a jamais été vue avant l\'arrivée de son code : la page l\'a attendu')
              assert.deepEqual([...new Set(r.boite)], ['320x48'], `la boîte de la balise avant l'arrivée de son code, par image : ${r.boite.join(', ')}`)
              assert.ok(r.t['mjs-libre'] < r.t['mjs-enfant'] && r.t['mjs-taille'] < r.t['mjs-enfant'], `une page a attendu son enfant : libre à ${r.t['mjs-libre']} ms, taille à ${r.t['mjs-taille']} ms, enfant à ${r.t['mjs-enfant']} ms`)
            }
            assert.deepEqual(r.avertis.filter(a => a.includes('mjs-enfant')), [], 'un enfant arrivé à la taille annoncée n\'est pas dit')
          })

          it(':size="320x48" *skeleton : la silhouette grise dans la place gardée', async function () {
            const r = await relever(browser, site.url + '/ombre')
            assert.deepEqual(r.erreurs, [])
            immobile(r, 'avec :size et *skeleton')
            if (mode.separes) {
              assert.deepEqual([...new Set(r.boite)], ['320x48'], `la boîte de la balise avant l'arrivée de son code, par image : ${r.boite.join(', ')}`)
              assert.ok(r.zone.length > 0 && r.zone.every(Boolean), `la silhouette dans la place, par image : ${r.zone.join(', ')}`)
            }
          })

          it('un enfant arrivé à une autre taille que celle annoncée : dit en développement, avec les deux tailles ; rien en production', async function () {
            const r  = await relever(browser, site.url + '/ecart')
            const dit = r.avertis.filter(a => a.includes('mjs-large'))
            assert.deepEqual(r.erreurs, [])
            if (mode.dev && mode.separes) assert.ok(dit.length === 1 && dit[0].includes('320 × 48') && dit[0].includes('200 × 90'), `l'avertissement : ${r.avertis.join(' | ')}`)
            else assert.deepEqual(dit, [])
          })

          it('dans un cadre de 400 px, un enfant de 320 × 48 : avec `x48` seule la hauteur se compare ; `100%x48` dit en développement sa largeur seule changée ; rien en production', async function () {
            const r   = await relever(browser, site.url + '/cadre')
            const dit = r.avertis.filter(a => a.includes('mjs-enfant'))
            assert.deepEqual(r.erreurs, [])
            immobile(r, 'largeur seule changée')
            if (mode.dev && mode.separes) assert.ok(dit.length === 1 && dit[0].includes(':size="100%x48"') && dit[0].includes('400 × 48') && dit[0].includes('320 × 48') && dit[0].includes('sa largeur a changé') && !dit[0].includes('ce qui le suit a bougé'), `l'avertissement : ${r.avertis.join(' | ')}`)
            else assert.deepEqual(dit, [])
          })
        })
      }
    })
  }
})
