// L'envoi d'un formulaire de composant reste pris par la navigation de MJS (le gestionnaire `@submit` du composant, puis
// l'envoi, sans recharger la page) même quand un écouteur NATIF de la page coupe l'événement `submit` :
// `stopPropagation()` en remontée ou posé en capture, `stopImmediatePropagation()`, sur le formulaire lui-même, sur un
// conteneur ou sur le document. L'écouteur de remontée de la navigation ne joue alors jamais, et le navigateur envoyait
// le formulaire lui-même : la page rechargée. Défaut garanti absent, composant à ombre comme composant léger, pour un
// clic sur le bouton d'envoi, la touche Entrée dans un champ et `requestSubmit()`, avec et sans `@confirm` (une seule
// question), et un seul envoi à chaque fois.
// Gardes : l'écouteur de l'auteur qui appelle aussi `preventDefault()` (avant ou après sa coupure, dans le même écouteur
// ou dans un autre) garde le formulaire à l'auteur ; un `@submit.prevent` du composant reste un `@submit.prevent` ; un
// `@confirm` refusé n'envoie rien ; un formulaire de la page, hors composant, reste au navigateur ; `@submit.stop` du
// composant n'envoie qu'une fois.
// Chromium et Firefox, vrai clic de souris et vraies touches (Playwright) : c'est le navigateur qui recharge, ou non.
// Limites mesurées, épinglées par les cas dont l'attendu est « navigateur » (`limites`) : une coupure que la surveillance
// ne voit qu'à la microtâche qui suit l'écouteur de l'auteur (`stopImmediatePropagation()`, ou une coupure posée au
// niveau du document) arrive trop tard quand l'envoi vient d'un script (`requestSubmit()`, `bouton.click()` : le
// navigateur a déjà planifié son envoi, il recharge la page) et, sous Firefox, quand il vient de la touche Entrée. Un
// vrai clic sur le bouton, et la touche Entrée sous Chromium, sont repris ; un `stopPropagation()` posé sur un nœud
// surveillé (le formulaire, un conteneur), en remontée ou en capture, l'est dans tous les cas.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// le gestionnaire du composant note son passage dans `__ordre`, comme l'écouteur de `mjs:before-visit` y note l'envoi
const GESTIONNAIRE = '@submit={window.__ordre.push(\'gestionnaire\')}'

const SOURCES: Record<string, string> = {
  'envoi-coupe.mjs': [
    '<form class="f" action="/envoi" method="post" ' + GESTIONNAIRE + '><input class="champ" name="q" value="a"><button class="bouton" type="submit">envoyer</button></form>',
    '<div class="boite"><form class="f2" action="/envoi" method="post"><input class="champ2" name="q" value="b"><button class="bouton2" type="submit">envoyer</button></form></div>',
    '<form class="conf" action="/envoi" method="post" ' + GESTIONNAIRE + '><input class="champc" name="q" value="c"><button class="boutonc" type="submit" @confirm="Envoyer ?">envoyer</button></form>',
    '<form class="confform" action="/envoi" method="post" @confirm="Envoyer ?" ' + GESTIONNAIRE + '><input class="champf" name="q" value="d"></form>',
    '<form class="prev" action="/envoi" method="post" @submit.prevent={window.__ordre.push(\'gestionnaire\')}><input class="champp" name="q" value="e"><button class="boutonp" type="submit">envoyer</button></form>',
    '<form class="stop" action="/envoi" method="post" @submit.stop={window.__ordre.push(\'gestionnaire\')}><input class="champs" name="q" value="g"><button class="boutons" type="submit">envoyer</button></form>'
  ].join('\n') + '\n'
}

type Mode        = 'ombre' | 'léger'
type Navigateur  = 'chromium' | 'firefox'
type Geste       = 'bouton' | 'entree' | 'requestSubmit' | 'requestSubmit(bouton)' | 'clic()'
// `pris` : l'envoi part par la navigation de MJS ; `garde` : il reste à l'auteur (ni envoi ni rechargement) ;
// `navigateur` : le navigateur envoie lui-même, la page est rechargée (limite mesurée)
type Attendu     = 'pris' | 'garde' | 'navigateur'
// ce qu'un geste donne de différent de `attendu`, navigateur par navigateur (les limites mesurées)
type Limites     = Partial<Record<Geste, Partial<Record<Navigateur, Attendu>>>>

