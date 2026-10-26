// Deux avertissements du développement, en navigateur réel :
// - un enfant qui écrit lui-même une prop reçue à sens unique (`dialog={$dialog}` puis `$dialog = null` dans l'enfant) : le parent garde sa
//   propre valeur, son `{if}` ne bouge pas. Dit une fois par composant et par nom, en français et en anglais, sous la balise telle que l'auteur
//   l'écrit (`<@c-motif>`, `<@@checkbox>` pour un module cœur) ; jamais pour une prop liée à deux sens (`!{…}`), pour le défaut que l'enfant pose
//   à sa construction (avant ou après la définition du parent), pour une variable que le parent ne passe pas, pour une valeur fixe écrite en
//   attribut, ni quand la balise porte un gestionnaire d'événement (`@change`, `@ferme` : le parent suit par l'événement, comme le module cœur
//   « contrôlé » `<@@select value={$z} @change…>`) ; une prop étalée (`{...$data}`) et une ligne de `{for}` comptent
// - un `@attach` qui rend autre chose qu'une fonction (le nombre de `requestAnimationFrame`, un objet) : la valeur est ignorée, ce n'est pas un
//   nettoyage. Dit une fois par balise, `@attach` et `@attach.once`, `_node` et `el`, et la fonction d'une attache sans `_node` ; rien pour une
//   fonction, `undefined` ou `null`
// En production : ni l'avertissement, ni son code, ni son texte (fichiers envoyés lus), et la page se comporte de même.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import { mjsTmp } from './helpers/tmp.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const ATTACHE = `<script>
  $rows = [1, 2, 3]

  nombre   = (node) -> requestAnimationFrame(-> node.dataset.vu = '1')
  objet    = (node) -> { a: 1 }
  nettoie  = (node) -> -> node.dataset.parti = '1'
  rien     = (node) -> undefined
  nul      = (node) -> null
  fabrique = (node) -> 42
</script>

<b class="n" @attach={nombre(_node)}>n</b>
<i class="o" @attach.once={objet(el)}>o</i>
<u class="f" @attach={nettoie(_node)}>f</u>
<s class="r" @attach={rien(_node)}>r</s>
<small class="z" @attach={nul(_node)}>z</small>
<em class="fab" @attach={fabrique}>fab</em>
{for v in $rows}
  <q class="l" @attach={nombre(_node)}>{v}</q>
{end}
<p class="vu">attaches</p>
`

const SOURCES: Record<string, string> = {
  // le motif : prop à sens unique dans un {if}, que l'enfant remet lui-même à null
  'rs-motif.mjs': `<script>
  $dialog = null

  @open = -> $dialog = { id: 7 }
</script>

<button class="open" type="button" @click={@open()}>Ouvrir</button>
{if $dialog}
  <@c-motif dialog={$dialog}>
{end}
`,
  'c-motif.mjs': `<script>
  $dialog  = null
  $propre  = 0
  $absente = 'défaut'

  fermer = -> $dialog = null
  propre = ->
    $propre  = $propre + 1
    $absente = 'autre'
</script>

<p class="vu">{$dialog ? $dialog.id : 'vide'}-{$propre}-{$absente}</p>
<button class="x" type="button" @click={fermer()}>x</button>
<button class="p" type="button" @click={propre()}>p</button>
`,

  // la même prop liée à deux sens : l'écriture de l'enfant remonte, le {if} du parent le retire
  'rs-deux.mjs': `<script>
  $dialog = { id: 3 }
</script>

{if $dialog}
  <@c-deux dialog=!{$dialog}>
{end}
<p class="etat">{$dialog ? 'ouvert' : 'fermé'}</p>
`,
  'c-deux.mjs': `<script>
  $dialog = null

  fermer = -> $dialog = null
</script>

<p class="vu">{$dialog ? $dialog.id : 'vide'}</p>
<button class="x" type="button" @click={fermer()}>x</button>
`,

  // trois lignes d'un {for}, chacune écrit sa prop : un seul avertissement
  'rs-liste.mjs': `<script>
  $rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
