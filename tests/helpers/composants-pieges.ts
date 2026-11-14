// composants piégés pour les masques du compilateur : `<code>` et `<pre>` cités dans un commentaire écrit dans une chaîne
// d'interpolation, une valeur d'attribut, une `<textarea>`, un `<pre>`, un `<title>` de `<@head>`, le fallback d'un `<@failed>`,
// le corps d'un gestionnaire ou un contenu glissé ; commentaires en cascade ; `<pre>` cité dans un commentaire, fermé dans un autre

export const SCRIPT = '<script>\n$n = 0\n$s = "x"\n</script>\n'

// nom du composant → son gabarit ; l'élément à lire porte la classe `k`
export const PIEGES: Record<string, string> = {
  chaine:       '<p class="k">{"a<!-- voir <code>npm i</code> pour installer -->c"}</p>',
  chainepre:    '<p class="k">{"a<!-- <pre>x</pre> -->c"}</p>',
  cascade:      '<p class="k">{"a<!-- <!-- <code>x</code> --> <pre>y</pre> -->c"}</p>',
  horschaine:   '<p class="k">QQ<!-- <code>x</code> -->ZZ</p>',
  danspre:      '<pre class="k">a<!-- <code>x</code> -->b</pre>',
  precite:      '<!-- <pre> --><p class="k">QQ visible ZZ</p><!-- </pre> -->',
  textarea:     '<textarea class="k">a<!-- <code>x</code> -->c</textarea>',
  attribut:     '<p class="k" title={"a<!-- <code>x</code> -->c"}>t</p>',
  tete:         '<@head>\n<title>a<!-- <code>x</code> -->c</title>\n</@head>\n<p class="k">t</p>',
  echec:        '<@failed err reset>\n<p>{"a<!-- <code>x</code> -->c"}</p>\n</@failed>\n<p class="k">t</p>',
  gestionnaire: '<button class="k" @click={-> $s = "a<!-- <code>x</code> -->c"}>{$s}</button>',
  glisse:       '<mjs-hote><p class="k">{"a<!-- <code>x</code> -->c"}</p></mjs-hote>',
}

// composant qui reçoit le contenu glissé
export const HOTE = '<div class="boite"><@slot/></div>\n'

const NUL   = String.fromCharCode(0)
const BARRE = String.fromCharCode(92)

// caractères NUL d'un texte, bruts ou échappés
export const nuls = (texte: string): number => texte.split(NUL).length + texte.split(BARRE + 'u0000').length + texte.split(BARRE + 'x00').length - 3

// extrait autour du premier NUL, brut ou échappé
export function autour(texte: string): string {
  const i = [texte.indexOf(NUL), texte.indexOf(BARRE + 'u0000'), texte.indexOf(BARRE + 'x00')].filter((n) => n >= 0).sort((a, b) => a - b)[0] ?? 0
  return JSON.stringify(texte.slice(Math.max(0, i - 60), i + 40))
}

// extrait qui commence à une clé
export function vers(texte: string, cle: string): string {
  const i = texte.indexOf(cle)
  return JSON.stringify(i < 0 ? cle + ' absent' : texte.slice(i, i + 90))
}
