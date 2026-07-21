// Bounded selection + panel state — MOO-67 Commit 4C.
//
// Covers exactly the state the repository view's selection and detail
// panel need: the selected graph node, its blast-radius companion (they
// were already cleared together at every call site that reset selection —
// this hook doesn't newly couple them, it just names the coupling that
// already existed), the active panel tab, and any drill-down within that
// tab. Deliberately does NOT cover unrelated App() state — graph-config
// panel visibility, right-panel resize width, folder filter, loading/
// error/fetch state, theme, or anything architecture/security-specific —
// see docs/baseline.md for the full "don't migrate" list this respects.
//
// `React` is read as an ambient global (window.React, set by the CDN UMD
// bundle index.html already loads) rather than imported — same pattern
// src/analyzer.js and src/render/repositoryGraph.js use for their globals.
/* eslint-disable no-undef */

export function useRepositorySelection() {
  const [selected, setSelected] = React.useState(null);
  const [blastRadius, setBlastRadius] = React.useState(null);
  const [rightTab, setRightTab] = React.useState('details');
  // {type:'issue'|'pattern'|'security'|'suggestion'|'duplicate', data:...}
  const [drillDown, setDrillDown] = React.useState(null);

  const clearSelection = React.useCallback(() => {
    setSelected(null);
    setBlastRadius(null);
  }, []);

  const selectTab = React.useCallback((tab) => {
    setRightTab(tab);
    setDrillDown(null);
  }, []);

  return {
    selected, setSelected,
    blastRadius, setBlastRadius,
    rightTab, setRightTab,
    drillDown, setDrillDown,
    clearSelection,
    selectTab,
  };
}
