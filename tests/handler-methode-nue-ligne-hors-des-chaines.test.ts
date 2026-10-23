// la ligne d'un gestionnaire qui cite nu une méthode du composant est celle du gestionnaire qui l'appelle
// vraiment : le nom écrit dans un texte d'un gestionnaire plus haut (`@log('alert')`) n'est pas une citation

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const SCRIPT = '<script>\n@alert = -> 1\n@log = -> 2\n</script>\n'

// la ligne citée par l'avertissement `[lint.events]` : un numéro, ou null sans ligne
async function ligneCitee(html: string): Promise<number | null> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await transpile(SCRIPT + html, { moduleName: 'carte' }) } finally { console.warn = orig }
  const events = vus.filter(m => m.includes('[lint.events]'))
  assert.equal(events.length, 1, events.join(' | '))
  const m = /\(ligne (\d+)\)/.exec(events[0])
  return m ? Number(m[1]) : null
}

describe('ligne du gestionnaire qui cite nu une méthode : les chaînes ne comptent pas', () => {
  it('le nom entre apostrophes dans un gestionnaire plus haut : la ligne du gestionnaire qui l\'appelle', async () => {
    assert.equal(await ligneCitee('<button @click={ @log(\'alert\') }>a</button>\n<button @click={alert(\'x\')}>go</button>\n'), 6)
  })

  it('entre guillemets doubles', async () => {
    assert.equal(await ligneCitee('<button @click={ @log("alert") }>a</button>\n<button @click={alert(\'x\')}>go</button>\n'), 6)
  })

  it('dans un gabarit', async () => {
    assert.equal(await ligneCitee('<button @click={ @log(`alert`) }>a</button>\n<button @click={alert(\'x\')}>go</button>\n'), 6)
  })

  it('dans un texte qui contient des accolades', async () => {
    assert.equal(await ligneCitee('<button @click={ @log(\'{alert}\') }>a</button>\n<button @click={alert(\'x\')}>go</button>\n'), 6)
  })

  it('le premier gestionnaire qui l\'appelle vraiment garde sa ligne', async () => {
    assert.equal(await ligneCitee('<button @click={ @log(\'a\') }>a</button>\n<button @click={alert(\'x\')}>go</button>\n<button @click={alert(\'y\')}>go</button>\n'), 6)
    assert.equal(await ligneCitee('<button @click={alert(\'x\')}>go</button>\n'), 5)
  })
})
