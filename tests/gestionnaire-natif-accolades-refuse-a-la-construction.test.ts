// un gestionnaire natif `on…="…"` dont le texte porte une accolade (`onclick="if (ok) { f() }"`) n'est plus rendu vide sans un mot : dans une valeur
// d'attribut, une accolade ouvre une expression, et le filtre des attributs ne pose jamais un `on…` calculé — la construction le refuse, avec le
// fichier, la ligne et la forme à écrire (`@click={…}`), en français et en anglais ; un `on…` sans accolade reste posé tel quel — vraie construction
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { setMessagesLang } from '../src/messages/index.js'

// construit un projet d'un seul composant ; rend le message du refus, ou '' quand la construction passe (le harnais est alors rendu)
const construire = async (nom: string, texte: string, langue?: string): Promise<{ refus: string, app: any }> => {
  const root = mjsTmp('gestionnaire-natif-accolades')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', nom), texte)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...(langue ? { lang: langue } : {}) }, null, 2))
  try { return { refus: '', app: await createHarness({ root }) } }
  catch (e) { return { refus: String((e as Error).message), app: null } }
}

describe('gestionnaire natif on…="…" avec une accolade : refusé à la construction', function () {
  this.timeout(200000)
  // le projet en anglais règle la langue des messages pour tout le processus : rendue au français, les fichiers suivants la lisent
  afterEach(() => { setMessagesLang('fr') })

  it('onclick="if (window.ok) { window.vu = 1 }" : refus qui cite le fichier, la ligne et la forme @click={…}', async () => {
    const { refus, app } = await construire('n-accolade.mjs', '<p>t</p>\n<button class="v" onclick="if (window.ok) { window.vu = 1 }">b</button>\n')
    if (app) await app.destroy()
    assert.match(refus, /n-accolade/)
    assert.match(refus, /ligne 2/)
    assert.match(refus, /onclick/)
    assert.match(refus, /@click=\{…\}/)
  })

  it('témoin : onclick sans accolade reste posé tel quel', async () => {
    const { refus, app } = await construire('n-simple.mjs', '<button class="v" onclick="window.vu = 1">b</button>\n')
    assert.equal(refus, '')
    try {
      const c = await app.mount('n-simple')
      assert.equal(c.find('.v').getAttribute('onclick'), 'window.vu = 1')
      c.destroy()
    }
    finally { await app.destroy() }
  })

  it('projet en anglais : le même refus, en anglais', async () => {
    const { refus, app } = await construire('n-anglais.mjs', '<p>t</p>\n<button class="v" oninput="if (window.ok) { window.vu = 1 }">b</button>\n', 'en')
    if (app) await app.destroy()
    assert.match(refus, /n-anglais/)
    assert.match(refus, /line 2/)
    assert.match(refus, /@input=\{…\}/)
  })

  it('projet en anglais : un nom en on… hors de la liste des événements (one={$x}) — le refus donne les deux voies, @…={…} sans nom d\'événement, ou un nom data-…', async () => {
    const { refus, app } = await construire('n-nom.mjs', '<p>t</p>\n<div class="v" one={$x}>t</div>\n<script>\n  $x = 1\n</script>\n', 'en')
    if (app) await app.destroy()
    assert.match(refus, /n-nom/)
    assert.match(refus, /line 2/)
    assert.match(refus, /if it is an event, write it as "@…=\{…\}", with the name of the event after "@"; otherwise, rename it \("data-one"/)
    // aucun nom d'événement tiré du nom de l'attribut (one → « e »)
    assert.doesNotMatch(refus, /@e=\{/)
  })

  it('un vrai événement : de la liste (onfullscreenchange), le refus donne @fullscreenchange={…} ; hors de la liste (onencrypted), il n\'affirme rien et donne les deux voies, @…={…} sans nom d\'événement, ou un nom data-…', async () => {
    // plein écran : un événement de la liste, la forme à écrire est sûre, sans les deux voies ; encrypted : un vrai événement que la
    // liste ne compte pas, aucun nom d'événement tiré du nom de l'attribut
    const cas: [string, string, string, RegExp, RegExp][] = [
      ['n-plein-ecran.mjs', 'div', 'fullscreenchange', /Écrivez-le « @fullscreenchange=\{…\} », avec le code à exécuter/, /@…=\{…\}/],
      ['n-chiffre.mjs', 'video', 'encrypted', /si c'est un événement, écrivez-le « @…=\{…\} », avec le nom de l'événement après « @ » ; sinon, renommez-le \(« data-onencrypted »/, /@encrypted=\{/]
    ]
    for (const [nom, balise, evt, forme, absente] of cas) {
      const { refus, app } = await construire(nom, `<${balise} class="v" on${evt}={$x}></${balise}>\n<script>\n  $x = 1\n</script>\n`)
      if (app) await app.destroy()
      assert.match(refus, forme, evt)
      assert.doesNotMatch(refus, absente, evt)
      assert.doesNotMatch(refus, /n'est pas un gestionnaire/, evt)
    }
  })
})