type Scenario = {
  nom:           string
  pose:          string
  forme:         string
  attendu:       Attendu
  gestes?:       Geste[]
  modes?:        Mode[]
  navigateurs?:  Navigateur[]
  limites?:      Limites
  reponse?:      boolean
  questions?:    number
  joues?:        number
}

type Forme = { form: string, champ: string, bouton: string | null, gestionnaire: boolean }

const FORMES: Record<string, Forme> = {
  f:        { form: '.f',        champ: '.champ',  bouton: '.bouton',  gestionnaire: true },
  f2:       { form: '.f2',       champ: '.champ2', bouton: '.bouton2', gestionnaire: false },
  conf:     { form: '.conf',     champ: '.champc', bouton: '.boutonc', gestionnaire: true },
  confform: { form: '.confform', champ: '.champf', bouton: null,       gestionnaire: true },
  prev:     { form: '.prev',     champ: '.champp', bouton: '.boutonp', gestionnaire: true },
  stop:     { form: '.stop',     champ: '.champs', bouton: '.boutons', gestionnaire: true }
}

// l'écouteur de l'auteur compte ses passages (`__joues`) : sans cela, « l'envoi n'est pas pris » pourrait être vrai
// parce que l'écouteur n'a jamais joué
const JOUE  = 'window.__joues = (window.__joues || 0) + 1'
const poser = (cible: string, corps: string, capture = false) => `${cible}.addEventListener('submit', (e) => { ${corps} }, ${capture})`

const TOUS: Geste[] = ['bouton', 'entree', 'requestSubmit']

// une coupure que la surveillance ne voit qu'à la microtâche qui suit l'écouteur de l'auteur (`stopImmediatePropagation()`,
// ou une coupure posée sur un nœud qu'elle ne surveille pas : le document) : la microtâche arrive trop tard quand
// l'envoi vient d'un script (`requestSubmit()`, `bouton.click()` : le navigateur a déjà planifié son envoi) et, sous
// Firefox, quand il vient de la touche Entrée (l'envoi est lancé DANS le traitement de la touche) ; un vrai clic sur le
// bouton, lui, est repris
const PAR_MICROTACHE: Limites = {
  'entree':                { firefox: 'navigateur' },
  'requestSubmit':         { chromium: 'navigateur', firefox: 'navigateur' },
  'requestSubmit(bouton)': { chromium: 'navigateur', firefox: 'navigateur' },
  'clic()':                { chromium: 'navigateur', firefox: 'navigateur' }
}

