// Test de régression — SOCLE catalogue messages FR/EN. Couvre le contrat
// public de src/messages/ : t()/setMessagesLang()/getMessagesLang(), défaut fr, bascule en,
// et repli fr sur toute valeur de `lang` autre que 'en' (clé de config, contrat silencieux).

import assert from 'node:assert/strict'
import { t, setMessagesLang, getMessagesLang, type MsgVars, type MsgEntry } from '../src/messages/index.js'
import { fr } from '../src/messages/fr.js'
import { en } from '../src/messages/en.js'

// extrait les noms des paramètres destructurés en tête d'un message-fonction
// (`({ a, b }: MsgVars) => ...`) — texte source, pas d'exécution
function destructuredParams(entry: MsgEntry): string[] {
  if (typeof entry !== 'function') return []
  const m = entry.toString().match(/^\(\s*\{([^}]*)\}/)
  if (!m) return []
  return m[1].split(',').map(s => s.trim().split(/[:=]/)[0].trim()).filter(Boolean)
}

describe('messages — catalogue fr/en (clé lang)', function () {
  afterEach(() => {
    setMessagesLang('fr')
  })

  it('défaut fr', function () {
    assert.equal(getMessagesLang(), 'fr')
    assert.equal(t('cli.flag-valeur-manquante', { flag: '--port' }), '⚠️  --port ignoré : valeur manquante.')
  })

  it('lang en', function () {
    setMessagesLang('en')
    assert.equal(getMessagesLang(), 'en')
    assert.equal(t('cli.flag-valeur-manquante', { flag: '--port' }), '⚠️  --port ignored: missing value.')
  })

  it('valeur inconnue → fr', function () {
    setMessagesLang('de')
    assert.equal(getMessagesLang(), 'fr')
    setMessagesLang(42 as never)
    assert.equal(getMessagesLang(), 'fr')
    setMessagesLang(undefined)
    assert.equal(getMessagesLang(), 'fr')
  })

  it('parité structurelle fr/en : mêmes clés des deux côtés', function () {
    const frKeys = new Set(Object.keys(fr))
    const enKeys = new Set(Object.keys(en))
    const onlyFr = [...frKeys].filter(k => !enKeys.has(k))
    const onlyEn = [...enKeys].filter(k => !frKeys.has(k))
    assert.deepEqual(onlyFr, [], `clés présentes en fr, absentes en en : ${onlyFr.join(', ')}`)
    assert.deepEqual(onlyEn, [], `clés présentes en en, absentes en fr : ${onlyEn.join(', ')}`)
    assert.equal(frKeys.size, enKeys.size, `${frKeys.size} clés fr vs ${enKeys.size} clés en`)
  })

  it('mêmes paramètres nommés fr/en, et aucune interpolation ${…} non substituée', function () {
    const frDict = fr as Record<string, MsgEntry>
    const enDict = en as Record<string, MsgEntry>
    const problems: string[] = []

    for (const key of Object.keys(frDict)) {
      if (!(key in enDict)) continue   // couvert par le test de parité des clés ci-dessus
      const fEntry = frDict[key]
      const eEntry = enDict[key]
      const fIsFn  = typeof fEntry === 'function'
      const eIsFn  = typeof eEntry === 'function'
      if (fIsFn !== eIsFn) { problems.push(`${key} : type différent (fr=${fIsFn ? 'fonction' : 'texte'}, en=${eIsFn ? 'fonction' : 'texte'})`); continue }
      if (!fIsFn) continue

      const fParams = destructuredParams(fEntry)
      const eParams = destructuredParams(eEntry)
      const fSet    = new Set(fParams)
      const eSet    = new Set(eParams)
      const onlyFr  = fParams.filter(p => !eSet.has(p))
      const onlyEn  = eParams.filter(p => !fSet.has(p))
      if (onlyFr.length || onlyEn.length) problems.push(`${key} : paramètres différents — fr=[${fParams}] en=[${eParams}]`)

      // exécute le VRAI message (une valeur de test distincte par paramètre, jamais '${' dedans)
      // plutôt que d'analyser son texte par regex : un ${nom} peut apparaître dans du texte
      // littéral autour d'une VRAIE interpolation (ex. transpiler.theme-double : `name="${nom}"`,
      // 'name' n'est pas un paramètre — un faux positif, pas un bug)
      const vars: MsgVars = {}
      for (const p of new Set([...fParams, ...eParams])) vars[p] = `TEST_${p}`

      for (const [label, entry, params] of [['fr', fEntry, fParams], ['en', eEntry, eParams]] as const) {
        let out: string
        try { out = (entry as (v: MsgVars) => string)(vars) }
        catch (e) { problems.push(`${key} [${label}] : lève à l'appel — ${(e as Error).message}`); continue }
        for (const p of params) {
          if (new RegExp('\\$\\{\\s*'+ p +'\\s*\\}').test(out)) {
            problems.push(`${key} [${label}] : "\${${p}}" reste littéral dans le résultat, jamais interpolé`)
          }
        }
      }
    }
    assert.deepEqual(problems, [])
  })
})
