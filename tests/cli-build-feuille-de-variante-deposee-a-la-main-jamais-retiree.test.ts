// une feuille `<module>.<nom>.css` déposée à la main dans le dossier de sortie n'est jamais retirée, construction après construction,
// avec et sans `--cache`, même quand la feuille qu'une variante voisine a fait écrire part avec sa variante : seule celle-là est notée au
// registre des sorties, et le cœur garde le module des variantes que la feuille déposée demande. Un dossier de sortie bâti avant que le
// registre ne note ces feuilles : la feuille d'une variante retirée y reste, prise pour une feuille déposée à la main

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, write } from './helpers/construction-cache.js'

const MARK_LAYOUT_VARIANT = 'µ.Element.prototype._mjs_applyLayoutVariant = async function'
const TITRE               = '<h1 class="t">Titre</h1>\n<style>\n  .t\n    font-size: 2rem\n</style>\n<style name="bandeau">\n  .t\n    font-size: 3rem\n</style>\n'
const TITRE_SANS_VARIANTE = '<h1 class="t">Titre</h1>\n<style>\n  .t\n    font-size: 2rem\n</style>\n'
const DEPOSEE             = '.x { color: teal; }\n'

function project(prefix: string): string {
  const root = mjsTmp(prefix)
  write(join(root, 'app/titre.mjs'), TITRE)
  write(join(root, 'app/carte.mjs'), '<p class="x">carte</p>\n')
  write(join(root, 'mjs.config.json'), `${JSON.stringify({ sourceDir: 'app', outputDir: 'public/m', manifestPath: 'public/m/bundle.js', urlPrefix: '/m' }, null, 2)}\n`)
  mkdirSync(join(root, 'node_modules'))
  return root
}

// le module des variantes est-il dans la sortie ? Et le registre des sorties tel qu'il est écrit
const withVariants = (out: string): boolean => readdirSync(out).some(f => f.endsWith('.js') && readFileSync(join(out, f), 'utf-8').includes(MARK_LAYOUT_VARIANT))
const registry     = (out: string): any => JSON.parse(readFileSync(join(out, '.mjs-outputs.json'), 'utf-8'))

describe('mjs build : une feuille de variante déposée à la main n\'est jamais retirée', function () {
  this.timeout(300_000)

  for (const mode of [[], ['--cache']]) {
    it(`${mode.length > 0 ? 'avec' : 'sans'} --cache : la feuille déposée reste, celle de la variante retirée part`, function () {
      const root  = project('variante-deposee')
      const out   = join(root, 'public/m')
      const first = build(root, mode)
      assert.equal(first.status, 0, first.out)
      writeFileSync(join(out, 'carte.sombre.css'), DEPOSEE)
      for (const step of ['variante gardée', 'variante retirée', 'rien de changé', 'rien de changé, encore']) {
        if (step === 'variante retirée') write(join(root, 'app/titre.mjs'), TITRE_SANS_VARIANTE)
        const run = build(root, mode)
        assert.equal(run.status, 0, `${step} : ${run.out}`)
        assert.equal(readFileSync(join(out, 'carte.sombre.css'), 'utf-8'), DEPOSEE, `${step} : ${run.out}`)
        assert.ok(withVariants(out), `${step} : module des variantes absent alors que la feuille déposée le demande`)
        assert.equal(existsSync(join(out, 'titre.bandeau.css')), step === 'variante gardée', `${step} : ${run.out}`)
        assert.deepEqual(Object.keys(registry(out).layoutStyles ?? {}), step === 'variante gardée' ? ['titre.bandeau.css'] : [], `${step} : ${run.out}`)
      }
    })
  }

  // la variante retirée des sources, l'auteur pose SA feuille sous le nom de celle que le build avait écrite : elle reste, et demande le module des variantes
  for (const mode of [[], ['--cache'], ['--prod']]) {
    it(`${mode.join(' ') || 'sans option'} : la feuille posée à la place de celle d'une variante retirée reste`, function () {
      const root  = project('variante-remplacee')
      const out   = join(root, 'public/m')
      const first = build(root, mode)
      assert.equal(first.status, 0, first.out)
      write(join(root, 'app/titre.mjs'), TITRE_SANS_VARIANTE)
      writeFileSync(join(out, 'titre.bandeau.css'), DEPOSEE)
      for (const step of ['variante retirée, feuille posée', 'rien de changé']) {
        const run = build(root, mode)
        assert.equal(run.status, 0, `${step} : ${run.out}`)
        assert.equal(readFileSync(join(out, 'titre.bandeau.css'), 'utf-8'), DEPOSEE, `${step} : ${run.out}`)
        assert.equal(registry(out).layoutStyles, undefined, `${step} : ${run.out}`)
        if (mode[0] !== '--prod') assert.ok(withVariants(out), `${step} : module des variantes absent alors que la feuille posée le demande`)
      }
    })
  }

  it('dossier de sortie bâti avant que le registre ne note ces feuilles : la feuille d\'une variante retirée reste', function () {
    const root  = project('variante-registre-ancien')
    const out   = join(root, 'public/m')
    const first = build(root, [])
    assert.equal(first.status, 0, first.out)
    // le registre tel qu'une construction d'avant l'écrivait : sans la liste des feuilles des variantes
    const old = registry(out)
    delete old.layoutStyles
    writeFileSync(join(out, '.mjs-outputs.json'), `${JSON.stringify(old, null, 2)}\n`)
    write(join(root, 'app/titre.mjs'), TITRE_SANS_VARIANTE)
    for (const mode of [[], ['--cache'], ['--cache'], []]) {
      const run = build(root, mode)
      assert.equal(run.status, 0, run.out)
      assert.ok(existsSync(join(out, 'titre.bandeau.css')), run.out)
      assert.ok(withVariants(out), `module des variantes absent alors que la feuille restée le demande : ${run.out}`)
    }
  })
})
