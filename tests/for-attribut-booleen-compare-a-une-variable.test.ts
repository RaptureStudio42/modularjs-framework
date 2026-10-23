// {for} — un attribut booléen calculé par une comparaison à une variable (`selected={x is $choix}`, `checked={ligne.id == $courant}`) suit la
// règle de l'attribut hors boucle : présent quand la comparaison est vraie, absent quand elle est fausse. Le compilateur écrivait le TEXTE
// « true » ou « false » dans l'attribut ; or la seule présence d'un attribut booléen l'active : toutes les lignes s'allumaient (toutes les cases
// cochées, tous les boutons désactivés, la liste sur sa DERNIÈRE option…). Les sept attributs `selected`, `checked`, `disabled`, `hidden`,
// `readonly`, `required` et `open`, écrits `attr={…}` ou `@attr={…}`, dans une ligne de {for}, dans un {for} imbriqué et sous un {if} de ligne ;
// deux écritures de contrôle (comparaison à une valeur écrite, appartenance à une liste) qui prenaient déjà le bon chemin. La page est lue dans
// un navigateur réel : rendue par le client seul (au départ, puis quand le choix change), par le serveur happy-dom et par le serveur navigateur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'

const ATTRIBUTS  = ['selected', 'checked', 'disabled', 'hidden', 'readonly', 'required', 'open']
const FORMES     = ['egal', 'arobase', 'libre', 'liste']
const ENVELOPPES = ['pour', 'imbrique', 'si']

// le choix de départ est « b », puis « c » (« e » dans la boucle imbriquée) quand on clique ; chaque ligne porte l'une des valeurs de la liste
const EXPRESSION: Record<string, string> = { egal: 'x is $choix', arobase: 'x is $choix', libre: "x is 'b'", liste: '$choisis.includes(x)' }

// l'élément qui porte l'attribut, sa classe dit l'attribut et l'écriture
function element(attribut: string, forme: string): string {
  const ecrit  = forme === 'arobase' ? `@${attribut}={${EXPRESSION[forme]}}` : `${attribut}={${EXPRESSION[forme]}}`
  const classe = `k-${attribut}-${forme}`
  switch (attribut) {
    case 'selected': return `<option class="${classe}" value={x} ${ecrit}>{x}</option>`
    case 'checked':  return `<input class="${classe}" type="checkbox" aria-label="case" ${ecrit}>`
    case 'disabled': return `<button class="${classe}" ${ecrit}>x</button>`
    case 'hidden':   return `<p class="${classe}" ${ecrit}>x</p>`
    case 'open':     return `<details class="${classe}" ${ecrit}><summary>x</summary></details>`
    default:         return `<input class="${classe}" type="text" aria-label="texte" ${ecrit}>`
  }
}

// la ligne de {for} qui entoure l'élément : seule, dans une autre boucle, ou sous un {if}
function enveloppe(nom: string, corps: string): string {
  if (nom === 'pour') return `{for x in $valeurs}\n${corps}\n{end}`
  if (nom === 'imbrique') return `{for g in $groupes}\n{for x in g.valeurs}\n${corps}\n{end}\n{end}`
  return `{for x in $valeurs}\n{if $affiche}\n${corps}\n{end}\n{end}`
}

// la valeur du clic : une valeur de plus loin dans la liste ; dans la boucle imbriquée, chaque groupe a ses propres valeurs (une valeur partagée par
// deux groupes n'aurait qu'une ligne suivie par le choix : l'index de ce chemin est tenu par valeur)
const CIBLE: Record<string, string> = { pour: 'c', imbrique: 'e', si: 'c' }

