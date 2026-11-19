// `:attach` écrit en fonction dont le corps tient plusieurs instructions, séparées par `;` (`(el) -> el.dataset.a = '1'; el.dataset.b = '2'`) ou
// chacune sur sa ligne sous la flèche, en Civet comme en JavaScript : tout le corps appartient à la fonction, la balise reçoit les deux écritures,
// et la fonction rendue en dernier (`(el) -> el.dataset.a = '1'; -> el.dataset.fin = '1'`) est le nettoyage, appelé quand la balise quitte la page.
// La flèche s'arrêtait à la première instruction et la suite tombait hors d'elle : `el is not defined`, composant non rendu, sans erreur à la
// construction. Une expression qui lit `el` en deux instructions le reçoit comme `_node` ; `:attach={fn}` et l'attache d'une instruction restent
// justes ; dans un `{for}` (ligne ajoutée comprise) et dans un `{if}` fermé puis rouvert ; des paramètres à valeur par défaut (appel, décomposition,
// gabarit) gardent la flèche entière, et tout se retire sans erreur ; une attache que la construction ne lit ni en une seule expression ni en une seule
// fonction (corps illisible, instructions suivies d'une flèche nue) est refusée, par un message qui dit quoi écrire — vraie construction (production, un
// seul fichier), mode strict, Chromium et Firefox
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang, t } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

// un composant par famille de formes ; chaque balise lue porte `data-a` et `data-b` quand son attache a tout posé
const FORMES: Record<string, string> = {
  'ap-civet.mjs': `<b class="pv" :attach={(el) -> el.dataset.a = '1'; el.dataset.b = '2'}>pv</b>
<b class="bloc" :attach={(el) ->
  el.dataset.a = '1'
  el.dataset.b = '2'
}>bloc</b>
<b class="une-fois" :attach.once={(el) -> el.dataset.a = '1'; el.dataset.b = '2'}>une-fois</b>
`,
  'ap-js.mjs': `<b class="pv" :attach={(el) => el.dataset.a = '1'; el.dataset.b = '2'}>pv</b>
<b class="accolades" :attach={(el) => { el.dataset.a = '1'; el.dataset.b = '2' }}>accolades</b>
<b class="bloc" :attach={(el) => {
  el.dataset.a = '1'
  el.dataset.b = '2'
}}>bloc</b>
`,
  'ap-direct.mjs': `<b class="el" :attach={el.dataset.a = '1'; el.dataset.b = '2'}>el</b>
<b class="node" :attach={_node.dataset.a = '1'; _node.dataset.b = '2'}>node</b>
`,
  'ap-temoins.mjs': `<script>
  poser = (el) ->
    el.dataset.a = '1'
    el.dataset.b = '2'
    return
</script>
<b class="fn" :attach={poser}>fn</b>
<b class="une" :attach={(el) -> el.dataset.a = '1'}>une</b>
`,
  'ap-parametres.mjs': `<b class="defaut" :attach={(el, n = Math.max(1, 2)) -> el.dataset.a = String(n); el.dataset.b = '2'}>defaut</b>
<b class="decompose" :attach={({ dataset, sansNom = String(7) }) -> dataset.a = sansNom; dataset.b = '2'}>decompose</b>
<b class="gabarit" :attach={(el, t = \`v\${(1 + 1)}\`) -> el.dataset.a = t; el.dataset.b = '2'}>gabarit</b>
`,
  'ap-pour.mjs': `<script>
  $l = [{ id: 1 }, { id: 2 }]
  @ajouter = -> $l = [...$l, { id: 3 }]
</script>
<ul>{for t in $l by id}<li class="pv" :attach={(el) -> el.dataset.a = '1'; el.dataset.b = String(t.id)}>{t.id}</li><li class="bloc" :attach={(el) ->
  el.dataset.a = '1'
  el.dataset.b = String(t.id)
}>{t.id}</li>{end}</ul>
`
}

