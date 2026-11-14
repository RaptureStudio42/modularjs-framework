// cycle de vie des composants, scénario par scénario, dans Chromium, Firefox et WebKit réels, build de développement et de
// production, comparé au journal que donne ModularJS 3.1.0 pour le même scénario : `µawake`, `µsleep`, `µmount` (référence
// `@this` posée ou non, ombre rendue ou non), `µdestroy`, tirs de `µevery`, abonnements de `µ.interp`, minuterie coupée par
// `µdestroy`. Le journal de la 3.1.0 est recopié dans chaque scénario (`v310`) ; les seuls écarts permis sont écrits à côté
// (`ecart`), avec leur raison. `MJS_TEMOIN=<dossier ModularJS d'une 3.1.0>` rejoue les scénarios sur cet arbre et vérifie que
// le journal recopié est bien le sien ; `MJS_RELEVE=1` affiche les journaux sans rien comparer

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { mjsTmp } from './helpers/tmp.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'
type Env        = 'dev' | 'prod'
interface Construction { base: string, server: Server }
interface Serveur { dev: string, prod: string, fichiers: Map<string, Buffer> }
interface Ecart { change: Record<string, any>, raison: string, ou310?: boolean }
interface Scenario { nom: string, depart: string, pret: string, geste: (arg: any) => Promise<any>, arg?: any, v310: any, ecart?: Ecart }

const TEMOIN = process.env.MJS_TEMOIN || ''
const RELEVE = process.env.MJS_RELEVE === '1'
const source = (chemin: string) => import(TEMOIN ? pathToFileURL(join(TEMOIN, 'src', chemin)).href : '../src/' + chemin)

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

// chaque hook écrit dans `window.__k` ; `:HORS` marque un réveil ou un montage joué hors du document
const L     = (...l: string[]) => l.join('\n') + '\n'
const HORS  = "(if @@isConnected then '' else ':HORS')"
const PAGE  = (n: string, ...reveil: string[]) => L('<script>', '  µawake ->', `    window.__k.push('${n}-awake' + ${HORS})`, ...reveil, `  µsleep -> window.__k.push('${n}-sleep')`, `  µmount -> window.__k.push('${n}-mount' + ${HORS})`, `  µdestroy -> window.__k.push('${n}-destroy')`, '</script>', `<p>${n}</p>`)
const SUIVI = (p: string) => L('<script>', "  $who = '?'", `  µawake -> window.__k.push('${p}awake:' + $who + ${HORS})`, `  µsleep -> window.__k.push('${p}sleep:' + $who)`, `  µmount -> window.__k.push('${p}mount:' + $who + ${HORS})`, `  µdestroy -> window.__k.push('${p}destroy:' + $who)`, '</script>', '<b class="kid">{$who}</b>')
const KID   = (who: string) => `<@kid who="${who}"></@kid>`

