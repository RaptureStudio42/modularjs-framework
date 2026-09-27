// samples/README.md documente une commande de rafraîchissement (`cp … .`), à lancer DEPUIS
// samples/, pour recopier les composants réels avant d'envoyer la demande de fusion à Linguist.
// Cette suite relit la commande TELLE QU'ÉCRITE dans la doc : chaque source doit exister, la
// commande doit reproduire exactement le jeu d'échantillons présent (ni fichier oublié, ni
// module cœur en trop), et chaque échantillon doit compiler avec le compilateur actuel — un
// échantillon envoyé à Linguist montre la syntaxe réellement en vigueur.

import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join } from 'node:path'
import { transpile } from '../src/transpiler/index.ts'

const ICI         = dirname(fileURLToPath(import.meta.url))
const SAMPLES_DIR = join(ICI, '..', 'editors', 'linguist', 'samples')
const README      = join(SAMPLES_DIR, 'README.md')

// `a/{x,y}.mjs` → `a/x.mjs`, `a/y.mjs` (expansion d'accolades du shell, un seul niveau)
function developper(chemin: string): string[] {
  const m = chemin.match(/^(.*)\{([^}]+)\}(.*)$/)
  if (!m) return [chemin]
  return m[2].split(',').map((nom) => m[1] + nom + m[3])
}

function sourcesDocumentees(): string[] {
  const texte  = readFileSync(README, 'utf8')
  const trouve = texte.match(/`cp ((?:[^\s`]+\s+)+)\.`/)
  assert.ok(trouve, 'commande `cp <sources…> .` introuvable dans samples/README.md')
  return trouve[1].trim().split(/\s+/).flatMap(developper)
}

function echantillons(): string[] {
  return readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.mjs')).sort()
}

describe('samples/README.md — la commande de rafraîchissement des échantillons', () => {
  it('chaque source citée existe, résolue depuis samples/', () => {
    for (const source of sourcesDocumentees()) {
      const chemin = join(SAMPLES_DIR, source)
      assert.ok(existsSync(chemin), `${chemin} n'existe pas — le chemin collé dans la doc est faux`)
    }
  })

  it('la commande recopie exactement les échantillons présents, ni plus ni moins', () => {
    const copies = sourcesDocumentees().map((source) => basename(source)).sort()
    assert.deepEqual(copies, echantillons())
  })

  it('les sources sont les composants réels du framework (modules cœur et pages serveur)', () => {
    const racine = join(ICI, '..', 'src')
    for (const source of sourcesDocumentees()) {
      const dossier = dirname(join(SAMPLES_DIR, source))
      assert.ok(dossier === join(racine, 'core-modules') || dossier === join(racine, 'server'), `${source} ne vient pas de src/core-modules ni de src/server`)
    }
  })
})

describe('samples/ — chaque échantillon compile avec le compilateur actuel', function () {
  this.timeout(20000)

  for (const nom of echantillons()) {
    it(`${nom} compile sans erreur`, async () => {
      const source = readFileSync(join(SAMPLES_DIR, nom), 'utf8')
      await assert.doesNotReject(() => transpile(source, { moduleName: 'echantillon-' + nom.replace(/\.mjs$/, '') }))
    })
  }
})
