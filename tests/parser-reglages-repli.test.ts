// Les réglages d'un effet (`*nom(…)`, `@in=*nom(…)`) sont lus d'abord sans regex (une barre oblique n'en ouvre jamais). Si cette lecture échoue (expression ou chaîne
// non fermée), ils sont relus à l'ancienne façon, regex reconnues : ce qui se construisait avant se construit encore. Si la première lecture réussit, elle l'emporte
// (c'est elle qui corrige les couleurs à barre oblique et la lecture de travers). Si les deux échouent, l'erreur est celle de la première. Ce fichier tient la règle au niveau du
// parseur (le texte lu et la position où la lecture s'arrête) ; effets-couleurs-barre.test.ts la tient de bout en bout.

import assert from 'node:assert/strict'
import { Scanner, extractBalanced, extractSettings } from '../src/parser/index.js'

// la suite d'une balise : la parenthèse fermante de l'effet, puis d'autres barres obliques, apostrophes, guillemets et commentaires
const SUITE = ') id="x">t</div>\n<p>a/b it\'s "q" /* c */ // d</p>\n'

type Lecture = { ok: true, v: string, pos: number } | { ok: false, e: string }

function lire(texte: string, f: (sc: Scanner) => string): Lecture {
  const sc = new Scanner(texte)
  try {
    const v = f(sc)
    return { ok: true, v, pos: sc.pos }
  }
  catch (e) {
    return { ok: false, e: String((e as Error).message) }
  }
}

const reglages  = (texte: string) => lire(texte, (sc) => extractSettings(sc))
// la lecture d'avant, regex reconnues
const avant     = (texte: string) => lire(texte, (sc) => extractBalanced(sc, ')'))
// la lecture sans regex seule
const sansRegex = (texte: string) => lire(texte, (sc) => extractBalanced(sc, ')', true))

// des valeurs que la lecture sans regex refuse (un `/*` y ouvre un commentaire qui avale la suite) et que la lecture d'avant acceptait : `/x/*`, `[/]/*`, `%/ /*`…
const FORMES = [
  ' %($[/ /**])', ' /:/*:){', ' /a. /*', ' /a/*', ' ],%[/\\[/*\\%', ' a:/,./*a \\{', '$*{/$\\.}/*,', '%*/aa/*`.[`', '%,/{{}/*]}', '%/ */*a:*', '%/ /*',
  '%/%/*', '%/,$/*', '%/{/*a', '%:{/]{/*', '(*a )/[/%/*]', '(/%*/*\\)', '*%a*/./*{a)(', '*/ :\\/*,/))', '*/$/*//{ *\')', '*/:/*%} )', '*/\\]/*}}',
  '*:/] .}%/*%)', '*\\*/,/*{* a{', '*],/}/*,a', ',%]*/$$,$./*', ',,/./*)\'%', ',/./*\\,', ',/:a/*, a%', ',/}/*', '.*/{/*}', '., */,/*%',
  '.]\\$a{/a/*]', '.{:/{/*$/]', '/ /*', '/ /*\\}', '/ /*}', '/ ]\\}/*[]', '/$ {/*)`],`(', '/$$/*:}[', '/$.*/*', '/$/* {$},\\', '/$/*{', '/$/*}',
  '/$/*}%).)', '/$: /*[*:,', '/$}/*"$"\\] ', '/%$,},/** },', '/%/*)`\':[]]:', '/,/*', '/.$ /*,$]', '/.**/*]{%)( ', '/./*%', '/./*))\' \'.:(', '/./** ',
  '/.:/*]$\\', '/.][]/*{{', '/:*\\/*[/]/ ', '/:/*', '/:/* {}*{],', '/:/**\\', '/:}]}\\*/*', '/\\%/*,) ,\\`', '/\\/$%a]/*a:a', '/\\/*]/.,[', '/\\:/*',
  '/\\]**$:/*', '/\\],{\\/*:{/}', '/]/*:,{:}*', '/]:*.,a/*%,)', '/]{%\\a*$/*.', '/]}.$/*[){%', '/a/*', '/a/*\\[ a', '/a/*`[` ]\\%{', '/a/*}',
  '/a]/*.a', '/a{$*/*./', '/{*/*a)%\'`\\', '/{,/*%]]a[)', '/{,/*{}*', '/{/**$$]%$', '/{/*]', '/{/*a$:[', '/} [\\\\]/*', '/}/* ', '/}/*${\']\'%:}',
  '/}/*%', '/}/*)%a', '/}]/*:]\\] ', ':/\\,/*)\'"\'[', '[ ,[{/{}/*{', '[.*/.}/*', '[/:/*', '[/]/*', '[:[{/a/*{', '\\[,/,/*', '\\\\*/]:/*', '\\{/]/*',
  '], / :/*', 'a][%/.:/*a', 'a{$,/. a$/*', '{,/ /*', '{/.a{ /*%[', '{/a:$/*.%{}', '{/}]:a}}/*%a', '}/%/{/*a', '}::/%/*[[%$$', '}a/[/:/*'
]

