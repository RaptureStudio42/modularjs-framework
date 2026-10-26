// bundler/fx-tools — les outils partagés des effets (runtime/mjs_fx_tool<nom>.ts, clés `fx_tool<nom>`) : un fichier par outil, embarqué
// seulement avec un effet qui s'en sert. Une petite appli sans effet n'en porte aucun ; une appli qui pose un effet n'en porte que ce que
// le code de cet effet nomme, TEL QU'IL PART dans le build (le fichier trié en production, entier en développement : cf. fx-sections.ts) ;
// la garde de cadence (`fx_toolgauge`) ne vient qu'avec un effet lourd ; la reprise du décor (`fx_toolkeep`), qu'avec un effet qui pose un décor dans sa balise.
// Le calque de texte (`fx_tooltext`) ne vient qu'avec un effet qui travaille le texte de sa balise. Les aides communes de quelques effets
// (le moteur WebKit `fx_toolwebkit`, la couleur lue sur la balise `fx_toolcolor`, la reprise après un chargement de police `fx_toolfonts`,
// le libellé dans la langue de la page `fx_toollabel`, la cadence des effets qui se répètent et leur horloge commune `fx_toolbeat`) ne viennent
// qu'avec ceux qui s'en servent : une appli à un seul effet sans rapport n'en paie rien.
// Chaque entrée de FX_TOOLS dit quels effets s'en servent (clés `fx_<nom>`), quels autres outils elle demande (`needs`) et ce qui, dans le
// source d'un effet, dit qu'il s'en sert (`uses`) : la MENTION du nom de l'outil, appelé à la lettre ou non. Le build lit `uses` sur le code
// émis (fxToolsCalled) : la liste des effets ne sert qu'à un fichier d'effet illisible, et le test bundler-outils-effets la tient juste (il
// réclame chaque effet qui cite un outil, et la liste exacte des effets lourds). Une garde du build (fxToolsMissing) refuse un cœur dont un
// module cite un outil absent.
import { blankNonCode } from './minify.js'

// l'expression d'une mention : l'un des noms, entier (ni début ni fin d'un autre : `_mjs_fxLag` n'est pas `_mjs_fxLagSetting`). Aucun appel
// n'est exigé : un alias (`var f = µ._mjs_fxRoots`), les crochets (`µ['_mjs_fxRoots']`), `.call` et `.apply`, une espace avant la parenthèse
// ou `?.(` nomment l'outil sans l'appeler à la lettre, et l'outil n'en est pas moins nécessaire (« is not a function » sinon, build vert).
// La garde de cadence se lit dans la déclaration `heavy` d'un effet lourd (le moteur lit `def.heavy` et appelle alors la garde, qu'il ne nomme
// que derrière `if (µ._mjs_fxGauge)`), ou dans son nom. La reprise du décor se lit dans la déclaration `decor: true` d'un effet qui pose un calque dans sa balise
// (le moteur appelle alors l'outil à la place de `setup`, derrière `µ._mjs_fxKeep ?`)
// L'outil du texte se lit dans l'appel de l'un des noms qu'il définit : le calque (`µ._mjs_fxLayer`, `µ._mjs_fxSplit`), les lettres (`µ._mjs_fxLetters`, `µ._mjs_fxRanks`,
// `µ._mjs_fxOrderCss`) et la place d'un nombre (`µ._mjs_fxNumWidth`) : le moteur n'en appelle aucun
const mention = (...names: string[]): RegExp => new RegExp('(?<![\\w$])(?:' + names.join('|') + ')(?![\\w$])')

