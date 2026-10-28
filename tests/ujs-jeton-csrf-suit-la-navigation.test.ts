// Jeton CSRF après une navigation : une connexion ou une déconnexion faite par la navigation
// (le serveur fait tourner son jeton, comme Rails/Devise par défaut) installe une page qui porte
// un NOUVEAU <meta name="csrf-token">. µ.ajax relit le jeton dans la page à chaque requête : si
// la page garde l'ancien, tout envoi qui ne porte le jeton que dans l'en-tête (µ.ajax.post/put/
// patch/delete, lien @method, formulaire _method=delete) part périmé jusqu'au rechargement.
//
// Méthode : happy-dom, vrais µ._mjs_navApplyHead + µ._mjs_navInstallNodes (bloc des helpers de
// navigation) et vrai `_request` (mjs_ajax.ts), fetch simulé qui relève l'en-tête X-CSRF-Token.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { extractMarked } from './helpers/extract-marked.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')
const AJAX_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ajax.ts'), 'utf-8')

function monter(teteDepart: string, config: any = {}) {
  const win: any = new Window({ url: 'http://localhost/connexion' })
  const document: any = win.document
  document.head.innerHTML = teteDepart
  document.body.innerHTML = '<form></form>'
  const envoyes: any[] = []
  const µ: any = { warn() {}, error() {}, log() {}, config, pageCache: new Map(), _mjs_lastUjsPath: '/connexion', _mjs_navSeq: 0, _mjs_saveScroll() {} }
  poserMessages(µ)
  const fetchSimule = async (_u: string, o: any) => {
    envoyes.push(o.headers['X-CSRF-Token'])
    return { status: 204, url: 'http://localhost/x', ok: true, headers: { get: () => null } }
  }
  new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, fetchSimule, document)
  new Function('µ', 'document', 'window', 'DOMParser', extractMarked(UJS_SRC, 'helpers-navigation'))(µ, document, win, win.DOMParser)
  return { win, document, µ, envoyes }
}

// une réponse de navigation simulée, que µ._mjs_navRequest (vrai, bloc des helpers) reçoit par le vrai `_request` :
// `/apres` répond `reponse`, toute autre adresse relève le jeton envoyé ; `avant` tourne pendant la requête
function naviguer(reponse: { statut?: number, url?: string, entetes?: Record<string, string>, corps?: any }, signal?: AbortSignal | null, avant?: () => void) {
  const win: any = new Window({ url: 'http://localhost/connexion' })
  const document: any = win.document
  document.head.innerHTML = '<meta name="csrf-token" content="AVANT">'
  const envoyes: any[] = []
  const µ: any = { warn() {}, error() {}, log() {}, config: {}, pageCache: new Map(), _mjs_lastUjsPath: '/connexion', _mjs_navSeq: 0, _mjs_saveScroll() {} }
  poserMessages(µ)
  const entetes: Record<string, string> = { 'content-type': 'application/json', ...(reponse.entetes || {}) }
  const statut  = reponse.statut || 200
  const fetchSimule = async (u: string, o: any) => {
    if (u !== '/apres') {
      envoyes.push(o.headers['X-CSRF-Token'])
      return { status: 204, url: 'http://localhost' + u, ok: true, headers: { get: () => null } }
    }
    if (avant) avant()
    return { status: statut, ok: statut < 400, url: reponse.url || 'http://localhost/apres', headers: { get: (n: string) => entetes[n.toLowerCase()] ?? null }, json: async () => reponse.corps || {}, text: async () => JSON.stringify(reponse.corps || {}) }
  }
  new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, fetchSimule, document)
  new Function('µ', 'document', 'window', 'DOMParser', extractMarked(UJS_SRC, 'helpers-navigation'))(µ, document, win, win.DOMParser)
  const fin = new Promise<string>(ok => µ._mjs_navRequest('GET', '/apres', undefined, () => ok('réussite'), () => ok('refus'), undefined, undefined, signal === null ? undefined : (signal || new AbortController().signal)))
  return { ctx: { win, document, µ, envoyes }, fin }
}

// même suite d'appels que l'installation d'une page HTML reçue (clic, Précédent, envoi de formulaire)
function recevoir(ctx: any, html: string) {
  const doc = new ctx.win.DOMParser().parseFromString(html, 'text/html')
  ctx.µ._mjs_navApplyHead(doc)
  ctx.µ._mjs_navInstallNodes({ zone: ctx.document.body, mode: 'body', target: null }, Array.prototype.slice.call(doc.body.childNodes), 'update', 'cache-first')
}

function meta(document: any, name: string) {
  const el = document.querySelector('meta[name="' + name + '"]')
  return el ? el.getAttribute('content') : null
}

