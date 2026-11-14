// réglage `proxy: false` : une écriture par un objet de l'état que le compilateur ne suit pas — élément trouvé (`find`, `findLast`,
// `at`), élément d'une copie (`filter(f)[0]`, `values().next().value`), nom qui en tient une partie (variable, motif, boucle du script),
// valeur attendue — ne touche jamais `Object`, `Object.prototype`, `Array.prototype` ni `Function.prototype` : `constructor` écrit
// dans le code ou une clé venue de l'extérieur (`'constructor'`, `'__proto__'`) y mène, et l'écriture est refusée, comme par un chemin
// compilé, sous toutes ses formes (`=`, `||=`, `??=`, `+=`, `++`, `delete`, `push`), dans le script, dans un rappel, dans un
// gestionnaire en ligne, en JavaScript, en CoffeeScript et en Civet. L'enveloppe (sans le réglage) n'écrit rien non plus. Une écriture
// légitime (`$taches.find(f).n = v`) va toujours à l'objet. Joué dans happy-dom (production et développement : l'avertissement du
// refus est donné en développement), puis dans Chromium réel

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const TACHES = '[{ id: 1, n: 0 }, { id: 2, n: 0 }]'

// chaque forme, une méthode `(k, v)` : `k` vaut `'constructor'` puis `'__proto__'`, `v` vaut 1
const FORMES_JS: Record<string, string> = {
  fFind:     '$taches.find((t) => t.id == 1).constructor.polluK = v',
  fProto:    '$taches.find((t) => t.id == 1)[\'__proto__\'].polluK = v',
  fCle:      '$taches.find((t) => t.id == 1)[k].polluK = v',
  fFiltre:   '$taches.filter((t) => t.id)[0][k].polluK = v',
  fFiltreC:  '$taches.filter((t) => t.id)[0].constructor.polluK = v',
  fAt:       '$taches.at(-1)[k].polluK = v',
  fDernier:  '$taches.findLast((t) => t.id)[k].polluK = v',
  fOu:       '$taches.find((t) => t.id == 1)[k].polluK ||= v',
  fNul:      '$taches.find((t) => t.id == 1)[k].polluK ??= v',
  fPlus:     '$taches.find((t) => t.id == 1)[k].polluK += v',
  fIncr:     '$taches.find((t) => t.id == 1)[k].polluK++',
  fIndice:   'const i = 0; $taches[i][k].polluK = v',
  fValeurs:  '$taches.values().next().value[k].polluK = v',
  fMotif:    'const { constructor: c } = $taches.find((t) => t.id == 1); c.polluK = v',
  fMotifCle: 'const { [k]: c } = $taches.find((t) => t.id == 1); c.polluK = v',
  fVariable: 'const t = $taches.find((x) => x.id == 1); t[k].polluK = v',
  fPour:     'for (const t of $taches) { t[k].polluK = v; break; }',
  fEfface:   'delete $taches.find((t) => t.id == 1)[k].polluD',
  fPousse:   '$listes.find((l) => l.length)[k].push(v)',
  fRappel:   '[1].forEach(() => { $taches.find((t) => t.id == 1)[k].polluK = v; })',
  fAttente:  '$taches.find((t) => t.id == 1)[k].polluK = await v',
  fDeplace:  '$taches.forEach((t, i) => { if (i == 0) $taches.reverse(); t[k].polluK = v; })',
  fProtoC:   '$taches.find((t) => t.id == 1).constructor.prototype.polluK = v',
  fAssign:   'Object.assign($taches.find((t) => t.id == 1)[k], { polluK: v })',
  fAssignC:  'Object.assign($taches.find((t) => t.id == 1).constructor, { polluK: v })',
}
// le magasin, avec ou sans le réglage : une fonction qui modifie l'objet qu'elle reçoit, et un prototype atteint par `constructor`
const FORMES_MAGASIN: Record<string, string> = {
  fAssign:  'Object.assign($$tm.find((t) => t.id == 1)[k], { polluK: v })',
  fAssignC: 'Object.assign($$tm.find((t) => t.id == 1).constructor, { polluK: v })',
  fProtoC:  '$$tm.find((t) => t.id == 1).constructor.prototype.polluK = v',
}
const FORMES_COFFEE: Record<string, string> = {
  fFind: '$taches.find((t) -> t.id == 1).constructor.polluK = v',
  fCle:  '$taches.find((t) -> t.id == 1)[k].polluK = v',
  fOu:   '$taches.find((t) -> t.id == 1)[k].polluK or= v',
  fNul:  '$taches.find((t) -> t.id == 1)[k].polluK ?= v',
  fPlus: '$taches.find((t) -> t.id == 1)[k].polluK += v',
  fIncr: '$taches.find((t) -> t.id == 1)[k].polluK++',
}
const FORMES_CIVET: Record<string, string> = {
  fFind:     '$taches.find((t) => t.id == 1).constructor.polluK = v',
  fCle:      '$taches.find((t) => t.id == 1)[k].polluK = v',
  fOu:       '$taches.find((t) => t.id == 1)[k].polluK ||= v',
  fVariable: '\n    t := $taches.find((x) => x.id == 1)\n    t[k].polluK = v',
  fMotif:    '\n    {constructor: c} := $taches.find((x) => x.id == 1)\n    c.polluK = v',
}