// la liste déroulante de la boucle imbriquée est à choix multiple : une liste à choix unique dont les options viennent d'une boucle imbriquée
// garde sa première option, quelle que soit l'écriture de `selected` (même celle d'une comparaison à une valeur écrite) — un autre sujet
function composant(nom: string): string {
  const blocs: string[] = []
  for (const attribut of ATTRIBUTS) for (const forme of FORMES) {
    const lignes = enveloppe(nom, element(attribut, forme))
    blocs.push(attribut === 'selected' ? `<select class="liste-${forme}"${nom === 'imbrique' ? ' multiple' : ''} aria-label="liste">\n${lignes}\n</select>` : lignes)
  }
  return `<script lang="coffee">
$choix   = 'b'
$choisis = ['b']
$affiche = true
$valeurs = ['a', 'b', 'c']
$groupes = [{ valeurs: ['a', 'b', 'c'] }, { valeurs: ['d', 'e', 'f'] }]
choisirAutre = ->
  $choix   = '${CIBLE[nom]}'
  $choisis = ['${CIBLE[nom]}']
</script>
<button class="go" @click={choisirAutre}>autre</button>
<div>
${blocs.join('\n')}
</div>
`
}

// attribut présent et propriété vraie de chaque élément, par classe, dans toutes les racines d'ombre de la page
const LIRE = `(() => {
  const PROP = { readonly: 'readOnly' }
  const out = {}
  const visiter = (racine) => {
    for (const el of racine.querySelectorAll('[class^="k-"]')) {
      const attribut = el.className.split('-')[1]
      ;(out[el.className] ??= []).push([el.hasAttribute(attribut), el[PROP[attribut] || attribut] === true])
    }
    for (const el of racine.querySelectorAll('*')) {
      const ombre = el.shadowRoot || el._shadow
      if (ombre && ombre !== el) visiter(ombre)
    }
  }
  visiter(document)
  return out
})()`

// les lignes allumées dans chaque enveloppe : « b » au départ, la valeur du clic ensuite
const ALLUMEES: Record<string, Record<string, boolean[]>> = {
  depart: { pour: [false, true, false], imbrique: [false, true, false, false, false, false], si: [false, true, false] },
  apres:  { pour: [false, false, true], imbrique: [false, false, false, false, true, false], si: [false, false, true] }
}

// ce qui s'écarte de l'attendu, une ligne par écriture : vide quand tout est juste. `attendu` : les lignes allumées par le choix ; l'écriture « libre »
// compare à « b » écrit en dur, le clic ne la touche pas (`fixe`). `attributs` : l'attribut aussi (au départ), la seule propriété sinon (une case cochée
// puis changée garde son attribut de départ, qui est la valeur où `reset` revient)
function ecarts(lu: Record<string, boolean[][]>, attendu: boolean[], fixe: boolean[], attributs: boolean): string[] {
  const out: string[] = []
  for (const attribut of ATTRIBUTS) for (const forme of FORMES) {
    const trouve = lu[`k-${attribut}-${forme}`]
    if (!trouve) { out.push(`${attribut} ${forme} : absent de la page`); continue }
    const voulu     = forme === 'libre' ? fixe : attendu
    const propriete = trouve.map((e) => e[1])
    const present   = trouve.map((e) => e[0])
    if (JSON.stringify(propriete) !== JSON.stringify(voulu)) out.push(`${attribut} ${forme} : propriété ${JSON.stringify(propriete)}, attendue ${JSON.stringify(voulu)}`)
    else if (attributs && JSON.stringify(present) !== JSON.stringify(voulu)) out.push(`${attribut} ${forme} : attribut ${JSON.stringify(present)}, attendu ${JSON.stringify(voulu)}`)
  }
  return out
}

