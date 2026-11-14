// Un composant retiré de la page n'est retenu par aucun objet de l'état qu'il a tenu. Les deux tables du cœur qui notent, pour chaque
// objet, le premier composant qui l'a tenu (objets tenus, premiers détenteurs) rangent une référence faible vers lui : des composants
// posés puis retirés, leurs données gardées par la page — le tas du navigateur, relu par son protocole après un ramasse-miettes forcé,
// n'en compte plus aucun. En développement comme en production, avec l'enveloppe ou sous `proxy: false`, objet lu à plat ou imbriqué ;
// et dans les formes où l'objet arrive autrement : ligne d'une liste qui le reçoit par une prop (comptée une fois rendue la réserve de
// lignes détachées que la liste garde quelques secondes pour les reprendre), liaison à deux sens, valeur dérivée précise, objet d'un
// magasin reçu par une fonction ou pris par `$sel = $$m[i]`, composant dynamique `<@module>`, composant paresseux `:wake`.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const N     = 1000
const PEU   = 300
const etat  = (ecrire: string): string => `<script>\n$d = { label: '', meta: { n: 0 } }\n@poser = (o) -> $d = o\n@ecrire = (v) -> ${ecrire}\n</script>\n`
const LIGNE = '<p class="t">{$item ? $item.label : \'-\'}</p>\n'
// objet rangé, lu à plat ; objet imbriqué lu par le gabarit : lui aussi reçoit une enveloppe
const NUS: Record<string, string> = {
  'c-plat.mjs':     etat('$d.label = v') + '<p class="t">{$d.label}</p>\n',
  'c-imbrique.mjs': etat('$d.meta.n = v') + '<p class="t">{$d.label} {$d.meta.n}</p>\n'
}
const FORMES: Record<string, string> = {
  'c-plat.mjs':   NUS['c-plat.mjs'],
  'c-liste.mjs':  '<script>\n$l = []\n@poser = (l) -> $l = l\n</script>\n<ul>{for r in $l by id}<li><@c-ligne item={r}></@c-ligne></li>{end}</ul>\n<p class="t">{$l.length}</p>\n',
  'c-ligne.mjs':  LIGNE,
  'c-lp.mjs':     '<script>\n$o = { label: \'\' }\n@poser = (o) -> $o = o\n</script>\n<@c-le d=!{$o}></@c-le>\n<p class="t">{$o.label}</p>\n',
  'c-le.mjs':     '<p class="t">{$d ? $d.label : \'-\'}</p>\n',
  'c-derive.mjs': '<script>\n$d = { label: \'\', meta: { n: 0 } }\n$titre = [$d.label, $d.meta.n].join(\'-\')\n@poser = (o) -> $d = o\n</script>\n<p class="t">{$titre}</p>\n',
  'm-racine.mjs': '<script>\n  $$vm = window.__magasin\n  @objet = (i) -> $$vm[i]\n</script>\n<p class="t">{$$vm[0].label}</p>\n',
  'm-sel.mjs':    '<script>\n  $sel = null\n  @prendre = (i) -> $sel = $$vm[i]\n</script>\n<p class="t">{$sel ? $sel.label : \'-\'}</p>\n',
  'c-dyn.mjs':    '<script>\n$comp = \'c-ligne\'\n$l = []\n@poser = (o) -> $l = [o]\n</script>\n<@module $comp item={$l[0]}></@module>\n<p class="t">{$l.length}</p>\n',
  'c-par.mjs':    '<script>\n$l = []\n@poser = (o) -> $l = [o]\n</script>\n<@c-ligne :wake=view item={$l[0]}></@c-ligne>\n<p class="t">{$l.length}</p>\n'
}

// outils de la page, posés avant le cœur : les données sont gardées par la page, les composants ne le sont par personne
const OUTILS = `window.__data    = Array.from({ length: ${N} }, (_, i) => ({ id: i, label: 'x' + i, meta: { n: i } }));
window.__magasin = Array.from({ length: ${N} }, (_, i) => ({ id: i, label: 'm' + i }));
window.__pause   = (ms = 120) => new Promise((f) => setTimeout(f, ms));
window.__ecran   = (e) => { const t = e && e._shadow && e._shadow.querySelector('.t'); return t ? t.textContent : null };
window.__pose    = (tag) => document.body.appendChild(document.createElement(tag));
// attend que la liste montre le nombre de lignes voulu, dessinées
window.__lignes  = async (p, n) => { for (let i = 0; i < 100; i++) { const l = p._shadow.querySelectorAll('mjs-c-ligne'); if (l.length === n && (!n || (l[n - 1]._shadow && l[n - 1]._shadow.querySelector('.t')))) break; await window.__pause(50) } await window.__pause(200) };`