const SOURCES: Record<string, string> = {
  'sp-pol.mjs': `<script lang="js">
  $taches = ${TACHES};
  $listes = [[1], [2]];
  $cle = '';
  @remettre = function() { $taches = ${TACHES}; $listes = [[1], [2]]; };
  @lire = function() { return JSON.stringify([$taches, $listes]); };
  @poserCle = function(k) { $cle = k; };
  @fBon = function(k, v) { $taches.find((t) => t.id == 1).n = v; };
${Object.entries(FORMES_JS).map(([n, f]) => `  @${n} = ${n === 'fAttente' ? 'async ' : ''}function(k, v) { ${f}; };`).join('\n')}
</script>
<button class="h" @click={$taches.find((t) => t.id == 1)[$cle].polluK = 1}>h</button>
<p class="etat">{$taches.length}</p>
`,
  'sp-pol-coffee.mjs': `<script lang="coffee">
  $taches = ${TACHES}
  @remettre = -> $taches = ${TACHES}
  @lire = -> JSON.stringify([$taches])
  @fBon = (k, v) -> $taches.find((t) -> t.id == 1).n = v
${Object.entries(FORMES_COFFEE).map(([n, f]) => `  @${n} = (k, v) -> ${f}`).join('\n')}
</script>
<p class="etat">{$taches.length}</p>
`,
  'sp-pol-civet.mjs': `<script>
  $taches = ${TACHES}
  @remettre = -> $taches = ${TACHES}
  @lire = -> JSON.stringify([$taches])
  @fBon = (k, v) -> $taches.find((t) => t.id == 1).n = v
${Object.entries(FORMES_CIVET).map(([n, f]) => `  @${n} = (k, v) -> ${f}`).join('\n')}
</script>
<p class="etat">{$taches.length}</p>
`,
  'sp-pol-magasin.mjs': `<script lang="js">
  $$tm = ${TACHES};
  @remettre = function() { $$tm = ${TACHES}; };
  @lire = function() { return JSON.stringify([$$tm]); };
  @fBon = function(k, v) { $$tm.find((t) => t.id == 1).n = v; };
${Object.entries(FORMES_MAGASIN).map(([n, f]) => `  @${n} = function(k, v) { ${f}; };`).join('\n')}
</script>
<p class="etat">{$$tm.length}</p>
`,
}

const BALISES: Record<string, string[]> = {
  'mjs-sp-pol':        ['fBon', 'clic', ...Object.keys(FORMES_JS)],
  'mjs-sp-pol-coffee': ['fBon', ...Object.keys(FORMES_COFFEE)],
  'mjs-sp-pol-civet':  ['fBon', ...Object.keys(FORMES_CIVET)],
  'mjs-sp-pol-magasin': ['fBon', ...Object.keys(FORMES_MAGASIN)],
}

