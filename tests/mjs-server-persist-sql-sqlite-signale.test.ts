// SqlPersistAdapter ne prend pas en charge SQLite : son dialecte « ? » écrit l'upsert de MySQL/MariaDB (ON DUPLICATE KEY UPDATE), que
// SQLite refuse, et chaque save() échoue. Au premier échec de cette forme, le journal le dit en clair, une seule fois — la seule
// erreur de syntaxe du pilote laissait croire à une panne passagère, et la documentation annonçait même SQLite comme accepté.
import assert from 'node:assert/strict'
import { SqlPersistAdapter } from '../src/mjs-server/persist-sql.js'

describe('SqlPersistAdapter — SQLite signalé comme non pris en charge', () => {
  it('sous SQLite (dialecte « ? »), le premier save() en échec dit que SQLite n est pas pris en charge, une seule fois', async function() {
    let sqlite: any
    try { sqlite = await import('node:sqlite') } catch { this.skip(); return }
    const db = new sqlite.DatabaseSync(':memory:')
    const query = async (sql: string, params: unknown[]) => {
      const st = db.prepare(sql)
      if (/^\s*select/i.test(sql)) return st.all(...(params as any[]))
      st.run(...(params as any[]))
      return []
    }
    const journal: string[] = []
    const adaptateur = new SqlPersistAdapter({ query, dialect: '?', onLog: (niveau: string, message: string) => { journal.push(niveau + ' ' + message) } })
    await adaptateur.save('game1', { id: 'game1', type: 't', state: {} } as any)
    await adaptateur.save('game2', { id: 'game2', type: 't', state: {} } as any)
    const signalements = journal.filter(l => l.startsWith('warn') && /SQLite n'est pas pris en charge/.test(l))
    assert.equal(signalements.length, 1, journal.join('\n'))
    assert.equal((await adaptateur.load()).length, 0)
  })
})
