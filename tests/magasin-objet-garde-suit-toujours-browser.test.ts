// Un objet du magasin gardé dans une variable `$` d'un composant suit toujours les écritures de ses champs : le second de deux
// composants qui gardent le même objet, l'enfant qui le reçoit par une prop puis le range dans une autre variable, un composant
// retiré puis remis, l'objet rendu par une fonction d'un module (même quand un objet de l'état est déjà tenu par deux composants),
// une écriture plus bas que l'objet gardé, la liste gardée entière, l'enfant lié à deux sens (`v=!{$sel}`) et l'objet d'un état de
// module (`µ$$panier`), la ligne d'un `{for}` gardée par son gestionnaire, l'élément d'une valeur dérivée. Avec l'enveloppe,
// l'écriture faite par la variable d'un composant prévient aussi les autres composants qui tiennent le même objet (le frère, le
// parent qui le lit) ; sans elle, elle ne prévient que lui. Une passe par écriture et par composant, aucune pour l'écriture d'un
// objet que personne ne garde. Avec
// l'enveloppe (le défaut) et sans elle (`proxy: false`), en développement et en production, en navigateur réel (Chromium pour toutes
// les scènes, Firefox et WebKit pour la scène des deux composants)
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const COMPTE = "  compte = (v) ->\n    window.__n = (window.__n || 0) + 1\n    v\n"
const SOURCES: Record<string, string> = {
  'c-x.mjs':  '<p class="x">{$o?.a}</p>\n',
  // deux composants frères gardent le même objet
  'c-h2.mjs': "<script>\n  $sel = null\n</script>\n\n<p class=\"vu\">{$sel?.nom}</p>\n<button class=\"s\" type=\"button\" @click={$sel = $$s2[0]}>s</button>\n",
  'sd.mjs':   "<script>\n  $$s2 = [{ nom: 'a' }, { nom: 'b' }]\n</script>\n\n<@c-h2></@c-h2>\n<@c-h2></@c-h2>\n<button class=\"p\" type=\"button\" @click={$$s2[0].nom = 'Z'}>p</button>\n",
  // deux enfants le reçoivent par une prop et le rangent dans une autre variable
  'c-garde.mjs': "<script>\n  $sel = null\n</script>\n\n<p class=\"vu\">{$sel?.nom}</p><p class=\"it\">{$item?.nom}</p>\n<button class=\"s\" type=\"button\" @click={$sel = $item}>s</button>\n",
  'sg.mjs':      "<script>\n  $$s3 = [{ nom: 'a' }]\n</script>\n\n<@c-garde item={$$s3[0]}></@c-garde>\n<@c-garde item={$$s3[0]}></@c-garde>\n<button class=\"p\" type=\"button\" @click={$$s3[0].nom = 'Z'}>p</button>\n",
  // composant retiré puis remis
  'c-h6.mjs': "<script>\n  $sel = null\n</script>\n\n<p class=\"vu\">{$sel?.nom}</p>\n<button class=\"s\" type=\"button\" @click={$sel = $$s6[0]}>s</button>\n",
  'sr.mjs':   "<script>\n  $$s6 = [{ nom: 'a' }]\n  $vis = true\n</script>\n\n{if $vis}<@c-h6></@c-h6>{end}\n<button class=\"t\" type=\"button\" @click={$vis = !$vis}>t</button>\n<button class=\"p\" type=\"button\" @click={$$s6[0].nom = $$s6[0].nom + 'Z'}>p</button>\n",
  // rendu par une fonction d'un module, sans puis avec un objet de l'état déjà tenu par deux composants
  's4.module.civet.mjs': "$$s4 = [{ nom: 'a' }]\nexport premier = -> $$s4[0]\nexport renommer = (v) -> $$s4[0].nom = v\n",
  's5.module.civet.mjs': "$$s5 = [{ nom: 'a' }]\nexport premier5 = -> $$s5[0]\nexport renommer5 = (v) -> $$s5[0].nom = v\n",
  'sm.mjs': "@import premier renommer 's4.module.civet.mjs'\n\n<script>\n  $sel = null\n</script>\n\n<p class=\"vu\">{$sel?.nom}</p>\n<button class=\"s\" type=\"button\" @click={$sel = premier()}>s</button>\n<button class=\"p\" type=\"button\" @click={renommer('Z')}>p</button>\n",
  'sp.mjs': "@import premier5 renommer5 's5.module.civet.mjs'\n\n<script>\n  $o = { a: 1 }\n  $sel = null\n</script>\n\n<@c-x o={$o}></@c-x>\n<@c-x o={$o}></@c-x>\n<p class=\"vu\">{$sel?.nom}</p>\n<button class=\"s\" type=\"button\" @click={$sel = premier5()}>s</button>\n<button class=\"p\" type=\"button\" @click={renommer5('Z')}>p</button>\n",
  // écriture plus bas que l'objet gardé
  'sn.mjs': "<script>\n  $$sn = [{ nom: 'a', adr: { ville: 'v' } }]\n  $sel = null\n</script>\n\n<p class=\"vu\">{$sel?.adr.ville}</p>\n<button class=\"s\" type=\"button\" @click={$sel = $$sn[0]}>s</button>\n<button class=\"p\" type=\"button\" @click={$$sn[0].adr.ville = 'Z'}>p</button>\n",
  // la liste gardée entière
  'sl.mjs': "<script>\n  $$s9 = [{ nom: 'a' }]\n  $l = null\n</script>\n\n<p class=\"vu\">{$l?.[0].nom}</p>\n<button class=\"s\" type=\"button\" @click={$l = $$s9}>s</button>\n<button class=\"p\" type=\"button\" @click={$$s9[0].nom = 'Z'}>p</button>\n",
  // enfant lié à deux sens, passes comptées ; `q` écrit un objet que personne ne garde
  'c-ed.mjs': "<script>\n" + COMPTE + "</script>\n\n<p class=\"ev\">{compte($v?.nom)}</p>\n<button class=\"e\" type=\"button\" @click={$v.nom = 'E'}>e</button>\n",
  'se.mjs':   "<script>\n  $$s8 = [{ nom: 'a' }, { nom: 'b' }]\n  $sel = null\n" + COMPTE + "</script>\n\n<p class=\"vu\">{compte($sel?.nom)}</p>\n<@c-ed v=!{$sel}></@c-ed>\n<button class=\"s\" type=\"button\" @click={$sel = $$s8[0]}>s</button>\n<button class=\"p\" type=\"button\" @click={$$s8[0].nom = 'Z'}>p</button>\n<button class=\"q\" type=\"button\" @click={$$s8[1].nom = 'Q'}>q</button>\n",
  // écrit par la variable d'un autre composant qui garde le même objet
  'c-hv.mjs': "<script>\n  $sel = null\n</script>\n\n<p class=\"vu\">{$sel?.nom}</p>\n<button class=\"s\" type=\"button\" @click={$sel = $$sv[0]}>s</button>\n<button class=\"e\" type=\"button\" @click={$sel.nom = 'Y'}>e</button>\n",
  'sv.mjs':   "<script>\n  $$sv = [{ nom: 'a' }]\n</script>\n\n<@c-hv></@c-hv>\n<@c-hv></@c-hv>\n<button class=\"p\" type=\"button\" @click={$$sv[0].nom = 'Z'}>p</button>\n",
  // la ligne d'un `{for}` du magasin gardée par son gestionnaire ; l'élément d'une valeur dérivée passée à un enfant
  'sfr.mjs': "<script>\n  $$fr = [{ id: 1, adr: { ville: 'v' } }]\n  $sel = null\n</script>\n\n{for r in $$fr}<button class=\"s\" type=\"button\" @click={$sel = r}>s</button>{end}\n<p class=\"vu\">{$sel?.adr.ville}</p>\n<button class=\"p\" type=\"button\" @click={$$fr[0].adr.ville = 'Z'}>p</button>\n",
  'c-v.mjs':  "<script>\n  $sel = null\n</script>\n\n<p class=\"vu\">{$sel?.adr.ville}</p>\n<button class=\"s\" type=\"button\" @click={$sel = $items[0]}>s</button>\n",
  'sfv.mjs':  "<script>\n  $$fv = [{ id: 1, adr: { ville: 'v' } }]\n  $vis = $$fv.filter((x) -> x.id > 0)\n</script>\n\n<@c-v items={$vis}></@c-v>\n<button class=\"p\" type=\"button\" @click={$$fv[0].adr.ville = 'Z'}>p</button>\n",
  // un objet de l'état d'un composant, tenu par deux enfants : l'écriture de l'un prévient le parent et l'autre enfant avec
  // l'enveloppe, lui seul sans elle
  'c-l.mjs':  "<p class=\"vu\">{$o?.nom}</p>\n<button class=\"e\" type=\"button\" @click={$o.nom = 'Y'}>e</button>\n",
  'sol.mjs':  "<script>\n  $o = { nom: 'a' }\n</script>\n\n<p class=\"vu\">{$o.nom}</p>\n<@c-l o={$o}></@c-l>\n<@c-l o={$o}></@c-l>\n<button class=\"p\" type=\"button\">p</button>\n",
  // l'objet d'un état de module (`µ$$panier`)
  'pa.module.civet.mjs': "export µ$$panier = { items: [{ nom: 'a' }] }\nexport premierP = -> µ$$panier.items[0]\nexport renommerP = (v) -> µ$$panier.items[0].nom = v\n",
  'st.mjs': "@import premierP renommerP 'pa.module.civet.mjs'\n\n<script>\n  $sel = null\n</script>\n\n<p class=\"vu\">{$sel?.nom}</p>\n<button class=\"s\" type=\"button\" @click={$sel = premierP()}>s</button>\n<button class=\"p\" type=\"button\" @click={renommerP('Z')}>p</button>\n"
}