const SOURCES: Record<string, string> = {
  'app.page.mjs': L('<script>', '  $$compteur = 0', '</script>', '<button class="inc" @click={$$compteur++}>+</button>', '<routes target="main">', '/o  autre-page', '/l/*  lay-layout', '/if/*  hote-if-page', '/liste  liste-page', '/garde  garde-page', '/meeting/*  bare-layout', '/profile/*  bare-layout', '/mood  mood-layout', '/kidpage  kid-host-page', '/bounce  bounce-page', '/move  move-page', '/vitrine  vitrine-page', '/miroir  miroir-page', '/module  module-page', '/modale  modale-page', ...Array.from({ length: 10 }, (_, i) => `/n/${i + 1}  n${i + 1}-page`), '</routes>', '<@view main>'),
  'autre-page.mjs': PAGE('autre'),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`n${i + 1}-page.mjs`, PAGE(`n${i + 1}`)])),
  'kid.mjs': SUIVI(''),
  'kid-b.mjs': SUIVI('b-'),
  'kid-ref.mjs': L('<script>', "  $who = '?'", '  boite = null', "  µawake -> window.__k.push('awake:' + $who + " + HORS + ')', "  µsleep -> window.__k.push('sleep:' + $who)", "  µmount -> window.__k.push('mount:' + $who + ':' + (if boite then 'ref' else 'SANSREF') + ':' + (if @@_shadow and @@_shadow.querySelector('.kid') then 'rendu' else 'NONRENDU'))", "  µdestroy -> window.__k.push('destroy:' + $who)", '</script>', '<b class="kid" :this=!{boite}>{$who}</b>'),
  'kid-ev.mjs': L('<script>', "  $qui = '?'", '  boite = null', "  µawake -> window.__k.push('awake:' + $qui + " + HORS + ')', "  µmount -> window.__k.push('mount:' + $qui + ':' + (if boite then 'ref' else 'SANSREF') + ':' + (if @@_shadow and @@_shadow.querySelector('.qui') then 'rendu' else 'NONRENDU'))", "  µdestroy -> window.__k.push('destroy:' + $qui)", "  µevery 40, -> window.__k.push('tick:' + $qui)", '</script>', '<b class="qui" :this=!{boite}>{$qui}</b>'),
  'kid-interp.mjs': L('<script>', "  $qui = '?'", "  m = µ.interp(window.__jeu, { fields: ['x'] })", "  µawake -> window.__k.push('awake:' + $qui + ':abos=' + window.__abos)", '</script>', '<b class="qui">{$qui}</b>'),
  'kid-interp-m.mjs': L('<script>', "  $qui = '?'", "  m = µ.interp(window.__jeu, { fields: ['x'] })", "  µawake -> window.__k.push('awake:' + $qui + ':abos=' + window.__abos)", "  µmount -> window.__k.push('mount:' + $qui + ':abos=' + window.__abos)", '</script>', '<b class="qui">{$qui}</b>'),
  'kid-timer.mjs': L('<script>', "  $qui = '?'", '  t = µevery 30, immediate: false, -> window.__fuite++', '  µdestroy ->', '    t()', "    window.__k.push('destroy:' + $qui)", '</script>', '<b>{$qui}</b>'),
  'kid-st.mjs': L('<script>', "  $qui = '?'", "  µawake -> window.__k.push('awake:' + $qui + ':' + $$compteur)", "  µmount -> window.__k.push('mount:' + $qui + ':' + $$compteur)", "  µdestroy -> window.__k.push('destroy:' + $qui)", '</script>', '<b class="v">{$$compteur}</b>'),
  // retire son enfant `[data-retire]` depuis son `µawake`, avant que la connexion de l'enfant ne joue, et le garde de côté
  'retireur.mjs': L('<script>', '  µawake ->', "    k = @@querySelector('[data-retire]')", '    return unless k and window.__retirer', '    window.__retirer = null', '    k.remove()', '    window.__orphelin = k', '</script>', '<slot></slot>'),
  // déplace son enfant depuis son `µawake`, selon `window.__mode`
  'mover.mjs': L('<script>', '  µawake ->', "    k = @@querySelector('mjs-kid')", '    m = window.__mode', '    return unless k and m', '    window.__mode = null', "    if m is 'detache'", "      h = document.createElement('div')", '      h.appendChild(k)', '      µafter 30, -> document.body.appendChild(h)', "    else if m is 'ailleurs'", '      document.body.appendChild(k)', "    else if m is 'retire-remet'", '      k.remove()', '      @@appendChild(k)', "    else if m is 'fragment'", '      f = document.createDocumentFragment()', '      f.appendChild(k)', '      queueMicrotask(-> document.body.appendChild(f))', "    else if m is 'jamais'", '      k.remove()', '      window.__orphelin = k', '</script>', '<slot></slot>'),
  'move-page.mjs': L('<p>move</p>', '<@mover></@mover>', KID('pre')),
  'lay-layout.page.mjs': L('<routes target="in">', '/l/a  la-page', '/l/b  lb-page', '</routes>', '<@view in>'),
  'la-page.mjs': PAGE('la'),
  'lb-page.mjs': PAGE('lb'),
  'if-layout.page.mjs': L('<routes target="in2">', '/if/a  ia-page', '/if/b  ib-page', '</routes>', '<@view in2>'),
  'ia-page.mjs': PAGE('ia'),
  'ib-page.mjs': PAGE('ib'),
  'hote-if-page.mjs': L('<script>', '  $montre = true', '</script>', '<button class="bascule" @click={$montre = not $montre}>b</button>', '{if $montre}', '  <@if-layout></@if-layout>', '{end}'),
  'liste-page.mjs': L('<script>', "  $items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]", '</script>', '<button class="rev" @click={$items = $items.slice().reverse()}>r</button>', "<button class=\"add\" @click={$items = [{ id: 'z' }].concat($items)}>a</button>", '<button class="rot" @click={$items = $items.slice(1).concat([$items[0]])}>o</button>', '<ul>', '{for it in $items by id}', '  <li><@kid who={it.id}></@kid></li>', '{end}', '</ul>'),
  'garde-page.mjs': PAGE('garde', '    if window.__rebond', '      window.__rebond = false', "      µRouter.to('/o')").replace('<p>garde</p>', '<p>garde</p>\n<@kid-ev qui="g"></@kid-ev>'),
  // layout gardé : `µurlChange` renvoie au profil quand la page le demande (déconnexion, refus)
  'bare-layout.page.mjs': L('<routes target="bare">', '/meeting/keep/:id  meeting-keep-page', '/profile/assistant  profile-assistant-page', '/profile/secret  profile-secret-page', '</routes>', '<script>', '  µurlChange (path)->', "    µRouter.to('/profile/assistant', { replace: true }) if path.startsWith('/meeting') and window.__deconnecte", "    µRouter.to('/profile/assistant', { replace: true }) if path is '/profile/secret' and window.__refuse", '</script>', '<@view bare>'),
  'meeting-keep-page.mjs': L('<script>', "  µawake -> window.__k.push('reunion-awake:' + &id + " + HORS + ')', "  µsleep -> window.__k.push('reunion-sleep')", "  µmount -> window.__k.push('reunion-mount')", "  µdestroy -> window.__k.push('reunion-destroy')", '</script>', '<p>{&id}</p>', KID('r')),
  'profile-assistant-page.mjs': PAGE('profil'),
  'profile-secret-page.mjs': PAGE('secret'),
  'mood-layout.page.mjs': L('<routes target="mood">', '/mood  mood-page', '</routes>', '<@view mood>'),
  'mood-page.mjs': PAGE('humeur'),
  'kid-host-page.mjs': PAGE('hote').replace('<p>hote</p>', '<p>hote</p>\n' + KID('enfant')),
  'bounce-page.mjs': PAGE('rebond', "    µRouter.to('/kidpage') if window.__rebond").replace('<p>rebond</p>', '<p>rebond</p>\n' + KID('rb')),
  'vitrine-page.mjs': L('<div class="bande" *marquee(unit: child, speed: 900s)>', '  <@kid who="mq"></@kid>', '</div>', '<style>', '.bande', '  width: 600px', '</style>'),
  'miroir-page.mjs': L('<script>', '  µmount ->', '    window.__miroir = -> µclone @@_shadow.querySelector(\'mjs-kid\'), mirror: true', '</script>', KID('orig')),
  'module-page.mjs': L('<script>', "  $comp = 'kid'", '  µmount ->', '    window.__choisir = (c) ->', '      $comp = c', '</script>', '<@module $comp who="mod"></@module>'),
  'modale-page.mjs': L('<script>', '  µmount ->', "    window.__ouvrir = -> µmodal.fire({ html: '<mjs-kid who=\"modale\"></mjs-kid>' })", '    window.__fermer = -> µmodal.close()', "    window.__k.push('modale-mount')", '</script>', '<p>modale</p>')
}

