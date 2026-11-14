// Page rendue par le serveur (`ssrMode: 'markers'`) puis reprise dans un navigateur réel : les lignes d'un `{for}` sont reprises (mêmes
// nœuds), et le composant enfant d'une ligne reprise ne se connecte qu'une fois sa ligne reprise. Il se réveille donc avec les props de sa
// ligne et sa liaison à deux sens, TYPÉES, que sa balise soit définie avant la page, juste après elle (mis à niveau entre la reprise de la
// page et le premier rendu de la liste) ou plus tard, en développement comme dans le fichier unique de production ; ce qu'il écrit à son
// réveil remonte vers sa ligne. À chaque déplacement de sa ligne, il se réveille avec la valeur que sa ligne tient alors (jamais le texte que
// le serveur avait écrit pour la prop liée), et ce qu'il écrit remonte encore. Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'
import { playTogether } from './helpers/engines-together.js'

const SOURCES: Record<string, string> = {
  // à chaque réveil : note sa ligne et la valeur reçue (avec son type), puis ajoute 1
  'c-compte.mjs': `<script>\n  µawake -> window.__aw.push($lib + '=' + JSON.stringify($n)); $n = $n + 1\n</script>\n<p class="vu">{$n}</p>\n`,
  'p-compte.mjs': `<script>
  $menu = [{ id: 'a', n: 0 }, { id: 'b', n: 10 }, { id: 'c', n: 20 }]
  rev  = -> $menu = $menu.slice().reverse()
  etat = (l)-> l.map((d)-> d.id + ':' + JSON.stringify(d.n)).join(' ')
</script>
{for d in $menu by id}<section class="ligne" data-id={d.id}><@c-compte n=!{d.n} lib={d.id}></@c-compte></section>{end}
<button class="rev" @click={rev()}>rev</button>
<p class="etat">{etat($menu)}</p>
`
}

// le moment où la balise de l'enfant est définie, par rapport à celle de la page (en production, l'ordre du fichier unique)
const ORDRES = ['enfant défini avant la page', 'enfant défini juste après la page', 'enfant défini plus tard', 'production, un seul fichier'] as const
type Ordre = typeof ORDRES[number]

type Construit = { html: string, coeur: string, page: string, enfant: string, prod: string, fichiers: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('lignes-reveil')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    let html = ''
    try {
      const r = await renderer.renderToString('mjs-p-compte', { ssrMode: 'markers' } as any)
      html = `${r.html}\n${r.hydrateScript}`
    } finally {
      await renderer.close()
    }
    const lire     = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js') && f !== 'bundle.js')
    const noyau    = fichiers.filter((f) => /^mjs_core-/.test(f))
    const runtime  = fichiers.filter((f) => f.startsWith('mjs_') && !/^mjs_core-/.test(f)).sort()
    const page     = fichiers.filter((f) => f.startsWith('p-'))
    const enfant   = fichiers.filter((f) => f.startsWith('c-'))
    assert.equal(noyau.length, 1, 'le build écrit un cœur')
    assert.ok(page.length === 1 && enfant.length === 1, `le build écrit la page et l'enfant (${fichiers.join(', ')})`)
    const coeur = lire(noyau[0]) + '\nglobalThis.µ = µ;\n' + runtime.map(lire).join('\n')
    // production : la page rendue par un serveur construit en production, le client en un seul fichier
    const rendu = await createSSRRenderer({ sourceDir: srcDir, env: 'prod', bundlerOpts: { runtime: ['hydrate'] } } as any)
    let prod = ''
    try {
      const r = await rendu.renderToString('mjs-p-compte', { ssrMode: 'markers' } as any)
      prod = `${r.html}\n${r.hydrateScript}`
    } finally {
      await rendu.close()
    }
    const prodDir = join(root, 'prod')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: prodDir, manifestPath: join(prodDir, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'bundle', env: 'prod' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
    const servis = new Map<string, Buffer>()
    for (const f of readdirSync(prodDir)) if (/\.(js|json)$/.test(f)) servis.set(f, readFileSync(join(prodDir, f)))
    assert.ok(servis.has('bundle.js'), 'le build de production écrit son fichier')
    return { html, coeur, page: lire(page[0]), enfant: lire(enfant[0]), prod, fichiers: servis }
  })()
  return construit
}

// avant tout script : chaque élément écrit par le serveur dans la page porte un tampon, pour voir ensuite que les lignes sont reprises
const TAMPON = `<script>(function () {
  window.__aw = []
  document.querySelector('mjs-p-compte').shadowRoot.querySelectorAll('*').forEach(function (n) { n.__srv = true })
})()</script>`

const script = (corps: string) => `<script>${corps.replace(/<\/script/gi, '<\\/script')}</script>`

