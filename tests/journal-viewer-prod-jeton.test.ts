// journal d'erreurs ouvert par son jeton sous `mjs serve --prod` : la page de la visionneuse est compilée à la volée, hors de la
// construction, et doit parler au cœur de production tel qu'il est bâti — membres internes raccourcis (`_mjs_mount` y porte un
// nom court) et, pour une appli sans valeur dérivée, sans la machinerie des dérivées. Dans chaque moteur présent, la page s'ouvre
// sans erreur, liste l'entrée envoyée, filtre par source et déplie la pile ; la même page en fichier unique (`js: 'bundle'`) ; hors
// production, un cœur minifié par `minify: true` sert le journal et l'atelier de thème de la même façon
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent, type Moteur } from './helpers/navigateurs-compiles.js'
import { getViewerScript, JOURNAL_VIEWER } from '../src/server/viewer-page.js'

const RACINE  = fileURLToPath(new URL('..', import.meta.url))
const JETON   = 'jeton-essai'
const HOTE    = '<script>\n  $n = 1\n</script>\n<div class="bloc">Bonjour {$n}</div>\n'
const OMBRE   = `document.querySelector('mjs-journal-viewer')?._shadow`
const ATELIER = `document.querySelector('mjs-theme-viewer')?._shadow`

function portLibre(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as any).port
      s.close(() => ok(p))
    })
  })
}

interface Serveur { base: string, child: ChildProcess }

// une petite appli sans valeur dérivée, servie par `mjs serve` (`--prod` par défaut) avec le journal ouvert par jeton, et une erreur
// envoyée au journal
async function servir(js: 'split' | 'bundle', prod = true, minify?: boolean): Promise<Serveur> {
  const root = mjsTmp('journal-prod-jeton')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'hote.mjs'), HOTE)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'dist', manifestPath: 'dist/bundle.js', urlPrefix: '/dist', js, ...(minify === undefined ? {} : { minify }), journal: { client: true, viewer: JETON }, render: { default: 'prerender', engine: { prerender: 'happy-dom' }, routes: { '/': { component: 'mjs-hote' } } } }))
  const port  = await portLibre()
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'serve', ...(prod ? ['--prod'] : []), '--root', root, '--port', String(port)], { cwd: RACINE })
  let sortie  = ''
  await new Promise<void>((ok, ko) => {
    const garde = setTimeout(() => ko(new Error('serveur pas prêt :\n' + sortie.slice(-800))), 120000)
    const lire  = (d: Buffer) => {
      sortie += d
      if (new RegExp(`:${port}\\b`).test(sortie) && /rendu par requête/.test(sortie)) {
        clearTimeout(garde)
        ok()
      }
    }
    child.stdout!.on('data', lire)
    child.stderr!.on('data', lire)
    child.on('exit', (code) => ko(new Error('serveur sorti (' + code + ') :\n' + sortie.slice(-800))))
  })
  const base = `http://127.0.0.1:${port}`
  const r    = await fetch(`${base}/__mjs/errors`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'boum', stack: 'Error: boum', url: base + '/', version: '1' }) })
  assert.equal(r.status, 204, 'erreur reçue par le journal')
  return { base, child }
}

async function compter(page: any, selecteur: string): Promise<number> {
  return page.evaluate(`${OMBRE}?.querySelectorAll(${JSON.stringify(selecteur)}).length ?? 0`)
}

async function attendre(page: any, condition: string, quoi: string): Promise<void> {
  await page.waitForFunction(condition, null, { timeout: 8000 }).catch(() => {
    throw new Error('attendu : ' + quoi)
  })
}

// ouvre la page par son jeton dans un moteur, puis la fait travailler : liste, filtres, pile dépliée
async function visiter(serveur: Serveur, nom: Moteur): Promise<void> {
  const playwright: any = await import('playwright')
  const nav             = await playwright[nom].launch()
  try {
    const page              = await nav.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push('page : ' + String(e.message ?? e).slice(0, 200)))
    page.on('console', (m: any) => {
      if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200))
    })
    const rep = await page.goto(`${serveur.base}/__mjs/errors?token=${JETON}`, { waitUntil: 'load' })
    assert.equal(rep.status(), 200)
    await attendre(page, `(${OMBRE}?.querySelectorAll('.entry').length ?? 0) > 0`, 'une entrée du journal affichée').catch((e) => {
      throw new Error(e.message + ' ; erreurs : ' + JSON.stringify(erreurs))
    })
    assert.deepEqual(erreurs, [], 'aucune erreur à l\'ouverture')
    assert.equal(await compter(page, '.entry'), 1, 'l\'entrée envoyée')
    assert.ok(!page.url().includes('token='), 'le jeton a quitté la barre d\'adresse : ' + page.url())
    // filtre « serveur » : l'entrée du navigateur disparaît, le message du journal vide s'affiche
    await page.evaluate(`${OMBRE}.querySelectorAll('.filters button')[1].click()`)
    await attendre(page, `(${OMBRE}.querySelectorAll('.entry').length === 0) && ${OMBRE}.querySelector('p.empty') !== null`, 'liste vide sous le filtre serveur')
    // filtre « client » : elle revient
    await page.evaluate(`${OMBRE}.querySelectorAll('.filters button')[2].click()`)
    await attendre(page, `${OMBRE}.querySelectorAll('.entry').length === 1`, 'l\'entrée sous le filtre client')
    assert.equal(await page.evaluate(`${OMBRE}.querySelectorAll('.filters button.active').length`), 1, 'un seul filtre actif')
    // un clic sur l'entrée déplie sa pile
    await page.evaluate(`${OMBRE}.querySelector('.entry').click()`)
    await attendre(page, `${OMBRE}.querySelector('.stack')?.textContent.includes('Error: boum') === true`, 'la pile dépliée')
    assert.deepEqual(erreurs, [], 'aucune erreur en travaillant')
  }
  finally {
    await nav.close()
  }
}

