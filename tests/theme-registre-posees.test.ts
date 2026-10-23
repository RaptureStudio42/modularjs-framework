// Registre des variables de thème : une variable que le composant POSE lui-même et qu'il lit avec un défaut n'est pas
// cachée, elle est marquée `set: true` (« posée par le composant ») et l'atelier la montre à part.
// Pourquoi ne pas la cacher : une variable posée par un gabarit (`--mjs-nom={$w}` avec `$w` non défini), par un
// `setProperty` conditionnel ou par un `::slotted(*)` se règle quand même depuis l'extérieur, et celui qui la déclare
// dans son thème doit voir que le composant la lit.
// - posée par le script, par le gabarit ou par le CSS du composant sur un élément interne : au registre, `set: true`,
//   `readBy` nomme le composant ; `:host(.on)` vise l'hôte, que le thème atteint : elle n'est pas posée ;
// - déclarée dans le thème de l'application, elle a son lecteur : plus d'« Aucun lecteur » ;
// - `readBy` compte aussi les lectures sans défaut (`var(--mjs-nom)`), sans rien changer aux rappels de `lint.themeUnknown` ;
// - le défaut lu va jusqu'à la parenthèse qui referme la lecture, guillemets compris ;
// - les modules du cœur : carrousel, horloge, cube, code, sélecteur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

type Decl = { value: string; declaredBy: string; kind: string; variant: string; file: string; line: number; doc: string; read?: boolean; set?: boolean }
type Registre = Record<string, { declarations: Decl[]; readBy: string[] }>

