// La navigation de MJS prend un lien ou un envoi de formulaire dont un écouteur NATIF de la page coupe la propagation, mais
// elle le décide après le DERNIER écouteur du nœud où la coupure a eu lieu, et respecte le dernier mot de l'auteur :
// un autre écouteur du même nœud (par exemple deux écouteurs en capture sur le document, le premier coupe, le second
// appelle `preventDefault()`) garde le lien ou le formulaire à l'auteur, ni navigation ni envoi ni rechargement.
// Un formulaire de la page glissé (slot) dans un composant à ombre est repris comme les autres formes quand la coupure
// est posée sur l'hôte, le body ou le document, en capture ou en remontée ; une coupure en capture sur `window` joue avant
// toute écoute de MJS : limite épinglée, le navigateur envoie lui-même le formulaire.
// Gardes : un écouteur de surveillance resté d'un geste précédent ne reprend pas un lien ou un formulaire de la page ;
// une coupure répétée dans un même écouteur ne le prend qu'une fois ; un envoi ou un clic déjà retenu avant la capture du
// document n'est pas surveillé.
// Un lien d'un composant à ombre, coupé en capture sur le document, est suivi par le navigateur (limite) ; coupé en remontée sur
// un nœud de l'ombre ou dans un composant léger, il est repris.
// Un lien que MJS ne prend pas (Ctrl-clic, `target="_blank"`, `download`) reste au navigateur même coupé au document, et
// le `preventDefault()` d'un autre écouteur de l'auteur n'y lève rien ; un écouteur `passive: true` qui coupe laisse le
// navigateur agir seul (MJS ne rejoue pas) ; un verbe `mjs-method` inconnu n'avertit qu'une fois ; `returnValue` dit
// la même chose que `defaultPrevented` dans les écouteurs qui suivent la coupure.
// Chromium, Firefox et WebKit, vrai clic de souris (Playwright) : c'est le navigateur qui recharge, ou non.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'dernier-ecouteur.mjs': [
    '<form class="f" action="/envoi" method="post"><input class="champ" name="q" value="a"><button class="bouton" type="submit">envoyer</button></form>',
    '<a class="lk" href="/page-b"><span class="in">lien</span></a>',
    '<a class="lk2" href="#/ancre">ancre</a>',
    '<a class="lkb" href="/page-b" target="_blank">autre onglet</a>',
    '<a class="lkd" href="/page-b" download>téléchargement</a>',
    '<a class="lkf" href="/page-b" mjs-method="foo">verbe inconnu</a>',
    '<a class="lkh" href="#x" mjs-method="foo">verbe inconnu sur une ancre</a>'
  ].join('\n') + '\n',
  'cadre-coupure.mjs': '<div class="cadre"><slot></slot></div>\n'
}

type Mode   = 'ombre' | 'léger' | 'cadre'
type Objet  = 'form' | 'lien' | 'ancre' | 'page-form' | 'page-lien' | 'cadre-form'
// `pris` : MJS le prend (une seule fois) ; `garde` : il reste à l'auteur ; `navigateur` : le navigateur agit lui-même
type Attendu = 'pris' | 'garde' | 'navigateur'

type Cas = {
  nom:      string
  mode:     Mode
  objet:    Objet
  pose:     string
  attendu:  Attendu
  joues?:   number
  avant?:   { objet: Objet, pose: string, attendu: Attendu }
  poses?:   number
  appels?:  number
}

const JOUE  = 'window.__joues = (window.__joues || 0) + 1'
const poser = (type: string, cible: string, corps: string, capture = false) => `${cible}.addEventListener('${type}', (e) => { ${corps} }, ${capture})`
const TYPE: Record<Objet, string> = { 'form': 'submit', 'lien': 'click', 'ancre': 'click', 'page-form': 'submit', 'page-lien': 'click', 'cadre-form': 'submit' }
const SEL: Record<Objet, string> = { 'form': '.f', 'lien': '.lk', 'ancre': '.lk2', 'page-form': '.page', 'page-lien': '.plien', 'cadre-form': '.cf' }
const BOUTON: Record<Objet, string> = { 'form': '.bouton', 'lien': '.lk', 'ancre': '.lk2', 'page-form': '.pbouton', 'page-lien': '.plien', 'cadre-form': '.cbouton' }

