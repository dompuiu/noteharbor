import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('noteHarborDesktop', {
  getScrapeBrowserStatus: () => ipcRenderer.invoke('note-harbor:get-scrape-browser-status'),
  openScrapeBrowser: () => ipcRenderer.invoke('note-harbor:open-scrape-browser')
});
