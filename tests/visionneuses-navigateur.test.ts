// Ce que ce test garantit : les visionneuses de développement `/__mjs/theme` (atelier des variables de thème) et
// `/__mjs/errors` (journal d'erreurs) s'ouvrent dans un vrai navigateur, affichent leur contenu, se déplient au clic et
// laissent la console vide, quel que soit le cœur de l'application : complet (clé `runtime` absente) ou nu
// (`runtime: 'core'`, qui n'embarque ni les crochets de vie, ni les blocs {if} et {for}, ni les mutations profondes que ces
// pages appellent). Servies par un vrai `mjs dev` et un vrai `mjs serve` (processus fils, port libre), en fichiers séparés
// comme en fichier unique. Chromium et Firefox réels, quand ils sont installés.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..')

// un composant statique et son thème : le registre de l'atelier a des lignes à déplier
const HOTE = [
  '<theme>',
  '  $$gap:   12px',
  '  $$ton:   #ff0066',
  '  $$trait: 2px',
  '</theme>',
  '<div class="bloc">Bonjour</div>',
  '<style>',
  '  .bloc',
  '    gap: $$gap',
  '    color: $$ton',
  '    border: var(--mjs-trait, 1px) solid',
  '</style>',
  ''
].join('\n')

// pour chaque visionneuse : sa balise, ce que son titre dit, une ligne de sa liste, la partie qui s'ouvre au clic
const VISIONNEUSES: Record<string, { balise: string, titre: string, ligne: string, clic: string, detail: string }> = {
  theme:  { balise: 'mjs-theme-viewer', titre: 'Variables de thème', ligne: '.variable', clic: '.variable .nom', detail: '.variable .detail' },
  errors: { balise: 'mjs-journal-viewer', titre: 'Journal d\'erreurs', ligne: '.entree', clic: '.entree', detail: '.entree .pile' },
}

function projet(coeur: 'complet' | 'nu', js: 'split' | 'bundle', manifesteAPart = false): string {
  const root = mjsTmp(`visionneuses-${coeur}-${js}`)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'hote.mjs'), HOTE)
  const config = { sourceDir: 'src', outputDir: 'dist', manifestPath: manifesteAPart ? 'app/bundle.js' : 'dist/bundle.js', urlPrefix: '/dist', js, ...(coeur === 'nu' ? { runtime: 'core' } : {}), journal: { client: true }, render: { default: 'prerender', engine: { prerender: 'happy-dom' }, routes: { '/': { component: 'mjs-hote' } } } }
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

interface Serveur { arreter: () => Promise<void>, port: number }

/** lance `mjs dev|serve` en processus fils (un seul processus : `child.kill()` suffit) et attend son annonce */
function demarrer(root: string, commande: 'dev' | 'serve', port: number): Promise<Serveur> {
  return new Promise((resolve, reject) => {
    let sortie = ''
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', commande, '--root', root, '--port', String(port)], { cwd: racine })
    const sorti = new Promise<void>(fin => child.once('exit', () => fin()))
    const arreter = async (): Promise<void> => {
      child.kill()
      await Promise.race([sorti, new Promise<void>(fin => setTimeout(() => { child.kill('SIGKILL'); fin() }, 5000))])
    }
    const pret  = commande === 'dev' ? /✅ \d+ fichiers/ : /rendu par requête/
    const garde = setTimeout(() => { void arreter(); reject(new Error(`pas prêt en 100 s :\n${sortie.slice(-1500)}`)) }, 100000)
    const lire  = (d: Buffer): void => {
      sortie += d.toString()
      if (new RegExp(`:${port}\\b`).test(sortie) && pret.test(sortie)) { clearTimeout(garde); resolve({ arreter, port }) }
    }
    child.stdout.on('data', lire)
    child.stderr.on('data', lire)
    child.on('exit', (code: number | null) => { clearTimeout(garde); reject(new Error(`sorti (${code}) :\n${sortie.slice(-1500)}`)) })
  })
}