</script>

{for r in $rows}
  <@c-ligne item={r}>
{end}
`,
  'c-ligne.mjs': `<script>
  $item = null

  vider = -> $item = { id: 0 }
</script>

<p class="vu">{$item ? $item.id : 'vide'}</p>
<button class="x" type="button" @click={vider()}>x</button>
`,

  // une prop étalée compte ; une valeur fixe écrite en attribut, non
  'rs-etale.mjs': `<script>
  $data = { titre: 'a' }
</script>

<@c-etale {...$data}>
<@c-statique titre="fixe">
`,
  'c-etale.mjs': `<script>
  $titre = ''

  changer = -> $titre = 'b'
</script>

<p class="vu">{$titre}</p>
<button class="x" type="button" @click={changer()}>x</button>
`,
  'c-statique.mjs': `<script>
  $titre = ''

  changer = -> $titre = 'b'
</script>

<p class="vu">{$titre}</p>
<button class="x" type="button" @click={changer()}>x</button>
`,

  // modules cœur « contrôlés » : valeur à sens unique et gestionnaire d'événement, le parent suit par l'événement
  'rs-coeur.mjs': `<script>
  $z = 'a'
  $c = false
</script>

<@@select value={$z} @change.propagate={$z = e.data} aria-label="z"><@@option value="a">A</@@option><@@option value="b">B</@@option></@@select>
<@@checkbox checked={$c} @change.propagate={$c = e.data}>Ok</@@checkbox>
<p class="etat">{$z}-{$c}</p>
`,
  // le même module cœur sans gestionnaire : le parent ne voit rien, c'est dit, sous la balise écrite
  'rs-coeur-seul.mjs': `<script>
  $c = false
</script>

<@@checkbox checked={$c}>Ok</@@checkbox>
<p class="etat">{$c}</p>
`,
  // composant du projet, prop à sens unique, gestionnaire sur sa balise : l'enfant écrit sa prop et prévient, rien n'est dit
  'rs-ecoute.mjs': `<script>
  $dialog = { id: 5 }
  $fermes = 0
</script>

<@c-ecoute dialog={$dialog} @ferme={$fermes = $fermes + 1}>
<p class="etat">{$fermes}</p>
`,
  'c-ecoute.mjs': `<script>
  $dialog = null

  fermer = ->
    $dialog = null
    µemit 'ferme'
</script>

