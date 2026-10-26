// @zaal/web — the parts of Zaal that assume a *web frontend*, shared by every framework target.
//
// `ui.zaal` is a design system compiled to plain CSS; `app.zaal` declares routes, a title, a
// mount node and package pins. Neither has anything to do with React, and both would be
// meaningless to a target that compiles to a backend service or to another language — which is
// why they live here rather than in @zaal/core.
export { parseUI, uiCss, PROP, tokenRef } from './ui.mjs';
export { parseApp, storeOrder } from './app.mjs';
