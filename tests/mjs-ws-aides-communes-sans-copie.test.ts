// Aides communes de MJS WS : la comparaison à temps constant existait en trois versions (signatures du pont et du proxy,
// hachages des comptes, jetons et clés de reprise), dont une tenait deux chaînes hexadécimales vides pour égales, et une
// quatrième dans le lecteur de journal du serveur de développement (jeton `?token=` et cookie) ; le journal console et
// le nom affiché étaient recopiés dans le hall (lobby), le journal console aussi dans le serveur de jeu. Une seule aide
// de chaque, dans package-helpers.ts : une chaîne vide n'y est égale à rien
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as aides from '../src/mjs-ws/package-helpers.js'

const racine = fileURLToPath(new URL('../src/', import.meta.url))
const source = (chemin: string) => readFileSync(racine + chemin, 'utf8')
const safeEqual = (aides as Record<string, unknown>).safeEqual as ((a: string, b: string, encodage?: 'utf8' | 'hex') => boolean) | undefined

describe('MJS-WS — aides communes : une seule comparaison à temps constant, un seul journal console', function () {
  it('comparaison : égales, différentes, de longueurs différentes, en texte ou en hexadécimal', () => {
    assert.equal(typeof safeEqual, 'function', 'aide de comparaison exportée par package-helpers.ts')
    assert.equal(safeEqual!('jeton-abc', 'jeton-abc'), true)
    assert.equal(safeEqual!('jeton-abc', 'jeton-abd'), false)
    assert.equal(safeEqual!('jeton', 'jeton-abc'), false)
    assert.equal(safeEqual!('0a1b2c', '0a1b2c', 'hex'), true)
    assert.equal(safeEqual!('0a1b2c', '0a1b2d', 'hex'), false)
  })

  it('une chaîne vide n’est égale à rien, pas même à une autre chaîne vide', () => {
    assert.equal(typeof safeEqual, 'function', 'aide de comparaison exportée par package-helpers.ts')
    assert.equal(safeEqual!('', ''), false)
    assert.equal(safeEqual!('', '', 'hex'), false)
    assert.equal(safeEqual!('zz', 'zz', 'hex'), false, 'rien de lisible en hexadécimal : comme vide')
    assert.equal(safeEqual!('', 'abc'), false)
  })

  it('aucune autre copie dans MJS WS ni dans le serveur de jeu', () => {
    const ws = readdirSync(racine + 'mjs-ws').filter(f => f.endsWith('.ts') && f !== 'package-helpers.ts')
    for (const f of ws) assert.doesNotMatch(source('mjs-ws/' + f), /timingSafeEqual\(/, `mjs-ws/${f} : comparaison à temps constant recopiée`)
    assert.doesNotMatch(source('mjs-ws/lobby.ts'), /function (defaultLog|nameOf)\b/, 'lobby.ts : aide recopiée')
    const serveur = readdirSync(racine + 'mjs-server').filter(f => f.endsWith('.ts'))
    for (const f of serveur) assert.doesNotMatch(source('mjs-server/' + f), /console\.(log|warn|error)\(line\b/, `mjs-server/${f} : journal console recopié`)
  })

  it('le lecteur de journal du serveur de développement passe par la même aide', () => {
    assert.doesNotMatch(source('server/viewer-page.ts'), /timingSafeEqual\(/, 'server/viewer-page.ts : comparaison à temps constant recopiée')
  })
})
