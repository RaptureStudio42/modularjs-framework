// un effet dont la pose (`setup`) lève ne laisse rien sur la balise : ni son jeton `mjs-fx`, ni ses variables CSS, ni l'arrondi
// pris pour son cadre, ni sa place parmi les effets lourds que suit la garde de cadence. Rien n'étant inscrit pour le retirer,
// ce qui restait restait pour toujours (et une nouvelle pose du même effet se croyait déjà là). L'erreur, elle, remonte comme avant.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const ICI    = dirname(fileURLToPath(import.meta.url))
const MOTEUR = readFileSync(join(ICI, '../src/runtime/mjs_fx.ts'), 'utf-8')

describe('effets — une pose qui lève ne laisse rien derrière elle', () => {
  it('jeton, variables CSS, arrondi et suivi des effets lourds défaits ; l\'erreur remonte ; une pose suivante réussit', () => {
    const window: any = new Window({ url: 'http://localhost/' })
    const µ: any = {
      warn: () => {},
      error: () => {},
      _mjs_msg: (_cle: string, vars: Record<string, string> | null, texte: string) => texte.replace(/\{(\w+)\}/g, (_m, n) => String(vars?.[n] ?? ''))
    }
    window.eval(`globalThis.__charge = function(µ) {\n${MOTEUR}\n}`)
    window.__charge(µ)
    // la garde de cadence reçoit l'ensemble des effets lourds posés
    let lourds: Set<any> | null = null
    µ._mjs_fxGauge = (h: Set<any>) => { lourds = h }
    let casse = true
    µ._mjs_fxDefs.casse = {
      css: '',
      vars: { k: 'px' },
      radius: true,
      heavy: true,
      setup: () => {
        if (casse) throw new Error('pose ratée')
        return () => {}
      }
    }
    const el = window.document.body.appendChild(window.document.createElement('div'))
    el.style.borderRadius = '3px'
    assert.throws(() => µ._mjs_fx(null, el, 'casse', { k: 4, radius: 9 }), /pose ratée/, 'l\'erreur de la pose remonte')
    assert.equal(el.getAttribute('mjs-fx'), null, 'aucun jeton')
    assert.equal(el.style.getPropertyValue('--mjs-casse-k'), '', 'aucune variable CSS')
    assert.equal(el.style.borderRadius, '3px', 'l\'arrondi de l\'auteur est rendu')
    assert.ok(lourds, 'la garde a été prévenue')
    assert.equal(lourds!.size, 0, 'plus suivi parmi les effets lourds')
    assert.ok(!el._mjs_fxOff || !el._mjs_fxOff.casse, 'aucun retrait inscrit pour un effet qui n\'est pas là')
    // la pose suivante, réussie, se fait en entier
    casse = false
    const off = µ._mjs_fx(null, el, 'casse', { k: 4, radius: 9 })
    assert.equal(el.getAttribute('mjs-fx'), 'casse')
    assert.equal(el.style.getPropertyValue('--mjs-casse-k'), '4px')
    assert.equal(el.style.borderRadius, '9px')
    assert.equal(lourds!.size, 1)
    off()
    assert.equal(el.getAttribute('mjs-fx'), null)
    assert.equal(el.style.borderRadius, '3px')
    assert.equal(lourds!.size, 0)
  })
})
