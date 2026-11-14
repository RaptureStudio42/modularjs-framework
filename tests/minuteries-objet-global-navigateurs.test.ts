// µafter dans les trois moteurs réels, µ décomposé de l'objet global — en développement : la construction de production
// n'expose pas `window.µ`. `{ µ: m } = window`, puis deux poses sous un même nom par `m.after` : la construction a vu la
// forme, une seule tire, sans l'avertissement d'un `id` qu'elle n'aurait pas lu ; `{ µ: { after } } = window`, seul accès
// de l'appli à la minuterie : son module entre au cœur, et l'appel part. En production, `window.µ` n'existe que si l'appli le
// pose elle-même, hors des sources (son script d'entrée) : la page le pose depuis le module du cœur chargé, puis `{ µ: m } =
// window` et deux poses sous un même nom par `m.after` — une seule tire
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, ouvrir, type Page, type Session } from './helpers/editeur-riche.js'

// aucun autre code dans l'appli, ni module cœur : `morceaux: false`
const page = (cle: string, script: string, boutons = ''): Page => ({
  cle,
  morceaux: false,
  attente:  `(() => { const h = document.querySelector('mjs-hote'); return !!(h && h._shadow && h._shadow.querySelector('button.go')) })()`,
  aides:    `window.__compte = (x) => (window.__j || []).filter((y) => y === x).length; 0`,
  source:   `<p class="etat">{$go}</p>\n<button class="go" @click={-> $go = $go + 1}>go</button>${boutons}\n\n<script>\n  window.__j = window.__j or []\n  $go = 0\n${script}\n</script>\n`,
})
const NOMMEE = page('fenetre-nommee', "  µafter 30, -> window.__j.push('a')\n  { µ: m } = window\n  try\n    m.after 40, { id: 'x' }, -> window.__j.push('x')\n    m.after 40, { id: 'x' }, -> window.__j.push('x')\n  catch e\n    window.__err = String(e)")
const SEULE  = page('fenetre-seule', "  { µ: { after } } = window\n  try\n    after 40, -> window.__j.push('s')\n  catch e\n    window.__err = String(e)")
// `window.µ = µ` posé par la page, hors des sources : le µ du module du cœur déjà chargé
const POSEE: Page = {
  ...page('fenetre-posee', "  µafter 30, -> window.__j.push('a')\n  poser = ->\n    { µ: m } = window\n    try\n      m.after 40, { id: 'x' }, -> window.__j.push('x')\n      m.after 40, { id: 'x' }, -> window.__j.push('x')\n    catch e\n      window.__err = String(e)", '\n<button class="poser" @click={-> poser()}>poser</button>'),
  aides: `window.__compte = (x) => (window.__j || []).filter((y) => y === x).length; window.__clic = (cls) => document.querySelector('mjs-hote')._shadow.querySelector('button.' + cls).click(); window.__poserMu = async () => { for (const u of ['/out/bundle.js', ...performance.getEntriesByType('resource').map((e) => e.name)].filter((n) => n.includes('/out/') && n.endsWith('.js'))) { const m = await import(u); const v = Object.values(m).find((x) => x && typeof x.after === 'function' && typeof x.every === 'function'); if (v) { window.µ = v; return true } } return false }; 0`,
}
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

for (const nom of MOTEURS) describe(`µafter — µ décomposé de window (dev, ${nom} réel)`, function () {
  this.timeout(90000)
  let s: Session | null = null
  const E = (expr: string): Promise<any> => s!.page.evaluate(expr)
  afterEach(async () => {
    if (s) await s.fermer()
    s = null
  })
  after(async () => { await terminateSharedWorkerPool() })

  it('`{ µ: m } = window`, deux poses par `m.after` sous un même nom : une seule tire', async function () {
    s = await ouvrir(nom, 'dev', NOMMEE)
    if (!s) this.skip()
    await dormir(300)
    const n = await E('__compte("x")')
    assert.equal(n, 1, `${n} tirs sous le nom x ; erreur : ${await E('window.__err || ""')} ; console : ${JSON.stringify(s!.logs.slice(-6))}`)
    const avis = s!.logs.filter((l) => /serait ignorée|would be ignored/.test(l))
    assert.equal(avis.length, 0, `aucun avertissement « id » : ${JSON.stringify(avis)}`)
  })

  it('`{ µ: { after } } = window`, seul accès à la minuterie : le module entre, l\'appel part', async function () {
    s = await ouvrir(nom, 'dev', SEULE)
    if (!s) this.skip()
    await dormir(300)
    const n = await E('__compte("s")')
    assert.equal(n, 1, `${n} tir ; erreur : ${await E('window.__err || ""')} ; console : ${JSON.stringify(s!.logs.slice(-6))}`)
  })
})

for (const nom of MOTEURS) describe(`µafter — \`{ µ: m } = window\` en production, \`window.µ\` posé par la page (${nom} réel)`, function () {
  this.timeout(90000)
  let s: Session | null = null
  const E = (expr: string): Promise<any> => s!.page.evaluate(expr)
  after(async () => {
    if (s) await s.fermer()
    s = null
    await terminateSharedWorkerPool()
  })

  it('deux poses par `m.after` sous un même nom : une seule tire', async function () {
    s = await ouvrir(nom, 'prod', POSEE)
    if (!s) this.skip()
    assert.equal(await E('__poserMu()'), true, 'window.µ posé par la page')
    await E('__clic("poser")')
    await dormir(300)
    const n = await E('__compte("x")')
    assert.equal(n, 1, `${n} tirs sous le nom x ; erreur : ${await E('window.__err || ""')} ; console : ${JSON.stringify(s!.logs.slice(-6))}`)
  })
})
