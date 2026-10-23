// Registre des variables de thème (`.mjs-theme-vars.json`, lu par l'atelier /__mjs/theme) : il liste aussi les
// variables qu'un composant LIT avec un défaut (`var(--mjs-nom, défaut)`), pas seulement celles qu'il DÉCLARE.
// Les modules du cœur (case, interrupteur, radio, sélecteur) lisent leurs variables à chaque usage, sans les
// déclarer : sans cette liste, l'atelier ne saurait ni les proposer ni montrer leur défaut.
// - la forme est celle des déclarations (`declaredBy`, `value`, ligne 0, `kind: 'module'`) ; le défaut est le
//   second argument tel qu'il est écrit, une cascade garde son texte entier ;
// - une variable déclarée ET lue par le même composant : la déclaration fait foi ;
// - le rappel `lint.themeShared` ne regarde que les déclarations : lire un nom n'impose rien à la descendance ;
// - le silence par défaut tient : un projet qui ne déclare et ne lit rien n'écrit aucun registre ;
// - une lecture porte `read: true` (une déclaration n'a pas ce champ) et son composant figure dans `readBy` ;
// - une variable que le composant POSE lui-même est au registre, marquée `set: true` (posée par le composant) : posée par
//   son script (`style.setProperty('--mjs-x', …)`), par son gabarit (`--mjs-x={…}`, `@style.--mjs-x={…}`,
//   `style="--mjs-x: …"`), ou déclarée par son propre CSS sur un élément interne qu'il lit lui-même.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

type Registre = Record<string, { declarations: { value: string; declaredBy: string; kind: string; variant: string; file: string; line: number; doc: string; read?: boolean }[]; readBy: string[] }>

