// Le paquet du serveur de jeu livre une seule fois ses aides internes : la suggestion orthographique d'une clé inconnue
// (levenshtein, suggestKey, keyUnknown) était recopiée dans game-def.ts et persist.ts, et le journal par défaut sur la console
// dans index.ts et dans chaque adaptateur de persistance (fichier, SQL, Redis, pont), au préfixe près. Le paquet est construit
// en mémoire comme `npm run build:self` construit dist/mjs-server.js
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('MJS-Server — aides internes livrées une seule fois dans le paquet', function() {
  this.timeout(30000)

  it('une seule copie de levenshtein, suggestKey et keyUnknown ; deux journaux par défaut au plus (MJS-WS et MJS-Server)', async () => {
    const sortie = await build({ entryPoints: [join(__dirname, '../src/mjs-server/index.ts')], bundle: true, platform: 'node', target: 'node20', format: 'esm', packages: 'external', write: false, logLevel: 'silent' })
    const code = sortie.outputFiles[0].text
    const compte = (motif: RegExp) => (code.match(motif) ?? []).length
    assert.equal(compte(/function levenshtein\d*\(/g), 1, 'levenshtein')
    assert.equal(compte(/function suggestKey\d*\(/g), 1, 'suggestKey')
    assert.equal(compte(/function keyUnknown\d*\(/g), 1, 'keyUnknown')
    assert.ok(compte(/console\.warn\(line, meta \?\? ""\)/g) <= 2, 'journal par défaut : ' + compte(/console\.warn\(line, meta \?\? ""\)/g) + ' copies')
  })
})