// compte les passages de la navigation sur l'événement du geste (hors la question de confirmation de la capture) :
// `appels` vaut 2 quand elle a d'abord regardé si elle prenait l'événement, puis agi une fois la propagation finie, 1
// quand elle a agi tout de suite
const espion = (type: string) => "window.__appels = 0; { const nom = '" + (type === 'submit' ? '_mjs_ujsOnSubmit' : '_mjs_ujsOnClick') + "'; const o = window.µ[nom]; window.µ[nom] = function(e) { if (e.type === '" + type + "' && !e._mjs_ujsGateOnly) window.__appels++; return o.apply(this, arguments) } }"

const CAS: Cas[] = []
for (const objet of ['form', 'lien'] as const) {
  const t = TYPE[objet]
  const s = SEL[objet]
  const sur = (cible: string, corps: string, capture = false) => poser(t, cible, corps, capture)
  CAS.push(
    { nom: 'témoin : un écouteur du document coupe en capture, rien d\'autre', mode: 'léger', objet, pose: sur('document', JOUE + '; e.stopPropagation()', true), attendu: 'pris', joues: 1 },
    { nom: 'deux écouteurs en capture sur le document : le premier coupe, le second appelle preventDefault()', mode: 'léger', objet, pose: sur('document', 'e.stopPropagation()', true) + ';' + sur('document', 'e.preventDefault(); ' + JOUE, true), attendu: 'garde', joues: 1 },
    { nom: 'deux écouteurs en capture sur le document : le premier coupe à fond, le second est sauté', mode: 'léger', objet, pose: sur('document', JOUE + '; e.stopImmediatePropagation()', true) + ';' + sur('document', 'e.preventDefault(); ' + JOUE, true), attendu: 'pris', joues: 1 },
    { nom: 'deux écouteurs en remontée sur le nœud : le premier coupe, le second appelle preventDefault()', mode: 'ombre', objet, pose: sur(`N('${s}')`, 'e.stopPropagation()') + ';' + sur(`N('${s}')`, 'e.preventDefault(); ' + JOUE), attendu: 'garde', joues: 1 },
    { nom: 'une coupure répétée dans le même écouteur du document : décidée une seule fois', mode: 'léger', objet, pose: espion(t) + ';' + sur('document', JOUE + '; e.stopPropagation(); e.stopPropagation(); e.stopPropagation()', true), attendu: 'pris', joues: 1, appels: 2 },
    { nom: 'une coupure à fond répétée dans le même écouteur du document : prise une seule fois', mode: 'léger', objet, pose: espion(t) + ';' + sur('document', JOUE + '; e.stopImmediatePropagation(); e.stopImmediatePropagation(); e.stopImmediatePropagation()', true), attendu: 'pris', joues: 1, appels: 1 },
    { nom: 'déjà retenu avant la capture du document : aucune surveillance posée sur le body', mode: 'léger', objet, pose: sur('window', JOUE + '; e.preventDefault()', true) + ';' + sur('document', 'e.stopPropagation()', true) + ';window.__poses = 0; { const o = document.body.addEventListener; document.body.addEventListener = function(t) { if (t === \'' + t + '\') window.__poses++; return o.apply(this, arguments) } }', attendu: 'garde', joues: 1, poses: 0 }
  )
}

