// relève ce qui atteindrait le processus pendant `faire` : une exception non gérée (throw nu dans une minuterie, un
// intervalle ou une microtâche) ou un rejet de promesse non géré — hors d'un test, l'un comme l'autre le ferait tomber
// mocha attribue l'exception au test en cours : ses écouteurs sont mis de côté le temps de l'essai, puis remis
import assert from 'node:assert/strict'

const decrire = (err: unknown): string => err instanceof Error ? err.message : String(err)

export async function sansChute(faire: () => Promise<void>): Promise<void> {
  const vus: string[] = []
  const mocha         = process.listeners('uncaughtException')
  const onException   = (err: unknown): void => { vus.push('exception non gérée : ' + decrire(err)) }
  const onRejet       = (err: unknown): void => { vus.push('rejet non géré : ' + decrire(err)) }
  for (const ecouteur of mocha) process.off('uncaughtException', ecouteur)
  process.on('uncaughtException', onException)
  process.on('unhandledRejection', onRejet)
  try {
    await faire()
  } finally {
    process.off('uncaughtException', onException)
    process.off('unhandledRejection', onRejet)
    for (const ecouteur of mocha) process.on('uncaughtException', ecouteur)
    // dans le finally : la chute relevée passe avant l'échec d'une assertion de `faire`, qui n'en est souvent que la suite
    assert.deepEqual(vus, [], 'une erreur a atteint le processus (hors d\'un test, il serait tombé)')
  }
}