describe('journal d\'erreurs ouvert par jeton sous `mjs serve --prod`', function () {
  this.timeout(240000)

  describe('fichiers séparés (`js: \'split\'`)', function () {
    let serveur: Serveur | null = null
    before(async function () {
      serveur = await servir('split')
    })
    after(function () {
      serveur?.child.kill()
    })
    for (const nom of MOTEURS) {
      it(`${nom} : la page s'ouvre, liste, filtre et déplie`, async function () {
        if (!(await moteurPresent(nom))) this.skip()
        await visiter(serveur!, nom)
      })
    }
  })

  describe('fichier unique (`js: \'bundle\'`)', function () {
    let serveur: Serveur | null = null
    before(async function () {
      serveur = await servir('bundle')
    })
    after(function () {
      serveur?.child.kill()
    })
    it('chromium : la page s\'ouvre, liste, filtre et déplie', async function () {
      if (!(await moteurPresent('chromium'))) this.skip()
      await visiter(serveur!, 'chromium')
    })
  })
  describe('hors production, cœur minifié (`minify: true`)', function () {
    let serveur: Serveur | null = null
    before(async function () {
      serveur = await servir('split', false, true)
    })
    after(function () {
      serveur?.child.kill()
    })
    it('chromium : le journal s\'ouvre, liste, filtre et déplie', async function () {
      if (!(await moteurPresent('chromium'))) this.skip()
      await visiter(serveur!, 'chromium')
    })
    it('chromium : l\'atelier de thème s\'ouvre', async function () {
      if (!(await moteurPresent('chromium'))) this.skip()
      const playwright: any = await import('playwright')
      const nav             = await playwright.chromium.launch()
      try {
        const page              = await nav.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push('page : ' + String(e.message ?? e).slice(0, 200)))
        page.on('console', (m: any) => {
          if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200))
        })
        const rep = await page.goto(`${serveur!.base}/__mjs/theme`, { waitUntil: 'load' })
        assert.equal(rep.status(), 200)
        await attendre(page, `(${ATELIER}?.querySelectorAll('.workshop h1').length ?? 0) === 1 && ${ATELIER}.querySelectorAll('.stat').length > 0`, 'l\'atelier affiché').catch((e) => {
          throw new Error(e.message + ' ; erreurs : ' + JSON.stringify(erreurs))
        })
        assert.deepEqual(erreurs, [], 'aucune erreur à l\'ouverture')
      }
      finally {
        await nav.close()
      }
    })
  })
})

// la page ne prend les noms courts que d'un cœur qui les porte : la table d'une construction minifiée précédente peut rester dans le
// dossier de sortie d'une construction de développement
describe('getViewerScript : la table des noms courts ne sert qu\'au cœur minifié', function () {
  function sortie(nom: string, coeur: string): string {
    const dir = mjsTmp('viewer-noms-courts')
    writeFileSync(join(dir, 'bundle.js'), `const µCore = '/dist/${nom}';\nµ.paths = {};\n`)
    writeFileSync(join(dir, nom), coeur)
    writeFileSync(join(dir, '.mangle-cache.json'), JSON.stringify({ _mjs_mount: 'H', _mjs_init: 'I' }))
    return dir
  }

  it('cœur aux noms longs, table d\'une construction précédente à côté : la page garde les noms longs', async function () {
    this.timeout(20000)
    const dir = sortie('mjs_core-noms1111.js', 'µ.Element = class { _mjs_mount(f) { return f() } };\n')
    const js  = await getViewerScript(join(dir, 'bundle.js'), JOURNAL_VIEWER, dir)
    assert.match(js, /this\._mjs_mount\(/)
  })

  it('cœur minifié : la page appelle ses membres par leur nom court', async function () {
    this.timeout(20000)
    const dir = sortie('mjs_core-noms2222.js', 'e.Element=class{H(f){return f()}};\n')
    const js  = await getViewerScript(join(dir, 'bundle.js'), JOURNAL_VIEWER, dir)
    assert.match(js, /\.H\(/)
    assert.doesNotMatch(js, /_mjs_mount/)
  })

  // le cœur de développement garde en toutes lettres, dans une chaîne, la liste des champs internes que le rechargement à chaud
  // laisse de côté : ce n'est ni un appel ni une définition, le cœur reste minifié
  it('cœur minifié de développement, liste des champs internes en toutes lettres : la page appelle ses membres par leur nom court', async function () {
    this.timeout(20000)
    const dir = sortie('mjs_core-noms3333.js', 'e.Element=class{H(f){return f()}};var t=new Set("_mjs_mods _mjs_mount _mjs_mountReal".split(" "));\n')
    const js  = await getViewerScript(join(dir, 'bundle.js'), JOURNAL_VIEWER, dir)
    assert.match(js, /\.H\(/)
    assert.doesNotMatch(js, /_mjs_mount/)
  })
})
