// la page rendue par le serveur dit ce que disent la page hydratée et la page rendue par le client :
// - `readonly={$x}` sur la case, l'interrupteur, le radio, le bouton rotatif et la jauge (vrai, faux, null, « FALSE », chaîne vide) : le serveur
//   écrit l'attribut sur la balise quand le navigateur l'y écrit ; la reprise le garde tel quel (aucune écriture ni aucun retrait de
//   l'attribut pendant la reprise, les nœuds du serveur repris, le formulaire inchangé, rien en double), la validité est celle de la page
//   rendue par le client, et la valeur liée reste suivie après la reprise
// - l'éditeur : `disabled="FALSE"`, `readonly="False"`, `answer="FALSE"`, `readonly={…}`, `disabled={…}` et `answer={…}` liés (« FALSE » compris) :
//   la zone d'écriture et le champ caché de la page servie sont ceux de la page hydratée et de la page rendue par le client ; « FALSE », écrit ou
//   lié, laisse l'éditeur actif, modifiable et hors du mode « répondre »
// - `readonly` écrit sous un texte que la lecture des attributs relit : `readonly="null"` sur la case reste porté et la sort de la validation,
//   `readonly="[false]"` sur la case et `readonly="[1]"` sur la liste ne le sont plus — dans les trois pages, sans erreur
// Chromium, Firefox et WebKit réels, en développement et en production (le serveur construit dans le même environnement que le client)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS } from './helpers/editeur-riche.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

const MODULES = ['checkbox', 'switch', 'radio', 'knob', 'gauge']
const VALEURS: Record<string, string> = { vrai: 'true', faux: 'false', nul: 'null', haut: '\'FALSE\'', vide: '\'\'' }
const PORTE   = [true, false, false, false, true]
const MODELE  = '<ul data-checklist><li>un</li></ul>'

const EDITEURS: Array<[string, string]> = [
  ['ed-dis', 'disabled="FALSE"'], ['ed-ro', 'readonly="False"'], ['ed-ans', `answer="FALSE" value="${MODELE}"`],
  ['ed-lro', 'readonly={$vrai}'], ['ed-ldis', 'disabled={$vrai}'], ['ed-lro-h', 'readonly={$haut}'], ['ed-ldis-h', 'disabled={$haut}'],
  ['ed-lans-h', `answer={$haut} value="${MODELE}"`]
]

// la zone d'écriture de chaque éditeur dans la page rendue par le client : [modifiable, aria-disabled, aria-readonly, rôle, champs cachés]
const ZONES = [
  ['true', null, null, 'textbox', 1], ['true', null, null, 'textbox', 1], ['true', null, null, 'textbox', 1],
  ['false', null, 'true', 'textbox', 1], ['false', 'true', null, 'textbox', 0], ['true', null, null, 'textbox', 1], ['true', null, null, 'textbox', 1],
  ['true', null, null, 'textbox', 1]
]

// la case, l'interrupteur et le radio sont obligatoires : hors de la validation en lecture seule, manquants sinon
const PAGE = `<script>
${Object.entries(VALEURS).map(([k, v]) => `  $${k} = ${v}`).join('\n')}
</script>

<form class="f" method="get" action="/envoi" @noUJS>
${MODULES.map((m) => Object.keys(VALEURS).map((k) => `  <@@${m} class="${m}-${k}" name="${m}-${k}" value="1"${m === 'knob' || m === 'gauge' ? '' : ' required'} readonly={$${k}}>x</@@${m}>`).join('\n')).join('\n')}
${EDITEURS.map(([c, a]) => `  <@@editor class="${c}" name="${c}" toolbar="none" ${a}></@@editor>`).join('\n')}
  <@@checkbox class="ecrit-null" name="ecrit-null" value="1" required readonly="null">x</@@checkbox>
  <@@checkbox class="ecrit-json" name="ecrit-json" value="1" required readonly="[false]">x</@@checkbox>
  <@@select class="ecrit-liste" name="ecrit-liste" readonly="[1]"><@@option value="a">A</@@option></@@select>
</form>
`

// les textes écrits : [readonly porté, et, le module monté, sa validité] — `readonly="null"` sort la case de la validation, `[false]` non
const TEXTES  = ['ecrit-null', 'ecrit-json', 'ecrit-liste']
const ECRITS  = [[true, false, true], [false, true, false], [false, true, true]]

const SELECTEUR = 'mjs-core-checkbox, mjs-core-switch, mjs-core-radio, mjs-core-knob, mjs-core-gauge, mjs-core-editor, mjs-core-select'
const TOTAL     = MODULES.length * Object.keys(VALEURS).length + EDITEURS.length + TEXTES.length
const CLASSES   = MODULES.flatMap((m) => Object.keys(VALEURS).map((k) => `${m}-${k}`))

