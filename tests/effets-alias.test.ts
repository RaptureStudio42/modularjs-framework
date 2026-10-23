// Alias d'effets : `*filter.depoli = *filter(none, blur: 12)` dans un fichier `*.effects.mjs`, posé ensuite
// par `*filter.depoli` ou `*filter.depoli(blur: 20)` ; les alias que ModularJS livre (effets-alias-livres.test.ts) sont remplacés
// par ceux de l'appli de même nom (avec un avertissement) ; un alias utilisé au moins six fois dans l'appli est écrit une
// seule fois (une table dans le code de l'appli), un alias utilisé moins souvent reste écrit en clair, une appli sans alias
// n'embarque rien de plus. La forme pointée se lit partout où un effet se pose (balise, transition, <@document>), ses
// messages la nomment en entier, la table n'écrit que ce qu'un usage lui renvoie, et le code d'un effet qui ne se lit que
// par ses sections (production) est le même par alias ou en clair.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import * as EffectsFiles from '../src/bundler/effects-files.js'
import { withEffectLines } from '../src/bundler/transpile-msg.js'
import { scanCompiledFeatures, fxAliasSignal } from '../src/bundler/features.js'
import { EFFECTS, parseEffect, setProjectEffects, withProjectEffects, type ProjectEffect } from '../src/effects/catalog.js'
import { parseEffectsBlock, resolveProjectEffects } from '../src/effects/project.js'
import { MJS_ALIASES } from '../src/effects/aliases-mjs.js'
import { setMessagesLang } from '../src/messages/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const VERRE = '*filter.depoli = *filter(none, blur: 12, spot: 240, soft: 100)'

async function construire(nom: string, fichiers: Record<string, string | Buffer>, reglages: Record<string, unknown> = {}) {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, src] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(srcDir, f)), { recursive: true })
    writeFileSync(join(srcDir, f), src)
  }
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...reglages })
  const stats   = await bundler.compile()
  await bundler.close()
  const textes: Record<string, string> = {}
  for (const f of readdirSync(outDir).filter((x) => x.endsWith('.js'))) textes[f] = readFileSync(join(outDir, f), 'utf-8')
  const tout  = Object.values(textes).join('\n')
  const unite = (prefixe: string) => Object.entries(textes).filter(([f]) => f.startsWith(prefixe)).map(([, s]) => s).join('\n')
  const erreurs  = stats.errors.map((e: any) => e.message).join('\n')
  // l'erreur du composant `nom` (un fichier, une erreur), vide s'il n'en a pas
  const erreurDe = (nom: string) => stats.errors.map((e: any) => String(e.message)).find((m: string) => m.includes('/' + nom + '.mjs')) ?? ''
  return { stats, erreurs, erreurDe, textes, tout, unite, coeur: unite('mjs_core'), sortie: readdirSync(outDir) }
}

// un PNG en niveaux de gris, w × 8
function png(w = 64): Buffer {
  const h = 8
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc   = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const bloc  = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const tete = Buffer.alloc(13); tete.writeUInt32BE(w, 0); tete.writeUInt32BE(h, 4); tete[8] = 8; tete[9] = 0
  const brut = Buffer.alloc((w + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) brut[y * (w + 1) + 1 + x] = Math.round(x / (w - 1) * 255)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', tete), bloc('IDAT', deflateSync(brut)), bloc('IEND', Buffer.alloc(0))])
}

const compte = (texte: string, motif: RegExp) => (texte.match(motif) ?? []).length

// une source écrite n fois, une par ligne : le nombre d'usages d'un alias se lit dans le texte des sources
const fois = (n: number, source: string) => Array.from({ length: n }, () => source).join('\n')

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// la page construite, montée dans un DOM (happy-dom) : le composant `tag` et sa racine d'ombre, une fois `attend` posé
async function monter(nom: string, fichiers: Record<string, string>, tag: string, attend: string) {
  const r      = await construire(nom, fichiers)
  const noms   = Object.keys(r.textes)
  const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code   = [...noms].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(r.textes[f])).join('\n')
  const window = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  window.document.body.innerHTML = `<${tag}></${tag}>`
  const comp = window.document.querySelector(tag) as any
  await attendre(() => !!comp._shadow?.querySelector(attend))
  return { r, window, comp }
}