describe('mjs_ujs — le jeton CSRF de la page suit la navigation', function () {
  it('la page reçue après une connexion porte un nouveau jeton : la page le prend, µ.ajax.delete part avec lui', async function () {
    const ctx = monter('<title>Connexion</title><meta name="csrf-token" content="JETON-AVANT-CONNEXION">')
    recevoir(ctx, '<html><head><title>Tableau de bord</title><meta name="csrf-token" content="JETON-APRES-CONNEXION"></head><body><a href="/deconnexion" mjs-method="delete">Déconnexion</a></body></html>')
    await ctx.µ.ajax.delete('/deconnexion', () => {})
    assert.equal(ctx.document.title, 'Tableau de bord')
    assert.equal(meta(ctx.document, 'csrf-token'), 'JETON-APRES-CONNEXION', 'la balise de la page gardait l\'ancien jeton')
    assert.equal(ctx.envoyes[0], 'JETON-APRES-CONNEXION', 'X-CSRF-Token partait avec le jeton périmé (422 côté Rails)')
  })

  it('le nom du paramètre (csrf-param) suit aussi', function () {
    const ctx = monter('<meta name="csrf-param" content="ancien_param"><meta name="csrf-token" content="A">')
    recevoir(ctx, '<html><head><meta name="csrf-param" content="authenticity_token"><meta name="csrf-token" content="B"></head><body><p>B</p></body></html>')
    assert.equal(meta(ctx.document, 'csrf-param'), 'authenticity_token')
    assert.equal(meta(ctx.document, 'csrf-token'), 'B')
  })

  it('page de départ sans jeton : la balise reçue est posée dans <head>, la requête suivante la porte', async function () {
    const ctx = monter('<title>Accueil</title>')
    recevoir(ctx, '<html><head><title>Espace</title><meta name="csrf-token" content="NEUF"></head><body><p>Espace</p></body></html>')
    await ctx.µ.ajax.post('/x', { a: 1 }, () => {})
    assert.equal(ctx.document.head.querySelector('meta[name="csrf-token"]').getAttribute('content'), 'NEUF')
    assert.equal(ctx.envoyes[0], 'NEUF')
  })

  it('page reçue sans balise de jeton : celui de la page reste en place (rien n\'est effacé)', function () {
    const ctx = monter('<meta name="csrf-token" content="GARDE">')
    recevoir(ctx, '<html><head><title>Sans jeton</title></head><body><p>x</p></body></html>')
    assert.equal(meta(ctx.document, 'csrf-token'), 'GARDE')
  })

  it('µ.config.navHead = false : le jeton suit quand même (c\'est du protocole, pas la tête pilotée)', function () {
    const ctx = monter('<title>Avant</title><meta name="csrf-token" content="A">', { navHead: false })
    recevoir(ctx, '<html><head><title>Après</title><meta name="csrf-token" content="B"></head><body><p>x</p></body></html>')
    assert.equal(ctx.document.title, 'Avant', 'navHead=false laisse le titre tranquille')
    assert.equal(meta(ctx.document, 'csrf-token'), 'B')
  })

  it('une balise de jeton dans le CORPS de la page reçue (contenu de la page) n\'est jamais prise', function () {
    const ctx = monter('<meta name="csrf-token" content="VRAI">')
    recevoir(ctx, '<html><head><title>x</title></head><body><div><meta name="csrf-token" content="POSE-PAR-UN-TIERS"></div></body></html>')
    assert.equal(ctx.document.head.querySelector('meta[name="csrf-token"]').getAttribute('content'), 'VRAI')
  })
})

describe('mjs_ujs — le jeton CSRF porté en en-tête par une réponse de navigation (X-CSRF-Token)', function () {
  it('une fiche JSON qui porte X-CSRF-Token : la page le prend, µ.ajax.post part avec lui', async function () {
    const { ctx, fin } = naviguer({ entetes: { 'x-csrf-token': 'APRES' }, corps: { module: 'mjs-x', props: {} } })
    assert.equal(await fin, 'réussite')
    assert.equal(meta(ctx.document, 'csrf-token'), 'APRES', 'une fiche n\'a pas de <head> : la page gardait l\'ancien jeton')
    await ctx.µ.ajax.post('/x', { a: 1 }, () => {})
    assert.equal(ctx.envoyes[0], 'APRES')
  })

  it('un refus (422) qui porte X-CSRF-Token : la page le prend aussi', async function () {
    const { ctx, fin } = naviguer({ statut: 422, entetes: { 'x-csrf-token': 'APRES-REFUS' }, corps: { module: 'mjs-x', props: { errors: {} } } })
    assert.equal(await fin, 'refus')
    assert.equal(meta(ctx.document, 'csrf-token'), 'APRES-REFUS')
  })

  it('réponse d\'une navigation abandonnée pour une plus récente : son jeton n\'est pas repris', async function () {
    const abandon = new AbortController()
    const { ctx, fin } = naviguer({ entetes: { 'x-csrf-token': 'PERIME' }, corps: { module: 'mjs-x' } }, abandon.signal, () => abandon.abort())
    assert.equal(await fin, 'réussite')
    assert.equal(meta(ctx.document, 'csrf-token'), 'AVANT')
  })

  it('réponse venue d\'une autre origine (redirection) : son jeton n\'est pas repris', async function () {
    const { ctx, fin } = naviguer({ url: 'https://tiers.example/x', entetes: { 'x-csrf-token': 'TIERS' }, corps: { module: 'mjs-x' } })
    assert.equal(await fin, 'réussite')
    assert.equal(meta(ctx.document, 'csrf-token'), 'AVANT')
  })

  it('préchargement (requête sans signal d\'abandon) : son jeton n\'est pas repris', async function () {
    const { ctx, fin } = naviguer({ entetes: { 'x-csrf-token': 'SURVOL' }, corps: { module: 'mjs-x' } }, null)
    assert.equal(await fin, 'réussite')
    assert.equal(meta(ctx.document, 'csrf-token'), 'AVANT')
  })
})
