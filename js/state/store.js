import * as storage from './storage.js';

class Store {
  constructor(initialState) {
    this.state = initialState;
    this.listeners = new Set();
  }

  getState() {
    return this.state;
  }

  setState(partial) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => listener(this.state));
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const store = new Store({
  lists: storage.loadLists(),
  activeListId: storage.loadActiveListId(),
  settings: storage.loadSettings(),
  voiceStatus: 'idle', // idle | listening | processing | error
  transcript: '',
});

export function getActiveList() {
  const { lists, activeListId } = store.getState();
  return lists.find((list) => list.id === activeListId) || null;
}

export function persistLists(lists) {
  storage.saveLists(lists);
  store.setState({ lists });
}

export function persistActiveListId(id) {
  storage.saveActiveListId(id);
  store.setState({ activeListId: id });
}

export function persistSettings(settings) {
  storage.saveSettings(settings);
  store.setState({ settings });
}
