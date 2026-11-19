// Un gestionnaire d'événement garde sa variable pour lui (comme en CoffeeScript), sauf une globale du navigateur dont l'affectation agit :
// `location = '#x'` navigue, `onresize = -> …` pose le gestionnaire de la fenêtre ; `name`, `status`, `once` restent les siens — sur une ligne, à deux instructions,
// en bloc. Une variable de la page écrite sans `window.` reste celle du gestionnaire ; en développement, un avertissement le dit, rien
// en production. Vraies constructions, page réelle (production en module : mode strict), Chromium et Firefox
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves, type Cible } from './helpers/liaison-navigateur.js'

const L = (...l: string[]) => l.join('\n') + '\n'
const S = (corps: string, ...gabarit: string[]) => L('<script>', corps, '</script>', ...gabarit)
const sources: Record<string, string> = {
  'g-loc-ligne.mjs': S('$n = 0', '<p class="v">{$n}</p>', "<button class=\"b\" @click={-> location = '#ligne'}>b</button>"),
  'g-loc-deux.mjs': S('$n = 0', '<p class="v">{$n}</p>', "<button class=\"b\" @click={-> $n = 1; location = '#deux'}>b</button>"),
  'g-loc-bloc.mjs': S('$n = 0', '<p class="v">{$n}</p>', '<button class="b" @click={->', "  location = '#bloc'", '}>b</button>'),
  'g-locaux-ligne.mjs': S("$v = ''", '<p class="v">{$v}</p>', "<button class=\"b\" @click={-> once = 1; name = 5; status = 'ok'; $v = [once, typeof name, status].join()}>b</button>"),
  'g-locaux-bloc.mjs': S("$v = ''", '<p class="v">{$v}</p>', '<button class="b" @click={->', '  once = 1', '  name = 5', "  status = 'ok'", '  $v = [once, typeof name, status].join()', '}>b</button>'),
  'g-navigateur.mjs': S("$v = ''", '<p class="v">{$v}</p>', "<button class=\"b\" @click={-> name = 5; status = 'ok'; length = 3; top = 1; open = 2; $v = [typeof name, status, length, top, open].join()}>b</button>"),
  'g-var.mjs': S('$n = 0', '<p class="v">{$n}</p>', '<button class="b" @click={-> gv = 1}>b</button>', '<button class="b2" @click={-> $n = window.gv}>b2</button>'),
  'g-redim.mjs': S('$n = 0', '<p class="v">{$n}</p>', '<button class="b" @click={-> onresize = -> $n = 7}>b</button>'),
  'g-rang.mjs': S('$l = [1, 2]', '$sel = 0', '<p class="v">{$sel}</p>', '<button class="b" @click={-> rang = $l.indexOf(2); $sel = rang}>b</button>'),
  'g-page.mjs': S('window.gx = 0', '$n = 0', '<p class="v">{$n}</p>', '<button class="b" @click={-> gx = 1}>b</button>', '<button class="b2" @click={-> $n = window.gx}>b2</button>'),
  'g-page-deux.mjs': S('window.gy = 0', '$n = 0', '<p class="v">{$n}</p>', '<button class="b" @click={-> gy = 5; $n = window.gy}>b</button>'),
  'g-page-bloc.mjs': S('window.gb = 0', '$n = 0', '<p class="v">{$n}</p>', '<button class="b" @click={->', '  gb = 5', '}>b</button>', '<button class="b2" @click={-> $n = window.gb}>b2</button>'),
  'g-hors-boucle.mjs': S("$l = ['a', 'b']", "$v = ''", '<p class="v">{$v}</p>', '{for location in $l}', '<button class="i" @click={-> $v = location}>{location}</button>', '{end}', "<button class=\"b\" @click={-> location = '#hors'}>b</button>"),
  'g-ailleurs-ligne.mjs': S("$v = ''", '<p class="v">{$v}</p>', '<button class="b" @click={-> onpointerrawupdate = 1; $v = typeof onpointerrawupdate}>b</button>'),
  'g-ailleurs-bloc.mjs': S("$v = ''", '<p class="v">{$v}</p>', '<button class="b" @click={->', '  onpointerrawupdate = 1', '  $v = typeof onpointerrawupdate', '}>b</button>'),
  'g-boucle.mjs': S("$l = ['a', 'b']", '$n = 0', '<p class="v">{$n}</p>', '{for name in $l}', '<button class="b" @click={-> $n = name}>{name}</button>', '{end}'),
}
const balises = Object.keys(sources).map((f) => 'mjs-' + f.replace(/\.mjs$/, ''))
const clics: Record<string, string[]> = { 'g-page': ['.b', '.b', '.b2'], 'g-page-bloc': ['.b', '.b2'], 'g-var': ['.b', '.b', '.b2'], 'g-hors-boucle': ['.i', '.b'] }

