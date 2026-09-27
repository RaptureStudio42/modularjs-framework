// Régression — persist-file.ts (FilePersistAdapter) : un identifiant contenant un séparateur de
// chemin ou '..' pourrait sinon désigner un fichier HORS du dossier de stockage configuré (les ids
// normaux, ex. 'game7', ne sont jamais concernés — seul un id restauré ou fourni à la main l'est).
// save()/remove() doivent refuser un tel id avec une erreur claire, JAMAIS écrire/lire/supprimer un
// fichier en dehors du dossier configuré.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { FilePersistAdapter } from '../src/mjs-server/index.js'
import { mjsTmp } from './helpers/tmp.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

/** capture level+message+meta.err — save()/remove() journalisent le message du CATALOGUE (générique,
 *  ex. « persist-file : save(...) a échoué ») avec le détail dans meta.err (cf. reste du fichier) */
function captureWarns(): { warns: Array<{ message: string; err: string }>; onLog: (level: string, message: string, meta?: unknown) => void } {
  const warns: Array<{ message: string; err: string }> = []
  const onLog = (level: string, message: string, meta?: unknown): void => {
    if (level === 'warn') warns.push({ message, err: String((meta as any)?.err ?? '') })
  }
  return { warns, onLog }
}

describe('mjs-server/persist-file — confinement du dossier de stockage', () => {
  it("save() avec un id '../evil' n'écrit AUCUN fichier hors du dossier configuré — warn clair (id invalide)", async () => {
    const dir = mjsTmp('persist-file-traversal-save')
    const { warns, onLog } = captureWarns()
    const adapter = new FilePersistAdapter({ dir, onLog })

    const cibleHorsDir = resolve(dirname(dir), 'evil.json')
    adapter.save('../evil', { id: '../evil', state: {} } as any)
    await tick(30)

    assert.equal(existsSync(cibleHorsDir), false, 'aucun fichier ne doit avoir été écrit hors du dossier configuré')
    assert.ok(warns.some(w => /invalide/i.test(w.err)), `un warn clair (id invalide) attendu, reçu : ${JSON.stringify(warns)}`)
  })

  it("remove() avec un id contenant un séparateur de chemin refuse et n'atteint JAMAIS unlink() hors dossier — warn clair, aucun throw synchrone", async () => {
    const dir = mjsTmp('persist-file-traversal-remove')
    const { warns, onLog } = captureWarns()
    const adapter = new FilePersistAdapter({ dir, onLog })

    assert.doesNotThrow(() => adapter.remove('sous/dossier'), 'remove() ne doit jamais lever de façon synchrone (fire-and-forget, cf. contrat)')
    await tick(30)

    assert.ok(warns.some(w => /invalide/i.test(w.err)), `un warn clair (id invalide) attendu, reçu : ${JSON.stringify(warns)}`)
  })

  it('un id légitime (alphanumérique) continue de fonctionner normalement après la garde de confinement', async () => {
    const dir = mjsTmp('persist-file-traversal-nominal')
    const adapter = new FilePersistAdapter({ dir })
    adapter.save('game7', { id: 'game7', state: { n: 1 } } as any)
    await adapter.flush()

    const brut = await adapter.load()
    assert.equal(brut.length, 1)
    assert.equal(brut[0].id, 'game7')
    assert.ok(existsSync(join(dir, 'game7.json')), 'le fichier légitime doit avoir été écrit dans le dossier configuré')
  })

  it('un id contenant un octet nul est refusé — warn clair, aucun accès disque', async () => {
    const dir = mjsTmp('persist-file-traversal-nul')
    const { warns, onLog } = captureWarns()
    const adapter = new FilePersistAdapter({ dir, onLog })

    adapter.save('id\0malveillant', { id: 'id\0malveillant', state: {} } as any)
    await tick(30)

    assert.ok(warns.some(w => /invalide/i.test(w.err)), `un warn clair (id invalide) attendu, reçu : ${JSON.stringify(warns)}`)
  })

  it("load() ignore un LIEN SYMBOLIQUE déposé dans le dossier de stockage — jamais suivi hors du dossier", async () => {
    const dir = mjsTmp('persist-file-symlink')
    const cibleHorsDir = join(dirname(dir), 'cible-hors-dossier-'+ Date.now() +'.json')
    writeFileSync(cibleHorsDir, JSON.stringify({ id: 'evil', secret: 'donnee-hors-dossier' }))
    symlinkSync(cibleHorsDir, join(dir, 'lien.json'))

    const adapter = new FilePersistAdapter({ dir })
    const rows = await adapter.load()

    assert.deepEqual(rows, [], "un lien symbolique ne doit jamais être suivi — aucune entrée hors dossier exposée")
  })

  it('load() ignore un SOUS-DOSSIER nommé comme une entrée valide, sans planter le chargement des fichiers réguliers voisins', async () => {
    const dir = mjsTmp('persist-file-dossier-nomme-json')
    mkdirSync(join(dir, 'un-dossier.json'))
    const adapter = new FilePersistAdapter({ dir })
    adapter.save('game7', { id: 'game7', state: { n: 1 } } as any)
    await adapter.flush()

    const rows = await adapter.load()

    assert.equal(rows.length, 1, 'seul le fichier régulier légitime doit être chargé')
    assert.equal(rows[0].id, 'game7')
  })
})
