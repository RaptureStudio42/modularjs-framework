// Un nombre suivi d'un nom s'accorde dans les messages du CLI et des serveurs : « 1 fichier écrit », « 3 fichiers écrits » —
// jamais « 1 fichiers écrits ». Le zéro suit la langue : singulier en français (« 0 fichier écrit »), pluriel en anglais
// (« 0 files written »). Même règle que le compte de composants assemblés (messages-pluriel-composants-assembles.test.ts).
import assert from 'node:assert/strict'
import { t, setMessagesLang, type MsgKey, type MsgVars } from '../src/messages/index.js'

// un message : les variables qui portent le nombre, les autres variables, puis le texte attendu pour 1, pour 3 et (là où il peut
// arriver) pour 0, dans chaque langue
interface Cas {
  cle:      MsgKey
  nombres:  string[]
  fixes?:   MsgVars
  // le serveur de cartes de chaleur passe ses nombres en chaînes, comme dans le code qui l'appelle
  chaines?: boolean
  fr:       [string, string, string?]
  en:       [string, string, string?]
}

const CAS: Cas[] = [
  { cle: 'cli.build-rapport', nombres: ['nb'], fixes: { ms: 12 },
    fr: ['1 fichier écrit en 12ms', '3 fichiers écrits en 12ms', '0 fichier écrit en 12ms'],
    en: ['1 file written in 12ms', '3 files written in 12ms', '0 files written in 12ms'] },
  { cle: 'cli.plus-n-autres', nombres: ['nb'],
    fr: ['+ 1 autre', '+ 3 autres'],
    en: ['+ 1 other', '+ 3 others'] },
  { cle: 'cli.composants-detectes', nombres: ['nb'],
    fr: ['📦 1 composant détecté', '📦 3 composants détectés', '📦 0 composant détecté'],
    en: ['📦 1 component detected', '📦 3 components detected', '📦 0 components detected'] },
  { cle: 'cli.et-n-autres', nombres: ['nb'],
    fr: ['... et 1 autre', '... et 3 autres'],
    en: ['... and 1 other', '... and 3 others'] },
  { cle: 'cli.erreurs-compilation', nombres: ['nb'],
    fr: ['❌ 1 erreur de compilation :', '❌ 3 erreurs de compilation :'],
    en: ['❌ 1 compilation error:', '❌ 3 compilation errors:'] },
  { cle: 'cli.tout-compile-ok', nombres: ['nb'],
    fr: ['(1 fichier écrit)', '(3 fichiers écrits)', '(0 fichier écrit)'],
    en: ['(1 file written)', '(3 files written)', '(0 files written)'] },
  { cle: 'cli.init.resume', nombres: ['cree', 'ignores'],
    fr: ['1 fichier/dossier créé, 1 ignoré', '3 fichiers/dossiers créés, 3 ignorés', '0 fichier/dossier créé, 0 ignoré'],
    en: ['1 file/directory created, 1 skipped', '3 files/directories created, 3 skipped', '0 files/directories created, 0 skipped'] },
  { cle: 'bundler.index.watch-build-termine', nombres: ['ecrits'], fixes: { duree: 5, erreurs: 0 },
    fr: ['✅ 1 fichier en 5ms', '✅ 3 fichiers en 5ms', '✅ 0 fichier en 5ms'],
    en: ['✅ 1 file in 5ms', '✅ 3 files in 5ms', '✅ 0 files in 5ms'] },
  { cle: 'ws.heatmap.file-relu', nombres: ['n'], fixes: { file: 'h.json' }, chaines: true,
    fr: ['1 point relu de h.json', '3 points relus de h.json', '0 point relu de h.json'],
    en: ['1 point read back from h.json', '3 points read back from h.json', '0 points read back from h.json'] },
  { cle: 'ws.heatmap.file-plafonds-ecartes', nombres: ['pages', 'zones'], fixes: { file: 'h.json', maxPages: '1000', maxZones: '64' }, chaines: true,
    fr: ['1 page au-delà de maxPages (1000), 1 zone au-delà de maxZones (64 par page)', '3 pages au-delà de maxPages (1000), 3 zones au-delà de maxZones (64 par page)', '0 page au-delà de maxPages (1000), 0 zone au-delà de maxZones (64 par page)'],
    en: ['1 page beyond maxPages (1000), 1 zone beyond maxZones (64 per page)', '3 pages beyond maxPages (1000), 3 zones beyond maxZones (64 per page)', '0 pages beyond maxPages (1000), 0 zones beyond maxZones (64 per page)'] },
  { cle: 'ws.heatmap.plafond-points', nombres: ['max'], chaines: true,
    fr: ['atteint : 1 point —', 'atteint : 3 points —'],
    en: ['reached: 1 point —', 'reached: 3 points —'] },
  { cle: 'ws.heatmap.plafond-pages', nombres: ['max'], chaines: true,
    fr: ['atteint : 1 page —', 'atteint : 3 pages —'],
    en: ['reached: 1 page —', 'reached: 3 pages —'] },
  { cle: 'ws.heatmap.plafond-zones', nombres: ['max'], fixes: { url: '/accueil' }, chaines: true,
    fr: ['atteint : 1 zone sur /accueil', 'atteint : 3 zones sur /accueil'],
    en: ['reached: 1 zone on /accueil', 'reached: 3 zones on /accueil'] },
  { cle: 'ws.core.mise-au-banc-ip', nombres: ['fautes'], fixes: { ip: '10.0.0.1', minutes: 5 },
    fr: ['(1 expulsion pour abus)', '(3 expulsions pour abus)'],
    en: ['(1 kick for abuse)', '(3 kicks for abuse)'] },
  { cle: 'ws.core.mise-au-banc-compte', nombres: ['fautes'], fixes: { compte: 'jean', minutes: 5 },
    fr: ['(1 expulsion pour abus)', '(3 expulsions pour abus)'],
    en: ['(1 kick for abuse)', '(3 kicks for abuse)'] },
  { cle: 'cli.serveur.anti-triche', nombres: ['n'], fixes: { fenetre: 1 },
    fr: ['quota 1 coup/identité par 1s', 'quota 3 coups/identité par 1s'],
    en: ['quota 1 move/identity per 1s', 'quota 3 moves/identity per 1s'] },
  { cle: 'cli.banniere-reprise-session', nombres: ['maxBuffered'], fixes: { grace: 30, maxBytes: 262144 },
    fr: ['(tampon 1 trame / 262144o)', '(tampon 3 trames / 262144o)'],
    en: ['(buffer 1 frame / 262144B)', '(buffer 3 frames / 262144B)'] },
]

