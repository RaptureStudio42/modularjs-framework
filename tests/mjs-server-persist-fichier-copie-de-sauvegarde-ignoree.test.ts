// FilePersistAdapter::load — seule la sauvegarde `<id>.json` d'une partie est chargée : une copie laissée dans le dossier
// (`game7 - copie.json`, `game7.bak.json`…) porte le même id dans son contenu ; elle était chargée à chaque démarrage comme un
// doublon, et la première lue des deux gagnait, l'ancienne copie parfois. Elle est ignorée, un avertissement la nomme, et le
// fichier n'est jamais touché
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FilePersistAdapter } from '../src/mjs-server/index.js'
import { t } from '../src/messages/index.js'

const sauvegarde = (id: string, n: number) => JSON.stringify({ id, type: 'duel', code: null, state: { n }, phase: null, turn: null, seq: n, journal: [], seats: [], timers: [] })

describe('MJS-Server — FilePersistAdapter : une copie de sauvegarde laissée dans le dossier est ignorée', () => {
  it('seul game7.json est chargé ; chaque copie est nommée dans un avertissement et reste sur le disque', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'mjs-copie-'))
    try {
      writeFileSync(join(dossier, 'game7.json'), sauvegarde('game7', 2))
      writeFileSync(join(dossier, 'game7 - copie.json'), sauvegarde('game7', 1))
      writeFileSync(join(dossier, 'a-game7.json'), sauvegarde('game7', 0))
      writeFileSync(join(dossier, 'game8.json'), sauvegarde('game8', 5))
      const journal: Array<[string, string]> = []
      const adaptateur = new FilePersistAdapter({ dir: dossier, onLog: (niveau: string, message: string) => { journal.push([niveau, message]) } })
      const lus = await adaptateur.load()
      assert.deepEqual(lus.map(e => e.id + ':' + (e.data.state as any).n).sort(), ['game7:2', 'game8:5'])
      assert.deepEqual(journal.sort(), [
        ['warn', t('serveur.persist-file-copie-ignoree', { fichier: 'a-game7.json', id: 'game7' })],
        ['warn', t('serveur.persist-file-copie-ignoree', { fichier: 'game7 - copie.json', id: 'game7' })],
      ].sort())
      assert.ok(existsSync(join(dossier, 'game7 - copie.json')) && existsSync(join(dossier, 'a-game7.json')), 'les copies restent sur le disque')
    }
    finally {
      rmSync(dossier, { recursive: true, force: true })
    }
  })
})
