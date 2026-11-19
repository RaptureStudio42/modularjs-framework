// une valeur dérivée qui attend et qui se cite (`$r = await suite($page, $r)`), d'elle-même ou par une autre valeur dérivée, relancerait
// sa demande à chaque réponse, sans fin : refusée à la construction, le message dit le chemin et quoi écrire, et l'avertissement du
// cycle réactif (qui propose `=:`) ne part pas. Une cascade (`$b = await g($a)`) reste permise

import assert from 'node:assert/strict'
import { refus, compile } from './helpers/derivee-await-refus.js'

const F = '  suite = (p, l) -> fetch("/api/p-#{p}").then((r) -> r.json())\n'

describe('dérivée qui attend — qui se cite : refusée', function () {
  this.timeout(60000)

  it('$r = await suite($page, $r) : refusée, sans l\'avertissement du cycle', async () => {
    const avis = [] as string[]
    const garde = console.warn
    console.warn = (...a: any[]) => { avis.push(a.join(' ')) }
    let message: string
    try {
      message = await refus(`<script>\n  $page = 1\n${F}  $r = await suite($page, $r)\n</script>\n<i>{($r or []).length}</i>\n`)
    }
    finally {
      console.warn = garde
    }
    assert.match(message, /« \$r = await … » cite \$r elle-même/, message)
    assert.match(message, /sans fin/, message)
    assert.match(message, /gestionnaire d'événement/, message)
    assert.ok(!avis.some((a) => /Cycle réactif/.test(a)), avis.join('\n'))
  })

  it('par une valeur dérivée ordinaire ($n lit $r, $r cite $n) : refusée, le chemin nommé', async () => {
    const message = await refus(`<script>\n${F}  $n = ($r or []).length\n  $r = await suite($n)\n</script>\n<i>{$n}</i>\n`)
    assert.match(message, /« \$r = await … » lit \$r par \$n/, message)
  })

  it('une cascade $a puis $b = await g($a) : permise', async () => {
    const js = await compile(`<script>\n  $q = ''\n${F}  $a = await suite($q)\n  $b = await suite($a)\n</script>\n<i>{($b or []).length}</i>\n`)
    assert.match(js, /µ\._mjs_setAwait\(_mjsThis, 'b', async \(_mjs_sig\) => \(await suite\(\$\.a\)\), \['a'\]\)/)
  })
})
