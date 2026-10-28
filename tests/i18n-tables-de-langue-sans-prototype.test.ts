// Les tables de mjs_i18n.ts rangées par nom de langue, de section ou de couleur sont sans prototype : les langues chargées
// (`µ._i18nLangs`), les règles de pluriel par langue, les sections déjà demandées par une lecture et celles déjà redemandées
// après un échec, les feuilles des barres d'attente par couleur. Un nom pris au prototype d'Object est un nom comme un autre :
// une langue nommée `__proto__` remplaçait le prototype de la table des langues (ses textes restaient introuvables, la table
// prenait ses champs `root` et `sections`) et ses règles de pluriel se recalculaient à chaque lecture ; un nom de section
// ajouté à Object.prototype (`fr/aide`) faisait croire la section déjà demandée, la lecture ne la demandait jamais ; une
// couleur `constructor` ou `__proto__` rendait la fonction Object ou Object.prototype au lieu d'une feuille
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STORE_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_store_globals.ts'), 'utf-8')
const I18N_SRC  = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_i18n.ts'), 'utf-8')

const tour = () => new Promise((r) => setTimeout(r, 0))

// Intl doublé : ses règles de pluriel sont comptées, toute étiquette acceptée
function faireIntl() {
  const intl: any = { regles: 0 }
  intl.PluralRules = function (this: any) { intl.regles++; this.select = (n: number) => n === 1 ? 'one' : 'other' }
  return intl
}

async function monter(reponses: Array<'ok' | 'echec'> = []) {
  const µ: any = { log() {}, warn() {}, error() {}, state(o: any) { return o } }
  poserMessages(µ)
  new Function('µ', STORE_SRC)(µ)
  µ._i18nData = { prefix: '/i18n', langs: ['fr', '__proto__'], files: {}, dev: false, default: 'fr', placeholder: 'auto' }
  const demandes: string[] = []
  const faux = async (url: string) => {
    demandes.push(url)
    if ((reponses.shift() ?? 'ok') === 'echec') throw new Error('réseau coupé')
    return { ok: true, status: 200, json: async () => ({ titre: 'Aide' }) }
  }
  const intl = faireIntl()
  new Function('µ', 'fetch', 'document', 'Intl', I18N_SRC)(µ, faux, undefined, intl)
  µ._i18nLang('fr', { root: { titre: 'Bonjour' }, sections: { aide: 'aide' } })
  await tour()
  assert.equal(µ._mjs_i18nBooted, true, 'démarré')
  return { µ, demandes, intl }
}

describe('i18n : tables par nom de langue, de section et de couleur sans prototype', function () {
  it('une langue nommée `__proto__` est une langue comme une autre : ses textes se lisent, la table des langues garde sa forme, son pluriel est calculé une fois', async () => {
    const { µ, intl } = await monter()
    µ._i18nLang('__proto__', { root: { accueil: 'Salut', pommes: { one: '%{n} pomme', other: '%{n} pommes' } }, sections: {} })
    assert.equal(µ._i18nLangs.root, undefined, 'la table des langues n\'a pas pris de champ root')
    assert.equal(µ._i18nLangs.sections, undefined, 'ni de champ sections')
    assert.equal(µ._mjs_i18nDictOf('__proto__').accueil, 'Salut', 'les textes de la langue se trouvent')
    µ._storeSet('__mjsLang', '__proto__')
    await tour()
    assert.equal(µ.t('accueil'), 'Salut')
    assert.deepEqual([µ.t('pommes', { n: 1 }), µ.t('pommes', { n: 3 }), µ.t('pommes', { n: 1 })], ['1 pomme', '3 pommes', '1 pomme'])
    assert.equal(intl.regles, 1, 'les règles de pluriel de la langue sont gardées')
  })

  it('un nom de section ajouté à Object.prototype n\'empêche pas la lecture de demander la section, ni de la redemander après un échec', async () => {
    const { µ, demandes } = await monter(['echec', 'ok'])
    Object.defineProperty(Object.prototype, 'fr/aide', { value: true, configurable: true, writable: true, enumerable: false })
    try {
      µ.t('aide.titre')
      await tour()
      assert.deepEqual(demandes, ['/i18n/fr/aide.json'], 'la section est demandée')
      µ.t('aide.titre')
      await tour()
      assert.deepEqual(demandes, ['/i18n/fr/aide.json', '/i18n/fr/aide.json'], 'redemandée une fois après l\'échec')
      assert.equal(µ.t('aide.titre'), 'Aide')
    }
    finally { delete (Object.prototype as any)['fr/aide'] }
  })

  it('la feuille des barres d\'attente d\'une couleur nommée comme un membre d\'Object est une vraie feuille', () => {
    const m = /var __i18nSkelSheets = [^\n]*\n[\s\S]*?\nfunction __i18nSkelSheet\(couleur\) \{[\s\S]*?\n\}\n/.exec(I18N_SRC)
    assert.ok(m, 'la table et la fonction des feuilles se trouvent dans mjs_i18n.ts')
    class Feuille { texte = ''; replaceSync(t: string) { this.texte = t } }
    const feuille = new Function('CSSStyleSheet', m![0] + '\nreturn __i18nSkelSheet;')(Feuille)
    for (const couleur of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const f = feuille(couleur)
      assert.ok(f instanceof Feuille, couleur + ' : une feuille')
      assert.ok(f.texte.includes('background-color:' + couleur), couleur)
      assert.ok(feuille(couleur) === f, couleur + ' : la même feuille à la lecture suivante')
    }
  })
})