// ce que dit la page : la balise de chaque module (readonly porté, et, le module monté, sa validité), la zone de chaque éditeur, le formulaire
const LIRE = `(() => {
  const h = document.querySelector('mjs-hote-ssr'), r = h.shadowRoot || h._shadow
  const q = (c) => r.querySelector('.' + c)
  const monte = (e) => e.matches(':defined') && 'willValidate' in e
  const zone = (c) => {
    const e = q(c), o = e.shadowRoot || e._shadow, s = o && o.querySelector('.surface')
    const a = (n) => s ? s.getAttribute(n) : 'aucune zone'
    return [a('contenteditable'), a('aria-disabled'), a('aria-readonly'), a('role'), e.querySelectorAll(':scope > input[type=hidden]').length]
  }
  return {
    porte: ${JSON.stringify(CLASSES)}.map((c) => q(c).hasAttribute('readonly')),
    validite: ${JSON.stringify(CLASSES)}.map((c) => monte(q(c)) ? [q(c).willValidate, q(c).checkValidity()] : null),
    zones: ${JSON.stringify(EDITEURS.map(([c]) => c))}.map(zone),
    textes: ${JSON.stringify(TEXTES)}.map((c) => [q(c).hasAttribute('readonly')].concat(monte(q(c)) ? [q(c).willValidate, q(c).checkValidity()] : [])),
    formulaire: Array.from(new FormData(r.querySelector('.f'))).map((p) => p[0] + '=' + p[1])
  }
})()`

type Rendu = { html: string, hydrateScript: string }
type Construit = { rendus: Record<'dev' | 'prod', Rendu>, dev: string, prod: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

// le rendu du serveur en développement et en production, le script de développement et les morceaux du build de production, une fois pour les trois moteurs
function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('hydratation-lecture-liee')
    const srcDir = join(root, 'src')
    const devDir = join(root, 'dev')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote-ssr.mjs'), PAGE)
    const compilateur = await createSSRRenderer({ sourceDir: srcDir, outputDir: devDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    await compilateur.renderToString('mjs-hote-ssr', { ssrMode: 'markers' } as any)
    await compilateur.close()
    const files  = readdirSync(devDir).filter((f) => f.endsWith('.js'))
    const coeur  = files.find((f) => /^mjs_core-/.test(f))!
    // chaque composant a sa propre portée, comme au vrai chargement où chaque fichier est un module
    const autres = files.filter((f) => f !== coeur && f !== 'bundle.js').map((f) => {
      const code = stripEsm(readFileSync(join(devDir, f), 'utf-8'))
      return f.startsWith('mjs_') ? code : `{\n${code}\n}`
    }).join('\n')
    const dev    = stripEsm(readFileSync(join(devDir, coeur), 'utf-8')) + '\nglobalThis.µ = µ;\n' + autres
    const rendus = {} as Record<'dev' | 'prod', Rendu>
    for (const build of ['dev', 'prod'] as const) {
      const renderer = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { runtime: ['hydrate'], ...(build === 'prod' ? { env: 'prod' } : {}) } } as any)
      const { html, hydrateScript } = await renderer.renderToString('mjs-hote-ssr', { ssrMode: 'markers' } as any)
      rendus[build] = { html, hydrateScript }
      await renderer.close()
    }
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), runtime: ['hydrate'], js: 'split', env: 'prod' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const prod = new Map<string, Buffer>()
    for (const f of readdirSync(outDir)) if (/\.(js|json)$/.test(f)) prod.set(f, readFileSync(join(outDir, f)))
    assert.ok([...prod.keys()].some((f) => /^core-checkbox-/.test(f)), 'le build de production sépare un morceau par module')
    return { rendus, dev, prod }
  })()
  return construit
}

