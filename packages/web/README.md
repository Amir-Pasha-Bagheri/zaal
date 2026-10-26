# @zaal/web

The parts of Zaal that assume a **web frontend**, shared by every framework target.

Two things live here, and neither has anything to do with React:

- **`ui.zaal` → plain CSS.** Design tokens as custom properties, light/dark schemes, base element
  rules, and a UI kit whose entries markup reaches with `%name`.
- **`app.zaal` → the project model.** Routes, the page title, the mount node, stylesheets, the
  store nesting order, and npm package pins.

They sit in their own package because they are meaningless to a target that does not compile to
a web page. [`zaal`](https://github.com/YOUR-USERNAME/zaal/tree/main/packages/zaal) is the
language and knows nothing about CSS or routing — it *asks* for these rather than importing
them, so a target compiling to a backend service, or to another language entirely, is not forced
to have a design system or a mount node.

```js
import { parseUI, uiCss, parseApp } from '@zaal/web';

const ui = parseUI(readFileSync('zaal/ui.zaal', 'utf8'));
writeFileSync('ui.css', uiCss(ui));          // plain CSS — no framework involved

const app = parseApp(readFileSync('zaal/app.zaal', 'utf8'));
app.routes;                                  // [{ path, component, lazy }]
```

You don't install this directly — it arrives as a dependency of
[`@zaal/react`](https://github.com/YOUR-USERNAME/zaal/tree/main/packages/react) or any other web
target.

## For a new web target

Hand these to `zaal`'s pipeline on your target object and you inherit the whole design
system and app model for free:

```js
import { parseApp, parseUI, uiCss } from '@zaal/web';

export default { name: 'vue', /* … */ parseApp, parseUI, uiCss };
```
