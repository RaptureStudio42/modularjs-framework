// *shatter découpe l'image en tuiles de `size` px : sur une grande image et une petite taille (`size: 4`, que le catalogue permet),
// le nombre de tuiles n'avait pas de borne — 90 000 éléments pour une image de 1600 × 900, la page figée plus de 30 s. Jamais plus
// de 2 500 tuiles : les tuiles grandissent autant qu'il faut, et couvrent toujours l'image entière ; une image ordinaire garde la
// taille demandée.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const ICI     = dirname(fileURLToPath(import.meta.url))
const ECLATS  = readFileSync(join(ICI, '../src/runtime/animations/shatter.ts'), 'utf-8')
const IMAGE   = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22/%3E'

// une image de `w` × `h` px jouée à mi-chemin : les tuiles du calque posé devant elle
function tuiles(w: number, h: number, size: number) {
  const window: any = new Window({ url: 'http://localhost/' })
  const µ: any = { anim: {}, easing: { resolve: () => (t: number) => t, linear: (t: number) => t } }
  window.eval(`globalThis.__charge = function(µ) {\nµ.anim.shatter = ${ECLATS.trim()}\n}`)
  window.__charge(µ)
  const img = window.document.body.appendChild(window.document.createElement('img'))
  img.src = IMAGE
  Object.defineProperty(img, 'offsetWidth', { value: w })
  Object.defineProperty(img, 'offsetHeight', { value: h })
  const cfg = µ.anim.shatter({ size }).intro(img)
  cfg.tick(0.5)
  const calque = img.previousElementSibling
  const liste  = calque ? Array.from(calque.children) as any[] : []
  const cote   = liste.length > 0 ? parseFloat(liste[0].style.width) : 0
  const bout   = liste.length > 0 ? liste[liste.length - 1] : null
  cfg.cleanup()
  return { n: liste.length, cote, finX: bout ? parseFloat(bout.style.left) + cote : 0, finY: bout ? parseFloat(bout.style.top) + cote : 0 }
}

describe('*shatter — jamais plus de 2 500 tuiles', () => {
  it('une image de 400 × 300 à size: 4 (7 500 tuiles demandées) : 2 500 au plus, l\'image couverte en entier', () => {
    const r = tuiles(400, 300, 4)
    assert.ok(r.n > 0, 'des tuiles sont posées')
    assert.ok(r.n <= 2500, 'tuiles : ' + r.n)
    assert.ok(r.cote > 4, 'les tuiles ont grandi : ' + r.cote)
    assert.ok(r.finX >= 400 && r.finY >= 300, 'la dernière tuile atteint le coin de l\'image : ' + r.finX + ' × ' + r.finY)
  })

  it('une image ordinaire garde la taille de tuile demandée', () => {
    const r = tuiles(200, 100, 20)
    assert.equal(r.n, 50)
    assert.equal(r.cote, 20)
  })
})
