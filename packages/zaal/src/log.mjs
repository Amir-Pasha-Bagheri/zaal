// What the CLI and the watcher print.

const warn = list => { for (const w of list || []) console.error(`  warn  ${w}`); };

// `, 2 packages (canvas-confetti@1.9.3, framer-motion@latest)`
const pkgLine = pkgs => pkgs?.size
  ? `, ${pkgs.size} package${pkgs.size > 1 ? 's' : ''} (`
    + [...pkgs].map(([id, p]) => p.css ? id : `${id}@${p.version || 'latest'}`).join(', ') + ')'
  : '';

export { warn, pkgLine };
