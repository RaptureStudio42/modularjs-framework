// Relevé des reffets d'un fichier `.js` importé, et contrôle d'un reffet dans une racine écrite en JavaScript. Un `.effect(` dont le
// premier argument est une chaîne ou un objet écrit est celui de jQuery UI (`$(el).effect('shake', …)`), pas celui de µ, qui reçoit une
// fonction : il n'emmène pas le module des reffets au cœur. Un reffet pris autrement que par `.effect(` (destructuration
// `const { effect } = µ`, clé écrite `µ['effect'](…)`, appel optionnel `µ.effect?.(…)`) l'emmène, sans quoi il manque en production ; une
// racine ou un reffet d'avant l'écran pris de même (`effect.root(…)` après la destructuration, `µ['effect'].root(…)`, `µ.effect?.root(…)`,
// `effect.before(…)`) emmène aussi son bloc, sans quoi son appel lève une `TypeError` en production. En
// JavaScript, un `else` en tête de ligne referme la fonction concise écrite sur la ligne d'avant : le reffet de la branche est au premier
// niveau de la racine
import assert from 'node:assert/strict'
import { scanJsReffets } from '../src/bundler/features.js'
import { lintEffectTopLevel } from '../src/transpiler/lint.js'

const refus = (src: string, lang: string): string => {
  try {
    lintEffectTopLevel(src, false, 1, lang)
  }
  catch (e) {
    return String((e as Error).message)
  }
  return ''
}

describe('fichier .js : la signature de jQuery UI n\'emmène pas le module des reffets', () => {
  const RIEN: [string, string][] = [
    ['chaîne, options, durée', 'export const secouer = (el) => $(el).effect(\'shake\', { times: 2 }, 200)\n'],
    ['chaîne entre guillemets doubles, seule', 'export const secouer = (el) => $(el).effect("shake")\n'],
    ['gabarit sans expression', 'export const secouer = (el) => $(el).effect(`pulsate`)\n'],
    ['objet écrit', 'export const s = ($el) => $el.effect({ effect: \'fade\' })\n'],
    ['chaîne sur la ligne suivante', 'export const s = ($el) => $el.effect(\n  \'bounce\',\n  500\n)\n'],
    ['présence testée, puis appel', 'export const s = (el) => el.effect && el.effect(\'shake\', { times: 2 }, 200)\n'],
    ['code qu\'acorn ne lit pas', 'export const s = (el) => el.effect(\'shake\') +\n'],
  ]
  for (const [nom, js] of RIEN) it('rien : ' + nom, () => assert.deepEqual(scanJsReffets(js), []))

  const RELEVES: [string, string][] = [
    ['fonction', 'export const s = (m) => m.effect(() => 1)\n'],
    ['nom d\'une fonction', 'export const s = (m, f) => m.effect(f)\n'],
    ['function, sur la ligne suivante', 'export const s = (m) => m.effect(\n  function () { return 1 }\n)\n'],
    ['commentaire avant la fonction', 'export const s = (m) => m.effect(/* suivi */ () => 1)\n'],
    ['async', 'export const s = (m) => m.effect(async () => 1)\n'],
    ['jQuery UI et µ dans le même fichier', 'export const s = (m, el) => { $(el).effect(\'shake\'); return m.effect(() => 1) }\n'],
    ['code qu\'acorn ne lit pas', 'export const s = (m) => m.effect(() => 1) +\n'],
  ]
  for (const [nom, js] of RELEVES) it('relevé : ' + nom, () => assert.deepEqual(scanJsReffets(js), ['effect']))
})

describe('fichier .js : un reffet pris autrement que par .effect( emmène le module des reffets', () => {
  const RELEVES: [string, string][] = [
    ['destructuration', 'export const s = (µ) => { const { effect } = µ; return effect(() => 1) }\n'],
    ['destructuration renommée', 'export const s = (µ) => { const { effect: suivre } = µ; return suivre(() => 1) }\n'],
    ['destructuration du paramètre', 'export const s = ({ effect }) => effect(() => 1)\n'],
    ['clé écrite entre crochets', 'export const s = (µ) => µ[\'effect\'](() => 1)\n'],
    ['clé entre guillemets doubles', 'export const s = (µ) => µ["effect"](() => 1)\n'],
    ['appel optionnel', 'export const s = (µ) => µ.effect?.(() => 1)\n'],
  ]
  for (const [nom, js] of RELEVES) it('relevé : ' + nom, () => assert.deepEqual(scanJsReffets(js), ['effect']))

  const RIEN: [string, string][] = [
    ['clé citée dans un commentaire', '// µ[\'effect\'](() => 1)\nexport const a = 1\n'],
    ['destructuration citée dans une chaîne', 'export const a = \'const { effect } = µ\'\n'],
    ['autre clé entre crochets', 'export const s = (o) => o[\'effet\'](() => 1)\n'],
    ['objet qui range une clé effect', 'export const o = { effect: 1 }\n'],
  ]
  for (const [nom, js] of RIEN) it('rien : ' + nom, () => assert.deepEqual(scanJsReffets(js), []))
})

