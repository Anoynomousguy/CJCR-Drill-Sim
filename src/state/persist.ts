import { useStore } from './store';

export async function savePlan(saveAs = false): Promise<void> {
  const { plan, filePath, markSaved, notify } = useStore.getState();
  const json = JSON.stringify(plan, null, 2);
  try {
    if (window.desktop) {
      const result = await window.desktop.savePlan({ json, path: saveAs ? null : filePath });
      if (result.canceled) return;
      markSaved(result.path ?? null);
      notify('Programme saved');
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${plan.name.trim() || 'cjcr-programme'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    markSaved(null);
    notify('Programme downloaded');
  } catch (error) {
    notify(`Could not save: ${(error as Error).message}`);
  }
}

export async function openPlan(): Promise<void> {
  try {
    if (window.desktop) {
      const result = await window.desktop.openPlan();
      if (result.canceled || !result.json) return;
      const plan = JSON.parse(result.json);
      useStore.getState().loadPlan(plan, result.path ?? null);
      useStore.getState().notify('Programme opened');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      useStore.getState().loadPlan(JSON.parse(text), null);
      useStore.getState().notify('Programme opened');
    };
    input.click();
  } catch (error) {
    useStore.getState().notify(`Could not open: ${(error as Error).message}`);
  }
}
