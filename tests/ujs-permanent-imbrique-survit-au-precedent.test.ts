// Élément `mjs-permanent` placé dans une enveloppe (cas courant : `<div class="app">…<div id="player"
// mjs-permanent>`) : le nœud vivant traverse la navigation A → B, puis doit revenir dans la page A
// quand un Précédent la ressort du cache de pages. Avant, il quittait l'arbre de A sans rien laisser
// à sa place : au retour, la page restaurée n'avait plus de lecteur et le nœud vivant était détaché
// (un <audio> s'arrête). Enfant direct du contenant, il survivait déjà (témoin).
//
// La place laissée dans l'arbre qui part est tenue par un nœud inerte du même id, jamais par la
// copie reçue : celle-ci, posée dans la page encore affichée, y serait connectée (composant monté,
// <iframe> chargée, <audio autoplay> lancé) avant que l'arbre ne parte au cache.
//
// Méthode : happy-dom (DOM réel, vrais Custom Elements), vrais blocs `helpers-navigation` et
// `popstate-listener` ; navigation A → B par le chemin du clic réseau (hibernation puis installation).

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { extractMarked, extractMarkedBody } from './helpers/extract-marked.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')
// une navigation par geste : le geste suivant (clic, Précédent) n'arrive jamais dans la même tâche
const geste = () => new Promise<void>(r => setTimeout(r, 0))

function monter(htmlA: string) {
  const win: any = new Window({ url: 'http://localhost/a' })
  const document: any = win.document
  const connexions: string[] = []
  win.customElements.define('x-lecteur', class extends win.HTMLElement { connectedCallback() { connexions.push(this.getAttribute('data-nom')) } })
  document.body.innerHTML = htmlA
  const µ: any = { warn() {}, error() {}, log() {} }
  poserMessages(µ)
  new Function('µ', 'document', 'window', extractMarked(UJS_SRC, 'helpers-navigation'))(µ, document, win)
  Object.assign(µ, { pageCache: new Map(), _mjs_lastUjsPath: '/a', _mjs_navSeq: 0, _mjs_saveScroll() {}, _mjs_restoreScroll() {}, Router: { navigate() {} } })
  const popstate = new Function('e', 'µ', 'window', 'document', 'DOMParser', extractMarkedBody(UJS_SRC, 'popstate-listener'))
  return { win, document, µ, connexions, popstate }
}

// départ vers `chemin` par le clic réseau : la page affichée est hibernée, la réponse installée
async function aller(ctx: any, depuis: string, chemin: string, htmlRecu: string) {
  ctx.µ._mjs_navHibernate(ctx.µ._mjs_navCacheZone(), depuis)
  const doc = new ctx.win.DOMParser().parseFromString('<html><body>' + htmlRecu + '</body></html>', 'text/html')
  ctx.µ._mjs_navInstallNodes({ zone: ctx.document.body, mode: 'body', target: null }, Array.prototype.slice.call(doc.body.childNodes), 'update', 'cache-first')
  ctx.µ._mjs_lastUjsPath = chemin
  await geste()
}

// Précédent / Suivant vers `chemin`, servi par le cache de pages
async function historique(ctx: any, chemin: string) {
  ctx.popstate({}, ctx.µ, { location: { pathname: chemin, search: '', hash: '' } }, ctx.document, ctx.win.DOMParser)
  await geste()
}

const A_IMBRIQUE = '<div class="app"><p>A</p><x-lecteur id="player" mjs-permanent data-nom="vivant"></x-lecteur></div>'
const B_IMBRIQUE = '<div class="app"><p>B</p><x-lecteur id="player" mjs-permanent data-nom="copie B"></x-lecteur></div>'

describe('mjs_ujs — mjs-permanent imbriqué et Précédent servi par le cache', function () {
  it('témoin : permanent ENFANT DIRECT du contenant, il revient au Précédent', async function () {
    const ctx = monter('<p>A</p><x-lecteur id="player" mjs-permanent data-nom="vivant"></x-lecteur>')
    const vivant = ctx.document.getElementById('player')
    await aller(ctx, '/a', '/b', '<p>B</p><x-lecteur id="player" mjs-permanent data-nom="copie B"></x-lecteur>')
    await historique(ctx, '/a')
    assert.ok(ctx.document.getElementById('player') === vivant)
    assert.equal(ctx.document.body.textContent, 'A')
  })

  it('permanent IMBRIQUÉ dans une enveloppe : le nœud vivant est dans la page A restaurée', async function () {
    const ctx = monter(A_IMBRIQUE)
    const vivant = ctx.document.getElementById('player')
    await aller(ctx, '/a', '/b', B_IMBRIQUE)
    assert.ok(ctx.document.getElementById('player') === vivant, 'sur B : le vivant a traversé')
    await historique(ctx, '/a')
    assert.ok(ctx.document.getElementById('player') === vivant, 'AVANT : #player absent de la page restaurée, nœud vivant détaché')
    assert.equal(vivant.isConnected, true)
    assert.equal(ctx.document.querySelector('.app p').textContent, 'A')
    assert.equal(ctx.document.querySelectorAll('#player').length, 1, 'un seul #player dans la page')
  })

  it('aller, Précédent, Suivant : le même nœud vivant à chaque étape', async function () {
    const ctx = monter(A_IMBRIQUE)
    const vivant = ctx.document.getElementById('player')
    await aller(ctx, '/a', '/b', B_IMBRIQUE)
    await historique(ctx, '/a')
    await historique(ctx, '/b')
    assert.equal(ctx.document.querySelector('.app p').textContent, 'B')
    assert.ok(ctx.document.getElementById('player') === vivant)
    await historique(ctx, '/a')
    assert.equal(ctx.document.querySelector('.app p').textContent, 'A')
    assert.ok(ctx.document.getElementById('player') === vivant)
  })

  it('la copie reçue n\'est jamais connectée à la page (pas de second lecteur monté)', async function () {
    const ctx = monter(A_IMBRIQUE)
    await aller(ctx, '/a', '/b', B_IMBRIQUE)
    await historique(ctx, '/a')
    await historique(ctx, '/b')
    assert.equal(ctx.connexions.indexOf('copie B'), -1, 'connexions vues : ' + JSON.stringify(ctx.connexions))
  })
})
