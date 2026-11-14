// `µt 'clé'` écrit sans parenthèses : même code produit que `µt('clé')`, dans le texte du gabarit, dans un attribut, dans les
// formes objet `@confirm={ text: µt 'q' }` et `@title={ text: µt 'aide' }`, préfixe de section `@i18n` compris, en Civet comme en
// CoffeeScript. Dans une forme objet, la forme sans parenthèses ne prend que la clé : ce qui suit la virgule est le réglage
// suivant (`ok:`, `side:`…) ; une clé qui reçoit des paramètres garde ses parenthèses (`µt('k', n: 3)`), et une forme objet
// qui écrit `µt 'k', n: 3` reste refusée (`n` n'est pas un réglage). Comparaison sur les lignes du code produit qui appellent
// la traduction ou posent les attributs `mjs-confirm` / `mjs-title`.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const CIVET  = '<script lang="civet">\nx := 0\n</script>\n'
const COFFEE = '<script lang="coffee">\nx = 0\n</script>\n'

async function compiler(corps: string, entete = CIVET): Promise<string> {
  const { output } = await transpile(`${entete}${corps}`, { moduleName: 'essai' })
  return output
}

// les lignes du code produit qui portent la traduction ou les attributs des formes objet
const lignes = (out: string): string[] => out.split('\n').filter((l) => /µ\.t\(|mjs-confirm|mjs-title/.test(l)).map((l) => l.trim())

async function memeCode(court: string, long: string, entete = CIVET): Promise<string[]> {
  const a = lignes(await compiler(court, entete))
  const b = lignes(await compiler(long, entete))
  assert.ok(b.length > 0, 'la forme avec parenthèses appelle la traduction')
  assert.deepEqual(a, b)
  return a
}

describe('µt sans parenthèses : même code que µt(…)', () => {
  it('(1) texte du gabarit, avec et sans paramètres', async () => {
    await memeCode(`<p>{ µt 'footer.privacy_link' }</p>`, `<p>{ µt('footer.privacy_link') }</p>`)
    const l = await memeCode(`<p>{ µt 'chess.level', n: 300 }</p>`, `<p>{ µt('chess.level', n: 300) }</p>`)
    assert.ok(l.some((x) => /µ\.t\('chess\.level', \{\s*n: 300\s*\}\)/.test(x)), l.join('\n'))
  })

  it('(2) attribut calculé', async () => {
    const l = await memeCode(`<a title="{ µt 'footer.privacy_link' }">a</a>`, `<a title="{ µt('footer.privacy_link') }">a</a>`)
    assert.ok(l.some((x) => x.includes("µ.t('footer.privacy_link')")), l.join('\n'))
  })

  it('(3) @confirm={ text: µt \'q\' } : la clé seule, puis les autres réglages', async () => {
    await memeCode(`<button :confirm={ text: µt 'q' }>a</button>`, `<button :confirm={ text: µt('q') }>a</button>`)
    await memeCode(`<button :confirm={ text: µt 'q', ok: µt "ok" }>a</button>`, `<button :confirm={ text: µt('q'), ok: µt("ok") }>a</button>`)
    const l = await memeCode(`<button :confirm={ text: µt 'q', ok: 'Supprimer', cancel: µ.t 'non' }>a</button>`, `<button :confirm={ text: µt('q'), ok: 'Supprimer', cancel: µ.t('non') }>a</button>`)
    assert.ok(l.some((x) => /JSON\.stringify\(\{ text: µ\.t\('q'\), ok: "Supprimer", cancel: µ\.t\('non'\) \}\)/.test(x)), l.join('\n'))
  })

  it('(4) @title={ text: µt \'aide\' } : texte traduit, réglages littéraux', async () => {
    const l = await memeCode(`<span :title={ text: µt 'aide', side: 'top', delay: 200 }>a</span>`, `<span :title={ text: µt('aide'), side: 'top', delay: 200 }>a</span>`)
    assert.ok(l.some((x) => x.includes("'mjs-title', µ.t('aide')")), l.join('\n'))
  })

  it('(5) préfixe de section @i18n : posé sur la clé écrite sans parenthèses', async () => {
    const entete = `@i18n 'sec'\n${CIVET}`
    const l = await memeCode(`<p>{ µt 'a' }</p><button :confirm={ text: µt 'q' }>b</button><span :title={ text: µt '/abs' }>c</span>`, `<p>{ µt('a') }</p><button :confirm={ text: µt('q') }>b</button><span :title={ text: µt('/abs') }>c</span>`, entete)
    const tout = l.join('\n')
    assert.ok(tout.includes("µ.t('sec.a')") && tout.includes("µ.t('sec.q')") && tout.includes("µ.t('abs')"), tout)
  })

  it('(6) CoffeeScript : texte, attribut et formes objet', async () => {
    await memeCode(`<p>{ µt 'k' }</p><p>{ µt 'n', n: 3 }</p>`, `<p>{ µt('k') }</p><p>{ µt('n', n: 3) }</p>`, COFFEE)
    await memeCode(`<button :confirm={ text: µt 'q', ok: 'Oui' }>a</button><span :title={ text: µt 'aide' }>b</span>`, `<button :confirm={ text: µt('q'), ok: 'Oui' }>a</button><span :title={ text: µt('aide') }>b</span>`, COFFEE)
  })

  it('(7) forme objet : des paramètres sans parenthèses restent refusés, avec le message de la forme objet', async () => {
    await assert.rejects(compiler(`<button :confirm={ text: µt 'k', n: 3 }>a</button>`), /forme objet invalide/)
    await assert.rejects(compiler(`<span :title={ text: µt 'k', n: 3 }>a</span>`), /forme objet invalide/)
    // une variable ou une concaténation après la clé : refusées comme avec les parenthèses
    await assert.rejects(compiler(`<button :confirm={ text: µt 'k' + 'x' }>a</button>`), /forme objet invalide/)
    await assert.rejects(compiler(`<button :confirm={ text: µt cle }>a</button>`), /forme objet invalide/)
  })
})
