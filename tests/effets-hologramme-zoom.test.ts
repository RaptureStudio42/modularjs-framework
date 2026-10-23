// *hologram, le réglage zoom à trois valeurs (non, true, spin) et le réglage back, sans navigateur : ce que le catalogue accepte et refuse ;
// ce que le build embarque — le tour et le dos ne partent que si une page écrit `zoom: spin` ou `back` (ou tient `zoom` / `back` dans une
// variable) ; le mot spin ne fait pas venir l'effet *spin ; l'image du dos suit le chemin des autres images d'effet ; la règle du tour
// (à chaque zoom, ou au premier de chaque carte) tient en une condition du fichier.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { parseEffect, EFFECTS } from '../src/effects/catalog.js'
import { hologramClient } from '../src/bundler/hologram-styles.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire } from './helpers/hologramme-zoom.js'

const DOS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280"><rect width="200" height="280" fill="#e8c020"/></svg>'
const CARTE   = (reglages: string, script = '') => `${script}<div class="carte" *hologram(frost${reglages})><b>carte</b></div>\n<style>\n.carte\n  width: 200px\n  height: 280px\n</style>`

describe('*hologram, zoom (non, true, spin) et back — le catalogue', () => {
  it('zoom accepte false, true et spin, et refuse tout autre mot en disant ce qui est permis', () => {
    assert.equal(parseEffect('hologram', 'frost, zoom: spin').fixed.zoom, 'spin')
    assert.equal(parseEffect('hologram', 'frost, zoom: true').fixed.zoom, true)
    assert.equal(parseEffect('hologram', 'frost, zoom: false').fixed.zoom, false)
    assert.equal(parseEffect('hologram', 'frost').fixed.zoom, undefined, 'sans zoom écrit : pas de zoom')
    assert.throws(() => parseEffect('hologram', 'frost, zoom: tour'), /zoom = tour — permis : bool \| 'spin'/)
    assert.equal(EFFECTS.hologram.settings.zoom.dflt, false)
  })

  it('une variable peut tenir zoom (la règle part avec elle)', () => {
    const r = parseEffect('hologram', 'frost, zoom: $zoom')
    assert.deepEqual(r.fixed, { style: 'frost' })
    assert.equal(r.dynamic.zoom, '$zoom')
  })

  it('zoom écrit sans valeur n\'est pas un drapeau : un mot sans nom est le réglage principal, comme pour tout effet', () => {
    assert.throws(() => parseEffect('hologram', 'frost, zoom'), /une seule valeur sans nom est permise/)
  })

  it('back est une image, de même nature que image et mask', () => {
    assert.equal(EFFECTS.hologram.settings.back.rule, 'image')
    assert.equal(EFFECTS.hologram.settings.back.rule, EFFECTS.hologram.settings.image.rule)
    assert.equal(parseEffect('hologram', 'frost, back: \'dos.png\'').fixed.back, 'dos.png')
    assert.equal(parseEffect('hologram', 'frost, back: $dos').dynamic.back, '$dos')
    assert.throws(() => parseEffect('hologram', 'frost, back: \'\''), /back/)
  })

  it('le filtre du build laisse passer les jetons réglage=valeur et effet.réglage, et prend les autres pour des styles', () => {
    assert.deepEqual(hologramClient.word!('zoom=spin'), ['zoom=spin'])
    assert.deepEqual(hologramClient.word!('hologram.back'), ['hologram.back'])
    assert.deepEqual(hologramClient.word!('frost'), ['style=frost'])
    assert.deepEqual(hologramClient.word!('cards'), ['style=*'])
  })
})

