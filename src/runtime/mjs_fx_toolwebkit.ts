// mjs_fx_toolwebkit — le moteur WebKit (*blend, *filter)
//   µ._mjs_fxWebkit   vrai dans WebKit : le fabricant du navigateur (`navigator.vendor`) vaut « Apple Computer, Inc. » dans Safari, Mac
//                     comme iOS, et dans tout navigateur d'iOS (Chrome, Firefox, Edge y sont du WebKit) ; « Google Inc. » dans Chromium,
//                     vide dans Firefox. Un Chromium qui se donne l'agent de Safari reste Chromium, un Safari qui se donne celui de Chrome
//                     reste WebKit : l'agent d'utilisateur ne dit pas quel moteur dessine
// lu au chargement de l'effet : l'outil se pose avant lui, juste après le moteur (bundler/index.ts)
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts)

µ._mjs_fxWebkit = typeof navigator === 'object' && navigator !== null && /Apple/.test(navigator.vendor || '');
