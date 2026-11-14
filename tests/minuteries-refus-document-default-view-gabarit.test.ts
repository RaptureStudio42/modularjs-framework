// setTimeout / setInterval lus sur l'objet global par le document (`document['default' + 'View']`, le `ownerDocument` d'un
// nœud) : le nom de l'objet global n'y est jamais écrit d'un seul tenant ; refusés dans une accolade du gabarit
// (interpolation, attribut lié, condition) comme dans le <script> et un gestionnaire ; une lecture du document sans
// minuterie reste libre
import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const S  = (...l: string[]) => ['<p>{$x}</p>', '<script lang="coffee">', '$x = 0', ...l, '</script>'].join('\n')
const G  = (gabarit: string, ...l: string[]) => [gabarit, '<script lang="coffee">', '$x = 0', ...l, '</script>'].join('\n')
const DV = "document['default' + 'View']"

const verdict = async (src: string): Promise<string> => {
  try {
    await transpile(src, { moduleName: 'essai' })
    return 'accepté'
  }
  catch (e: any) {
    const m = String(e?.message ?? e)
    if (/refusé dans un composant/.test(m)) return 'refusé : script'
    if (/refusé dans une accolade du gabarit/.test(m)) return 'refusé : gabarit'
    return 'autre erreur : ' + m.split('\n').slice(0, 3).join(' ')
  }
}

const CAS: [string, string, string][] = [
  ["interpolation : document['default' + 'View']['set' + 'Timeout']", 'refusé : gabarit', G(`<p>{${DV}['set' + 'Timeout']((-> $x = 1), 10)}</p>`)],
  ["interpolation : el.ownerDocument['default' + 'View']['set' + 'Interval']", 'refusé : gabarit', G("<p>{el.ownerDocument['default' + 'View']['set' + 'Interval']((-> $x = 1), 10)}</p>")],
  ['attribut lié', 'refusé : gabarit', G(`<p title={${DV}['set' + 'Timeout']((-> $x = 1), 10)}>a</p>`)],
  ['condition', 'refusé : gabarit', G(`{if ${DV}['set' + 'Timeout']((-> $x = 1), 10)}<p>a</p>{end}`)],
  ['<script>', 'refusé : script', S(`${DV}['set' + 'Timeout'] (-> $x = 1), 10`)],
  ['gestionnaire', 'refusé', G(`<button @click={-> ${DV}['set' + 'Timeout']((-> $x = 1), 10)}>a</button>`)],
  ["lecture du document sans minuterie : document['title'], ['inner' + 'Width']", 'accepté', G(`<p title={document['title']}>{${DV}['inner' + 'Width']}</p>`)],
  ["membre lu par une chaîne, sans objet global : $t['cle']", 'accepté', G("<p>{$t['cle']}</p>", '$t = { cle: 1 }')],
]

describe('minuterie lue par le document : refusée dans le gabarit comme dans le script', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const [nom, attendu, src] of CAS) {
    it(`${nom} — ${attendu}`, async () => {
      const v = await verdict(src)
      assert.ok(v.startsWith(attendu), `${nom} : attendu « ${attendu} », obtenu « ${v} »`)
    })
  }
})
