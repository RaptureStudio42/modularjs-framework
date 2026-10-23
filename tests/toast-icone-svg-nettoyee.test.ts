// µ.modal.notify(message, { icon }) (mjs_modal.ts) : une icône en texte qui commence par `<svg` n'exécute jamais de code. Une
// appli qui passe l'adresse d'un avatar d'utilisateur en icône (`icon: user.avatar`) recevait sinon le HTML de cet utilisateur
// en innerHTML. Le texte est analysé sans rien exécuter et retenu seulement s'il n'est qu'UN <svg> (rien avant, rien après),
// sinon l'icône du type reste ; dans le SVG retenu, script, foreignObject, éléments HTML (glissés dans desc ou title),
// attributs on* et valeurs en javascript: sont retirés, le dessin reste. Même assemblage que mjs-modal-notify-icone.test.ts ;
// l'absence d'exécution réelle est vérifiée dans Chromium par modale-rideaux-fantome-et-flip-browser.test.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')
const sansEsm = (s: string): string => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')

function charger(): { window: any; document: any; µ: any } {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${sansEsm(lire('mjs_init.ts'))}\n${lire('mjs_page_cache.ts')}\n${lire('mjs_modal.ts')}\nglobalThis.µ = µ;`)
  return { window, document: window.document, µ: window.µ }
}

const icone = (document: any): any => document.body.querySelector('.mjs-toast-icon')
const balises = (el: any): string[] => Array.from(el.querySelectorAll('*')).map((e: any) => e.localName.toLowerCase())
// tout attribut on*, toute animation qui vise un on* et toute valeur en javascript: (espaces et caractères de contrôle
// ôtés, comme le fait le navigateur pour une adresse) de la case d'icône, élément par élément
function dangers(el: any): string[] {
  const vus: string[] = []
  for (const e of [el, ...Array.from(el.querySelectorAll('*'))] as any[]) {
    for (const a of Array.from(e.attributes) as any[]) {
      const visee = /^attributename$/i.test(a.name) && /^\s*on/i.test(a.value)
      if (/^on/i.test(a.name) || visee || /javascript:/i.test(a.value.replace(/[\x00-\x20]+/g, ''))) { vus.push(e.localName + '[' + a.name + ']') }
    }
  }
  return vus
}

// tracé de l'icône du type info : ce qui reste quand le texte est refusé
const TRACE_INFO = 'M12 11v5.5'

describe('mjs_modal — µ.modal.notify, une icône « <svg… » en texte ne lance aucun code', function () {
  for (const [nom, texte] of [
    ['du HTML après le SVG', '<svg></svg><img src="x" onerror="window.__pwn=1">'],
    ['du texte après le SVG', '<svg viewBox="0 0 10 10"></svg> et la suite'],
    ['deux SVG', '<svg class="un"></svg><svg class="deux"></svg>'],
  ] as const) {
    it(`${nom} : refusé, l'icône du type reste et rien n'est injecté`, function () {
      const { document, µ } = charger()
      µ.modal.notify('Message de Bob', { type: 'info', icon: texte })
      const i = icone(document)
      assert.ok(i.innerHTML.includes(TRACE_INFO), 'l\'icône du type info est posée')
      assert.equal(i.querySelectorAll('img').length, 0, 'aucune image injectée')
      assert.deepEqual(dangers(document.body), [])
    })
  }

  // un cas par piège : l'analyseur de happy-dom avale tout ce qui suit un <script> dans un SVG, et garde dans l'espace de
  // noms SVG un <img> glissé dans <desc> (un vrai navigateur le met en HTML : retiré, cf. le test Chromium)
  for (const [nom, texte, interdits] of [
    ['gestionnaire sur le <svg>', '<svg class="mien" viewBox="0 0 10 10" onload="window.__pwn=1"><path d="M0 0h10v10z"/></svg>', []],
    ['foreignObject', '<svg class="mien"><foreignObject width="10" height="10"><img src="x" onerror="window.__pwn=3"></foreignObject><path d="M0 0h10v10z"/></svg>', ['foreignobject', 'img']],
    ['HTML glissé dans desc', '<svg class="mien"><desc>avatar<img src="x" onerror="window.__pwn=4"></desc><path d="M0 0h10v10z"/></svg>', []],
    ['lien javascript: et onclick', '<svg class="mien"><a href="javascript:window.__pwn=5"><path d="M0 0h10v10z" onclick="window.__pwn=6"/></a></svg>', []],
    ['animation vers javascript: ou vers un on*', '<svg class="mien"><a><animate attributeName="href" values="java&#x09;script:window.__pwn=7"/><set attributeName="onclick" to="window.__pwn=8"/><path d="M0 0h10v10z"/></a></svg>', []],
    ['script', '<svg class="mien"><path d="M0 0h10v10z"/><script>window.__pwn=2</script></svg>', ['script']],
  ] as Array<[string, string, string[]]>) {
    it(`dans le SVG retenu, ${nom} : retiré, le dessin reste`, function () {
      const { document, µ } = charger()
      µ.modal.notify('x', { icon: texte })
      const i = icone(document)
      assert.equal(i.firstElementChild.localName.toLowerCase(), 'svg', 'le SVG est posé')
      assert.ok(i.querySelector('.mien'))
      assert.equal(i.querySelector('path').getAttribute('d'), 'M0 0h10v10z', 'le dessin reste')
      const restes = balises(i)
      for (const interdit of interdits) { assert.ok(!restes.includes(interdit), `aucun ${interdit} : ${restes.join(', ')}`) }
      assert.deepEqual(dangers(document.body), [])
    })
  }

  it('un SVG propre est posé tel quel, avec ses attributs', function () {
    const { document, µ } = charger()
    µ.modal.notify('x', { type: 'success', icon: '  <svg viewBox="0 0 10 10" class="mien"><g fill="red"><path d="M0 0h10v10z"/></g></svg>\n' })
    const i = icone(document)
    assert.equal(i.children.length, 1)
    assert.equal(i.querySelector('.mien').getAttribute('viewBox'), '0 0 10 10')
    assert.equal(i.querySelector('g').getAttribute('fill'), 'red')
    assert.ok(!i.innerHTML.includes('M7.5 12.5l3 3 6-7'), 'l\'icône du type n\'est plus là')
  })
})