// page rendue par le serveur (`ssrMode: 'markers'`) : un enfant posé et les enfants d'un `{for}` ; au serveur, `window.__k` n'existe pas
const SUIVI_SSR = L('<script>', "  $who = '?'", "  µawake -> window.__k.push('awake:' + $who + " + HORS + ') if window.__k', "  µsleep -> window.__k.push('sleep:' + $who) if window.__k", "  µmount -> window.__k.push('mount:' + $who) if window.__k", "  µdestroy -> window.__k.push('destroy:' + $who) if window.__k", '</script>', '<b class="kid">{$who}</b>')
const SOURCES_SSR: Record<string, string> = {
  'kid-s.mjs': SUIVI_SSR,
  'ssr-page.mjs': L('<script>', "  $lignes = [{ id: 'l1' }, { id: 'l2' }]", "  µawake -> window.__k.push('page-awake') if window.__k", "  µmount -> window.__k.push('page-mount') if window.__k", "  µdestroy -> window.__k.push('page-destroy') if window.__k", '  rev = -> $lignes = $lignes.slice().reverse()', '</script>', '<p>serveur</p>', '<@kid-s who="s"></@kid-s>', '{for d in $lignes by id}<section><@kid-s who={d.id}></@kid-s></section>{end}', '<button class="rev" @click={rev()}>r</button>')
}

const constructions = new Map<Env, Promise<Construction>>()
let serveur: Promise<Serveur> | null = null

async function bati(env: Env): Promise<Construction> {
  const { Bundler }                         = await source('bundler/index.js')
  const { findConfig, resolveBundlerOpts } = await source('bundler/config.js')
  const root   = mjsTmp('cycle-differentiel-' + (TEMOIN ? 'temoin-' : '') + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, code] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), code)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out' }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/app') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body><mjs-app></mjs-app></body></html>')
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, server }
}

async function batiServeur(): Promise<Serveur> {
  const { createSSRRenderer, stripEsm } = await source('server/renderToString.js')
  const { Bundler }                     = await source('bundler/index.js')
  const root   = mjsTmp('cycle-differentiel-serveur' + (TEMOIN ? '-temoin' : ''))
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, code] of Object.entries(SOURCES_SSR)) writeFileSync(join(srcDir, nom), code)
  const rendu = async (opts: any) => {
    const renderer = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { runtime: ['hydrate'] }, ...opts } as any)
    try {
      const r = await renderer.renderToString('mjs-ssr-page', { ssrMode: 'markers' } as any)
      return `${r.html}\n${r.hydrateScript}`
    }
    finally { await renderer.close() }
  }
  const html     = await rendu({ outputDir: outDir })
  const lire     = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
  const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js') && f !== 'bundle.js')
  const noyau    = fichiers.filter((f) => /^mjs_core-/.test(f))
  const runtime  = fichiers.filter((f) => f.startsWith('mjs_') && !/^mjs_core-/.test(f)).sort()
  const code     = [lire(noyau[0]) + '\nglobalThis.µ = µ;', ...runtime.map(lire), ...fichiers.filter((f) => f.startsWith('kid-s')).map(lire), ...fichiers.filter((f) => f.startsWith('ssr-page')).map(lire)].join('\n')
  const prod     = await rendu({ env: 'prod' })
  const prodDir  = join(root, 'prod')
  const bundler  = new Bundler({ sourceDir: srcDir, outputDir: prodDir, manifestPath: join(prodDir, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'bundle', env: 'prod' } as any)
  const stats    = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const servis = new Map<string, Buffer>()
  for (const f of readdirSync(prodDir)) if (/\.(js|json)$/.test(f)) servis.set(f, readFileSync(join(prodDir, f)))
  return { dev: `${html}\n<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`, prod: `${prod}\n<script type="module" src="/out/bundle.js"></script>`, fichiers: servis }
}

// outils de la page, posés avant tout script : journal, attente, navigation, vue principale
const OUTILS = () => {
  const w = window as any
  w.__k     = []
  w.__abos  = 0
  w.__fuite = 0
  w.__jeu   = { state: { x: {} }, players: {}, on() { w.__abos++; let on = true; return () => { if (on) { on = false; w.__abos-- } } } }
  w.__pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  w.__attendre = async (pred: () => boolean) => {
    const t0 = Date.now()
    while (!pred()) {
      if (Date.now() - t0 > 10000) throw new Error('attente dépassée : ' + String(pred) + ' — journal ' + JSON.stringify(w.__k))
      await w.__pause(10)
    }
  }
  // le journal depuis la dernière prise, les tirs successifs d'un même `µevery` comptés pour un ; `serie` : une suite
  // d'entrées égales notée une fois, suivie de `×` (le nombre de copies d'une bande défilante suit la largeur de son contenu)
  w.__prends = (serie = false) => {
    const o = [] as string[]
    for (const x of w.__k.splice(0)) {
      const p = o[o.length - 1]
      if (x.startsWith('tick:') && p === x) continue
      if (serie && (p === x || p === x + '×')) { o[o.length - 1] = x + '×'; continue }
      o.push(x)
    }
    return o
  }
  w.__aller = async (h: string, attendu: string, serie = false) => {
    w.__prends()
    location.hash = h
    await w.__attendre(() => w.__k.includes(attendu))
    await w.__pause(200)
    return w.__prends(serie)
  }
  w.__vue = () => {
    const app = document.querySelector('mjs-app') as any
    return app._shadow.querySelector('metamjs-view#main') || app.querySelector('metamjs-view#main')
  }
  w.__kids = (h: any) => [...h._shadow.querySelectorAll('mjs-kid')].map((k: any) => (k._shadow ? k._shadow.textContent.trim() : '<vide>'))
}

