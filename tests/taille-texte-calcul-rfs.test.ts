// la taille du texte écrite en px devient adaptable à l'écran à la construction : le calcul est celui de la fonction RFS
// (rfs.sass, réglages par défaut : seuil 1.25rem, sortie en rem, bascule 1200px, facteur 10, une dimension). Les valeurs
// attendues ont été relevées UNE fois par Dart Sass sur rfs.sass (`rfs-fluid-value` sous la bascule, `rfs-value` au-dessus),
// arrondis compris ; une taille au seuil ou dessous ne bouge jamais

import assert from 'node:assert/strict'
import { fontSizeSettings, rfsSize, rewriteFontSizes, fontSizeRootCss } from '../src/transpiler/font-size.js'

const TAILLES = [12, 16, 20, 20.5, 24, 30, 41.5, 64, 100]

const ATTENDU: Record<string, { reglage: unknown, valeurs: Record<string, [string, string] | null> }> = {
  'par défaut': {
    reglage: true,
    valeurs: {
      '12': null, '16': null, '20': null,
      '20.5': ['calc(1.253125rem + 0.0375vw)', '1.28125rem'],
      '24':   ['calc(1.275rem + 0.3vw)', '1.5rem'],
      '30':   ['calc(1.3125rem + 0.75vw)', '1.875rem'],
      '41.5': ['calc(1.384375rem + 1.6125vw)', '2.59375rem'],
      '64':   ['calc(1.525rem + 3.3vw)', '4rem'],
      '100':  ['calc(1.75rem + 6vw)', '6.25rem'],
    },
  },
  'base 14': {
    reglage: { base: 14 },
    valeurs: {
      '12':   null,
      '16':   ['calc(0.8875rem + 0.15vw)', '1rem'],
      '20':   ['calc(0.9125rem + 0.45vw)', '1.25rem'],
      '20.5': ['calc(0.915625rem + 0.4875vw)', '1.28125rem'],
      '24':   ['calc(0.9375rem + 0.75vw)', '1.5rem'],
      '30':   ['calc(0.975rem + 1.2vw)', '1.875rem'],
      '41.5': ['calc(1.046875rem + 2.0625vw)', '2.59375rem'],
      '64':   ['calc(1.1875rem + 3.75vw)', '4rem'],
      '100':  ['calc(1.4125rem + 6.45vw)', '6.25rem'],
    },
  },
  'unit px': {
    reglage: { unit: 'px' },
    valeurs: {
      '12': null, '16': null, '20': null,
      '20.5': ['calc(20.05px + 0.0375vw)', '20.5px'],
      '24':   ['calc(20.4px + 0.3vw)', '24px'],
      '30':   ['calc(21px + 0.75vw)', '30px'],
      '41.5': ['calc(22.15px + 1.6125vw)', '41.5px'],
      '64':   ['calc(24.4px + 3.3vw)', '64px'],
      '100':  ['calc(28px + 6vw)', '100px'],
    },
  },
}

describe('taille du texte adaptée à l\'écran — calcul RFS', () => {
  for (const [nom, { reglage, valeurs }] of Object.entries(ATTENDU)) {
    it(`réglage ${nom} : chaque taille rendue comme Dart Sass sur rfs.sass`, () => {
      const reglages = fontSizeSettings(reglage)!
      for (const taille of TAILLES) {
        const attendu = valeurs[String(taille)]
        const recu    = rfsSize(taille, reglages)
        assert.deepEqual(recu === null ? null : [recu.fluid, recu.fixed], attendu, `${taille}px`)
      }
    })
  }

  it('réglages : absent ou true = par défaut, false = coupé, objet = réglages par défaut complétés', () => {
    assert.deepEqual(fontSizeSettings(undefined), { base: 20, breakpoint: 1200, factor: 10, unit: 'rem' })
    assert.deepEqual(fontSizeSettings(true), { base: 20, breakpoint: 1200, factor: 10, unit: 'rem' })
    assert.equal(fontSizeSettings(false), undefined)
    assert.deepEqual(fontSizeSettings({ base: 14 }), { base: 14, breakpoint: 1200, factor: 10, unit: 'rem' })
  })

  it('CSS : seule une déclaration font-size en px seul change, une variable par valeur, !important gardé', () => {
    const reglages = fontSizeSettings(true)!
    const css = '.a{font-size:41.5px}.b{color:red;font-size: 41.50px !important}.c{font-size:12px}.d{font-size:2rem}'
      + '.e{font-size:calc(10px + 1vw)}.f{font:30px serif}.g{--font-size:30px}.h{content:";font-size:30px"}'
      + '/* .i{font-size:30px} */.j{FONT-SIZE:64PX}@media (min-width:600px){.k{font-size:64px}}.l{font-size:var(--x)}'
    const { css: sortie, sizes } = rewriteFontSizes(css, reglages)
    assert.equal(sortie, '.a{font-size:var(--mjs-fs-41_5)}.b{color:red;font-size: var(--mjs-fs-41_5) !important}.c{font-size:12px}.d{font-size:2rem}'
      + '.e{font-size:calc(10px + 1vw)}.f{font:30px serif}.g{--font-size:30px}.h{content:";font-size:30px"}'
      + '/* .i{font-size:30px} */.j{FONT-SIZE:var(--mjs-fs-64)}@media (min-width:600px){.k{font-size:var(--mjs-fs-64)}}.l{font-size:var(--x)}')
    assert.deepEqual(sizes, ['41.5', '64'])
    // au seuil ou dessous : rien ne bouge, aucune variable
    assert.deepEqual(rewriteFontSizes('.a{font-size:20px}.b{font-size:16px}', reglages), { css: '.a{font-size:20px}.b{font-size:16px}', sizes: [] })
  })

  it('bloc :root : la taille fluide sous la bascule, la taille écrite au-dessus, valeurs rangées', () => {
    assert.equal(fontSizeRootCss(['64', '41.5'], fontSizeSettings(true)!),
      ':root{--mjs-fs-41_5:calc(1.384375rem + 1.6125vw);--mjs-fs-64:calc(1.525rem + 3.3vw)}'
      + '@media (min-width:1200px){:root{--mjs-fs-41_5:2.59375rem;--mjs-fs-64:4rem}}')
    assert.equal(fontSizeRootCss([], fontSizeSettings(true)!), '')
  })
})