// `n` composants posés un à un, chacun range un objet gardé par la page, puis tous retirés ; `garder` : le premier composant de la page
// porte le magasin, il reste
const UN_A_UN = (n: number, tag: string, poser: string, enfant: string, garder: boolean) => `(async () => {
  const p = document.getElementById('premier')
  ${garder ? '' : 'p.remove()'}
  let els = []
  for (let i = 0; i < ${n}; i++) els.push(__pose('${tag}'))
  await __pause(500)
  els.forEach((e, i) => { ${poser} })
  await __pause(700)
  const vu = [__ecran(els[7]), ${enfant ? `__ecran(els[7]._shadow.querySelector('${enfant}'))` : 'null'}]
  els.forEach((e) => e.remove())
  els = null
  await __pause(400)
  return vu
})()`
// la liste pose ses lignes, chacune reçoit son objet par une prop, puis les retire toutes
const LISTE = `(async () => {
  const p = document.getElementById('premier')
  p.poser(__data)
  await __lignes(p, ${N})
  const lignes = p._shadow.querySelectorAll('mjs-c-ligne'), vu = [lignes.length, lignes.length > 7 ? __ecran(lignes[7]) : '']
  p.poser([])
  await __lignes(p, 0)
  return [...vu, p._shadow.querySelectorAll('mjs-c-ligne').length]
})()`

// `tas` : les balises comptées dans le tas ; `vu` : ce que la page a montré avant le retrait (le composant a bien tenu son objet)
type Scene = { nom: string, tag: string, tas: string[], code: string, vu: unknown, reserve?: boolean }
const CAS: Scene[] = [
  { nom: 'objet à plat',   tag: 'mjs-c-plat',     tas: ['mjs-c-plat'],     code: UN_A_UN(N, 'mjs-c-plat', 'e.poser(__data[i])', '', false),     vu: ['x7', null] },
  { nom: 'objet imbriqué', tag: 'mjs-c-imbrique', tas: ['mjs-c-imbrique'], code: UN_A_UN(N, 'mjs-c-imbrique', 'e.poser(__data[i])', '', false), vu: ['x7 7', null] }
]
const AUTRES: Scene[] = [
  { nom: 'lignes d\'une liste, objet reçu par une prop',      tag: 'mjs-c-liste',  tas: ['mjs-c-ligne'],              code: LISTE,                                                                 vu: [N, 'x7', 0], reserve: true },
  { nom: 'liaison à deux sens, parent et enfant',             tag: 'mjs-c-lp',     tas: ['mjs-c-lp', 'mjs-c-le'],     code: UN_A_UN(PEU, 'mjs-c-lp', 'e.poser(__data[i])', 'mjs-c-le', false),     vu: ['x7', 'x7'] },
  { nom: 'valeur dérivée précise',                            tag: 'mjs-c-derive', tas: ['mjs-c-derive'],             code: UN_A_UN(PEU, 'mjs-c-derive', 'e.poser(__data[i])', '', false),         vu: ['x7-7', null] },
  { nom: 'objet du magasin reçu par une fonction',            tag: 'mjs-m-racine', tas: ['mjs-c-plat'],               code: UN_A_UN(PEU, 'mjs-c-plat', 'e.poser(p.objet(i))', '', true),           vu: ['m7', null] },
  { nom: 'objet du magasin pris par $sel = $$m[i]',           tag: 'mjs-m-racine', tas: ['mjs-m-sel'],                code: UN_A_UN(PEU, 'mjs-m-sel', 'e.prendre(i)', '', true),                   vu: ['m7', null] },
  { nom: 'composant dynamique <@module>, parent et enfant',   tag: 'mjs-c-dyn',    tas: ['mjs-c-dyn', 'mjs-c-ligne'], code: UN_A_UN(PEU, 'mjs-c-dyn', 'e.poser(__data[i])', 'mjs-c-ligne', false), vu: ['1', 'x7'] },
  { nom: 'composant paresseux :wake, parent et enfant',       tag: 'mjs-c-par',    tas: ['mjs-c-par', 'mjs-c-ligne'], code: UN_A_UN(PEU, 'mjs-c-par', 'e.poser(__data[i])', 'mjs-c-ligne', false), vu: ['1', 'x7'] }
]

