// Lien `@method="delete"` que le navigateur suivrait lui-même (clic avec Ctrl, Maj, Alt ou Cmd, attribut
// `target` ou `download`) : parti au navigateur, qui ne sait faire qu'un GET, le verbe serait perdu. Le
// clic est retenu, à chaque fois — rien ne part — et un avertissement le dit, une fois par lien, comme
// pour `@noUJS` + `@method`.
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

function monter(attrs: string) {
  const win: any = new Window({ url: 'http://localhost/posts' })
  const document: any = win.document
  document.body.innerHTML = '<a href="/posts/1" mjs-method="delete" ' + attrs + '>Supprimer</a>'
  const avert: string[] = []
  const envois: string[] = []
  const µ: any = { warn: (m: string) => avert.push(String(m)), error() {}, log() {}, realTarget: (e: any) => e.target, pageCache: new Map(), _mjs_preloadCache: new Map(), _mjs_preloaded: new Set(), _mjs_lastUjsPath: '/posts', _mjs_navSeq: 0, _mjs_saveScroll() {} }
  poserMessages(µ)
  const code = ['helpers-navigation', '_mjs_ujsOnClick'].map(m => extractMarked(UJS_SRC, m)).join('\n')
  new Function('µ', 'document', 'window', 'DOMParser', 'FormData', code)(µ, document, win, win.DOMParser, win.FormData)
  µ._mjs_navDispatch = (url: string, verbe: string) => { envois.push(verbe + ' ' + url) }
  return { µ, avert, envois, lien: document.querySelector('a') }
}

function clic(lien: any, mods: any = {}) {
  return Object.assign({ target: lien, button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault(this: any) { this.defaultPrevented = true }, stopImmediatePropagation() {} }, mods)
}

describe('mjs_ujs — lien @method suivi par le navigateur : averti', function () {
  const cas: Array<[string, string, any]> = [
    ['Ctrl-clic', '', { ctrlKey: true }],
    ['Cmd-clic', '', { metaKey: true }],
    ['target="_blank"', 'target="_blank"', {}],
    ['download', 'download', {}]
  ]
  for (const [nom, attrs, mods] of cas) {
    it(nom + ' : clic retenu, rien ne part, un avertissement (une fois par lien)', function () {
      const { µ, avert, envois, lien } = monter(attrs)
      const e = clic(lien, mods)
      µ._mjs_ujsOnClick(e)
      assert.equal(e.defaultPrevented, true, 'clic retenu : le navigateur le suivrait en GET, sans le verbe')
      assert.deepEqual(envois, [])
      assert.equal(avert.length, 1, 'AVANT : GET muet, aucun avertissement')
      assert.match(avert[0], /@method="delete"/)
      const e2 = clic(lien, mods)
      µ._mjs_ujsOnClick(e2)
      assert.equal(e2.defaultPrevented, true, 'retenu à chaque clic')
      assert.equal(avert.length, 1, 'une fois par lien')
    })
  }

  it('clic simple : la requête DELETE part, aucun avertissement', function () {
    const { µ, avert, envois, lien } = monter('')
    const e = clic(lien)
    µ._mjs_ujsOnClick(e)
    assert.equal(e.defaultPrevented, true)
    assert.deepEqual(envois, ['DELETE http://localhost/posts/1'])
    assert.deepEqual(avert, [])
  })
})
