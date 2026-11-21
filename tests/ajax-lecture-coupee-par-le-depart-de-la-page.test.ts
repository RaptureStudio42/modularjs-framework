// Une lecture µajax coupée parce que le visiteur quitte la page (lien suivi, rechargement, adresse changée) ne s'écrit plus en console
// par la fonction d'erreur par défaut ; une vraie panne réseau, page ouverte, reste dite tout de suite, comme avant. Le cœur bâti
// (développement et production) d'une appli en fichier unique qui n'a que µajax, monté dans happy-dom ; fetch est remplacé par une
// demande que le test fait échouer quand il veut. La production se joue sans minification (µ y garde son nom, que la page lit) ; la
// production minifiée est lue sur son texte : la règle du départ y est livrée.
//
// Pourquoi ce test existe : Chromium coupe les requêtes en vol après `pagehide` quand la page part, et le rejet de fetch (« Failed to
// fetch ») allait à µ.ajax.error, qui l'écrivait en console sans regarder si la page partait. Le cœur a déjà sa règle du départ pour ses
// propres chargements (µ._mjs_loadFailed, mjs_init.ts) : rien après `pagehide` ; départ annoncé (navigation vers un autre document,
// `beforeunload`), l'écriture attend la fin des 10 s et ne part que si la page reste. Seule la fonction d'erreur par défaut la suit, pour
// un échec du RÉSEAU (aucune réponse), et la promesse rend ce qu'elle rendait (undefined). Une fonction d'erreur de l'appli — donnée à
// l'appel, µ.ajax.error remplacé, celle de µload — est appelée comme avant, au même moment, et sa valeur reste celle de la promesse : une
// appli qui relance sa lecture depuis elle la perdrait au retour de la page par le cache de navigation. Une réponse du serveur en erreur
// (4xx, 5xx) reste dite. Le texte d'un délai dépassé vient de la table des libellés (groupe `ajax`), dans la langue de la page.
//
// Montage du départ annoncé : `navigator.vendor` posé avant le cœur (comme Chromium, `beforeunload` écouté en permanence), et l'horloge
// de la page reculée de 9,7 s le temps de l'annonce : il reste 300 ms de départ annoncé au moment du rejet.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PAGE      = "<script>\nlire = -> $r = await µajax('/etat')\nverbe = -> µajax.get('/etat', (x) -> $r = x)\n</script>\n<p>{$r}</p>\n"
const PAGE_LOAD = "<script>\n$d = µload('/donnees')\n</script>\n<p>{$d.data}</p>\n"

