// Lien `@method="delete"` vers une autre origine : la navigation ne prend jamais un lien qui sort du site,
// le navigateur le suivrait lui-même, en GET — le verbe était perdu sans un mot, la garde d'origine rendant la
// main avant l'avertissement donné pour un clic avec Ctrl, `target` ou `download`. Même avertissement
// désormais, une fois par lien ; le clic est retenu, à chaque fois : rien ne part. Un lien externe sans
// `@method`, ou un `mailto:` (aucun GET), ne dit rien et reste au navigateur.
//
// Méthode : happy-dom, vrai µ._mjs_ujsOnClick et bloc des aides de navigation ; µ._mjs_navDispatch
// remplacé par un relevé.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { extractMarked } from './helpers/extract-marked.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')

function monter(html: string) {
  const win: any = new Window({ url: 'http://localhost/posts' })
  const document: any = win.document
  document.body.innerHTML = html
  const avert: string[] = []
  const envois: string[] = []
  const µ: any = { warn: (m: string) => avert.push(String(m)), error() {}, log() {}, realTarget: (e: any) => e.target, pageCache: new Map(), _mjs_preloadCache: new Map(), _mjs_preloaded: new Set(), _mjs_lastUjsPath: '/posts', _mjs_navSeq: 0, _mjs_saveScroll() {} }
  poserMessages(µ)
  const code = ['helpers-navigation', '_mjs_ujsOnClick'].map(m => extractMarked(UJS_SRC, m)).join('\n')
  new Function('µ', 'document', 'window', 'DOMParser', 'FormData', code)(µ, document, win, win.DOMParser, win.FormData)
  µ._mjs_navDispatch = (url: string, verbe: string) => { envois.push(verbe + ' ' + url) }
  return { µ, avert, envois, lien: document.querySelector('a') }
}

function clic(lien: any) {
  return { target: lien, button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault(this: any) { this.defaultPrevented = true }, stopImmediatePropagation() {} }
}

describe('mjs_ujs — lien @method vers une autre origine : averti', function () {
  const cas: Array<[string, string]> = [
    ['autre site', 'https://autre.example/posts/1'],
    ['même hôte, autre port', 'http://localhost:8080/posts/1']
  ]
  for (const [nom, href] of cas) {
    it(nom + ' : clic retenu, rien ne part, un avertissement (une fois par lien)', function () {
      const { µ, avert, envois, lien } = monter('<a href="' + href + '" mjs-method="delete">Supprimer</a>')
      const e = clic(lien)
      µ._mjs_ujsOnClick(e)
      assert.equal(e.defaultPrevented, true, 'clic retenu : le navigateur le suivrait en GET, sans le verbe')
      assert.deepEqual(envois, [])
      assert.equal(avert.length, 1, 'AVANT : GET muet, aucun avertissement')
      assert.match(avert[0], /@method="delete"/)
      assert.match(avert[0], /autre origine/)
      const e2 = clic(lien)
      µ._mjs_ujsOnClick(e2)
      assert.equal(e2.defaultPrevented, true, 'retenu à chaque clic')
      assert.equal(avert.length, 1, 'une fois par lien')
    })
  }

  it('deux liens vers une autre origine : chacun son avertissement', function () {
    const { µ, avert, lien } = monter('<a href="https://autre.example/a" mjs-method="delete">A</a><a href="https://autre.example/b" mjs-method="post">B</a>')
    µ._mjs_ujsOnClick(clic(lien))
    µ._mjs_ujsOnClick(clic(lien.nextElementSibling))
    assert.equal(avert.length, 2)
    assert.match(avert[1], /@method="post"/)
  })

  it('lien externe sans @method : rien à dire', function () {
    const { µ, avert, envois, lien } = monter('<a href="https://autre.example/posts/1">Voir</a>')
    const e = clic(lien)
    µ._mjs_ujsOnClick(e)
    assert.equal(e.defaultPrevented, false)
    assert.deepEqual(envois, [])
    assert.deepEqual(avert, [])
  })

  it('mailto: avec @method : aucun GET, rien à dire', function () {
    const { µ, avert, envois, lien } = monter('<a href="mailto:contact@example.com" mjs-method="delete">Écrire</a>')
    const e = clic(lien)
    µ._mjs_ujsOnClick(e)
    assert.equal(e.defaultPrevented, false)
    assert.deepEqual(envois, [])
    assert.deepEqual(avert, [])
  })
})
