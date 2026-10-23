// SqlPersistAdapter : sous MySQL / MariaDB (dialecte '?', le défaut), la colonne `data` est créée en LONGTEXT — un TEXT s'arrête à
// 64 Ko, alors qu'un journal lockstep peut atteindre 16 Mo : la sauvegarde d'une telle partie échouait. PostgreSQL (dialecte '$')
// garde TEXT, sans limite pratique. SQLite accepte LONGTEXT (affinité texte), il peut donc garder le dialecte '?'.
import assert from 'node:assert/strict'
import { SqlPersistAdapter } from '../src/mjs-server/persist-sql.js'

function ddl(dialect?: '?' | '$'): string {
  const requetes: string[] = []
  new SqlPersistAdapter({ query: async (sql: string) => { requetes.push(sql); return [] }, ...(dialect ? { dialect } : {}), onLog: () => {} })
  return requetes[0] ?? ''
}

describe('MJS-Server — SqlPersistAdapter : colonne data assez grande pour un journal lockstep', () => {
  it('MySQL / MariaDB (dialecte « ? », défaut) : data LONGTEXT', () => {
    assert.match(ddl('?'), /\bdata LONGTEXT\b/)
    assert.match(ddl(), /\bdata LONGTEXT\b/)
  })

  it('PostgreSQL (dialecte « $ ») : data TEXT', () => {
    const texte = ddl('$')
    assert.match(texte, /\bdata TEXT\b/)
    assert.doesNotMatch(texte, /LONGTEXT/)
  })
})