// un petit projet construit pour de vrai : le registre écrit, ses avertissements
async function construire(sources: Record<string, string>): Promise<{ registre: Registre | null; avertissements: string[] }> {
  const root   = mjsTmp('registre-lectures')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(srcDir, nom + '.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), stylesheetsDir: join(root, 'styles') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const fichier = join(outDir, '.mjs-theme-vars.json')
  return { registre: existsSync(fichier) ? JSON.parse(readFileSync(fichier, 'utf-8')) : null, avertissements: stats.warnings }
}

// `déclarant:valeur`, dans l'ordre du registre
const lignes = (registre: Registre, nom: string): string[] => (registre[nom]?.declarations ?? []).map((d) => `${d.declaredBy}:${d.value}`)

const THEME = '<theme>\n  $$gap: 12px\n</theme>\n'

describe('registre des variables de thème — lectures avec défaut', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('case, interrupteur, radio : leurs variables sont au registre avec leur défaut, une cascade garde son texte entier', async () => {
    const { registre } = await construire({ hote: THEME + '<@@checkbox name="a">A</@@checkbox>\n<@@switch name="b">B</@@switch>\n<@@radio name="c" value="x">C</@@radio>\n' })
    assert.ok(registre, 'un registre est écrit')
    const attendu: Record<string, string[]> = {
      'check-accent':  ['core-checkbox:var(--mjs-accent, #3b82f6)', 'core-radio:var(--mjs-accent, #3b82f6)'],
      'check-border':  ['core-checkbox:var(--mjs-border, #888)', 'core-radio:var(--mjs-border, #888)'],
      'check-color':   ['core-checkbox:#fff'],
      'check-focus':   ['core-checkbox:rgba(59, 130, 246, 0.35)', 'core-radio:rgba(59, 130, 246, 0.35)'],
      'check-radius':  ['core-checkbox:4px'],
      'check-size':    ['core-checkbox:20px', 'core-radio:20px'],
      'switch-accent': ['core-switch:var(--mjs-accent, #3b82f6)'],
      'switch-border': ['core-switch:var(--mjs-border, #888)'],
      'switch-color':  ['core-switch:#fff'],
      'switch-focus':  ['core-switch:rgba(59, 130, 246, 0.35)'],
      'switch-height': ['core-switch:22px'],
      'switch-width':  ['core-switch:40px']
    }
    const vu: Record<string, string[]> = {}
    for (const nom of Object.keys(attendu)) vu[nom] = lignes(registre!, nom)
    assert.deepEqual(vu, attendu)
    const d = registre!['check-size'].declarations[0]
    assert.deepEqual([d.kind, d.variant, d.line, d.doc], ['module', '', 0, ''], 'même forme qu\'une déclaration en CSS brut')
    assert.ok(d.file && !d.file.startsWith('/'), `le fichier est relatif au projet : ${d.file}`)
  })

  it('le carrousel et les deux couleurs du modèle triangle lisent leurs variables à chaque usage, sans les déclarer : elles sont au registre avec leur défaut, en lectures', async () => {
    const { registre } = await construire({ hote: THEME + '<@@switch name="b">B</@@switch>\n<@@carousel></@@carousel>\n' })
    assert.deepEqual(lignes(registre!, 'carousel-button'), ['core-carousel:#fff'])
    assert.deepEqual(lignes(registre!, 'switch-off'), ['core-switch:#0f0'])
    assert.deepEqual(lignes(registre!, 'switch-on'), ['core-switch:#f00'])
    for (const [nom, lecteur] of [['carousel-button', 'core-carousel'], ['switch-off', 'core-switch'], ['switch-on', 'core-switch']]) {
      assert.equal(registre![nom].declarations[0].read, true, `${nom} : une lecture, pas une déclaration`)
      assert.deepEqual(registre![nom].readBy, [lecteur], `${nom} : le lecteur est nommé`)
    }
  })

  it('champ, nombre, pastille de couleur : leurs variables sont au registre avec leur défaut, une cascade garde son texte entier ; la couleur que la pastille pose elle-même n\'y est pas', async () => {
    const { registre } = await construire({ hote: THEME + '<@@field label="E"><input name="email"></@@field>\n<@@number name="q"></@@number>\n<@@color value="#f472b6"></@@color>\n' })
    const attendu: Record<string, string[]> = {
      'field-error-color': ['core-field:#e5484d'],
      'field-ok-color':    ['core-field:#2e9e5b'],
      'number-accent':     ['core-number:var(--mjs-accent, #3b82f6)'],
      'number-border':     ['core-number:var(--mjs-border, #888)'],
      'number-radius':     ['core-number:999px'],
      'number-step-bg':    ['core-number:transparent'],
      'number-width':      ['core-number:160px'],
      'color-border':      ['core-color:var(--mjs-border, #888)'],
      'color-line':        ['core-color:1.26rem'],
      'color-radius':      ['core-color:4px'],
      'color-size':        ['core-color:1em']
    }
    const vu: Record<string, string[]> = {}
    for (const nom of Object.keys(attendu)) vu[nom] = lignes(registre!, nom)
    assert.deepEqual(vu, attendu)
    for (const nom of Object.keys(attendu)) assert.equal(registre![nom].declarations[0].read, true, `${nom} : une lecture, pas une déclaration`)
    assert.equal(registre!['color-value'], undefined, 'la couleur de la pastille est posée par le module à partir de `value` : rien à régler')
  })

  it('un nom lu avec le même défaut à plusieurs endroits d\'un composant n\'y figure qu\'une fois', async () => {
    const { registre } = await construire({ hote: THEME + '<@@checkbox name="a">A</@@checkbox>\n' })
    assert.deepEqual(lignes(registre!, 'check-size'), ['core-checkbox:20px'], 'quatre usages, une entrée')
  })

  it('un composant du projet : ses lectures avec défaut sont listées comme celles des modules, ses déclarations font foi', async () => {
    const { registre } = await construire({
      hote: THEME + '<div>x</div>\n<style>\n  :host\n    --mjs-carte-gap: 12px\n    gap: var(--mjs-carte-gap, 99px)\n    padding: var(--mjs-carte-pad, 4px)\n    margin: var(--mjs-carte-nu)\n    border: var(--mjs-carte-vide,)\n    background: var(--mjs-carte-fond, var(--mjs-surface, #fff))\n</style>\n'
    })
    assert.deepEqual(lignes(registre!, 'carte-gap'), ['hote:12px'], 'déclarée ET lue : la déclaration fait foi')
    assert.deepEqual(lignes(registre!, 'carte-pad'), ['hote:4px'])
    assert.deepEqual(lignes(registre!, 'carte-fond'), ['hote:var(--mjs-surface, #fff)'], 'la cascade garde son texte entier')
    assert.equal(registre!['carte-nu'], undefined, 'une lecture sans défaut n\'a rien à afficher')
    assert.equal(registre!['carte-vide'], undefined, 'un défaut vide non plus')
    assert.deepEqual(lignes(registre!, 'surface'), ['framework:#fff', 'framework:#232936'], 'la variable lue DANS une cascade n\'est pas relevée à part : le thème général garde ses seules déclarations')
  })

  it('une lecture dans la valeur d\'une variable déclarée n\'est pas relevée à part', async () => {
    const { registre } = await construire({ hote: THEME + '<div>x</div>\n<style>\n  :host\n    --mjs-carte-trait: var(--mjs-border, #888)\n</style>\n' })
    assert.deepEqual(lignes(registre!, 'carte-trait'), ['hote:var(--mjs-border, #888)'])
    assert.deepEqual(lignes(registre!, 'border'), ['framework:#d0d0d0', 'framework:#3a4150'])
  })

  it('le sélecteur lit ses variables sans en déclarer : elles arrivent au registre d\'une application qui sort du silence', async () => {
    const { registre } = await construire({ hote: THEME + '<@@select name="s"><@@option value="a">A</@@option></@@select>\n' })
    const noms = Object.keys(registre!).filter((n) => n.startsWith('select-')).sort()
    assert.deepEqual(noms, [
      'select-bg', 'select-border', 'select-fg', 'select-hover', 'select-max', 'select-panel-bg', 'select-panel-left', 'select-panel-max',
      'select-panel-shadow', 'select-placeholder', 'select-radius', 'select-search-h', 'select-selected'
    ])
    assert.equal(registre!['select-panel-max'].declarations[0].set, true, 'la hauteur du panneau est posée par le module à chaque ouverture : posée par le composant')
    assert.equal(registre!['select-panel-left'].declarations[0].set, true, 'la place horizontale du panneau de la réponse libre est calculée et posée par le module : posée par le composant')
    assert.equal(registre!['select-search-h'].declarations[0].set, true, 'la hauteur du champ de recherche, sous lequel colle l\'option choisie, est mesurée et posée par le module : posée par le composant')
    assert.equal(registre!['select-bg'].declarations[0].set, undefined, 'les autres se règlent')
    assert.equal(registre!['select-placeholder'].declarations[0].set, undefined, 'la couleur du texte d\'attente se règle')
    assert.deepEqual(lignes(registre!, 'select-bg'), ['core-select:var(--mjs-surface, #fff)'])
    assert.deepEqual(lignes(registre!, 'select-placeholder'), ['core-select:color-mix(in srgb, currentColor 62%, transparent)'], 'la cascade garde son texte entier')
    assert.deepEqual(lignes(registre!, 'select-panel-shadow'), ['core-select:0 10px 30px var(--mjs-shadow, rgba(0, 0, 0, 0.18))'], 'le défaut va jusqu\'à la parenthèse qui referme la lecture')
  })

  it('le silence par défaut tient : un projet sans <theme>, sans $$ et sans aucune lecture avec défaut n\'écrit aucun registre', async () => {
    const { registre } = await construire({ hote: '<h1>Bonjour</h1>\n' })
    assert.equal(registre, null)
  })

  it('lint.themeShared ne regarde que les déclarations : deux composants qui lisent le même nom ne le partagent pas', async () => {
    const lecteur = (nom: string) => `<div>${nom}</div>\n<style>\n  :host\n    gap: var(--mjs-ecart, 8px)\n</style>\n`
    const auteur  = (nom: string) => `<div>${nom}</div>\n<style>\n  :host\n    --mjs-pas: 8px\n</style>\n`
    const { registre, avertissements } = await construire({ hote: THEME + '<div>x</div>\n', carte: lecteur('carte'), liste: lecteur('liste'), un: auteur('un'), deux: auteur('deux') })
    assert.deepEqual(lignes(registre!, 'ecart'), ['carte:8px', 'liste:8px'], 'préalable : les deux lectures sont au registre')
    const partages = avertissements.filter((w) => w.endsWith('[lint.themeShared]'))
    assert.equal(partages.length, 1, `un seul rappel (le nom déclaré deux fois) :\n${partages.join('\n')}`)
    assert.match(partages[0], /pas/)
    assert.doesNotMatch(partages[0], /ecart/)
  })

  it('une lecture porte read: true et son lecteur figure dans readBy ; une déclaration n\'a pas le champ', async () => {
    const { registre } = await construire({
      hote: '<theme>\n  $$gap: 12px\n  --mjs-check-size: 30px\n</theme>\n<@@checkbox name="a">A</@@checkbox>\n<@@radio name="c" value="x">C</@@radio>\n'
    })
    const lecture = registre!['check-color'].declarations[0]
    assert.equal(lecture.read, true, 'la lecture se distingue')
    assert.deepEqual(registre!['check-color'].readBy, ['core-checkbox'], 'le lecteur est nommé')
    assert.deepEqual(registre!['check-border'].readBy, ['core-checkbox', 'core-radio'], 'deux lecteurs, triés')
    const declaree = registre!['gap'].declarations[0]
    assert.equal('read' in declaree, false, 'une déclaration ne porte pas le champ')
    const natures = registre!['check-size'].declarations.map((d) => `${d.declaredBy}:${d.read === true ? 'lue' : 'declaree'}`)
    assert.deepEqual(natures, ['core-checkbox:lue', 'core-radio:lue', 'hote:declaree'])
    assert.deepEqual(registre!['check-size'].readBy, ['core-checkbox', 'core-radio'], 'une variable déclarée que des composants lisent a ses lecteurs')
  })

  it('le carrousel et l\'horloge : ce qu\'ils posent eux-mêmes est au registre, marqué posé ; ce qui se règle ne l\'est pas', async () => {
    const { registre } = await construire({ hote: THEME + '<@@carousel></@@carousel>\n<@@clock></@@clock>\n' })
    const noms = Object.keys(registre!).filter((n) => n.startsWith('carousel-') || n.startsWith('clock-')).sort()
    assert.deepEqual(noms, ['carousel-button', 'carousel-o', 'carousel-r', 'carousel-s', 'carousel-shadow', 'carousel-x', 'carousel-z', 'clock-p'])
    for (const nom of ['carousel-o', 'carousel-r', 'carousel-s', 'carousel-x', 'carousel-z', 'clock-p']) {
      assert.ok(registre![nom].declarations.every((d) => d.read === true && d.set === true), `${nom} : les cinq positions du carrousel et la progression de l\'horloge sont posées par les modules`)
    }
    for (const nom of ['carousel-button', 'carousel-shadow']) assert.equal(registre![nom].declarations[0].set, undefined, `${nom} se règle`)
    assert.deepEqual(lignes(registre!, 'carousel-shadow'), ['core-carousel:0 0 50px rgba(0, 0, 0, 0.5)'])
  })

  it('un composant du projet : la variable posée par son script est au registre, marquée posée ; celle qui se règle ne l\'est pas', async () => {
    const carte = [
      '<script>',
      '  place = (el) -> el.style.setProperty(\'--mjs-carte-x\', \'1px\')',
      '</script>',
      '<div>x</div>',
      '<style>',
      '  :host',
      '    transform: translateX(var(--mjs-carte-x, 0px))',
      '    gap: var(--mjs-carte-pad, 4px)',
      '</style>',
      ''
    ].join('\n')
    const { registre } = await construire({ hote: THEME + '<div>x</div>\n', carte })
    assert.equal(registre!['carte-x'].declarations[0].set, true, 'posée par le script')
    assert.deepEqual(lignes(registre!, 'carte-pad'), ['carte:4px'], 'celle-ci se règle')
    assert.equal(registre!['carte-pad'].declarations[0].set, undefined)
  })

  it('un composant du projet : les liaisons et l\'attribut style du gabarit posent aussi, chacune est au registre, marquée posée', async () => {
    const carte = [
      '<div class="a" --mjs-carte-w={\'10px\'} @style.--mjs-carte-z={\'1\'} style="color: red; --mjs-carte-h: 3px">x</div>',
      '<style>',
      '  :host',
      '    width: var(--mjs-carte-w, 1px)',
      '    z-index: var(--mjs-carte-z, 0)',
      '    height: var(--mjs-carte-h, 2px)',
      '    gap: var(--mjs-carte-pad, 4px)',
      '</style>',
      ''
    ].join('\n')
    const { registre } = await construire({ hote: THEME + '<div>x</div>\n', carte })
    for (const nom of ['carte-w', 'carte-z', 'carte-h']) assert.equal(registre![nom].declarations[0].set, true, `${nom} est posée par le gabarit`)
    assert.deepEqual(lignes(registre!, 'carte-pad'), ['carte:4px'])
  })

  it('un composant du projet : une variable que son CSS pose sur un élément interne et qu\'il lit lui-même est au registre, marquée posée', async () => {
    const carte = [
      '<theme>',
      '  $$carte-acc: red',
      '</theme>',
      '<div class="face">x</div>',
      '<style>',
      '  :host',
      '    --mjs-carte-gap: 4px',
      '    gap: var(--mjs-carte-gap, 9px)',
      '  .face',
      '    --mjs-carte-i: 1',
      '    --mjs-carte-pour-enfants: 2px',
      '    rotate: calc(var(--mjs-carte-i, 0) * 90deg)',
      '    color: var(--mjs-carte-acc, blue)',
      '</style>',
      ''
    ].join('\n')
    const { registre } = await construire({ hote: THEME + '<div>x</div>\n', carte })
    assert.equal(registre!['carte-i'].declarations[0].set, true, 'posée sur .face, lue par le composant : posée par le composant')
    assert.deepEqual(lignes(registre!, 'carte-gap'), ['carte:4px'], 'posée sur l\'hôte : elle se règle')
    assert.equal(registre!['carte-gap'].declarations[0].set, undefined)
    assert.deepEqual(lignes(registre!, 'carte-pour-enfants'), ['carte:2px'], 'posée sur un élément interne mais lue par personne ici : elle est pour la descendance')
    assert.equal(registre!['carte-pour-enfants'].declarations[0].set, undefined)
    assert.deepEqual(lignes(registre!, 'carte-acc'), ['carte:red'], 'une déclaration de son bloc <theme> reste, lue ou non')
    assert.ok(registre!['carte-acc'].declarations[0].line > 0, 'elle garde sa ligne')
    assert.equal('read' in registre!['carte-acc'].declarations[0], false, 'c\'est une déclaration, pas une lecture')
  })

  it('une variable posée sur un élément interne reste déclarée pour les avertissements : posée par $$ et lue par $$, elle ne devient pas « lue sans être déclarée »', async () => {
    const carte = [
      '<div class="face">x</div>',
      '<style>',
      '  .face',
      '    $$carte-i: 1',
      '    rotate: calc($$carte-i * 90deg)',
      '    gap: var(--mjs-carte-pad, 4px)',
      '</style>',
      ''
    ].join('\n')
    const { registre, avertissements } = await construire({ hote: THEME + '<div>x</div>\n', carte })
    assert.equal(registre!['carte-i'].declarations[0].set, true, 'posée par le composant : au registre, marquée')
    assert.deepEqual(lignes(registre!, 'carte-pad'), ['carte:4px'], 'celle-ci se règle')
    const inconnues = avertissements.filter((w) => w.endsWith('[lint.themeUnknown]'))
    assert.deepEqual(inconnues, [], 'la déclaration existe : aucun rappel')
  })

  it('un second build sur la même instance (composants en cache) rend le même registre, variables posées comprises', async () => {
    const root   = mjsTmp('registre-lectures-cache')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), THEME + '<@@carousel></@@carousel>\n<@@checkbox name="a">A</@@checkbox>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), stylesheetsDir: join(root, 'styles') })
    const fichier = join(outDir, '.mjs-theme-vars.json')
    await bundler.compile()
    const premier = readFileSync(fichier, 'utf-8')
    rmSync(fichier)
    const stats = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const second = readFileSync(fichier, 'utf-8')
    assert.equal(second, premier, 'registre identique au second tour')
    assert.equal(JSON.parse(second)['carousel-x'].declarations[0].set, true, 'la position posée par le script reste marquée posée')
    assert.ok(JSON.parse(second)['check-size'], 'les lectures restent au registre')
  })
})