const SCENARIOS: Scenario[] = [
  { nom: 'témoin sans écouteur de la page', pose: '', forme: 'f', attendu: 'pris', gestes: [...TOUS, 'clic()'] },

  { nom: 'stopImmediatePropagation() sur le formulaire lui-même', pose: poser("N('.f')", JOUE + '; e.stopImmediatePropagation()'), forme: 'f', attendu: 'pris', gestes: [...TOUS, 'clic()'], limites: PAR_MICROTACHE },
  { nom: 'stopPropagation() sur le formulaire lui-même (remontée)', pose: poser("N('.f')", JOUE + '; e.stopPropagation()'), forme: 'f', attendu: 'pris', gestes: [...TOUS, 'clic()'] },
  { nom: 'stopPropagation() posé en capture sur le formulaire', pose: poser("N('.f')", JOUE + '; e.stopPropagation()', true), forme: 'f', attendu: 'pris', gestes: [...TOUS, 'clic()'] },
  { nom: 'stopImmediatePropagation() posé en capture sur le formulaire', pose: poser("N('.f')", JOUE + '; e.stopImmediatePropagation()', true), forme: 'f', attendu: 'pris', gestes: TOUS, limites: PAR_MICROTACHE },

  { nom: 'stopImmediatePropagation() sur un conteneur du formulaire', pose: poser("N('.boite')", JOUE + '; e.stopImmediatePropagation()'), forme: 'f2', attendu: 'pris', gestes: TOUS, limites: PAR_MICROTACHE },
  { nom: 'stopPropagation() sur un conteneur du formulaire (remontée)', pose: poser("N('.boite')", JOUE + '; e.stopPropagation()'), forme: 'f2', attendu: 'pris', gestes: TOUS },
  { nom: 'stopPropagation() posé en capture sur un conteneur du formulaire', pose: poser("N('.boite')", JOUE + '; e.stopPropagation()', true), forme: 'f2', attendu: 'pris', gestes: TOUS },
  { nom: 'stopImmediatePropagation() posé en capture sur un conteneur du formulaire', pose: poser("N('.boite')", JOUE + '; e.stopImmediatePropagation()', true), forme: 'f2', attendu: 'pris', gestes: TOUS, limites: PAR_MICROTACHE },

  { nom: 'stopPropagation() posé en capture sur le document', pose: poser('document', JOUE + '; e.stopPropagation()', true), forme: 'f2', attendu: 'pris', gestes: TOUS, limites: PAR_MICROTACHE, modes: ['léger'] },
  { nom: 'stopImmediatePropagation() posé en capture sur le document', pose: poser('document', JOUE + '; e.stopImmediatePropagation()', true), forme: 'f2', attendu: 'pris', gestes: TOUS, limites: PAR_MICROTACHE, modes: ['léger'] },
  { nom: 'stopImmediatePropagation() posé en remontée sur le document : déjà pris avant, un seul envoi', pose: poser('document', JOUE + '; e.stopImmediatePropagation()'), forme: 'f2', attendu: 'pris', gestes: TOUS, modes: ['léger'] },

  { nom: '@confirm sur le bouton d\'envoi, stopImmediatePropagation() sur le formulaire : une seule question, envoi pris', pose: poser("N('.conf')", JOUE + '; e.stopImmediatePropagation()'), forme: 'conf', attendu: 'pris', gestes: ['bouton', 'entree', 'requestSubmit(bouton)'], limites: PAR_MICROTACHE, questions: 1 },
  { nom: '@confirm sur le bouton d\'envoi, stopPropagation() posé en capture sur le formulaire : une seule question, envoi pris', pose: poser("N('.conf')", JOUE + '; e.stopPropagation()', true), forme: 'conf', attendu: 'pris', gestes: ['bouton', 'entree', 'requestSubmit(bouton)', 'clic()'], questions: 1 },
  { nom: '@confirm sur le formulaire, stopImmediatePropagation() sur le formulaire : une seule question, envoi pris', pose: poser("N('.confform')", JOUE + '; e.stopImmediatePropagation()'), forme: 'confform', attendu: 'pris', gestes: ['entree', 'requestSubmit'], limites: PAR_MICROTACHE, questions: 1 },
  { nom: '@confirm sur le formulaire, stopPropagation() posé en capture sur le formulaire : une seule question, envoi pris', pose: poser("N('.confform')", JOUE + '; e.stopPropagation()', true), forme: 'confform', attendu: 'pris', gestes: ['entree', 'requestSubmit'], questions: 1 },
  { nom: '@confirm refusé, stopImmediatePropagation() sur le formulaire : une question, rien ne part', pose: poser("N('.conf')", JOUE + '; e.stopImmediatePropagation()'), forme: 'conf', attendu: 'garde', gestes: ['bouton', 'entree'], reponse: false, questions: 1, joues: 0 },

  { nom: '@submit.prevent du composant, sans écouteur de la page : le formulaire reste au composant', pose: '', forme: 'prev', attendu: 'garde', gestes: TOUS },
  { nom: '@submit.prevent du composant, stopImmediatePropagation() sur le formulaire : le formulaire reste au composant', pose: poser("N('.prev')", JOUE + '; e.stopImmediatePropagation()'), forme: 'prev', attendu: 'garde', gestes: ['bouton', 'entree'] },
  { nom: '@submit.prevent du composant, stopPropagation() posé en capture sur le formulaire : le formulaire reste au composant', pose: poser("N('.prev')", JOUE + '; e.stopPropagation()', true), forme: 'prev', attendu: 'garde', gestes: ['bouton', 'entree'] },
  { nom: '@submit.stop du composant : le gestionnaire coupe, un seul envoi', pose: '', forme: 'stop', attendu: 'pris', gestes: TOUS },

  { nom: 'stopImmediatePropagation() puis preventDefault() dans le même écouteur : le formulaire reste à l\'auteur', pose: poser("N('.f')", 'e.stopImmediatePropagation(); e.preventDefault(); ' + JOUE), forme: 'f', attendu: 'garde', gestes: TOUS },
  { nom: 'preventDefault() puis stopImmediatePropagation() dans le même écouteur : le formulaire reste à l\'auteur', pose: poser("N('.f')", 'e.preventDefault(); e.stopImmediatePropagation(); ' + JOUE), forme: 'f', attendu: 'garde', gestes: ['bouton', 'entree'] },
  { nom: 'stopPropagation() posé en capture puis preventDefault() dans le même écouteur : le formulaire reste à l\'auteur', pose: poser("N('.f')", 'e.stopPropagation(); e.preventDefault(); ' + JOUE, true), forme: 'f', attendu: 'garde', gestes: ['bouton', 'entree'] },
  { nom: 'preventDefault() puis stopPropagation() posé en capture dans le même écouteur : le formulaire reste à l\'auteur', pose: poser("N('.f')", 'e.preventDefault(); e.stopPropagation(); ' + JOUE, true), forme: 'f', attendu: 'garde', gestes: ['bouton'] },
  { nom: 'stopImmediatePropagation() posé en capture puis preventDefault() dans le même écouteur : le formulaire reste à l\'auteur', pose: poser("N('.f')", 'e.stopImmediatePropagation(); e.preventDefault(); ' + JOUE, true), forme: 'f', attendu: 'garde', gestes: ['bouton'] },
  { nom: 'stopPropagation() en remontée dans un écouteur, preventDefault() dans un autre écouteur du même formulaire : le formulaire reste à l\'auteur', pose: poser("N('.f')", 'e.stopPropagation()') + '; ' + poser("N('.f')", 'e.preventDefault(); ' + JOUE), forme: 'f', attendu: 'garde', gestes: ['bouton', 'entree'] },
  { nom: 'stopPropagation() posé en capture dans un écouteur, preventDefault() dans un autre écouteur du même conteneur : le formulaire reste à l\'auteur', pose: poser("N('.boite')", 'e.stopPropagation()', true) + '; ' + poser("N('.boite')", 'e.preventDefault(); ' + JOUE, true), forme: 'f2', attendu: 'garde', gestes: ['bouton', 'entree'] },
  { nom: 'preventDefault() puis stopPropagation() en remontée sur le conteneur du formulaire : le formulaire reste à l\'auteur', pose: poser("N('.boite')", 'e.preventDefault(); e.stopPropagation(); ' + JOUE), forme: 'f2', attendu: 'garde', gestes: ['bouton', 'entree'] }
]