// lien d'un composant à ombre (fermée), coupure en capture sur le document : limite épinglée, le pont de l'ombre ne reçoit
// jamais le clic et le document ne voit que l'hôte, jamais le lien : le navigateur suit lui-même le lien (un envoi de
// formulaire ne sort pas de l'ombre : le document ne le voit pas)
for (const objet of ['lien'] as const) {
  const t = TYPE[objet]
  CAS.push(
    { nom: 'composant à ombre : un écouteur du document coupe en capture, limite : le navigateur suit le lien', mode: 'ombre', objet, pose: poser(t, 'document', JOUE + '; e.stopPropagation()', true), attendu: 'navigateur', joues: 1 },
    { nom: 'composant à ombre : le document coupe en capture, un autre écouteur appelle preventDefault()', mode: 'ombre', objet, pose: poser(t, 'document', 'e.stopPropagation()', true) + ';' + poser(t, 'document', 'e.preventDefault(); ' + JOUE, true), attendu: 'garde', joues: 1 }
  )
}

// formulaire de la page glissé dans un composant à ombre
const coupe = (cible: string, capture: boolean, apres = '') => poser('submit', cible, JOUE + '; e.stopPropagation()' + apres, capture)
CAS.push(
  { nom: 'témoin sans écouteur de la page', mode: 'cadre', objet: 'cadre-form', pose: '', attendu: 'pris' },
  { nom: 'stopPropagation() en capture sur le formulaire glissé', mode: 'cadre', objet: 'cadre-form', pose: coupe("document.querySelector('.cf')", true), attendu: 'pris', joues: 1 },
  { nom: 'stopPropagation() en capture sur l\'hôte', mode: 'cadre', objet: 'cadre-form', pose: coupe("document.querySelector('mjs-cadre-coupure')", true), attendu: 'pris', joues: 1 },
  { nom: 'stopPropagation() en remontée sur l\'hôte', mode: 'cadre', objet: 'cadre-form', pose: coupe("document.querySelector('mjs-cadre-coupure')", false), attendu: 'pris', joues: 1 },
  { nom: 'stopPropagation() en capture sur le body', mode: 'cadre', objet: 'cadre-form', pose: coupe('document.body', true), attendu: 'pris', joues: 1 },
  { nom: 'stopPropagation() en remontée sur le body', mode: 'cadre', objet: 'cadre-form', pose: coupe('document.body', false), attendu: 'pris', joues: 1 },
  { nom: 'stopPropagation() en capture sur le document', mode: 'cadre', objet: 'cadre-form', pose: coupe('document', true), attendu: 'pris', joues: 1 },
  { nom: 'stopPropagation() en capture sur window : limite, joue avant toute écoute de MJS', mode: 'cadre', objet: 'cadre-form', pose: coupe('window', true), attendu: 'navigateur', joues: 1 },
  { nom: 'stopPropagation() en capture sur l\'hôte, preventDefault() de l\'auteur dans le même écouteur', mode: 'cadre', objet: 'cadre-form', pose: coupe("document.querySelector('mjs-cadre-coupure')", true, '; e.preventDefault()'), attendu: 'garde', joues: 1 },
  { nom: 'stopPropagation() en capture sur l\'hôte, preventDefault() dans un autre écouteur de l\'hôte', mode: 'cadre', objet: 'cadre-form', pose: poser('submit', "document.querySelector('mjs-cadre-coupure')", 'e.stopPropagation()', true) + ';' + poser('submit', "document.querySelector('mjs-cadre-coupure')", 'e.preventDefault(); ' + JOUE, true), attendu: 'garde', joues: 1 },
  { nom: 'stopPropagation() en capture sur le document, preventDefault() dans un autre écouteur du document', mode: 'cadre', objet: 'cadre-form', pose: poser('submit', 'document', 'e.stopPropagation()', true) + ';' + poser('submit', 'document', 'e.preventDefault(); ' + JOUE, true), attendu: 'garde', joues: 1 }
)

