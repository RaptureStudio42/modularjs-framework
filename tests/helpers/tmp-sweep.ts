// crochet commun des séries de tests, chargé par --require (script/test-enclos.sh, `npm run test:brut`) : relevé des tests, filtre
// des moteurs, fenêtres happy-dom, et dossier temporaire de la série. Root hook Mocha : actif uniquement là où ce fichier est chargé
// via --require ; absent de l'invocation → aucun effet, aucune erreur.
// Chaque série travaille dans son propre dossier temporaire, retiré à la fin, et ne touche à rien d'autre du TMPDIR reçu : sous le
// bac à sable, toutes les conversations partagent ce TMPDIR, et un balai qui y effaçait les mjs-* apparus pendant la série, quel qu'en
// soit le propriétaire, a vidé le dossier de travail d'une construction d'appli en cours. test-enclos.sh crée ce dossier et le retire ;
// sans lui, la série prend le sien ici. sweepRegistered() rend en fin de série les dossiers de mjsTmp() dont le after() local aurait
// été sauté (ex. --bail)

import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { sweepRegistered } from './tmp.js'
import { closeFinishedFiles, countFinishedTest } from './happy-dom-fermeture.js'   //close() réel des fenêtres happy-dom des tests, et filet de fin de fichier
import { installTestTrace, flushTestTrace } from './test-trace.js'                //relevé : ce que chaque fichier de test lit vraiment, sa durée, ses rouges
import { installEngineFilter, engineFilterReport } from './engine-filter.js'     //MJS_MOTEURS : les seuls moteurs que les tests lancent

// DOSSIER DE LA SÉRIE. test-enclos.sh l'a créé et l'annonce : MJS_TEST_RUN_DIR égal au TMPDIR reçu. Sinon (npm run test:brut, mocha
// enfant à qui un test donne son propre TMPDIR), la série prend le sien dès le chargement, avant les fichiers de test, sous le TMPDIR
// reçu ou sous /tmp quand la socket de tsx n'y tiendrait pas (107 octets au plus, cf. test-enclos.sh) ; ses enfants en héritent par
// TMPDIR. Retiré à la sortie du processus, afterAll sauté compris ; une mort par signal le laisse. tsx, chargé avant ce crochet, garde
// son cache sous le TMPDIR reçu
const RECEIVED_TMP = tmpdir()
const GIVEN_RUN    = process.env.MJS_TEST_RUN_DIR

function takeRunDir(): void {
  const parent = Buffer.byteLength(join(RECEIVED_TMP, 'tests-XXXXXX', `tsx-${process.getuid?.() ?? 0}`, '4194304.pipe')) > 107 ? '/tmp' : RECEIVED_TMP
  const dir    = mkdtempSync(join(parent, 'tests-'))
  process.env.TMPDIR           = dir
  process.env.MJS_TEST_RUN_DIR = dir
  process.once('exit', () => {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 2 }) }
    catch (e: any) { console.log(`⚠  dossier de la série ${dir} non retiré : ${e?.message ?? e}`) }
  })
}

if(!GIVEN_RUN || resolve(GIVEN_RUN) !== resolve(RECEIVED_TMP)) takeRunDir()

installTestTrace()
await installEngineFilter()

export const mochaHooks = {
  beforeEach: closeFinishedFiles,
  afterEach:  countFinishedTest,
  afterAll(this: Mocha.Context) {
    // rendre les dossiers de mjsTmp() peut passer les 2 s que mocha laisse à un crochet, sous la charge
    this.timeout(120000)
    flushTestTrace(true)
    const engines = engineFilterReport()
    if (engines) console.log(engines)
    sweepRegistered()
  },
}
