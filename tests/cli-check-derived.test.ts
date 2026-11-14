// `mjs check --derived` : après la liste des composants, le classement des valeurs dérivées — par fichier, chaque dérivée,
// sa classe (« précise » ou « horloge ») et, à l'horloge, sa raison ; puis un total. Sans l'option, la sortie de
// `mjs check` ne porte rien de plus. Vrai sous-processus (cli.ts lance `run(process.argv)` dès son chargement).

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function projet(): string {
  const root = mjsTmp('check-derived')
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  writeFileSync(join(root, 'app', 'modularjs', 'boutique.mjs'), `<script>
$cart = 0
dailyPrice .= 10
$total = $cart * dailyPrice
$double = $cart * 2
@hausse = -> dailyPrice = 12
</script>
<p>{$total} {$double}</p>
`)
  writeFileSync(join(root, 'app', 'modularjs', 'hello.mjs'), '<p>hi</p>')
  return root
}

function check(root: string, ...options: string[]) {
  return spawnSync('npx', ['tsx', 'src/cli.ts', 'check', ...options, '--root', root], { cwd: repoRoot, encoding: 'utf-8' })
}

describe('cli.ts — mjs check --derived : le classement des dérivées', function () {
  this.timeout(60000)

  it('dit le mode de l\'appli : sans la clé, la précision (défaut), et sa légende', () => {
    const r = check(projet(), '--derived')
    assert.equal(r.status, 0, `stderr :\n${r.stderr}`)
    const titre = r.stdout.split('\n').find((l) => /Dérivées —/.test(l)) ?? ''
    assert.match(titre, /mode de votre appli : précision \(défaut, sans "derived": "clock" dans mjs\.config\.json\)/, `mode dit :\n${r.stdout}`)
    assert.match(titre, /« précise » : suit ses sources, sauf quand elle repasse à l'horloge \(chapitre 3\)/, `légende :\n${r.stdout}`)
  })

  it('avec "derived": "clock" dans mjs.config.json : la règle de l\'horloge, et ce que « précise » deviendrait sans la clé', () => {
    const root = projet()
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ derived: 'clock' }))
    const r = check(root, '--derived')
    assert.equal(r.status, 0, `stderr :\n${r.stderr}`)
    const titre = r.stdout.split('\n').find((l) => /Dérivées —/.test(l)) ?? ''
    assert.match(titre, /mode de votre appli : horloge \("derived": "clock" dans mjs\.config\.json\)/, `mode dit :\n${r.stdout}`)
    assert.match(titre, /sans cette clé, une valeur « précise » suivrait ses sources, sauf quand elle repasse à l'horloge \(chapitre 3\)/, `légende au conditionnel :\n${r.stdout}`)
    assert.doesNotMatch(titre, /« précise » : recalculée|seulement|ne serait [^,;]* que /, 'aucune promesse de précision à l\'horloge')
  })

  it('avec --derived : par fichier la dérivée, sa classe et sa raison, puis le total', () => {
    const r = check(projet(), '--derived')
    assert.equal(r.status, 0, `stderr :\n${r.stderr}`)
    assert.doesNotMatch(r.stdout + r.stderr, /Flag inconnu/, 'option reconnue')
    const lignes  = r.stdout.split('\n')
    const fichier = lignes.findIndex((l) => /boutique\.mjs\s*$/.test(l))
    assert.ok(fichier >= 0, `le fichier boutique.mjs est nommé :\n${r.stdout}`)
    const total  = lignes.find((l) => /^\s*\$total\b/.test(l)) ?? ''
    const double = lignes.find((l) => /^\s*\$double\b/.test(l)) ?? ''
    assert.match(total, /horloge/, `$total à l'horloge :\n${r.stdout}`)
    assert.match(total, /dailyPrice/, 'la raison nomme la variable ordinaire lue')
    // calcul simple (une lecture et une multiplication) : à l'horloge, la refaire coûte moins que la vérifier
    assert.match(double, /horloge/, `$double à l'horloge :\n${r.stdout}`)
    assert.match(double, /calcul plus court que sa vérification/, `$double : calcul simple :\n${r.stdout}`)
    assert.ok(lignes.indexOf(total) > fichier && lignes.indexOf(double) > fichier, 'les dérivées suivent leur fichier')
    assert.match(r.stdout, /2 dérivées dans 1 fichier : 0 précise, 2 à l'horloge/, `total :\n${r.stdout}`)
    assert.doesNotMatch(r.stdout, /hello\.mjs\s*$/m, 'un fichier sans dérivée n\'est pas listé')
  })

  it('sans --derived : la sortie de mjs check ne porte aucun classement', () => {
    const r = check(projet())
    assert.equal(r.status, 0, `stderr :\n${r.stderr}`)
    assert.doesNotMatch(r.stdout, /dérivée|horloge|précise/, `aucun classement sans l'option :\n${r.stdout}`)
    assert.match(r.stdout, /composants? détectés?/, 'la sortie habituelle')
  })
})
