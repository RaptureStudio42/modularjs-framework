// Une page routée prérendue à la construction, puis reprise dans le navigateur : vue ordinaire, vue sous un {if}, et le cas
// `{if $user}<@view root>{else}<@login-form>{end}` (cf. helpers/vue-rendue-au-serveur.ts). Chromium, Firefox et WebKit réels,
// développement et production.

import { decrireRepriseServeur } from './helpers/vue-rendue-au-serveur.js'

decrireRepriseServeur('routeur : vue prérendue puis reprise — dans de vrais navigateurs', ['prerender'])
