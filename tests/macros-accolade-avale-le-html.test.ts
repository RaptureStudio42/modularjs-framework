// une accolade, une parenthèse ou une condition de classe que l'auteur n'a pas refermée sur une balise du langage
// (`<@window>`, `<@head>`, `<@body>`, `<@element>`, `<@failed>`) avale le HTML qui suit jusqu'à la première `}` qui lui répond
// plus loin : l'arbre du gabarit referme alors la balise. Comme avant la lecture par l'arbre, une valeur d'attribut où une
// ligne commence par une balise dit cette balise jamais refermée : signalée, laissée telle quelle, la construction s'arrête
// sur un message qui cite sa ligne du .mjs — jamais une erreur de Civet sur un gestionnaire fait de balises, jamais le HTML
// avalé effacé sans un mot. Une chaîne, un heredoc ou un commentaire qui écrit du HTML en tête de ligne reste permis

import assert from 'node:assert/strict'
import { processGlobalMacros } from '../src/transpiler/macros.js'
import { transpile } from '../src/transpiler/index.js'

// le message qui arrête la construction (null quand elle passe), et les erreurs écrites en console
async function rejectionOf(src: string): Promise<{ message: string | null, logged: string[] }> {
  const orig             = console.error
  const logged: string[] = []
  console.error          = (...a: unknown[]) => { logged.push(a.map(String).join(' ')) }
  try {
    await transpile(src, { moduleName: 'avale' })
    return { message: null, logged }
  }
  catch (e) {
    return { message: (e as Error).message, logged }
  }
  finally {
    console.error = orig
  }
}

// processGlobalMacros, ses messages de console tus
function macrosOf(html: string): ReturnType<typeof processGlobalMacros> {
  const orig    = console.error
  console.error = () => {}
  try {
    return processGlobalMacros(html)
  }
  finally {
    console.error = orig
  }
}

describe('une balise du langage dont une accolade avale le HTML qui suit', function () {
  this.timeout(60000)

  const cases: Array<[string, string, string, RegExp]> = [
    ['un gestionnaire de <@window> refermé par la fermante d\'un texte plus loin', 'window', '<p>avant</p>\n<p>avant 2</p>\n<@window @resize={ $w = window.innerWidth >\n<div class="a">\n  <p>{$w}</p>\n</div>\n<p>texte } fin</p>\n<script>\n$w = 0\n</script>\n', /`<\/p` sur <@window> \(ligne 7\)/],
    ['un gestionnaire de <@window> refermé par `}>` plus loin', 'window', '<@window @click={foo(bar>\n<div>SECTION-INTERMEDIAIRE-A</div>\n<p>APRES-1</p>\nbaz}>\n<p>APRES-2</p>\n', /BALISE NON FERMÉE\] `<@window>` ouverte ligne 1/],
    ['un gestionnaire de <@head>, sa fermante avalée', 'head', '<p>avant</p>\n<@head @click={ f(e) >\n<title>T</title>\n</@head>\n<p>{$x}</p>\n<p>} fin</p>\n<script>\n$x = 1\n</script>\n', /`<\/p` sur <@head> \(ligne 6\)/],
    ['la condition d\'une classe de <@body>', 'body', '<p>avant</p>\n<@body :class{$a="actif">\n<main>\n  <p>{$x}</p>\n</main>\n<p>} reste</p>\n<script>\n$a = no\n$x = 1\n</script>\n', /`<\/p` sur <@body> \(ligne 6\)/],
    ['un gestionnaire de <@element>', 'element', '<p>avant</p>\n<@element $tag @click={ go() >\n<span>{$x}</span>\n</@element>\n<p>}</p>\n<script>\n$tag = "div"\n$x = 1\ngo = -> 1\n</script>\n', /`\$tag` sur <@element> \(ligne 2\)/],
    ['un réglage de <@failed>', 'failed', '<p>avant</p>\n<@failed err reset={ x >\n<p>{err.message}</p>\n</@failed>\n<p>}</p>\n', /`<\/p` sur <@failed> \(ligne 5\)/]
  ]

  for(const [title, macro, src, line] of cases) {
    it(`${title} : la construction s'arrête sur la ligne du .mjs, la balise est dite jamais refermée`, async () => {
      const { message, logged } = await rejectionOf(src)
      assert.ok(message !== null, 'la construction devait s\'arrêter')
      assert.match(message, line)
      assert.doesNotMatch(message, /Failed to parse|\.script:\d/)
      assert.ok(logged.some((m) => m.includes(`balise <@${macro}> jamais refermée`)), JSON.stringify(logged))
    })
  }

  it('processGlobalMacros : la balise est signalée, le HTML avalé reste à sa place', () => {
    const r = macrosOf('<@window @click={foo(bar>\n<div>SECTION-INTERMEDIAIRE-A</div>\n<p>APRES-1</p>\nbaz}>\n<p>APRES-2</p>')
    assert.ok(r.errors.some((e) => e.includes('<@window>')), JSON.stringify(r.errors))
    assert.ok(r.html.includes('SECTION-INTERMEDIAIRE-A') && r.html.includes('APRES-1'), r.html)
    assert.equal(r.setup, '')
  })

  it('deux balises qui avalent : chacune est signalée', () => {
    const r = macrosOf('<@window @click={f(\n<p>a</p>\n}>\n<@document @keydown={g(\n<p>b</p>\n}>\n')
    assert.equal(r.errors.length, 2, JSON.stringify(r.errors))
  })
})

describe('un gestionnaire sur plusieurs lignes qui écrit du HTML en tête de ligne, hors code', function () {
  this.timeout(60000)

  const valid: Array<[string, string]> = [
    ['dans un heredoc', '<@window @click={\n  html = \'\'\'\n<b>gras</b>\n\'\'\'\n  console.log html\n} />\n<p>x</p>\n'],
    ['dans un gabarit de chaîne', '<@window @click={\n  s = `\n<li>${$n}</li>\n`\n  console.log s\n} />\n<p>{$n}</p>\n<script>\n$n = 1\n</script>\n'],
    ['dans un commentaire de bloc', '<@window @click={\n  ###\n<p>bloc</p>\n  ###\n  $n++\n} />\n<p>{$n}</p>\n<script>\n$n = 1\n</script>\n'],
    ['dans une chaîne sur plusieurs lignes d\'une condition de classe', '<@body :class{$a is "\n<b>"}="actif" />\n<p>x</p>\n<script>\n$a = ""\n</script>\n']
  ]

  for(const [title, src] of valid) {
    it(`${title} : la balise est lue, aucune erreur`, async () => {
      const { message, logged } = await rejectionOf(src)
      assert.equal(message, null)
      assert.deepEqual(logged, [])
    })
  }
})