// clics joués (`.x` de l'hôte, `n:.x` dans le n-ième enfant composant) et lectures attendues : avant, puis après chaque clic
const SCENES: Record<string, [string[], string[]]> = {
  'mjs-sd': [['0:.s', '1:.s', 'p'], ['- ; -', 'a ; -', 'a ; a', 'Z ; Z']],
  'mjs-sg': [['0:.s', '1:.s', 'p'], ['-/a ; -/a', 'a/a ; -/a', 'a/a ; a/a', 'Z/Z ; Z/Z']],
  'mjs-sr': [['0:.s', 't', 't', '0:.s', 'p'], ['-', 'a', '(aucun)', '-', 'a', 'aZ']],
  'mjs-sm': [['s', 'p'], ['-', 'a', 'Z']],
  'mjs-sp': [['s', 'p'], ['-', 'a', 'Z']],
  'mjs-sn': [['s', 'p'], ['-', 'v', 'Z']],
  'mjs-sl': [['s', 'p'], ['-', 'a', 'Z']],
  'mjs-se': [['s', 'p', 'q', '0:.e'], ['- ; - #2', 'a ; a #4', 'Z ; Z #6', 'Z ; Z #6', 'E ; E #8']],
  'mjs-sv': [['0:.s', '1:.s', '0:.e', 'p'], ['- ; -', 'a ; -', 'a ; a', 'Y ; a', 'Z ; Z']],
  'mjs-sfr': [['s', 'p'], ['-', 'v', 'Z']],
  'mjs-sfv': [['0:.s', 'p'], ['-', 'v', 'Z']],
  'mjs-sol': [['0:.e', '1:.e'], ['a ; a ; a', 'a ; Y ; a', 'a ; Y ; a']],
  'mjs-st': [['s', 'p'], ['-', 'a', 'Z']]
}