// gardes : écouteurs de surveillance restés d'un geste précédent sur des nœuds qui durent (html, body, hôte)
CAS.push(
  { nom: 'un formulaire de la page, coupé en remontée sur le body, après un envoi de composant coupé plus bas : reste au navigateur', mode: 'léger', objet: 'page-form',
    pose: poser('submit', 'document.body', JOUE + '; e.stopPropagation()'), attendu: 'navigateur', joues: 1,
    avant: { objet: 'form', pose: poser('submit', "N('.f')", 'e.stopPropagation()'), attendu: 'pris' } },
  { nom: 'un lien de la page, coupé en remontée sur le body, après un lien de composant coupé plus bas : reste au navigateur', mode: 'léger', objet: 'page-lien',
    pose: poser('click', 'document.body', JOUE + '; e.stopPropagation()'), attendu: 'navigateur', joues: 1,
    avant: { objet: 'ancre', pose: poser('click', "N('.lk2')", 'e.stopPropagation()'), attendu: 'pris' } }
)

// cas où la navigation ne prend pas le geste, ou le prend autrement : `verifie` dit ce qui doit se voir
const COUPE_DOC   = poser('click', 'document', JOUE + '; e.stopPropagation()', true)
const COUPE_PASSIF = "document.addEventListener('click', (e) => { window.__joues = 1; e.stopPropagation() }, { capture: true, passive: true })"
const COUPE_PASSIF_ENVOI = "document.addEventListener('submit', (e) => { window.__joues = 1; e.stopPropagation() }, { capture: true, passive: true })"
const COUPE_PUIS_PREVENT = poser('click', 'document', 'e.stopPropagation()', true) + ';' + poser('click', 'document', "try { e.preventDefault(); window.__erreur = 'aucune' } catch (erreur) { window.__erreur = String(erreur) }", true)
const COMPTE_FORMDATA = "document.addEventListener('formdata', () => { window.__fd = (window.__fd || 0) + 1 })"
const COUPE_PUIS_RETURN = (valeur: string) => poser('click', 'document', 'e.stopPropagation()', true) + ';' + poser('click', 'document', 'e.returnValue = ' + valeur + '; window.__lu = { dp: e.defaultPrevented, rv: e.returnValue }', true)
const LIT = (type: string) => poser(type, 'document', 'window.__lu = { dp: e.defaultPrevented, rv: e.returnValue }', true)
const COUPE_PUIS_LIT = (type: string) => poser(type, 'document', 'e.stopPropagation()', true) + ';' + LIT(type)

type Extra = {
  nom:     string
  pose:    string
  objet:   'form' | 'lien'
  bouton:  string
  mods?:   string
  verifie: (ctx: any, e: any) => void | Promise<void>
}

