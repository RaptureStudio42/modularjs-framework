// une écriture atomique d'un chemin fixe (manifeste, `bundle.js`, caches, registre et feuilles du rendu, journal du serveur) qui
// échoue sur un disque plein rend son erreur et ne laisse aucun fichier temporaire `.tmp-…` dans le dossier : le temporaire est
// remplacé par un lien vers /dev/full (écriture refusée, ENOSPC), à l'endroit où l'écriture le pose
import assert from 'node:assert/strict'
import { readdirSync, symlinkSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import * as outputs from '../src/bundler/outputs.js'
import { writeHashedAsset } from '../src/server/ssr-head.js'

const temporaires = (dir: string): string[] => readdirSync(dir).filter((f) => f.includes('.tmp-'))

// temporaire prévisible le temps de l'appel : `Date.now()` vaut 1 et `Math.random()` 0,5 (« i » en base 36)
function surDisquePlein(liens: string[], ecrire: () => void): string {
  const now = Date.now, random = Math.random
  Date.now = () => 1
  Math.random = () => 0.5
  let code = 'aucune erreur'
  try {
    for (const lien of liens) symlinkSync('/dev/full', lien)
    try { ecrire() } catch (e: any) { code = e?.code ?? String(e?.message ?? e) }
  }
  finally {
    Date.now = now
    Math.random = random
  }
  return code
}

describe('écritures atomiques — disque plein', () => {
  it('l\'aide commune (manifeste, bundle.js, caches, journal) : ENOSPC rendu, aucun temporaire laissé', () => {
    const dir = mjsTmp('atomique-disque-plein'), target = join(dir, 'bundle.js')
    const ecrire: any = outputs.writeFileAtomicAlways
    const code = surDisquePlein([`${target}.tmp-${process.pid}-1-i`], () => ecrire.length === 3 ? ecrire({}, target, 'contenu') : ecrire(target, 'contenu'))
    assert.equal(code, 'ENOSPC')
    assert.deepEqual(temporaires(dir), [])
  })

  it('une feuille du rendu serveur (writeHashedAsset) : ENOSPC rendu, le temporaire touché retiré', () => {
    const essai = mjsTmp('atomique-feuille-nom')
    const nom   = basename(writeHashedAsset(essai, '/assets', 'mjs_ssr', 'css', 'p { color: red }'))
    rmSync(essai, { recursive: true, force: true })
    const dir = mjsTmp('atomique-feuille-disque-plein'), target = join(dir, nom)
    // les deux écritures possibles du temporaire (avec et sans l'heure) : celle que l'écriture prend doit partir, l'autre reste
    const code = surDisquePlein([`${target}.tmp-${process.pid}-i`, `${target}.tmp-${process.pid}-1-i`], () => writeHashedAsset(dir, '/assets', 'mjs_ssr', 'css', 'p { color: red }'))
    assert.equal(code, 'ENOSPC')
    assert.equal(temporaires(dir).length, 1)
  })
})