/** ouvre une visionneuse dans une page neuve et rend ce que le navigateur a vu */
async function inspecter(navigateur: any, base: string, nom: string): Promise<{ statut: number, titre: string, lignes: number, details: number, echecs: string[], erreurs: string[] }> {
  const v    = VISIONNEUSES[nom]
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 900 } })
  const echecs: string[]  = []
  const erreurs: string[] = []
  page.on('response', (r: any) => { if (r.status() >= 400) echecs.push(`${r.status()} ${new URL(r.url()).pathname}`) })
  page.on('pageerror', (e: any) => erreurs.push('page : ' + String(e.message ?? e).slice(0, 200)))
  page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
  try {
    const reponse = await page.goto(`${base}/__mjs/${nom}`, { waitUntil: 'load' })
    // la coque du composant est fermée : on passe par sa propriété `_shadow`
    const racineDom = `document.querySelector('${v.balise}')?._shadow`
    await page.waitForFunction(`(${racineDom}?.querySelectorAll('${v.ligne}').length ?? 0) > 0`, null, { timeout: 15000 }).catch(() => {})
    const lignes = await page.evaluate(`${racineDom}?.querySelectorAll('${v.ligne}').length ?? 0`) as number
    const titre  = await page.evaluate(`(${racineDom}?.textContent ?? '').replace(/\\s+/g, ' ').trim()`) as string
    await page.evaluate(`${racineDom}?.querySelector('${v.clic}')?.click()`)
    await page.waitForTimeout(400)
    const details = await page.evaluate(`${racineDom}?.querySelectorAll('${v.detail}').length ?? 0`) as number
    return { statut: reponse!.status(), titre, lignes, details, echecs, erreurs }
  }
  finally {
    await page.close()
  }
}

describe('visionneuses de développement — navigateurs réels, serveurs réels', function () {
  this.timeout(600000)
  const navigateurs: Record<string, any> = {}

  before(async function () {
    const playwright = await import('playwright')
    for (const nom of ['chromium', 'firefox'] as const) {
      if (existsSync(playwright[nom].executablePath())) navigateurs[nom] = await playwright[nom].launch()
    }
    if (Object.keys(navigateurs).length === 0) console.log('  ℹ️  aucun navigateur installé, essais sautés. Activer : `npx playwright install chromium firefox`')
  })

  after(async () => {
    for (const navigateur of Object.values(navigateurs)) await navigateur.close()
  })

  // le dernier cas : le manifeste n'est pas dans le dossier de sortie (l'appli de référence est ainsi faite) — le serveur dit où est le cœur
  const CAS: Array<['complet' | 'nu', 'split' | 'bundle', 'dev' | 'serve', boolean]> = []
  for (const coeur of ['complet', 'nu'] as const) for (const js of ['split', 'bundle'] as const) for (const commande of ['dev', 'serve'] as const) CAS.push([coeur, js, commande, false])
  for (const coeur of ['complet', 'nu'] as const) for (const commande of ['dev', 'serve'] as const) CAS.push([coeur, 'split', commande, true])

  for (const [coeur, js, commande, aPart] of CAS) it(`${commande}, cœur ${coeur}, ${js === 'split' ? 'fichiers séparés' : 'fichier unique'}${aPart ? ', manifeste hors du dossier de sortie' : ''} : l'atelier de thème et le journal s'ouvrent, affichent leur contenu et laissent la console vide`, async function () {
    if (Object.keys(navigateurs).length === 0) return this.skip()
    const root = projet(coeur, js, aPart)
    if (commande === 'serve') {
      const b = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'build', '--root', root], { cwd: racine, encoding: 'utf-8' })
      assert.equal(b.status, 0, `mjs build en échec :\n${b.stdout}\n${b.stderr}`)
    }
    const srv  = await demarrer(root, commande, await portLibre())
    const base = `http://127.0.0.1:${srv.port}`
    const bilan: string[] = []
    try {
      // une erreur cliente au journal : la liste du journal a une ligne à déplier
      const envoi = await fetch(`${base}/__mjs/errors`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'boum', pile: 'Error: boum\n    at essai', url: `${base}/`, version: '1' }) })
      assert.equal(envoi.status, 204, 'l\'erreur cliente est reçue par le journal')
      for (const [nomNavigateur, navigateur] of Object.entries(navigateurs)) for (const nom of Object.keys(VISIONNEUSES)) {
        const v = await inspecter(navigateur, base, nom)
        const etiquette = `${nomNavigateur} /__mjs/${nom}`
        if (v.statut !== 200) bilan.push(`${etiquette} : statut ${v.statut}`)
        if (v.erreurs.length > 0) bilan.push(`${etiquette} : erreurs ${JSON.stringify(v.erreurs)}`)
        if (v.echecs.length > 0) bilan.push(`${etiquette} : requêtes en échec ${JSON.stringify(v.echecs)}`)
        if (!v.titre.includes(VISIONNEUSES[nom].titre)) bilan.push(`${etiquette} : le titre « ${VISIONNEUSES[nom].titre} » manque (contenu : « ${v.titre.slice(0, 80)} »)`)
        if (v.lignes < 1) bilan.push(`${etiquette} : aucune ligne affichée`)
        if (v.details < 1) bilan.push(`${etiquette} : le clic sur une ligne n'ouvre rien`)
      }
    }
    finally {
      await srv.arreter()
    }
    assert.deepEqual(bilan, [], bilan.join('\n'))
  })
})