// le nettoyage rendu en dernier, dans un `{if}` fermé puis rouvert (construit à part : le défaut cassait aussi le JS émis)
const NETTOYAGES: Record<string, string> = {
  'ap-si.mjs': `<script>
  $vu = true
  @basculer = -> $vu = not $vu
</script>
{if $vu}
  <i class="fin" :attach={(el) -> el.dataset.a = '1'; -> el.dataset.fin = '1'}>fin</i>
  <i class="deux" :attach={(el) -> el.dataset.a = '1'; el.dataset.b = '2'; -> el.dataset.fin = '1'}>deux</i>
  <i class="bloc" :attach={(el) ->
    el.dataset.a = '1'
    el.dataset.b = '2'
    -> el.dataset.fin = '1'
  }>bloc</i>
{end}
`
}

// la construction de production en un seul fichier, en mode strict ; ses erreurs, pour que le cas les dise
async function construire(prefixe: string, sources: Record<string, string>): Promise<{ code: string, erreurs: string[] }> {
  const root = mjsTmp(prefixe)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(src, nom), source)
  const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle', minify: false } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  const erreurs = stats.errors.map((e: any) => String(e.message))
  if (erreurs.length) return { code: '', erreurs }
  return { code: '"use strict";\n' + readFileSync(join(out, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, ''), erreurs }
}

// ouvre une page du moteur avec le code construit, joue `scenario` dans la page ; rend ce qu'il lit et les erreurs que la page a dites
async function jouer(moteur: 'chromium' | 'firefox', code: string, scenario: () => Promise<unknown>): Promise<{ vus: unknown, erreurs: string[] }> {
  const playwright: any = await import('playwright')
  const navigateur = await playwright[moteur].launch()
  try {
    const page = await navigateur.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 200)))
    // le rendu tombé est pris par le runtime, qui le dit dans la console
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 200)) })
    await page.setContent('<!doctype html><html><head></head><body></body></html>')
    await page.addScriptTag({ content: code })
    const vus = await page.evaluate(scenario)
    await page.close()
    return { vus, erreurs }
  }
  finally { await navigateur.close() }
}

// ce que chaque balise doit porter, `classe:a,b` (attribut absent : `-`)
const ATTENDU_FORMES = {
  'mjs-ap-civet': ['pv:1,2', 'bloc:1,2', 'une-fois:1,2'],
  'mjs-ap-js': ['pv:1,2', 'accolades:1,2', 'bloc:1,2'],
  'mjs-ap-direct': ['el:1,2', 'node:1,2'],
  'mjs-ap-temoins': ['fn:1,2', 'une:1,-'],
  'mjs-ap-parametres': ['defaut:2,2', 'decompose:7,2', 'gabarit:v2,2'],
  'mjs-ap-pour': ['pv:1,1', 'bloc:1,1', 'pv:1,2', 'bloc:1,2'],
  'mjs-ap-pour après ajout': ['pv:1,1', 'bloc:1,1', 'pv:1,2', 'bloc:1,2', 'pv:1,3', 'bloc:1,3']
}