const EXTRAS: Extra[] = [
  { nom: 'Ctrl-clic, coupé au document : l\'onglet s\'ouvre, MJS ne prend pas le lien', pose: COUPE_DOC, objet: 'lien', bouton: '.lk', mods: 'Control',
    verifie: (ctx, e) => { assert.equal(ctx.popups.length, 1, 'un onglet s\'ouvre'); assert.equal(e.visites, 0, 'la navigation de MJS n\'est pas passée'); assert.equal(e.chemin, '/', 'l\'adresse n\'a pas bougé') } },
  { nom: 'Maj-clic, coupé au document : la fenêtre s\'ouvre, MJS ne prend pas le lien', pose: COUPE_DOC, objet: 'lien', bouton: '.lk', mods: 'Shift',
    verifie: (ctx, e) => { assert.equal(ctx.popups.length, 1, 'une fenêtre s\'ouvre'); assert.equal(e.visites, 0, 'la navigation de MJS n\'est pas passée') } },
  { nom: 'target="_blank", coupé au document : l\'onglet s\'ouvre, MJS ne prend pas le lien', pose: COUPE_DOC, objet: 'lien', bouton: '.lkb',
    verifie: (ctx, e) => { assert.equal(ctx.popups.length, 1, 'un onglet s\'ouvre'); assert.equal(e.visites, 0, 'la navigation de MJS n\'est pas passée') } },
  { nom: 'download, coupé au document : le navigateur télécharge, MJS ne prend pas le lien', pose: COUPE_DOC, objet: 'lien', bouton: '.lkd',
    verifie: (ctx, e) => { assert.equal(ctx.telechargements.length, 1, 'un téléchargement part'); assert.equal(e.visites, 0, 'la navigation de MJS n\'est pas passée'); assert.equal(e.chemin, '/', 'l\'adresse n\'a pas bougé') } },
  { nom: 'Ctrl-clic non pris, puis preventDefault() d\'un autre écouteur de l\'auteur : aucune exception, rien ne s\'ouvre', pose: COUPE_PUIS_PREVENT, objet: 'lien', bouton: '.lk', mods: 'Control',
    verifie: (ctx, e) => { assert.equal(e.erreur, 'aucune', 'preventDefault() de l\'auteur ne lève rien'); assert.equal(ctx.popups.length, 0, 'l\'auteur a retenu le geste : aucun onglet'); assert.equal(e.visites, 0, 'la navigation de MJS n\'est pas passée') } },
  { nom: 'coupure dans un écouteur passif (lien) : le navigateur agit seul, MJS ne rejoue pas', pose: COUPE_PASSIF, objet: 'lien', bouton: '.lk',
    verifie: (ctx, e) => { assert.equal(ctx.chargements.length, 2, 'le navigateur charge la page (chargements : ' + ctx.chargements.join(', ') + ')'); assert.deepEqual(ctx.lectures, [], 'aucune lecture par la navigation de MJS') } },
  { nom: 'coupure dans un écouteur passif (formulaire) : le navigateur envoie seul, MJS ne rejoue pas', pose: COUPE_PASSIF_ENVOI, objet: 'form', bouton: '.bouton',
    verifie: (ctx) => { assert.equal(ctx.chargements.length, 2, 'le navigateur envoie le formulaire (chargements : ' + ctx.chargements.join(', ') + ')'); assert.deepEqual(ctx.envois, [], 'aucun envoi par la navigation de MJS') } },
  { nom: 'verbe mjs-method inconnu, coupé au document : un seul avertissement', pose: COUPE_DOC, objet: 'lien', bouton: '.lkf',
    verifie: (ctx) => { const n = ctx.avertissements.filter((m: string) => m.includes('verbe HTTP non reconnu')).length; assert.equal(n, 1, 'un seul avertissement (reçus : ' + n + ')') } },
  { nom: 'returnValue suit defaultPrevented après la coupure (lien) : rien n\'est retenu', pose: COUPE_PUIS_LIT('click'), objet: 'lien', bouton: '.lk',
    verifie: (ctx, e) => { assert.deepEqual(e.lu, { dp: false, rv: true }, 'defaultPrevented faux, returnValue vrai') } },
  { nom: 'returnValue suit defaultPrevented après la coupure (formulaire) : rien n\'est retenu', pose: COUPE_PUIS_LIT('submit'), objet: 'form', bouton: '.bouton',
    verifie: (ctx, e) => { assert.deepEqual(e.lu, { dp: false, rv: true }, 'defaultPrevented faux, returnValue vrai') } },
  { nom: 'returnValue après preventDefault() de l\'auteur : false comme defaultPrevented', pose: poser('click', 'document', 'e.stopPropagation()', true) + ';' + poser('click', 'document', 'e.preventDefault(); window.__lu = { dp: e.defaultPrevented, rv: e.returnValue }', true), objet: 'lien', bouton: '.lk',
    verifie: (ctx, e) => { assert.deepEqual(e.lu, { dp: true, rv: false }, 'defaultPrevented vrai, returnValue faux') } },
  { nom: 'returnValue = true après la coupure : ne retient rien, MJS prend le lien', pose: COUPE_PUIS_RETURN('true'), objet: 'lien', bouton: '.lk',
    verifie: (ctx, e) => { assert.deepEqual(e.lu, { dp: false, rv: true }, 'rien n\'est retenu'); assert.equal(e.chemin, '/page-b', 'MJS a pris le lien'); assert.equal(e.visites, 1, 'un seul passage de la navigation'); assert.equal(ctx.chargements.length, 1, 'aucun chargement natif') } },
  { nom: 'returnValue = false après la coupure : l\'action reste à l\'auteur', pose: COUPE_PUIS_RETURN('false'), objet: 'lien', bouton: '.lk',
    verifie: (ctx, e) => { assert.deepEqual(e.lu, { dp: true, rv: false }, 'defaultPrevented vrai, returnValue faux'); assert.equal(e.chemin, '/', 'l\'adresse n\'a pas bougé'); assert.equal(e.visites, 0, 'la navigation de MJS n\'est pas passée'); assert.equal(ctx.chargements.length, 1, 'aucun chargement natif'); assert.equal(ctx.popups.length, 0, 'aucun onglet') } },
  { nom: 'envoi coupé au document : l\'événement formdata ne joue qu\'une fois', pose: COUPE_DOC.replace("'click'", "'submit'") + ';' + COMPTE_FORMDATA, objet: 'form', bouton: '.bouton',
    verifie: (ctx, e) => { assert.equal(e.fd, 1, 'un seul formdata (reçus : ' + e.fd + ')'); assert.deepEqual(ctx.envois, ['/envoi'], 'un seul envoi') } },
  { nom: 'envoi non coupé : l\'événement formdata ne joue qu\'une fois (témoin)', pose: COMPTE_FORMDATA, objet: 'form', bouton: '.bouton',
    verifie: (ctx, e) => { assert.equal(e.fd, 1, 'un seul formdata (reçus : ' + e.fd + ')') } },
  { nom: 'lien d\'ancre avec un verbe inconnu, coupé au document : un seul avertissement', pose: COUPE_DOC, objet: 'lien', bouton: '.lkh',
    verifie: (ctx) => { const n = ctx.avertissements.filter((m: string) => m.includes('verbe HTTP non reconnu')).length; assert.equal(n, 1, 'un seul avertissement (reçus : ' + n + ')') } },
  { nom: 'lien d\'ancre avec un verbe inconnu, non coupé : un seul avertissement (témoin)', pose: 'void 0', objet: 'lien', bouton: '.lkh',
    verifie: (ctx) => { const n = ctx.avertissements.filter((m: string) => m.includes('verbe HTTP non reconnu')).length; assert.equal(n, 1, 'un seul avertissement (reçus : ' + n + ')') } }
]