type Bati = { nom: string, prod: boolean, proxy: boolean, sources: Record<string, string>, scenes: Scene[] }
const BATIS: Bati[] = [
  { nom: 'développement, enveloppe',                 prod: false, proxy: true,  sources: { ...NUS, ...FORMES }, scenes: [...CAS, ...AUTRES] },
  { nom: 'développement, proxy: false',              prod: false, proxy: false, sources: NUS,                   scenes: CAS },
  { nom: 'production, enveloppe, cœur nu',           prod: true,  proxy: true,  sources: NUS,                   scenes: CAS },
  { nom: 'production, proxy: false, cœur nu',        prod: true,  proxy: false, sources: NUS,                   scenes: CAS },
  { nom: 'production, enveloppe, toutes les formes', prod: true,  proxy: true,  sources: FORMES,                scenes: AUTRES }
]

async function construire(b: Bati): Promise<Map<string, Buffer>> {
  const root = mjsTmp('retenus')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const [nom, code] of Object.entries(b.sources)) writeFileSync(join(src, nom), code)
  const options: any = { sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', js: b.prod ? 'bundle' : 'split', env: b.prod ? 'prod' : 'dev' }
  if (!b.proxy) options.proxy = false
  const bundler = new Bundler(options)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = new Map<string, Buffer>()
  for (const n of readdirSync(out)) if (/\.(js|json)$/.test(n)) fichiers.set(n, readFileSync(join(out, n)))
  return fichiers
}

// une page neuve qui porte la balise `tag`, prête quand son ombre est dessinée
async function ouvrir(navigateur: any, fichiers: Map<string, Buffer>, tag: string): Promise<any> {
  const page = await navigateur.newPage()
  await page.addInitScript(OUTILS)
  await page.route('http://retenus.test/**', async (route: any) => {
    const chemin = new URL(route.request().url()).pathname
    if (!chemin.startsWith('/out/')) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><body><${tag} id="premier"></${tag}><script type="module" src="/out/bundle.js"></script></body>` })
    const corps = fichiers.get(chemin.slice(5))
    return route.fulfill(corps ? { status: 200, contentType: chemin.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps } : { status: 404, body: '' })
  })
  await page.goto('http://retenus.test/page')
  await page.waitForFunction('(() => { const e = document.getElementById("premier"); return !!e && !!e._shadow && !!e._shadow.querySelector(".t") })()', null, { timeout: 30000 })
  return page
}

// composants des balises `tags` encore vivants dans le tas, après un ramasse-miettes forcé
async function vivants(page: any, tags: string[]): Promise<number> {
  const cdp = await page.context().newCDPSession(page)
  let total = 0
  await cdp.send('HeapProfiler.enable')
  for (let k = 0; k < 3; k++) {
    await cdp.send('HeapProfiler.collectGarbage')
    await page.waitForTimeout(150)
  }
  for (const tag of tags) {
    const proto = await cdp.send('Runtime.evaluate', { expression: `customElements.get('${tag}').prototype`, objectGroup: 'retenus' })
    const tous  = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId, objectGroup: 'retenus' })
    const n     = await cdp.send('Runtime.callFunctionOn', { objectId: tous.objects.objectId, functionDeclaration: 'function () { return this.length }', returnByValue: true })
    total += n.result.value
  }
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'retenus' })
  await cdp.detach()
  return total
}

describe('composants retirés : aucun n\'est retenu par un objet de l\'état qu\'il a tenu (Chromium)', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const b of BATIS) {
    it(b.nom, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright.chromium.executablePath())) return this.skip()
      const fichiers   = await construire(b)
      const navigateur = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
      const ecarts: string[]                = []
      const releve: Record<string, unknown> = {}
      try {
        for (const sc of b.scenes) {
          const page = await ouvrir(navigateur, fichiers, sc.tag)
          try {
            const vu    = await page.evaluate(sc.code)
            let retenus = await vivants(page, sc.tas)
            // la réserve de la liste garde ses lignes détachées quelques secondes (mjs_for.ts) : le compte attend qu'elle les rende
            for (let i = 0; sc.reserve && i < 16 && retenus > 0; i++) {
              await page.waitForTimeout(1000)
              retenus = await vivants(page, sc.tas)
            }
            releve[sc.nom] = retenus
            if (JSON.stringify(vu) !== JSON.stringify(sc.vu)) ecarts.push(`${sc.nom}, la page avant le retrait : ${JSON.stringify(vu)}, attendu ${JSON.stringify(sc.vu)}`)
            if (retenus !== 0) ecarts.push(`${sc.nom} : ${retenus} composants encore dans le tas après leur retrait, attendu 0`)
          }
          finally {
            await page.close()
          }
        }
      }
      finally {
        await navigateur.close()
      }
      if (process.env.MJS_RETENUS_RELEVE) console.log(`RETENUS§ ${b.nom} ${JSON.stringify(releve)}`)
      assert.deepEqual(ecarts, [])
    })
  }
})
