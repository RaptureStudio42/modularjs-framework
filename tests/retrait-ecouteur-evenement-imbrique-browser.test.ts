// La fonction de retrait d'un `µon`, rendue au routeur par le gestionnaire du gabarit qui vient de poser l'écouteur
// (`@click={$brancher(e)}`, `@mouseenter={$survoler(e)}`), ne retire rien, même quand un autre événement routé joue
// pendant ce gestionnaire : un `.click()` d'un autre bouton du composant, un `focus()` vers un `@focus`, un événement de
// survol fabriqué, avant ou après le `µon`, y compris quand la fonction rendue à cet autre événement lève. Au vrai
// pointeur, l'entrée de survol suit la même règle, et une fabrique qu'elle rend est appelée. Appelée par le code de
// l'appli, la fonction de retrait retire toujours : aussitôt dans une fonction rendue (`@click={essayer}`, `fin()` juste
// après le `µon`), ou dans l'écouteur même, déclenché aussitôt par `dispatchEvent` (il ne joue qu'une fois). Ombre et
// composant léger ; Chromium, Firefox et WebKit réels.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const ORIGINE = 'http://mjs.test'

// un événement routé imbriqué passe avant le `µon` (`$avant`) ou après (`$apres`) ; `$leve` : la fonction rendue à
// l'événement imbriqué lève
const imbrique = (cle: string) => [
  '<script lang="coffee">',
  `w = window.${cle} = {avant: 0, apres: 0, leve: 0, autre: 0}`,
  '$avant = (e) ->',
  "  fin = µon 'click', '.cible-avant', -> w.avant += 1",
  "  e.currentTarget.parentNode.querySelector('.autre').click()",
  '  fin',
  '$apres = (e) ->',
  "  e.currentTarget.parentNode.querySelector('.autre').click()",
  "  µon 'click', '.cible-apres', -> w.apres += 1",
  '$leve = (e) ->',
  "  e.currentTarget.parentNode.querySelector('.lever').click()",
  "  µon 'click', '.cible-leve', -> w.leve += 1",
  'compter = -> w.autre += 1',
  "lever = -> throw new Error('voulu au clic')",
  '</script>',
  '<button class="avant" @click={$avant(e)}>a</button>',
  '<button class="apres" @click={$apres(e)}>p</button>',
  '<button class="leve" @click={$leve(e)}>l</button>',
  '<button class="autre" @click={compter()}>o</button>',
  '<button class="lever" @click={lever}>x</button>',
  '<span class="cible-avant">ca</span>',
  '<span class="cible-apres">cp</span>',
  '<span class="cible-leve">cl</span>',
].join('\n')

const ZONES = [
  '<style>',
  '.zone, .zone-fab',
  '  display: block',
  '  width: 200px',
  '  height: 60px',
  '</style>',
]

