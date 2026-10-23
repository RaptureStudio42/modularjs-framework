// Ce que ce test garantit : `mjs dev` et `mjs serve` d'un projet à bloc `render` servent la page dont le script est le manifeste
// sur son chemin virtuel (`/__mjs/bundle.js`), en fichiers séparés comme en fichier unique, avec ou sans module chargé à la
// demande. Le fichier unique coupé importe ses voisins par un chemin relatif (`./chunk-….js`) : ils se lisent donc sous
// `/__mjs/`, et le serveur les sert, mais SEULEMENT ceux que le build a consignés au registre — jamais un fichier quelconque du
// dossier du manifeste, jamais un chemin qui en sort. Chromium réel : le composant se monte, le module se charge au clic, la
// console reste vide ; les visionneuses `/__mjs/theme` et `/__mjs/errors`, qui chargent le même manifeste, aussi.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const PARTAGE = "window.__evaluations = (window.__evaluations ?? 0) + 1\nexport marque := 'partage'\nexport compteur := { n: 0 }\n"
const BOUGIE  = "@import marque 'partage.module.civet'\n@import compteur 'partage.module.civet'\n\nexport dessiner = -> \"flamme #{marque}\"\nexport lire = -> compteur.n\nexport default { nom: 'bougie' }\n"
const HOTE    = ["@import compteur 'partage.module.civet'", '', '<script>', '  $dessin = \'rien\'', '  @charger = ->', "    moteur = await µimport('moteurs/bougie.module.civet')", '    $dessin = moteur.dessiner()', '  @compter = -> compteur.n++', '</script>', '', '<button class="charger" @click=@charger>charger</button>', '<p class="d">{$dessin}</p>', ''].join('\n')
const HOTE_SANS = ["@import compteur 'partage.module.civet'", '', '<script>', '  $dessin = \'rien\'', '  @charger = -> $dessin = \'ok\'', '  @compter = -> compteur.n++', '</script>', '', '<button class="charger" @click=@charger>charger</button>', '<p class="d">{$dessin}</p>', ''].join('\n')

const racine = join(dirname(fileURLToPath(import.meta.url)), '..')

function projet(nom: string, js: 'split' | 'bundle', lazy: boolean): string {
  const root = mjsTmp(nom)
  const fichiers: Record<string, string> = { 'src/hote.mjs': lazy ? HOTE : HOTE_SANS, 'src/moteurs/bougie.module.civet': BOUGIE, 'src/partage.module.civet': PARTAGE }
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(root, chemin)), { recursive: true })
    writeFileSync(join(root, chemin), contenu)
  }
  const config = { sourceDir: 'src', outputDir: 'dist', manifestPath: 'dist/bundle.js', urlPrefix: '/dist', js, runtime: 'core', render: { default: 'prerender', engine: { prerender: 'happy-dom' }, routes: { '/': { component: 'mjs-hote' } } } }
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config, null, 2))
  return root
}

function portLibre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

interface Serveur { arreter: () => void, log: () => string, port: number }

/** lance `mjs dev|serve` en processus fils (groupe à part : l'arrêt emporte aussi `npx` et `tsx`) et attend son annonce */
function demarrer(root: string, commande: 'dev' | 'serve', port: number): Promise<Serveur> {
  return new Promise((resolve, reject) => {
    let sortie = ''
    const child = spawn('npx', ['tsx', 'src/cli.ts', commande, '--root', root, '--port', String(port)], { cwd: racine, detached: true })
    const arreter = (): void => { try { process.kill(-child.pid!, 'SIGTERM') } catch { /* déjà parti */ } }
    const pret = commande === 'dev' ? /✅ \d+ fichiers/ : /rendu par requête/
    const garde = setTimeout(() => { arreter(); reject(new Error(`pas prêt en 100 s :\n${sortie.slice(-1500)}`)) }, 100000)
    const lire = (d: Buffer): void => {
      sortie += d.toString()
      if (new RegExp(`:${port}\\b`).test(sortie) && pret.test(sortie)) { clearTimeout(garde); resolve({ arreter, log: () => sortie, port }) }
    }
    child.stdout.on('data', lire)
    child.stderr.on('data', lire)
    child.on('exit', (code: number | null) => { clearTimeout(garde); reject(new Error(`sorti (${code}) :\n${sortie.slice(-1500)}`)) })
  })
}