describe('`:attach` dont la fonction tient plusieurs instructions (`;` ou une par ligne) : tout le corps lui appartient', function () {
  this.timeout(200000)
  let formes: { code: string, erreurs: string[] }
  let nettoyages: { code: string, erreurs: string[] }

  before(async () => {
    formes     = await construire('attache-plusieurs-instructions', FORMES)
    nettoyages = await construire('attache-plusieurs-instructions-nettoyage', NETTOYAGES)
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const moteur of ['chromium', 'firefox'] as const) {
    it(`${moteur} : Civet et JavaScript, \`;\` ou une instruction par ligne, \`.once\`, \`el\` comme \`_node\`, témoins, paramètres à valeur par défaut, ligne de {for} ajoutée, retrait`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      assert.deepEqual(formes.erreurs, [], 'la construction passe')
      const { vus, erreurs } = await jouer(moteur, formes.code, async () => {
        const balises = ['mjs-ap-civet', 'mjs-ap-js', 'mjs-ap-direct', 'mjs-ap-temoins', 'mjs-ap-parametres', 'mjs-ap-pour']
        document.body.innerHTML = balises.map((b) => `<${b}></${b}>`).join('')
        const ombre = (b: string) => { const h: any = document.querySelector(b); return h._shadow || h.shadowRoot || h }
        const lire  = (b: string) => Array.from(ombre(b).querySelectorAll('b, li')).map((n: any) => `${n.className}:${n.dataset.a ?? '-'},${n.dataset.b ?? '-'}`)
        for (let i = 0; i < 100 && balises.some((b) => !ombre(b).querySelector('b, li')); i++) await new Promise((r) => setTimeout(r, 20))
        const releve: Record<string, unknown> = {}
        for (const b of balises) releve[b] = ombre(b).querySelector('b, li') ? lire(b) : 'non rendu'
        ;(document.querySelector('mjs-ap-pour') as any).ajouter?.()
        await new Promise((r) => setTimeout(r, 120))
        releve['mjs-ap-pour après ajout'] = lire('mjs-ap-pour')
        // tout retiré de la page : chaque nettoyage part, sans erreur
        document.body.innerHTML = ''
        await new Promise((r) => setTimeout(r, 120))
        return releve
      })
      assert.deepEqual({ vus, erreurs }, { vus: ATTENDU_FORMES, erreurs: [] })
    })

    it(`${moteur} : la fonction rendue en dernier est le nettoyage, appelé quand le {if} se ferme ; rouvert, l'attache repose tout`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      assert.deepEqual(nettoyages.erreurs, [], 'la construction passe')
      const { vus, erreurs } = await jouer(moteur, nettoyages.code, async () => {
        document.body.innerHTML = '<mjs-ap-si></mjs-ap-si>'
        const hote: any = document.querySelector('mjs-ap-si')
        const ombre = () => hote._shadow || hote.shadowRoot || hote
        const lire  = (n: any) => `${n.className}:${n.dataset.a ?? '-'},${n.dataset.b ?? '-'},${n.dataset.fin ?? '-'}`
        for (let i = 0; i < 100 && ombre().querySelectorAll('i').length < 3; i++) await new Promise((r) => setTimeout(r, 20))
        const avant = Array.from(ombre().querySelectorAll('i'))
        if (avant.length < 3) return 'non rendu'
        const ouvert = avant.map(lire)
        hote.basculer()
        await new Promise((r) => setTimeout(r, 120))
        const ferme = { restees: ombre().querySelectorAll('i').length, retirees: avant.map(lire) }
        hote.basculer()
        await new Promise((r) => setTimeout(r, 120))
        return { ouvert, ferme, rouvert: Array.from(ombre().querySelectorAll('i')).map(lire) }
      })
      const pose = ['fin:1,-,-', 'deux:1,2,-', 'bloc:1,2,-']
      assert.deepEqual({ vus, erreurs }, { vus: { ouvert: pose, ferme: { restees: 0, retirees: ['fin:1,-,1', 'deux:1,2,1', 'bloc:1,2,1'] }, rouvert: pose }, erreurs: [] })
    })
  }

  it('une attache que la construction ne lit ni en une seule expression ni en une seule fonction est refusée, par un message qui dit quoi écrire', async () => {
    for (const source of [`<b :attach={(el) -> el.dataset.a = '1'; el.dataset.b = }>x</b>\n`, `<b :attach={el.dataset.a = '1'; -> el.dataset.fin = '1'}>x</b>\n`]) {
      const { erreurs } = await construire('attache-plusieurs-instructions-refus', { 'ap-refus.mjs': source })
      const texte = erreurs.join('\n')
      assert.ok(/ne se lit ni en une seule expression ni en une seule fonction|cannot be read as a single expression or a single function/.test(texte), `${source.trim()} : l'erreur dit pourquoi : ${texte || 'aucune erreur'}`)
      assert.ok(texte.includes(':attach'), `l'erreur nomme l'attribut : ${texte}`)
    }
  })

  it('le message existe en français (vouvoiement) et en anglais', () => {
    setMessagesLang('fr')
    const fr = t('generator.attach-body-unreadable', { attrName: ':attach' })
    setMessagesLang('en')
    const en = t('generator.attach-body-unreadable', { attrName: ':attach' })
    setMessagesLang('fr')
    assert.ok(fr.includes(':attach') && /Vérifiez son texte, ou écrivez-la en fonction/.test(fr) && fr.includes('{ a(); b() }'), fr)
    assert.ok(en.includes(':attach') && /Check its text, or write it as a function/.test(en) && en.includes('{ a(); b() }'), en)
  })
})
