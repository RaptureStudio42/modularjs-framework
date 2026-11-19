// Un attribut `on…` d'une balise HTML qui lit une variable écrite sans accolades (`onclick="alert($x)"`) : sa valeur devient
// calculée, et le filtre des attributs ne pose jamais un `on…` calculé — la balise le recevait vide, sans un mot. La construction
// passe, avec un avertissement qui donne la ligne et la forme à écrire (`@click={…}`, ou un nom `data-…` hors des événements) ;
// un `$` collé à un mot (« 5$ ») reste du texte, sans avertissement

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function construire(src: string): Promise<{ msg: string, dits: string[] }> {
  const dits: string[] = []
  const w = console.warn, e = console.error, l = console.log
  console.warn = console.error = console.log = (...a: any[]) => { dits.push(a.join(' ')) }
  try {
    await transpile(src, { moduleName: 'cas' })
    return { msg: '', dits }
  }
  catch (err: any) {
    return { msg: String(err?.message ?? err), dits }
  }
  finally {
    console.warn = w
    console.error = e
    console.log = l
  }
}

const S = '<script>\n$x = 1\n</script>\n'

describe('attribut on… qui lit un $x sans accolades : averti à la construction', function () {
  this.timeout(60000)

  it('onclick="alert($x)" : construit, avec un seul avertissement qui donne la ligne et @click={…}', async () => {
    const r = await construire(`${S}<button onclick="alert($x)">b</button>\n`)
    assert.equal(r.msg, '')
    assert.equal(r.dits.filter((d) => d.includes('(ligne 4)') && d.includes('@click={…}')).length, 1, r.dits.join('\n'))
  })

  it('un nom qui n\'est pas un événement (onfoo="f($x)") : avertissement avec les deux voies', async () => {
    const r = await construire(`${S}<div onfoo="f($x)">b</div>\n`)
    assert.equal(r.msg, '')
    assert.ok(r.dits.some((d) => d.includes('data-onfoo')), r.dits.join('\n'))
  })

  it('témoin : onclick="alert(\'5$\')" (un $ collé à un chiffre) reste du texte, sans avertissement', async () => {
    const r = await construire(`${S}<button onclick="alert('5$')">b</button>\n`)
    assert.equal(r.msg, '')
    assert.ok(!r.dits.some((d) => d.includes('onclick=…')), r.dits.join('\n'))
  })
})