for (const nom of MOTEURS) describe(`readonly lié des cinq modules et « false » de l'éditeur : la page servie dit ce que dit la page hydratée (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let fait: Construit
  let contenu = ''
  const erreurs: string[] = []

  // la page dans ce mode : rendue par le client (la balise seule et le script), servie sans script, ou servie puis hydratée — avant tout
  // script, chaque module du serveur reçoit un repère, et chaque écriture ou retrait de readonly sur la balise d'un module est relevé
  async function charger(build: 'dev' | 'prod', mode: 'client' | 'servie' | 'hydratee') {
    const r      = fait.rendus[build]
    const pre    = `<script>(function () { var r = document.querySelector('mjs-hote-ssr').shadowRoot; window.__ro = []; r.querySelectorAll('${SELECTEUR}').forEach(function (m) { m.__srv = true }); new MutationObserver(function (l) { l.forEach(function (x) { window.__ro.push(x.target.getAttribute('class') + ' : ' + x.oldValue + ' → ' + x.target.getAttribute('readonly')) }) }).observe(r, { subtree: true, attributes: true, attributeFilter: ['readonly'], attributeOldValue: true }) })()</script>`
    const script = build === 'dev' ? `<script>${fait.dev.replace(/<\/script/gi, '<\\/script')}</script>` : '<script type="module" src="/out/bundle.js"></script>'
    const corps  = mode === 'client' ? `<mjs-hote-ssr></mjs-hote-ssr>\n${script}` : mode === 'servie' ? r.html : `${r.html}\n${pre}\n${r.hydrateScript}\n${script}`
    contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}</body></html>`
    erreurs.length = 0
    await page.goto('http://lecture.test/page', { waitUntil: 'load' })
    if (mode !== 'servie') {
      await page.waitForFunction(`(() => {
        const h = document.querySelector('mjs-hote-ssr')
        const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('${SELECTEUR}')) : []
        return m.length === ${TOTAL} && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.firstElementChild)
      })()`, undefined, { timeout: 60000 })
      await page.evaluate(`window.__h = () => document.querySelector('mjs-hote-ssr'); window.__r = () => __h().shadowRoot || __h()._shadow`)
    }
    await page.waitForTimeout(400)
  }

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    fait    = await construire()
    browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    page    = await browser.newPage({ viewport: { width: 900, height: 900 } })
    await page.addInitScript('window.__name = (f) => f')
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
    await page.route('http://lecture.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/out/')) {
        const corps = fait.prod.get(url.pathname.slice(5))
        if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
        await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
        return
      }
      await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
    })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const build of ['dev', 'prod'] as const) describe(build === 'dev' ? 'développement' : 'production', function () {
    beforeEach(function () { if (!present) this.skip() })

    it('la page servie porte readonly là où la page rendue par le client le porte ; la page hydratée le garde, sans l\'écrire ni l\'ôter, avec la même validité', async function () {
      await charger(build, 'client')
      const client = await page.evaluate(LIRE)
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page rendue par le client')
      const attendu = MODULES.flatMap(() => PORTE)
      assert.deepEqual(client.porte, attendu, 'rendue par le client : vrai et chaîne vide écrits, faux, null et « FALSE » non')
      assert.deepEqual(client.validite, MODULES.flatMap((m) => PORTE.map((p) => [!p, p || m === 'knob' || m === 'gauge'])), 'rendue par le client : en lecture seule hors de la validation, sinon validée (obligatoire et vide : invalide)')
      assert.deepEqual(client.textes, ECRITS, 'rendue par le client : readonly="null" porté, hors de la validation ; readonly="[false]" et la liste en readonly="[1]" non')

      await charger(build, 'servie')
      const servie = await page.evaluate(LIRE)
      assert.deepEqual(servie.porte, attendu, 'servie sans script : readonly écrit par le serveur comme par le client')
      assert.deepEqual(servie.textes, ECRITS.map((e) => [e[0]]), 'servie sans script : les textes écrits, comme dans la page rendue par le client')

      await charger(build, 'hydratee')
      const hydratee = await page.evaluate(LIRE)
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page hydratée')
      assert.equal(await page.evaluate(`Array.from(__r().querySelectorAll('${SELECTEUR}')).filter((m) => m.__srv).length`), TOTAL, 'les modules du serveur sont repris, aucun n\'est refait')
      assert.deepEqual(await page.evaluate(`window.__ro.filter((x) => ${JSON.stringify(CLASSES.concat(TEXTES))}.includes(x.split(' ')[0]))`), [], 'aucune écriture ni aucun retrait de readonly sur la balise d\'un module pendant la reprise')
      assert.deepEqual(hydratee.textes, ECRITS, 'hydratée : les textes écrits, comme dans la page rendue par le client')
      assert.deepEqual(hydratee.porte, attendu, 'hydratée : readonly gardé tel que servi')
      assert.deepEqual(hydratee.validite, client.validite, 'hydratée : la validité de la page rendue par le client')
      assert.deepEqual(hydratee.formulaire, servie.formulaire, 'le formulaire de la page hydratée est celui de la page servie, rien en double')
    })

    it('après la reprise, la valeur liée reste suivie : $x faux ôte readonly et rend le champ à la validation, vrai le remet', async function () {
      await charger(build, 'hydratee')
      const vrais = MODULES.map((m) => `${m}-vrai`)
      const etat  = () => page.evaluate(`${JSON.stringify(vrais)}.map((c) => { const e = __r().querySelector('.' + c); return [e.hasAttribute('readonly'), e.willValidate] })`)
      assert.deepEqual(await etat(), vrais.map(() => [true, false]), 'repris en lecture seule')
      await page.evaluate(`__h()._set('vrai', false)`)
      await page.waitForTimeout(250)
      assert.deepEqual(await etat(), vrais.map(() => [false, true]), '$x faux : readonly ôté, de nouveau validés')
      await page.evaluate(`__h()._set('vrai', true)`)
      await page.waitForTimeout(250)
      assert.deepEqual(await etat(), vrais.map(() => [true, false]), '$x vrai : readonly remis')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    })

    it('l\'éditeur : disabled="FALSE", readonly="False", answer="FALSE", readonly, disabled et answer liés — la page servie dit ce que disent la page hydratée et la page rendue par le client', async function () {
      await charger(build, 'client')
      const client = (await page.evaluate(LIRE)).zones
      assert.deepEqual(client, ZONES, 'rendue par le client : « false » (toute casse) écrit ou lié laisse actif, modifiable et hors du mode « répondre »')
      await charger(build, 'servie')
      assert.deepEqual((await page.evaluate(LIRE)).zones, client, 'servie sans script')
      await charger(build, 'hydratee')
      assert.deepEqual((await page.evaluate(LIRE)).zones, client, 'hydratée')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page hydratée')
    })
  })
})
