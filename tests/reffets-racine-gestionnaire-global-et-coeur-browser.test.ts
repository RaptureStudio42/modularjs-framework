// En production, trois moteurs. Un gestionnaire de `<@window>` ou de `<@document>` d'un composant SANS reffet, déclenché pendant le
// passage du reffet d'un autre composant, lit pour lui seul : le reffet ne repart pas quand ce que lit ce gestionnaire change, et le
// gestionnaire marche ; une appli sans aucun reffet garde ses gestionnaires globaux. Deux reffets écrits sur la ligne d'une racine
// passent comme sur deux lignes ; une racine qui attend garde le reffet écrit avant son attente, et la construction refuse celui écrit
// après. Une appli dont les racines sont toutes dans des composants n'emporte pas la mécanique des reffets de module, et un magasin jeté
// y arrête toujours les reffets de la racine qui l'a créé ; une racine écrite dans un gestionnaire du gabarit reçoit son composant : elle
// ne l'emporte pas non plus
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// compte un passage et garde la valeur lue
const VU = 'vu = (k, v) ->\n  window.__n[k] = (window.__n[k] or 0) + 1\n  window.__v[k] = v\n'

type Appli = { composants: Record<string, string>, minify: boolean, corps: string, scenario: string }

const APPLIS: Record<string, Appli> = {
  croise: {
    minify: true,
    composants: {
      'rx-a': `<script lang="js">
$n = 0;
µeffect(() => { window.__n.a = (window.__n.a || 0) + 1; window.__v.a = $n; window.dispatchEvent(new Event('rxfenetre')); document.dispatchEvent(new Event('rxdocument')); });
@ecrire = function(v) { $n = v; };
</script>
<p class="a">{$n}</p>
`,
      'rx-b': `<script>
$vu = 0
$doc = 0
</script>
<@window @rxfenetre={$vu = $$compteB}></@window>
<@document @rxdocument={$doc = $$compteDoc}></@document>
<p class="b">{$vu}-{$doc}</p>
`,
      'rx-ecrivain': `<script>
@ecrireB = (v) -> $$compteB = v
@ecrireDoc = (v) -> $$compteDoc = v
</script>
<p>e</p>
`,
      'rx-ligne': `<script>
${VU}$a = 0
$b = 0
arret1 = null
arret2 = null
arret3 = null
@ouvrirUne = -> arret1 = µeffect.root -> µeffect(-> vu('u1', $a)); µeffect(-> vu('u2', $b))
@ouvrirDeux = ->
  arret2 = µeffect.root ->
    µeffect(-> vu('d1', $a))
    µeffect(-> vu('d2', $b))
@ouvrirAttente = ->
  arret3 = µeffect.root ->
    µeffect(-> vu('av', $a))
    await Promise.resolve()
@fermer = ->
  arret1()
  arret2()
  arret3()
@ecrireA = (v) -> $a = v
@ecrireB = (v) -> $b = v
</script>
<p>{$a}-{$b}</p>
`,
    },
    corps: '<mjs-rx-a></mjs-rx-a><mjs-rx-b></mjs-rx-b><mjs-rx-ecrivain></mjs-rx-ecrivain><mjs-rx-ligne></mjs-rx-ligne>',
    scenario: `
      await pas('écriture de A', () => el('rx-a').ecrire(1))
      await pas('clé lue par le gestionnaire de <@window> de B', () => el('rx-ecrivain').ecrireB(5))
      await pas('clé lue par le gestionnaire de <@document> de B', () => el('rx-ecrivain').ecrireDoc(7))
      await pas('réécriture de A', () => el('rx-a').ecrire(2))
      R.push(['texte de B', texte('rx-b')])
      await pas('ouverture des racines', () => { el('rx-ligne').ouvrirUne(); el('rx-ligne').ouvrirDeux(); el('rx-ligne').ouvrirAttente() })
      await pas('écriture de $a', () => el('rx-ligne').ecrireA(1))
      await pas('écriture de $b', () => el('rx-ligne').ecrireB(1))
      await pas('arrêt puis écriture', () => { el('rx-ligne').fermer(); el('rx-ligne').ecrireA(2); el('rx-ligne').ecrireB(2) })
    `,
  },
  sans: {
    minify: true,
    composants: {
      'rs-fenetre': `<script>
$w = 0
</script>
<@window @rsfenetre={$w = $w + 1}></@window>
<@document @rsdocument={$w = $w + 10}></@document>
<p class="w">{$w}</p>
`,
    },
    corps: '<mjs-rs-fenetre></mjs-rs-fenetre>',
    scenario: `
      window.dispatchEvent(new Event('rsfenetre'))
      document.dispatchEvent(new Event('rsdocument'))
      await t()
      await t()
      R.push(['texte', texte('rs-fenetre')])
    `,
  },
  racines: {
    minify: false,
    composants: {
      'rr-panneau': `<script>
${VU}$n = 0
arret = null
salon = null
@ouvrir = ->
  arret = µeffect.root ->
    salon = new µStore(v: 0)
    µeffect(-> vu('salon', salon.data.v))
    µeffect(-> vu('n', $n))
@jeter = -> salon.destroy()
@ecrireSalon = (v) -> salon.data.v = v
@ecrire = (v) -> $n = v
@fermer = -> arret()
</script>
<p>{$n}</p>
`,
    },
    corps: '<mjs-rr-panneau></mjs-rr-panneau>',
    scenario: `
      await pas('ouverture', () => el('rr-panneau').ouvrir())
      await pas('écriture du magasin', () => el('rr-panneau').ecrireSalon(1))
      await pas('écriture de $n', () => el('rr-panneau').ecrire(1))
      await pas('magasin jeté puis écritures', () => { el('rr-panneau').jeter(); el('rr-panneau').ecrire(2); el('rr-panneau').ecrireSalon(2) })
    `,
  },
  gabarit: {
    minify: false,
    composants: {
      'rg-bouton': `<script lang="js">
$n = 0;
</script>
<button class="o" @click={void (window.__arret = µeffect.root(() => { µeffect(() => { window.__n.g = (window.__n.g || 0) + 1; }); }))}>o</button>
`,
    },
    corps: '<mjs-rg-bouton></mjs-rg-bouton>',
    scenario: `
      await pas('clic', () => (el('rg-bouton')._shadow || el('rg-bouton')).querySelector('button.o').click())
      await pas('arrêt', () => window.__arret())
    `,
  },
}

