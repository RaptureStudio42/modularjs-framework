// `<@slot>` jamais refermé, suivi de commentaires HTML puis d'une balise : pour savoir si le texte qui le suit n'est fait que de
// blancs et de commentaires, la lecture essayait chaque découpe des commentaires (des milliards dès une trentaine) et la
// construction ne rendait plus la main ; elle refuse la balise non fermée, comme avec deux commentaires. Un `<@slot>` suivi de
// commentaires seulement se lit toujours comme `<@slot/>`. Chaque source est compilée dans un processus à part, arrêté s'il
// ne rend pas la main dans les 30 s (une garde, pas une mesure)
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const RACINE     = fileURLToPath(new URL('..', import.meta.url))
const TRANSPILER = new URL('../src/transpiler/index.ts', import.meta.url).href
const ENFANT     = `import { readFileSync } from 'node:fs'
const { transpile } = await import(${JSON.stringify(TRANSPILER)})
try {
  await transpile(readFileSync(0, 'utf8'), { moduleName: 'slot-ouvert' })
  console.log('compilé')
}
catch (e) {
  console.log('refusé : ' + String(e.message).replace(/\\s+/g, ' '))
}
process.exit(0)`

// le verdict de la compilation de `source` dans son processus, ou `ne rend pas la main` quand la garde l'a arrêté
const compiler = (source: string): string => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', ENFANT], { cwd: RACINE, input: source, encoding: 'utf8', timeout: 30000 })
  if (r.signal) return 'ne rend pas la main en 30 s'
  return r.stdout.split('\n').find(l => /^(?:compilé|refusé : )/.test(l)) ?? `rien dit (code ${r.status}) : ${r.stderr.slice(0, 300)}`
}
const COMMENTAIRES = '<!-- note\n  sur deux lignes -->\n'.repeat(60)

describe('<@slot> jamais refermé, suivi de commentaires : la construction rend la main', function () {
  this.timeout(120000)
  it('suivi de 60 commentaires puis d\'une balise : refusé, la balise non fermée nommée', () => {
    const verdict = compiler('<p>a</p>\n<@slot>\n' + COMMENTAIRES + '<p>pied</p>\n')
    assert.match(verdict, /^refusé : .*BALISE NON FERMÉE.*<slot>/, verdict)
  })
  it('témoin : deux commentaires puis une balise, le même refus', () => {
    const verdict = compiler('<p>a</p>\n<@slot>\n<!-- un -->\n<!-- deux -->\n<p>pied</p>\n')
    assert.match(verdict, /^refusé : .*BALISE NON FERMÉE.*<slot>/, verdict)
  })
  it('témoin : suivi de 60 commentaires seulement, compilé comme `<@slot/>`', () => {
    assert.equal(compiler('<p>a</p>\n<@slot>\n' + COMMENTAIRES), 'compilé')
  })
})