describe('fichier .js : une racine ou un reffet d\'avant l\'écran pris autrement que par .effect.root( ou .effect.before( emmène son bloc', () => {
  const RACINE = ['effect_root', 'effect_store', 'effect']
  const AVANT  = ['effect_before', 'effect']
  const RELEVES: [string, string, string[]][] = [
    ['racine après la destructuration', 'export const s = (µ) => { const { effect } = µ; return effect.root(() => { effect(() => 1) }) }\n', RACINE],
    ['racine après la destructuration renommée', 'export const s = (µ) => { const { effect: suivre } = µ; return suivre.root(() => { suivre(() => 1) }) }\n', RACINE],
    ['racine, destructuration du paramètre', 'export const s = ({ effect }) => effect.root(() => { effect(() => 1) })\n', RACINE],
    ['racine par la clé entre crochets', 'export const s = (µ) => µ[\'effect\'].root(() => { µ[\'effect\'](() => 1) })\n', RACINE],
    ['racine par un accès optionnel', 'export const s = (µ) => µ.effect?.root(() => { µ.effect(() => 1) })\n', RACINE],
    ['racine appelée en option', 'export const s = (µ) => µ.effect.root?.(() => { µ.effect(() => 1) })\n', RACINE],
    ['reffet d\'avant l\'écran après la destructuration', 'export const s = (µ) => { const { effect } = µ; return effect.before(() => 1) }\n', AVANT],
    ['reffet d\'avant l\'écran par la clé entre crochets', 'export const s = (µ) => µ[\'effect\'].before(() => 1)\n', AVANT],
    ['reffet d\'avant l\'écran par un accès optionnel', 'export const s = (µ) => µ.effect?.before(() => 1)\n', AVANT],
  ]
  for (const [nom, js, attendu] of RELEVES) it('relevé : ' + nom, () => assert.deepEqual(scanJsReffets(js), attendu))

  const RIEN: [string, string][] = [
    ['racine d\'un objet qui n\'est pas le reffet', 'export const s = (o, effect) => o.root(effect)\n'],
    ['destructuration et racine citées dans une chaîne', 'export const a = \'const { effect } = µ; effect.root(() => 1)\'\n'],
  ]
  for (const [nom, js] of RIEN) it('rien : ' + nom, () => assert.deepEqual(scanJsReffets(js), []))
})

describe('racine écrite en JavaScript : un else en tête de ligne referme la fonction concise de la ligne d\'avant', () => {
  const R = (corps: string): string => '@o = function() {\n  µeffect.root(() => {\n' + corps.split('\n').map((l) => '    ' + l).join('\n') + '\n  })\n}'
  const ACCEPTES: [string, string][] = [
    ['if, fonction concise, puis else et le reffet', 'if (a) f = () => 1\nelse µeffect(() => 1)'],
    ['fonction concise sur deux lignes, puis else', 'if (a) f = () =>\n  1\nelse µeffect(() => 1)'],
    ['else if', 'if (a) f = () => 1\nelse if (b) µeffect(() => 1)'],
  ]
  for (const [nom, corps] of ACCEPTES) it('accepté : ' + nom, () => assert.equal(refus(R(corps), 'js'), ''))

  const REFUSES: [string, string][] = [
    ['reffet dans la fonction concise du if', 'if (a) f = () => µeffect(() => 1)\nelse g()'],
    ['else dans une fonction à accolades', 'f = () => {\n  if (a) g()\n  else µeffect(() => 1)\n}'],
    ['else dans le rappel d\'un forEach', 'l.forEach((x) => {\n  if (x) g()\n  else µeffect(() => x)\n})'],
  ]
  for (const [nom, corps] of REFUSES) it('refusé : ' + nom, () => assert.match(refus(R(corps), 'js'), /premier niveau de la racine/))

  it('Civet : une fonction écrite sur une ligne continue après un point-virgule (règle inchangée)', () => {
    const src = '@o = ->\n  µeffect.root ->\n    f = (x) -> x; µeffect -> 1'
    assert.match(refus(src, 'civet'), /premier niveau de la racine/)
  })
})
