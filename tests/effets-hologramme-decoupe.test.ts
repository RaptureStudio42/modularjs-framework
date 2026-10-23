// *hologram, le découpage par style (src/bundler/hologram-styles.ts) : le fichier de l'effet, réduit à un style de carte,
// rend pour ce style exactement la feuille du fichier entier — ni plus, ni moins — et chaque section marquée est NÉCESSAIRE à
// ceux qu'elle nomme : lui retirer un nom casse ce style (aucune section ne garde du code pour rien).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { selectHologramStyles, hologramStylesWanted, hologramClient, HOLOGRAM_FILE } from '../src/bundler/hologram-styles.js'
import { selectFxSections } from '../src/bundler/fx-sections.js'
import { HOLOGRAM_STYLE_PREFIX, HOLOGRAM_STYLE_ANY, FX_NAMED, fxSignal } from '../src/bundler/features.js'
import { setMessagesLang } from '../src/messages/index.js'

const SOURCE = readFileSync(new URL('../src/runtime/mjs_fx_hologram.ts', import.meta.url), 'utf-8')
const STYLES = ['sheen', 'frame', 'curtain', 'night-sky', 'frost', 'lattice', 'opal', 'streaks', 'rays', 'rays-window', 'rays-cloud', 'rays-fade', 'rays-wide', 'haze', 'haze-deep', 'dust-dark', 'dust', 'glint', 'glint-dark', 'bloom']

// le fichier évalué avec un faux µ : la feuille de l'effet et les styles de carte qu'il connaît
function charger(src: string): { css: string, cartes: string[] } {
  const µ: any = { _mjs_fxDefs: {} }
  const contexte = vm.createContext({ µ })
  vm.runInContext(src, contexte)
  const cartes = vm.runInContext('typeof _MJS_FX_HOLO_CARDS === "undefined" ? {} : _MJS_FX_HOLO_CARDS', contexte)
  return { css: µ._mjs_fxDefs.hologram.css, cartes: Object.keys(cartes).sort() }
}

// les règles du premier niveau : [têtes, corps] (un @media est un bloc d'un seul tenant)
function regles(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let prof = 0
  let debut = 0
  let corps = 0
  let tete = ''
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      if (prof === 0) { tete = css.slice(debut, i); corps = i + 1 }
      prof++
    }
    else if (css[i] === '}') {
      prof--
      if (prof === 0) { out.push([tete.trim(), css.slice(corps, i)]); debut = i + 1 }
    }
  }
  return out
}
const marque = (s: string) => `="${s}"]`
const dUnStyle = ([tete, corps]: [string, string]) => STYLES.some((s) => (tete + corps).includes(marque(s)))
// ce que la feuille dit d'un style : ses règles, réduites aux sélecteurs qui le visent
function reglesDe(css: string, style: string): Array<[string, string]> {
  return regles(css).filter(([tete, corps]) => (tete + corps).includes(marque(style))).map(([tete, corps]): [string, string] => [tete.startsWith('@') ? tete : tete.split(',').filter((sel) => sel.includes(marque(style))).join(','), corps])
}
// le dos de la carte appartient au tour (zoom: spin), il ne suit ni un style ni les règles communes
const duDos = ([tete]: [string, string]) => tete.includes('hologram-back')
const communes = (css: string) => regles(css).filter((r) => !dUnStyle(r) && !duDos(r))

// les lignes de marque d'un texte (hors le commentaire d'en-tête, qui cite la syntaxe)
const marquesDe = (texte: string) => texte.split('\n').filter((l) => /^\s*\/\/ @@(?: [a-z0-9 -]+)?$/.test(l) || /\S\s+\/\/ @@ [a-z0-9 -]+$/.test(l))

// les noms que le fichier déclare au premier niveau (var, let, const, function)
const nomsDe = (texte: string) => texte.split('\n').map((l) => /^(?:var|let|const|function)\s+([\w$]+)/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => m[1])
// les seuls noms que le fichier du style simple garde au premier niveau : ses palettes et les places du reflet ; tout autre nom est le moteur de carte
const NOMS_SIMPLES = ['_MJS_FX_HOLO_PALS', '_mjsFxHoloX', '_mjsFxHoloY', '_mjsFxHoloXi', '_mjsFxHoloYi', '_mjsFxHoloSz', '_mjsFxHoloAn', '_mjsFxHoloPal', '_mjsFxHoloStar']
// ce que le fichier réduit au style simple garde du moteur de carte
const moteurGarde = (source: string) => nomsDe(selectHologramStyles(source, new Set())).filter((n) => !NOMS_SIMPLES.includes(n))