// le `µawake` d'un parent retire l'enfant `tag` avant que sa connexion ne joue ; l'enfant reste dehors, puis il est remis ou non
const RETRAIT = async ([tag, remettre, entre]: [string, boolean, string]) => {
  const w      = window as any
  const essais = [document.createElement('mjs-retireur'), document.createElement(tag)]
  for (const e of essais) document.body.appendChild(e)
  await customElements.whenDefined('mjs-retireur')
  await customElements.whenDefined(tag)
  await w.__pause(100)
  for (const e of essais) e.remove()
  await w.__pause(200)
  w.__k       = []
  w.__retirer = true
  w.__fuite   = 0
  w.__abos    = 0
  const m        = document.createElement('mjs-retireur')
  const k        = document.createElement(tag) as any
  const abosCrea = w.__abos
  k.setAttribute(tag === 'mjs-kid-ref' ? 'who' : 'qui', 'k')
  k.setAttribute('data-retire', '')
  m.appendChild(k)
  document.body.appendChild(m)
  await w.__pause(250)
  const garde     = w.__orphelin === k && !k.isConnected
  const retire    = w.__prends()
  const abosDehors = w.__abos
  if (entre === 'inc') {
    const b = (document.querySelector('mjs-app') as any)._shadow.querySelector('.inc')
    b.click()
    b.click()
  }
  await w.__pause(300)
  const r: any = { garde, abosCrea, retire, abosDehors, fuite: w.__fuite > 0 }
  if (remettre) {
    document.body.appendChild(k)
    await w.__pause(300)
    r.remis     = w.__prends()
    r.abosRemis = w.__abos
    r.texte     = k._shadow ? k._shadow.textContent.trim() : null
    if (entre === 'inc') {
      (document.querySelector('mjs-app') as any)._shadow.querySelector('.inc').click()
      await w.__pause(100)
      r.texte2 = k._shadow.textContent.trim()
    }
  }
  return r
}

// écarts permis, chacun avec sa raison : les phases du journal qui changent, les autres égales à celles de la 3.1.0
const HORS_DOC      = (change: Record<string, any>): Ecart => ({ change, raison: 'connexion jouée hors du document (l\'élément retiré avant qu\'elle ne joue) : ni µawake, ni µurlChange, ni µsleep ; le reste du cycle comme en 3.1.0' })
const CACHE_DE_VUES = (change: Record<string, any>): Ecart => ({ change, raison: 'layout rendu par le cache : la page qui n\'est plus celle de l\'adresse quitte sa vue avant le retour du layout, sans réveil ni sommeil' })
const FUITE         = (change: Record<string, any>): Ecart => ({ change, raison: 'les pages gardées dans le cache de vues d\'un layout détruit partent avec lui (µdestroy) ; remis dans la page, il repart d\'un cache vide' })
// `ou310` : le journal de la 3.1.0 reste permis à côté de l'écart, l'un ou l'autre selon le code qui arrive le premier ; tout autre journal tombe
const PAGE_TARDIVE  = (change: Record<string, any>): Ecart => ({ change, ou310: true, raison: 'page posée par un renvoi depuis un µawake avant l\'arrivée de son code, puis mise à niveau sur place : ses enfants déjà définis démarrent avant elle (µawake puis µmount) ; quand leur code arrive après le sien, l\'ordre de la 3.1.0' })