const construits = new Map<string, Promise<Map<string, Buffer>>>()
const construire = (nom: string): Promise<Map<string, Buffer>> => {
  if (!construits.has(nom)) construits.set(nom, (async () => {
    const appli  = APPLIS[nom]
    const root   = mjsTmp('reffets-coeur-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, texte] of Object.entries(appli.composants)) writeFileSync(join(srcDir, n + '.mjs'), texte)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/' + nom + '/out', env: 'prod', js: 'bundle', minify: appli.minify } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return new Map([['bundle.js', readFileSync(join(outDir, 'bundle.js'))]])
  })())
  return construits.get(nom)!
}

after(async () => { await terminateSharedWorkerPool() })

describe('µeffect.root et gestionnaires globaux : construction', function () {
  this.timeout(120000)
  it('un reffet écrit après un await du rappel d\'une racine : la construction est refusée, avec sa ligne', async () => {
    const root    = mjsTmp('reffets-coeur-apres-attente')
    const srcDir  = join(root, 'src')
    const outDir  = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'ra-apres.mjs'), '<script>\n$a = 0\n@ouvrir = ->\n  µeffect.root ->\n    await Promise.resolve()\n    µeffect -> µ.log $a\n</script>\n<p>{$a}</p>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.match(stats.errors.map((e: any) => String(e.message)).join('\n'), /après un await dans µeffect\.root \(ligne 6\)/)
  })
  it('racines toutes dans des composants, gestionnaires du gabarit compris : pas de mécanique des reffets de module', async () => {
    const racines = (await construire('racines')).get('bundle.js')!.toString()
    for (const nom of ['_mjs_magOpen', '_mjsReffetStore', '_mjs_storeOwners', '_mjs_magW']) assert.ok(!racines.includes(nom), nom + ' emporté sans reffet de module')
    assert.ok(racines.includes('_mjs_owner'), 'propriétaire d\'un magasin créé dans une racine')
    const gabarit = (await construire('gabarit')).get('bundle.js')!.toString()
    for (const nom of ['_mjs_magOpen', '_mjsReffetStore']) assert.ok(!gabarit.includes(nom), nom + ' emporté pour une racine d\'un gestionnaire du gabarit, qui reçoit son composant')
  })
})

