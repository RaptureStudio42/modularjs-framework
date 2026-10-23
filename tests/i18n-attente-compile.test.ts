// L'attente des textes traduits : ce que `@i18nPlaceholder` et `i18n.placeholder` acceptent, côté compilateur et côté
// configuration. Par défaut le module attend ses textes (`wait`) ; les valeurs permises sont `wait`, `key`, et deux
// effets de chargement écrits comme les autres effets : `*skeleton` (des barres grises à la place de chaque texte, le
// rendu de l'ancien `auto`) et `*loader(…)` (un indicateur affiché à la place du module, qui reste caché comme en
// `wait`). `auto` n'existe plus : l'erreur donne `*skeleton`. Tout autre effet est refusé, la liste des valeurs permises
// dans le message. Le code d'un effet de chargement ne part que si une page ou la configuration l'écrit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.ts'
import { extractDirectives } from '../src/transpiler/directives.ts'
import { findConfig } from '../src/bundler/config.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PERMISES = /wait, key, \*skeleton, \*loader/

function configAvec(placeholder: unknown): string {
  const root = mjsTmp('i18n-attente-config')
  mkdirSync(join(root, 'src', 'i18n'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', i18n: { default: 'fr', placeholder } }))
  return root
}

describe('attente des textes traduits — directive @i18nPlaceholder', function () {
  it('wait et key restent des valeurs permises', () => {
    assert.equal(extractDirectives("@i18n 'x'\n@i18nPlaceholder wait\n<p>x</p>").moduleI18nPlaceholder, 'wait')
    assert.equal(extractDirectives('@i18nPlaceholder key\n<p>x</p>').moduleI18nPlaceholder, 'key')
  })

  it('*skeleton : le mode et ses réglages écrits (color a un sens pour des barres de texte)', () => {
    const nu = extractDirectives('@i18nPlaceholder *skeleton\n<p>x</p>')
    assert.equal(nu.moduleI18nPlaceholder, '*skeleton')
    assert.equal(nu.moduleI18nPlaceholderFx, null)
    const regle = extractDirectives('@i18nPlaceholder *skeleton(color: #333)\n<p>x</p>')
    assert.equal(regle.moduleI18nPlaceholder, '*skeleton')
    assert.deepEqual(regle.moduleI18nPlaceholderFx, { color: '#333' })
  })

  it('*loader(bloom) : le mode et le réglage principal (style)', () => {
    const d = extractDirectives("@i18n 'x'\n@i18nPlaceholder *loader(bloom)\n<p>x</p>")
    assert.equal(d.moduleI18nPlaceholder, '*loader')
    assert.deepEqual(d.moduleI18nPlaceholderFx, { style: 'bloom' })
    const ecrit = extractDirectives("@i18n 'x'\n@i18nPlaceholder *loader(style: vortex, size: 48, color: #0f0)\n<p>x</p>")
    assert.deepEqual(ecrit.moduleI18nPlaceholderFx, { style: 'vortex', size: 48, color: '#0f0' })
  })

  it('auto : erreur de construction qui donne la nouvelle écriture', () => {
    assert.throws(() => extractDirectives('@i18nPlaceholder auto\n<p>x</p>'), (e: Error) => /auto/.test(e.message) && /\*skeleton/.test(e.message) && /@i18nPlaceholder \*skeleton/.test(e.message))
  })

  it('un effet hors de la famille de chargement : erreur qui liste les valeurs permises', () => {
    assert.throws(() => extractDirectives('@i18nPlaceholder *glitch\n<p>x</p>'), (e: Error) => /\*glitch/.test(e.message) && PERMISES.test(e.message))
    assert.throws(() => extractDirectives('@i18nPlaceholder *inconnu(1)\n<p>x</p>'), (e: Error) => PERMISES.test(e.message))
    assert.throws(() => extractDirectives('@i18nPlaceholder bloom\n<p>x</p>'), (e: Error) => /bloom/.test(e.message) && PERMISES.test(e.message))
  })

  it('un réglage sans sens pour des barres de texte est refusé, avec ceux qui en ont', () => {
    for (const reglage of ['speed: 2s', 'lines: 4', 'shine: #fff', 'radius: 4']) {
      assert.throws(() => extractDirectives(`@i18nPlaceholder *skeleton(${reglage})\n<p>x</p>`), (e: Error) => /color/.test(e.message) && new RegExp(reglage.split(':')[0]).test(e.message), reglage)
    }
  })

  it('les réglages sont vérifiés comme ceux de n\'importe quel effet (faute de frappe, valeur hors plage, variable)', () => {
    assert.throws(() => extractDirectives("@i18n 'x'\n@i18nPlaceholder *loader(style: nope)\n<p>x</p>"), /nope|style/)
    assert.throws(() => extractDirectives("@i18n 'x'\n@i18nPlaceholder *loader(taille: 3)\n<p>x</p>"), /taille/)
    assert.throws(() => extractDirectives("@i18n 'x'\n@i18nPlaceholder *loader($style)\n<p>x</p>"), /variable/i)
  })

  it('*loader exige une section à attendre, comme wait', () => {
    assert.throws(() => extractDirectives('@i18nPlaceholder *loader(bloom)\n<p>x</p>'), /@i18n/)
    assert.doesNotThrow(() => extractDirectives('@i18nPlaceholder *skeleton\n<p>x</p>'))
  })
})

describe('attente des textes traduits — code émis', function () {
  const page = (directive: string, section = "@i18n 'accueil'") => [section, directive, '<h1>{µt(\'titre\')}</h1>', ''].join('\n')

  it('*loader(bloom) : la ligne de l\'instance porte le mode et les réglages, chaque µ.t porte le mode', async () => {
    const { output } = await transpile(page('@i18nPlaceholder *loader(bloom)'), { moduleName: 'mjs-attente-loader' })
    assert.match(output, /_mjs_i18n = \["accueil","\*loader",null,\{"style":"bloom"\}\];/)
    assert.match(output, /µ\.t\('accueil\.titre', undefined, '\*loader'\)/)
  })

  it('*skeleton : le mode seul quand aucun réglage n\'est écrit', async () => {
    const { output } = await transpile(page('@i18nPlaceholder *skeleton'), { moduleName: 'mjs-attente-skeleton' })
    assert.match(output, /_mjs_i18n = \["accueil","\*skeleton"\];/)
    assert.match(output, /µ\.t\('accueil\.titre', undefined, '\*skeleton'\)/)
  })

  it('plusieurs sections et un effet : les sections en plus gardent leur place', async () => {
    const { output } = await transpile(page('@i18nPlaceholder *loader(dots)', "@i18n 'accueil' 'onglets'"), { moduleName: 'mjs-attente-paquets' })
    assert.match(output, /_mjs_i18n = \["accueil","\*loader",\["onglets"\],\{"style":"dots"\}\];/)
  })

  it('sans directive : aucun mode émis, la configuration (wait par défaut) décide', async () => {
    const { output } = await transpile(page(''), { moduleName: 'mjs-attente-defaut' })
    assert.match(output, /_mjs_i18n = \["accueil",null\];/)
    assert.doesNotMatch(output, /µ\.t\('accueil\.titre', undefined, /)
  })
})

describe('attente des textes traduits — configuration i18n.placeholder', function () {
  it('wait, key, *skeleton, *loader (avec ou sans réglages) sont acceptés tels qu\'écrits', () => {
    for (const valeur of ['wait', 'key', '*skeleton', '*skeleton(color: #333)', '*loader', '*loader(bloom)', '*loader(style: dots, size: 48)']) {
      const found = findConfig(configAvec(valeur))
      assert.equal(found!.config.i18n!.placeholder, valeur)
    }
  })

  it('auto : erreur de construction qui donne la nouvelle écriture', () => {
    assert.throws(() => findConfig(configAvec('auto')), (e: Error) => /i18n\.placeholder/.test(e.message) && /auto/.test(e.message) && /"placeholder": "\*skeleton"/.test(e.message))
  })

  it('un effet hors de la famille de chargement, ou un mot inconnu : la liste des valeurs permises', () => {
    assert.throws(() => findConfig(configAvec('*glitch')), (e: Error) => PERMISES.test(e.message))
    assert.throws(() => findConfig(configAvec('inline')), (e: Error) => PERMISES.test(e.message))
    assert.throws(() => findConfig(configAvec(3)), (e: Error) => PERMISES.test(e.message))
  })

  it('les réglages sont vérifiés comme dans la directive', () => {
    assert.throws(() => findConfig(configAvec('*skeleton(speed: 2s)')), /color/)
    assert.throws(() => findConfig(configAvec('*loader(style: nope)')), /nope|style/)
    assert.throws(() => findConfig(configAvec('*loader($x)')), /variable/i)
  })
})

describe('attente des textes traduits — détection (le code d\'un effet de chargement ne part que s\'il est écrit)', function () {
  const signaux = async (directive: string, section = "@i18n 'accueil'") => {
    const { output } = await transpile([section, directive, '<h1>{µt(\'titre\')}</h1>', ''].join('\n'), { moduleName: 'mjs-attente-detection' })
    return scanCompiledFeatures(output)
  }

  it('wait, key et le défaut : ni squelette ni indicateur de chargement', async () => {
    for (const directive of ['', '@i18nPlaceholder wait', '@i18nPlaceholder key']) {
      const used = await signaux(directive)
      for (const cle of ['fx', 'fx_loader', 'fx_skeleton', 'i18n_loader']) assert.equal(used.has(cle), false, `${directive || 'défaut'} : ${cle}`)
    }
  })

  it('*skeleton : ni le moteur des effets ni le fichier de l\'effet (le rendu des barres est toujours au cœur)', async () => {
    const used = await signaux('@i18nPlaceholder *skeleton(color: #333)')
    assert.equal(used.has('fx'), false)
    assert.equal(used.has('fx_skeleton'), false)
    assert.equal(used.has('fx_loader'), false)
    assert.equal(used.has('i18n_loader'), false)
  })

  it('*loader(bloom) : le fichier de l\'effet et l\'accroche du cœur', async () => {
    const used = await signaux('@i18nPlaceholder *loader(bloom)')
    assert.equal(used.has('fx_loader'), true)
    assert.equal(used.has('i18n_loader'), true)
  })

  it('plusieurs sections avec un effet : le bloc des sections multiples est encore détecté', async () => {
    const used = await signaux('@i18nPlaceholder *loader(dots)', "@i18n 'accueil' 'onglets'")
    assert.equal(used.has('i18n_paquets'), true)
  })
})

describe('attente des textes traduits — messages', function () {
  after(() => setMessagesLang('fr'))

  it('fr et en disent la même chose : l\'erreur de auto nomme *skeleton, celle des valeurs liste les permises', () => {
    for (const lang of ['fr', 'en'] as const) {
      setMessagesLang(lang)
      assert.throws(() => extractDirectives('@i18nPlaceholder auto\n<p>x</p>'), /\*skeleton/, lang)
      assert.throws(() => extractDirectives('@i18nPlaceholder *glitch\n<p>x</p>'), PERMISES, lang)
      assert.throws(() => extractDirectives('@i18nPlaceholder *skeleton(speed: 2s)\n<p>x</p>'), /color/, lang)
    }
  })
})