const SCENARIOS: Scenario[] = [
  { nom: 'enfant retiré par le µawake de son parent avant son arrivée, remis plus tard (@this)', depart: '/o', pret: 'autre-mount', geste: RETRAIT, arg: ['mjs-kid-ref', true, ''], ecart: HORS_DOC({ retire: ['destroy:k'] }), v310: { garde: true, abosCrea: 0, retire: ['awake:k:HORS', 'sleep:k', 'destroy:k'], abosDehors: 0, fuite: false, remis: ['awake:k', 'mount:k:ref:rendu'], abosRemis: 0, texte: 'k', exceptions: [] } },
  { nom: 'enfant retiré avant son arrivée, avec µevery', depart: '/o', pret: 'autre-mount', geste: RETRAIT, arg: ['mjs-kid-ev', true, ''], ecart: HORS_DOC({ retire: ['destroy:k'] }), v310: { garde: true, abosCrea: 0, retire: ['awake:k:HORS', 'destroy:k'], abosDehors: 0, fuite: false, remis: ['awake:k', 'mount:k:ref:rendu', 'tick:k'], abosRemis: 0, texte: 'k', exceptions: [] } },
  { nom: 'enfant retiré avant son arrivée, µ.interp sans µmount', depart: '/o', pret: 'autre-mount', geste: RETRAIT, arg: ['mjs-kid-interp', true, ''], ecart: HORS_DOC({ retire: [] }), v310: { garde: true, abosCrea: 2, retire: ['awake:k:abos=2'], abosDehors: 0, fuite: false, remis: ['awake:k:abos=0'], abosRemis: 2, texte: 'k', exceptions: [] } },
  { nom: 'enfant retiré avant son arrivée, µ.interp avec µmount', depart: '/o', pret: 'autre-mount', geste: RETRAIT, arg: ['mjs-kid-interp-m', true, ''], ecart: HORS_DOC({ retire: [] }), v310: { garde: true, abosCrea: 2, retire: ['awake:k:abos=2'], abosDehors: 0, fuite: false, remis: ['awake:k:abos=0', 'mount:k:abos=0'], abosRemis: 2, texte: 'k', exceptions: [] } },
  { nom: 'enfant retiré avant son arrivée, jamais remis : sa minuterie coupée par µdestroy', depart: '/o', pret: 'autre-mount', geste: RETRAIT, arg: ['mjs-kid-timer', false, ''], v310: { garde: true, abosCrea: 0, retire: ['destroy:k'], abosDehors: 0, fuite: false, exceptions: [] } },
  { nom: 'enfant retiré avant son arrivée, magasin écrit pendant son absence', depart: '/o', pret: 'autre-mount', geste: RETRAIT, arg: ['mjs-kid-st', true, 'inc'], ecart: HORS_DOC({ retire: ['destroy:k'] }), v310: { garde: true, abosCrea: 0, retire: ['awake:k:0', 'destroy:k'], abosDehors: 0, fuite: false, remis: ['awake:k:2', 'mount:k:2'], abosRemis: 0, texte: '2', texte2: '3', exceptions: [] } },
  {
    nom: 'enfant déplacé par le µawake de son parent (détaché, ailleurs, retiré puis remis, fragment, jamais remis puis remis)', depart: '/move', pret: 'mount:pre', ecart: HORS_DOC({ detache: { j: ['destroy:detache', 'awake:detache', 'mount:detache'], apres: [], dans: true, texte: 'detache' }, 'retire-remet': { j: ['awake:retire-remet', 'mount:retire-remet'], apres: [], dans: true, texte: 'retire-remet' }, fragment: { j: ['destroy:fragment', 'awake:fragment', 'mount:fragment'], apres: [], dans: true, texte: 'fragment' }, jamais: { j: ['destroy:jamais'], apres: ['awake:jamais', 'mount:jamais'], dans: true, texte: 'jamais' } }), v310: { detache: { j: ['awake:detache:HORS', 'sleep:detache', 'destroy:detache', 'awake:detache', 'mount:detache'], apres: [], dans: true, texte: 'detache' }, ailleurs: { j: ['awake:ailleurs', 'sleep:ailleurs', 'awake:ailleurs', 'mount:ailleurs'], apres: [], dans: true, texte: 'ailleurs' }, 'retire-remet': { j: ['awake:retire-remet:HORS', 'sleep:retire-remet', 'awake:retire-remet', 'mount:retire-remet'], apres: [], dans: true, texte: 'retire-remet' }, fragment: { j: ['awake:fragment:HORS', 'sleep:fragment', 'destroy:fragment', 'awake:fragment', 'mount:fragment'], apres: [], dans: true, texte: 'fragment' }, jamais: { j: ['awake:jamais:HORS', 'sleep:jamais', 'destroy:jamais'], apres: ['awake:jamais', 'mount:jamais'], dans: true, texte: 'jamais' }, exceptions: [] },
    geste: async () => {
      const w = window as any
      const r: any = {}
      for (const mode of ['detache', 'ailleurs', 'retire-remet', 'fragment', 'jamais']) {
        w.__prends()
        w.__mode = mode
        const m = document.createElement('mjs-mover')
        const k = document.createElement('mjs-kid') as any
        k.setAttribute('who', mode)
        m.appendChild(k)
        document.body.appendChild(m)
        await w.__pause(300)
        const j = w.__prends()
        if (mode === 'jamais') { document.body.appendChild(w.__orphelin); await w.__pause(300) }
        r[mode] = { j, apres: w.__prends(), dans: k.isConnected, texte: k._shadow ? k._shadow.textContent.trim() : null }
      }
      return r
    }
  },
  {
    nom: '{for} réordonné, ligne ajoutée, rotation', depart: '/liste', pret: 'mount:c', v310: { depart: ['a', 'b', 'c'], rev: { kids: ['c', 'b', 'a'], j: ['sleep:c', 'awake:c', 'sleep:a', 'awake:a'] }, add: { kids: ['z', 'c', 'b', 'a'], j: ['awake:z', 'mount:z'] }, rot: { kids: ['c', 'b', 'a', 'z'], j: ['sleep:z', 'awake:z'] }, exceptions: [] },
    geste: async () => {
      const w = window as any
      const p = w.__vue().firstElementChild
      const r: any = { depart: w.__kids(p) }
      for (const b of ['rev', 'add', 'rot']) {
        w.__prends()
        p._shadow.querySelector('.' + b).click()
        await w.__pause(250)
        r[b] = { kids: w.__kids(p), j: w.__prends() }
      }
      return r
    }
  },
  {
    nom: 'page gardée avec un enfant : sortie, retour, Précédent, Suivant', depart: '/kidpage', pret: 'mount:enfant', v310: { depart: ['hote-awake', 'hote-mount', 'awake:enfant', 'mount:enfant'], sortie: ['hote-sleep', 'sleep:enfant', 'humeur-awake', 'humeur-mount'], retour: ['humeur-sleep', 'hote-awake', 'awake:enfant'], precedent: ['hote-sleep', 'sleep:enfant', 'humeur-awake'], suivant: ['humeur-sleep', 'hote-awake', 'awake:enfant'], kids: ['enfant'], exceptions: [] },
    geste: async () => {
      const w = window as any
      const r: any = { depart: w.__prends() }
      r.sortie = await w.__aller('#/mood', 'humeur-awake')
      r.retour = await w.__aller('#/kidpage', 'hote-awake')
      history.back()
      await w.__attendre(() => w.__k.includes('humeur-awake'))
      await w.__pause(200)
      r.precedent = w.__prends()
      history.forward()
      await w.__attendre(() => w.__k.includes('hote-awake'))
      await w.__pause(200)
      r.suivant = w.__prends()
      r.kids    = w.__kids(w.__vue().firstElementChild)
      return r
    }
  },
  {
    nom: 'page qui renvoie ailleurs depuis son µawake, avec un enfant, puis revue sans renvoi', depart: '/mood', pret: 'humeur-mount', ecart: PAGE_TARDIVE({ rebond: ['humeur-sleep', 'rebond-awake', 'rebond-sleep', 'awake:enfant', 'hote-awake', 'mount:enfant', 'hote-mount'] }), v310: { depart: ['humeur-awake', 'humeur-mount'], rebond: ['humeur-sleep', 'rebond-awake', 'rebond-sleep', 'hote-awake', 'hote-mount', 'awake:enfant', 'mount:enfant'], humeur: ['hote-sleep', 'sleep:enfant', 'humeur-awake'], revue: ['humeur-sleep', 'rebond-awake', 'awake:rb', 'rebond-mount', 'mount:rb'], kids: ['rb'], exceptions: [] },
    geste: async () => {
      const w = window as any
      w.__rebond = true
      const r: any = { depart: w.__prends() }
      r.rebond = await w.__aller('#/bounce', 'hote-awake')
      w.__rebond = false
      r.humeur = await w.__aller('#/mood', 'humeur-awake')
      r.revue  = await w.__aller('#/bounce', 'rebond-awake')
      r.kids   = w.__kids(w.__vue().firstElementChild)
      return r
    }
  },
  {
    nom: 'garde du layout : réunion, autre layout, déconnexion, retour à la réunion (renvoyé au profil), reconnexion, autre réunion', depart: '/meeting/keep/abc', pret: 'mount:r', ecart: HORS_DOC({ garde: ['humeur-sleep', 'profil-awake', 'profil-mount'] }), v310: { depart: ['reunion-awake:abc', 'reunion-mount', 'awake:r', 'mount:r'], humeur: ['reunion-sleep', 'sleep:r', 'humeur-awake', 'humeur-mount'], garde: ['humeur-sleep', 'reunion-awake:undefined:HORS', 'reunion-sleep', 'awake:r:HORS', 'sleep:r', 'profil-awake', 'profil-mount'], adresse: '#/profile/assistant', autre: ['profil-sleep', 'reunion-awake:xyz', 'awake:r'], exceptions: [] },
    geste: async () => {
      const w = window as any
      const r: any = { depart: w.__prends() }
      r.humeur = await w.__aller('#/mood', 'humeur-awake')
      w.__deconnecte = true
      r.garde = await w.__aller('#/meeting/keep/abc', 'profil-awake')
      r.adresse = location.hash
      w.__deconnecte = false
      r.autre = await w.__aller('#/meeting/keep/xyz', 'reunion-awake:xyz')
      return r
    }
  },
  {
    nom: 'page sans paramètre gardée, garde refusant ensuite', depart: '/profile/secret', pret: 'secret-mount', ecart: HORS_DOC({ refus: ['humeur-sleep', 'profil-awake', 'profil-mount'] }), v310: { depart: ['secret-awake', 'secret-mount'], humeur: ['secret-sleep', 'humeur-awake', 'humeur-mount'], refus: ['humeur-sleep', 'secret-awake:HORS', 'secret-sleep', 'profil-awake', 'profil-mount'], adresse: '#/profile/assistant', accepte: ['profil-sleep', 'secret-awake'], exceptions: [] },
    geste: async () => {
      const w = window as any
      const r: any = { depart: w.__prends() }
      r.humeur = await w.__aller('#/mood', 'humeur-awake')
      w.__refuse = true
      r.refus = await w.__aller('#/profile/secret', 'profil-awake')
      r.adresse = location.hash
      w.__refuse = false
      r.accepte = await w.__aller('#/profile/secret', 'secret-awake')
      return r
    }
  },
  {
    nom: 'layout rendu par le cache pour une autre de ses pages : réunion, autre layout, profil, autre réunion', depart: '/meeting/keep/abc', pret: 'mount:r', ecart: CACHE_DE_VUES({ profil: ['humeur-sleep', 'profil-awake', 'profil-mount'], reunion: ['humeur-sleep', 'reunion-awake:def', 'awake:r'] }), v310: { depart: ['reunion-awake:abc', 'reunion-mount', 'awake:r', 'mount:r'], humeur: ['reunion-sleep', 'sleep:r', 'humeur-awake', 'humeur-mount'], profil: ['humeur-sleep', 'reunion-awake:undefined:HORS', 'reunion-sleep', 'awake:r:HORS', 'sleep:r', 'profil-awake', 'profil-mount'], humeur2: ['profil-sleep', 'humeur-awake'], reunion: ['humeur-sleep', 'profil-awake:HORS', 'profil-sleep', 'reunion-awake:def', 'awake:r'], exceptions: [] },
    geste: async () => {
      const w = window as any
      const r: any = { depart: w.__prends() }
      r.humeur  = await w.__aller('#/mood', 'humeur-awake')
      r.profil  = await w.__aller('#/profile/assistant', 'profil-awake')
      r.humeur2 = await w.__aller('#/mood', 'humeur-awake')
      r.reunion = await w.__aller('#/meeting/keep/def', 'reunion-awake:def')
      return r
    }
  },
  {
    nom: 'layout évincé du cache de la page pendant qu\'il hiberne, avec une page dans son propre cache', depart: '/meeting/keep/abc', pret: 'mount:r', ecart: FUITE({ detruits: ['profil-destroy', 'reunion-destroy', 'destroy:r'] }), v310: { depart: ['reunion-awake:abc', 'reunion-mount', 'awake:r', 'mount:r'], profil: ['reunion-sleep', 'sleep:r', 'profil-awake', 'profil-mount'], detruits: ['profil-destroy'], exceptions: [] },
    geste: async () => {
      const w = window as any
      const r: any = { depart: w.__prends() }
      r.profil = await w.__aller('#/profile/assistant', 'profil-awake')
      const j = [] as string[]
      for (let i = 1; i <= 10; i++) j.push(...await w.__aller('#/n/' + i, 'n' + i + '-awake'))
      r.detruits = j.filter((x: string) => x.endsWith('-destroy') || x.startsWith('destroy:'))
      return r
    }
  },
  {
    nom: 'layout retiré à la main (2 pages, une en cache), remis, nouvelle page, retiré de nouveau', depart: '/l/a', pret: 'la-mount', ecart: FUITE({ retrait1: ['lb-sleep', 'lb-destroy', 'la-destroy'], versA: ['lb-sleep', 'la-awake', 'lb-destroy', 'la-mount'], versB2: ['la-sleep', 'lb-awake', 'lb-mount'], retrait2: ['lb-sleep', 'lb-destroy', 'la-destroy'], versA2: ['lb-sleep', 'la-awake', 'lb-destroy', 'la-mount'] }), v310: { depart: ['la-awake', 'la-mount'], versB: ['la-sleep', 'lb-awake', 'lb-mount'], lay: 'mjs-lay-layout', retrait1: ['lb-sleep', 'lb-destroy'], remise1: ['lb-awake', 'lb-mount'], versA: ['lb-sleep', 'la-awake'], versB2: ['la-sleep', 'lb-awake'], retrait2: ['lb-sleep', 'lb-destroy'], remise2: ['lb-awake', 'lb-mount'], versA2: ['lb-sleep', 'la-awake'], exceptions: [] },
    geste: async () => {
      const w = window as any
      const r: any = { depart: w.__prends() }
      r.versB = await w.__aller('#/l/b', 'lb-awake')
      const view = w.__vue()
      const lay  = view.firstElementChild
      r.lay = lay && lay.localName
      lay.remove()
      await w.__pause(200)
      r.retrait1 = w.__prends()
      view.appendChild(lay)
      await w.__pause(300)
      r.remise1 = w.__prends()
      r.versA = await w.__aller('#/l/a', 'la-awake')
      r.versB2 = await w.__aller('#/l/b', 'lb-awake')
      lay.remove()
      await w.__pause(200)
      r.retrait2 = w.__prends()
      view.appendChild(lay)
      await w.__pause(300)
      r.remise2 = w.__prends()
      r.versA2 = await w.__aller('#/l/a', 'la-awake')
      return r
    }
  },
  {
    nom: 'layout dans un {if} qui se referme (une page en cache, une affichée)', depart: '/if/a', pret: 'ia-mount', ecart: FUITE({ fermeture: ['ib-sleep', 'ib-destroy', 'ia-destroy'] }), v310: { depart: ['ia-awake', 'ia-mount'], versB: ['ia-sleep', 'ib-awake', 'ib-mount'], fermeture: ['ib-sleep', 'ib-destroy'], exceptions: [] },
    geste: async () => {
      const w = window as any
      const r: any = { depart: w.__prends() }
      r.versB = await w.__aller('#/if/b', 'ib-awake')
      const hote = w.__vue().firstElementChild
      hote._shadow.querySelector('.bascule').click()
      await w.__pause(300)
      r.fermeture = w.__prends()
      return r
    }
  },
  {
    nom: 'page qui renvoie ailleurs depuis son µawake, puis revue (enfant µevery + µmount + @this)', depart: '/o', pret: 'autre-mount', v310: { depart: ['autre-awake', 'autre-mount'], rebond: ['autre-sleep', 'garde-awake', 'garde-sleep', 'autre-awake'], adresse: '#/o', retour: ['autre-sleep', 'garde-awake', 'awake:g', 'garde-mount', 'mount:g:ref:rendu', 'tick:g'], exceptions: [] },
    geste: async () => {
      const w = window as any
      w.__rebond = true
      const r: any = { depart: w.__prends() }
      r.rebond = await w.__aller('#/garde', 'autre-awake')
      r.adresse = location.hash
      r.retour = await w.__aller('#/garde', 'garde-awake')
      return r
    }
  },
  {
    nom: '*marquee : copies d\'un composant, sortie de la page, retour', depart: '/vitrine', pret: 'mount:mq', v310: { depart: ['awake:mq', 'mount:mq', 'awake:mq×', 'mount:mq×'], sortie: ['sleep:mq×', 'autre-awake', 'destroy:mq×', 'autre-mount'], retour: ['autre-sleep', 'awake:mq', 'sleep:mq', 'awake:mq×', 'mount:mq×'], exceptions: [] },
    geste: async () => {
      const w = window as any
      await w.__pause(300)
      const r: any = { depart: w.__prends(true) }
      r.sortie = await w.__aller('#/o', 'autre-awake', true)
      r.retour = await w.__aller('#/vitrine', 'awake:mq', true)
      return r
    }
  },
  {
    nom: 'miroir vivant (µclone mirror: true) posé puis retiré', depart: '/miroir', pret: 'mount:orig', v310: { depart: ['awake:orig', 'mount:orig'], pose: ['awake:orig', 'mount:orig'], retire: ['sleep:orig', 'destroy:orig'], exceptions: [] },
    geste: async () => {
      const w = window as any
      const r: any = { depart: w.__prends() }
      const m = w.__miroir()
      document.body.appendChild(m)
      await w.__pause(300)
      r.pose = w.__prends()
      m.remove()
      await w.__pause(300)
      r.retire = w.__prends()
      return r
    }
  },
  {
    nom: '<@module> : composant chargé à la demande, puis remplacé, puis rendu', depart: '/module', pret: 'mount:mod', v310: { depart: ['awake:mod', 'mount:mod'], remplace: ['sleep:mod', 'destroy:mod', 'b-awake:mod', 'b-mount:mod'], rendu: ['b-sleep:mod', 'awake:mod', 'mount:mod', 'b-destroy:mod'], exceptions: [] },
    geste: async () => {
      const w = window as any
      const r: any = { depart: w.__prends() }
      w.__choisir('kid-b')
      await w.__attendre(() => w.__k.includes('b-mount:mod'))
      await w.__pause(200)
      r.remplace = w.__prends()
      w.__choisir('kid')
      await w.__attendre(() => w.__k.includes('mount:mod'))
      await w.__pause(200)
      r.rendu = w.__prends()
      return r
    }
  },
  {
    nom: 'modale : composant dans le html d\'une modale, ouverte puis fermée', depart: '/modale', pret: 'modale-mount', v310: { depart: ['modale-mount'], ouverte: ['awake:modale', 'mount:modale'], fermee: ['sleep:modale', 'destroy:modale'], exceptions: [] },
    geste: async () => {
      const w = window as any
      const r: any = { depart: w.__prends() }
      w.__ouvrir()
      await w.__pause(400)
      r.ouverte = w.__prends()
      w.__fermer()
      await w.__pause(600)
      r.fermee = w.__prends()
      return r
    }
  }
]

