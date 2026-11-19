// Écriture atomique et disque plein — pourquoi ce test existe.
//
// Chaque fichier émis est écrit dans un temporaire (`<nom>.tmp-…`) puis renommé. L'écriture du temporaire se faisait HORS de la
// garde qui le retire en cas d'échec : un disque plein au milieu de l'écriture laissait le `.tmp-…` dans le dossier de sortie, et
// aucun ménage ne le retirait ensuite.
//
// Méthode : le nom du temporaire est rendu prévisible (horloge et tirage figés le temps de l'appel) et posé d'avance en lien vers
// `/dev/full`, qui refuse toute écriture avec le code d'un disque plein (ENOSPC).

import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { writeFileAtomic } from '../src/bundler/outputs.js'

describe('écriture atomique — un disque plein ne laisse aucun temporaire', () => {
  it('l\'écriture du temporaire échoue (ENOSPC) : l\'erreur remonte et le temporaire est retiré', function () {
    if (!existsSync('/dev/full')) return this.skip()
    const dir    = mjsTmp('ecriture-disque-plein')
    const target = join(dir, 'a-aaaaa.js')
    mkdirSync(dir, { recursive: true })
    const now    = Date.now
    const random = Math.random
    Date.now    = () => 1
    Math.random = () => 0.5
    try {
      symlinkSync('/dev/full', `${target}.tmp-${process.pid}-1-${(0.5).toString(36).slice(2)}`)
      assert.throws(() => writeFileAtomic({} as any, target, 'contenu'), (e: any) => e.code === 'ENOSPC')
    }
    finally {
      Date.now    = now
      Math.random = random
    }
    assert.deepEqual(readdirSync(dir).filter(f => f.includes('.tmp-')), [], 'un temporaire est resté dans le dossier de sortie')
    assert.equal(existsSync(target), false, 'un fichier final est apparu')
  })
})
