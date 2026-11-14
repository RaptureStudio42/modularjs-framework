// un signe que le lecteur de gabarit ne sait pas lire au début d'un nom d'attribut (`<div $foo="1">`, `#foo`, `étiquette`)
// était jeté sans rien dire : l'attribut sortait `foo`, la faute de frappe passait inaperçue. La construction s'arrête
// désormais sur une erreur qui cite le fichier, la ligne, la balise et l'attribut tel qu'il est écrit ; les séparateurs
// entre deux attributs restent les espaces et les retours à la ligne (une virgule, un guillemet perdu sont refusés de même)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

// vraie construction d'un composant : les messages d'erreur, tels que les voit l'auteur
async function build(name: string, source: string): Promise<string[]> {
  const root   = mjsTmp(`signe-${name}`)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, `${name}.mjs`), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  return stats.errors.map((e: any) => String(e.message))
}

// l'attribut fautif à la ligne 3 du fichier, sur une balise écrite sur deux lignes
const gabarit = (attribut: string): string => `<p>avant</p>\n<div class="carte"\n  ${attribut}="1">x</div>\n`

const SIGNES: Array<[string, string]> = [['dollar', '$'], ['micro', 'µ'], ['diese', '#'], ['pourcent', '%'], ['tilde', '~'], ['circonflexe', '^'], ['esperluette', '&'], ['plus', '+'], ['exclamation', '!']]

describe('un signe inconnu au début d\'un nom d\'attribut arrête la construction', () => {
  for (const [nom, signe] of SIGNES) {
    it(`<div ${signe}foo="1"> → erreur qui cite le fichier, la ligne 3, la balise et \`${signe}foo\``, async () => {
      const errors = await build(`signe-${nom}`, gabarit(`${signe}foo`))
      assert.equal(errors.length, 1, `une erreur attendue, reçu : ${errors.join(' || ') || 'aucune'}`)
      const message = errors[0]
      assert.ok(message.includes(`signe-${nom}.mjs`), `le fichier manque : ${message}`)
      assert.ok(message.includes('ligne 3'), `la ligne manque : ${message}`)
      assert.ok(message.includes('<div>'), `la balise manque : ${message}`)
      assert.ok(message.includes(`\`${signe}foo\``), `l'attribut tel qu'il est écrit manque : ${message}`)
      assert.match(message, /lettres sans accent, des chiffres/, `ce qu'un nom d'attribut peut contenir manque : ${message}`)
      assert.match(message, /Corrigez ou retirez/)
    })
  }

  it('une lettre accentuée au début d\'un nom (`étiquette="x"`) est refusée de même', async () => {
    const errors = await build('signe-accent', gabarit('étiquette'))
    assert.equal(errors.length, 1, errors.join(' || ') || 'aucune erreur')
    assert.ok(errors[0].includes('`étiquette`') && errors[0].includes('ligne 3'), errors[0])
  })

  it('une virgule entre deux attributs (`a="1", b="2"`) est refusée : seuls les espaces et les retours à la ligne séparent', async () => {
    const errors = await build('signe-virgule', '<div a="1", b="2">x</div>\n')
    assert.equal(errors.length, 1, errors.join(' || ') || 'aucune erreur')
    assert.ok(errors[0].includes('`,`') && errors[0].includes('ligne 1'), errors[0])
  })

  it('un guillemet perdu (`title="a"b"`) est refusé au lieu d\'être avalé', async () => {
    const errors = await build('signe-guillemet', '<div title="a"b">x</div>\n')
    assert.equal(errors.length, 1, errors.join(' || ') || 'aucune erreur')
    assert.ok(errors[0].includes('`"`'), errors[0])
  })

  it('le message existe en anglais, dans la langue du projet', async () => {
    setMessagesLang('en')
    try {
      const errors = await build('signe-anglais', gabarit('$foo'))
      assert.equal(errors.length, 1, errors.join(' || ') || 'aucune erreur')
      assert.ok(errors[0].includes('`$foo`') && errors[0].includes('line 3') && errors[0].includes('<div>'), errors[0])
      assert.match(errors[0], /unaccented letters, digits/)
    }
    finally {
      setMessagesLang('fr')
    }
  })
})

describe('ce qui reste permis dans les attributs', () => {
  it('événement, effets, étalement, classe et style conditionnels, noms à `:`, `_`, liaison `!{…}`, valeur sans guillemets, `/>`, plusieurs lignes', async () => {
    const source = [
      '<script>',
      '  $v = \'a\'',
      '  $actif = true',
      '  $props = { title: \'t\' }',
      '</script>',
      '<button @click={$v = \'b\'} *tilt class="x" :class{$actif}="on" :style.color={$v} data-x_y="1" title=sans-guillemets',
      '  aria-label="sur deux lignes"',
      '  {...$props}>ok</button>',
      '<div *tilt(max: 10)>carte</div>',
      '<input value=!{$v} />',
      '<svg><use xlink:href="#icone"></use></svg>',
      '<@slot {$v}/>',
      ''
    ].join('\n')
    const errors = await build('signe-permis', source)
    assert.equal(errors.length, 0, errors.join(' || '))
  })
})