async function construire(prod: boolean, minifie = false, page = PAGE, nom = 'ajax'): Promise<string> {
  const root   = mjsTmp(`${nom}-depart-${prod ? 'prod' : 'dev'}${minifie ? '-min' : ''}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'page.mjs'), page)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js: 'bundle', env: prod ? 'prod' : 'dev', ...(prod && !minifie ? { minify: false } : {}) } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
}

interface Demande { url: string, ok: (r: any) => void, ko: (e: any) => void }
interface Page { window: any, µ: any, erreurs: string[], demandes: Demande[] }

// une page neuve : le cœur évalué, fetch qui attend le test (et cède à son signal), µ.error relevé (texte seul)
function ouvrir(code: string): Page {
  const window   = new Window({ url: 'http://localhost/' }) as any
  const demandes = [] as Demande[]
  Object.defineProperty(window.navigator, 'vendor', { value: 'Google Inc.', configurable: true })
  const fetch = (url: string, o: any) => new Promise((ok, ko) => {
    demandes.push({ url, ok, ko })
    o?.signal?.addEventListener('abort', () => ko(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })
  Object.defineProperty(window, 'fetch', { value: fetch, configurable: true, writable: true })
  window.eval('(function() { var now = Date.now; Date.now = function() { return now.call(Date) + (globalThis.__decalage || 0); }; })()')
  window.eval(code)
  const µ       = window.µ
  const erreurs = [] as string[]
  assert.equal(typeof µ?.ajax?.get, 'function', 'µ.ajax.get est au cœur')
  µ.error = (...a: any[]) => { erreurs.push(a.map(String).join(' ')) }
  return { window, µ, erreurs, demandes }
}

const evenement = (p: Page, nom: string) => p.window.dispatchEvent(new p.window.Event(nom))

// départ annoncé il y a 9,7 s (horloge de la page reculée le temps de l'annonce) : il en reste 300 ms
function annoncer(p: Page): void {
  p.window.__decalage = -9700
  evenement(p, 'beforeunload')
  p.window.__decalage = 0
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

function espion(rendu?: unknown): { (...a: any[]): unknown, appels: any[][] } {
  const f: any = (...a: any[]) => { f.appels.push(a); return rendu }
  f.appels = []
  return f
}

// l'ordre des rappels d'une lecture : `erreur <message>`, `always`, `succès`
function suivi(ordre: string[], rendu: unknown) {
  return {
    succes: () => { ordre.push('succès') },
    erreur: (e: any) => { ordre.push('erreur ' + e.message); return rendu },
    fin:    () => { ordre.push('always') },
  }
}

const reponse500 = () => ({ ok: false, status: 500, url: '/etat', headers: { get: (n: string) => (n === 'content-type' ? 'text/plain' : null) }, text: async () => 'panne' })

for (const prod of [false, true]) {
  describe(`µajax — une lecture coupée par le départ de la page ne s'écrit pas en console (${prod ? 'production' : 'développement'})`, function () {
    this.timeout(120000)
    let code     = ''
    let codeLoad = ''

    before(async () => {
      code     = await construire(prod)
      codeLoad = await construire(prod, false, PAGE_LOAD, 'load')
    })
    after(async () => { await terminateSharedWorkerPool() })

    it('le cœur d\'une appli qui n\'a que µajax garde la règle du départ', async () => {
      const cœurs = prod ? [code, await construire(true, true)] : [code]
      for (const c of cœurs) assert.ok(/addEventListener\(["']pagehide["']/.test(c), 'l\'écouteur de `pagehide` du cœur est livré')
    })

    it('page cachée (`pagehide`) puis rejet du réseau, sans fonction d\'erreur : rien en console, ni succès ; la promesse rend undefined, comme avant', async () => {
      const p      = ouvrir(code)
      const succes = espion()
      const fin    = espion()
      try {
        const lecture = p.µ.ajax.get('/etat', succes, undefined, fin)
        evenement(p, 'pagehide')
        p.demandes[0].ko(new TypeError('Failed to fetch'))
        const r = await lecture
        await pause(50)
        assert.deepEqual(p.erreurs, [], 'aucune erreur écrite')
        assert.equal(succes.appels.length, 0, 'succès jamais appelé')
        assert.equal(fin.appels.length, 1, 'always une fois')
        assert.equal(r, undefined)
      }
      finally {
        p.window.happyDOM.close()
      }
    })

    it('la fonction d\'erreur de l\'appli est appelée comme avant : page cachée, aussitôt, avant always, et sa valeur est celle de la promesse', async () => {
      const p     = ouvrir(code)
      const ordre = [] as string[]
      const f     = suivi(ordre, 'rendu par l\'appli')
      try {
        const lecture = p.µ.ajax.get('/etat', f.succes, f.erreur, f.fin)
        evenement(p, 'pagehide')
        p.demandes[0].ko(new TypeError('Failed to fetch'))
        for (let i = 0; i < 10; i++) await null
        assert.deepEqual(ordre, ['erreur Failed to fetch', 'always'], 'erreur puis always, avant toute minuterie')
        assert.equal(await lecture, 'rendu par l\'appli')
        assert.deepEqual(p.erreurs, [])
      }
      finally {
        p.window.happyDOM.close()
      }
    })

    it('µ.ajax.error remplacé par l\'appli : c\'est sa fonction, appelée comme avant, page cachée', async () => {
      const p      = ouvrir(code)
      const global = espion('rendu par le gestionnaire de l\'appli')
      try {
        p.µ.ajax.error = global
        const lecture = p.µ.ajax.get('/etat')
        evenement(p, 'pagehide')
        p.demandes[0].ko(new TypeError('Failed to fetch'))
        assert.equal(await lecture, 'rendu par le gestionnaire de l\'appli')
        assert.equal(global.appels.length, 1)
        assert.equal(global.appels[0][0].message, 'Failed to fetch')
      }
      finally {
        p.window.happyDOM.close()
      }
    })

    it('forme appelable (`µajax url`), page cachée : sans `error:`, `await` rend undefined et rien en console ; avec `error:`, elle est appelée, sa valeur est rendue', async () => {
      const p = ouvrir(code)
      try {
        const lecture = p.µ.ajax('/etat')
        evenement(p, 'pagehide')
        p.demandes[0].ko(new TypeError('Failed to fetch'))
        assert.equal(await lecture, undefined)
        await pause(50)
        assert.deepEqual(p.erreurs, [])
        const erreur = espion('repli')
        const avec   = p.µ.ajax('/etat', { error: erreur })
        p.demandes[1].ko(new TypeError('Failed to fetch'))
        assert.equal(await avec, 'repli')
        assert.equal(erreur.appels.length, 1)
      }
      finally {
        p.window.happyDOM.close()
      }
    })

    it('départ annoncé, la page reste (réponse 204, téléchargement) : la promesse rend undefined aussitôt, puis l\'écriture en console part en retard, une fois', async () => {
      const p      = ouvrir(code)
      const succes = espion()
      const fin    = espion()
      try {
        annoncer(p)
        const lecture = p.µ.ajax.get('/etat', succes, undefined, fin)
        p.demandes[0].ko(new TypeError('Failed to fetch'))
        const r = await lecture
        assert.deepEqual(p.erreurs, [], 'rien tant que le départ peut aboutir')
        assert.equal(r, undefined)
        assert.equal(fin.appels.length, 1)
        const debut = Date.now()
        while (!p.erreurs.length && Date.now() - debut < 3000) await pause(20)
        await pause(50)
        assert.deepEqual(p.erreurs, ['Failed to fetch'], 'l\'erreur part, une fois, la page étant restée')
        assert.equal(succes.appels.length, 0)
      }
      finally {
        p.window.happyDOM.close()
      }
    })

    it('départ annoncé, fonction d\'erreur de l\'appli : appelée aussitôt, avant always, une seule fois (ordre d\'avant)', async () => {
      const p     = ouvrir(code)
      const ordre = [] as string[]
      const f     = suivi(ordre, 'rendu par l\'appli')
      try {
        annoncer(p)
        const lecture = p.µ.ajax.get('/etat', f.succes, f.erreur, f.fin)
        p.demandes[0].ko(new TypeError('Failed to fetch'))
        assert.equal(await lecture, 'rendu par l\'appli')
        assert.deepEqual(ordre, ['erreur Failed to fetch', 'always'])
        await pause(500)
        assert.deepEqual(ordre, ['erreur Failed to fetch', 'always'], 'aucun second appel après l\'attente')
      }
      finally {
        p.window.happyDOM.close()
      }
    })

    it('départ annoncé puis confirmé (`pagehide` avant la fin de l\'attente) : rien, même après l\'attente', async () => {
      const p = ouvrir(code)
      try {
        annoncer(p)
        const lecture = p.µ.ajax.get('/etat')
        p.demandes[0].ko(new TypeError('Failed to fetch'))
        await lecture
        evenement(p, 'pagehide')
        await pause(600)
        assert.deepEqual(p.erreurs, [])
      }
      finally {
        p.window.happyDOM.close()
      }
    })

    it('sans départ : l\'erreur part tout de suite (sans minuterie), sa valeur est celle de la promesse, puis always ; rien en succès', async () => {
      const p     = ouvrir(code)
      const ordre = [] as string[]
      const f     = suivi(ordre, 'rendu par l\'appli')
      try {
        const lecture = p.µ.ajax.get('/etat', f.succes, f.erreur, f.fin)
        p.demandes[0].ko(new TypeError('Failed to fetch'))
        for (let i = 0; i < 10; i++) await null
        assert.deepEqual(ordre, ['erreur Failed to fetch', 'always'], 'erreur puis always, avant toute minuterie')
        assert.equal(await lecture, 'rendu par l\'appli')
        const parDefaut = p.µ.ajax.get('/etat')
        p.demandes[1].ko(new TypeError('Failed to fetch'))
        for (let i = 0; i < 10; i++) await null
        assert.deepEqual(p.erreurs, ['Failed to fetch'], 'µ.ajax.error l\'écrit, tout de suite')
        assert.equal(await parDefaut, undefined)
      }
      finally {
        p.window.happyDOM.close()
      }
    })

    it('réponse du serveur en erreur (500), page cachée : elle reste dite (seul l\'échec du réseau suit la règle du départ)', async () => {
      const p = ouvrir(code)
      try {
        const lecture = p.µ.ajax.get('/etat')
        evenement(p, 'pagehide')
        p.demandes[0].ok(reponse500())
        await lecture
        assert.deepEqual(p.erreurs, ['HTTP Error 500 (Non-JSON response)'])
      }
      finally {
        p.window.happyDOM.close()
      }
    })

    it('µload : sa fonction d\'erreur est la sienne ; page cachée puis rejet du réseau, la poignée porte l\'erreur, comme avant', async () => {
      const p = ouvrir(codeLoad)
      try {
        const h = p.µ.load('/donnees')
        void h.data
        await pause(0)
        assert.equal(p.demandes.length, 1, 'la lecture est partie')
        evenement(p, 'pagehide')
        p.demandes[0].ko(new TypeError('Failed to fetch'))
        // lue avant la minuterie qui oublie une entrée que rien ne lit (µload, _mjsLdUnread)
        for (let i = 0; i < 20; i++) await null
        assert.equal(h.error?.message, 'Failed to fetch')
        assert.equal(h.pending, false)
      }
      finally {
        p.window.happyDOM.close()
      }
    })

    it('délai dépassé (`timeout:`) sans départ : le texte vient de la table des libellés, dans la langue de la page, et part tout de suite', async () => {
      for (const [lang, texte] of [['fr', 'Requête expirée après 20ms (timeout)'], ['en', 'Request timed out after 20ms (timeout)']]) {
        const p     = ouvrir(code)
        const ordre = [] as string[]
        const f     = suivi(ordre, undefined)
        try {
          p.window.document.documentElement.lang = lang
          const lecture = p.µ.ajax.get('/etat', f.succes, f.erreur, f.fin, 20)
          const parDefaut = p.µ.ajax.get('/etat', undefined, undefined, undefined, 20)
          await lecture
          await parDefaut
          assert.deepEqual(ordre, ['erreur ' + texte, 'always'], lang)
          assert.deepEqual(p.erreurs, [texte], lang)
        }
        finally {
          p.window.happyDOM.close()
        }
      }
    })
  })
}