export const FX_TOOLS: Record<string, { effects: string[], needs: string[], uses: RegExp }> = {
  fx_toolup:       { effects: ['fx_marquee', 'fx_pile', 'fx_pointer', 'fx_sticky', 'fx_travel', 'fx_velocity'], needs: [], uses: mention('_mjs_fxParent', '_mjs_fxWithin') },
  fx_toolroots:    { effects: ['fx_marquee', 'fx_travel', 'fx_velocity'], needs: [], uses: mention('_mjs_fxRoots') },
  fx_toolbox:      { effects: ['fx_pointer', 'fx_spotlight'], needs: [], uses: mention('_mjs_fxBox') },
  fx_toolwatch:    { effects: ['fx_pile', 'fx_pointer', 'fx_spotlight', 'fx_sticky'], needs: ['fx_toolroots'], uses: mention('_mjs_fxWatch') },
  fx_toollag:      { effects: ['fx_pointer', 'fx_spotlight'], needs: [], uses: mention('_mjs_fxLag') },
  fx_toolsmooth:   { effects: ['fx_filter', 'fx_spotlight'], needs: [], uses: mention('_mjs_fxLagSetting') },
  fx_toolregister: { effects: ['fx_pile', 'fx_pointer', 'fx_stagger', 'fx_sticky', 'fx_velocity'], needs: [], uses: mention('_mjs_fxRegister') },
  fx_toolvisible:  { effects: ['fx_gallery', 'fx_pile', 'fx_sprite', 'fx_velocity'], needs: [], uses: mention('_mjs_fxVisible') },
  fx_toolsplit:    { effects: [], needs: [], uses: mention('_mjs_fxCssList') },
  fx_toolsvg:      { effects: ['fx_filter', 'fx_liquid'], needs: [], uses: mention('_mjs_fxSvgDefs') },
  fx_toolscroll:   { effects: ['fx_gallery', 'fx_goo', 'fx_path', 'fx_scrub', 'fx_stagger'], needs: ['fx_toolup', 'fx_toolroots'], uses: mention('_mjs_fxScroll') },
  fx_toolgauge:    { effects: ['fx_crt', 'fx_fluid', 'fx_goo', 'fx_mesh', 'fx_noise', 'fx_particles', 'fx_smoke', 'fx_sparkles'], needs: [], uses: mention('_mjs_fxGauge', 'heavy') },
  fx_tooltext:     { effects: ['fx_bounce', 'fx_circular', 'fx_count', 'fx_cycle', 'fx_delta', 'fx_marquee', 'fx_rainbow', 'fx_scramble', 'fx_stagger', 'fx_wave', 'fx_weight'], needs: [], uses: mention('_mjs_fxLayer', '_mjs_fxSplit', '_mjs_fxLetters', '_mjs_fxRanks', '_mjs_fxOrderCss', '_mjs_fxNumWidth') },
  fx_toolkeep:     { effects: ['fx_annotate', 'fx_beam', 'fx_behind', 'fx_crt', 'fx_fluid', 'fx_gauge', 'fx_goo', 'fx_grid', 'fx_loader', 'fx_matrix', 'fx_mesh', 'fx_offline', 'fx_particles', 'fx_peel', 'fx_pixels', 'fx_scratch', 'fx_scrollprogress', 'fx_skeleton', 'fx_smoke', 'fx_sparkles', 'fx_spoiler'], needs: [], uses: mention('_mjs_fxKeep', 'decor') },
  fx_toolwebkit:   { effects: ['fx_blend', 'fx_filter'], needs: [], uses: mention('_mjs_fxWebkit') },
  fx_toolcolor:    { effects: ['fx_blend', 'fx_filter'], needs: [], uses: mention('_mjs_fxColorOn') },
  fx_toolfonts:    { effects: ['fx_annotate', 'fx_delta', 'fx_weight'], needs: [], uses: mention('_mjs_fxOnFonts') },
  fx_toollabel:    { effects: ['fx_flipcard', 'fx_guard', 'fx_loader', 'fx_offline', 'fx_spoiler'], needs: [], uses: mention('_mjs_fxLabel', '_mjs_fxLabelKeep') },
  fx_toolbeat:     { effects: ['fx_annotate', 'fx_attention', 'fx_glitch', 'fx_shine'], needs: [], uses: mention('_mjs_fxEvery', '_mjs_fxBeat') }
}

// les clés des outils, dans l'ordre où leurs fichiers se posent dans le cœur
export const FX_TOOL_KEYS = Object.keys(FX_TOOLS)

// les outils que le code d'un module nomme (`uses`), commentaires, regex et chaînes de données mis de côté par blankNonCode comme pour le contrat
// du cœur (core-contract.ts) : une phrase qui cite un outil n'en réclame pas l'embarquement. Restent lus comme du code les expressions `${…}`, le
// TEXTE d'un gabarit (sans quoi `` µ[`_mjs_fxRoots`] `` échapperait) et toute chaîne qui est un nom interne `_mjs_…` ou une clé d'accès par crochets
// (`µ['_mjs_fxRoots']`) : une mention dans un gabarit compte, au pire un outil de trop, jamais un outil qui manque. Un nom bâti à l'exécution
// (`'_mjs_fx' + n`) n'est pas un nom : la réduction du build le refuse déjà (assertNoStringIndexedMjsAccess, minify.ts). `text` : un fichier
// d'effet tel qu'il part dans le build, ou un fichier d'outil
export function fxToolsCalled(text: string, tools: typeof FX_TOOLS = FX_TOOLS): Set<string> {
  const code = blankNonCode(text)
  return new Set(Object.keys(tools).filter((key) => tools[key].uses.test(code)))
}

// les outils qu'une liste d'effets réclame, avec ceux que ces outils réclament à leur tour ; `wants(clé)` dit si l'effet `fx_<nom>` est
// dans la page ; `asked` : les outils demandés par leur nom (`runtime: ['fx_toolbox']`), eux aussi avec ce qu'ils réclament ; `called` : les
// outils que le code émis des effets de la page appelle (fxToolsCalled, lu par le bundler) — donné, il fait foi à la place de la liste des
// effets de chaque outil : un effet n'apporte que les outils que son fichier, trié, appelle encore
export function fxToolsWanted(wants: (key: string) => boolean, tools: typeof FX_TOOLS = FX_TOOLS, asked: string[] = [], called?: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  const add = (key: string): void => {
    if (out.has(key)) return
    out.add(key)
    for (const n of tools[key]?.needs ?? []) add(n)
  }
  for (const key of Object.keys(tools)) {
    if (asked.includes(key) || (called ? called.has(key) : tools[key].effects.some(wants))) add(key)
  }
  return out
}

// les outils que des modules nomment sans qu'ils soient embarqués (`present`), chacun avec les modules qui le nomment, triés pour un
// message stable d'un build à l'autre ; `modules` : [nom du fichier runtime, son texte tel qu'il part dans le build]. Un outil ne se
// réclame pas lui-même. Garde du build : un outil absent donnerait « is not a function » à la première pose de l'effet (la garde de cadence
// seule manquerait sans bruit : le moteur ne l'appelle que si elle est là)
export function fxToolsMissing(modules: ReadonlyArray<readonly [string, string]>, present: Iterable<string>, tools: typeof FX_TOOLS = FX_TOOLS): Array<{ tool: string, files: string[] }> {
  const here = new Set(present)
  const lack = new Map<string, string[]>()
  for (const [file, text] of modules) {
    for (const key of fxToolsCalled(text, tools)) {
      if (here.has(key) || file === 'mjs_' + key + '.ts') continue
      lack.set(key, [...(lack.get(key) ?? []), file])
    }
  }
  return [...lack].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([tool, files]) => ({ tool, files: files.sort() }))
}
