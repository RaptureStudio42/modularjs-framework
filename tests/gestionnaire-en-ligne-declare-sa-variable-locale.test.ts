// une variable locale posée par un gestionnaire écrit sur une ligne (`@click={-> rang = $l.indexOf(2); $l.splice(rang, 1)}`) n'était
// pas déclarée : le code du composant est en mode strict, l'affecter levait ReferenceError et le clic ne faisait rien ; elle est
// déclarée dans la flèche qui l'affecte. Une variable du `<script>` qu'un gestionnaire affecte reste celle du script. Vraie
// construction (createHarness), clic, rendu lu, aucune globale
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const fichiers: Record<string, string> = {
  'vl-temoin.mjs': ['<script>', '$l = [1, 2, 3]', '</script>', '<p class="v">{$l.join(",")}</p>', '<button class="b" @click={-> $l.splice($l.indexOf(2), 1)}>b</button>'].join('\n'),
  'vl-clic.mjs': ['<script>', '$l = [1, 2, 3]', '</script>', '<p class="v">{$l.join(",")}</p>', '<button class="b" @click={-> rangDuDeux = $l.indexOf(2); $l.splice(rangDuDeux, 1)}>b</button>'].join('\n'),
  // `compteDesClics = compteDesClics + 1` et non `+=` : seule l'affectation simple déclare, c'est elle qui doit garder la variable du script
  'vl-seule.mjs': ['<script>', '$n = 0', '</script>', '<p class="v">{$n}</p>', '<button class="b" @click={-> seuleAffectation = 5}>b</button>'].join('\n'),
  'vl-du-script.mjs': ['<script>', 'compteDesClics = 0', '$n = 0', '</script>', '<p class="v">{$n}</p>', '<button class="b" @click={-> compteDesClics = compteDesClics + 1; $n = compteDesClics}>b</button>'].join('\n'),
}

describe('gestionnaire écrit sur une ligne : sa variable locale est déclarée', function () {
  this.timeout(120000)
  let app: any
  before(async () => {
    const root = mjsTmp('variable-locale-gestionnaire')
    mkdirSync(join(root, 'src'), { recursive: true })
    for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(root, 'src', nom), texte)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    app = await createHarness({ root })
  })
  after(async () => { if (app) await app.destroy() })

  // ce qui a levé pendant le scénario, erreurs dites à la console comprises
  const leves: string[] = []
  // monte `nom`, clique `clics` fois sur `.b`, rend l'élément voulu de l'ombre
  const jouer = async (nom: string, clics: number, lire: (ombre: any) => string): Promise<string> => {
    const garde = console.error
    console.error = (...x: unknown[]) => { leves.push(x.map(String).join(' ').slice(0, 200)) }
    try {
      const c = await app.mount(nom)
      try {
        for (let k = 0; k < clics; k++) {
          try { await c.click('.b') }
          catch (e) { leves.push(String((e as Error).message).slice(0, 200)) }
        }
        return lire(c.el._shadow ?? c.el)
      }
      finally { c.destroy() }
    }
    finally { console.error = garde }
  }
  const texte   = (ombre: any): string => ombre.querySelector('.v').textContent
  const globale = (nom: string): boolean => nom in globalThis || (typeof (globalThis as any).window === 'object' && nom in (globalThis as any).window)

  it('témoin : le même gestionnaire sans variable locale retire l\'élément', async () => { assert.equal(await jouer('vl-temoin', 1, texte), '1,3') })
  it('`@click={-> rangDuDeux = $l.indexOf(2); $l.splice(rangDuDeux, 1)}` retire l\'élément, sans globale', async () => {
    const lu = await jouer('vl-clic', 1, texte)
    assert.equal(lu, '1,3', `le clic n'a rien retiré ; levé : ${leves.join(' | ')}`)
    assert.equal(globale('rangDuDeux'), false, 'la variable locale est devenue une globale : elle n\'est pas déclarée')
  })
  it('`@click={-> seuleAffectation = 5}`, une seule instruction : déclarée dans la flèche, le clic ne lève pas, sans globale', async () => {
    // happy-dom avale l'erreur du clic (aucun effet à lire après une seule affectation) : la déclaration se lit sur le code produit
    const { output } = await transpile(fichiers['vl-seule.mjs'], { moduleName: 'vl-seule' })
    assert.match(output, /=> \{ ?(?:let|var) seuleAffectation\b/, 'la variable de la flèche n\'est pas déclarée')
    const avant = leves.length
    assert.equal(await jouer('vl-seule', 1, texte), '0')
    assert.deepEqual(leves.slice(avant), [], 'le clic a levé : la variable n\'est pas déclarée')
    assert.equal(globale('seuleAffectation'), false, 'la variable locale est devenue une globale : elle n\'est pas déclarée')
  })
  it('une variable du `<script>` affectée par le gestionnaire reste celle du script : deux clics donnent 2', async () => {
    assert.equal(await jouer('vl-du-script', 2, texte), '2', `levé : ${leves.join(' | ')}`)
  })
})
