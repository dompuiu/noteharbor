const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('noteHarborDesktop', {
  getScrapeBrowserStatus: () => ipcRenderer.invoke('note-harbor:get-scrape-browser-status'),
  openScrapeBrowser: () => ipcRenderer.invoke('note-harbor:open-scrape-browser'),
  getShowcasePhotoSize: () => ipcRenderer.invoke('note-harbor:get-showcase-photo-size'),
  setShowcasePhotoSize: (photoSize) => ipcRenderer.invoke('note-harbor:set-showcase-photo-size', photoSize),
  showNoteEditorTextMenu: (options) => ipcRenderer.send('note-harbor:show-note-editor-text-menu', options)
});