const trouve = `const trouve = (r, s) => { if (!r) return null; const x = r.querySelector(s); if (x) return x; for (const e of r.querySelectorAll('*')) { const y = e._shadow ? trouve(e._shadow, s) : null; if (y) return y } return null }`

type Lu = { v: string, hash: string, nom: string, statut: string, redim: string, globales: string[], gx: unknown, graves: string[], avis: string[] }

// le composant monté, ses boutons cliqués dans l'ordre (puis la fenêtre redimensionnée), ce que la page en garde
async function lireCas(browser: any, cible: Cible, nom: string, avant = ''): Promise<Lu> {
  const balise = 'mjs-' + nom
  const o      = await charger(browser, cible, balise)
  try {
    await o.page.waitForFunction(`(() => { ${trouve}; return !!trouve(document.querySelector('${balise}')?._shadow, '.v') })()`, null, { timeout: 8000 })
    // script classique de la page, posé avant les clics (`var gv = 0`)
    if (avant) await o.page.addScriptTag({ content: avant })
    for (const c of clics[nom] ?? ['.b']) {
      await o.page.evaluate(`(() => { ${trouve}; trouve(document.querySelector('${balise}')._shadow, '${c}').click() })()`)
      await o.page.waitForTimeout(150)
    }
    await o.page.evaluate(`window.dispatchEvent(new Event('resize'))`)
    await o.page.waitForTimeout(150)
    const lu = await o.page.evaluate(`(() => { ${trouve}; const v = trouve(document.querySelector('${balise}')._shadow, '.v'); return JSON.stringify({ v: v.textContent, hash: location.hash, nom: window.name, statut: window.status, redim: typeof window.onresize, globales: ['rang'].filter((n) => n in window), gx: window.gx }) })()`)
    return { ...JSON.parse(lu), graves: graves(o), avis: [...o.avis] }
  }
  finally {
    await o.fermer()
  }
}

const AVIS_GX = /« gx » existe déjà dans la page : dans ce gestionnaire, « gx = … » crée une variable locale\. Pour écrire celle de la page, écrivez « window\.gx = … »/

