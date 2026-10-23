// `@persist` quand le navigateur refuse le stockage (navigation privée, accès bloqué, quota plein) : le
// composant se monte, la variable garde sa valeur de départ, un clic change l'état à l'écran, et rien n'est
// signalé (ni erreur de page, ni message dans la console, ni « Crash intercepted ») ; seule la sauvegarde est
// perdue. Quatre situations rejouées dans un vrai navigateur, construit en développement puis en production
// (le code minifié est celui qui tourne chez l'utilisateur) : l'accès à `localStorage` qui lève, l'accès à
// `sessionStorage` qui lève, `setItem` qui lève dès le départ, `setItem` qui ne lève qu'après le premier rendu.
// Puis le stockage normal, qui ne change pas : la valeur enregistrée revient, les changements s'enregistrent,
// une valeur illisible ou d'un autre type laisse la valeur de départ. Les trois écritures de la directive
// sont dans le composant (`@persist $a $b`, `@persist session: $c`). Chromium et Firefox réels.
// La garde ne couvre QUE le stockage : une faute dans `by:` (au montage, ou après), un état que JSON ne sait pas
// écrire (BigInt, cycle) sortent comme sans garde (« Crash intercepted », ou erreur de page au montage), et la clé
// d'écriture de `by:` suit la variable qui change (un panier par utilisateur).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, normalize, extname } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const SOURCE = `@persist $draft $note
@persist session: $step

<script>
  $draft = 'depart'
  $note  = 'n1'
  $step  = 1

  change = ->
    $draft = 'change'
    $note  = 'n2'
    $step++
</script>

<p class="d">{$draft}/{$note}/{$step}</p>
<button class="ch" @click={change()}>changer</button>
`

// des clés qui se calculent (`by:`) et des états que JSON écrit mal : de quoi faire sortir une faute, après le montage
const SOURCE_KEY = `@persist $cart by: $uid
@persist $bn by: $cfg.id
@persist $big
@persist $cyc

<script>
  $cart = 'empty'
  $uid  = 1
  $bn   = 'bn'
  $cfg  = {id: 'c1'}
  $big  = 1
  $cyc  = {a: 1}

  fill = ->
    $cart = 'full'

  switchUser = ->
    $uid = 2

  dropCfg = ->
    $cfg = null

  makeBig = ->
    $big = 10n

  makeCycle = ->
    o      = {}
    o.self = o
    $cyc   = o
</script>

<p class="d">{$cart}/{$uid}</p>
<button class="fill" @click={fill()}>remplir</button>
<button class="user" @click={switchUser()}>autre utilisateur</button>
<button class="drop" @click={dropCfg()}>retirer</button>
<button class="big" @click={makeBig()}>bigint</button>
<button class="cycle" @click={makeCycle()}>cycle</button>
`

// une clé qui lève dès le montage
const SOURCE_BADKEY = `@persist $x by: $cfg.id

<script>
  $x   = 1
  $cfg = null
</script>

<p class="d">{$x}</p>
`

const SOURCES: Record<string, string> = { base: SOURCE, key: SOURCE_KEY, badkey: SOURCE_BADKEY }

type Mode = 'dev' | 'prod'

interface Site { page: string, dist: string }

const sites = new Map<string, Promise<Site>>()

// la page construite une fois par mode et par source, pour les deux navigateurs : en développement le script entier
// est posé dans la page (comme les tests voisins), en production la page charge `bundle.js` en module
function site(mode: Mode, name = 'base'): Promise<Site> {
  const id = mode + ':' + name
  if (!sites.has(id)) {
    sites.set(id, (async () => {
      const root   = mjsTmp('persist-refuse-' + mode + '-' + name)
      const srcDir = join(root, 'src')
      const dist   = join(root, 'dist')
      const outDir = join(dist, 'assets')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'hote.mjs'), SOURCES[name])
      const options = mode === 'prod'
        ? { urlPrefix: '/assets', runtime: 'core', js: 'bundle', env: 'prod' }
        : {}
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), ...options } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      if (mode === 'prod') {
        return { dist, page: '<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/assets/bundle.js"></script></head><body><mjs-hote></mjs-hote></body></html>' }
      }
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      const code  = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      return { dist, page: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${code}</script></body></html>` }
    })())
  }
  return sites.get(id)!
}