describe('{for} — un attribut booléen calculé par une comparaison à une variable', function () {
  this.timeout(240000)
  let navigateur: any
  let fichiers: Map<string, Buffer>
  let pageHappy: Record<string, string>
  let pageNavigateur: Record<string, string>

  before(async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) { this.skip(); return }
    const root = mjsTmp('for-bool-compare')
    const src  = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (const nom of ENVELOPPES) writeFileSync(join(src, `bool-${nom}.mjs`), composant(nom))
    // client seul : le build de développement, servi fichier par fichier
    const dossier = join(root, 'out')
    const bundler = new Bundler({ sourceDir: src, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', js: 'split', env: 'dev' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
    fichiers = new Map<string, Buffer>()
    for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers.set(n, readFileSync(join(dossier, n)))
    // les deux moteurs de rendu du serveur
    pageHappy = {}
    const happy = await createSSRRenderer({ sourceDir: src, outputDir: join(root, 'out-happy') })
    try { for (const nom of ENVELOPPES) pageHappy[nom] = (await happy.renderToString(`mjs-bool-${nom}`, {})).html } finally { await happy.close() }
    pageNavigateur = {}
    const moteur = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out-navigateur' }, { configDir: root })
    try { for (const nom of ENVELOPPES) pageNavigateur[nom] = (await moteur.renderPage(`mjs-bool-${nom}`, {})).html } finally { await moteur.close() }
    navigateur = await playwright.chromium.launch()
  })

  after(async () => {
    if (navigateur) await navigateur.close()
    await terminateSharedWorkerPool()
  })

  // la page du client seul : le build servi par un faux serveur, le composant monté
  async function pageClient(nom: string): Promise<any> {
    const page = await navigateur.newPage()
    await page.route('http://bool.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/out/')) {
        await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><body><mjs-bool-${nom}></mjs-bool-${nom}><script type="module" src="/out/bundle.js"></script></body>` })
        return
      }
      const corps = fichiers.get(url.pathname.slice(5))
      if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
      await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
    })
    await page.goto('http://bool.test/page')
    await page.waitForFunction(`(() => { const e = document.querySelector('mjs-bool-${nom}'); return !!e && !!e._shadow && e._mjs_is_mounted && !!e._shadow.querySelector('.k-open-liste') })()`, null, { timeout: 30000 })
    await page.waitForTimeout(200)
    return page
  }

  // la page écrite par le serveur, lue telle que le navigateur l'analyse (rien ne démarre : c'est la photo)
  async function photo(html: string): Promise<Record<string, boolean[][]>> {
    const page = await navigateur.newPage()
    try {
      await page.setContent(`<body>${html}</body>`)
      return await page.evaluate(LIRE)
    } finally {
      await page.close()
    }
  }

  for (const nom of ENVELOPPES) describe(`enveloppe « ${nom} »`, function () {
    const lieu: Record<string, string> = { pour: 'dans une ligne de {for}', imbrique: 'dans un {for} imbriqué', si: 'sous un {if} de ligne' }

    it(`client seul, ${lieu[nom]} : seule la ligne choisie est allumée`, async function () {
      const page = await pageClient(nom)
      try {
        assert.deepEqual(ecarts(await page.evaluate(LIRE), ALLUMEES.depart[nom], ALLUMEES.depart[nom], true), [])
      } finally {
        await page.close()
      }
    })

    it(`client seul, ${lieu[nom]} : quand le choix change, l'allumage suit`, async function () {
      const page = await pageClient(nom)
      try {
        await page.evaluate(`document.querySelector('mjs-bool-${nom}')._shadow.querySelector('.go').click()`)
        await page.waitForTimeout(300)
        assert.deepEqual(ecarts(await page.evaluate(LIRE), ALLUMEES.apres[nom], ALLUMEES.depart[nom], false), [])
      } finally {
        await page.close()
      }
    })

    it(`serveur happy-dom, ${lieu[nom]} : la page ne dit allumée que la ligne choisie`, async function () {
      assert.deepEqual(ecarts(await photo(pageHappy[nom]), ALLUMEES.depart[nom], ALLUMEES.depart[nom], true), [])
    })

    it(`serveur navigateur, ${lieu[nom]} : la page ne dit allumée que la ligne choisie`, async function () {
      assert.deepEqual(ecarts(await photo(pageNavigateur[nom]), ALLUMEES.depart[nom], ALLUMEES.depart[nom], true), [])
    })
  })
})