const SOURCES: Record<string, string> = {
  'imb-ombre': imbrique('__ombre'),
  'imb-leger': imbrique('__leger'),
  'imb-focus': [
    '<script lang="coffee">',
    'w = window.__focus = {touches: 0, focus: 0}',
    '$ouvrir = (e) ->',
    "  fin = µon 'keydown', (ev) -> w.touches += 1",
    "  e.currentTarget.parentNode.querySelector('.champ').focus()",
    '  fin',
    'vu = -> w.focus += 1',
    '</script>',
    '<button class="ouvrir" @click={$ouvrir(e)}>o</button>',
    '<input class="champ" aria-label="champ" @focus={vu()}>',
  ].join('\n'),
  // l'entrée de survol au vrai pointeur : un clic imbriqué dans son gestionnaire ; une fabrique rendue
  'imb-pointeur': [
    '<script lang="coffee">',
    'w = window.__pointeur = {entrees: 0, survol: 0, autre: 0, fab: 0}',
    '$survoler = (e) ->',
    '  w.entrees += 1',
    "  fin = µon 'click', '.survol', -> w.survol += 1",
    "  e.currentTarget.parentNode.querySelector('.autre').click()",
    '  fin',
    'compter = -> w.autre += 1',
    'fabrique = (x) -> (e) -> w.fab += x',
    '</script>',
    ...ZONES,
    '<div class="zone" @mouseenter={$survoler(e)}>z</div>',
    '<div class="zone-fab" @mouseenter={fabrique(2)}>f</div>',
    '<button class="autre" @click={compter()}>a</button>',
    '<span class="survol">s</span>',
  ].join('\n'),
  // une entrée de survol fabriquée pendant un clic, avant le `µon` ; celle de `.zone-leve` lève
  'imb-survol': [
    '<script lang="coffee">',
    'w = window.__survol = {apres: 0, leve: 0, entrees: 0}',
    "survoler = (el) -> el.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, composed: true}))",
    '$apres = (e) ->',
    "  survoler e.currentTarget.parentNode.querySelector('.zone')",
    "  µon 'click', '.cible-apres', -> w.apres += 1",
    '$leve = (e) ->',
    "  survoler e.currentTarget.parentNode.querySelector('.zone-leve')",
    "  µon 'click', '.cible-leve', -> w.leve += 1",
    'entrer = -> w.entrees += 1',
    "lever = -> throw new Error('voulu au survol')",
    '</script>',
    '<div class="zone" @mouseenter={entrer()}>z</div>',
    '<div class="zone-leve" @mouseenter={lever}>l</div>',
    '<button class="apres" @click={$apres(e)}>p</button>',
    '<button class="leve" @click={$leve(e)}>l</button>',
    '<span class="cible-apres">cp</span>',
    '<span class="cible-leve">cl</span>',
  ].join('\n'),
  'imb-essayer': [
    '<script lang="coffee">',
    'w = window.__essayer = {item: 0, pret: 0}',
    'essayer = ->',
    "  fin = µon 'click', '.item', -> w.item += 1",
    '  fin()',
    '  return',
    'demarrer = (e) ->',
    "  fin = µon 'x-pret', ->",
    '    fin()',
    '    w.pret += 1',
    "  e.currentTarget.dispatchEvent(new CustomEvent('x-pret', {bubbles: true}))",
    '  return',
    '</script>',
    '<button class="essayer" @click={essayer}>e</button>',
    '<button class="demarrer" @click={demarrer}>d</button>',
    '<span class="item">i</span>',
  ].join('\n'),
}

