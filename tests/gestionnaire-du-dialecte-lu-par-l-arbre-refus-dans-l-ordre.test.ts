// un gestionnaire du dialecte qu'acorn ne lit pas est lu par l'arbre (Civet et sa carte) de bout en bout : les écritures valides que
// seule l'ancienne lecture construisait gardent leur sortie ; `$x =: "a"` garde sa chaîne (l'ancienne lecture la coupait :
// `µ.snap( )`) ; `@@µmount` est refusé comme `µmount` (l'ancienne lecture laissait un gestionnaire vide et appelait le crochet
// dans la liste) ; les refus précis gardent leur ordre (segment de code après segment de code, puis le nom seul relevé par le
// transpileur) ; une vraie faute de syntaxe est dite sur le texte écrit, après eux

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const SCRIPT = '<script>\n$x = 0\n$y = 0\n$n = 3\n$l = [1, 2, 3]\n$open = false\n</script>\n'

async function construire(gestionnaire: string): Promise<string> {
  const r: any = await transpile(`<button @click={${gestionnaire}}>x</button>\n${SCRIPT}`, { moduleName: 'main' })
  return /_mjs_inline = \[([\s\S]*?)\n\]/.exec(String(r.output))?.[1]?.trim() ?? ''
}

async function refus(src: string): Promise<string> {
  const orig = console.error
  console.error = () => {}
  try {
    await transpile(src, { moduleName: 'main' })
  }
  catch (err: any) {
    return String(err?.message ?? err)
  }
  finally {
    console.error = orig
  }
  return ''
}

describe('gestionnaire du dialecte lu par l\'arbre, refus dans l\'ordre', function () {
  this.timeout(60000)

  const valides: Array<[string, string]> = [
    ['[1..$n]', 'return range(1,$.n + 1)'],
    ['$l[1..$n]', 'return $.l.slice(1, $.n + 1 || 1/0)'],
    ['($x) => $x + $y', 'return (pin) => {µ._set(_mjsThis, \'x\', pin);return  $.x + $.y}'],
    ['///^ \\$ \\d+ ///.test($x)', 'return /^\\$\\d+/.test($.x)'],
    ['`${{$x}.x}`', 'return `${{x: $.x}.x}`'],
    ['µread $x + $prénom', 'return _mjsThis._state.x + $.prénom'],
    ['$x =: µread $y', 'return µ._set(_mjsThis, \'x\', µ.snap(_mjsThis._state.y))'],
  ]
  for (const [ecrit, attendu] of valides) {
    it(`« ${ecrit} » se construit comme avant`, async () => {
      assert.equal(await construire(ecrit), `(e, el) => {\n    ${attendu}\n  }`)
    })
  }

  it('« $x =: "a" » garde sa chaîne dans la copie', async () => {
    assert.equal(await construire('$x =: "a"'), '(e, el) => {\n    return µ._set(_mjsThis, \'x\', µ.snap("a"))\n  }')
  })

  it('« @@µmount » est refusé comme « µmount »', async () => {
    const msg = await refus(`<button @click={@@µmount}>x</button>\n${SCRIPT}`)
    assert.match(msg, /« µmount » : les hooks de cycle de vie se déclarent dans le <script>/, msg)
  })

  it('un commentaire `#` dans la partie calculée d\'un gabarit, avec µtoggle, se construit', async () => {
    const out = await construire('s = `v: ${ a # commentaire } fin`; µtoggle($open)')
    assert.ok(out.includes('fin`') && out.includes('µ._set(_mjsThis, \'open\', !$.open)'), out)
  })

  it('deux fautes dans deux segments de code : la première écrite est dite', async () => {
    assert.match(await refus(`<button @click={'a' + &$coffre + 'b' + µmount}>x</button>\n${SCRIPT}`), /« &\$coffre » : le sigil « &\$ » \(vault\) a été retiré/)
    assert.match(await refus(`<button @click={'a' + µmount + 'b' + &$coffre}>x</button>\n${SCRIPT}`), /« µmount » : les hooks de cycle de vie/)
  })

  it('un nom seul qui est un mot du langage est refusé par son nom, pas par Civet', async () => {
    const msg = await refus(`${SCRIPT}<button @click=if>b</button>\n`)
    assert.match(msg, /nomme « if », qui est un mot du langage/, msg)
  })

  it('une vraie faute de syntaxe est dite sur le texte écrit, à sa place dans le fichier', async () => {
    const msg = await refus(`<p>t</p>\n<button @click={$x = 1 +}>x</button>\n${SCRIPT}`)
    assert.match(msg, /handler inline : échec de compilation Civet dans « main » — main\.mjs:2:/, msg)
    assert.doesNotMatch(msg, /indiquée par Civet|\.inlines:/, msg)
  })
})