// joué dans la page : chaque forme avec chaque clé, puis les témoins posés sur les prototypes et les fonctions de la page — `polluK` écrit,
// `polluD` effacé, `Array.prototype` rempli —, l'erreur levée, les données ; tout est retiré ensuite, les données remises. `clic` : le
// gestionnaire en ligne, la clé rangée dans `$cle`
const TRACEUR = `globalThis.__parcours = async (balise, formes) => {
  const c = document.querySelector(balise)
  const T = [Object.prototype, Object, Array.prototype, Function.prototype]
  const N = ['Object.prototype', 'Object', 'Array.prototype', 'Function.prototype']
  const own = (t, p) => Object.prototype.hasOwnProperty.call(t, p)
  const r = {}
  for (const f of formes) for (const k of ['constructor', '__proto__']) {
    for (const t of T) Object.defineProperty(t, 'polluD', { value: 1, configurable: true, writable: true })
    let erreur = ''
    try {
      if (f === 'clic') {
        c.poserCle(k)
        c._shadow.querySelector('button.h').click()
      }
      else await c[f](k, 1)
    }
    catch (e) {
      erreur = e.name
    }
    const pollue = [...N.filter((n, i) => own(T[i], 'polluK')).map((n) => n + '.polluK'), ...(Array.prototype.length ? ['Array.prototype[0]'] : []), ...N.filter((n, i) => !own(T[i], 'polluD')).map((n) => n + '.polluD retiré')]
    for (const t of T) {
      delete t.polluK
      delete t.polluD
    }
    Array.prototype.length = 0
    r[f + ' ' + k] = { pollue, erreur, donnees: c.lire() }
    c.remettre()
  }
  return r
}`