describe('alias d\'effets', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('déclaration et usage : l\'effet de la bibliothèque se pose avec les réglages de l\'alias', async () => {
    const r = await construire('alias-usage', { 'a.effects.mjs': `<effects>\n  ${VERRE}\n</effects>`, 'c.mjs': '<img src="a.png" alt="" *filter.depoli>' })
    assert.equal(r.erreurs, '')
    assert.match(r.unite('c-'), /_mjs_fx\(this, _mjs_fxn, "filter", \{"style":"none","blur":12,"spot":240,"soft":100\}\)/)
  })

  it('un réglage changé à l\'usage l\'emporte, les autres restent ceux de l\'alias', async () => {
    const r = await construire('alias-reglage', { 'a.effects.mjs': `<effects>\n  ${VERRE}\n</effects>`, 'c.mjs': '<img src="a.png" alt="" *filter.depoli(blur: 20)>' })
    assert.equal(r.erreurs, '')
    assert.match(r.unite('c-'), /"filter", \{"style":"none","blur":20,"spot":240,"soft":100\}\)/)
  })

  it('un nom d\'alias hors minuscules, chiffres et _ est refusé, en français et en anglais', () => {
    for (const mauvais of ['Verre', 'verre-depoli', '1verre', '_verre', 'verré']) {
      assert.throws(() => parseEffectsBlock(`*filter.${mauvais} = *filter(blur: 3)`, 1, 'a.effects.mjs'), /minuscules, chiffres et _/, mauvais)
    }
    setMessagesLang('en')
    try {
      assert.throws(() => parseEffectsBlock('*filter.Verre = *filter(blur: 3)', 1, 'a.effects.mjs'), /lowercase letters, digits and _/)
    }
    finally {
      setMessagesLang('fr')
    }
    assert.doesNotThrow(() => parseEffectsBlock('*filter.verre_2 = *filter(blur: 3)', 1, 'a.effects.mjs'))
  })

  it('un alias se rattache à son effet : *filter.x = *tilt(…) est refusé', () => {
    assert.throws(() => parseEffectsBlock('*filter.x = *tilt(max: 3)', 1, 'a.effects.mjs'), /\*filter\.x/)
  })

  it('un alias de ModularJS se pose sans rien déclarer', async () => {
    const r = await construire('alias-mjs', { 'c.mjs': '<img src="a.png" alt="" *filter.frosted_glass>' })
    assert.equal(r.erreurs, '')
    assert.match(r.unite('c-'), /"filter", \{"style":"none","blur":\d+/)
  })

  it('l\'alias de l\'appli qui porte le nom d\'un alias de ModularJS le remplace, avec un avertissement', async () => {
    const r = await construire('alias-remplace', { 'a.effects.mjs': '<effects>\n  *filter.frosted_glass = *filter(sepia, amount: 0.5)\n</effects>', 'c.mjs': '<img src="a.png" alt="" *filter.frosted_glass>' })
    assert.equal(r.erreurs, '')
    assert.match(r.unite('c-'), /"filter", \{"style":"sepia","amount":0\.5\}\)/)
    assert.ok(r.stats.warnings.some((w: string) => /\*filter\.frosted_glass/.test(w) && /remplace/.test(w)), r.stats.warnings.join('\n'))
  })

  it('un alias inconnu est une erreur claire', async () => {
    const r = await construire('alias-inconnu', { 'a.effects.mjs': `<effects>\n  ${VERRE}\n</effects>`, 'c.mjs': '<img src="a.png" alt="" *filter.inconnu>' })
    assert.match(r.erreurs, /\*filter\.inconnu/)
    assert.match(r.erreurs, /aucun alias/)
  })

  describe('la table', () => {
    const effets = `<effects>\n  ${VERRE}\n  *titre = *scramble(311, on: click)\n</effects>`
    const usage  = '<img src="a.png" alt="" *filter.depoli>'
    const clair  = /_mjs_fx\(this, _mjs_fxn, "filter", \{"style":"none","blur":12,"spot":240,"soft":100\}\)/g
    const renvoi = /_mjs_fx\(this, _mjs_fxn, "filter", µ\._mjs_alias\(\d+\)\)/g

    it('un alias utilisé une fois reste écrit en clair, sans table', async () => {
      const r = await construire('alias-table-un', { 'a.effects.mjs': effets, 'c.mjs': '<img src="a.png" alt="" *filter.depoli>\n<p *titre>A</p>' })
      assert.equal(r.erreurs, '')
      assert.match(r.unite('c-'), /"filter", \{"style":"none","blur":12,"spot":240,"soft":100\}\)/)
      assert.match(r.unite('c-'), /"scramble", \{"speed":311,"on":"click"\}\)/)
      assert.equal(compte(r.tout, /_mjs_alias/g), 0)
    })

    // la frontière, en nombres écrits : le seuil vaut six (en dessous, écrite une seule fois la table alourdit le fichier brut au lieu de l'alléger)
    it('cinq usages (répartis sur deux composants) : aucun renvoi à la table, les réglages sont écrits en clair dans chaque composant', async () => {
      const r = await construire('alias-table-cinq', { 'a.effects.mjs': effets, 'c1.mjs': fois(2, usage), 'c2.mjs': fois(3, usage) })
      assert.equal(r.erreurs, '')
      assert.equal(compte(r.tout, /_mjs_alias/g), 0, 'ni table ni renvoi')
      assert.equal(compte(r.coeur, /"blur":12/g), 0, 'rien de l\'alias dans le cœur')
      assert.equal(compte(r.unite('c1-'), clair), 2)
      assert.equal(compte(r.unite('c2-'), clair), 3)
    })

    it('six usages (répartis sur deux composants) : la table est écrite une fois, les six usages y renvoient', async () => {
      const r = await construire('alias-table-six', { 'a.effects.mjs': effets, 'c1.mjs': fois(3, usage), 'c2.mjs': `${fois(3, usage)}\n<p *titre>A</p>` })
      assert.equal(r.erreurs, '')
      assert.equal(compte(r.tout, /_mjs_alias\s*=/g), 1, 'la table est écrite une fois')
      assert.equal(compte(r.tout, /"blur":12/g), 1, 'les réglages de l\'alias sont écrits une fois')
      assert.match(r.coeur, /"blur":12/, 'dans le code de l\'appli (le cœur construit pour elle)')
      assert.equal(compte(r.unite('c1-') + r.unite('c2-'), renvoi), 6, 'les six usages y renvoient')
      assert.equal(compte(r.unite('c1-') + r.unite('c2-'), /"blur":12/g), 0, 'aucun usage ne recopie les réglages')
      assert.match(r.unite('c2-'), /"scramble", \{"speed":311,"on":"click"\}\)/, '*titre, utilisé une fois, reste en clair')
    })

    it('un alias actuel (*titre) passe à la table aussi, dès six usages', async () => {
      const r = await construire('alias-table-titre', { 'a.effects.mjs': effets, 'c.mjs': `<p *titre>A</p>\n<p *titre(on: load)>B</p>\n${fois(4, '<p *titre>C</p>')}` })
      assert.equal(r.erreurs, '')
      assert.equal(compte(r.tout, /"speed":311/g), 1)
      assert.equal(compte(r.unite('c-'), /"scramble", [^)]*_mjs_alias\(\d+/g), 6)
      assert.match(r.unite('c-'), /_mjs_alias\(\d+, \{"on":"load"\}\)/, 'le changement seul, sans recopier la table')
    })

    it('un usage qui change un réglage fusionne la table et le changement', async () => {
      const r = await construire('alias-table-fusion', { 'a.effects.mjs': effets, 'c.mjs': `${fois(5, usage)}\n<img src="b.png" alt="" *filter.depoli(blur: 20)>` })
      assert.equal(r.erreurs, '')
      assert.match(r.unite('c-'), /_mjs_alias\(\d+, \{"blur":20\}\)/)
      assert.equal(compte(r.tout, /"spot":240/g), 1)
    })

    it('un sixième usage ajouté plus tard (le même bundler, le cache chaud) fait passer les cinq premiers à la table, et le retirer les remet en clair', async () => {
      const root   = mjsTmp('alias-table-cache')
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'a.effects.mjs'), effets)
      writeFileSync(join(srcDir, 'c1.mjs'), fois(5, usage))
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const lire    = (p: string) => readdirSync(outDir).filter((f) => f.startsWith(p) && f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
      try {
        let stats = await bundler.compile()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
        assert.match(lire('c1-'), /"blur":12/)
        assert.doesNotMatch(lire('c1-'), /_mjs_alias/, 'cinq usages : en clair')
        writeFileSync(join(srcDir, 'c2.mjs'), '<img src="b.png" alt="" *filter.depoli>')
        stats = await bundler.compile()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
        assert.match(lire('c1-'), /_mjs_alias\(0\)/)
        assert.doesNotMatch(lire('c1-'), /"blur":12/)
        assert.match(lire('mjs_core'), /"blur":12/)
        writeFileSync(join(srcDir, 'c2.mjs'), '<p>plus d\'usage</p>')
        stats = await bundler.compile()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
        assert.match(lire('c1-'), /"blur":12/)
        assert.doesNotMatch(lire('c1-'), /_mjs_alias/)
      }
      finally {
        await bundler.close()
      }
    })

    it('une appli sans alias n\'embarque rien de plus', async () => {
      const r = await construire('alias-aucun', { 'c.mjs': '<p *scramble(311)>A</p>\n<p *scramble(311)>B</p>' })
      assert.equal(r.erreurs, '')
      assert.equal(compte(r.tout, /_mjs_al/g), 0)
    })
  })

  describe('la forme pointée sur une transition (@in, @out, @transition)', () => {
    const effets = '<effects>\n  *fade.lent = *fade(duration: 3s)\n  *lent = *fade(duration: 3s)\n</effects>'

    for (const directive of ['@in', '@out', '@transition']) {
      it(`${directive}=*fade.lent(duration: 3s) pose le même fade que *lent déclaré à plat, sans attribut en trop dans la balise`, async () => {
        const r = await construire('alias-transition-' + directive.slice(1), {
          'a.effects.mjs': effets,
          'c1.mjs': `<div ${directive}=*fade.lent(duration: 3s)>x</div>`,
          'c2.mjs': `<div ${directive}=*lent(duration: 3s)>x</div>`
        })
        assert.equal(r.erreurs, '')
        assert.match(r.unite('c1-'), /_mjs_cloneTpl\("<div>x<\/div>"\)/, 'rien de l\'effet ne reste dans la balise')
        assert.match(r.unite('c1-'), /_mjs_fxAnim\(_mjsThis, _mjs_node, "fade", \{"duration":"3s"\}/)
        assert.match(r.unite('c2-'), /_mjs_fxAnim\(_mjsThis, _mjs_node, "fade", \{"duration":"3s"\}/)
      })
    }

    it('sans réglages à l\'usage, l\'alias pointé porte ceux de sa déclaration', async () => {
      const r = await construire('alias-transition-nu', { 'a.effects.mjs': effets, 'c.mjs': '<div @in=*fade.lent>x</div>' })
      assert.equal(r.erreurs, '')
      assert.match(r.unite('c-'), /_mjs_cloneTpl\("<div>x<\/div>"\)/)
      assert.match(r.unite('c-'), /_mjs_fxAnim\(_mjsThis, _mjs_node, "fade", \{"duration":"3s"\}/)
    })

    it('utilisée six fois, la forme pointée passe à la table, comme l\'alias déclaré à plat', async () => {
      const r = await construire('alias-transition-table', {
        'a.effects.mjs': effets,
        'c1.mjs': fois(3, '<div @in=*fade.lent>a</div>\n<div @out=*fade.lent>b</div>'),
        'c2.mjs': fois(3, '<div @in=*lent>a</div>\n<div @out=*lent>b</div>')
      })
      assert.equal(r.erreurs, '')
      assert.equal(compte(r.unite('c1-'), /_mjs_fxAnim\(_mjsThis, _mjs_node, "fade", µ\._mjs_alias\(\d+\)/g), 6)
      assert.equal(compte(r.unite('c2-'), /_mjs_fxAnim\(_mjsThis, _mjs_node, "fade", µ\._mjs_alias\(\d+\)/g), 6)
      assert.equal(compte(r.tout, /"duration":"3s"/g), 2, 'chaque alias est écrit une fois, dans la table')
    })

    it('dans le DOM : la balise ne reçoit aucun attribut parasite, comme avec l\'alias à plat', async () => {
      const pointe = await monter('alias-transition-dom-p', { 'a.effects.mjs': effets, 'c1.mjs': '<div class="a" @in=*fade.lent(duration: 3s)>x</div>' }, 'mjs-c1', '.a')
      const plat   = await monter('alias-transition-dom-f', { 'a.effects.mjs': effets, 'c1.mjs': '<div class="a" @in=*lent(duration: 3s)>x</div>' }, 'mjs-c1', '.a')
      try {
        const attributs = (m: any) => m.comp._shadow.querySelector('.a').getAttributeNames()
        assert.deepEqual(attributs(pointe), ['class'])
        assert.deepEqual(attributs(pointe), attributs(plat))
        assert.equal(typeof pointe.comp._shadow.querySelector('.a')._mjs_intro, typeof plat.comp._shadow.querySelector('.a')._mjs_intro, 'la transition est posée dans les deux cas')
      }
      finally {
        pointe.window.close()
        plat.window.close()
      }
    })
  })

  describe('la forme pointée sur <@document> et <@window>', () => {
    const effets = '<effects>\n  *ripple.rouge = *ripple(#f00, size: 60)\n</effects>'

    it('<@document *ripple.rouge(size: 90)> pose le ripple avec les réglages de l\'alias, celui de la pose l\'emporte', async () => {
      const r = await construire('alias-document', { 'a.effects.mjs': effets, 'p.mjs': '<@document *ripple.rouge(size: 90)></@document>\n<p>x</p>' })
      assert.equal(r.erreurs, '')
      assert.match(r.unite('p-'), /_mjs_fx\(this, document\.documentElement, "ripple", \{"color":"#f00","size":90\}\)/)
    })

    it('dans le DOM : le calque de la page porte la taille de la pose et la marque de l\'effet', async () => {
      const m = await monter('alias-document-dom', { 'a.effects.mjs': effets, 'fx-page.mjs': '<@document *ripple.rouge(size: 90)></@document>\n<p class="p">page</p>' }, 'mjs-fx-page', '.p')
      try {
        const doc = m.window.document
        await attendre(() => !!doc.querySelector('[mjs-fx-layer="ripple-page"]'))
        const calque = doc.querySelector('[mjs-fx-layer="ripple-page"]') as any
        assert.ok(calque, 'le calque des anneaux')
        assert.equal(calque.style.getPropertyValue('--mjs-fx-ripple-size'), '90px')
        assert.ok((doc.documentElement.getAttribute('mjs-fx') ?? '').split(' ').includes('ripple'))
      }
      finally {
        m.window.close()
      }
    })

    it('un alias dont l\'effet ne va pas sur la page est refusé, en nommant l\'alias en entier', async () => {
      const r = await construire('alias-document-refus', { 'a.effects.mjs': '<effects>\n  *tilt.doux2 = *tilt(max: 6)\n</effects>', 'p.mjs': '<@document *tilt.doux2></@document>\n<p>x</p>' })
      assert.match(r.erreurs, /\*tilt\.doux2 \(ligne 1\) ne se pose pas sur <@document>/)
    })

    it('<@window *ripple.rouge> reste refusé, en nommant l\'alias en entier', async () => {
      const r = await construire('alias-window', { 'a.effects.mjs': effets, 'p.mjs': '<@window *ripple.rouge(size: 90)></@window>\n<p>x</p>' })
      assert.match(r.erreurs, /\*ripple\.rouge ne se pose pas sur <@window>/)
    })

    it('un composant qui pose son alias sur <@document> est recompilé quand le fichier d\'effets change', async () => {
      const root   = mjsTmp('alias-document-cache')
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'a.effects.mjs'), effets)
      writeFileSync(join(srcDir, 'p.mjs'), '<@document *ripple.rouge></@document>\n<p>x</p>')
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const lire    = () => readdirSync(outDir).filter((f) => f.startsWith('p-') && f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
      try {
        let stats = await bundler.compile()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
        assert.match(lire(), /"ripple", \{"color":"#f00","size":60\}/)
        writeFileSync(join(srcDir, 'a.effects.mjs'), effets.replace('size: 60', 'size: 75'))
        stats = await bundler.compile()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
        assert.match(lire(), /"ripple", \{"color":"#f00","size":75\}/)
      }
      finally {
        await bundler.close()
      }
    })
  })

  describe('les messages nomment l\'alias en entier', () => {
    const effets = '<effects>\n  *filter.net = *filter(sepia, amount: 0.5)\n</effects>'

    it('un alias inconnu sur la troisième ligne : *filter.inconnu (ligne 3), la ligne de sa balise', async () => {
      const r = await construire('alias-message-ligne-trois', { 'a.effects.mjs': effets, 'c.mjs': '<p>un</p>\n<p>deux</p>\n<img src="a.png" alt="" *filter.inconnu(blur: 3)>' })
      assert.match(r.erreurs, /\*filter\.inconnu \(ligne 3\) : aucun alias/)
      assert.doesNotMatch(r.erreurs, /\*filter \(ligne/)
    })

    it('un alias inconnu : *filter.inconnu (ligne 1), jamais *filter (ligne 1).inconnu', async () => {
      const r = await construire('alias-message-inconnu', { 'a.effects.mjs': effets, 'c.mjs': '<img src="a.png" alt="" *filter.inconnu>' })
      assert.match(r.erreurs, /\*filter\.inconnu \(ligne 1\) : aucun alias/)
      assert.doesNotMatch(r.erreurs, /\*filter \(ligne/)
    })

    it('withEffectLines : la ligne s\'écrit après le nom pointé, et cherche l\'alias dans le texte du fichier', () => {
      const err = withEffectLines(new Error('[ModularJS] *filter.net : réglage inconnu'), '<p>un</p>\n<img *filter.net>')
      assert.equal(err.message, '[ModularJS] *filter.net (ligne 2) : réglage inconnu')
      const lue = withEffectLines(Object.assign(new Error('[ModularJS] *filter.net(blurr: 3) : réglage'), { mjsLine: 1 }), '<img *filter.net(blurr: 3)>')
      assert.match(lue.message, /^\[ModularJS\] \*filter\.net\(blurr: 3\) \(ligne 1\) : réglage$/)
      assert.equal(withEffectLines(new Error('[ModularJS] *filter : x'), '<img *filter.net>').message, '[ModularJS] *filter : x', 'l\'effet nu n\'est pas l\'alias')
    })

    it('withEffectLines : un nom écrit avec une majuscule, un tiret ou un souligné est lu en entier, jamais coupé', () => {
      for (const nom of ['filter.Net', 'filter.net-2', 'filter._net', 'filter.2net', 'mon_titre', 'Titre']) {
        const err = withEffectLines(new Error(`[ModularJS] *${nom} : x`), `<p>un</p>\n<img *${nom}>`)
        assert.equal(err.message, `[ModularJS] *${nom} (ligne 2) : x`, nom)
      }
    })
  })

  describe('une faute levée à la pose d\'un alias nomme l\'alias et cite sa ligne', () => {
    const effets = [
      '<effects>',
      '  *filter.net = *filter(none, blur: 5)',
      '  *netplat = *filter(none, blur: 5)',
      '  *fade.lent = *fade(duration: 3s)',
      '  *ripple.rouge = *ripple(#f00, size: 60)',
      '  *scramble.vite = *scramble(speed: 400)',
      '  *travel.court = *travel(rotate: 5)',
      '  *behind.fond = *behind(depth: 20)',
      '</effects>'
    ].join('\n')
    const img    = '<img src="a.png" alt="" '
    let r: Awaited<ReturnType<typeof construire>>

    before(async () => {
      r = await construire('alias-fautes', {
        'a.effects.mjs':  effets,
        // un voisin *filter écrit avant l'alias : sa ligne n'est pas celle de la faute
        'pointe.mjs':     `<p>un</p>\n${img}*filter(none)>\n${img}*filter.net(blur: abc)>`,
        'inconnu.mjs':    `<p>un</p>\n${img}*filter(none)>\n${img}*filter.net(zzz: 3)>`,
        'livre.mjs':      `<p>un</p>\n${img}*filter>\n${img}*filter.frosted_glass(blur: abc)>`,
        'multiligne.mjs': `<p>un</p>\n${img}*filter>\n<img src="x"\n  alt=""\n  *filter.net(blur: abc)\n>`,
        'seul.mjs':       `<p>un</p>\n${img}*filter.net(blur: abc)>`,
        'plat.mjs':       `<p>un</p>\n${img}*filter(none)>\n${img}*netplat(blur: abc)>`,
        'directive.mjs':  '<p>un</p>\n<div class="a" @in=*fade.lent(duration: abc)>x</div>',
        'page.mjs':       '<@document *ripple.rouge(size: abc)></@document>\n<p>x</p>',
        'texte.mjs':      `<p>un</p>\n<p *scramble(300)>a</p>\n${img}*scramble.vite>`,
        'contenu.mjs':    `<p>un</p>\n<div *behind(depth: 3)>a</div>\n${img}*behind.fond>`,
        'manque.mjs':     '<p>un</p>\n<div *travel(to: \'#a\')>a</div>\n<div *travel.court>b</div>'
      })
    })

    it('un réglage invalide : *filter.net (ligne 3), pas *filter ni la ligne du voisin', () => {
      assert.match(r.erreurDe('pointe'), /\[ModularJS\] \*filter\.net \(ligne 3\) : blur = abc/)
      assert.doesNotMatch(r.erreurDe('pointe'), /\*filter \(ligne/)
    })

    it('un réglage inconnu : *filter.net (ligne 3), et les réglages de *filter', () => {
      assert.match(r.erreurDe('inconnu'), /\[ModularJS\] \*filter\.net \(ligne 3\) : réglage « zzz » inconnu — réglages de \*filter : /)
    })

    it('un alias livré par ModularJS : *filter.frosted_glass (ligne 3)', () => {
      assert.match(r.erreurDe('livre'), /\[ModularJS\] \*filter\.frosted_glass \(ligne 3\) : blur = abc/)
    })

    it('une balise sur plusieurs lignes : la ligne de son <', () => {
      assert.match(r.erreurDe('multiligne'), /\[ModularJS\] \*filter\.net \(ligne 3\) : blur = abc/)
    })

    it('sans voisin *filter : le nom pointé et sa ligne aussi', () => {
      assert.match(r.erreurDe('seul'), /\[ModularJS\] \*filter\.net \(ligne 2\) : blur = abc/)
    })

    it('un alias à plat : *netplat (ligne 3), pas *filter ni la ligne du voisin', () => {
      assert.match(r.erreurDe('plat'), /\[ModularJS\] \*netplat \(ligne 3\) : blur = abc/)
      assert.doesNotMatch(r.erreurDe('plat'), /\*filter \(ligne/)
    })

    it('sur une transition (@in=) : *fade.lent (ligne 2)', () => {
      assert.match(r.erreurDe('directive'), /\[ModularJS\] \*fade\.lent \(ligne 2\) : duration = abc/)
    })

    it('sur <@document> : *ripple.rouge (ligne 1), pas *ripple', () => {
      assert.match(r.erreurDe('page'), /\[ModularJS\] \*ripple\.rouge \(ligne 1\) : size = abc/)
    })

    it('une balise qui ne convient pas à l\'effet : le nom de l\'alias et sa ligne', () => {
      assert.match(r.erreurDe('texte'), /\[ModularJS\] \*scramble\.vite \(ligne 3\) travaille le texte de sa balise/)
      assert.match(r.erreurDe('contenu'), /\[ModularJS\] \*behind\.fond \(ligne 3\) dessine à l'intérieur de sa balise/)
    })

    it('un réglage exigé qui manque : le nom de l\'alias et sa ligne', () => {
      assert.match(r.erreurDe('manque'), /\[ModularJS\] \*travel\.court \(ligne 3\) : la clé manque — \*travel\.court\(to\)/)
    })

    it('en anglais aussi : le nom écrit, jamais celui de l\'effet qu\'il règle', () => {
      const net: ProjectEffect = { base: 'filter', fixed: { style: 'none', blur: 5 }, file: 'a.effects.mjs', line: 2 }
      setMessagesLang('en')
      try {
        withProjectEffects({ 'filter.net': net, netplat: net }, () => {
          assert.throws(() => parseEffect('filter.net', 'blur: abc'), /\[ModularJS\] \*filter\.net: blur = abc/)
          assert.throws(() => parseEffect('netplat', 'zzz: 3'), /\[ModularJS\] \*netplat: unknown setting "zzz" — settings of \*filter: /)
        })
      }
      finally {
        setMessagesLang('fr')
      }
    })
  })

  describe('un alias inconnu sur une transition est une erreur du build, comme sur une balise', () => {
    const effets = '<effects>\n  *fade.lent = *fade(duration: 3s)\n</effects>'

    for (const directive of ['@in', '@out', '@transition']) {
      it(`${directive}=*fade.inconnu : *fade.inconnu (ligne 2), les alias connus de *fade, aucun avertissement de lint à la place`, async () => {
        const r = await construire('alias-transition-inconnu-' + directive.slice(1), { 'a.effects.mjs': effets, 'c.mjs': `<p>un</p>\n<div class="a" ${directive}=*fade.inconnu(duration: 1s)>x</div>` })
        assert.equal(r.stats.errors.length, 1, r.erreurs)
        assert.match(r.erreurs, /\[ModularJS\] \*fade\.inconnu \(ligne 2\) : aucun alias de ce nom pour \*fade — alias connus : \*fade\.lent\./)
        assert.ok(!r.stats.warnings.some((w: string) => /Animation inconnue/.test(w)), r.stats.warnings.join('\n'))
      })
    }

    it('la même erreur sur une balise, sur une transition et sur <@document>', async () => {
      const r = await construire('alias-inconnu-partout', {
        'a.effects.mjs': '<effects>\n  *filter.net = *filter(none, blur: 5)\n  *ripple.rouge = *ripple(#f00)\n  *fade.lent = *fade(duration: 3s)\n</effects>',
        'balise.mjs':    '<p>un</p>\n<img src="a.png" alt="" *filter.zzz>',
        'dir.mjs':       '<p>un</p>\n<div class="a" @in=*filter.zzz>x</div>',
        'page.mjs':      '<@document *ripple.zzz></@document>\n<p>x</p>'
      })
      assert.equal(r.stats.errors.length, 3, r.erreurs)
      assert.match(r.erreurDe('balise'), /\*filter\.zzz \(ligne 2\) : aucun alias de ce nom pour \*filter — alias connus : (?:\*filter\.[a-z_]+, )*\*filter\.net, /)
      assert.match(r.erreurDe('dir'), /\*filter\.zzz \(ligne 2\) : aucun alias de ce nom pour \*filter — alias connus : (?:\*filter\.[a-z_]+, )*\*filter\.net, /)
      assert.match(r.erreurDe('page'), /\*ripple\.zzz \(ligne 1\) : aucun alias de ce nom pour \*ripple — alias connus : \*ripple\.rouge\./)
    })
  })

  describe('l\'alias d\'un effet qui n\'est pas une transition, posé sur @in : l\'erreur nomme l\'alias en entier', () => {
    const effets = '<effects>\n  *filter.net = *filter(none, blur: 5)\n  *netplat = *filter(none, blur: 5)\n  *tilt.vif = *tilt(max: 20)\n</effects>'

    it('@in=*filter.frosted_glass (livré par ModularJS) et @in=*filter.net (de l\'appli)', async () => {
      const r = await construire('alias-transition-continu', {
        'a.effects.mjs': effets,
        'livre.mjs':     '<p>un</p>\n<div class="a" @in=*filter.frosted_glass>x</div>',
        'appli.mjs':     '<p>un</p>\n<div class="a" @out=*filter.net>x</div>',
        'plat.mjs':      '<p>un</p>\n<div class="a" @in=*netplat>x</div>',
        'nu.mjs':        '<p>un</p>\n<div class="a" @in=*filter>x</div>'
      })
      assert.match(r.erreurDe('livre'), /\[ModularJS\] @in=\*filter\.frosted_glass : \*filter\.frosted_glass est un effet continu/)
      assert.match(r.erreurDe('livre'), /Posez-le directement sur elle : \*filter\.frosted_glass\./)
      assert.match(r.erreurDe('appli'), /\[ModularJS\] @out=\*filter\.net : \*filter\.net est un effet continu/)
      assert.match(r.erreurDe('plat'), /\[ModularJS\] @in=\*netplat : \*netplat est un effet continu/)
      assert.match(r.erreurDe('nu'), /\[ModularJS\] @in=\*filter : \*filter est un effet continu/, 'l\'effet sans alias : inchangé')
    })

    it('un réglage de déclencheur à la pose : le nom écrit', async () => {
      const r = await construire('alias-transition-declencheur', { 'a.effects.mjs': '<effects>\n  *fade.lent = *fade(duration: 3s)\n</effects>', 'c.mjs': '<p>un</p>\n<div class="a" @in=*fade.lent(on: view)>x</div>' })
      assert.match(r.erreurs, /@in=\*fade\.lent : « on » n'a pas de sens ici/)
      assert.match(r.erreurs, /posez l'effet directement : \*fade\.lent\(on: …\)/)
    })
  })

  describe('un nom d\'alias mal formé à l\'usage : une erreur qui nomme ce qui est écrit, sa ligne, et rappelle la règle', () => {
    const effets = '<effects>\n  *filter.net = *filter(none, blur: 5)\n  *fade.lent = *fade(duration: 3s)\n  *ripple.rouge = *ripple(#f00)\n</effects>'
    const img    = '<img src="a.png" alt="" '
    const regle  = /minuscules, chiffres et _ seulement, et commence par une lettre/
    let r: Awaited<ReturnType<typeof construire>>

    before(async () => {
      r = await construire('alias-nom-usage', {
        'a.effects.mjs': effets,
        'majuscule.mjs': `<p>un</p>\n${img}*filter.Net>`,
        'voisin.mjs':    `<p>un</p>\n${img}*filter(none)>\n${img}*filter.Net(blur: 3)>`,
        'tiret.mjs':     `<p>un</p>\n${img}*filter.net-2>`,
        'souligne.mjs':  `<p>un</p>\n${img}*filter._net>`,
        'chiffre.mjs':   `<p>un</p>\n${img}*filter.2net>`,
        'dir.mjs':       '<p>un</p>\n<div class="a" @in=*fade.Lent>x</div>',
        'page.mjs':      '<@document *ripple.Rouge></@document>\n<p>x</p>'
      })
    })

    it('*filter.Net : *filter.Net (ligne 2), jamais *filter (ligne 2).Net', () => {
      assert.match(r.erreurDe('majuscule'), /\[ModularJS\] \*filter\.Net \(ligne 2\) : /)
      assert.doesNotMatch(r.erreurDe('majuscule'), /\*filter \(ligne/)
      assert.match(r.erreurDe('majuscule'), regle)
    })

    it('la ligne est celle de l\'alias, pas celle d\'un voisin *filter', () => {
      assert.match(r.erreurDe('voisin'), /\[ModularJS\] \*filter\.Net \(ligne 3\) : /)
    })

    it('*filter.net-2, *filter._net, *filter.2net : le nom entier, sa ligne, la règle', () => {
      for (const [f, nom] of [['tiret', 'net-2'], ['souligne', '_net'], ['chiffre', '2net']]) {
        assert.match(r.erreurDe(f), new RegExp(`\\[ModularJS\\] \\*filter\\.${nom} \\(ligne 2\\) : `), f)
        assert.match(r.erreurDe(f), regle, f)
      }
    })

    it('le message liste les alias connus, pour retrouver le bon nom', () => {
      assert.match(r.erreurDe('majuscule'), /alias connus : (?:\*filter\.[a-z_]+, )*\*filter\.net, /)
    })

    it('sur une transition (@in=*fade.Lent) : le nom écrit et sa ligne, plus « @in attend un effet »', () => {
      assert.match(r.erreurDe('dir'), /\[ModularJS\] \*fade\.Lent \(ligne 2\) : /)
      assert.match(r.erreurDe('dir'), regle)
      assert.doesNotMatch(r.erreurDe('dir'), /attend un effet/)
    })

    it('l\'exemple est un alias connu de l\'effet, celui de l\'appli compris : *fade.lent, jamais *fade.my_alias', () => {
      assert.match(r.erreurDe('dir'), /\(\*fade\.lent\) — alias connus : \*fade\.lent\./)
      assert.doesNotMatch(r.erreurDe('dir'), /my_alias/)
      assert.match(r.erreurDe('page'), /\(\*ripple\.rouge\) — alias connus : \*ripple\.rouge\./)
    })

    it('sur <@document> : le nom écrit, sa ligne et la règle', () => {
      assert.match(r.erreurDe('page'), /\[ModularJS\] \*ripple\.Rouge \(ligne 1\) : /)
      assert.match(r.erreurDe('page'), regle)
    })

    it('en anglais : la règle aussi', () => {
      setMessagesLang('en')
      try {
        assert.throws(() => parseEffect('filter.Net', ''), /\[ModularJS\] \*filter\.Net: .*lowercase letters, digits and _ only/)
      }
      finally {
        setMessagesLang('fr')
      }
    })

    it('un alias bien formé mais inconnu garde son message : aucun alias de ce nom', () => {
      assert.throws(() => parseEffect('filter.inconnu', ''), /aucun alias de ce nom pour \*filter/)
    })
  })

  describe('la table n\'écrit que ce qu\'un usage lui renvoie', () => {
    const effets = `<effects>\n  ${VERRE}\n  *titre = *scramble(311, on: click)\n</effects>`

    it('le seuil de la table est une constante nommée du bundler, et la table suit sa valeur', async () => {
      const seuil = (EffectsFiles as any).ALIAS_TABLE_MIN_USES
      assert.equal(typeof seuil, 'number', 'ALIAS_TABLE_MIN_USES')
      const usages = (n: number) => Array.from({ length: n }, () => '<img src="a.png" alt="" *filter.depoli>').join('\n')
      const dessous = await construire('alias-seuil-dessous', { 'a.effects.mjs': effets, 'c.mjs': usages(seuil - 1) })
      const au      = await construire('alias-seuil-au', { 'a.effects.mjs': effets, 'c.mjs': usages(seuil) })
      assert.equal(dessous.erreurs, '')
      assert.equal(au.erreurs, '')
      assert.equal(compte(dessous.tout, /_mjs_alias/g), 0, `${seuil - 1} usage(s) : en clair`)
      assert.ok(compte(au.tout, /_mjs_alias/g) > 0, `${seuil} usages : une table`)
    })

    it('tous les usages tenus par une variable : aucune table, chaque usage reste écrit en clair', async () => {
      const usage = '<img src="a.png" alt="" *filter.depoli(blur: $b)>'
      const r = await construire('alias-table-variables', { 'a.effects.mjs': effets, 'c.mjs': `<script>\n$b = 5\n</script>\n${fois(6, usage)}` })
      assert.equal(r.erreurs, '')
      assert.equal(compte(r.tout, /_mjs_alias/g), 0, 'ni table ni renvoi')
      assert.equal(compte(r.coeur, /"spot":240/g), 0, 'rien de l\'alias dans le cœur')
      assert.equal(compte(r.unite('c-'), /"spot":240/g), 6, 'les six usages portent leurs réglages')
    })

    it('deux alias à six usages, l\'un renvoyé et l\'autre tenu par une variable : la table ne garde que le premier', async () => {
      const r = await construire('alias-table-un-seul', {
        'a.effects.mjs': effets,
        'c.mjs': `<script>\n$v = 5\n</script>\n${fois(6, '<img src="a.png" alt="" *filter.depoli>')}\n${fois(6, '<p *titre(speed: $v)>A</p>')}`
      })
      assert.equal(r.erreurs, '')
      assert.equal(compte(r.unite('c-'), /_mjs_alias\(\d+\)/g), 6)
      assert.match(r.coeur, /"blur":12/)
      assert.doesNotMatch(r.coeur, /"on":"click"/, 'l\'alias que personne ne renvoie n\'est pas dans la table')
    })
  })

  describe('l\'objet que µ._mjs_alias rend', () => {
    it('est neuf à chaque appel : écrire dans les réglages d\'un effet, ou les changer à l\'usage, ne touche pas la table', async () => {
      const r = await construire('alias-copie', {
        'a.effects.mjs': `<effects>\n  ${VERRE}\n</effects>`,
        'c1.mjs': fois(5, '<img src="a.png" alt="" *filter.depoli>'),
        'c2.mjs': '<img src="b.png" alt="" *filter.depoli(blur: 20)>'
      })
      assert.equal(r.erreurs, '')
      const bloc = /µ\._mjs_alias = \(function\(\) \{[\s\S]*?\n\}\)\(\);/.exec(r.coeur)?.[0]
      assert.ok(bloc, 'la table et sa fonction sont dans le cœur')
      const mu: any = {}
      new Function('µ', bloc)(mu)
      const a = mu._mjs_alias(0)
      assert.deepEqual(a, { style: 'none', blur: 12, spot: 240, soft: 100 })
      assert.notEqual(a, mu._mjs_alias(0), 'un objet neuf à chaque appel')
      a.blur = 99
      a.ajout = 1
      assert.equal(mu._mjs_alias(0).blur, 12, 'écrire dans le résultat n\'abîme pas la table')
      assert.equal('ajout' in mu._mjs_alias(0), false)
      const b = mu._mjs_alias(0, { blur: 20 })
      assert.deepEqual(b, { style: 'none', blur: 20, spot: 240, soft: 100 })
      assert.equal(mu._mjs_alias(0).blur, 12, 'le changement d\'un usage ne reste pas dans la table')
    })
  })

  describe('un doublon dans un fichier d\'effets', () => {
    it('est la seule erreur : les alias du fichier (et ceux de ModularJS) restent connus des composants', async () => {
      const r = await construire('alias-doublon', {
        'a.effects.mjs': '<effects>\n  *filter.net = *filter(sepia, amount: 0.5)\n  *filter.net = *filter(none, blur: 3)\n</effects>',
        'c.mjs': '<img src="a.png" alt="" *filter.net>\n<img src="b.png" alt="" *filter.frosted_glass>'
      })
      assert.equal(r.stats.errors.length, 1, r.erreurs)
      assert.match(r.erreurs, /\*filter\.net est déjà défini/)
      assert.doesNotMatch(r.erreurs, /alias connus/)
    })

    it('défini dans deux fichiers : une seule erreur aussi, la première déclaration est gardée', async () => {
      const r = await construire('alias-doublon-fichiers', {
        'a.effects.mjs': '<effects>\n  *filter.net = *filter(sepia, amount: 0.5)\n</effects>',
        'b.effects.mjs': '<effects>\n  *filter.net = *filter(none, blur: 3)\n</effects>',
        'c.mjs': '<img src="a.png" alt="" *filter.net>'
      })
      assert.equal(r.stats.errors.length, 1, r.erreurs)
      assert.match(r.erreurs, /\*filter\.net/)
      assert.doesNotMatch(r.erreurs, /alias connus/)
    })
  })

  describe('les sections d\'un effet en production', () => {
    const effets = '<effects>\n  *tilt.rebond = *tilt(bounce: 0.3, wait: 400ms)\n  *liquid.carreaux = *liquid(cells: 12)\n</effects>'
    // le code d'un effet : sa longueur dit les sections embarquées (le minifieur nomme les propriétés selon le build, le texte lui-même
    // varie d'un build à l'autre), ses marques disent lesquelles
    const module = (r: { unite: (prefixe: string) => string }, prefixe: string) => r.unite(prefixe)

    it('*tilt.rebond utilisé une ou deux fois embarque la section « bounce » de *tilt, comme les réglages écrits en clair', async () => {
      const prod  = { env: 'prod' }
      const clair = await construire('alias-sections-tilt-clair', { 'c.mjs': '<div *tilt(bounce: 0.3, wait: 400ms)>x</div>' }, prod)
      const un    = await construire('alias-sections-tilt-un', { 'a.effects.mjs': effets, 'c.mjs': '<div *tilt.rebond>x</div>' }, prod)
      const deux  = await construire('alias-sections-tilt-deux', { 'a.effects.mjs': effets, 'c.mjs': '<div *tilt.rebond>x</div>\n<div *tilt.rebond>y</div>' }, prod)
      for (const r of [clair, un, deux]) assert.equal(r.erreurs, '')
      assert.ok(compte(clair.tout, /Math\.exp/g) > 0, 'la référence : la section est là')
      assert.ok(compte(un.tout, /Math\.exp/g) > 0, 'un usage, en clair')
      assert.ok(compte(deux.tout, /Math\.exp/g) > 0, 'deux usages, en clair')
      assert.equal(compte(deux.unite('c-'), /bounce/g), 2, 'deux usages : les réglages sont écrits dans le composant')
      assert.equal(module(deux, 'mjs_fx_tilt').length, module(clair, 'mjs_fx_tilt').length, 'le même code d\'effet par l\'alias ou en clair')
      assert.equal(module(un, 'mjs_fx_tilt').length, module(clair, 'mjs_fx_tilt').length)
      assert.equal(compte(module(deux, 'mjs_fx_tilt'), /Math\.exp/g), compte(module(clair, 'mjs_fx_tilt'), /Math\.exp/g))
    })

    it('*tilt.rebond utilisé six fois, donc par la table, embarque la section « bounce » de *tilt, comme les réglages écrits en clair', async () => {
      const prod  = { env: 'prod' }
      const clair = await construire('alias-sections-tilt-clair-six', { 'c.mjs': fois(6, '<div *tilt(bounce: 0.3, wait: 400ms)>x</div>') }, prod)
      const six   = await construire('alias-sections-tilt-six', { 'a.effects.mjs': effets, 'c.mjs': fois(6, '<div *tilt.rebond>x</div>') }, prod)
      for (const r of [clair, six]) assert.equal(r.erreurs, '')
      assert.equal(compte(clair.unite('c-'), /bounce/g), 6, 'la référence : six fois les réglages dans le composant')
      assert.equal(compte(six.unite('c-'), /bounce/g), 0, 'six usages : les réglages sont dans la table, pas dans le composant')
      assert.ok(compte(six.tout, /Math\.exp/g) > 0, 'six usages, par la table')
      assert.equal(module(six, 'mjs_fx_tilt').length, module(clair, 'mjs_fx_tilt').length, 'le même code d\'effet par la table ou en clair')
      assert.equal(compte(module(six, 'mjs_fx_tilt'), /Math\.exp/g), compte(module(clair, 'mjs_fx_tilt'), /Math\.exp/g))
    })

    it('*liquid(cells: 12) en alias à deux usages : le même code d\'effet qu\'écrit en clair', async () => {
      const prod  = { env: 'prod' }
      const img   = '<img src="a.png" alt="" '
      const clair = await construire('alias-sections-liquid-clair', { 'c.mjs': `${img}*liquid(cells: 12)>` }, prod)
      const deux  = await construire('alias-sections-liquid-deux', { 'a.effects.mjs': effets, 'c.mjs': `${img}*liquid.carreaux>\n${img}*liquid.carreaux>` }, prod)
      for (const r of [clair, deux]) assert.equal(r.erreurs, '')
      assert.ok(module(deux, 'mjs_fx_liquid').length > 0)
      assert.equal(module(deux, 'mjs_fx_liquid').length, module(clair, 'mjs_fx_liquid').length)
    })

    it('*liquid(cells: 12) en alias à six usages, donc par la table : le même code d\'effet qu\'écrit en clair', async () => {
      const prod  = { env: 'prod' }
      const img   = '<img src="a.png" alt="" '
      const clair = await construire('alias-sections-liquid-clair-six', { 'c.mjs': fois(6, `${img}*liquid(cells: 12)>`) }, prod)
      const six   = await construire('alias-sections-liquid-six', { 'a.effects.mjs': effets, 'c.mjs': fois(6, `${img}*liquid.carreaux>`) }, prod)
      for (const r of [clair, six]) assert.equal(r.erreurs, '')
      assert.equal(compte(clair.unite('c-'), /cells/g), 6, 'la référence : six fois les réglages dans le composant')
      assert.equal(compte(six.unite('c-'), /cells/g), 0, 'six usages : les réglages sont dans la table, pas dans le composant')
      assert.ok(module(six, 'mjs_fx_liquid').length > 0)
      assert.equal(module(six, 'mjs_fx_liquid').length, module(clair, 'mjs_fx_liquid').length)
    })

    it('un réglage changé à l\'usage d\'un alias en table demande sa section aussi', () => {
      const table = [{ bounce: 0.3, wait: '400ms' }]
      const signaux = (js: string) => [...scanCompiledFeatures(js, undefined, table)]
      const table0  = signaux('µ._mjs_fx(this, _node, "tilt", µ._mjs_alias(0))')
      assert.ok(table0.includes('tilt_bounce:0.3'), table0.join(' '))
      assert.ok(table0.includes(fxAliasSignal(0)), 'le renvoi à la table est lu')
      const change = signaux('µ._mjs_fx(this, _node, "tilt", µ._mjs_alias(0, {"bounce":0.5}))')
      assert.ok(change.includes('tilt_bounce:0.5'), change.join(' '))
      assert.ok(!change.includes('tilt_bounce:0.3'), 'la valeur changée remplace celle de la table')
      assert.ok(change.includes('tilt_wait:400ms'))
    })

    it('un renvoi suivi d\'autres arguments (réglages tenus par une variable, transition) est lu aussi', () => {
      const table = [{ duration: '3s', bounce: 0.3 }]
      const signaux = (js: string) => [...scanCompiledFeatures(js, undefined, table)]
      const transition = signaux('µ._mjs_fxAnim(_mjsThis, node, "fade", µ._mjs_alias(0), null, null )')
      assert.ok(transition.includes('fade_duration:3s'), transition.join(' '))
      const variable = signaux('µ._mjs_fx(this, _node, "tilt", µ._mjs_alias(0), {"max": ($m)}, {"max": ["i", "x"]})')
      assert.ok(variable.includes('tilt_bounce:0.3'), variable.join(' '))
      assert.ok(variable.includes('tilt_max:*'), 'le réglage tenu par une variable demande toutes ses valeurs')
    })
  })
})

// le chemin d'un fichier d'image écrit à la pose d'un alias (`*behind.fond('photo.png')`) est résolu comme celui d'un effet
// sans alias ou d'un alias déclaré à plat : l'adresse publiée, le fichier copié dans la sortie, jamais le chemin écrit
describe('un chemin d\'image écrit à la pose d\'un alias', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  const effets = [
    '<effects>',
    '  *behind.fond = *behind(depth: 20)',
    '  *fondplat = *behind(depth: 20)',
    '  *behind.photo = *behind(\'photo.png\', depth: 10)',
    '  *photoplat = *behind(\'photo.png\', depth: 10)',
    '  *ink.brosse = *ink(style: brush)',
    '  *brosseplat = *ink(style: brush)',
    '  *scrub.cadres = *scrub(first: 15)',
    '  *cadresplat = *scrub(first: 15)',
    '  *offline.hors = *offline(delay: 75ms)',
    '</effects>'
  ].join('\n')
  // [la voie, l'écriture avec l'alias pointé, la même sans alias pointé (alias à plat, ou effet seul sur <@document>)]
  const voies: Array<[string, string, string]> = [
    ['une pose sur une balise',            '<div class="a" *behind.fond(\'photo.png\')></div>',                                    '<div class="a" *fondplat(\'photo.png\')></div>'],
    ['un réglage nommé image:',            '<div class="a" *behind.fond(image: \'img/photo.png\')></div>',                         '<div class="a" *fondplat(image: \'img/photo.png\')></div>'],
    ['une transition (@in=)',              '<div class="a" @in=*ink.brosse(image: \'photo.png\')>x</div>',                         '<div class="a" @in=*brosseplat(image: \'photo.png\')>x</div>'],
    ['une transition (@out=)',             '<div class="a" @out=*ink.brosse(image: \'photo.png\')>x</div>',                        '<div class="a" @out=*brosseplat(image: \'photo.png\')>x</div>'],
    ['une transition (@transition=)',      '<div class="a" @transition=*ink.brosse(image: \'photo.png\')>x</div>',                 '<div class="a" @transition=*brosseplat(image: \'photo.png\')>x</div>'],
    ['une liste d\'images',                '<canvas class="a" *scrub.cadres(images: [\'photo.png\', img/photo.png])></canvas>',    '<canvas class="a" *cadresplat(images: [\'photo.png\', img/photo.png])></canvas>'],
    ['<@document>',                        '<@document *offline.hors(logo: \'photo.png\')></@document>\n<p>x</p>',                 '<@document *offline(logo: \'photo.png\', delay: 75ms)></@document>\n<p>x</p>'],
    ['une image écrite dans l\'alias',     '<div class="a" *behind.photo></div>',                                                  '<div class="a" *photoplat></div>']
  ]
  const adresses       = (code: string) => code.match(/\/[\w/-]*photo-[0-9a-f]{8}\.png/g) ?? []
  const VOIES_EN_TABLE = 5
  let r: Awaited<ReturnType<typeof construire>>

  before(async () => {
    const fichiers: Record<string, string | Buffer> = { 'a.effects.mjs': effets, 'photo.png': png(), 'img/photo.png': png(48) }
    // les cinq premières voies posent leur alias six fois : il passe par la table, l'adresse de l'image part avec chaque usage ; les trois autres, une fois
    // (en clair : <@document> n'a pas de table, et l'image de la dernière est écrite dans l'alias, donc dans la table si l'alias y entrait)
    voies.forEach(([, pointe, sans], i) => {
      const n = i < VOIES_EN_TABLE ? 6 : 1
      fichiers[`voie${i}p.mjs`] = fois(n, pointe)
      fichiers[`voie${i}s.mjs`] = fois(n, sans)
    })
    r = await construire('alias-images', fichiers)
  })

  it('le projet se construit sans erreur', () => {
    assert.equal(r.erreurs, '')
  })

  it('les cinq premières voies, posées six fois, renvoient à la table avec l\'adresse de l\'image ; les autres sont écrites en clair', () => {
    voies.forEach(([voie], i) => {
      assert.equal(compte(r.unite(`voie${i}p-`), /_mjs_alias\(\d+, \{"image":"\/[\w/-]*photo-[0-9a-f]{8}\.png"\}\)/g), i < VOIES_EN_TABLE ? 6 : 0, voie)
    })
  })

  voies.forEach(([voie], i) => {
    it(`${voie} : l'adresse publiée, la même qu'avec l'alias à plat, jamais le chemin écrit`, () => {
      const pointe = r.unite(`voie${i}p-`)
      const sans   = r.unite(`voie${i}s-`)
      assert.ok(adresses(sans).length > 0, `la référence ne porte aucune adresse publiée : ${sans.slice(0, 300)}`)
      assert.ok(adresses(pointe).length > 0, `aucune adresse publiée avec l'alias pointé : ${pointe.match(/_mjs_fx\w*\([^\n]{0,200}/)}`)
      assert.deepEqual(adresses(pointe), adresses(sans))
      assert.doesNotMatch(pointe, /["'](?:\.\/)?(?:img\/)?photo\.png["']/, 'le chemin écrit ne part pas dans le code')
    })
  })

  it('les fichiers publiés sont copiés dans la sortie', () => {
    const publiees = [...new Set(adresses(r.tout))]
    assert.ok(publiees.length >= 2, publiees.join(' '))
    for (const a of publiees) assert.ok(r.sortie.includes(a.split('/').pop()!), `${a} absent de la sortie : ${r.sortie.join(' ')}`)
  })

  it('un alias posé six fois avec une image à la pose : la table ne garde que les réglages, l\'adresse part avec l\'usage', async () => {
    const t = await construire('alias-images-table', {
      'a.effects.mjs': effets,
      'photo.png':     png(),
      'c1.mjs':        fois(3, '<div class="a" *behind.fond(\'photo.png\')></div>'),
      'c2.mjs':        fois(3, '<div class="b" *behind.fond(\'photo.png\')></div>')
    })
    assert.equal(t.erreurs, '')
    const renvoi = /_mjs_alias\(\d+, \{"image":"\/[\w/-]*photo-[0-9a-f]{8}\.png"\}\)/g
    assert.equal(compte(t.unite('c1-'), renvoi), 3)
    assert.equal(compte(t.unite('c2-'), renvoi), 3)
    assert.doesNotMatch(t.tout, /["']photo\.png["']/)
  })

  it('un alias posé cinq fois avec une image à la pose : écrit en clair, avec l\'adresse, dans chaque composant', async () => {
    const t = await construire('alias-images-cinq', {
      'a.effects.mjs': effets,
      'photo.png':     png(),
      'c1.mjs':        fois(2, '<div class="a" *behind.fond(\'photo.png\')></div>'),
      'c2.mjs':        fois(3, '<div class="b" *behind.fond(\'photo.png\')></div>')
    })
    assert.equal(t.erreurs, '')
    assert.equal(compte(t.tout, /_mjs_alias/g), 0, 'ni table ni renvoi')
    assert.equal(compte(t.unite('c1-') + t.unite('c2-'), /"depth":20,"image":"\/[\w/-]*photo-[0-9a-f]{8}\.png"/g), 5)
    assert.doesNotMatch(t.tout, /["']photo\.png["']/)
  })

  it('un fichier absent derrière un alias pointé : l\'erreur nomme l\'alias et le chemin', async () => {
    const t = await construire('alias-images-absent', { 'a.effects.mjs': effets, 'photo.png': png(), 'c.mjs': '<div class="a" *behind.fond(\'absente.png\')></div>' })
    assert.match(t.erreurs, /absente\.png/)
    assert.match(t.erreurs, /\*behind\.fond/)
  })
})

const echappe = (texte: string) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// un point suivi de rien, d'un autre point ou d'un second nom (`*filter.`, `*filter..x`, `*filter.net.x`) n'est pas un nom d'alias : la
// construction s'arrête sur l'erreur de nom, qui dit ce qui est écrit en entier et sa ligne. Avant, la balise recevait un attribut parasite
// (`.`, `.x`, `blur:`) et rien n'était dit
describe('une forme à point mal formée arrête la construction et nomme ce qui est écrit', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  const effets = '<effects>\n  *filter.net = *filter(none, blur: 5)\n  *fade.lent = *fade(duration: 3s)\n  *ripple.rouge = *ripple(#f00)\n</effects>'
  const img    = '<img src="a.png" alt="" '
  // [le fichier, sa source (la faute est sur la ligne 2), le nom tel qu'il est écrit]
  const cas: Array<[string, string, string]> = [
    ['point',            `<p>un</p>\n${img}*filter.>`,                                  '*filter.'],
    ['deux-points',      `<p>un</p>\n${img}*filter..x>`,                                '*filter..x'],
    ['alias-puis-point', `<p>un</p>\n${img}*filter.net.x>`,                             '*filter.net.x'],
    ['point-reglages',   `<p>un</p>\n${img}*filter.(blur: 3)>`,                         '*filter.'],
    ['in-point',         '<p>un</p>\n<div class="a" @in=*fade.>x</div>',                '*fade.'],
    ['in-alias-point',   '<p>un</p>\n<div class="a" @in=*fade.lent.x>x</div>',          '*fade.lent.x'],
    ['transition-point', '<p>un</p>\n<div class="a" @transition=*fade.>x</div>',        '*fade.'],
    ['out-alias-point',  '<p>un</p>\n<div class="a" @out=*fade.lent.x>x</div>',         '*fade.lent.x'],
    ['page-point',       '<p>un</p>\n<@document *ripple.></@document>',                 '*ripple.'],
    ['page-deux-noms',   '<p>un</p>\n<@document *ripple.a.b></@document>',              '*ripple.a.b']
  ]
  let r: Awaited<ReturnType<typeof construire>>

  before(async () => {
    const fichiers: Record<string, string> = { 'a.effects.mjs': effets }
    for (const [f, source] of cas) fichiers[`${f}.mjs`] = source
    // les formes bien écrites, à côté : elles se construisent
    fichiers['temoin-balise.mjs'] = `<p>un</p>\n${img}*filter.net>`
    fichiers['temoin-in.mjs']     = '<p>un</p>\n<div class="a" @in=*fade.lent>x</div>'
    fichiers['temoin-page.mjs']   = '<p>un</p>\n<@document *ripple.rouge></@document>'
    r = await construire('alias-point-mal-forme', fichiers)
  })

  for (const [f, , ecrit] of cas) {
    it(`${f} : l'erreur nomme ${ecrit} et sa ligne, rappelle la règle des noms`, () => {
      assert.match(r.erreurDe(f), new RegExp(`\\[ModularJS\\] ${echappe(ecrit)} \\(ligne 2\\) : le nom d'un alias s'écrit en minuscules, chiffres et _ seulement`))
    })
  }

  it('l\'erreur ne nomme jamais un morceau du nom (*ripple.a, *filter.net seuls)', () => {
    assert.doesNotMatch(r.erreurDe('page-deux-noms'), /\[ModularJS\] \*ripple\.a(?![\w.])/)
    assert.doesNotMatch(r.erreurDe('alias-puis-point'), /\[ModularJS\] \*filter\.net(?![\w.])/)
    assert.doesNotMatch(r.erreurDe('in-alias-point'), /\[ModularJS\] \*fade\.lent(?![\w.])/)
  })

  it('une seule erreur par fichier fautif, et aucune pour les formes bien écrites', () => {
    assert.equal(r.stats.errors.length, cas.length, r.erreurs)
    for (const f of ['temoin-balise', 'temoin-in', 'temoin-page']) assert.equal(r.erreurDe(f), '', f)
  })
})

// les fautes d'alias sur <@document> citent la ligne de la balise, en français comme en anglais ; les directives @in, @out et @transition
// aussi en anglais (le français les citait déjà)
describe('la ligne d\'une faute d\'alias sur <@document> et sur une transition, dans les deux langues', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  const effets = '<effects>\n  *fade.lent = *fade(duration: 3s)\n  *ripple.rouge = *ripple(#f00, size: 60)\n</effects>'
  const sources: Record<string, string> = {
    'page-inconnu.mjs':   '<p>un</p>\n<@document *ripple.zzz></@document>',
    'page-nom.mjs':       '<p>un</p>\n<@document *ripple.Rouge></@document>',
    'page-reglage.mjs':   '<p>un</p>\n<@document *ripple.rouge(size: abc)></@document>',
    'page-effet.mjs':     '<p>un</p>\n<@document *tilt.vif></@document>',
    'in-inconnu.mjs':     '<p>un</p>\n<div class="a" @in=*fade.zzz>x</div>',
    'out-inconnu.mjs':    '<p>un</p>\n<div class="a" @out=*fade.zzz>x</div>',
    'trans-inconnu.mjs':  '<p>un</p>\n<div class="a" @transition=*fade.zzz>x</div>',
    'in-reglage.mjs':     '<p>un</p>\n<div class="a" @in=*fade.lent(duration: abc)>x</div>'
  }

  async function lire(langue: 'fr' | 'en') {
    setMessagesLang(langue)
    try {
      return await construire('alias-lignes-' + langue, { 'a.effects.mjs': effets, ...sources })
    }
    finally {
      setMessagesLang('fr')
    }
  }

  it('en français : <@document> cite la ligne de sa balise', async () => {
    const r = await lire('fr')
    assert.match(r.erreurDe('page-inconnu'), /\[ModularJS\] \*ripple\.zzz \(ligne 2\) : aucun alias de ce nom pour \*ripple/)
    assert.match(r.erreurDe('page-nom'), /\[ModularJS\] \*ripple\.Rouge \(ligne 2\) : le nom d'un alias s'écrit en minuscules/)
    assert.match(r.erreurDe('page-reglage'), /\[ModularJS\] \*ripple\.rouge \(ligne 2\) : size = abc/)
    assert.match(r.erreurDe('page-effet'), /\[ModularJS\] \*tilt\.vif \(ligne 2\) /)
  })

  it('en français : les directives citaient déjà leur ligne', async () => {
    const r = await lire('fr')
    for (const f of ['in-inconnu', 'out-inconnu', 'trans-inconnu']) assert.match(r.erreurDe(f), /\[ModularJS\] \*fade\.zzz \(ligne 2\) : aucun alias de ce nom pour \*fade/, f)
    assert.match(r.erreurDe('in-reglage'), /\[ModularJS\] \*fade\.lent \(ligne 2\) : duration = abc/)
  })

  it('en anglais : <@document> cite la ligne de sa balise', async () => {
    const r = await lire('en')
    assert.match(r.erreurDe('page-inconnu'), /\[ModularJS\] \*ripple\.zzz \(line 2\): no alias of that name for \*ripple/)
    assert.match(r.erreurDe('page-nom'), /\[ModularJS\] \*ripple\.Rouge \(line 2\): an alias name is written with lowercase letters/)
    assert.match(r.erreurDe('page-reglage'), /\[ModularJS\] \*ripple\.rouge \(line 2\): size = abc/)
    assert.match(r.erreurDe('page-effet'), /\[ModularJS\] \*tilt\.vif \(line 2\) /)
  })

  it('en anglais : @in=, @out= et @transition= citent leur ligne', async () => {
    const r = await lire('en')
    for (const f of ['in-inconnu', 'out-inconnu', 'trans-inconnu']) assert.match(r.erreurDe(f), /\[ModularJS\] \*fade\.zzz \(line 2\): no alias of that name for \*fade/, f)
    assert.match(r.erreurDe('in-reglage'), /\[ModularJS\] \*fade\.lent \(line 2\): duration = abc/)
  })
})

// « effet inconnu » liste les effets (ceux de la bibliothèque et ceux de l'appli), jamais les alias : ils se listent dans l'erreur d'alias
// inconnu, pour l'effet concerné seulement
describe('le message « effet inconnu » liste les effets, pas les alias', () => {
  const appli = (): Record<string, ProjectEffect> => resolveProjectEffects([parseEffectsBlock('*filter.net = *filter(none, blur: 5)\n*titre = *scramble(311, on: click)', 1, 'a.effects.mjs')])
  const message = (nom: string): string => {
    try {
      parseEffect(nom, '')
    }
    catch (e) {
      return (e as Error).message
    }
    return ''
  }
  const attendus = [...Object.keys(EFFECTS), 'titre'].sort().map((n) => '*' + n)

  afterEach(() => setMessagesLang('fr'))

  it('*zzz : la liste est celle des effets et de l\'effet *titre de l\'appli, aucun alias (livré ou de l\'appli)', () => {
    withProjectEffects(appli(), () => {
      const m = message('zzz')
      assert.deepEqual(/effets disponibles : (.*)\.$/.exec(m)?.[1].split(', '), attendus)
      assert.doesNotMatch(m, /\*[a-z]+\.[a-z_]+/)
    })
  })

  it('en anglais aussi', () => {
    setMessagesLang('en')
    withProjectEffects(appli(), () => {
      const m = message('zzz')
      assert.deepEqual(/available effects: (.*)\.$/.exec(m)?.[1].split(', '), attendus)
      assert.doesNotMatch(m, /\*[a-z]+\.[a-z_]+/)
    })
  })

  it('un effet retiré de la bibliothèque : la même liste', () => {
    withProjectEffects(appli(), () => {
      const m = message('trail')
      assert.match(m, /retiré de la bibliothèque/)
      assert.deepEqual(/effets disponibles : (.*)\.$/.exec(m)?.[1].split(', '), attendus)
    })
  })

  it('la suggestion d\'un effet voisin reste proposée, alias compris : *fliter.frosted_glass → *filter.frosted_glass', () => {
    withProjectEffects(appli(), () => {
      assert.match(message('fliter.frosted_glass'), /Vouliez-vous dire \*filter\.frosted_glass \?/)
      assert.match(message('titre2'), /Vouliez-vous dire \*titre \?/)
    })
  })

  it('l\'alias inconnu liste les alias de son effet, et de lui seul', () => {
    withProjectEffects(appli(), () => {
      const m = message('filter.zzz')
      const connus = [...MJS_ALIASES.split('\n').filter((l) => l.startsWith('*filter.')).map((l) => l.slice(1, l.indexOf(' '))), 'filter.net'].sort().map((n) => `*${n}`).join(', ')
      assert.ok(m.includes(`alias connus : ${connus}.`), m)
      assert.doesNotMatch(m, /\*tilt\./)
    })
  })
})

// une faute dans le fichier d'effets de l'appli arrête le build, mais les alias que ModularJS livre ne dépendent pas de ce fichier : ils
// restent connus. Sinon chaque composant qui en pose un ajoute une erreur trompeuse (« alias connus : — »)
describe('une faute du fichier d\'effets de l\'appli ne fait pas oublier les alias livrés', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('l\'alias livré se pose, l\'alias inconnu liste les alias livrés, la faute du fichier est la seule autre erreur', async () => {
    const r = await construire('alias-fichier-faux', {
      'a.effects.mjs': '<effects>\n  *filter.net\n</effects>',
      'livre.mjs':     '<img src="a.png" alt="" *filter.frosted_glass>',
      'inconnu.mjs':   '<img src="a.png" alt="" *filter.zzz>'
    })
    assert.equal(r.erreurDe('livre'), '', 'un alias livré se pose malgré la faute du fichier d\'effets')
    assert.doesNotMatch(r.erreurs, /alias connus : —/)
    const livres = MJS_ALIASES.split('\n').filter((x) => x.startsWith('*filter.')).map((x) => x.slice(0, x.indexOf(' '))).sort().join(', ')
    assert.ok(r.erreurDe('inconnu').includes(`alias connus : ${livres}.`), r.erreurDe('inconnu'))
    assert.equal(r.stats.errors.length, 2, r.erreurs)
    assert.match(r.erreurs, /a\.effects\.mjs/)
  })
})

// un alias livré qui porte son déclencheur (`on: view`) ne s'emploie pas après @in= : le message le dit, au lieu de demander de retirer un
// `on` que l'auteur n'a pas écrit ; un `on` écrit par l'auteur garde son message
describe('un alias livré qui porte un déclencheur, posé après @in=, @out= ou @transition=', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  const sources: Record<string, string> = {
    'in.mjs':    '<p>un</p>\n<div class="a" @in=*fly.spin_in>x</div>',
    'out.mjs':   '<p>un</p>\n<div class="a" @out=*fly.spin_in(duration: 2s)>x</div>',
    'trans.mjs': '<p>un</p>\n<div class="a" @transition=*fly.spin_in>x</div>',
    'ecrit.mjs': '<p>un</p>\n<div class="a" @in=*fly.spin_in(on: hover)>x</div>'
  }

  it('en français : l\'alias porte un déclencheur (on: view), il ne s\'emploie donc pas après la directive', async () => {
    const r = await construire('alias-declencheur-fr', sources)
    for (const [f, directive] of [['in', '@in'], ['out', '@out'], ['trans', '@transition']]) {
      const m = r.erreurDe(f)
      assert.match(m, new RegExp(`\\[ModularJS\\] ${directive}=\\*fly\\.spin_in : l'alias \\*fly\\.spin_in porte un déclencheur \\(on: view\\)`), f)
      assert.match(m, new RegExp(`il ne s'emploie donc pas après ${directive}=`), f)
      assert.doesNotMatch(m, /Retirez-le/, f)
    }
  })

  it('en anglais : the alias carries a trigger (on: view), so it cannot be used after the directive', async () => {
    setMessagesLang('en')
    try {
      const r = await construire('alias-declencheur-en', sources)
      for (const [f, directive] of [['in', '@in'], ['out', '@out'], ['trans', '@transition']]) {
        const m = r.erreurDe(f)
        assert.match(m, new RegExp(`\\[ModularJS\\] ${directive}=\\*fly\\.spin_in: the alias \\*fly\\.spin_in carries a trigger \\(on: view\\)`), f)
        assert.match(m, new RegExp(`so it cannot be used after ${directive}=`), f)
        assert.doesNotMatch(m, /Remove it/, f)
      }
    }
    finally {
      setMessagesLang('fr')
    }
  })

  it('un `on` écrit par l\'auteur à la pose garde son message : « Retirez-le »', async () => {
    const r = await construire('alias-declencheur-ecrit', sources)
    assert.match(r.erreurDe('ecrit'), /@in=\*fly\.spin_in : « on » n'a pas de sens ici/)
    assert.match(r.erreurDe('ecrit'), /Retirez-le/)
  })
})

// l'exemple d'un nom d'alias, dans les messages et dans la doc, est un nom livré (en anglais), pas un nom français ; lequel des alias livrés de
// l'effet est cité ne compte pas ici (le bloc « l'exemple d'un nom d'alias mal formé existe pour l'effet concerné » en fixe la règle)
describe('l\'exemple de nom d\'alias est un alias livré', () => {
  afterEach(() => setMessagesLang('fr'))

  const livres  = (effet: string): string[] => MJS_ALIASES.split('\n').filter((l) => l.startsWith(`*${effet}.`)).map((l) => l.slice(l.indexOf('.') + 1, l.indexOf(' ')))
  const exemple = (message: string): string => /\(\*filter\.([a-z_0-9]+)\)/.exec(message)?.[1] ?? ''

  it('à l\'usage (effets.alias-nom) et à la déclaration (effets-fichier.alias-nom), en français et en anglais', () => {
    for (const langue of ['fr', 'en'] as const) {
      setMessagesLang(langue)
      assert.throws(() => parseEffect('filter.Net', ''), (e: Error) => livres('filter').includes(exemple(e.message)) && !/verre/i.test(e.message), langue)
      assert.throws(() => parseEffectsBlock('*filter.Net = *filter(blur: 3)', 1, 'a.effects.mjs'), (e: Error) => livres('filter').includes(exemple(e.message)) && !/verre/i.test(e.message), langue)
    }
  })

  it('la doc donne un exemple du même genre, sans nom français', () => {
    const doc   = readFileSync(new URL('../docs/38-effets.md', import.meta.url), 'utf8')
    const nom   = doc.split('\n').find((l) => l.startsWith('- **Le nom**')) ?? ''
    const cite  = /\(`([a-z_0-9]+)`, jamais /.exec(nom)?.[1] ?? ''
    assert.ok(livres('filter').includes(cite), `« ${cite} » n'est pas un alias livré de *filter`)
    assert.doesNotMatch(nom, /verre_depoli|verre-depoli/)
  })
})

// un point qui suit un effet sans faire partie du nom d'un alias n'est ni un attribut ni un détail sans suite : séparé de l'effet par un blanc
// (`*filter .net`), collé à ses réglages (`*filter.net(blur: 3).x`) ou sans effet devant lui (`*.net`), le build s'arrête, dit ce qui est écrit et sa
// ligne. Un point qui n'a pas un effet pour voisin n'est pas lu ici
describe('un point qui suit un effet sans être le nom d\'un alias arrête la construction et nomme ce qui est écrit', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  const effets = '<effects>\n  *filter.net = *filter(none, blur: 5)\n  *fade.lent = *fade(duration: 3s)\n  *ripple.rouge = *ripple(#f00)\n</effects>'
  const img    = '<img src="a.png" alt="" '
  const espace = (point: string, exemple: string) => new RegExp(`un espace sépare « ${echappe(point)} » de son effet — le nom d'un alias se colle à son effet, sans espace \\(${exemple}\\)\\.`)
  const apres  = (point: string, exemple: string) => new RegExp(`« ${echappe(point)} » suit les réglages — le nom d'un alias se place avant eux, collé à son effet : ${exemple}\\(réglages\\)\\.`)
  const sans   = /il manque le nom de l'effet avant le point — un alias s'écrit \*effet\.nom/
  // [le fichier, sa source (la faute est sur la ligne 2, sauf si la ligne est donnée), ce qui est écrit, la suite du message, la ligne]
  const cas: Array<[string, string, string, RegExp, number?]> = [
    ['espace',                  `<p>un</p>\n${img}*filter .net>`,                                                      '*filter .net',          espace('.net', '\\*filter\\.[a-z_0-9]+')],
    ['espace-alias',            `<p>un</p>\n${img}*filter.net .x>`,                                                    '*filter.net .x',        espace('.x', '\\*filter\\.[a-z_0-9]+')],
    ['espace-ligne-suivante',   `<p>un</p>\n<p>deux</p>\n<img src="a.png" alt=""\n  *filter\n  .net>`,                 '*filter .net',          espace('.net', '\\*filter\\.[a-z_0-9]+'), 4],
    ['sans-effet',              `<p>un</p>\n${img}*.net>`,                                                             '*.net',                 sans],
    ['apres-reglages',          `<p>un</p>\n${img}*filter.net(blur: 3).x>`,                                            '*filter.net(…).x',      apres('.x', '\\*filter\\.[a-z_0-9]+')],
    ['apres-reglages-point',    `<p>un</p>\n${img}*filter.net(blur: 3).>`,                                             '*filter.net(…).',       apres('.', '\\*filter\\.[a-z_0-9]+')],
    ['apres-reglages-effet',    `<p>un</p>\n${img}*filter(blur: 3).x>`,                                                '*filter(…).x',          apres('.x', '\\*filter\\.[a-z_0-9]+')],
    ['apres-reglages-espace',   `<p>un</p>\n${img}*filter.net(blur: 3) .x>`,                                           '*filter.net(…) .x',     apres('.x', '\\*filter\\.[a-z_0-9]+')],
    ['apres-reglages-neon',     `<p>un</p>\n${img}*neon(#f0f) .5>`,                                                    '*neon(…) .5',           apres('.5', '\\*neon\\.[a-z_]+')],
    ['espace-alias-appli',      `<p>un</p>\n<div class="a" *fade .lent>x</div>`,                                      '*fade .lent',           espace('.lent', '\\*fade\\.lent')],
    ['page-reglages-espace',    '<p>un</p>\n<@document *ripple.rouge(size: 30) .x></@document>',                       '*ripple.rouge(…) .x',   apres('.x', '\\*ripple\\.rouge')],
    ['effet-sans-alias-livre',  `<p>un</p>\n<div class="a" *ripple(size: 30).x>x</div>`,                               '*ripple(…).x',          apres('.x', '\\*ripple\\.rouge')],
    ['in-reglages',             '<p>un</p>\n<div class="a" @in=*fade.lent(duration: 2s).x>x</div>',                    '*fade.lent(…).x',       apres('.x', '\\*fade\\.[a-z_]+')],
    ['in-espace',               '<p>un</p>\n<div class="a" @in=*fade .lent>x</div>',                                   '*fade .lent',           espace('.lent', '\\*fade\\.[a-z_]+')],
    ['out-espace',              '<p>un</p>\n<div class="a" @out=*fade .lent>x</div>',                                  '*fade .lent',           espace('.lent', '\\*fade\\.[a-z_]+')],
    ['transition-reglages',     '<p>un</p>\n<div class="a" @transition=*fade.lent(duration: 2s).x>x</div>',           '*fade.lent(…).x',       apres('.x', '\\*fade\\.[a-z_]+')],
    ['page-sans-effet',         '<p>un</p>\n<@document *.rouge></@document>',                                          '*.rouge',               sans],
    ['page-reglages',           '<p>un</p>\n<@document *ripple.rouge(size: 30).x></@document>',                        '*ripple.rouge(…).x',    apres('.x', '\\*ripple\\.rouge')],
    ['page-espace',             '<p>un</p>\n<@document *ripple .rouge></@document>',                                   '*ripple .rouge',        espace('.rouge', '\\*ripple\\.rouge')],
    ['page-sans-effet-ligne',   '<p>un</p>\n<@document\n  @click={$x = 1}\n  *.rouge></@document>',                    '*.rouge',               sans, 4]
  ]
  let r: Awaited<ReturnType<typeof construire>>

  before(async () => {
    const fichiers: Record<string, string> = { 'a.effects.mjs': effets }
    for (const [f, source] of cas) fichiers[`${f}.mjs`] = source
    // ce qui est bien écrit, à côté : les formes à point, les valeurs à point (une durée, une cible, une couleur), la fin de la balise
    fichiers['temoin-alias.mjs']    = `<p>un</p>\n${img}*filter.net>\n${img}*filter.net(blur: 3) />\n<div class="a" @in=*fade.lent(duration: .5s)>x</div>`
    fichiers['temoin-page.mjs']     = '<p>un</p>\n<@document *ripple.rouge(size: 40)></@document>'
    fichiers['temoin-valeurs.mjs']  = '<p>un</p>\n<div class="a" *fade(duration: .3s)>x</div>\n<div class="b" *travel(.cible)>x</div>\n<div class="c" *neon(#f0f)>x</div>\n<div class="d" *travel(to: .a.b)>x</div>'
    // un attribut dont le nom commence par un point, loin de tout effet (un autre attribut les sépare) : ce n'est pas lu ici
    fichiers['temoin-eloigne.mjs']  = '<p>un</p>\n<div *fade class="a" .x>x</div>'
    r = await construire('alias-point-voisin', fichiers)
  })

  for (const [f, , ecrit, suite, ligne = 2] of cas) {
    it(`${f} : l'erreur nomme ${ecrit} et sa ligne (${ligne}), et dit quoi écrire`, () => {
      assert.match(r.erreurDe(f), new RegExp(`\\[ModularJS\\] ${echappe(ecrit)} \\(ligne ${ligne}\\) : `))
      assert.match(r.erreurDe(f), suite)
    })
  }

  it('une seule erreur par fichier fautif, et aucune pour les formes bien écrites, les valeurs à point et l\'attribut éloigné', () => {
    assert.equal(r.stats.errors.length, cas.length, r.erreurs)
    for (const f of ['temoin-alias', 'temoin-page', 'temoin-valeurs', 'temoin-eloigne']) assert.equal(r.erreurDe(f), '', f)
  })

  it('en anglais aussi : le même texte, sans espace avant les deux-points', async () => {
    setMessagesLang('en')
    try {
      const e = await construire('alias-point-voisin-en', {
        'a.effects.mjs': effets,
        'espace.mjs':    `<p>un</p>\n${img}*filter .net>`,
        'sans.mjs':      `<p>un</p>\n${img}*.net>`,
        'apres.mjs':     `<p>un</p>\n${img}*filter.net(blur: 3).x>`,
        'page.mjs':      '<p>un</p>\n<@document *ripple.rouge(size: 30).x></@document>'
      })
      assert.match(e.erreurDe('espace'), /\[ModularJS\] \*filter \.net \(line 2\): a space separates "\.net" from its effect — an alias name sticks to its effect, with no space \(\*filter\.[a-z_0-9]+\)\./)
      assert.match(e.erreurDe('sans'), /\[ModularJS\] \*\.net \(line 2\): the effect name is missing before the dot — an alias is written \*effect\.name/)
      assert.match(e.erreurDe('apres'), /\[ModularJS\] \*filter\.net\(…\)\.x \(line 2\): "\.x" follows the settings — an alias name goes before them, stuck to its effect: \*filter\.[a-z_0-9]+\(settings\)\./)
      assert.match(e.erreurDe('page'), /\[ModularJS\] \*ripple\.rouge\(…\)\.x \(line 2\): "\.x" follows the settings/)
    }
    finally {
      setMessagesLang('fr')
    }
  })
})

// un fichier d'effets qui contient une faute n'est jamais lu de moins en moins : sa faute est la seule erreur en plus des composants qui se trompent
// vraiment, et ses alias valides restent connus — ceux qu'il déclare avant la faute comme ceux d'après (une déclaration fautive est sautée avec ce qu'elle
// porte en retrait), et ceux d'un autre fichier. Un alias qui dépend de la déclaration fautive reste inconnu : il n'est pas valide
describe('un fichier d\'effets fautif ne fait pas oublier ses alias valides', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  // [le fichier, ses lignes] : les alias valides sont de part et d'autre de la faute
  const fichiers: Array<[string, string]> = [
    ['ligne',   '*fade.lent = *fade(duration: 3s)\n  ceci n est pas un effet\n  *filter.net = *filter(none, blur: 5)'],
    ['nom',     '*ripple.rouge = *ripple(#f00)\n  *filter.Net = *filter(blur: 3)\n  *tilt.doux = *tilt(max: 5)'],
    ['cible',   '*fade.vite = *fade(duration: 1s)\n  *vieux = *inconnu\n  *tilt.vif = *tilt(max: 20)'],
    ['reglage', '*neon.rose = *neon(#f0f)\n  *filter.mauvais = *filter(zzz: 1)\n  *fade.moyen = *fade(duration: 2s)'],
    ['rond',    '*fade.long = *fade(duration: 5s)\n  *a = *b\n  *b = *a\n  *filter.flou = *filter(none, blur: 9)'],
    ['corps',   '*ripple.bleu = *ripple(#00f)\n  *halo(color: #0ff) =\n    box-shadow: $zzz\n  *tilt.mou = *tilt(max: 3)']
  ]
  const valides = ['filter.net', 'fade.lent', 'ripple.rouge', 'tilt.doux', 'fade.vite', 'tilt.vif', 'neon.rose', 'fade.moyen', 'fade.long', 'filter.flou', 'ripple.bleu', 'tilt.mou']
  let r: Awaited<ReturnType<typeof construire>>

  before(async () => {
    const sources: Record<string, string> = {}
    for (const [f, lignes] of fichiers) sources[`${f}.effects.mjs`] = `<effects>\n  ${lignes}\n</effects>`
    // un composant qui pose chaque alias valide : balise, transition et page
    const balises = valides.filter((n) => !['fade.lent', 'ripple.rouge'].includes(n)).map((n) => n.startsWith('filter.') ? `<img src="a.png" alt="" *${n}>` : `<div class="a" *${n}>x</div>`)
    sources['pose.mjs']    = `<p>un</p>\n${balises.join('\n')}\n<div class="b" @in=*fade.lent>y</div>`
    sources['page.mjs']    = '<p>un</p>\n<@document *ripple.rouge></@document>'
    sources['inconnu.mjs'] = '<p>un</p>\n<img src="a.png" alt="" *filter.zzz>'
    r = await construire('alias-fichier-fautif', sources)
  })

  it('les alias valides de chaque fichier se posent, avant la faute comme après, sur une balise, une transition et la page', () => {
    assert.equal(r.erreurDe('pose'), '')
    assert.equal(r.erreurDe('page'), '')
    assert.doesNotMatch(r.erreurs, /aucun alias de ce nom pour \*(?:filter|fade|ripple|tilt|neon)\.(?:net|lent|rouge|doux|vite|vif|rose|moyen|long|flou|bleu|mou)\b/)
  })

  it('l\'alias inconnu liste les alias connus, ceux des fichiers fautifs compris', () => {
    const e = r.erreurDe('inconnu')
    assert.match(e, /aucun alias de ce nom pour \*filter/)
    assert.doesNotMatch(e, /alias connus : —/)
    assert.match(e, /\*filter\.flou/)
    assert.match(e, /\*filter\.net/)
    assert.doesNotMatch(e, /\*filter\.mauvais|\*filter\.Net/)
  })

  it('une erreur par faute, citée avec son fichier : rien d\'autre que les fautes et le composant qui se trompe vraiment', () => {
    // six fichiers fautifs, une faute chacun (le rond n'est dit qu'une fois), plus l'alias inconnu
    const fautes = r.stats.errors.map((e: any) => String(e.message)).filter((m: string) => fichiers.some(([f]) => m.includes(`${f}.effects.mjs`)))
    assert.equal(fautes.length, fichiers.length, r.erreurs)
    for (const [f] of fichiers) assert.ok(fautes.some((m: string) => m.includes(`${f}.effects.mjs`)), `la faute de ${f}.effects.mjs est dite`)
    assert.equal(r.stats.errors.length, fichiers.length + 1, r.erreurs)
  })

  it('sans la liste de problèmes (l\'API directe), la première faute arrête la lecture, comme avant', () => {
    assert.throws(() => parseEffectsBlock('*fade.lent = *fade(duration: 3s)\nceci n est pas un effet', 1, 'a.effects.mjs'), /a\.effects\.mjs \(ligne 2\)/)
    assert.throws(() => resolveProjectEffects([parseEffectsBlock('*x = *inconnu', 1, 'a.effects.mjs')]), /\*x = \*inconnu/)
  })

  it('parseEffectsBlock avec problems : les fautes sont rangées, les déclarations valides rendues (la fautive est sautée avec son retrait)', () => {
    const problems: Error[] = []
    const lus = parseEffectsBlock('*fade.lent = *fade(duration: 3s)\n*halo(color: #0ff) =\n  box-shadow: 0 0 4px $zzz\n  color: red\nceci n est pas un effet\n  encore\n*filter.net = *filter(none, blur: 5)', 1, 'a.effects.mjs', problems)
    assert.deepEqual(Object.keys(lus), ['fade.lent', 'filter.net'])
    assert.equal(problems.length, 2)
    assert.match(problems[0].message, /\(ligne 3\)/)
    assert.match(problems[1].message, /\(ligne 5\)/)
  })

  it('resolveProjectEffects avec problems : l\'effet qui ne se résout pas manque, les autres sont rendus, chaque faute n\'est dite qu\'une fois', () => {
    const problems: Error[] = []
    const lus   = parseEffectsBlock('*filter.net = *filter(none, blur: 5)\n*a = *b\n*b = *a\n*c = *a\n*d = *inconnu', 1, 'a.effects.mjs')
    const rendus = resolveProjectEffects([lus], undefined, problems)
    assert.ok(rendus['filter.net'] && !rendus.a && !rendus.b && !rendus.c && !rendus.d)
    assert.equal(problems.length, 2, problems.map((e) => e.message).join('\n'))
    assert.match(problems.map((e) => e.message).join('\n'), /en rond/)
    assert.match(problems.map((e) => e.message).join('\n'), /\*d = \*inconnu/)
  })
})

// l'exemple d'un nom d'alias qui existe pour l'effet concerné (son premier alias livré, dans l'ordre alphabétique de la liste qui suit), un nom neutre quand
// ModularJS n'en livre aucun pour lui : jamais l'alias d'un autre effet
describe('l\'exemple d\'un nom d\'alias mal formé existe pour l\'effet concerné', () => {
  // l'exemple lit aussi les alias de l'appli en cours : ces tests parlent d'une appli sans effet, pas de celle qu'un test d'avant a posée
  beforeEach(() => setProjectEffects(undefined))
  afterEach(() => setMessagesLang('fr'))

  const livres = (effet: string): string[] => MJS_ALIASES.split('\n').filter((l) => l.startsWith(`*${effet}.`)).map((l) => l.slice(1, l.indexOf(' '))).sort()
  const exemple = (message: string): string => /\((\*[a-z]+\.[a-z_0-9]+)\)/.exec(message)?.[1] ?? ''

  it('à l\'usage : le premier alias livré de l\'effet (le même que le premier des alias connus), pas celui de *filter', () => {
    const defs = resolveProjectEffects([])
    for (const effet of ['filter', 'tilt', 'fly', 'behind', 'travel', 'sprite']) {
      assert.ok(livres(effet).length > 0, effet)
      assert.throws(() => withProjectEffects(defs, () => parseEffect(`${effet}.Mauvais`, '')), (e: Error) => {
        assert.equal(exemple(e.message), `*${livres(effet)[0]}`, effet)
        assert.ok(e.message.includes(`alias connus : *${livres(effet)[0]}`), effet)
        return effet === 'filter' || !/frosted_glass/.test(e.message)
      }, effet)
    }
  })

  it('à la déclaration : le même exemple', () => {
    for (const effet of ['filter', 'tilt', 'fly']) {
      assert.throws(() => parseEffectsBlock(`*${effet}.Mauvais = *${effet}(blur: 3)`, 1, 'a.effects.mjs'), (e: Error) => exemple(e.message) === `*${livres(effet)[0]}`, effet)
    }
  })

  it('un effet sans alias livré : un exemple neutre, valide, qui ne nomme aucun autre effet', () => {
    for (const effet of ['ripple', 'fade']) {
      assert.equal(livres(effet).length, 0, effet + ' ne livre aucun alias')
      assert.throws(() => parseEffect(`${effet}.Mauvais`, ''), (e: Error) => exemple(e.message) === `*${effet}.my_alias` && !/frosted_glass/.test(e.message), effet)
      assert.throws(() => parseEffectsBlock(`*${effet}.Mauvais = *${effet}(#f00)`, 1, 'a.effects.mjs'), (e: Error) => exemple(e.message) === `*${effet}.my_alias`, effet)
    }
  })

  it('en anglais : la même règle', () => {
    setMessagesLang('en')
    assert.throws(() => parseEffect('tilt.Mauvais', ''), (e: Error) => exemple(e.message) === `*${livres('tilt')[0]}`)
    assert.throws(() => parseEffect('ripple.Mauvais', ''), (e: Error) => exemple(e.message) === '*ripple.my_alias')
    assert.throws(() => parseEffectsBlock('*ripple.Mauvais = *ripple(#f00)', 1, 'a.effects.mjs'), (e: Error) => exemple(e.message) === '*ripple.my_alias')
  })
})

// deux applis construites l'une après l'autre dans le même processus (un outil, une suite de tests) : la lecture des fichiers d'effets de la seconde ne voit
// pas les effets de la première, encore posés par sa dernière compilation — l'exemple qu'une faute cite ne vient jamais d'une autre appli
describe('la lecture d\'un fichier d\'effets ignore les effets d\'une appli construite avant', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un nom d\'alias mal formé cite un exemple neutre, pas l\'alias de l\'appli d\'avant', async () => {
    const avant = await construire('alias-exemple-avant', { 'a.effects.mjs': '<effects>\n  *fade.lent = *fade(duration: 3s)\n</effects>', 'c.mjs': '<p>un</p>\n<div class="a" *fade.lent>x</div>' })
    assert.equal(avant.erreurs, '')
    const apres = await construire('alias-exemple-apres', { 'a.effects.mjs': '<effects>\n  *fade.Lent = *fade(duration: 1s)\n</effects>', 'c.mjs': '<p>un</p>' })
    assert.match(apres.erreurs, /\(\*fade\.my_alias\)/)
    assert.doesNotMatch(apres.erreurs, /\*fade\.lent\b/)
  })
})

// la doc promet la ligne de la balise pour une faute d'effet : vrai partout, sauf sur <@document> où seule une faute d'alias pointé (`*ripple.rouge`)
// la cite ; la doc le dit
describe('la doc dit où la ligne d\'une faute d\'effet est citée', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le paragraphe des débutants le dit, et le comportement est celui qu\'il décrit', async () => {
    const doc = readFileSync(new URL('../docs/38-effets.md', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('Le compilateur lit le mot et ses réglages')) ?? ''
    assert.match(doc, /cite le fichier, l'effet et la ligne de sa balise/)
    assert.match(doc, /sur `<@document>`, la ligne n'est citée que pour une faute d'alias pointé \(`\*ripple\.rouge`\)/)
    const r = await construire('alias-doc-ligne', {
      'a.effects.mjs': '<effects>\n  *ripple.rouge = *ripple(#f00)\n</effects>',
      'sans.mjs':      '<p>un</p>\n<@document *neon></@document>',
      'alias.mjs':     '<p>un</p>\n<@document *ripple.zzz></@document>'
    })
    assert.match(r.erreurDe('sans'), /\*neon/)
    assert.doesNotMatch(r.erreurDe('sans'), /\(ligne/)
    assert.match(r.erreurDe('alias'), /\*ripple\.zzz \(ligne 2\)/)
  })
})

// un effet que rien ne connaît, écrit sur une transition (`@in=*titre`, `@out=`, `@transition=`), arrête la construction en fin de compilation : la transition
// peut être créée par un script (`µanim.create 'nom'`), que la construction ne lit qu'une fois tous les fichiers vus. L'erreur dit où la directive s'écrit
// (le fichier et la ligne de sa balise) et propose le nom d'un effet voisin ; un nom que seul un script cite (`µ.anim.fadde`) reste un avertissement
describe('un effet inconnu écrit sur une transition est une erreur qui dit où, comme une faute de frappe', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  const sources: Record<string, string> = {
    'in.mjs':         '<p>un</p>\n<div class="a" @in=*titre>x</div>',
    'out.mjs':        '<p>un</p>\n<div class="a" @out=*titre>x</div>',
    'transition.mjs': '<p>un</p>\n<div class="a" @transition=*titre>x</div>',
    'reglages.mjs':   '<p>un</p>\n<div class="a" @in=*titre(duration: 1s)>x</div>',
    'global.mjs':     '<p>un</p>\n<div class="a" @in.global=*titre>x</div>',
    'voisin.mjs':     '<p>un</p>\n<div class="a" @out=*fadeee>x</div>',
    'toupie.mjs':     "<script>\n  µanim.create('toupie', { duration: 1000 })\n</script>\n<div @in=*toupie>x</div>",
    'temoin.mjs':     '<p>un</p>\n<div class="a" @in=*fade @out=*fly(up)>x</div>'
  }
  const ECRITS = ['in', 'out', 'transition', 'reglages', 'global']

  async function lire(langue: 'fr' | 'en') {
    setMessagesLang(langue)
    try {
      return await construire('transition-inconnue-' + langue, sources)
    }
    finally {
      setMessagesLang('fr')
    }
  }
  const erreurDuNom = (r: Awaited<ReturnType<typeof lire>>, nom: string) => r.stats.errors.map((e: any) => String(e.message)).find((m: string) => m.includes('*' + nom + ' ') || m.includes('*' + nom + ':')) ?? ''

  it('en français : une erreur par nom, qui nomme *titre, chaque fichier qui l\'écrit et la ligne de sa balise', async () => {
    const r = await lire('fr')
    assert.equal(r.stats.errors.length, 2, r.erreurs)
    const erreur = erreurDuNom(r, 'titre')
    assert.match(erreur, /^\[ModularJS\] \*titre : transition inconnue/)
    for (const f of ECRITS) assert.match(erreur, new RegExp(`/${f}\\.mjs \\(ligne 2\\)`), f)
    assert.ok(!r.stats.warnings.some((w: string) => /Animation inconnue/.test(w)), r.stats.warnings.join('\n'))
  })

  it('en anglais aussi', async () => {
    const r = await lire('en')
    assert.equal(r.stats.errors.length, 2, r.erreurs)
    const erreur = erreurDuNom(r, 'titre')
    assert.match(erreur, /^\[ModularJS\] \*titre: unknown transition/)
    for (const f of ECRITS) assert.match(erreur, new RegExp(`/${f}\\.mjs \\(line 2\\)`), f)
  })

  it('un nom voisin d\'un effet est proposé, comme sur une balise', async () => {
    const r = await lire('fr')
    assert.match(erreurDuNom(r, 'fadeee'), /^\[ModularJS\] \*fadeee : transition inconnue.*\/voisin\.mjs \(ligne 2\)\. Vouliez-vous dire \*fade \?/s)
  })

  it('la transition créée par µanim.create et les effets connus ne donnent ni erreur ni avertissement', async () => {
    const r = await lire('fr')
    assert.ok(!r.stats.errors.some((e: any) => /^\[ModularJS\] \*(toupie|fade|fly) /.test(String(e.message))), r.erreurs)
    assert.ok(!r.stats.warnings.some((w: string) => /Animation inconnue/.test(w) && /'toupie'|'fade'|'fly'/.test(w)), r.stats.warnings.join('\n'))
  })

  it('un nom que seul un script cite (µ.anim.fadde) reste un avertissement, sans lieu à citer', async () => {
    const r = await construire('transition-inconnue-script', { 'c.mjs': '<script lang="coffee">\n  a = µ.anim.fadde\n</script>\n<p>{a}</p>' })
    assert.equal(r.stats.errors.length, 0, r.erreurs)
    const avertissement = r.stats.warnings.find((w: string) => /Animation inconnue/.test(w) && w.includes('fadde')) ?? ''
    assert.ok(avertissement, r.stats.warnings.join('\n'))
    assert.doesNotMatch(avertissement, /Écrite dans/)
  })
})

// un effet inconnu est dit avant un point mal placé : `*fadee .x` se corrige d'abord par le nom de l'effet, pas par une règle d'alias qui
// reparlerait d'un effet qui n'existe pas
describe('un effet inconnu passe avant un point mal placé', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  const suivant = /un espace sépare|suit les réglages|il manque le nom de l'effet/
  const cas: Array<[string, string]> = [
    ['espace',        '<p>un</p>\n<div class="a" *fadee .x>x</div>'],
    ['reglages',      '<p>un</p>\n<div class="a" *fadee(duration: 1s).x>x</div>'],
    ['alias',         '<p>un</p>\n<div class="a" *fadee.lent .x>x</div>'],
    ['directive',     '<p>un</p>\n<div class="a" @in=*fadee .x>x</div>'],
    ['directive-reg', '<p>un</p>\n<div class="a" @out=*fadee(duration: 1s).x>x</div>']
  ]
  let r: Awaited<ReturnType<typeof construire>>

  before(async () => {
    const fichiers: Record<string, string> = { 'a.effects.mjs': '<effects>\n  *fade.lent = *fade(duration: 3s)\n</effects>' }
    for (const [f, source] of cas) fichiers[`${f}.mjs`] = source
    fichiers['page.mjs']    = '<p>un</p>\n<@document *rippel .rouge></@document>'
    fichiers['connu.mjs']   = '<p>un</p>\n<div class="a" *fade .x>x</div>'
    fichiers['maison.mjs']  = '<p>un</p>\n<div class="a" @in=*titre .x>x</div>'
    r = await construire('point-effet-inconnu', fichiers)
  })

  for (const [f] of cas) {
    it(`${f} : l'erreur est « effet inconnu » (*fadee, sa ligne, le voisin *fade), pas une règle d'alias`, () => {
      assert.match(r.erreurDe(f), /\[ModularJS\] \*fadee(?:\.lent)? \(ligne 2\) : effet inconnu — .* Vouliez-vous dire \*fade/s)
      assert.doesNotMatch(r.erreurDe(f), suivant)
    })
  }

  it('<@document> : l\'erreur est celle de l\'effet (*rippel ne s\'y pose pas), pas une règle d\'alias', () => {
    assert.match(r.erreurDe('page'), /\[ModularJS\] \*rippel ne se pose pas sur <@document>/)
    assert.doesNotMatch(r.erreurDe('page'), suivant)
  })

  it('un effet connu garde la règle du point, et un nom éloigné de tout effet sur une transition aussi (la transition d\'un script peut le porter)', () => {
    assert.match(r.erreurDe('connu'), /\[ModularJS\] \*fade \.x \(ligne 2\) : un espace sépare « \.x »/)
    assert.match(r.erreurDe('maison'), /\[ModularJS\] \*titre \.x \(ligne 2\) : un espace sépare « \.x »/)
  })
})