<p class="vu">{$dialog ? $dialog.id : 'vide'}</p>
<button class="x" type="button" @click={fermer()}>x</button>
`,

  'rs-attache.mjs': ATTACHE,
}
const BALISES = Object.keys(SOURCES).filter((f) => f.startsWith('rs-')).map((f) => 'mjs-' + f.replace('.mjs', ''))

// la phrase décidée, telle quelle, dans chaque langue
const PHRASE = { fr: 'cette valeur vient du parent ; liez-la par !{…} ou envoyez un événement', en: 'this value comes from the parent; bind it with !{…} or send an event' }

type Langue = 'fr' | 'en'

// le texte attendu dans la console (le harnais en garde 200 signes)
const texte = (langue: Langue, cle: 'propOneWay' | 'attachNotFn', vars: Record<string, string | number>) => {
  const modele = (RUNTIME_LABELS as any)[langue].dev[cle] ?? `(libellé dev.${cle} absent en ${langue})`
  return ('[ModularJS] ' + modele.replace(/\{(\w+)\}/g, (m, n) => (n in vars ? String(vars[n]) : m))).slice(0, 200)
}
const prop = (langue: Langue, tag: string, nom: string) => texte(langue, 'propOneWay', { tag, prop: nom })
// la ligne de la balise dans rs-attache.mjs
const ligne = (debut: string) => ATTACHE.split('\n').findIndex((l) => l.startsWith(debut)) + 1
const attache = (langue: Langue, noeud: string, type: string, debut: string) => texte(langue, 'attachNotFn', { tag: '@rs-attache', node: noeud, line: ligne(debut), type })

// un nœud atteint dans les ombres : chemin `balise >> balise` depuis l'hôte, `n` choisit parmi les enfants du premier pas
const centre = async (page: any, balise: string, chemin: string, n = 0): Promise<{ x: number, y: number }> => {
  const fin = Date.now() + 3000
  for (;;) {
    const r = await page.evaluate(`(() => {
      const pas = ${JSON.stringify(chemin.split(' >> '))}
      let el = document.querySelector('${balise}')
      pas.forEach((s, i) => { el = el && el._shadow && (i === 0 ? el._shadow.querySelectorAll(s)[${n}] : el._shadow.querySelector(s)) })
      if (!el) return null
      const b = el.getBoundingClientRect()
      return b.width > 0 ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null
    })()`)
    if (r) return r
    if (Date.now() > fin) throw new Error('balise introuvable : ' + chemin + ' #' + n)
    await page.waitForTimeout(30)
  }
}
const clic = async (page: any, balise: string, chemin: string, n = 0) => {
  const c = await centre(page, balise, chemin, n)
  await page.mouse.click(c.x, c.y)
  await page.waitForTimeout(60)
}
// le même chemin, cliqué par le script quand le nœud existe (la case native d'un module cœur est masquée à l'écran) ; `n` choisit parmi les nœuds du dernier pas
const clicScript = async (page: any, balise: string, chemin: string, n = 0) => {
  const atteindre = `(() => {
    const pas = ${JSON.stringify(chemin.split(' >> '))}
    let el = document.querySelector('${balise}')
    pas.forEach((s, i) => { el = el && el._shadow && el._shadow.querySelectorAll(s)[i === pas.length - 1 ? ${n} : 0] })
    return el
  })()`
  await page.waitForFunction(`!!${atteindre}`, null, { timeout: 3000 }).catch(() => { throw new Error('balise introuvable : ' + chemin + ' #' + n) })
  await page.evaluate(`${atteindre}.click()`)
  await page.waitForTimeout(150)
}

// les lignes `.vu` des enfants du projet, et la ligne `.etat` du parent
const vus = (page: any, balise: string): Promise<string[]> => page.evaluate(`(() => {
  const sh = document.querySelector('${balise}')._shadow
  const kids = Array.from(sh.querySelectorAll('*')).filter((c) => c.localName.startsWith('mjs-c-'))
  const etat = sh.querySelector('.etat')
  return kids.map((c) => c.localName.slice(4) + '=' + (c._shadow && c._shadow.querySelector('.vu') ? c._shadow.querySelector('.vu').textContent : '?')).concat(etat ? ['etat=' + etat.textContent] : [])
})()`)

type Scenario = { gestes: (page: any, b: string) => Promise<void>, avis: (l: Langue) => string[], vus: string[] }

const SCENARIOS: Record<string, Scenario> = {
  'mjs-rs-motif': {
    gestes: async (p, b) => {
      await clic(p, b, '.open')
      await clic(p, b, 'mjs-c-motif >> .p')
      await clic(p, b, 'mjs-c-motif >> .x')
      await clic(p, b, 'mjs-c-motif >> .x')
      await clic(p, b, 'mjs-c-motif >> .p')
    },
    avis: (l) => [prop(l, '@c-motif', 'dialog')],
    vus: ['c-motif=vide-2-autre'],
  },
  'mjs-rs-deux': {
    gestes: (p, b) => clic(p, b, 'mjs-c-deux >> .x'),
    avis: () => [],
    vus: ['etat=fermé'],
  },
  'mjs-rs-liste': {
    gestes: async (p, b) => {
      for (const n of [0, 1, 2]) await clic(p, b, 'mjs-c-ligne >> .x', n)
    },
    avis: (l) => [prop(l, '@c-ligne', 'item')],
    vus: ['c-ligne=0', 'c-ligne=0', 'c-ligne=0'],
  },
  'mjs-rs-etale': {
    gestes: async (p, b) => {
      await clic(p, b, 'mjs-c-statique >> .x')
      await clic(p, b, 'mjs-c-etale >> .x')
      await clic(p, b, 'mjs-c-etale >> .x')
    },
    avis: (l) => [prop(l, '@c-etale', 'titre')],
    vus: ['c-etale=b', 'c-statique=b'],
  },
  'mjs-rs-coeur': {
    gestes: async (p, b) => {
      await clicScript(p, b, 'mjs-core-select >> .select-btn')
      await clicScript(p, b, 'mjs-core-select >> .select-option', 1)
      await clicScript(p, b, 'mjs-core-checkbox >> .native')
    },
    avis: () => [],
    vus: ['etat=b-true'],
  },
  'mjs-rs-coeur-seul': {
    gestes: (p, b) => clicScript(p, b, 'mjs-core-checkbox >> .native'),
    avis: (l) => [prop(l, '@@checkbox', 'checked')],
    vus: ['etat=false'],
  },
  'mjs-rs-ecoute': {
    gestes: (p, b) => clic(p, b, 'mjs-c-ecoute >> .x'),
    avis: () => [],
    vus: ['c-ecoute=vide', 'etat=1'],
  },
  'mjs-rs-attache': {
    gestes: async () => {},
    avis: (l) => [attache(l, 'b', 'number', '<b '), attache(l, 'i', 'object', '<i '), attache(l, 'em', 'number', '<em '), attache(l, 'q', 'number', '  <q ')],
    vus: [],
  },
}

// Firefox charge lentement les fichiers séparés de la production : un mode de développement et un de production lui suffisent
const NAVIGATEURS = ['chromium', 'firefox', 'webkit'] as const
const TOUS: Mode[] = ['dev-parents-avant', 'dev-enfants-avant', 'bundle', 'split']
const MODES_JOUES: Record<typeof NAVIGATEURS[number], Mode[]> = { chromium: TOUS, firefox: ['dev-parents-avant', 'bundle'], webkit: TOUS }
const PROD = (mode: Mode) => mode === 'bundle' || mode === 'split'

// une construction par mode, partagée par les navigateurs
const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}
// la même page, annoncée en anglais
const enAnglais = (c: Cible): Cible => ({ ...c, document: (b, v) => c.document(b, v).replace('<html lang="fr">', '<html lang="en">') })

// ce que la console a dit de nos deux avertissements
const nosAvis = (avis: string[]) => avis.filter((a) => /écrit sa prop|writes its prop|@attach (de|on) </.test(a)).sort()

const jouerScenario = async (browser: any, c: Cible, mode: Mode, balise: string, langue: Langue) => {
  const o = await charger(browser, c, balise)
  try {
    await o.page.waitForFunction(`!!document.querySelector('${balise}')?._shadow?.querySelector('${balise === 'mjs-rs-attache' ? '.vu' : 'mjs-c-motif, mjs-c-deux, mjs-c-ligne, mjs-c-etale, mjs-c-ecoute, mjs-core-checkbox, .open'}')`, null, { timeout: 10000 }).catch(() => { throw new Error(`le parent ne se monte pas, la page dit : ${graves(o).join(' ; ') || 'rien'}`) })
    await o.page.waitForTimeout(150)
    const s = SCENARIOS[balise]
    await s.gestes(o.page, balise)
    await o.page.waitForTimeout(150)
    assert.deepEqual(await vus(o.page, balise), s.vus, 'ce que montre la page')
    assert.deepEqual(nosAvis(o.avis), PROD(mode) ? [] : s.avis(langue).sort(), 'les avertissements dits')
    assert.deepEqual(graves(o), [], 'aucune erreur')
  } finally {
    await o.fermer()
  }
}

for (const nav of NAVIGATEURS) for (const mode of MODES_JOUES[nav]) describe(`avertissements du développement : prop à sens unique écrite par l'enfant, @attach qui ne rend pas une fonction (${mode}, ${nav} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) { console.log(`  ℹ️  ${nav} non installé, test des avertissements du développement sauté. Activer : \`npx playwright install ${nav}\``); return }
    browser = await playwright[nav].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const balise of BALISES) it(`${balise.slice(7)} : ${PROD(mode) ? 'rien n\'est dit, la page se comporte de même' : 'chaque avertissement est dit une fois, dans les bons cas seulement'}`, async function () {
    if (!present) { this.skip(); return }
    await jouerScenario(browser, await cible(mode), mode, balise, 'fr')
  })

  if (nav === 'chromium' && mode === 'dev-parents-avant') for (const balise of ['mjs-rs-motif', 'mjs-rs-attache']) it(`${balise.slice(7)} : en anglais, page annoncée en « en »`, async function () {
    if (!present) { this.skip(); return }
    await jouerScenario(browser, enAnglais(await cible(mode)), mode, balise, 'en')
  })
})