// les situations : le script posé AVANT ceux de la page, et ce que le test fait après le premier rendu
const SITUATIONS = [
  {
    nom: 'l\'accès à localStorage lève (SecurityError)',
    avant: 'Object.defineProperty(window, \'localStorage\', { get() { throw new DOMException(\'The operation is insecure.\', \'SecurityError\') }, configurable: true })',
    apres: null,
    stockage: { local: false, session: true },
  },
  {
    nom: 'l\'accès à sessionStorage lève (SecurityError)',
    avant: 'Object.defineProperty(window, \'sessionStorage\', { get() { throw new DOMException(\'The operation is insecure.\', \'SecurityError\') }, configurable: true })',
    apres: null,
    stockage: { local: true, session: false },
  },
  {
    nom: 'setItem lève dès le départ (QuotaExceededError)',
    avant: 'Storage.prototype.setItem = function() { throw new DOMException(\'quota\', \'QuotaExceededError\') }',
    apres: null,
    stockage: { local: false, session: false },
  },
  {
    nom: 'setItem ne lève qu\'après le premier rendu (quota qui se remplit)',
    avant: 'const set = Storage.prototype.setItem; window.__plein = false; Storage.prototype.setItem = function(k, v) { if (window.__plein) throw new DOMException(\'quota\', \'QuotaExceededError\'); return set.call(this, k, v) }',
    apres: 'window.__plein = true',
    stockage: { local: false, session: false },
  },
]

const HOTE = 'document.querySelector(\'mjs-hote\')'

// le texte du composant ; null s'il ne se monte jamais
async function texte(page: any, attendu?: string): Promise<string | null> {
  const fin             = Date.now() + 7000
  let lu: string | null = null
  while (Date.now() < fin) {
    lu = await page.evaluate(`${HOTE}?._shadow?.querySelector('.d')?.textContent ?? null`)
    if (lu !== null && (attendu === undefined || lu === attendu)) return lu
    await page.waitForTimeout(100)
  }
  return lu
}

// le premier message (console ou erreur de page) qui correspond ; null s'il ne vient pas
async function waitFor(page: any, list: string[], pattern: RegExp): Promise<string | null> {
  const end = Date.now() + 5000
  while (Date.now() < end) {
    const found = list.find((m) => pattern.test(m))
    if (found) return found
    await page.waitForTimeout(100)
  }
  return null
}

// la valeur d'une clé de localStorage, relue jusqu'à ce qu'elle soit celle qu'on attend (l'effet d'écriture part juste après le rendu)
async function stored(page: any, key: string, expected: string): Promise<string | null> {
  const end               = Date.now() + 5000
  let read: string | null = null
  while (Date.now() < end) {
    read = await page.evaluate(`localStorage.getItem(${JSON.stringify(key)})`)
    if (read === expected) return read
    await page.waitForTimeout(100)
  }
  return read
}