// production en un seul fichier, ou développement (tout le JavaScript, le cœur d'abord)
async function construire(nom: string, opts: Record<string, unknown>, dev: boolean): Promise<{ racine: string, code: string }> {
  const root   = mjsTmp('sans-proxy-pollution-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(dev ? root : outDir, 'bundle.js'), ...(dev ? {} : { env: 'prod', js: 'bundle', urlPrefix: '/out' }), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  if (!dev) return { racine: root, code: readFileSync(join(outDir, 'bundle.js'), 'utf-8') }
  const rang  = (f: string) => /^mjs_core/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
  return { racine: root, code: files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' }
}

const constructions = new Map<string, Promise<{ racine: string, code: string }>>()
const construction  = (nom: string, opts: Record<string, unknown>, dev = false) => {
  if (!constructions.has(nom)) constructions.set(nom, construire(nom, opts, dev))
  return constructions.get(nom)!
}

// happy-dom : le code dans la page, les trois composants montés ; en développement, les avertissements de `µ.warn` relevés
async function parcoursNode(code: string, dev: boolean) {
  const window: any = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  window.eval(dev ? code : code.replace(/import\.meta\.url/g, '\'http://localhost/\'').replace(/export\s*\{[^}]*\}\s*;?/g, ''))
  if (dev) window.µ.warn = (m: string) => avis.push(String(m))
  window.document.body.innerHTML = Object.keys(BALISES).map((b) => `<${b}></${b}>`).join('')
  const pret = () => Object.keys(BALISES).every((b) => window.document.querySelector(b)?._shadow?.querySelector('.etat')?.textContent)
  const fin  = Date.now() + 5000
  while (!pret() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  window.eval(TRACEUR)
  const traces: Record<string, any> = {}
  for (const [b, formes] of Object.entries(BALISES)) for (const [f, t] of Object.entries(await window.__parcours(b, formes))) traces[`${b} ${f}`] = t
  await window.happyDOM.close()
  return { traces, avis }
}

// aucune trace sur un prototype ni sur une fonction de la page, pour aucune forme
function aucunePollution(traces: Record<string, any>) {
  const pollues = Object.entries(traces).filter(([, t]) => t.pollue.length).map(([f, t]) => `${f} → ${t.pollue.join(', ')}`)
  assert.deepEqual(pollues, [], 'écritures qui ont atteint un prototype ou une fonction de la page')
}

// l'écriture légitime va à l'objet trouvé
function ecritureLegitime(traces: Record<string, any>) {
  for (const b of Object.keys(BALISES)) assert.match(traces[`${b} fBon constructor`].donnees, /^\[\[\{"id":1,"n":1\},\{"id":2,"n":0\}\]/, `${b} : l'écriture par find va à l'objet`)
}

describe('état sans Proxy : une écriture par un objet de l\'état n\'atteint jamais un prototype ni une fonction de la page (happy-dom)', function () {
  this.timeout(180000)
  after(() => terminateSharedWorkerPool())

  it('production, proxy: false : aucune forme ne pollue, l\'écriture légitime va à l\'objet', async () => {
    const { traces } = await parcoursNode((await construction('sans-prod', { proxy: false })).code, false)
    aucunePollution(traces)
    ecritureLegitime(traces)
  })

  it('développement, proxy: false : aucune forme ne pollue, chaque refus est dit (piège de la fonction du navigateur, segment __proto__)', async () => {
    const { traces, avis } = await parcoursNode((await construction('sans-dev', { proxy: false }, true)).code, true)
    aucunePollution(traces)
    ecritureLegitime(traces)
    assert.ok(avis.some((a) => a.includes('$taches.….polluK') && a.includes('contient la fonction Object du navigateur') && a.includes('rien n\'est écrit')), `piège de la fonction du navigateur dit : ${JSON.stringify(avis.slice(0, 5))}`)
    assert.ok(avis.some((a) => a.includes('« __proto__ »')), `segment __proto__ dit : ${JSON.stringify(avis.slice(0, 5))}`)
    // `constructor` écrit dans le code : l'avertissement posé pour ce cas ; le prototype qu'il atteint nomme ce segment, composant et magasin
    assert.ok(avis.some((a) => a.includes('$taches.… : `constructor`, écrit dans le code, mène à la fonction Object du navigateur')), `constructor écrit dans le code dit : ${JSON.stringify(avis.filter((a) => a.includes('constructor')).slice(0, 5))}`)
    assert.ok(avis.some((a) => a.includes('$$tm.… : `constructor`, écrit dans le code, mène à la fonction Object du navigateur')), `Object.assign du magasin dit : ${JSON.stringify(avis.filter((a) => a.includes('$$tm')).slice(0, 5))}`)
    assert.equal(avis.filter((a) => a.includes('« constructor »')).length >= 2, true, `prototype atteint par constructor : ${JSON.stringify(avis.filter((a) => a.includes('segment')).slice(0, 8))}`)
  })

  it('sans le réglage, l\'enveloppe n\'écrit rien non plus', async () => {
    const { traces } = await parcoursNode((await construction('avec-prod', {})).code, false)
    aucunePollution(traces)
    ecritureLegitime(traces)
  })
})

describe('état sans Proxy : une écriture par un objet de l\'état n\'atteint jamais un prototype ni une fonction de la page (chromium réel)', function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test de la pollution sans Proxy sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  const jouer = async (nom: string, opts: Record<string, unknown>) => {
    const { racine } = await construction(nom, opts)
    const page: Cible = { mode: 'bundle', racine, document: () => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${Object.keys(BALISES).map((b) => `<${b}></${b}>`).join('')}<script type="module" src="/out/bundle.js"></script></body></html>` }
    const o    = await charger(browser, page, 'mjs-sp-pol')
    try {
      await o.page.waitForFunction(`${JSON.stringify(Object.keys(BALISES))}.every((b) => !!document.querySelector(b)?._shadow?.querySelector('.etat'))`, null, { timeout: 10000 })
      await o.page.evaluate(TRACEUR)
      const traces: Record<string, any> = {}
      for (const [b, formes] of Object.entries(BALISES)) for (const [f, t] of Object.entries(await o.page.evaluate(([x, y]: any) => (globalThis as any).__parcours(x, y), [b, formes]) as any)) traces[`${b} ${f}`] = t
      // l'enveloppe : le gestionnaire en ligne lève la TypeError de JavaScript (`constructor` hérité s'y lit `undefined`)
      if (opts.proxy === false) assert.deepEqual(graves(o), [], 'aucune erreur de page')
      else assert.ok(graves(o).every((e: string) => /Cannot set properties of undefined/.test(e)), `erreurs de page : ${JSON.stringify(graves(o))}`)
      return traces
    } finally {
      await o.fermer()
    }
  }

  it('production, proxy: false : aucune forme ne pollue, l\'écriture légitime va à l\'objet', async function () {
    if (!present) { this.skip(); return }
    const traces = await jouer('sans-prod', { proxy: false })
    aucunePollution(traces)
    ecritureLegitime(traces)
  })

  it('sans le réglage, l\'enveloppe n\'écrit rien non plus', async function () {
    if (!present) { this.skip(); return }
    const traces = await jouer('avec-prod', {})
    aucunePollution(traces)
    ecritureLegitime(traces)
  })
})