for (const nomNavigateur of ['chromium', 'firefox'] as const) {
  describe('envoi d\'un formulaire pris par la navigation malgré une coupure native de `submit` (' + nomNavigateur + ' réel)', function () {
    this.timeout(180000)
    let present = false
    let script  = ''
    let navigateur: any

    before(async function () {
      present = await navigateurPresent(nomNavigateur)
      if (!present) {
        console.log('  ℹ️  ' + nomNavigateur + ' non installé, test des coupures de l\'envoi sauté. Activer : `npx playwright install ' + nomNavigateur + '`')
        return
      }
      const root   = mjsTmp('formulaire-coupure')
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
      script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      const playwright = await import('playwright')
      navigateur = await playwright[nomNavigateur].launch()
    })

    after(async () => {
      if (navigateur) await navigateur.close()
      await terminateSharedWorkerPool()
    })

    // une page avec un formulaire hors composant et UN composant (à ombre, ou léger : `mjs-light`) ; `chargements`
    // compte les chargements natifs de la page (le premier est la page elle-même, un envoi natif en ajoute un),
    // `envois` les envois de la navigation de MJS (requêtes POST qui ne sont pas des chargements)
    async function ouvrir(mode: Mode, reponse = true) {
      const page = await navigateur.newPage()
      const chargements: string[] = []
      const envois: string[]      = []
      page.on('request', (r: any) => {
        if (r.isNavigationRequest()) chargements.push(r.method() + ' ' + new URL(r.url()).pathname)
        else if (r.method() === 'POST') envois.push(new URL(r.url()).pathname)
      })
      const hote = '<mjs-envoi-coupe' + (mode === 'léger' ? ' mjs-light' : '') + '></mjs-envoi-coupe>'
      const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><form class="page" action="/envoi" method="post"><input class="pchamp" name="q" value="p"><button class="pbouton" type="submit">envoyer</button></form>${hote}<script>${script}</script></body></html>`
      await page.route('http://mjs.test/**', (route: any) => {
        if (route.request().method() === 'POST') return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: 'ok' })
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
      })
      await page.goto('http://mjs.test/')
      await page.waitForFunction(() => !!(document.querySelector('mjs-envoi-coupe') as any)?._shadow?.querySelector('.bouton'))
      await page.evaluate((rep: boolean) => {
        const w: any = window
        w.__temoin = 'page d\'origine'
        w.__q      = 0
        w.__ordre  = []
        w.µ.config.confirm = false
        w.confirm = () => { w.__q++; return rep }
        w.N = (s: string) => (document.querySelector('mjs-envoi-coupe') as any)._shadow.querySelector(s)
        w.P = (s: string) => document.querySelector(s)
        document.addEventListener('mjs:before-visit', () => w.__ordre.push('envoi'))
      }, reponse)
      return { page, chargements, envois }
    }

    // le geste qui envoie le formulaire : vrai clic de souris sur le bouton d'envoi, vraie touche Entrée dans un champ
    // (le navigateur fabrique alors lui-même le clic sur le bouton d'envoi), ou `requestSubmit()` lancé par un script
    async function envoyer(ctx: any, forme: string, geste: Geste) {
      const f = FORMES[forme]
      if (geste === 'bouton') {
        const [x, y] = await ctx.page.evaluate((s: string) => {
          const r = (window as any).N(s).getBoundingClientRect()
          return [r.x + r.width / 2, r.y + r.height / 2]
        }, f.bouton)
        await ctx.page.mouse.click(x, y)
      } else if (geste === 'entree') {
        await ctx.page.evaluate((s: string) => (window as any).N(s).focus(), f.champ)
        await ctx.page.keyboard.press('Enter')
      } else if (geste === 'clic()') {
        await ctx.page.evaluate((s: string) => (window as any).N(s).click(), f.bouton)
      } else {
        await ctx.page.evaluate(([s, b]: [string, string | null]) => {
          const w: any = window
          if (b) w.N(s).requestSubmit(w.N(b))
          else w.N(s).requestSubmit()
        }, [f.form, geste === 'requestSubmit(bouton)' ? f.bouton : null])
      }
    }

    // attend le premier effet du geste (un envoi de MJS ou un chargement natif), puis un instant : un second envoi,
    // s'il y en a un, se montre
    async function attendre(ctx: any, effet: boolean) {
      const debut = Date.now()
      while (effet && ctx.envois.length === 0 && ctx.chargements.length < 2 && Date.now() - debut < 3000) await ctx.page.waitForTimeout(25)
      await ctx.page.waitForTimeout(effet ? 300 : 600)
    }

    // la lecture échoue quand le navigateur est en train de charger la page de son envoi natif : c'est le même défaut
    async function etat(ctx: any) {
      try {
        return await ctx.page.evaluate(() => ({ temoin: (window as any).__temoin, joues: (window as any).__joues || 0, questions: (window as any).__q, ordre: (window as any).__ordre }))
      } catch (erreur: any) {
        return assert.fail('la page est en train d\'être rechargée par le navigateur (chargements : ' + ctx.chargements.join(', ') + ') — ' + String(erreur.message).split('\n')[0])
      }
    }

    // l'envoi est parti par la navigation de MJS, une seule fois, après le gestionnaire du composant : la page n'a pas
    // été rechargée
    async function assertPris(ctx: any, sc: Scenario, message: string) {
      assert.equal(ctx.chargements.length, 1, message + ' : aucun chargement natif de la page (chargements : ' + ctx.chargements.join(', ') + ')')
      assert.deepEqual(ctx.envois, ['/envoi'], message + ' : un seul envoi, par la navigation de MJS')
      const e = await etat(ctx)
      assert.equal(e.temoin, 'page d\'origine', message + ' : la page d\'origine est toujours là')
      const gestionnaire = FORMES[sc.forme].gestionnaire && !(sc.pose.includes('document'))
      assert.deepEqual(e.ordre, gestionnaire ? ['gestionnaire', 'envoi'] : ['envoi'], message + ' : le gestionnaire du composant, puis l\'envoi')
      if (sc.pose) assert.equal(e.joues, sc.joues ?? 1, message + ' : l\'écouteur de l\'auteur a joué une fois')
    }

    // le formulaire est resté à l'auteur (ou au composant) : ni envoi ni rechargement ; seul le gestionnaire du composant a joué
    async function assertGarde(ctx: any, sc: Scenario, message: string) {
      assert.equal(ctx.chargements.length, 1, message + ' : aucun chargement natif de la page (chargements : ' + ctx.chargements.join(', ') + ')')
      assert.deepEqual(ctx.envois, [], message + ' : aucun envoi par la navigation de MJS')
      const e = await etat(ctx)
      assert.equal(e.temoin, 'page d\'origine', message + ' : la page d\'origine est toujours là')
      assert.deepEqual(e.ordre, FORMES[sc.forme].gestionnaire && sc.reponse !== false ? ['gestionnaire'] : [], message + ' : seul le gestionnaire du composant a joué')
      if (sc.pose) assert.equal(e.joues, sc.joues ?? 1, message + ' : l\'écouteur de l\'auteur a joué')
    }

    // limite mesurée : le navigateur envoie lui-même, la page est rechargée et MJS ne reprend rien
    async function assertNavigateur(ctx: any, message: string) {
      assert.equal(ctx.chargements.length, 2, message + ' : le navigateur envoie le formulaire lui-même (chargements : ' + ctx.chargements.join(', ') + ')')
      assert.deepEqual(ctx.envois, [], message + ' : aucun envoi par la navigation de MJS')
    }

    for (const mode of ['ombre', 'léger'] as const) {
      for (const sc of SCENARIOS) {
        if (sc.modes && !sc.modes.includes(mode)) continue
        if (sc.navigateurs && !sc.navigateurs.includes(nomNavigateur)) continue
        for (const geste of sc.gestes ?? ['bouton']) {
          it('(' + mode + ') ' + sc.nom + ' — ' + geste, async function () {
            if (!present) { this.skip(); return }
            const ctx     = await ouvrir(mode, sc.reponse ?? true)
            const attendu = sc.limites?.[geste]?.[nomNavigateur] ?? sc.attendu
            const message = sc.nom + ' — ' + geste + (attendu !== sc.attendu ? ' (limite mesurée)' : '')
            try {
              if (sc.pose) await ctx.page.evaluate(sc.pose)
              await envoyer(ctx, sc.forme, geste)
              await attendre(ctx, attendu !== 'garde')
              if (attendu === 'pris') await assertPris(ctx, sc, message)
              else if (attendu === 'garde') await assertGarde(ctx, sc, message)
              else await assertNavigateur(ctx, message)
              if (sc.questions !== undefined && attendu !== 'navigateur') assert.equal((await etat(ctx)).questions, sc.questions, message + ' : le nombre de questions posées')
            } finally { await ctx.page.close() }
          })
        }
      }
    }

    // hors composant, le formulaire de la page reste au navigateur quand un écouteur coupe `submit` : comme avant, la page
    // est rechargée ; sans coupure, la navigation de MJS l'envoie, comme toujours
    for (const [nom, pose, natif] of [
      ['sans écouteur de la page : envoyé par la navigation',   '',                                                                                    false],
      ['stopImmediatePropagation() sur le formulaire',          poser("P('.page')", JOUE + '; e.stopImmediatePropagation()'),                          true],
      ['stopPropagation() posé en capture sur le formulaire',   poser("P('.page')", JOUE + '; e.stopPropagation()', true),                             true],
      ['stopPropagation() posé en capture sur le document',     poser('document', JOUE + '; e.stopPropagation()', true),                               true]
    ] as [string, string, boolean][]) {
      it('(hors composant) ' + nom, async function () {
        if (!present) { this.skip(); return }
        const ctx = await ouvrir('léger')
        try {
          if (pose) await ctx.page.evaluate(pose)
          const [x, y] = await ctx.page.evaluate(() => {
            const r = document.querySelector('.pbouton')!.getBoundingClientRect()
            return [r.x + r.width / 2, r.y + r.height / 2]
          })
          await ctx.page.mouse.click(x, y)
          await attendre(ctx, true)
          if (natif) await assertNavigateur(ctx, nom)
          else {
            assert.equal(ctx.chargements.length, 1, nom + ' : aucun chargement natif de la page (chargements : ' + ctx.chargements.join(', ') + ')')
            assert.deepEqual(ctx.envois, ['/envoi'], nom + ' : un seul envoi, par la navigation de MJS')
          }
        } finally { await ctx.page.close() }
      })
    }
  })
}
