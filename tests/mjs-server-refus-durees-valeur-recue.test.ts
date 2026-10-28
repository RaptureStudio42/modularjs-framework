// Refus d'une durée (seatTtl, emptyTtl, endTtl, turns.timeout, limits.moveIntervalMs, history.interp) : le message dit la valeur
// reçue telle quelle. Le rendu passait par JSON.stringify : Infinity, -Infinity et NaN s'affichaient « null », un symbole ou une
// fonction « undefined », et un BigInt ou un objet circulaire levaient une TypeError brute à la place du refus prévu.
import assert from 'node:assert/strict'
import { resolveGameDef } from '../src/mjs-server/index.js'
import { setMessagesLang } from '../src/messages/index.js'

// les durées en millisecondes que la déclaration valide : leur nom, et la manière de les poser dans une définition
const DUREES: Array<[string, (valeur: unknown) => Record<string, any>]> = [
  ['seatTtl',               valeur => ({ seatTtl: valeur })],
  ['emptyTtl',              valeur => ({ emptyTtl: valeur })],
  ['endTtl',                valeur => ({ endTtl: valeur })],
  ['turns.timeout',         valeur => ({ turns: { order: 'roundrobin', timeout: valeur } })],
  ['limits.moveIntervalMs', valeur => ({ limits: { moveIntervalMs: valeur } })],
  ['history.interp',        valeur => ({ tick: 10, space: { cell: 10 }, history: { ticks: 5, interp: valeur } })]
]

const circulaire: any = {}
circulaire.moi = circulaire
const tableauCirculaire: any[] = []
tableauCirculaire.push(tableauCirculaire)
const revoque = Proxy.revocable({}, {})
revoque.revoke()

// [description, valeur reçue, rendu attendu en français, rendu attendu en anglais]
const VALEURS: Array<[string, unknown, string, string]> = [
  ['Infinity',                          Infinity,                                            'Infinity',   'Infinity'],
  ['-Infinity',                         -Infinity,                                           '-Infinity',  '-Infinity'],
  ['NaN',                               NaN,                                                 'NaN',        'NaN'],
  ['un BigInt',                         10n,                                                 '10n',        '10n'],
  ['un symbole',                        Symbol('x'),                                         'Symbol(x)',  'Symbol(x)'],
  ['une fonction',                      () => 1,                                             '[fonction]', '[function]'],
  ['un objet circulaire',               circulaire,                                          '[objet]',    '[object]'],
  ['un tableau circulaire',             tableauCirculaire,                                   '[objet]',    '[object]'],
  ['un objet qui porte un BigInt',      { n: 10n },                                          '[objet]',    '[object]'],
  ['un objet dont toJSON lève',         { toJSON() { throw new Error('non') } },             '[objet]',    '[object]'],
  ['un objet dont toJSON ne rend rien', { toJSON() { return undefined } },                   '[objet]',    '[object]'],
  ['un objet dont un accesseur lève',   { get n() { throw new Error('non') } },              '[objet]',    '[object]'],
  ['un proxy qui lève',                 new Proxy({}, { get() { throw new Error('non') } }), '[objet]',    '[object]'],
  ['un proxy révoqué',                  revoque.proxy,                                       '[objet]',    '[object]'],
  // les valeurs que JSON.stringify rendait bien gardent leur rendu
  ['un négatif',                        -1,                                                  '-1',         '-1'],
  ['une chaîne',                        '600000',                                            '"600000"',   '"600000"'],
  ['null',                              null,                                                'null',       'null'],
  ['un booléen',                        true,                                                'true',       'true'],
  ['un tableau',                        [],                                                  '[]',         '[]'],
  ['un objet',                          {},                                                  '{}',         '{}']
]

// le refus que lève la déclaration de `option` posée à `valeur`
function refus(option: string, poser: (valeur: unknown) => Record<string, any>, valeur: unknown): Error {
  try {
    resolveGameDef('fin', { seats: 1, state: () => ({}), moves: {}, ...poser(valeur) })
  } catch (err) {
    return err as Error
  }
  return assert.fail(`${option} : la valeur aurait dû être refusée`)
}

describe('MJS-Server — le refus d\'une durée dit la valeur reçue telle quelle', () => {
  afterEach(() => setMessagesLang('fr'))

  for (const [langue, rendu] of [['fr', 2], ['en', 3]] as const) {
    for (const valeur of VALEURS) {
      it(`en ${langue === 'fr' ? 'français' : 'anglais'}, ${valeur[0]} : chaque durée le refuse par le refus prévu (une Error, jamais une TypeError), nomme l'option et rend la valeur reçue`, () => {
        setMessagesLang(langue)
        const marque = langue === 'fr' ? ', reçu : ' : ', received: '
        for (const [option, poser] of DUREES) {
          if (option === 'turns.timeout' && valeur[1] === null) continue   // null y est permis : aucune minuterie de tour
          const err = refus(option, poser, valeur[1])
          assert.equal(err.name, 'Error', `${option} a levé ${err.name} au lieu du refus prévu (${err.message})`)
          assert.ok(err.message.includes('.' + option + ' '), `${option} : le message ne nomme pas l'option : ${err.message}`)
          assert.ok(err.message.endsWith(marque + valeur[rendu]), `${option} : attendu « ${marque}${valeur[rendu]} » en fin de message : ${err.message}`)
        }
      })
    }
  }
})