describe('extractSettings : la lecture sans regex l\'emporte quand elle réussit', () => {
  it('une couleur à barre oblique après un pourcentage : lue jusqu\'à sa parenthèse, la balise suit', () => {
    const texte = 'background: hsl(210 50% 20% / .4)' + SUITE
    assert.deepEqual(reglages(texte), { ok: true, v: 'background: hsl(210 50% 20% / .4)', pos: texte.indexOf(') id=') + 1 })
  })

  it('deux couleurs à barre oblique sur la même balise : chacune garde sa valeur (la lecture d\'avant les fusionnait, attributs compris)', () => {
    const texte = 'background: hsl(210 50% 20% / .4)) id="b" *neon(color: rgb(0% 0% 0% / 50%)) data-x="1">x</div>\n'
    assert.deepEqual(reglages(texte), { ok: true, v: 'background: hsl(210 50% 20% / .4)', pos: texte.indexOf(') id=') + 1 })
    const ancien = avant(texte)
    assert.ok(ancien.ok && ancien.v.includes('id="b"') && ancien.v.includes('*neon('), 'la lecture d\'avant devait fusionner les deux balises')
  })
})

describe('extractSettings : la lecture sans regex échoue, la lecture d\'avant est reprise', () => {
  it('un joker de chemin : `/*` ouvre un commentaire sans regex, la lecture d\'avant lit la valeur', () => {
    const texte = 'images: [/img/*.png]' + SUITE
    assert.equal(sansRegex(texte).ok, false)
    assert.deepEqual(reglages(texte), { ok: true, v: 'images: [/img/*.png]', pos: texte.indexOf(') id=') + 1 })
  })

  it('une regex à apostrophe dans une valeur calculée', () => {
    const texte = 'color: $a.replace(/\'/g, \'\')' + SUITE
    assert.equal(sansRegex(texte).ok, false)
    assert.deepEqual(reglages(texte), { ok: true, v: 'color: $a.replace(/\'/g, \'\')', pos: texte.indexOf(') id=') + 1 })
  })

  it('une valeur entre deux barres qui porte une apostrophe', () => {
    const texte = 'color: /it\'s/x' + SUITE
    assert.equal(sansRegex(texte).ok, false)
    assert.equal(avant(texte).ok, true)
    assert.deepEqual(reglages(texte), avant(texte))
  })

  it(`${FORMES.length} formes du fuzz de lecture : la même valeur et la même position que la lecture d'avant`, () => {
    assert.ok(FORMES.length > 100)
    for (const f of FORMES) {
      const texte = f + SUITE
      assert.equal(sansRegex(texte).ok, false, `${f} : la lecture sans regex devait échouer`)
      assert.equal(avant(texte).ok, true, `${f} : la lecture d'avant devait réussir`)
      assert.deepEqual(reglages(texte), avant(texte), f)
    }
  })
})

describe('extractSettings : les deux lectures échouent', () => {
  it('l\'erreur est celle de la lecture sans regex', () => {
    const texte    = 'color: /it\'s/x</div>\n<p>fin</p>\n'
    const premiere = sansRegex(texte)
    const ancienne = avant(texte)
    assert.ok(!premiere.ok && !ancienne.ok)
    assert.match((premiere as { e: string }).e, /CHAÎNE NON FERMÉE/)
    assert.match((ancienne as { e: string }).e, /EXPRESSION NON FERMÉE/)
    assert.deepEqual(reglages(texte), premiere)
  })

  it('une valeur seulement mal fermée garde son message', () => {
    const texte = 'background: hsl(210 50% 20%></div>\n<p>fin</p>\n'
    assert.deepEqual(reglages(texte), sansRegex(texte))
    assert.match((reglages(texte) as { e: string }).e, /EXPRESSION NON FERMÉE/)
  })
})

describe('extractSettings : les commentaires // et /* */ restent des commentaires', () => {
  const COMMENTAIRES = '\n  background: hsl(210 50% 20% / .4), // le fond (l\'été\n  size: .5, /* la taille (essentielle)) */\n  fade: 1.5\n'

  it('un // qui cache une apostrophe et une parenthèse ouvrante, un /* */ entre deux réglages : le texte lu va jusqu\'à la bonne parenthèse', () => {
    const texte = COMMENTAIRES + SUITE
    const fin   = texte.indexOf(') id="x"')
    const voulu = { ok: true, v: texte.slice(0, fin), pos: fin + 1 }
    assert.deepEqual(sansRegex(texte), voulu, 'sans regex')
    assert.deepEqual(reglages(texte), voulu, 'réglages')
  })

  it('un /* */ qui cache une parenthèse fermante et une apostrophe ne ferme pas les réglages', () => {
    const texte = '/* it\'s ) */ color: red' + SUITE
    const fin   = texte.indexOf(') id="x"')
    const voulu = { ok: true, v: '/* it\'s ) */ color: red', pos: fin + 1 }
    assert.deepEqual(sansRegex(texte), voulu, 'sans regex')
    assert.deepEqual(reglages(texte), voulu, 'réglages')
  })
})
