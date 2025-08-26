// src/platforms/web/client/src/sandbox/window/versionSelector.js
// Shared version selector dropdown used by ToolWindow & SpellWindow.
// Accepts a windowInstance that exposes `outputVersions`, `currentVersionIndex`,
// `parameterMappings`, `applyParameterMappingsToInputs`, `setOutput`, etc.

export default function createVersionSelector(windowInstance) {
  const container = document.createElement('div');
  container.className = 'version-selector';
  container.style.position = 'relative';
  container.style.marginLeft = '4px';

  const btn = document.createElement('button');
  btn.className = 'version-button';

  const dropdown = document.createElement('div');
  dropdown.className = 'version-dropdown';
  Object.assign(dropdown.style, {
    position: 'absolute', top: '100%', left: '0', background: '#fff', border: '1px solid #ccc', display: 'none',
    minWidth: '80px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', padding: '4px 0', zIndex: 1000,
  });

  function refresh() {
    dropdown.innerHTML = '';
    const versions = windowInstance.outputVersions || [];
    versions.forEach((vObj, idx) => {
      const item = document.createElement('div');
      item.className = 'version-item';
      item.textContent = vObj && vObj._pending ? `v${idx + 1}*` : `v${idx + 1}`;
      Object.assign(item.style, { padding: '4px 8px', cursor: 'pointer', whiteSpace: 'nowrap', color: '#000' });
      item.addEventListener('click', () => {
        windowInstance.currentVersionIndex = idx;
        if (vObj && vObj.params) {
          windowInstance.parameterMappings = JSON.parse(JSON.stringify(vObj.params));
          windowInstance.applyParameterMappingsToInputs?.();
        }
        if (vObj && vObj.output) {
          windowInstance.setOutput?.(vObj.output);
        }
        dropdown.style.display = 'none';
        refresh();
      });
      dropdown.appendChild(item);
    });

    if (versions.length) {
      const curIdx = windowInstance.currentVersionIndex >= 0 ? windowInstance.currentVersionIndex : versions.length - 1;
      const curObj = versions[curIdx];
      btn.textContent = curObj && curObj._pending ? `v${curIdx + 1}*` : `v${curIdx + 1}`;
      btn.style.display = 'inline-block';
    } else {
      btn.style.display = 'none';
    }
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  });
  btn.refreshDropdown = refresh;

  container.append(btn, dropdown);
  refresh();
  return container;
}