for (const nom of ['chromium', 'firefox'] as const) for (const mode of ['dev', 'prod'] as const) describe(`@persist — stockage refusé, construit en ${mode === 'dev' ? 'développement' : 'production'} (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any

  // une page neuve (stockage vide), servie à http://t.test/ ; `avant` est posé avant les scripts de la page
  async function ouvrir(avant?: string, name = 'base') {
    const { page: html, dist } = await site(mode, name)
    const contexte             = await browser.newContext({ viewport: { width: 900, height: 700 } })
    const page                 = await contexte.newPage()
    const erreurs: string[]    = []
    const messages: string[]   = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    page.on('console', (m: any) => messages.push(m.type() + ' : ' + m.text()))
    await page.addInitScript('window.__name = (f) => f')
    if (avant) await page.addInitScript(avant)
    await page.route('http://t.test/**', async (route: any) => {
      const chemin  = new URL(route.request().url()).pathname
      const fichier = join(dist, normalize(chemin))
      if (chemin === '/') await route.fulfill({ contentType: 'text/html', body: html })
      else if (fichier.startsWith(dist) && existsSync(fichier) && statSync(fichier).isFile()) await route.fulfill({ contentType: extname(fichier) === '.js' ? 'text/javascript' : 'application/octet-stream', body: readFileSync(fichier) })
      else await route.fulfill({ status: 204 })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    return { page, erreurs, messages, fermer: () => contexte.close() }
  }

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      for (const name of Object.keys(SOURCES)) await site(mode, name)
      browser = await playwright[nom].launch()
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const s of SITUATIONS) {
    it(`${s.nom} : le composant se monte, garde ses valeurs de départ, un clic change l'état, rien n'est signalé`, async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs, messages, fermer } = await ouvrir(s.avant)
      try {
        assert.equal(await texte(page), 'depart/n1/1', 'le composant se monte avec les valeurs de départ')
        if (s.apres) await page.evaluate(s.apres)
        await page.evaluate(`${HOTE}._shadow.querySelector('.ch').click()`)
        assert.equal(await texte(page, 'change/n2/2'), 'change/n2/2', 'le clic change l\'état à l\'écran')
        assert.deepEqual(erreurs, [], 'aucune erreur de page')
        assert.deepEqual(messages, [], 'aucun message dans la console (ni « Crash intercepted »)')
        // le stockage qui marche encore continue d'enregistrer, chaque variable a sa garde
        if (s.stockage.session) assert.equal(await page.evaluate('sessionStorage.getItem(\'mjs-hote:step\')'), '2', 'sessionStorage enregistre encore')
        if (s.stockage.local) assert.equal(await page.evaluate('localStorage.getItem(\'mjs-hote:draft\')'), '"change"', 'localStorage enregistre encore')
      }
      finally {
        await fermer()
      }
    })
  }

  it('stockage normal : les valeurs de départ s\'enregistrent, un clic enregistre l\'état, un rechargement le restaure', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs, messages, fermer } = await ouvrir()
    try {
      assert.equal(await texte(page), 'depart/n1/1')
      assert.equal(await page.evaluate('localStorage.getItem(\'mjs-hote:draft\') + \'|\' + localStorage.getItem(\'mjs-hote:note\') + \'|\' + sessionStorage.getItem(\'mjs-hote:step\')'), '"depart"|"n1"|1', 'les valeurs de départ sont enregistrées')
      await page.evaluate(`${HOTE}._shadow.querySelector('.ch').click()`)
      assert.equal(await texte(page, 'change/n2/2'), 'change/n2/2')
      assert.equal(await page.evaluate('localStorage.getItem(\'mjs-hote:draft\') + \'|\' + localStorage.getItem(\'mjs-hote:note\') + \'|\' + sessionStorage.getItem(\'mjs-hote:step\')'), '"change"|"n2"|2', 'le clic est enregistré, sous les mêmes clés')
      await page.reload({ waitUntil: 'load' })
      assert.equal(await texte(page), 'change/n2/2', 'le rechargement restaure l\'état enregistré')
      assert.deepEqual(erreurs, [])
      assert.deepEqual(messages, [])
    }
    finally {
      await fermer()
    }
  })

  it('stockage normal : une valeur du bon type revient ; une valeur d\'un autre type ou illisible laisse la valeur de départ', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs, messages, fermer } = await ouvrir('localStorage.setItem(\'mjs-hote:draft\', JSON.stringify(\'relu\')); localStorage.setItem(\'mjs-hote:note\', \'42\'); sessionStorage.setItem(\'mjs-hote:step\', \'{illisible\')')
    try {
      assert.equal(await texte(page), 'relu/n1/1', 'draft revient ; note (un nombre, pas du texte) et step (JSON cassé) gardent leur départ')
      assert.deepEqual(erreurs, [])
      assert.deepEqual(messages, [])
    }
    finally {
      await fermer()
    }
  })

  it('stockage normal : une valeur enregistrée vide (pas du JSON) laisse la valeur de départ', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs, messages, fermer } = await ouvrir('localStorage.setItem(\'mjs-hote:draft\', \'\')')
    try {
      assert.equal(await texte(page), 'depart/n1/1')
      assert.deepEqual(erreurs, [])
      assert.deepEqual(messages, [])
    }
    finally {
      await fermer()
    }
  })

  it('clé d\'écriture : @persist … by: suit la variable qui change (un panier par utilisateur)', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs, messages, fermer } = await ouvrir(undefined, 'key')
    try {
      assert.equal(await texte(page), 'empty/1')
      assert.equal(await stored(page, 'mjs-hote:cart:1', '"empty"'), '"empty"', 'le panier de départ est enregistré sous la clé de l\'utilisateur 1')
      await page.evaluate(`${HOTE}._shadow.querySelector('.user').click()`)
      assert.equal(await texte(page, 'empty/2'), 'empty/2')
      assert.equal(await stored(page, 'mjs-hote:cart:2', '"empty"'), '"empty"', 'après le changement d\'utilisateur, l\'écriture part sous la nouvelle clé')
      await page.evaluate(`${HOTE}._shadow.querySelector('.fill').click()`)
      assert.equal(await texte(page, 'full/2'), 'full/2')
      assert.equal(await stored(page, 'mjs-hote:cart:2', '"full"'), '"full"', 'le panier rempli est enregistré sous la clé de l\'utilisateur 2')
      assert.equal(await page.evaluate('localStorage.getItem(\'mjs-hote:cart:1\')'), '"empty"', 'la clé de l\'utilisateur 1 garde son panier')
      assert.deepEqual(erreurs, [])
      assert.deepEqual(messages, [])
    }
    finally {
      await fermer()
    }
  })

  it('la garde ne couvre que le stockage : une faute dans by: après le montage sort comme sans garde (« Crash intercepted »)', async function () {
    if (!present) { this.skip(); return }
    const { page, messages, fermer } = await ouvrir(undefined, 'key')
    try {
      assert.equal(await texte(page), 'empty/1')
      assert.deepEqual(messages, [], 'rien n\'est signalé tant que by: se calcule')
      await page.evaluate(`${HOTE}._shadow.querySelector('.drop').click()`)
      const found = await waitFor(page, messages, /Crash intercepted in mjs-hote/)
      assert.ok(found, `l'erreur de by: sort : ${JSON.stringify(messages)}`)
    }
    finally {
      await fermer()
    }
  })

  for (const [what, button] of [['un BigInt', 'big'], ['un cycle', 'cycle']] as const) {
    it(`la garde ne couvre que le stockage : un état que JSON ne sait pas écrire (${what}) sort comme sans garde (« Crash intercepted »)`, async function () {
      if (!present) { this.skip(); return }
      const { page, messages, fermer } = await ouvrir(undefined, 'key')
      try {
        assert.equal(await texte(page), 'empty/1')
        assert.deepEqual(messages, [], 'rien n\'est signalé tant que l\'état s\'écrit')
        await page.evaluate(`${HOTE}._shadow.querySelector('.${button}').click()`)
        const found = await waitFor(page, messages, /Crash intercepted in mjs-hote/)
        assert.ok(found, `l'erreur de JSON.stringify sort : ${JSON.stringify(messages)}`)
      }
      finally {
        await fermer()
      }
    })
  }

  it('la garde ne couvre que le stockage : une faute dans by: au montage sort comme sans garde (erreur de page)', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs, fermer } = await ouvrir(undefined, 'badkey')
    try {
      const found = await waitFor(page, erreurs, /TypeError/)
      assert.ok(found, `l'erreur de by: sort au montage : ${JSON.stringify(erreurs)}`)
    }
    finally {
      await fermer()
    }
  })
})