// le texte attendu s'y trouve en entier, sans lettre ni chiffre accolé : « 1 autre » n'est pas dans « 1 autres »
const contient = (texte: string, attendu: string): boolean => new RegExp('(?<![\\p{L}\\p{N}])' + attendu.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'u').test(texte)

describe('messages — accord des nombres suivis d\'un nom', function () {
  afterEach(() => {
    setMessagesLang('fr')
  })

  for (const lang of ['fr', 'en'] as const) for (const cas of CAS) {
    it(`${cas.cle} : singulier pour un, pluriel au-delà${cas[lang][2] === undefined ? '' : ', zéro selon la langue'} (${lang})`, function () {
      setMessagesLang(lang)
      const dire = (n: number): string => t(cas.cle, { ...cas.fixes, ...Object.fromEntries(cas.nombres.map(v => [v, cas.chaines ? String(n) : n])) })
      const [un, trois, zero] = cas[lang]
      assert.ok(contient(dire(1), un), `un : « ${un} » attendu, vu « ${dire(1)} »`)
      assert.ok(contient(dire(3), trois), `trois : « ${trois} » attendu, vu « ${dire(3)} »`)
      if (zero !== undefined) assert.ok(contient(dire(0), zero), `zéro : « ${zero} » attendu, vu « ${dire(0)} »`)
    })
  }
})