for (const moteurNom of ['chromium', 'firefox']) {
  describe(`gestionnaire : une globale du navigateur garde son effet, toute autre variable est la sienne (${moteurNom})`, function () {
    this.timeout(240000)
    let browser: any        = null
    let production: Cible
    let developpement: Cible
    before(async function () {
      const playwright = await import('playwright')
      const moteur     = (playwright as any)[moteurNom]
      if (!existsSync(moteur.executablePath())) this.skip()
      browser       = await moteur.launch()
      production    = await construire('bundle', sources, balises)
      developpement = await construire('dev-parents-avant', sources, balises)
    })
    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    it("`-> location = '#ligne'` sur une ligne navigue", async () => {
      const lu = await lireCas(browser, production, 'g-loc-ligne')
      assert.deepEqual([lu.hash, lu.graves], ['#ligne', []])
    })
    it("`-> $n = 1; location = '#deux'` à deux instructions navigue", async () => {
      const lu = await lireCas(browser, production, 'g-loc-deux')
      assert.deepEqual([lu.hash, lu.v, lu.graves], ['#deux', '1', []])
    })
    it("`location = '#bloc'` dans un gestionnaire en bloc navigue", async () => {
      const lu = await lireCas(browser, production, 'g-loc-bloc')
      assert.deepEqual([lu.hash, lu.graves], ['#bloc', []])
    })
    it("`once = 1`, `name = 5` puis `typeof name`, `status = 'ok'` : variables du gestionnaire, sur une ligne comme en bloc", async () => {
      const ligne = await lireCas(browser, production, 'g-locaux-ligne')
      const bloc  = await lireCas(browser, production, 'g-locaux-bloc')
      assert.deepEqual([ligne.v, ligne.nom, ligne.statut, ligne.graves], ['1,number,ok', '', '', []])
      assert.deepEqual([bloc.v, bloc.nom, bloc.statut, bloc.graves], ['1,number,ok', '', '', []])
    })
    it('`-> onresize = -> $n = 7` pose le gestionnaire de la fenêtre, qui répond au redimensionnement', async () => {
      const lu = await lireCas(browser, production, 'g-redim')
      assert.deepEqual([lu.redim, lu.v, lu.graves], ['function', '7', []])
    })
    it('`-> rang = $l.indexOf(2); $sel = rang` : variable du gestionnaire, aucune globale créée', async () => {
      const lu = await lireCas(browser, production, 'g-rang')
      assert.deepEqual([lu.v, lu.globales, lu.graves], ['1', [], []])
    })
    it('`window.gx = 0` puis `-> gx = 1` : variable du gestionnaire, la page garde 0, rien dit en production', async () => {
      const lu = await lireCas(browser, production, 'g-page')
      assert.deepEqual([lu.v, lu.gx, lu.graves], ['0', 0, []])
      assert.deepEqual(lu.avis.filter((a) => /existe déjà dans la page/.test(a)), [])
    })
    it('une variable de la page écrite sans `window.` à deux instructions, ou en bloc : celle du gestionnaire', async () => {
      const deux = await lireCas(browser, production, 'g-page-deux')
      const bloc = await lireCas(browser, production, 'g-page-bloc')
      assert.deepEqual([deux.v, deux.graves, bloc.v, bloc.graves], ['0', [], '0', []])
    })
    it("`{for location in $l}` ailleurs dans le composant : `location = '#hors'` écrit hors de la boucle navigue, la ligne lit son élément", async () => {
      const lu = await lireCas(browser, production, 'g-hors-boucle')
      assert.deepEqual([lu.v, lu.hash, lu.graves], ['a', '#hors', []])
    })
    it('un gestionnaire de la fenêtre absent d\'un des trois moteurs (`onpointerrawupdate`) : variable du gestionnaire, sur une ligne comme en bloc', async () => {
      const ligne = await lireCas(browser, production, 'g-ailleurs-ligne')
      const bloc  = await lireCas(browser, production, 'g-ailleurs-bloc')
      assert.deepEqual([ligne.v, ligne.graves, bloc.v, bloc.graves], ['number', [], 'number', []])
    })
    it('`{for name in $l}` : le gestionnaire lit l\'élément de la boucle, la fenêtre garde son nom', async () => {
      const lu = await lireCas(browser, production, 'g-boucle')
      assert.deepEqual([lu.v, lu.nom, lu.graves], ['a', '', []])
    })
    it('en développement, `window.gx = 0` puis `-> gx = 1` le dit au clic, une fois ; `rang` (absent de la page) ne dit rien', async () => {
      const page = await lireCas(browser, developpement, 'g-page')
      assert.equal(page.v, '0')
      assert.equal(page.avis.filter((a) => AVIS_GX.test(a)).length, 1, `avis : ${JSON.stringify(page.avis)}`)
      const rang = await lireCas(browser, developpement, 'g-rang')
      assert.deepEqual([rang.v, rang.avis.filter((a) => /existe déjà dans la page/.test(a))], ['1', []])
      const loc = await lireCas(browser, developpement, 'g-loc-ligne')
      assert.deepEqual([loc.hash, loc.graves], ['#ligne', []])
    })
    it('en développement, `var gv = 0` d\'un script classique le dit aussi ; une propriété du navigateur (`name`, `status`, `length`, `top`, `open`) jamais', async () => {
      const parVar = await lireCas(browser, developpement, 'g-var', 'var gv = 0')
      assert.deepEqual([parVar.v, parVar.avis.filter((a) => /« gv » existe déjà dans la page/.test(a)).length], ['0', 1], `avis : ${JSON.stringify(parVar.avis)}`)
      const nav = await lireCas(browser, developpement, 'g-navigateur')
      assert.deepEqual([nav.v, nav.nom, nav.statut, nav.avis.filter((a) => /existe déjà dans la page/.test(a)), nav.graves], ['number,ok,3,1,2', '', '', [], []])
    })
  })
}
