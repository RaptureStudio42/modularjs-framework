// le `name` qu'écrit l'auteur sur les cases d'un groupe `:group=!{…}` est celui que le formulaire envoie : calculé par ligne dans un
// {for} (`name="reponse[{q.id}]"`, `name={…}`), ou écrit après `:group` à la racine — vraie construction, formulaire envoyé à un
// serveur de test qui lit ce qu'il reçoit ; un `name` fixe dans un {for} reste distingué par ligne (les lignes ne se décochent pas)
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const fichiers: Record<string, string> = {
  'g-radio.mjs': `<form class="f" action="/envoi" method="post">{for q in $qs by id}<p><input aria-label="oui" type="radio" name="reponse[{q.id}]" :group=!{q.rep} value="oui"><input aria-label="non" type="radio" name="reponse[{q.id}]" :group=!{q.rep} value="non"></p>{end}</form>\n<script>\n  $qs = [{ id: 7, rep: 'non' }, { id: 9, rep: 'oui' }]\n</script>\n`,
  'g-case.mjs': `<form class="f" action="/envoi" method="post">{for q in $qs by id}<p><input aria-label="a" type="checkbox" name={'tags[' + q.id + '][]'} :group=!{q.tags} value="a"><input aria-label="b" type="checkbox" name={'tags[' + q.id + '][]'} :group=!{q.tags} value="b"></p>{end}</form>\n<script>\n  $qs = [{ id: 7, tags: ['b'] }]\n</script>\n`,
  'g-ordre.mjs': `<form class="f" action="/envoi" method="post"><input aria-label="oui" type="radio" :group=!{$rep} name="choix" value="oui"><input aria-label="non" type="radio" :group=!{$rep} name="choix" value="non"></form>\n<script>\n  $rep = 'non'\n</script>\n`,
  'g-fixe.mjs': `<form class="f" action="/envoi" method="post">{for q in $qs by id}<p><input aria-label="oui" type="radio" name="rep" :group=!{q.rep} value="oui"><input aria-label="non" type="radio" name="rep" :group=!{q.rep} value="non"></p>{end}</form>\n<script>\n  $qs = [{ id: 7, rep: 'non' }, { id: 9, rep: 'oui' }]\n</script>\n`
}

describe('groupe :group=!{…} : le name de l\'auteur est celui que le formulaire envoie', function () {
  this.timeout(200000)
  let app: any
  let serveur: Server
  let adresse = ''
  before(async () => {
    // le serveur de test rend ce qu'il a lu dans le corps de l'envoi, comme un formulaire natif l'envoie (application/x-www-form-urlencoded)
    serveur = createServer((req, res) => {
      let corps = ''
      req.on('data', (morceau) => corps += morceau)
      req.on('end', () => res.end(JSON.stringify([...new URLSearchParams(corps).entries()])))
    })
    await new Promise<void>((pret) => serveur.listen(0, '127.0.0.1', pret))
    adresse = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/envoi`
    const root = mjsTmp('groupe-name-auteur')
    mkdirSync(join(root, 'src'), { recursive: true })
    for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(root, 'src', nom), texte)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    app = await createHarness({ root })
  })
  after(async () => {
    if (app) await app.destroy()
    if (serveur) await new Promise((fini) => serveur.close(fini))
  })

  // les paires du formulaire, envoyées au serveur de test ; rend ce qu'il a reçu
  const envoyer = async (c: any): Promise<string> => {
    const paires = [...new app.window.FormData(c.find('.f')).entries()].map(([k, v]: [string, unknown]) => [k, String(v)])
    const reponse = await fetch(adresse, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(paires).toString() })
    return await reponse.text()
  }

  const envoi = async (nom: string): Promise<string> => {
    const c = await app.mount(nom)
    try {
      await c.tick()
      return await envoyer(c)
    }
    finally { c.destroy() }
  }

  it('boutons radio d\'une ligne, name="reponse[{q.id}]" : le serveur reçoit reponse[7] et reponse[9], puis le choix fait à la souris', async () => {
    const c = await app.mount('g-radio')
    try {
      await c.tick()
      const lu = [await envoyer(c)]
      c.findAll('input')[0].click()
      await c.tick()
      lu.push(await envoyer(c))
      assert.deepEqual(lu, ['[["reponse[7]","non"],["reponse[9]","oui"]]', '[["reponse[7]","oui"],["reponse[9]","oui"]]'])
    }
    finally { c.destroy() }
  })

  it('cases d\'une ligne, name={…} : le serveur reçoit tags[7][]', async () => {
    assert.equal(await envoi('g-case'), '[["tags[7][]","b"]]')
  })

  it('à la racine, :group écrit avant name="choix" : le serveur reçoit choix', async () => {
    assert.equal(await envoi('g-ordre'), '[["choix","non"]]')
  })

  it('témoin : un name fixe, le même sur toutes les lignes, reste distingué par ligne (les lignes ne se décochent pas)', async () => {
    const c = await app.mount('g-fixe')
    try {
      await c.tick()
      const noms = c.findAll('input').map((i: any) => i.name)
      assert.equal(noms[0], noms[1])
      assert.notEqual(noms[0], noms[2])
      assert.deepEqual(c.findAll('input').map((i: any) => i.checked), [false, true, true, false])
    }
    finally { c.destroy() }
  })
})