async function construire(sources: Record<string, string>): Promise<{ registre: Registre; avertissements: string[] }> {
  const root   = mjsTmp('registre-posees')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(srcDir, nom + '.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), stylesheetsDir: join(root, 'styles') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const fichier = join(outDir, '.mjs-theme-vars.json')
  assert.ok(existsSync(fichier), 'un registre est écrit')
  return { registre: JSON.parse(readFileSync(fichier, 'utf-8')), avertissements: stats.warnings }
}

// `déclarant:valeur:marques`, dans l'ordre du registre (lecture = r, posée = s)
const lignes = (registre: Registre, nom: string): string[] => (registre[nom]?.declarations ?? []).map((d) => `${d.declaredBy}:${d.value}:${d.read ? 'r' : ''}${d.set ? 's' : ''}`)

const THEME = '<theme>\n  $$gap: 12px\n</theme>\n'

const css = (...regles: string[]) => '<style>\n' + regles.join('\n') + '\n</style>\n'

describe('registre des variables de thème — les variables posées par le composant sont marquées, jamais cachées', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('posée par le gabarit (`--mjs-pose-w={$w}`, `$w` non défini) : au registre, posée, lue par le composant', async () => {
    const carte = '<div class="face" --mjs-pose-w={$w}>x</div>\n' + css('  .face', '    width: var(--mjs-pose-w, 10px)')
    const { registre } = await construire({ hote: THEME + '<div>x</div>\n', carte })
    assert.deepEqual(lignes(registre, 'pose-w'), ['carte:10px:rs'])
    assert.deepEqual(registre['pose-w'].readBy, ['carte'])
    assert.equal(registre['pose-w'].declarations[0].line, 0)
  })

  it('posée par le gabarit et déclarée dans le thème de l\'application : la déclaration est là, le composant est son lecteur', async () => {
    const carte = '<div class="face" --mjs-pose-w={$w}>x</div>\n' + css('  .face', '    width: var(--mjs-pose-w, 10px)')
    const { registre } = await construire({ hote: '<theme>\n  $$pose-w: 50px\n</theme>\n<div>x</div>\n', carte })
    assert.deepEqual(lignes(registre, 'pose-w'), ['carte:10px:rs', 'hote:50px:'])
    assert.deepEqual(registre['pose-w'].readBy, ['carte'], 'plus d\'« Aucun lecteur » : le composant la lit')
  })

  it('posée par un `setProperty` conditionnel du script : au registre, posée', async () => {
    const carte = [
      '<script>',
      '  place = (el, vif) -> el.style.setProperty(\'--mjs-pose-x\', \'1px\') if vif',
      '</script>',
      '<div>x</div>',
      css('  :host', '    transform: translateX(var(--mjs-pose-x, 0px))'),
    ].join('\n')
    const { registre } = await construire({ hote: THEME + '<div>x</div>\n', carte })
    assert.deepEqual(lignes(registre, 'pose-x'), ['carte:0px:rs'])
    assert.deepEqual(registre['pose-x'].readBy, ['carte'])
  })

  it('posée par `::slotted(*)` et lue avec un défaut : au registre, posée, lue par le composant', async () => {
    const carte = '<slot></slot>\n' + css('  ::slotted(*)', '    --mjs-f-s: 1px', '    margin: var(--mjs-f-s, 5px)')
    const { registre } = await construire({ hote: THEME + '<div>x</div>\n', carte })
    assert.deepEqual(lignes(registre, 'f-s'), ['carte:1px:s'])
    assert.deepEqual(registre['f-s'].readBy, ['carte'])
  })

  it('posée par le CSS sur un élément interne et lue par le composant : au registre, posée (et plus cachée)', async () => {
    const carte = '<div class="face">x</div>\n' + css('  .face', '    --mjs-carte-i: 1', '    rotate: calc(var(--mjs-carte-i, 0) * 90deg)')
    const { registre } = await construire({ hote: THEME + '<div>x</div>\n', carte })
    assert.deepEqual(lignes(registre, 'carte-i'), ['carte:1:s'])
    assert.deepEqual(registre['carte-i'].readBy, ['carte'], 'le composant la lit')
  })

  it('posée sur l\'hôte, y compris `:host(.on)` : une variable que le thème atteint, pas une variable posée', async () => {
    const carte = '<div>x</div>\n' + css('  :host', '    --mjs-carte-gap: 4px', '    gap: var(--mjs-carte-gap, 9px)', '  :host(.on)', '    --mjs-carte-ton: red', '    color: var(--mjs-carte-ton, blue)')
    const { registre } = await construire({ hote: THEME + '<div>x</div>\n', carte })
    assert.deepEqual(lignes(registre, 'carte-gap'), ['carte:4px:'])
    assert.deepEqual(lignes(registre, 'carte-ton'), ['carte:red:'], '`:host(.on)` vise l\'hôte : la variable reste une déclaration ordinaire')
  })

  it('les lectures sans défaut comptent dans `readBy`, mais pas pour les rappels : `lint.themeUnknown` ne change pas', async () => {
    const lecteur = '<div>x</div>\n' + css('  :host', '    gap: var(--mjs-lu-nu)', '    margin: var(--mjs-fantome)')
    const { registre, avertissements } = await construire({ hote: '<theme>\n  $$lu-nu: 12px\n</theme>\n<div>x</div>\n', lecteur })
    assert.deepEqual(registre['lu-nu'].readBy, ['lecteur'], 'le composant lit la variable, sans défaut')
    assert.equal(registre['fantome'], undefined, 'une lecture sans défaut d\'un nom que personne ne déclare n\'a rien à afficher')
    const inconnues = avertissements.filter((w) => w.endsWith('[lint.themeUnknown]'))
    assert.deepEqual(inconnues, [], 'les rappels sont ceux d\'avant : une lecture CSS sans défaut n\'en déclenche aucun')
  })

  it('une variable lue par `$$` sans déclaration déclenche toujours son rappel', async () => {
    const lecteur = '<div>x</div>\n' + css('  :host', '    color: $$inconnue')
    const { avertissements } = await construire({ hote: THEME + '<div>x</div>\n', lecteur })
    const inconnues = avertissements.filter((w) => w.endsWith('[lint.themeUnknown]'))
    assert.equal(inconnues.length, 1, inconnues.join('\n'))
    assert.match(inconnues[0], /inconnue/)
  })

  it('le défaut lu garde ses guillemets : une parenthèse ou un guillemet échappé dans une chaîne ne referme pas la lecture', async () => {
    const carte = '<div>x</div>\n' + css('  :host', '    quotes: var(--mjs-carte-sep, ")" "(")', '    font-family: var(--mjs-carte-police, "Fira \\"Code\\" (v2)", monospace)', '    margin: var(--mjs-carte-pad, 4px)')
    const { registre } = await construire({ hote: THEME + '<div>x</div>\n', carte })
    assert.deepEqual(lignes(registre, 'carte-sep'), ['carte:")" "(":r'])
    assert.deepEqual(lignes(registre, 'carte-police'), ['carte:\'Fira "Code" (v2)\', monospace:r'])
    assert.deepEqual(lignes(registre, 'carte-pad'), ['carte:4px:r'], 'la lecture suivante est relevée')
  })

  it('le carrousel, l\'horloge, le cube, le code et le sélecteur : ce qu\'ils posent eux-mêmes est au registre, posé', async () => {
    const source = '<@@carousel></@@carousel>\n<@@clock></@@clock>\n<@@select name="s"><@@option value="a">A</@@option></@@select>\n'
    const { registre } = await construire({ hote: THEME + source })
    const posees = Object.keys(registre).filter((n) => registre[n].declarations.some((d) => d.set)).sort()
    for (const nom of ['carousel-o', 'carousel-r', 'carousel-s', 'carousel-x', 'carousel-z', 'clock-p', 'select-panel-max']) {
      assert.ok(posees.includes(nom), `${nom} est posée par son module : ${posees.join(', ')}`)
      assert.deepEqual(registre[nom].declarations.filter((d) => !d.set), [], `${nom} : rien de réglable à côté`)
    }
    assert.deepEqual(registre['carousel-x'].readBy, ['core-carousel'])
    assert.ok(!posees.includes('carousel-shadow'), 'ce que le carrousel ne pose pas reste une valeur par défaut ordinaire')
  })

  it('le cube et le code : leurs variables posées sont au registre', async () => {
    const source = '<@@cube></@@cube>\n<@@code>x</@@code>\n'
    const { registre } = await construire({ hote: THEME + source })
    const posees = Object.keys(registre).filter((n) => registre[n].declarations.some((d) => d.set)).sort()
    assert.ok(posees.includes('cube-i'), `cube-i : ${posees.join(', ')}`)
    assert.ok(posees.includes('code-offset'), `code-offset : ${posees.join(', ')}`)
  })

  it('un second build sur la même instance (composants en cache) rend le même registre, variables posées comprises', async () => {
    const root   = mjsTmp('registre-posees-cache')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), THEME + '<@@carousel></@@carousel>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), stylesheetsDir: join(root, 'styles') })
    const fichier = join(outDir, '.mjs-theme-vars.json')
    await bundler.compile()
    const premier = readFileSync(fichier, 'utf-8')
    rmSync(fichier)
    await bundler.compile()
    await bundler.close()
    assert.equal(readFileSync(fichier, 'utf-8'), premier)
    assert.equal(JSON.parse(premier)['carousel-x'].declarations[0].set, true)
  })
})