const ATTENDU: Record<string, unknown[]> = {
  croise: [
    ['écriture de A', { a: 1 }],
    ['clé lue par le gestionnaire de <@window> de B', {}],
    ['clé lue par le gestionnaire de <@document> de B', {}],
    ['réécriture de A', { a: 1 }],
    ['texte de B', '5-7'],
    ['ouverture des racines', { u1: 1, u2: 1, d1: 1, d2: 1, av: 1 }],
    ['écriture de $a', { u1: 1, d1: 1, av: 1 }],
    ['écriture de $b', { u2: 1, d2: 1 }],
    ['arrêt puis écriture', {}],
  ],
  sans: [['texte', '11']],
  racines: [
    ['ouverture', { salon: 1, n: 1 }],
    ['écriture du magasin', { salon: 1, n: 1 }],
    ['écriture de $n', { salon: 1, n: 1 }],
    ['magasin jeté puis écritures', {}],
  ],
  gabarit: [['clic', { g: 1 }], ['arrêt', {}]],
}

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`µeffect.root et gestionnaires globaux (${moteur})`, function () {
  this.timeout(180000)
  let browser: any = null
  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright[moteur].executablePath())) { this.skip(); return }
    browser = await playwright[moteur].launch()
  })
  after(async () => { if (browser) await browser.close() })
  for (const nom of Object.keys(APPLIS)) it(nom + ' : passages comptés pas à pas', async () => {
    const appli    = APPLIS[nom]
    const fichiers = await construire(nom)
    const page     = await browser.newPage()
    const erreurs: string[] = []
    try {
      page.setDefaultTimeout(8000)
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 200)) })
      await page.route('http://localhost/**', async (route: any) => {
        const chemin = new URL(route.request().url()).pathname
        const prefixe = '/' + nom + '/out/'
        if (chemin.startsWith(prefixe)) { const f = fichiers.get(chemin.slice(prefixe.length)); await route.fulfill(f ? { status: 200, contentType: 'text/javascript', body: f } : { status: 404, body: '' }); return }
        await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${appli.corps}<script>window.__n = {}; window.__v = {}</script><script type="module" src="${prefixe}bundle.js"></script></body></html>` })
      })
      await page.goto('http://localhost/' + nom, { waitUntil: 'load' })
      const vus = await page.evaluate(`(async () => {
        const el    = (n) => document.querySelector('mjs-' + n)
        const texte = (n) => (el(n)._shadow || el(n)).textContent.trim()
        const t     = () => new Promise((r) => setTimeout(r, 0))
        const fin   = Date.now() + 6000
        while ([...document.body.children].some((e) => e.localName.startsWith('mjs-') && !(e._shadow || e).querySelector('p, button')) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
        await new Promise((r) => setTimeout(r, 30))
        const R = []
        const pas = async (nom, geste) => {
          for (const k in window.__n) window.__n[k] = 0
          geste()
          await t()
          await t()
          const vu = {}
          for (const k in window.__n) if (window.__n[k] !== 0) vu[k] = window.__n[k]
          R.push([nom, vu])
        }
        ${appli.scenario}
        return R
      })()`)
      assert.deepEqual(vus, ATTENDU[nom])
      assert.deepEqual(erreurs, [])
    }
    finally {
      await page.close()
    }
  })
})