// les fichiers d'une sortie, lus en texte
const lireTout = (dossier: string): string[] => readdirSync(dossier, { recursive: true }).map(String).filter((f) => /\.(js|json|html)$/.test(f)).map((f) => readFileSync(join(dossier, f), 'utf-8'))

// une construction sans réduction des noms : le code s'y lit sous ses vrais noms
async function construireLisible(env: 'dev' | 'prod'): Promise<string[]> {
  const root   = mjsTmp('avertissements-dev-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env, minify: false } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return lireTout(outDir)
}

describe('avertissements du développement : absents de la production (code et texte)', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  // des morceaux sans accent ni variable de chaque texte : une sortie qui échappe les accents les montre tels quels
  const MORCEAUX = ['cette valeur vient du parent', 'this value comes from the parent', 'pas une fonction : elle est ignor', 'not a function: it is ignored']
  const CODE     = ['_mjs_oneWay', '_mjs_attachNotFn']

  it('le développement porte les deux textes, en français et en anglais, et le code qui les dit', async () => {
    const dev = await cible('dev-parents-avant')
    const tout = [...lireTout(join(dev.racine, 'out')), readFileSync(join(dev.racine, 'bundle.js'), 'utf-8')].join('\n')
    for (const m of MORCEAUX) assert.ok(tout.includes(m), `développement : « ${m} » attendu`)
    const lisible = (await construireLisible('dev')).join('\n')
    for (const n of CODE) assert.ok(lisible.includes(n), `développement lisible : ${n} attendu`)
  })

  for (const mode of ['bundle', 'split'] as const) it(`production (${mode}) : aucun des textes, dans aucun fichier envoyé`, async () => {
    const prod = await cible(mode)
    const fichiers = lireTout(join(prod.racine, 'out'))
    assert.ok(fichiers.length > 1 && fichiers.join('').includes('rs-attache'), 'la sortie de production est lue')
    for (const m of MORCEAUX) assert.ok(!fichiers.some((f) => f.includes(m)), `production : « ${m} » présent`)
  })

  it('production sans réduction des noms : ni le code des deux avertissements, ni leurs textes', async () => {
    const fichiers = await construireLisible('prod')
    const tout = fichiers.join('\n')
    assert.ok(tout.includes('rs-attache') && tout.includes('_mjs_td'), 'la sortie de production est lue, attaches comprises')
    for (const n of CODE) assert.ok(!tout.includes(n), `production : ${n} présent`)
    for (const m of MORCEAUX) assert.ok(!tout.includes(m), `production : « ${m} » présent`)
  })
})

describe('avertissements du développement : les libellés', () => {
  it('le français reprend la phrase décidée, l\'anglais la traduit ; chacun nomme le composant et la prop, ou la balise et sa ligne', () => {
    const dev = (langue: Langue) => (RUNTIME_LABELS as any)[langue].dev
    for (const langue of ['fr', 'en'] as const) {
      assert.ok(dev(langue).propOneWay.includes(PHRASE[langue]), `${langue} : la phrase décidée`)
      for (const v of ['{tag}', '{prop}']) assert.ok(dev(langue).propOneWay.includes(v), `${langue} : propOneWay nomme ${v}`)
      for (const v of ['{tag}', '{node}', '{line}', '{type}']) assert.ok(dev(langue).attachNotFn.includes(v), `${langue} : attachNotFn nomme ${v}`)
    }
  })
})