// journal du rendu serveur : la page reprise (hydratation), une ligne déplacée, la page retirée
const LIT_SERVEUR = async () => {
  const w = window as any
  await w.__attendre(() => w.__k.includes('page-mount'))
  await w.__pause(200)
  const r: any = { reprise: w.__prends() }
  const p = document.querySelector('mjs-ssr-page') as any
  p._shadow.querySelector('.rev').click()
  await w.__pause(250)
  r.deplace = w.__prends()
  p.remove()
  await w.__pause(250)
  r.retire = w.__prends()
  return r
}
const V310_SERVEUR = { reprise: ['awake:s', 'awake:?', 'awake:?', 'page-awake', 'mount:s', 'mount:?', 'mount:?', 'page-mount'], deplace: ['sleep:l2', 'awake:l2'], retire: ['sleep:s', 'sleep:l2', 'sleep:l1', 'page-destroy', 'destroy:s', 'destroy:l2', 'destroy:l1'], exceptions: [] }

const ECART_SERVEUR: Ecart = { change: { reprise: ['awake:s', 'page-awake', 'mount:s', 'awake:l1', 'awake:l2', 'page-mount', 'mount:l1', 'mount:l2'] }, raison: 'rendu serveur : l\'enfant d\'une ligne de {for} reprise se connecte une fois sa ligne reprise, avec les props de sa ligne' }