function documentDe(c: Construit, ordre: Ordre): string {
  let corps = `${c.html}\n${TAMPON}\n`
  if (ordre === 'enfant défini avant la page') corps += script(c.coeur + '\n' + c.enfant + '\n' + c.page)
  else if (ordre === 'enfant défini juste après la page') corps += script(c.coeur + '\n' + c.page + '\n' + c.enfant)
  else if (ordre === 'enfant défini plus tard') corps += script(c.coeur + '\n' + c.page) + script(`setTimeout(function () { (0, eval)(${JSON.stringify(c.enfant)}) }, 80)`)
  else corps = `${c.prod}\n${TAMPON}\n<script type="module" src="/out/bundle.js"></script>`
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}</body></html>`
}

// ce que la page montre : l'état du parent, la valeur de l'enfant de chaque ligne, les réveils notés, et les lignes qui ne sont pas celles du serveur
const LIRE = `(() => {
  const sh = document.querySelector('mjs-p-compte')._shadow
  const vu = (s) => { const c = s.querySelector('mjs-c-compte'); const p = c && c._shadow && c._shadow.querySelector('.vu'); return p ? p.textContent : '(absent)' }
  const lignes = Array.from(sh.querySelectorAll('section.ligne'))
  return {
    etat: sh.querySelector('p.etat').textContent,
    rows: lignes.map((s) => s.dataset.id + ':' + vu(s)).join(' '),
    reveils: window.__aw.slice(),
    neuves: lignes.filter((s) => s.__srv !== true || s.querySelector('mjs-c-compte').__srv !== true).map((s) => s.dataset.id)
  }
})()`

for (const nom of ['chromium', 'firefox', 'webkit'] as const) playTogether(describe(`enfant d'une ligne reprise, réveil et écriture liée (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) { console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``); return }
    await construire()
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const ordre of ORDRES) it(`${ordre} : il se réveille avec les props de sa ligne, au chargement comme à chaque déplacement, et ce qu'il écrit remonte`, async function () {
    if (!present) { this.skip(); return }
    const c    = await construire()
    const ctx  = await browser.newContext()
    const page = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 200)))
    // un plantage de composant intercepté par le framework compte comme une erreur (cf. graves, helpers/liaison-navigateur.ts)
    page.on('console', (m: any) => { if (/Crash intercepted|TypeError|ReferenceError|is not defined/.test(m.text())) erreurs.push('console : ' + m.text().slice(0, 200)) })
    try {
      await page.addInitScript('window.__name = (f) => f')
      await page.route('http://reveil.test/**', (route: any) => {
        const chemin = new URL(route.request().url()).pathname
        if (!chemin.startsWith('/out/')) return route.fulfill({ contentType: 'text/html', body: documentDe(c, ordre) })
        const corps = c.fichiers.get(chemin.slice(5))
        if (!corps) return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: chemin.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
      })
      await page.goto('http://reveil.test/', { waitUntil: 'load' })
      // la valeur que chaque ligne doit tenir : sa valeur de départ, plus un par réveil de son enfant
      const modele: Record<string, number> = { a: 0, b: 10, c: 20 }
      let ordreLignes = ['a', 'b', 'c']
      let vus = 0
      const lire = async (nb: number) => {
        let lu: any
        for (let i = 0; i < 100; i++) {
          lu = await page.evaluate(LIRE)
          if (lu.reveils.length >= nb) break
          await page.waitForTimeout(20)
        }
        await page.waitForTimeout(150)
        return page.evaluate(LIRE) as Promise<any>
      }
      const verifier = (lu: any, quand: string) => {
        // chaque réveil voit la valeur de sa ligne, typée : un nombre, jamais le texte que le serveur avait écrit
        for (const r of lu.reveils.slice(vus)) {
          const [id, valeur] = r.split('=')
          assert.equal(valeur, JSON.stringify(modele[id]), `${quand} : l'enfant de la ligne « ${id} » se réveille avec la valeur de sa ligne (réveils : ${lu.reveils.join(' ')})`)
          modele[id]++
        }
        vus = lu.reveils.length
        const attendu = ordreLignes.map((id) => id + ':' + modele[id]).join(' ')
        assert.equal(lu.etat, attendu, `${quand} : le parent a reçu ce que chaque enfant a écrit à son réveil`)
        assert.equal(lu.rows, attendu, `${quand} : chaque enfant montre la valeur de sa ligne`)
      }
      let lu = await lire(3)
      assert.deepEqual(lu.reveils.map((r: string) => r.split('=')[0]).sort(), ['a', 'b', 'c'], 'au chargement, chaque enfant se réveille une fois, avec la clé de sa ligne')
      verifier(lu, 'au chargement')
      assert.deepEqual(lu.neuves, [], 'les lignes et leurs enfants sont ceux du serveur')
      for (const geste of [1, 2]) {
        const avant = vus
        ordreLignes = [...ordreLignes].reverse()
        await page.evaluate(`document.querySelector('mjs-p-compte')._shadow.querySelector('.rev').click()`)
        lu = await lire(avant + 1)
        assert.ok(lu.reveils.length > avant, `ordre inversé ${geste} : au moins un enfant déplacé s'est réveillé`)
        verifier(lu, `ordre inversé ${geste}`)
      }
      assert.deepEqual(erreurs, [], 'aucune erreur ni plantage de composant dans la page')
    } finally {
      await ctx.close()
    }
  })
}))
