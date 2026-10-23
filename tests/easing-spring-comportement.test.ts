// Comportement figé des courbes d'easing et du ressort : la table (fixtures/easing-spring-table.json)
// a été tirée du code d'avant la réécriture des deux fichiers ; chaque courbe est rééchantillonnée
// sur 141 points (de -0.20 à 1.20) et chaque trajectoire du ressort rejouée image par image.
// Tolérance 1e-9 sur les nombres (relative au-delà de 1 : le scénario de divergence monte à 1e18) ; formes, booleens, avertissements et nombre d'images à l'identique.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { tableCourbes, jouerScenario, chargerCourbes, NOMS_COURBES, SCENARIOS } from './helpers/easing-spring-scenarios.js'

const ICI   = dirname(fileURLToPath(import.meta.url))
const TABLE = JSON.parse(readFileSync(join(ICI, 'fixtures', 'easing-spring-table.json'), 'utf-8'))
const TOLERANCE = 1e-9

// compare deux structures : nombres à la tolérance près, le reste à l'identique ; rend le plus grand écart
function comparer(attendu: any, obtenu: any, chemin: string, pire: { v: number }) {
  if(typeof attendu === 'number' && typeof obtenu === 'number') {
    const e = Math.abs(attendu - obtenu)
    if(e > pire.v) pire.v = e
    assert.ok(e <= TOLERANCE * Math.max(1, Math.abs(attendu)), chemin + ' : attendu ' + attendu + ', obtenu ' + obtenu + ' (écart ' + e + ')')
    return
  }
  if(Array.isArray(attendu)) {
    assert.ok(Array.isArray(obtenu), chemin + ' : un tableau était attendu')
    assert.equal(obtenu.length, attendu.length, chemin + ' : longueur')
    attendu.forEach(function(v: any, i: number) { comparer(v, obtenu[i], chemin + '[' + i + ']', pire) })
    return
  }
  if(attendu && typeof attendu === 'object') {
    assert.ok(obtenu && typeof obtenu === 'object' && !Array.isArray(obtenu), chemin + ' : un objet était attendu')
    assert.deepEqual(Object.keys(obtenu).sort(), Object.keys(attendu).sort(), chemin + ' : clés')
    for(const k of Object.keys(attendu)) comparer(attendu[k], obtenu[k], chemin + '.' + k, pire)
    return
  }
  assert.equal(obtenu, attendu, chemin)
}

describe('courbes et ressort — comportement identique à la table d\'avant la réécriture', function() {
  this.timeout(60000)

  const courbes = tableCourbes()

  it('chaque courbe nommée : 141 points à 1e-9 près', () => {
    const noms = Object.keys(TABLE.courbes.courbes)
    assert.equal(noms.length, 31)
    const pire = { v: 0 }
    for(const nom of noms) comparer(TABLE.courbes.courbes[nom], courbes.courbes[nom], nom, pire)
    assert.ok(pire.v <= TOLERANCE)
  })

  it('Bézier : neuf jeux de points de contrôle, y compris les deux hors contrat (repli et avertissement)', () => {
    comparer(TABLE.courbes.beziers, courbes.beziers, 'beziers', { v: 0 })
  })

  it('resolve : noms CSS, chaîne cubic-bezier, nom inconnu, vide, fonction passée telle quelle', () => {
    comparer(TABLE.courbes.chaines, courbes.chaines, 'chaines', { v: 0 })
    assert.equal(courbes.resolveFonction, true)
    assert.equal(courbes.resolveVide, true)
  })

  for(const s of SCENARIOS) {
    it('ressort ' + s.nom + ' : trajectoire image par image', () => {
      const pire = { v: 0 }
      comparer(TABLE.ressort[s.nom], jouerScenario(s), s.nom, pire)
    })
  }
})

describe('courbes et ressort — signature des courbes et sources sans nom de bibliothèque', function() {
  const RUNTIME = join(ICI, '..', 'src', 'runtime')

  it('chaque courbe est une fonction anonyme au texte propre (la signature d\'un @keyframes partagé se calcule sur ce texte)', () => {
    const { mu } = chargerCourbes()
    const empreintes = new Set<string>()
    for(const nom of NOMS_COURBES) {
      assert.equal(mu.easing[nom].name, '', nom + ' : le nom de fonction doit rester vide')
      empreintes.add(createHash('sha1').update(mu.easing[nom].toString()).digest('hex'))
    }
    assert.equal(empreintes.size, NOMS_COURBES.length, 'deux courbes partagent le même texte de fonction')
  })

  // les noms sont écrits en deux morceaux pour que ce fichier ne se cite pas lui-même
  const INTERDITS = [new RegExp('sve' + 'lte', 'i'), new RegExp('pen' + 'ner', 'i'), new RegExp('\\b(?:gs' + 'ap|framer|popmotion|react|vue)\\b', 'i')]

  it('mjs_spring.ts ne cite aucune bibliothèque', () => {
    const src = readFileSync(join(RUNTIME, 'mjs_spring.ts'), 'utf-8')
    for(const re of INTERDITS) assert.ok(!re.test(src), 'mjs_spring.ts cite ' + re)
  })

  it('mjs_easing.ts : le fichier entier (courbes, Bézier, resolve, moteur des transitions, épinglage) ne cite aucune bibliothèque', () => {
    const src = readFileSync(join(RUNTIME, 'mjs_easing.ts'), 'utf-8')
    assert.ok(src.includes('Moteur des transitions') && src.includes('_mjs_fixPosition'), 'le fichier lu est bien le moteur complet')
    for(const re of INTERDITS) assert.ok(!re.test(src), 'mjs_easing.ts cite ' + re)
  })
})
