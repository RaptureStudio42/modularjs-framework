// garde du HARNAIS, pas du produit : `ouvrir()` (tests/helpers/editeur-riche.ts) lance un vrai navigateur, puis ouvre sa page, attend
// qu'elle soit prête et y pose ses aides. Une de ces étapes qui échoue (une aide qui lève, une attente qui n'aboutit pas, une page qui ne
// se charge pas) laissait le navigateur lancé ouvert : la session n'était jamais rendue, personne ne pouvait le fermer, et chaque test
// rouge d'un fichier de l'éditeur gardait un Chromium vivant jusqu'à la fin du run. Le navigateur se ferme dans tous les cas, l'erreur
// remonte telle quelle. L'essai fait échouer `ouvrir()` exprès (une aide de page qui lève) et regarde le navigateur qu'il a lancé

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { ouvrir } from './helpers/editeur-riche.js'

describe('harnais de l\'éditeur riche — ouvrir() qui échoue ferme le navigateur qu\'il a lancé', function () {
  this.timeout(120000)
  const lances: any[] = []

  // filet : un navigateur resté ouvert (test rouge) ne survit pas au fichier
  after(async () => {
    for (const b of lances) if (b.isConnected()) await b.close().catch(() => {})
  })

  it('une aide de page qui lève : l\'erreur remonte, le navigateur lancé est fermé', async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) this.skip()
    const launch = playwright.chromium.launch
    playwright.chromium.launch = async function (this: unknown, ...args: unknown[]) {
      const b = await launch.apply(this, args)
      lances.push(b)
      return b
    }
    const page = { source: '<p class="x">ok</p>\n', cle: 'ouvrir-echec', attente: 'true', aides: '(() => { throw new Error(\'aide en échec exprès\') })()' }
    try {
      await assert.rejects(ouvrir('chromium', 'dev', page), /aide en échec exprès/)
    }
    finally {
      playwright.chromium.launch = launch
    }
    assert.equal(lances.length, 1, 'ouvrir() lance un navigateur')
    assert.equal(lances[0].isConnected(), false, 'le navigateur lancé par ouvrir() est resté ouvert')
  })
})