// avec l'enveloppe (le défaut), les autres composants qui tiennent l'objet suivent l'écriture faite par la variable de l'un
const AVEC_ENVELOPPE: Record<string, string[]> = {
  'mjs-sv': ['- ; -', 'a ; -', 'a ; a', 'Y ; Y', 'Z ; Z'],
  'mjs-sol': ['a ; a ; a', 'Y ; Y ; Y', 'Y ; Y ; Y']
}

// une construction : production en un seul fichier, ou développement (tout le JavaScript dans la page, le cœur d'abord)
async function construire(nom: string, opts: Record<string, unknown>, dev: boolean): Promise<Cible> {
  const root   = mjsTmp('magasin-garde-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(dev ? root : outDir, 'bundle.js'), ...(dev ? {} : { env: 'prod', js: 'bundle', urlPrefix: '/out' }), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const page = (balise: string, corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><${balise}></${balise}>${corps}</body></html>`
  if (!dev) return { mode: 'bundle', racine: root, document: (balise) => page(balise, '<script type="module" src="/out/bundle.js"></script>') }
  const rang   = (f: string) => /^mjs_core-/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
  const script = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  return { mode: 'dev-parents-avant', racine: root, document: (balise) => page(balise, `<script>${script}</script>`) }
}

const VARIANTES: Array<[string, Record<string, unknown>, boolean]> = [
  ['enveloppe, développement', {}, true],
  ['enveloppe, production', {}, false],
  ['sans enveloppe, développement', { proxy: false }, true],
  ['sans enveloppe, production', { proxy: false }, false]
]
const cibles = new Map<string, Promise<Cible>>()
const cible  = (nom: string, opts: Record<string, unknown>, dev: boolean) => {
  if (!cibles.has(nom)) cibles.set(nom, construire(nom.replace(/\W+/g, '-'), opts, dev))
  return cibles.get(nom) as Promise<Cible>
}

// ce que montre la scène : `.vu` de l'hôte, puis `.vu`, `.it` et `.ev` de chaque enfant composant (`-` : vide), et les passes comptées
const LIRE = (b: string) => `(() => {
  const sh = document.querySelector('${b}')?._shadow; if (!sh) return '?';
  const t = (r, s) => Array.from(r.querySelectorAll(s)).map((n) => n.textContent || '-').join('/');
  const enf = Array.from(sh.querySelectorAll('*')).filter((e) => e._shadow && e._shadow !== e).map((e) => [t(e._shadow, '.vu'), t(e._shadow, '.it'), t(e._shadow, '.ev')].filter(Boolean).join('/')).filter(Boolean);
  const vus = [t(sh, '.vu'), ...enf].filter(Boolean);
  return (vus.length ? vus.join(' ; ') : '(aucun)') + (window.__n ? ' #' + window.__n : '');
})()`
const CLIC = (b: string, q: string) => `(() => {
  const sh = document.querySelector('${b}')._shadow; const m = /^(\\d+):(.*)$/.exec('${q}');
  if (!m) { sh.querySelector('.${q}').click(); return }
  const enf = Array.from(sh.querySelectorAll('*')).filter((e) => e._shadow && e._shadow !== e);
  enf[+m[1]]._shadow.querySelector(m[2]).click();
})()`

for (const nav of ['chromium', 'firefox', 'webkit'] as const) describe(`magasin : l'objet gardé dans une variable suit toujours ses écritures (${nav})`, function () {
  this.timeout(240000)
  let browser: any = null
  before(async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright[nav].executablePath())) { this.skip(); return }
    browser = await playwright[nav].launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  const balises = nav === 'chromium' ? Object.keys(SCENES) : ['mjs-sd']
  for (const [nom, opts, dev] of VARIANTES) for (const b of balises) it(`${b} (${nom})`, async function () {
    const [clics, sans] = SCENES[b]
    const attendu       = opts.proxy === false ? sans : AVEC_ENVELOPPE[b] ?? sans
    const o = await charger(browser, await cible(nom, opts, dev), b)
    try {
      await o.page.waitForFunction(`!!document.querySelector('${b}')?._shadow?.querySelector('.p, .t')`, null, { timeout: 10000 })
      await o.page.waitForTimeout(60)
      const vus = [await o.page.evaluate(LIRE(b))]
      for (const q of clics) {
        await o.page.evaluate(CLIC(b, q))
        await o.page.waitForTimeout(60)
        vus.push(await o.page.evaluate(LIRE(b)))
      }
      assert.deepEqual(vus, attendu, `${b} (${nom}) : clics ${clics.join(', ')}`)
      assert.deepEqual(graves(o), [])
    } finally { await o.fermer() }
  })
})