const ENTIER = charger(SOURCE)

describe('*hologram — le fichier de l\'effet réduit aux styles demandés', function () {
  this.timeout(120000)

  it('tout garder rend le fichier entier, sans ses marques', () => {
    const tout = selectHologramStyles(SOURCE, 'all')
    assert.deepEqual(marquesDe(tout), [], 'aucune marque ne sort')
    assert.ok(marquesDe(SOURCE).length > 100, 'le fichier en porte')
    const { css, cartes } = charger(tout)
    assert.equal(css, ENTIER.css)
    assert.deepEqual(cartes, [...STYLES].sort())
  })

  it('chaque style, seul : sa feuille est exactement celle du fichier entier, et rien d\'un autre style', () => {
    for (const s of STYLES) {
      const reduit = selectHologramStyles(SOURCE, new Set([s]))
      const { css, cartes } = charger(reduit)
      assert.deepEqual(cartes, [s], s)
      assert.ok(reglesDe(ENTIER.css, s).length > 0, s + ' : une feuille')
      assert.deepEqual(reglesDe(css, s), reglesDe(ENTIER.css, s), s + ' : les mêmes règles')
      for (const autre of STYLES) if (autre !== s) assert.equal(css.includes(marque(autre)), false, `${s} seul : rien de ${autre}`)
      assert.deepEqual(communes(css), communes(ENTIER.css), s + ' : les règles communes de la carte')
      assert.ok(reduit.length < SOURCE.length * 0.85, s + ' : le fichier a maigri')
    }
  })

  it('plusieurs styles, dont ceux qui partagent une définition : la réunion de leurs feuilles', () => {
    const voulus = ['rays-window', 'rays', 'opal', 'haze', 'rays-wide']
    const { css, cartes } = charger(selectHologramStyles(SOURCE, new Set(voulus)))
    assert.deepEqual(cartes, [...voulus].sort())
    for (const s of voulus) assert.deepEqual(reglesDe(css, s), reglesDe(ENTIER.css, s), s)
    for (const autre of STYLES.filter((s) => !voulus.includes(s))) assert.equal(css.includes(marque(autre)), false, 'rien de ' + autre)
  })

  it('shine : les règles d\'éclat suivent leur style, et seulement lui', () => {
    const eclats = (css: string) => [...css.matchAll(/\[mjs-fx-hologram-style="([a-z-]+)"\]\[mjs-fx-hologram-shine="([a-z]+)"\]/g)].map((m) => m[1] + '/' + m[2]).filter((v, i, t) => t.indexOf(v) === i).sort()
    assert.deepEqual(eclats(ENTIER.css), ['opal/calm', 'rays/calm', 'rays/shade'])
    assert.deepEqual(eclats(charger(selectHologramStyles(SOURCE, new Set(['rays']))).css), ['rays/calm', 'rays/shade'])
    assert.deepEqual(eclats(charger(selectHologramStyles(SOURCE, new Set(['opal']))).css), ['opal/calm'])
    assert.deepEqual(eclats(charger(selectHologramStyles(SOURCE, new Set(['rays-window', 'glint']))).css), [])
  })

  it('aucune carte : le style simple seul, sans la feuille, sans le moteur de carte', () => {
    const reduit = selectHologramStyles(SOURCE, new Set())
    for (const reste of ['_mjsFxHoloCard', '_mjsFxHoloSpring', '_mjsFxHoloSheet', '_MJS_FX_HOLO_CARDS', 'mjs-fx-hologram-card', 'mjs-fx-hologram-3d']) assert.equal(reduit.includes(reste), false, reste)
    assert.deepEqual(moteurGarde(SOURCE), [], 'du moteur de carte dans le fichier du style simple : une déclaration a perdu sa marque `cards`')
    assert.deepEqual(marquesDe(reduit), [])
    const { css, cartes } = charger(reduit)
    assert.deepEqual(cartes, [])
    for (const simple of ['rainbow', 'foil', 'galaxy', 'prism', 'gold']) assert.ok(css.includes(`[mjs-fx-hologram-style="${simple}"]`), simple)
    for (const s of STYLES) assert.equal(css.includes(marque(s)), false, s)
    const attendu = regles(ENTIER.css).filter(([tete, corps]) => !dUnStyle([tete, corps]) && !/mjs-fx-hologram-(?:card|3d|up|fly|zoom|zoomed)\]/.test(tete) && !duDos([tete, corps]) && !(tete.includes('mjs-fx-hologram-shadow') && !tete.startsWith('@')))
    assert.deepEqual(regles(css), attendu, 'rien d\'autre que les règles du fichier entier qui ne sont pas celles d\'une carte')
    assert.ok(reduit.length < SOURCE.length / 4, 'le fichier du style simple est le quart de l\'entier au plus : ' + reduit.length + ' contre ' + SOURCE.length)
  })

  // le fichier tel que la production le garde pour ces signaux : les styles écrits, et le réglage `zone` s'il est écrit
  const garde          = (...signaux: string[]) => selectFxSections(HOLOGRAM_FILE, SOURCE, new Set(signaux), false, hologramClient)
  const STYLE          = (nom: string) => fxSignal('hologram', 'style', nom)
  const ZONE           = fxSignal('hologram', 'zone', 'inset(10%)')
  const POSE_ZONE      = 'setProperty(\'--mjs-fx-hologram-clip\''
  const POSE_CONTRAIRE = 'setProperty(\'--mjs-fx-hologram-inv\''

  it('la fenêtre : le code de `zone` n\'est embarqué que si une page écrit `zone`, celui du contraire que si `frame` est écrit avec elle', () => {
    assert.equal(garde(STYLE('curtain')).includes(POSE_ZONE), false, 'un style de carte sans zone : rien de la fenêtre')
    assert.equal(garde(STYLE('curtain')).includes(POSE_CONTRAIRE), false)
    assert.equal(garde(STYLE('frame')).includes(POSE_CONTRAIRE), false, 'frame sans zone : pas de fenêtre, pas de contraire')
    const curtain = garde(STYLE('curtain'), ZONE)
    assert.ok(curtain.includes(POSE_ZONE), 'curtain avec une zone : la fenêtre')
    assert.equal(curtain.includes(POSE_CONTRAIRE), false, 'curtain n\'a pas besoin du contraire de la fenêtre')
    const frame = garde(STYLE('frame'), ZONE)
    assert.ok(frame.includes(POSE_ZONE) && frame.includes(POSE_CONTRAIRE), 'frame avec une zone : la fenêtre et son contraire')
    // une zone tenue par une variable, une demande de tout : tout est gardé
    assert.ok(garde(STYLE('curtain'), fxSignal('hologram', 'zone', '*')).includes(POSE_ZONE), 'une zone que le build ne sait pas lire : la fenêtre')
    assert.ok(garde(STYLE('curtain'), fxSignal('hologram', 'style', '*'), ZONE).includes(POSE_CONTRAIRE), 'un style tenu par une variable : le contraire aussi')
    assert.equal(garde(ZONE).includes('_mjsFxHoloCard'), false, 'une zone sur un style simple : aucun moteur de carte')
  })

  it('un nom qui n\'est pas un style de carte (un style simple, une faute) est ignoré', () => {
    assert.equal(selectHologramStyles(SOURCE, new Set(['gold', 'rainbow', 'nimporte'])), selectHologramStyles(SOURCE, new Set()))
  })

  // pour chaque section et chaque style qu'elle nomme : la section, privée de ce nom, laisse-t-elle ce style intact ?
  function inutilesDe(source: string): { essais: number, inutiles: string[] } {
    const lignes = source.split('\n')
    let essais = 0
    const inutiles: string[] = []
    lignes.forEach((ligne, n) => {
      const m = /^(\s*\/\/ @@) ([a-z0-9 -]+)$/.exec(ligne) || /^(.*\S\s+\/\/ @@) ([a-z0-9 -]+)$/.exec(ligne)
      if (!m) return
      const noms = m[2].split(' ')
      for (const s of noms) {
        if (s === 'cards') continue
        const variante = [...lignes]
        variante[n] = m[1] + ' ' + noms.map((x) => x === s ? 'zz' : x).join(' ')
        essais++
        let casse = false
        try {
          const { css } = charger(selectHologramStyles(variante.join('\n'), new Set([s])))
          casse = JSON.stringify(reglesDe(css, s)) !== JSON.stringify(reglesDe(ENTIER.css, s))
        }
        catch {
          casse = true
        }
        if (!casse) inutiles.push(`ligne ${n + 1} (${noms.join(' ')}) pour ${s}`)
      }
    })
    return { essais, inutiles }
  }

  it('chaque section est nécessaire à ceux qu\'elle nomme : lui retirer un nom casse ce style', () => {
    const { essais, inutiles } = inutilesDe(SOURCE)
    assert.ok(essais > 150, 'beaucoup de sections vérifiées : ' + essais)
    assert.deepEqual(inutiles, [], 'des sections gardées pour rien')
  })

  it('témoin : une section de trop, qui ne sert à aucun appel, est vue', () => {
    const ajout = SOURCE.replace(/^  var rot   = [^\n]*\n/m, (m) => m + '  var INUTILE = 1; // @@ curtain\n')
    assert.notEqual(ajout, SOURCE)
    const { inutiles } = inutilesDe(ajout)
    assert.equal(inutiles.length, 1, inutiles.join(' ; '))
    assert.match(inutiles[0], /pour curtain$/)
  })

  it('témoin : une déclaration du moteur qui perd sa marque `cards` reste dans le fichier du style simple, et on la voit', () => {
    const sans = SOURCE.replace(/^(var _mjsFxHoloUrl = .*;) \/\/ @@ cards$/m, '$1')
    assert.notEqual(sans, SOURCE, 'la ligne de _mjsFxHoloUrl, avec sa marque `cards`, est introuvable : le témoin la vise')
    assert.deepEqual(moteurGarde(sans), ['_mjsFxHoloUrl'])
  })

  it('un fichier sans marque passe tel quel ; une marque mal posée est refusée', () => {
    assert.equal(selectHologramStyles('var a = 1\n', new Set(['curtain'])), 'var a = 1\n')
    assert.throws(() => selectHologramStyles('// @@ curtain\nvar a = 1\n', new Set(['curtain'])), /pas fermée/)
    assert.throws(() => selectHologramStyles('var a = 1\n// @@\n', new Set(['curtain'])), /sans avoir été ouverte/)
    assert.throws(() => selectHologramStyles("// @@ curtain\nvar a = 1\n// @@\n", new Set(['curtain'])), /n'a aucune section/, 'un style demandé sans appel style(…) : jamais un style manquant en silence')
  })

  it('les erreurs de build passent par les tables de messages : le français par défaut, l\'anglais sur demande', () => {
    const cas: Array<[() => unknown, RegExp, RegExp]> = [
      [() => selectHologramStyles('var a = 1\n// @@\n', new Set(['curtain'])), /sans avoir été ouverte/, /closed without having been opened/],
      [() => selectHologramStyles('// @@ curtain\nvar a = 1\n', new Set(['curtain'])), /pas fermée/, /is not closed/],
      [() => selectHologramStyles("// @@ curtain\nstyle('sheen', {})\n// @@\n", new Set(['curtain'])), /gardé sans aucun style demandé/, /kept with no style requested/],
      [() => selectHologramStyles('// @@ curtain\nvar a = 1\n// @@\n', new Set(['curtain'])), /n'a aucune section/, /has no section/]
    ]
    try {
      for (const [lance, enFrancais, enAnglais] of cas) {
        setMessagesLang('fr')
        assert.throws(lance, enFrancais)
        setMessagesLang('en')
        assert.throws(lance, enAnglais)
        assert.throws(lance, (e: Error) => !enFrancais.test(e.message), 'plus un mot de français en anglais')
        // dans les deux langues, le préfixe des autres messages du build : [bundler] puis le fichier
        for (const langue of ['fr', 'en']) {
          setMessagesLang(langue)
          assert.throws(lance, (e: Error) => /^\[bundler\] mjs_fx_hologram\.ts/.test(e.message), langue)
        }
      }
    }
    finally {
      setMessagesLang('fr')
    }
  })

  it('les styles à embarquer d\'après les signaux du build', () => {
    const ecrits = new Set(['fx', 'fx_hologram', HOLOGRAM_STYLE_PREFIX + 'night-sky', HOLOGRAM_STYLE_PREFIX + 'curtain'])
    assert.deepEqual([...(hologramStylesWanted(ecrits, false) as Set<string>)].sort(), ['curtain', 'night-sky'])
    assert.deepEqual([...(hologramStylesWanted(new Set(['fx_hologram']), false) as Set<string>)], [])
    assert.equal(hologramStylesWanted(new Set([...ecrits, HOLOGRAM_STYLE_ANY]), false), 'all')
    assert.equal(hologramStylesWanted(new Set([...ecrits, FX_NAMED]), false), 'all')
    assert.equal(hologramStylesWanted(ecrits, true), 'all')
  })
})