const LEGERS = new Set(['imb-leger'])

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`retrait d'un µon et événements routés imbriqués (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let navigateur: any
  let html = ''

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) {
      console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
      return
    }
    const root   = mjsTmp('retrait-imbrique')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, `${n}.mjs`), s + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre  = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    const script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const corps  = Object.keys(SOURCES).map((n) => LEGERS.has(n) ? `<mjs-${n} mjs-light></mjs-${n}>` : `<mjs-${n}></mjs-${n}>`).join('')
    html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}<script>${script}</script></body></html>`
    const playwright = await import('playwright')
    navigateur = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  })

  after(async () => {
    if (navigateur) await navigateur.close()
    await terminateSharedWorkerPool()
  })

  async function ouvrir() {
    const contexte = await navigateur.newContext({ viewport: { width: 900, height: 900 } })
    const p        = await contexte.newPage()
    const erreurs: string[] = []
    p.on('pageerror', (e: any) => erreurs.push(String(e)))
    await p.route(`${ORIGINE}/**`, (route: any) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
    await p.goto(`${ORIGINE}/`)
    await p.waitForTimeout(150)
    return { p, contexte, erreurs }
  }

  // racine des nœuds du composant : son ombre, ou la balise même pour un composant léger
  const dans = (tag: string, sel: string) => `(document.querySelector('mjs-${tag}')._shadow || document.querySelector('mjs-${tag}')).querySelector('${sel}')`

  // clique les boutons, attend, clique les cibles, rend les compteurs
  const cliquer = (tag: string, cle: string, boutons: string[], cibles: string[]) => `(async () => {
    ${boutons.map((b) => `${dans(tag, b)}.click();`).join('\n')}
    await new Promise((r) => setTimeout(r, 30));
    ${cibles.map((c) => `${dans(tag, c)}.click();`).join('\n')}
    return window.${cle};
  })()`

  for (const [tag, cle] of [['imb-ombre', '__ombre'], ['imb-leger', '__leger']] as const) {
    it(`${tag} : un clic routé imbriqué, avant ou après le \`µon\`, ne fait pas retirer l'écouteur`, async function () {
      if (!present) { this.skip(); return }
      const { p, contexte, erreurs } = await ouvrir()
      try {
        if (tag === 'imb-leger') assert.equal(await p.evaluate(`document.querySelector('mjs-${tag}')._mjs_isLight`), true, 'composant léger')
        const r = await p.evaluate(cliquer(tag, cle, ['.avant', '.apres'], ['.cible-avant', '.cible-apres', '.cible-avant', '.cible-apres']))
        assert.deepEqual(r, { avant: 2, apres: 2, leve: 0, autre: 2 })
        assert.deepEqual(erreurs, [])
      }
      finally { await contexte.close() }
    })

    it(`${tag} : le passage est rendu même quand la fonction rendue à l'événement imbriqué lève`, async function () {
      if (!present) { this.skip(); return }
      const { p, contexte, erreurs } = await ouvrir()
      try {
        const r = await p.evaluate(cliquer(tag, cle, ['.leve'], ['.cible-leve', '.cible-leve']))
        assert.deepEqual(r, { avant: 0, apres: 0, leve: 2, autre: 0 })
        assert.equal(erreurs.length, 1, erreurs.join('\n'))
        assert.match(erreurs[0], /voulu au clic/)
      }
      finally { await contexte.close() }
    })
  }

  it('un `focus()` routé imbriqué ne fait pas retirer l\'écouteur', async function () {
    if (!present) { this.skip(); return }
    const { p, contexte, erreurs } = await ouvrir()
    try {
      const r = await p.evaluate(`(async () => {
        ${dans('imb-focus', '.ouvrir')}.click();
        await new Promise((r) => setTimeout(r, 30));
        ${dans('imb-focus', '.champ')}.dispatchEvent(new KeyboardEvent('keydown', {key: 'a', bubbles: true, composed: true}));
        return window.__focus;
      })()`)
      assert.deepEqual(r, { touches: 1, focus: 1 })
      assert.deepEqual(erreurs, [])
    }
    finally { await contexte.close() }
  })

  it('une entrée de survol fabriquée pendant le clic ne fait pas retirer l\'écouteur posé après elle, même quand sa fonction rendue lève', async function () {
    if (!present) { this.skip(); return }
    const { p, contexte, erreurs } = await ouvrir()
    try {
      const r = await p.evaluate(cliquer('imb-survol', '__survol', ['.apres', '.leve'], ['.cible-apres', '.cible-leve', '.cible-apres', '.cible-leve']))
      assert.deepEqual(r, { apres: 2, leve: 2, entrees: 1 })
      assert.equal(erreurs.length, 1, erreurs.join('\n'))
      assert.match(erreurs[0], /voulu au survol/)
    }
    finally { await contexte.close() }
  })

  it('au vrai pointeur : l\'entrée de survol garde l\'écouteur malgré un clic imbriqué, et appelle la fabrique qu\'elle rend', async function () {
    if (!present) { this.skip(); return }
    const { p, contexte, erreurs } = await ouvrir()
    try {
      // le pointeur arrive par la droite, sur la ligne de la zone : il ne traverse rien d'autre
      for (const sel of ['.zone', '.zone-fab']) {
        const b = await p.evaluate(`(() => { const r = ${dans('imb-pointeur', sel)}.getBoundingClientRect(); return {x: r.x + 20, y: r.y + 20} })()`) as any
        await p.mouse.move(880, b.y)
        await p.mouse.move(b.x, b.y, { steps: 3 })
        await p.waitForTimeout(50)
      }
      const r = await p.evaluate(`(async () => {
        ${dans('imb-pointeur', '.survol')}.click();
        ${dans('imb-pointeur', '.survol')}.click();
        return window.__pointeur;
      })()`)
      assert.deepEqual(r, { entrees: 1, survol: 2, autre: 1, fab: 2 })
      assert.deepEqual(erreurs, [])
    }
    finally { await contexte.close() }
  })

  it('appelée par l\'appli, la fonction de retrait retire aussitôt (`@click={essayer}`), et un écouteur qui se retire à son premier passage, déclenché aussitôt, joue une fois', async function () {
    if (!present) { this.skip(); return }
    const { p, contexte, erreurs } = await ouvrir()
    try {
      const r = await p.evaluate(cliquer('imb-essayer', '__essayer', ['.essayer', '.demarrer', '.demarrer'], ['.item', '.item']))
      assert.deepEqual(r, { item: 0, pret: 2 })
      assert.deepEqual(erreurs, [])
    }
    finally { await contexte.close() }
  })
})
