// Un composant qui lit un état partagé du cœur — `µurl`, `µnav`, `µonline` (des `µ.state`, comme `µres`, `µvisible`, `µready`,
// `µsocket`, `µsmooth`) — dans son gabarit se redessine en entier à chaque changement de cet état ; parmi ses reffets, seuls passent
// alors ceux qui ont lu cet état, et ceux qui n'ont lu ni variable `$` ni clé du magasin (ils passent à chaque mise à jour) : ni le
// reffet qui ne lit qu'une clé du magasin, ni celui qui ne lit qu'une variable `$`, ni le reffet d'avant l'écran. Un composant qui ne lit
// pas l'état n'est pas touché. Le reffet du `<script module>` du même composant appartient au module : il ne suit que ce qu'il lit (la
// clé du magasin), pas l'adresse. `µlang` est une clé du magasin : un composant qui la lit n'est pas redessiné en entier par elle.
// Composants écrits en JavaScript (`lang="js"`).
// La navigation est jouée comme le routeur la fait (routes `#/…`) : l'adresse change, puis `µ.url` est relu (`_mjs_updateUrlStore`).
// Les passages sont comptés pas à pas, en production non minifiée. happy-dom.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'rfu-coquille': `<script lang="js">
$x = 0;
µeffect(() => { window.__n.theme++; window.__v.theme = $$rel; });
µeffect.before(() => { window.__n.avant++; window.__v.avant = $$rel; });
µeffect(() => { window.__n.local++; window.__v.local = $x; });
µeffect(() => { window.__n.url++; window.__v.url = µurl.path; });
µeffect(() => { window.__n.dom++; window.__v.dom = document.title; });
@ecrireX = function(v) { $x = v; };
@ecrireRel = function(v) { $$rel = v; };
</script>
<p>{µurl.path} {$x}</p>
`,
  'rfu-module': `<script module lang="js">
µeffect(() => { window.__n.module++; window.__v.module = $$rel; });
</script>
<script lang="js">
$y = 0;
</script>
<p>{µurl.path} {$y}</p>
`,
  'rfu-calme': `<script lang="js">
µeffect(() => { window.__n.calme++; window.__v.calme = $$rel; });
</script>
<p>calme</p>
`,
  'rfu-nav': `<script lang="js">
µeffect(() => { window.__n.nav++; window.__v.nav = $$rel; });
</script>
<p>{µnav.active}</p>
`,
  'rfu-reseau': `<script lang="js">
µeffect(() => { window.__n.reseau++; window.__v.reseau = $$rel; });
</script>
<p>{µonline}</p>
`,
  'rfu-langue': `<script lang="js">
µeffect(() => { window.__n.langue++; window.__v.langue = $$rel; });
@ecrireLangue = function(v) { µlang = v; };
</script>
<p>{µlang}</p>
`,
}

const PAGE  = Object.keys(COMPOSANTS)
const CORPS = PAGE.map((n) => `<mjs-${n}></mjs-${n}>`).join('')

const SCENARIO = `(async () => {
  const R = []
  const el = (n) => document.querySelector('mjs-' + n)
  async function pas(nom, f) {
    const avant = { ...window.__n }
    f()
    await new Promise((r) => setTimeout(r, 30))
    const d = {}
    for (const k in window.__n) if (window.__n[k] !== avant[k]) d[k] = window.__n[k] - avant[k]
    R.push([nom, d])
  }
  function naviguer(p) {
    history.pushState(null, '', p)
    µ.Router._mjs_updateUrlStore()
  }
  await pas('navigation', () => naviguer('#/page-b'))
  await pas('navigation suivante', () => naviguer('#/page-c'))
  await pas('µnav : navigation en vol', () => { µ.nav.active = true })
  await pas('µonline : réseau perdu', () => { window.dispatchEvent(new Event('offline')) })
  await pas('µlang écrite', () => el('rfu-langue').ecrireLangue('en'))
  await pas('clé du magasin écrite', () => el('rfu-coquille').ecrireRel('rouge'))
  await pas('variable $x de la coquille écrite', () => el('rfu-coquille').ecrireX(1))
  return { pas: R, valeurs: window.__v }
})()`

async function construire(): Promise<string> {
  const root   = mjsTmp('reffets-etat-partage')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, texte] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), texte)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle', minify: false } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
}

type Jeu = { montage: Record<string, number>, pas: [string, Record<string, number>][], valeurs: Record<string, unknown>, avertissements: string[] }

async function jouer(code: string): Promise<Jeu> {
  const window: any = new Window({ url: 'http://localhost/#/page-a', settings: { disableCSSFileLoading: true } } as any)
  const avertissements: string[] = []
  window.console.warn = (...a: unknown[]) => { avertissements.push(a.map(String).join(' ')) }
  try {
    window.__n = { theme: 0, avant: 0, local: 0, url: 0, dom: 0, module: 0, calme: 0, nav: 0, reseau: 0, langue: 0 }
    window.__v = {}
    window.eval(code)
    window.document.body.innerHTML = CORPS
    const fin = Date.now() + 5000
    while (PAGE.some((n) => !window.document.querySelector('mjs-' + n)?._mjs_is_mounted) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 30))
    const montage = { ...window.__n }
    const r = await window.eval(SCENARIO)
    return JSON.parse(JSON.stringify({ montage, pas: r.pas, valeurs: r.valeurs, avertissements }))
  }
  finally {
    await window.happyDOM.close()
  }
}

// passages attendus, pas à pas : à la navigation, dans la coquille, passent le reffet qui lit l'adresse et celui qui ne lit rien de suivi
// (il passe à chaque mise à jour) ; ni celui du thème, qui ne lit que la clé du magasin, ni celui d'avant l'écran, ni celui qui ne lit que
// `$x` ; ni le reffet du `<script module>`, ni le composant qui ne lit pas l'adresse. `µnav` et `µonline` : le reffet de leur composant ne
// lit que la clé du magasin, il ne passe pas
const PASSAGES: [string, Record<string, number>][] = [
  ['navigation', { url: 1, dom: 1 }],
  ['navigation suivante', { url: 1, dom: 1 }],
  ['µnav : navigation en vol', {}],
  ['µonline : réseau perdu', {}],
  ['µlang écrite', {}],
  ['clé du magasin écrite', { theme: 1, avant: 1, url: 1, dom: 1, module: 1, calme: 1, nav: 1, reseau: 1, langue: 1 }],
  ['variable $x de la coquille écrite', { local: 1, url: 1, dom: 1 }],
]

describe('composant abonné en entier à un état partagé du cœur (µurl, µnav, µonline) : ses reffets', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })
  let jeu: Jeu
  before(async () => {
    jeu = await jouer(await construire())
  })

  it('au montage, chaque reffet passe une fois', () => {
    assert.deepEqual(jeu.montage, { theme: 1, avant: 1, local: 1, url: 1, dom: 1, module: 1, calme: 1, nav: 1, reseau: 1, langue: 1 })
  })

  it('passages comptés pas à pas', () => {
    assert.deepEqual(jeu.pas, PASSAGES)
  })

  it('valeurs lues à la fin du scénario', () => {
    assert.equal(jeu.valeurs.url, '/page-c')
    assert.equal(jeu.valeurs.theme, 'rouge')
    assert.equal(jeu.valeurs.module, 'rouge')
    assert.equal(jeu.valeurs.local, 1)
  })

  it('aucun avertissement', () => {
    assert.deepEqual(jeu.avertissements, [])
  })
})