describe('*hologram, zoom: spin et back — ce que le build embarque (production)', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  // ce que chaque page, construite seule, embarque du fichier de l'effet
  const PAGES: Record<string, string> = {
    sans:       CARTE(''),
    simple:     CARTE(', zoom: true'),
    spin:       CARTE(', zoom: spin'),
    dos:        CARTE(', zoom: spin, back: \'dos.svg\''),
    dosseul:    CARTE(', back: \'dos.svg\''),
    variable:   CARTE(', zoom: $zoom', '<script>\n$zoom = \'spin\'\n</script>\n'),
    variabledos: CARTE(', zoom: true, back: $dos', '<script>\n$dos = \'dos.svg\'\n</script>\n')
  }
  const construits: Record<string, { texte: string, fichiers: string[], taille: number, sortie: string }> = {}

  before(async () => {
    for (const [nom, source] of Object.entries(PAGES)) {
      const c = await construire({ [`hz-${nom}.mjs`]: source, 'dos.svg': DOS_SVG }, `effets-hologramme-zoom-${nom}`, 'prod')
      const fichiers = readdirSync(c.sortie)
      const effet = fichiers.filter((f) => /^mjs_fx_hologram.*\.js$/.test(f))
      assert.equal(effet.length, 1, `${nom} : le fichier de l'effet est là : ${fichiers.join(' ')}`)
      const texte = readFileSync(join(c.sortie, effet[0]), 'utf-8')
      construits[nom] = { texte, fichiers, taille: gzipSync(texte, { level: 9 }).length, sortie: c.sortie }
      if (process.env.MJS_PESEE) console.log(`  pesée ${nom} : ${texte.length} o, ${construits[nom].taille} o gzip`)
    }
  })

  const TOUR = ['hologram-back', 'var cover', 'var turn', 'each || first']

  it('une appli sans zoom, ou en zoom: true, ne paie ni le tour ni le dos', () => {
    for (const nom of ['sans', 'simple']) {
      for (const t of TOUR) assert.ok(!construits[nom].texte.includes(t), `${nom} : « ${t} » ne part pas`)
      assert.ok(!/\/\/ @@ (?:zoom=|hologram\.|cards)/.test(construits[nom].texte), `${nom} : aucune marque de section ne sort`)
    }
  })

  it('zoom: spin, back, ou zoom / back tenus par une variable embarquent le tour et le dos', () => {
    for (const nom of ['spin', 'dos', 'dosseul', 'variable', 'variabledos']) {
      for (const t of TOUR) assert.ok(construits[nom].texte.includes(t), `${nom} : « ${t} » part`)
      assert.ok(!/\/\/ @@ (?:zoom=|hologram\.|cards)/.test(construits[nom].texte), `${nom} : aucune marque de section ne sort`)
    }
  })

  it('le poids suit : sans < zoom: true < zoom: spin ≤ zoom: spin + back', () => {
    const t = (n: string) => construits[n].taille
    assert.ok(t('sans') <= t('simple'), `sans ${t('sans')} ≤ simple ${t('simple')}`)
    assert.ok(t('simple') < t('spin'), `simple ${t('simple')} < spin ${t('spin')}`)
    assert.ok(t('spin') <= t('dos'), `spin ${t('spin')} ≤ dos ${t('dos')}`)
  })

  it('le mot spin d\'un zoom ne fait pas venir l\'effet *spin dans l\'appli', () => {
    for (const nom of ['spin', 'dos', 'variable']) {
      assert.ok(!construits[nom].fichiers.some((f) => /^mjs_fx_spin/.test(f)), `${nom} : pas de fichier de l'effet *spin : ${construits[nom].fichiers.join(' ')}`)
      const tout = construits[nom].fichiers.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(construits[nom].sortie, f), 'utf-8')).join('\n')
      assert.ok(!/_mjs_fxDefs\.spin\b/.test(tout), `${nom} : l'effet *spin n'est défini nulle part`)
    }
  })

  it('l\'image du dos suit le chemin des autres images : le fichier est copié par la construction', () => {
    const images = construits.dos.fichiers.filter((f) => /^dos.*\.svg$/.test(f) || /dos.*\.svg$/.test(f))
    assert.ok(images.length >= 1, `l'image du dos est copiée dans la sortie : ${construits.dos.fichiers.join(' ')}`)
    assert.ok(existsSync(join(construits.dos.sortie, images[0])))
    const page = construits.dos.fichiers.filter((f) => /^hz-dos.*\.js$/.test(f)).map((f) => readFileSync(join(construits.dos.sortie, f), 'utf-8')).join('\n')
    assert.ok(!/back:\s*'dos\.svg'/.test(page) && !/"back":"dos\.svg"/.test(page), 'la page ne garde pas le chemin écrit : elle porte l\'adresse résolue')
  })
})

describe('*hologram, la règle du tour — à chaque zoom ou au premier de chaque carte', () => {
  it('une seule condition à changer, commentée, dans le fichier de l\'effet', () => {
    const src = readFileSync(new URL('../src/runtime/mjs_fx_hologram.ts', import.meta.url), 'utf-8')
    assert.equal((src.match(/\(each \|\| first\)/g) ?? []).length, 1, 'la condition du tour')
    assert.equal((src.match(/var each\s+= true;/g) ?? []).length, 1, 'la valeur qui la règle')
    assert.match(src, /pour qu'il ne joue qu'au premier zoom de chaque carte, `each` devient faux/)
  })
})
