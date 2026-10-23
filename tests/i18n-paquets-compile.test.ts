// Plusieurs sections par module — pourquoi ce test existe.
//
// `@i18n 'accueil' 'onglets-admin'` demande, pour un même module, plusieurs paquets de textes (sections) : ceux
// de la page, et ceux de ses blocs enfants, qui n'attendent plus un second aller-retour pour leurs propres textes.
// Ce fichier garde la COMPILATION : la directive lit toutes les sections dans l'ordre écrit, les clés relatives
// portent la liste des sections à chercher (la première qui porte la clé gagne), l'instance reçoit ses sections en
// plus ; un module à une seule section se compile comme avant, à l'octet. Le comportement à l'exécution (requêtes
// parallèles, attente, enfant sans seconde attente, bascule de langue, rendu serveur) est dans i18n-paquets.test.ts.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.ts'
import { extractDirectives } from '../src/transpiler/directives.ts'
import { setMessagesLang } from '../src/messages/index.ts'

describe('i18n — plusieurs sections par module (directive)', function () {
  it("@i18n 'accueil' 'onglets-admin' : la première section, puis les suivantes dans l'ordre écrit", () => {
    const res = extractDirectives("@i18n 'accueil' 'onglets-admin'\n<p>hi</p>")
    assert.equal(res.moduleI18nSection, 'accueil')
    assert.deepEqual(res.moduleI18nExtraSections, ['onglets-admin'])
    assert.ok(!res.cleaned.includes('@i18n'), 'la directive est retirée du source nettoyé')
  })

  it('trois sections, guillemets simples et doubles mêlés, espaces et tabulations entre les noms', () => {
    const res = extractDirectives("@i18n 'a'\t\"b\"   'c-d'\n<p>hi</p>")
    assert.equal(res.moduleI18nSection, 'a')
    assert.deepEqual(res.moduleI18nExtraSections, ['b', 'c-d'])
  })

  it('une seule section : aucune section en plus', () => {
    const res = extractDirectives("@i18n 'panier'\n<p>hi</p>")
    assert.equal(res.moduleI18nSection, 'panier')
    assert.deepEqual(res.moduleI18nExtraSections, [])
  })

  it('sans @i18n : aucune section, aucune en plus', () => {
    const res = extractDirectives('<p>hi</p>')
    assert.equal(res.moduleI18nSection, null)
    assert.deepEqual(res.moduleI18nExtraSections, [])
  })

  it("un nom de section invalide, où qu'il soit dans la liste : même erreur de compilation qu'avec une seule section", () => {
    assert.throws(() => extractDirectives("@i18n 'accueil' 'Onglets'\n<p>hi</p>"), /@i18n.*Onglets.*n'est pas un nom de section valide/s)
    assert.throws(() => extractDirectives("@i18n 'Accueil' 'onglets'\n<p>hi</p>"), /@i18n.*Accueil.*n'est pas un nom de section valide/s)
    assert.throws(() => extractDirectives("@i18n 'accueil' 'mon onglet'\n<p>hi</p>"), /@i18n/)
  })

  it('une section écrite deux fois dans la liste : erreur de compilation explicite qui la nomme', () => {
    assert.throws(() => extractDirectives("@i18n 'accueil' 'onglets' 'accueil'\n<p>hi</p>"), /@i18n.*accueil.*deux fois/s)
  })

  it('deux lignes @i18n : toujours « en double », le message nomme les deux listes et indique la forme à plusieurs sections', () => {
    assert.throws(() => extractDirectives("@i18n 'accueil' 'onglets'\n@i18n 'compte'\n<p>hi</p>"), /@i18n en double.*accueil onglets.*compte.*@i18n 'a' 'b'/s)
  })

  it("@i18nPlaceholder wait avec plusieurs sections : accepté (il y a de quoi attendre)", () => {
    const res = extractDirectives("@i18n 'accueil' 'onglets'\n@i18nPlaceholder wait\n<p>hi</p>")
    assert.equal(res.moduleI18nPlaceholder, 'wait')
    assert.equal(res.moduleI18nSection, 'accueil')
  })

  // une ligne `@i18n` qui n'a pas la forme de la directive était laissée telle quelle : aucune section posée, aucune erreur, et
  // la ligne sortait en texte dans la page. Elle est refusée, avec la forme juste
  const MAL_ECRITES: Array<[string, string]> = [
    ['une virgule entre les noms', "@i18n 'accueil', 'onglets-admin'"],
    ['une virgule entourée d\'espaces', "@i18n 'accueil' , 'onglets-admin'"],
    ['deux noms collés', "@i18n 'accueil''onglets-admin'"],
    ['un nom sans guillemets', "@i18n 'accueil' onglets"],
    ['un commentaire en fin de ligne', "@i18n 'accueil' 'onglets-admin' // note"],
    ['aucun espace avant le premier nom', "@i18n'accueil' 'onglets-admin'"],
    ['aucune section', '@i18n'],
    ['un signe égal', "@i18n = 'accueil'"],
  ]

  for (const [cas, ligne] of MAL_ECRITES) {
    it(`${cas} : erreur de compilation qui cite la ligne et donne la forme juste`, () => {
      assert.throws(
        () => extractDirectives(`${ligne}\n<p>hi</p>`),
        (e: Error) => {
          assert.match(e.message, /@i18n/)
          assert.ok(e.message.includes(ligne.trim()), `la ligne fautive est citée : ${e.message}`)
          assert.ok(e.message.includes("@i18n 'accueil' 'onglets-admin'"), `la forme juste est donnée : ${e.message}`)
          return true
        }
      )
    })
  }

  it('la ligne fautive est refusée aussi par la compilation du composant, pas seulement par la lecture des directives', async () => {
    await assert.rejects(() => transpile("@i18n 'a', 'b'\n<p>{µt('x')}</p>", { moduleName: 'mjs-paq-virgule' }), /@i18n 'a', 'b'.*@i18n 'accueil' 'onglets-admin'/s)
  })

  it('une ligne fautive qui suit une directive valide est refusée aussi', () => {
    assert.throws(() => extractDirectives("@i18n 'accueil'\n@i18n 'a', 'b'\n<p>hi</p>"), /@i18n 'a', 'b'/)
  })

  it('en anglais : même refus, message de la langue du projet', () => {
    setMessagesLang('en')
    try {
      assert.throws(() => extractDirectives("@i18n 'a', 'b'\n<p>hi</p>"), /@i18n 'a', 'b'.*not.*@i18n 'accueil' 'onglets-admin'/s)
    }
    finally { setMessagesLang('fr') }
  })

  it("ce qui n'est pas la directive n'est pas refusé : @i18nPlaceholder, un membre `@i18n.x`, un exemple dans <pre>, <code>, un commentaire HTML, <style>, ou en commentaire et en chaîne d'un script", () => {
    const sources = [
      "@i18nPlaceholder *skeleton\n<p>hi</p>",
      "<script>\n  @i18n.x = 1\n</script>\n<p>hi</p>",
      "<pre>\n@i18n 'a', 'b'\n</pre>",
      "<code>\n@i18n 'a', 'b'\n</code>",
      "<!--\n@i18n 'a', 'b'\n-->\n<p>hi</p>",
      "<style>\n@i18n 'a', 'b'\n</style>\n<p>hi</p>",
      "<script>\n  // @i18n 'a', 'b'\n  note = `\n@i18n 'a', 'b'\n`\n</script>\n<p>hi</p>",
    ]
    for (const source of sources) assert.doesNotThrow(() => extractDirectives(source), source)
  })
})

describe('i18n — plusieurs sections par module (compilation)', function () {
  this.timeout(8000)

  const compile = async (src: string, nom: string) => (await transpile(src, { moduleName: nom })).output

  it("clé relative : la section du module, puis les sections en plus dans le même appel (4e argument)", async () => {
    const out = await compile(["@i18n 'accueil' 'onglets-admin'", "<p>{µt('titre')}</p>"].join('\n'), 'mjs-paq-cle')
    assert.match(out, /µ\.t\('accueil\.titre', undefined, undefined, \['onglets-admin\.titre'\]\)/)
  })

  it("avec des variables : les variables gardent leur place, la liste vient en 4e", async () => {
    const out = await compile(["@i18n 'accueil' 'onglets-admin'", "<p>{µt('items', { n: 2 })}</p>"].join('\n'), 'mjs-paq-vars')
    assert.match(out, /µ\.t\('accueil\.items', \{ n: 2 \}, undefined, \['onglets-admin\.items'\]\)/)
  })

  it("avec @i18nPlaceholder wait : le mode reste en 3e argument littéral, la liste en 4e", async () => {
    const out = await compile(["@i18n 'accueil' 'onglets-admin'", '@i18nPlaceholder wait', "<p>{µt('titre')}</p>"].join('\n'), 'mjs-paq-mode')
    assert.match(out, /µ\.t\('accueil\.titre', undefined, 'wait', \['onglets-admin\.titre'\]\)/)
  })

  it("trois sections : la liste porte les deux sections en plus, dans l'ordre écrit", async () => {
    const out = await compile(["@i18n 'a' 'b' 'c'", "<p>{µt('x')}</p>"].join('\n'), 'mjs-paq-trois')
    assert.match(out, /µ\.t\('a\.x', undefined, undefined, \['b\.x', 'c\.x'\]\)/)
  })

  it("chemin absolu : jamais préfixé, jamais de liste — comme avec une seule section", async () => {
    const out = await compile(["@i18n 'accueil' 'onglets-admin'", "<button @click={µt('/nav.fermer')}>X</button>"].join('\n'), 'mjs-paq-abs')
    assert.match(out, /µ\.t\('nav\.fermer'\)/)
    assert.doesNotMatch(out, /accueil\.nav|onglets-admin\.nav/)
  })

  it("µt imbriqué dans les variables d'un autre : même traitement que l'appel de premier niveau", async () => {
    const out = await compile(["@i18n 'accueil' 'onglets-admin'", "<p>{µt('a', { x: µt('b') })}</p>"].join('\n'), 'mjs-paq-imbrique')
    assert.match(out, /µ\.t\('accueil\.a', \{ x: µ\.t\('accueil\.b', undefined, undefined, \['onglets-admin\.b'\]\) \}, undefined, \['onglets-admin\.a'\]\)/)
  })

  it("clé calculée (gabarit) : jamais préfixée, jamais de liste", async () => {
    const out = await compile(["@i18n 'accueil' 'onglets-admin'", '<p>{µt("nav.#{$k}")}</p>'].join('\n'), 'mjs-paq-calc')
    assert.match(out, /µ\.t\(`nav\.\$\{/)
    assert.doesNotMatch(out, /accueil\.nav|onglets-admin\.nav/)
  })

  it("l'instance reçoit ses sections en plus : _mjs_i18n = [section, mode, [sections en plus]]", async () => {
    const out = await compile(["@i18n 'accueil' 'onglets-admin'", "<p>{µt('titre')}</p>"].join('\n'), 'mjs-paq-ligne')
    assert.match(out, /_mjs_i18n = \["accueil",null,\["onglets-admin"\]\];/)
    const mode = await compile(["@i18n 'accueil' 'onglets-admin' 'compte'", '@i18nPlaceholder wait', "<p>{µt('titre')}</p>"].join('\n'), 'mjs-paq-ligne-mode')
    assert.match(mode, /_mjs_i18n = \["accueil","wait",\["onglets-admin","compte"\]\];/)
  })

  it("une seule section : compilation inchangée — ni 4e argument, ni 3e élément à l'instance", async () => {
    const out = await compile(["@i18n 'panier'", "<p>{µt('titre')}</p>"].join('\n'), 'mjs-paq-seul')
    assert.match(out, /µ\.t\('panier\.titre'\)/)
    assert.match(out, /_mjs_i18n = \["panier",null\];/)
    const mode = await compile(["@i18n 'panier'", '@i18nPlaceholder wait', "<p>{µt('titre', { n: 1 })}</p>"].join('\n'), 'mjs-paq-seul-mode')
    assert.match(mode, /µ\.t\('panier\.titre', \{ n: 1 \}, 'wait'\)/)
    assert.match(mode, /_mjs_i18n = \["panier","wait"\];/)
  })
})
