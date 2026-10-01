import { loadSuggestions, SuggestionStore } from './suggestions';

/**
 * The suggestions that ship with the toy: every `src/suggestions/*.json`, bundled at build time.
 * The folder may be empty; the toy then works exactly as before.
 */
const modules = import.meta.glob('./suggestions/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

// Hot reload (dev): a changed, added or removed file re-runs this module; keep ONE store so subscribers stay attached.
const hot = import.meta.hot;
export const suggestionStore: SuggestionStore = (hot?.data.store as SuggestionStore | undefined) ?? new SuggestionStore();
suggestionStore.setAll(loadSuggestions(modules));
if (hot) {
  hot.data.store = suggestionStore;
  hot.accept();
}