function construire(root: string): void {
  const r = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', root], { cwd: racine, encoding: 'utf-8' })
  assert.equal(r.status, 0, `mjs build en échec :\n${r.stdout}\n${r.stderr}`)
}

const lancer = async (commande: 'dev' | 'serve', root: string): Promise<Serveur> => {
  if (commande === 'serve') construire(root)
  return demarrer(root, commande, await portLibre())
}

const SELECTEUR = "document.querySelector('mjs-hote')?._shadow?.querySelector('.charger')"

describe('mjs dev et mjs serve avec un bloc render — Chromium réel', function () {
  this.timeout(300000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, essais sautés. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
  })

  for (const commande of ['dev', 'serve'] as const) for (const js of ['split', 'bundle'] as const) for (const lazy of [false, true]) it(`${commande}, ${js === 'split' ? 'fichiers séparés' : 'fichier unique'}, ${lazy ? 'avec' : 'sans'} module chargé à la demande : le composant se monte${lazy ? ', le module se charge au clic' : ''}, la console reste vide`, async function () {
    if (!present) { this.skip(); return }
    const root = projet(`srv-${commande}-${js}-${lazy ? 'lazy' : 'sans'}`, js, lazy)
    const srv  = await lancer(commande, root)
    const page = await (await browser.newContext()).newPage()
    const echecs: string[]   = []
    const erreurs: string[]  = []
    page.on('response', (r: any) => { if (r.status() >= 400) echecs.push(`${r.status()} ${new URL(r.url()).pathname}`) })
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 200)) })
    page.on('pageerror', (e: any) => erreurs.push('pageerror ' + String(e.message ?? e).slice(0, 200)))
    try {
      await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'load' })
      await page.waitForFunction(`!!${SELECTEUR}`, null, { timeout: 15000 })
      assert.deepEqual(erreurs, [], `console vide attendue (échecs HTTP : ${JSON.stringify(echecs)})`)
      assert.deepEqual(echecs, [])
      if (lazy) {
        await page.evaluate("document.querySelector('mjs-hote')._shadow.querySelector('.charger').click()")
        await page.waitForFunction("document.querySelector('mjs-hote')._shadow.querySelector('.d').textContent === 'flamme partage'", null, { timeout: 15000 })
        assert.equal(await page.evaluate('window.__evaluations'), 1, 'le module partagé n\'est évalué qu\'une fois')
        assert.deepEqual(erreurs, [])
        assert.deepEqual(echecs, [])
      }
    }
    finally {
      await page.close()
      srv.arreter()
    }
  })

  for (const commande of ['dev', 'serve'] as const) it(`${commande} : seuls les fichiers que le build a consignés se lisent sous /__mjs/, jamais un autre fichier ni un chemin qui sort du dossier du manifeste`, async function () {
    if (!present) { this.skip(); return }
    const root = projet(`srv-voisins-${commande}`, 'bundle', true)
    const srv  = await lancer(commande, root)
    try {
      const dist     = join(root, 'dist')
      const morceaux = readdirSync(dist).filter(f => /^(?:bougie|chunk)-[a-f0-9]{8}\.js(?:\.map)?$/.test(f))
      assert.ok(morceaux.filter(f => f.endsWith('.js')).length >= 2, `le build a écrit le module et le morceau partagé : ${readdirSync(dist).join(', ')}`)
      writeFileSync(join(dist, 'chunk-deadbeef.js'), '// auteur : un fichier que le build n\'a pas écrit\n')
      writeFileSync(join(dist, 'secret.txt'), 'confidentiel\n')
      const lire = async (chemin: string): Promise<{ status: number, type: string, corps: string }> => {
        const r = await fetch(`http://127.0.0.1:${srv.port}${chemin}`)
        return { status: r.status, type: r.headers.get('content-type') ?? '', corps: await r.text() }
      }
      for (const f of morceaux.filter(n => n.endsWith('.js'))) {
        const r = await lire(`/__mjs/${f}`)
        assert.equal(r.status, 200, `/__mjs/${f} : ${r.status} ${r.corps.slice(0, 80)}`)
        assert.match(r.type, /javascript/, `/__mjs/${f} est servi comme du JavaScript`)
        assert.ok(r.corps.length > 20)
      }
      for (const interdit of ['/__mjs/chunk-deadbeef.js', '/__mjs/secret.txt', '/__mjs/.mjs-outputs.json', '/__mjs/mjs-precache.json', '/__mjs/bundle.js.map-inconnue', '/__mjs/dossier/bougie.js', '/__mjs/..%2fmjs.config.json', '/__mjs/%2e%2e%2fmjs.config.json', '/__mjs/..%2f..%2fmjs.config.json', `/__mjs/${morceaux[0]}%00.js`]) {
        const r = await lire(interdit)
        // un chemin inconnu rend la coque de la page (comportement du serveur de rendu), jamais le fichier visé
        assert.doesNotMatch(r.type, /javascript|json|text\/plain/, `${interdit} ne sert ni script ni donnée (reçu : ${r.status} ${r.type})`)
        assert.doesNotMatch(r.corps, /confidentiel|auteur : un fichier|"sourceDir"|"extensions"/, `${interdit} n'expose aucun fichier`)
      }
    }
    finally {
      srv.arreter()
    }
  })

  /** ouvre une visionneuse du serveur et rend ce que le navigateur a vu : statut, requêtes en échec, erreurs */
  const ouvrirVisionneuse = async (commande: 'dev' | 'serve', visionneuse: string, lazy: boolean): Promise<{ statut: number, echecs: string[], erreurs: string[] }> => {
    const root = projet(`srv-visionneuse-${commande}-${visionneuse}-${lazy ? 'lazy' : 'sans'}`, 'bundle', lazy)
    const srv  = await lancer(commande, root)
    const page = await (await browser.newContext()).newPage()
    const echecs: string[]  = []
    const erreurs: string[] = []
    page.on('response', (r: any) => { if (r.status() >= 400) echecs.push(`${r.status()} ${new URL(r.url()).pathname}`) })
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 200)) })
    page.on('pageerror', (e: any) => erreurs.push('pageerror ' + String(e.message ?? e).slice(0, 200)))
    try {
      const reponse = await page.goto(`http://127.0.0.1:${srv.port}/__mjs/${visionneuse}`, { waitUntil: 'load' })
      await page.waitForTimeout(1500)
      return { statut: reponse.status(), echecs, erreurs }
    }
    finally {
      await page.close()
      srv.arreter()
    }
  }

  // les erreurs que la visionneuse lève d'elle-même (hors sujet ici) sont les mêmes avec ou sans module chargé à la demande :
  // le manifeste coupé en morceaux ne doit en ajouter aucune, ni laisser une requête en échec
  for (const commande of ['dev', 'serve'] as const) for (const visionneuse of ['theme', 'errors']) it(`${commande} : la visionneuse /__mjs/${visionneuse} charge le manifeste en fichier unique coupé sans requête en échec et sans erreur de plus qu'avec un fichier unique entier`, async function () {
    if (!present) { this.skip(); return }
    const entier = await ouvrirVisionneuse(commande, visionneuse, false)
    const coupe  = await ouvrirVisionneuse(commande, visionneuse, true)
    assert.equal(coupe.statut, 200, `la visionneuse est servie (${coupe.statut})`)
    assert.deepEqual(coupe.echecs, [], 'aucune requête en échec (le manifeste et ses morceaux)')
    assert.deepEqual(coupe.erreurs, entier.erreurs, 'mêmes erreurs de console qu\'avec le fichier unique entier')
    assert.equal(coupe.erreurs.some(e => /module|import|MIME|Failed to (?:load|fetch)/i.test(e)), false, `aucune erreur de chargement de module : ${JSON.stringify(coupe.erreurs)}`)
  })
})