function compare(nom: string, r: any, v310: any, ecart: Ecart | undefined, contexte: string): void {
  if (RELEVE) { console.log('RELEVE ' + JSON.stringify({ nom, contexte, r })); return }
  if (TEMOIN || !ecart) assert.deepEqual(r, v310, `${contexte} : ${TEMOIN ? 'le journal recopié n\'est pas celui de cette 3.1.0' : 'journal différent de celui de la 3.1.0'}`)
  // écart qui garde aussi le journal de la 3.1.0 : celui-ci passe tel quel, tout autre est comparé à l'écart
  else if (ecart.ou310 && isDeepStrictEqual(r, v310)) return
  else assert.deepEqual(r, { ...v310, ...ecart.change }, `${contexte} : écart permis${ecart.ou310 ? ' (ou le journal de la 3.1.0)' : ''} — ${ecart.raison}`)
}

describe('cycle de vie — chaque scénario donne le journal de la 3.1.0, aux écarts écrits près (vrais navigateurs, développement et production)', function () {
  for (const env of ['dev', 'prod'] as const) {
    for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
      describe(`build ${env} — ${nom}`, function () {
        this.timeout(180000)
        let browser: any = null
        let c: Construction

        before(async function () {
          if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté. Activer : \`npx playwright install ${nom}\``); this.skip() }
          if (!constructions.has(env)) constructions.set(env, bati(env))
          c       = await constructions.get(env)!
          browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        })

        after(async function () {
          if (browser) await browser.close()
        })

        for (const s of SCENARIOS) {
          it(s.nom, async () => {
            const contexte   = await browser.newContext()
            const exceptions = [] as string[]
            try {
              const page = await contexte.newPage()
              page.on('pageerror', (e: any) => exceptions.push(String(e)))
              await page.addInitScript('window.__name = (f) => f')
              await page.addInitScript(OUTILS)
              await page.goto(c.base + '/app#' + s.depart)
              await page.waitForFunction((a: string) => (window as any).__k.includes(a), s.pret, { timeout: 15000 })
              await page.waitForTimeout(200)
              const r = await page.evaluate(s.geste, s.arg)
              compare(s.nom, { ...r, exceptions }, s.v310, s.ecart, `${s.nom} (${env}, ${nom})`)
            }
            finally { await contexte.close() }
          })
        }

        it('rendu serveur markers : la page reprise, une ligne déplacée, la page retirée', async () => {
          const srv        = await (serveur ??= batiServeur())
          const contexte   = await browser.newContext()
          const exceptions = [] as string[]
          try {
            const page = await contexte.newPage()
            page.on('pageerror', (e: any) => exceptions.push(String(e)))
            await page.addInitScript('window.__name = (f) => f')
            await page.addInitScript(OUTILS)
            await page.route('http://cycle.test/**', (route: any) => {
              const chemin = new URL(route.request().url()).pathname
              if (!chemin.startsWith('/out/')) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${env === 'dev' ? srv.dev : srv.prod}</body></html>` })
              const corps = srv.fichiers.get(chemin.slice(5))
              if (!corps) return route.fulfill({ status: 404, body: '' })
              return route.fulfill({ contentType: chemin.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
            })
            await page.goto('http://cycle.test/', { waitUntil: 'load' })
            const r = await page.evaluate(LIT_SERVEUR)
            compare('rendu serveur markers', { ...r, exceptions }, V310_SERVEUR, ECART_SERVEUR, `rendu serveur markers (${env}, ${nom})`)
          }
          finally { await contexte.close() }
        })
      })
    }
  }

  after(async function () {
    for (const k of constructions.values()) {
      const s = await k
      s.server.closeAllConnections()
      await new Promise(resolve => s.server.close(() => resolve(null)))
    }
    constructions.clear()
    const { terminateSharedWorkerPool } = await source('bundler/index.js')
    await terminateSharedWorkerPool?.()
  })
})