for (const nomNavigateur of ['chromium', 'firefox', 'webkit'] as const) {
  describe('décision après le dernier écouteur du nœud coupé (' + nomNavigateur + ' réel)', function () {
    this.timeout(180000)
    let present = false
    let script  = ''
    let navigateur: any

    before(async function () {
      present = await navigateurPresent(nomNavigateur)
      if (!present) {
        console.log('  ℹ️  ' + nomNavigateur + ' non installé, test du dernier écouteur sauté. Activer : `npx playwright install ' + nomNavigateur + '`')
        return
      }
      const root   = mjsTmp('coupure-dernier-ecouteur')
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

    async function ouvrir(mode: Mode) {
      const page = await navigateur.newPage()
      const chargements: string[] = []
      const envois: string[]      = []
      const popups: string[]      = []
      const lectures: string[]     = []
      const telechargements: string[] = []
      const avertissements: string[]  = []
      page.context().on('page', (p: any) => { if (p !== page) popups.push(p.url()) })
      page.on('download', (d: any) => telechargements.push(d.suggestedFilename()))
      page.on('console', (m: any) => { if (m.type() === 'warning') avertissements.push(m.text()) })
      page.on('request', (r: any) => {
        if (r.isNavigationRequest()) chargements.push(r.method() + ' ' + new URL(r.url()).pathname)
        else if (r.method() === 'POST') envois.push(new URL(r.url()).pathname)
        else lectures.push(new URL(r.url()).pathname)
      })
      const hote = mode === 'cadre'
        ? '<mjs-cadre-coupure><form class="cf" action="/envoi" method="post"><input class="cchamp" name="q" value="c"><button class="cbouton" type="submit">envoyer</button></form></mjs-cadre-coupure>'
        : '<mjs-dernier-ecouteur' + (mode === 'léger' ? ' mjs-light' : '') + '></mjs-dernier-ecouteur>'
      const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><form class="page" action="/envoi" method="post"><input class="pchamp" name="q" value="p"><button class="pbouton" type="submit">envoyer</button></form><a class="plien" href="/page-b">page</a>${hote}<script>${script}</script></body></html>`
      await page.route('http://mjs.test/**', (route: any) => {
        if (route.request().method() === 'POST') return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: 'ok' })
        if (new URL(route.request().url()).pathname === '/page-b') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><meta charset="utf-8"></head><body><p>page b</p></body></html>' })
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
      })
      await page.goto('http://mjs.test/')
      await page.waitForFunction((m: string) => {
        if (m === 'cadre') return !!(document.querySelector('mjs-cadre-coupure') as any)?._shadow?.querySelector('slot')
        const h: any = document.querySelector('mjs-dernier-ecouteur')
        return !!(h && (h._shadow || h).querySelector('.f'))
      }, mode)
      await page.evaluate(() => {
        const w: any = window
        w.__temoin  = 'page d\'origine'
        w.__visites = 0
        w.µ.config.confirm = false
        w.N = (s: string) => { const h: any = document.querySelector('mjs-dernier-ecouteur'); return (h._shadow || h).querySelector(s) }
        w.P = (s: string) => document.querySelector(s)
        document.addEventListener('mjs:before-visit', () => w.__visites++)
      })
      return { page, chargements, envois, lectures, popups, telechargements, avertissements }
    }

    // vrai clic de souris au centre du bouton d'envoi ou du lien
    async function cliquer(ctx: any, objet: Objet) {
      const [x, y] = await ctx.page.evaluate(([s, composant]: [string, boolean]) => {
        const w: any = window
        const r = (composant ? w.N(s) : w.P(s)).getBoundingClientRect()
        return [r.x + r.width / 2, r.y + r.height / 2]
      }, [BOUTON[objet], objet === 'form' || objet === 'lien' || objet === 'ancre'])
      await ctx.page.mouse.click(x, y)
    }

    async function attendre(ctx: any, effet: boolean) {
      const debut = Date.now()
      while (effet && ctx.envois.length === 0 && ctx.chargements.length < 2 && Date.now() - debut < 3000) await ctx.page.waitForTimeout(25)
      await ctx.page.waitForTimeout(effet ? 300 : 600)
    }

    async function etat(ctx: any) {
      try {
        return await ctx.page.evaluate(() => ({ joues: (window as any).__joues || 0, visites: (window as any).__visites, chemin: location.pathname + location.hash, poses: (window as any).__poses, appels: (window as any).__appels }))
      } catch (erreur: any) {
        return assert.fail('la page est en train d\'être rechargée par le navigateur (chargements : ' + ctx.chargements.join(', ') + ') — ' + String(erreur.message).split('\n')[0])
      }
    }

    // un seul passage de MJS (un seul `mjs:before-visit`, un seul envoi pour un formulaire), aucun rechargement
    async function assertPris(ctx: any, objet: Objet, message: string) {
      assert.equal(ctx.chargements.length, 1, message + ' : aucun chargement natif de la page (chargements : ' + ctx.chargements.join(', ') + ')')
      const e = await etat(ctx)
      assert.equal(e.visites, TYPE[objet] === 'submit' || objet === 'lien' ? 1 : e.visites, message + ' : un seul passage de la navigation')
      if (TYPE[objet] === 'submit') assert.deepEqual(ctx.envois, ['/envoi'], message + ' : un seul envoi, par la navigation de MJS')
      else if (objet === 'lien') assert.equal(e.chemin, '/page-b', message + ' : le lien est suivi par la navigation de MJS')
      else assert.equal(e.chemin, '/#/ancre', message + ' : l\'ancre est suivie par la navigation de MJS')
    }

    // resté à l'auteur : ni navigation, ni envoi, ni rechargement
    async function assertGarde(ctx: any, message: string) {
      assert.equal(ctx.chargements.length, 1, message + ' : aucun chargement natif de la page (chargements : ' + ctx.chargements.join(', ') + ')')
      assert.deepEqual(ctx.envois, [], message + ' : aucun envoi par la navigation de MJS')
      const e = await etat(ctx)
      assert.equal(e.chemin, '/', message + ' : l\'adresse n\'a pas bougé')
      assert.equal(e.visites, 0, message + ' : la navigation de MJS n\'est pas passée')
    }

    // le navigateur agit lui-même : la page est rechargée et MJS ne reprend rien
    function assertNavigateur(ctx: any, message: string) {
      assert.equal(ctx.chargements.length, 2, message + ' : le navigateur agit lui-même (chargements : ' + ctx.chargements.join(', ') + ')')
      assert.deepEqual(ctx.envois, [], message + ' : aucun envoi par la navigation de MJS')
    }

    for (const cas of CAS) {
      it('(' + cas.mode + ') ' + cas.objet + ' — ' + cas.nom, async function () {
        if (!present) { this.skip(); return }
        const ctx = await ouvrir(cas.mode)
        try {
          if (cas.pose && cas.avant) await ctx.page.evaluate(cas.pose)
          if (cas.avant) {
            await ctx.page.evaluate(cas.avant.pose)
            await cliquer(ctx, cas.avant.objet)
            await attendre(ctx, true)
            await assertPris(ctx, cas.avant.objet, 'geste précédent')
            ctx.envois.length = 0
          }
          if (cas.pose && !cas.avant) await ctx.page.evaluate(cas.pose)
          if (cas.avant) await ctx.page.evaluate(() => { (window as any).__visites = 0 })
          await cliquer(ctx, cas.objet)
          await attendre(ctx, cas.attendu !== 'garde')
          if (cas.attendu === 'pris') await assertPris(ctx, cas.objet, cas.nom)
          else if (cas.attendu === 'garde') await assertGarde(ctx, cas.nom)
          else assertNavigateur(ctx, cas.nom)
          if (cas.joues !== undefined && cas.attendu !== 'navigateur') assert.equal((await etat(ctx)).joues, cas.joues, cas.nom + ' : l\'écouteur de l\'auteur a joué')
          if (cas.appels !== undefined) assert.equal((await etat(ctx)).appels, cas.appels, cas.nom + ' : passages de la navigation sur l\'événement')
          if (cas.poses !== undefined) assert.equal((await etat(ctx)).poses, cas.poses, cas.nom + ' : écouteurs de surveillance posés sur le body')
        } finally { await ctx.page.close() }
      })
    }
    for (const extra of EXTRAS) {
      it('(léger) ' + extra.objet + ' — ' + extra.nom, async function () {
        if (!present) { this.skip(); return }
        const ctx = await ouvrir('léger')
        try {
          await ctx.page.evaluate(extra.pose)
          const [x, y] = await ctx.page.evaluate((s: string) => { const r = (window as any).N(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] }, extra.bouton)
          if (extra.mods) await ctx.page.keyboard.down(extra.mods)
          await ctx.page.mouse.click(x, y)
          if (extra.mods) await ctx.page.keyboard.up(extra.mods)
          await ctx.page.waitForTimeout(900)
          let e: any
          try {
            e = await ctx.page.evaluate(() => { const w: any = window; return { visites: w.__visites, chemin: location.pathname + location.hash, erreur: w.__erreur, lu: w.__lu, fd: w.__fd || 0 } })
          } catch (erreur: any) {
            e = { visites: 0, chemin: 'rechargée', erreur: undefined, lu: undefined }
          }
          await extra.verifie(ctx, e)
        } finally { await ctx.page.close() }
      })
    }
  })
}
